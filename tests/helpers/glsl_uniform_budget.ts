// A fragment shader's UNIFORM VECTORS, counted off its text: what a program asks of
// MAX_FRAGMENT_UNIFORM_VECTORS (WebGL2 guarantees no more than 224, and a phone may offer
// exactly that). Host-agnostic (no three, no DOM, no Node): the Node suite counts a shader
// it assembles from three's own chunks (tests/woc_head_uniform_budget.test.ts), and the
// real-browser suite counts the program a real driver linked
// (tests/browser/woc_merged_head_uniforms.browser.test.ts), both through this module.
//
// Two counts, because the limit is stated in a packing the implementation may or may not
// do:
//   - `uniformVectorRows`: every element of every uniform in a row of its own (a float
//     takes a whole vector). No implementation can need more, so a shader under the limit
//     by this count fits everywhere.
//   - `packedUniformVectors`: the packing GLSL ES 1.00 appendix A section 7 defines and
//     ANGLE's validator runs before it accepts a WebGL shader (VariablePacker). This is
//     the count a browser actually holds a shader to.
// Samplers are opaque: their own limit is MAX_TEXTURE_IMAGE_UNITS, and they are listed
// apart (ANGLE's packing gives each one component, so the packed count can take them).

/** One uniform as a count sees it: a struct is one entry per field (an array of structs,
 *  one per field with the array's size). */
export interface GlslUniform {
  /** The declared name (`pointLights.color` for a struct field). */
  readonly name: string;
  readonly type: string;
  /** Array elements (1 for a uniform that is no array). */
  readonly count: number;
}

export interface GlslUniforms {
  readonly uniforms: GlslUniform[];
  readonly samplers: GlslUniform[];
}

/** Rows and columns one element of a type takes in the packing grid. */
const SHAPE: Readonly<Record<string, readonly [rows: number, columns: number]>> = {
  float: [1, 1],
  int: [1, 1],
  uint: [1, 1],
  bool: [1, 1],
  vec2: [1, 2],
  ivec2: [1, 2],
  bvec2: [1, 2],
  vec3: [1, 3],
  ivec3: [1, 3],
  bvec3: [1, 3],
  vec4: [1, 4],
  ivec4: [1, 4],
  bvec4: [1, 4],
  // a mat2 takes two whole rows in the appendix's packing
  mat2: [2, 4],
  mat3: [3, 3],
  mat4: [4, 4],
};

function shapeOf(type: string): readonly [number, number] {
  const shape = SHAPE[type];
  if (!shape) throw new Error(`glsl uniform budget: a type this count does not know: ${type}`);
  return shape;
}

const isSampler = (type: string): boolean => /^[iu]?sampler/.test(type);

/** The rows `uniforms` take with nothing packed: each element of each in rows of its own. */
export function uniformVectorRows(uniforms: readonly GlslUniform[]): number {
  return uniforms.reduce((rows, u) => rows + shapeOf(u.type)[0] * u.count, 0);
}

/** One variable as the appendix's packing sees it. */
interface Packed {
  readonly rows: number;
  readonly columns: number;
}

/**
 * Whether `variables` pack into a grid of `height` rows of four columns, by the algorithm
 * of GLSL ES 1.00 appendix A section 7 as ANGLE's VariablePacker runs it (the check a WebGL
 * shader passes, or fails with "too many uniforms"): the four column variables first, the
 * three column ones under them (their fourth column left free), the two column ones down
 * columns 0 and 1 and, only once those are spent, up columns 2 and 3 from the bottom, then
 * each single column variable into the smallest free run of any column that holds it.
 */
function packs(height: number, variables: readonly Packed[]): boolean {
  const grid = new Uint8Array(height);
  const fill = (top: number, rows: number, column: number, columns: number): void => {
    const mask = ((1 << columns) - 1) << column;
    for (let r = top; r < top + rows; r++) grid[r] |= mask;
  };
  const group = (columns: number): number[] =>
    variables
      .filter((v) => v.columns === columns)
      .map((v) => v.rows)
      // within a group the largest array first
      .sort((a, b) => b - a);
  if (variables.some((v) => v.rows > height)) return false;
  const four = group(4).reduce((n, rows) => n + rows, 0);
  const three = group(3).reduce((n, rows) => n + rows, 0);
  if (four + three > height) return false;
  fill(0, four, 0, 4);
  fill(four, three, 0, 3);
  const top = four + three;
  let left = height - top;
  let right = height - top;
  for (const rows of group(2)) {
    if (rows <= left) left -= rows;
    else if (rows <= right) right -= rows;
    else return false;
  }
  fill(top, height - top - left, 0, 2);
  fill(top + right, height - top - right, 2, 2);
  for (const rows of group(1)) {
    let best: { column: number; row: number; size: number } | null = null;
    for (let column = 0; column < 4; column++) {
      // the smallest free run of this column that holds the variable
      let start = -1;
      for (let r = 0; r <= height; r++) {
        const free = r < height && (grid[r] & (1 << column)) === 0;
        if (free) {
          if (start < 0) start = r;
          continue;
        }
        const size = start < 0 ? 0 : r - start;
        if (size >= rows && (!best || size < best.size)) best = { column, row: start, size };
        start = -1;
      }
    }
    if (!best) return false;
    fill(best.row, rows, best.column, 1);
  }
  return true;
}

/** The uniforms as the packing takes them: a struct's fields one element at a time (an
 *  array of structs is flattened per element), every other array as one variable down
 *  its columns, and each sampler a single component, as ANGLE counts it. */
function packedVariables(
  uniforms: readonly GlslUniform[],
  samplers: readonly GlslUniform[],
): Packed[] {
  const variables: Packed[] = [];
  for (const u of uniforms) {
    const [rows, columns] = shapeOf(u.type);
    if (u.name.includes('.')) {
      for (let i = 0; i < u.count; i++) variables.push({ rows, columns });
    } else {
      variables.push({ rows: rows * u.count, columns });
    }
  }
  for (const sampler of samplers) variables.push({ rows: sampler.count, columns: 1 });
  return variables;
}

/** Whether a shader with these uniforms passes the appendix's packing check at a limit of
 *  `vectors` uniform vectors (what a WebGL implementation reporting that limit accepts). */
export function uniformsPackInto(
  vectors: number,
  uniforms: readonly GlslUniform[],
  samplers: readonly GlslUniform[] = [],
): boolean {
  return packs(vectors, packedVariables(uniforms, samplers));
}

/**
 * The fewest uniform vectors `uniforms` (and `samplers`) pack into by the appendix's
 * algorithm: the smallest limit an implementation could report and still accept the
 * shader.
 */
export function packedUniformVectors(
  uniforms: readonly GlslUniform[],
  samplers: readonly GlslUniform[] = [],
): number {
  const variables = packedVariables(uniforms, samplers);
  const cells = variables.reduce((n, v) => n + v.rows * v.columns, 0);
  for (let height = Math.max(1, Math.ceil(cells / 4)); height <= 4096; height++) {
    if (packs(height, variables)) return height;
  }
  throw new Error('glsl uniform budget: these uniforms pack into no grid this count tries');
}

// ---------------------------------------------------------------------------
// The text
// ---------------------------------------------------------------------------

type Defines = Map<string, string>;

/** Evaluate a preprocessor condition: `defined(X)`, integers, macros, `! && || < > <= >=
 *  == !=` and parentheses, which is what three's lit shaders write. */
function condition(text: string, defines: Defines): boolean {
  const tokens = text.match(/defined|[A-Za-z_]\w*|\d+|&&|\|\||[<>=!]=|[()!<>]/g) ?? [];
  if (tokens.join('') !== text.replace(/\s+/g, '')) {
    throw new Error(`glsl uniform budget: a condition this count cannot read: ${text}`);
  }
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const next = (): string => tokens[at++] as string;
  const number = (lexeme: string, depth = 0): number => {
    if (/^\d+$/.test(lexeme)) return Number(lexeme);
    const value = defines.get(lexeme)?.trim();
    // an undefined name is 0, as a C preprocessor reads it (and a bare define here)
    if (value === undefined || value === '') return 0;
    if (/^-?\d+$/.test(value)) return Number(value);
    // a macro that names another; anything else (an expression, a float) is not guessed at
    if (depth < 8 && /^[A-Za-z_]\w*$/.test(value)) return number(value, depth + 1);
    throw new Error(`glsl uniform budget: a macro this count cannot read: ${lexeme} ${value}`);
  };
  const primary = (): number => {
    const lexeme = next();
    if (lexeme === '(') {
      const value = or();
      next();
      return value;
    }
    if (lexeme === '!') return primary() ? 0 : 1;
    if (lexeme === 'defined') {
      const open = peek() === '(';
      if (open) next();
      const name = next();
      if (open) next();
      return defines.has(name) ? 1 : 0;
    }
    return number(lexeme);
  };
  const compare = (): number => {
    const left = primary();
    const op = peek();
    if (op === undefined || !/^(?:[<>]=?|==|!=)$/.test(op)) return left;
    next();
    const right = primary();
    const holds =
      op === '<'
        ? left < right
        : op === '>'
          ? left > right
          : op === '<='
            ? left <= right
            : op === '>='
              ? left >= right
              : op === '=='
                ? left === right
                : left !== right;
    return holds ? 1 : 0;
  };
  const and = (): number => {
    let value = compare();
    while (peek() === '&&') {
      next();
      const right = compare();
      value = value && right ? 1 : 0;
    }
    return value;
  };
  function or(): number {
    let value = and();
    while (peek() === '||') {
      next();
      const right = and();
      value = value || right ? 1 : 0;
    }
    return value;
  }
  return or() !== 0;
}

/**
 * The lines of a shader a compiler keeps under `defined` (name to value, '' for a bare
 * define): `#define`, `#undef`, `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`
 * walked in order, every other directive dropped, comments stripped. Returns the live
 * text and the defines as they stand at its end.
 */
export function liveGlsl(
  source: string,
  defined: Readonly<Record<string, string | number>> = {},
): { text: string; defines: Map<string, string> } {
  const defines: Defines = new Map(Object.entries(defined).map(([k, v]) => [k, String(v)]));
  /** One frame per open conditional: whether this arm is live, and whether any arm of it
   *  already was. */
  const open: { live: boolean; taken: boolean }[] = [];
  const live = (): boolean => open.every((frame) => frame.live);
  const lines: string[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const directive = /^#\s*(\w+)\s*(.*)$/.exec(line);
    if (!directive) {
      if (live() && line !== '') lines.push(line);
      continue;
    }
    const [, word, rest] = directive;
    if (word === 'ifdef' || word === 'ifndef' || word === 'if') {
      const outer = live();
      const holds =
        outer &&
        (word === 'if'
          ? condition(rest, defines)
          : defines.has(rest.trim()) === (word === 'ifdef'));
      // inside a dead arm nothing can come alive: `taken` shuts its `#else` too
      open.push({ live: holds, taken: holds || !outer });
    } else if (word === 'elif' || word === 'else') {
      const frame = open[open.length - 1];
      if (!frame) throw new Error(`glsl uniform budget: #${word} with no #if`);
      const holds = !frame.taken && (word === 'else' || condition(rest, defines));
      frame.live = holds;
      frame.taken = frame.taken || holds;
    } else if (word === 'endif') {
      if (!open.pop()) throw new Error('glsl uniform budget: #endif with no #if');
    } else if (word === 'define') {
      const [name, ...value] = rest.trim().split(/\s+/);
      // (a function-like macro is not a value: it defines its name and nothing a count reads)
      if (live()) defines.set(name.replace(/\(.*$/, ''), name.includes('(') ? '' : value.join(' '));
    } else if (word === 'undef') {
      if (live()) defines.delete(rest.trim());
    }
  }
  if (open.length > 0) throw new Error('glsl uniform budget: a conditional is left open');
  return { text: lines.join('\n'), defines };
}

/**
 * Every uniform a (live) shader text declares: `uniform <type> a, b[N];` statements, a
 * struct type one entry per field, an array size a number or a macro of `defines`. A name
 * declared twice counts once. A declaration this cannot read THROWS, never counts as
 * nothing: every `uniform` keyword of the text must be a statement it parsed, and a struct
 * a uniform is declared with must be plain fields (no array, no list of names).
 */
export function glslUniforms(
  text: string,
  defines: ReadonlyMap<string, string> = new Map(),
): GlslUniforms {
  const bodies = new Map<string, string>();
  for (const [, name, body] of text.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
    bodies.set(name, body);
  }
  /** The fields of a struct type a uniform is declared with (read when one is: a struct
   *  no uniform uses may hold anything). */
  const fieldsOf = (type: string): { type: string; name: string }[] | null => {
    const body = bodies.get(type);
    if (body === undefined) return null;
    return body
      .split(';')
      .map((field) => field.trim())
      .filter((field) => field !== '')
      .map((field) => {
        const parts = /^(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)$/.exec(field);
        if (!parts) {
          throw new Error(`glsl uniform budget: a field of ${type} it cannot read: ${field}`);
        }
        return { type: parts[1], name: parts[2] };
      });
  };
  const size = (expr: string): number => {
    let value = expr.trim();
    for (let depth = 0; depth < 8 && !/^\d+$/.test(value); depth++) {
      const next = defines.get(value);
      if (next === undefined) break;
      value = next.trim();
    }
    if (!/^\d+$/.test(value)) {
      throw new Error(`glsl uniform budget: an array size this count cannot read: ${expr}`);
    }
    return Number(value);
  };
  const seen = new Map<string, GlslUniform>();
  const samplers = new Map<string, GlslUniform>();
  const statements = [
    ...text.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g),
  ];
  const keywords = text.match(/\buniform\b/g)?.length ?? 0;
  if (keywords !== statements.length) {
    throw new Error(
      `glsl uniform budget: ${keywords} uniform declarations in the text, ${statements.length} it can read`,
    );
  }
  for (const [, type, declarators] of statements) {
    for (const declarator of declarators.split(',')) {
      const parts = /^\s*(\w+)\s*(?:\[\s*([^\]]+?)\s*\])?\s*$/.exec(declarator);
      if (!parts)
        throw new Error(`glsl uniform budget: a declarator it cannot read: ${declarator}`);
      const [, name, sized] = parts;
      const count = sized === undefined ? 1 : size(sized);
      if (count === 0) continue;
      const fields = fieldsOf(type);
      if (fields) {
        for (const field of fields) {
          const entry = { name: `${name}.${field.name}`, type: field.type, count };
          (isSampler(field.type) ? samplers : seen).set(entry.name, entry);
        }
      } else {
        (isSampler(type) ? samplers : seen).set(name, { name, type, count });
      }
    }
  }
  return { uniforms: [...seen.values()], samplers: [...samplers.values()] };
}

/** The live uniforms of a shader text under `defined`: its preprocessor walked, then its
 *  declarations read. */
export function liveGlslUniforms(
  source: string,
  defined: Readonly<Record<string, string | number>> = {},
): GlslUniforms {
  const { text, defines } = liveGlsl(source, defined);
  return glslUniforms(text, defines);
}

// ---------------------------------------------------------------------------
// A linked program (the real-browser suite)
// ---------------------------------------------------------------------------

/** The slice of a WebGL2 context an active-uniform read needs. */
export interface ActiveUniformContext {
  readonly ACTIVE_UNIFORMS: number;
  getProgramParameter(program: unknown, pname: number): unknown;
  getActiveUniform(
    program: unknown,
    index: number,
  ): { readonly name: string; readonly size: number; readonly type: number } | null;
}

/** GLSL type names by GL uniform type enum (the values WebGL2 fixes). */
const GL_TYPE: ReadonlyMap<number, string> = new Map([
  [0x1406, 'float'],
  [0x1404, 'int'],
  [0x1405, 'uint'],
  [0x8b56, 'bool'],
  [0x8b50, 'vec2'],
  [0x8b51, 'vec3'],
  [0x8b52, 'vec4'],
  [0x8b53, 'ivec2'],
  [0x8b54, 'ivec3'],
  [0x8b55, 'ivec4'],
  [0x8b57, 'bvec2'],
  [0x8b58, 'bvec3'],
  [0x8b59, 'bvec4'],
  [0x8b5a, 'mat2'],
  [0x8b5b, 'mat3'],
  [0x8b5c, 'mat4'],
  [0x8b5e, 'sampler2D'],
  [0x8b5f, 'sampler3D'],
  [0x8b60, 'samplerCube'],
  [0x8b62, 'sampler2DShadow'],
  [0x8dc1, 'sampler2DArray'],
  [0x8dc4, 'sampler2DArrayShadow'],
  [0x8dc5, 'samplerCubeShadow'],
]);

/**
 * The ACTIVE uniforms of a linked program, as the driver reports them
 * (`getProgramParameter(ACTIVE_UNIFORMS)` and `getActiveUniform`): an array once, with
 * its size and without its `[0]`; a struct field under `array[i].field` as the driver
 * lists it, one entry an element.
 */
export function activeGlslUniforms(gl: ActiveUniformContext, program: unknown): GlslUniforms {
  const uniforms: GlslUniform[] = [];
  const samplers: GlslUniform[] = [];
  const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const type = GL_TYPE.get(info.type);
    if (!type) {
      throw new Error(
        `glsl uniform budget: an active uniform type it does not know: ${info.name} 0x${info.type.toString(16)}`,
      );
    }
    const entry = { name: info.name.replace(/\[0\]$/, ''), type, count: info.size };
    (isSampler(type) ? samplers : uniforms).push(entry);
  }
  return { uniforms, samplers };
}

/** The declared name an active uniform belongs to: `pointLights[3].color` is
 *  `pointLights`'s, `uWocHmRef` its own. */
export const uniformBaseName = (name: string): string => name.replace(/[.[].*$/, '');

/** The texture image units a list of samplers takes: one an element (their own limit,
 *  MAX_TEXTURE_IMAGE_UNITS, is 16 guaranteed for a fragment shader). */
export const samplerImageUnits = (samplers: readonly GlslUniform[]): number =>
  samplers.reduce((units, sampler) => units + sampler.count, 0);

// The CPU half of the WOC tint layers' colour-space math
// (src/render/characters/woc_tint_hsv_core.ts) against the GLSL it mirrors. The skin and
// eye transfers used to convert two UNIFORM colours to HSV in every fragment (the
// material's measured reference, the look's eye colour); the layer now converts them once
// on the CPU and the fragment reads the result. What this suite holds:
//   - the mirror IS the shader's function: the shipped GLSL helpers, cut out of the very
//     text woc_head_tint.ts hands three and run here by a small evaluator, answer the same
//     numbers as the TypeScript, bit for bit, over a spread of colours (greys, black,
//     white, the primaries, the measured references, out of range values);
//   - the mirror is a hue, a saturation and a value at all (a textbook conversion agrees
//     to the size of the shader's own epsilon);
//   - the transfers draw what they drew: each role's transfer AS IT SHIPPED BEFORE (the
//     conversions in the fragment, kept here as text) and as it ships now (the same text
//     with the two constants read from uniforms) are run over a spread of texels, targets
//     and references and give the same colour, exactly with the uniforms as computed and
//     to a hundredth of a display step once they are rounded to the floats a GPU holds.
// Not a GPU: the evaluator runs the GLSL arithmetic in double precision. A pixel
// comparison in a real browser is a separate check.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  hexToLinear,
  WOC_BODY_SKIN_REF,
  WOC_HEAD_TINT_TABLE,
  type WocLinearRgb,
} from '../src/render/characters/woc_head_look_core';
import { attachWocHeadMergedTint, attachWocHeadTint } from '../src/render/characters/woc_head_tint';
import { WOC_SUIT_SKIN_GATE_GLSL } from '../src/render/characters/woc_skin_tint_core';
import {
  wocTintLin2Srgb,
  wocTintRgb2Hsv,
  wocTintSrgbHsv,
} from '../src/render/characters/woc_tint_hsv_core';

// ---------------------------------------------------------------------------
// A small GLSL evaluator: the expressions and statements the tint helpers and transfers
// are written in (float and vector arithmetic, swizzles, a dozen built-ins), in double
// precision. Anything else throws, so a text it cannot follow never passes by accident.
// ---------------------------------------------------------------------------

type Val = number | number[];
type Fn = (...args: Val[]) => Val;

const comps = (v: Val): number[] => (typeof v === 'number' ? [v] : v);

function zip(f: (...x: number[]) => number, ...args: Val[]): Val {
  if (args.every((a) => typeof a === 'number')) return f(...(args as number[]));
  const lists = args.map(comps);
  const n = Math.max(...lists.map((l) => l.length));
  for (const l of lists) {
    if (l.length !== 1 && l.length !== n) throw new Error('glsl: mismatched vector sizes');
  }
  return Array.from({ length: n }, (_x, i) => f(...lists.map((l) => l[l.length === 1 ? 0 : i])));
}

const vec =
  (n: number): Fn =>
  (...args) => {
    const flat = args.flatMap(comps);
    if (flat.length === 1) return new Array<number>(n).fill(flat[0]);
    if (flat.length !== n) throw new Error(`glsl: vec${n} of ${flat.length} components`);
    return flat;
  };

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

const BUILTINS: Record<string, Fn> = {
  vec2: vec(2),
  vec3: vec(3),
  vec4: vec(4),
  abs: (x) => zip(Math.abs, x),
  fract: (x) => zip((v) => v - Math.floor(v), x),
  min: (a, b) => zip(Math.min, a, b),
  max: (a, b) => zip(Math.max, a, b),
  pow: (a, b) => zip(Math.pow, a, b),
  mod: (a, b) => zip((x, y) => x - y * Math.floor(x / y), a, b),
  step: (edge, x) => zip((e, v) => (v < e ? 0 : 1), edge, x),
  clamp: (x, lo, hi) => zip(clamp, x, lo, hi),
  // GLSL's own definitions, operation for operation
  mix: (x, y, a) => zip((p, q, t) => p * (1 - t) + q * t, x, y, a),
  smoothstep: (e0, e1, x) =>
    zip(
      (a, b, v) => {
        const t = clamp((v - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
      },
      e0,
      e1,
      x,
    ),
  dot: (a, b) => comps(a).reduce((sum, x, i) => sum + x * comps(b)[i], 0),
};

const SWIZZLE = 'xyzw';
const SWIZZLE_COLOUR = 'rgba';

function swizzle(v: Val, names: string): Val {
  const from = comps(v);
  const out = [...names].map((ch) => {
    const at = Math.max(SWIZZLE.indexOf(ch), SWIZZLE_COLOUR.indexOf(ch));
    if (at < 0 || at >= from.length) throw new Error(`glsl: no component .${ch}`);
    return from[at];
  });
  return out.length === 1 ? out[0] : out;
}

const TOKEN =
  /\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\*=|[-+*/(),.;={}]/g;

/** Evaluate GLSL statements over `env` (declarations, `=`, `*=`, `return`); answers what
 *  a `return` returned, if any. */
function run(text: string, env: Map<string, Val>, fns: ReadonlyMap<string, Fn>): Val | undefined {
  const tokens = text.match(TOKEN) ?? [];
  if (tokens.join('') !== text.replace(/\s+/g, '')) throw new Error(`glsl: cannot read: ${text}`);
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const next = (): string => {
    const lexeme = tokens[at++];
    if (lexeme === undefined) throw new Error('glsl: unexpected end');
    return lexeme;
  };
  const expect_ = (lexeme: string): void => {
    if (next() !== lexeme) throw new Error(`glsl: expected ${lexeme} in: ${text}`);
  };
  const primary = (): Val => {
    const lexeme = next();
    if (lexeme === '(') {
      const v = expression();
      expect_(')');
      return v;
    }
    if (/^[\d.]/.test(lexeme)) return Number(lexeme);
    if (peek() === '(') {
      next();
      const args: Val[] = [];
      if (peek() !== ')') {
        args.push(expression());
        while (peek() === ',') {
          next();
          args.push(expression());
        }
      }
      expect_(')');
      const fn = fns.get(lexeme) ?? BUILTINS[lexeme];
      if (!fn) throw new Error(`glsl: no function ${lexeme}`);
      return fn(...args);
    }
    const value = env.get(lexeme);
    if (value === undefined) throw new Error(`glsl: no variable ${lexeme}`);
    return value;
  };
  const postfix = (): Val => {
    let v = primary();
    while (peek() === '.') {
      next();
      v = swizzle(v, next());
    }
    return v;
  };
  const unary = (): Val => {
    if (peek() === '-') {
      next();
      return zip((x) => -x, unary());
    }
    return postfix();
  };
  const term = (): Val => {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = unary();
      v = zip(op === '*' ? (a, b) => a * b : (a, b) => a / b, v, rhs);
    }
    return v;
  };
  function expression(): Val {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = term();
      v = zip(op === '+' ? (a, b) => a + b : (a, b) => a - b, v, rhs);
    }
    return v;
  }
  while (at < tokens.length) {
    const head = next();
    if (head === 'return') {
      const v = expression();
      expect_(';');
      return v;
    }
    // `<type> name = expr;`, `name = expr;` or `name *= expr;`
    const name = /^(?:float|vec[234])$/.test(head) ? next() : head;
    const op = next();
    const value = expression();
    expect_(';');
    if (op === '=') env.set(name, value);
    else if (op === '*=')
      env.set(
        name,
        zip((a, b) => a * b, env.get(name) as Val, value),
      );
    else throw new Error(`glsl: cannot read: ${text}`);
  }
  return undefined;
}

/** The functions a shader text defines before its `main` (`<type> name(<params>) {...}`,
 *  bodies with no nested block), callable by the evaluator. */
function functionsOf(shader: string): Map<string, Fn> {
  const fns = new Map<string, Fn>();
  const head = shader.slice(0, shader.indexOf('void main() {'));
  for (const m of head.matchAll(/(?:float|vec[234]) (\w+)\(([^)]*)\) \{([^{}]*)\}/g)) {
    const [, name, params, body] = m;
    const names = params.split(',').map((p) => p.trim().split(/\s+/)[1]);
    fns.set(name, (...args) => {
      const out = run(body, new Map(names.map((n, i) => [n, args[i]])), fns);
      if (out === undefined) throw new Error(`glsl: ${name} returned nothing`);
      return out;
    });
  }
  return fns;
}

/** The text of one function of a shader, as shipped. */
function functionText(shader: string, name: string): string {
  const m = new RegExp(`(?:float|vec[234]) ${name}\\([^)]*\\) \\{[^{}]*\\}`).exec(shader);
  if (!m) throw new Error(`the shader defines no ${name}`);
  return m[0];
}

// ---------------------------------------------------------------------------
// The shipped shaders
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** Run a material's hook over three's own standard sources (includes unresolved). */
function compiled(mat: THREE.Material): string {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  mat.onBeforeCompile(shader as never, {} as never);
  return shader.fragmentShader;
}

/** A per-role layer's fragment text. */
function roleShader(role: 'skin' | 'eye', surface?: 'suit'): string {
  const mat = new THREE.MeshStandardMaterial();
  attachWocHeadTint(mat, role, [0.2, 0.1, 0.08], surface);
  return compiled(mat);
}

/** A per-role layer's transfer: what it runs between reading its inputs and mixing the
 *  result in. */
function transferOf(shader: string): string {
  const from = shader.indexOf('vec3 o = c;\n') + 'vec3 o = c;\n'.length;
  const to = shader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHtMix);');
  expect(from).toBeGreaterThan('vec3 o = c;\n'.length);
  expect(to).toBeGreaterThan(from);
  return shader.slice(from, to).trim();
}

const SKIN_SHADER = roleShader('skin');
const FNS = functionsOf(SKIN_SHADER);
const glslHsv = (c: Rgb): number[] => comps(FNS.get('wocHtRgb2Hsv')?.([...c]) as Val);
const glslSrgb = (c: Rgb): number[] => comps(FNS.get('wocHtLin2Srgb')?.([...c]) as Val);

/** Channel values worth meeting: the ends, a hair off them, the mid tones, and what a
 *  material never holds but a shader must survive. */
const CHANNELS = [0, 1e-7, 0.004, 0.0865, 0.1195, 0.2346, 0.5, 0.75, 0.999999, 1];
const SPREAD: Rgb[] = CHANNELS.flatMap((r) =>
  CHANNELS.flatMap((g) => CHANNELS.map((b): Rgb => [r, g, b])),
);
/** The measured references the layers are really handed, and a few look colours. */
const REFS: Rgb[] = [
  ...(['a', 'b'] as const).flatMap((type) =>
    Object.values(WOC_HEAD_TINT_TABLE[type])
      .filter((row) => row.role === 'skin' || row.role === 'eye')
      .map((row) => row.ref),
  ),
  ...Object.values(WOC_BODY_SKIN_REF).map((row) => row.ref),
];
const TARGETS: Rgb[] = [0x2b1a12, 0xe6cc8a, 0xb0381e, 0x3a6ea5, 0x4f8a3c, 0x808080, 0xf2d6c2].map(
  (hex) => hexToLinear(hex),
);

describe('the mirror is the shader function', () => {
  it('reads the helpers out of the shipped text (literal: what the mirror transliterates)', () => {
    expect(functionText(SKIN_SHADER, 'wocHtRgb2Hsv')).toBe(
      [
        'vec3 wocHtRgb2Hsv(vec3 c) {',
        '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
        '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
        '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
        '  float d = q.x - min(q.w, q.y);',
        '  float e = 1.0e-10;',
        '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);',
        '}',
      ].join('\n'),
    );
    expect(functionText(SKIN_SHADER, 'wocHtLin2Srgb')).toBe(
      'vec3 wocHtLin2Srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }',
    );
    // one text for every layer that reads the converted uniforms
    for (const shader of [roleShader('eye'), roleShader('skin', 'suit'), mergedShader()]) {
      for (const name of ['wocHtRgb2Hsv', 'wocHtLin2Srgb', 'wocHtHsv2Rgb', 'wocHtSrgb2Lin']) {
        expect(functionText(shader, name)).toBe(functionText(SKIN_SHADER, name));
      }
    }
  });

  it('answers the shader function bit for bit over a spread of colours', () => {
    expect(SPREAD).toHaveLength(1000);
    for (const c of [...SPREAD, ...REFS, ...TARGETS]) {
      expect(wocTintRgb2Hsv(c), `hsv of ${c}`).toEqual(glslHsv(c));
      expect(wocTintLin2Srgb(c), `srgb of ${c}`).toEqual(glslSrgb(c));
      expect(wocTintSrgbHsv(c), `srgb hsv of ${c}`).toEqual(glslHsv(glslSrgb(c) as never));
    }
  });

  it('keeps the cases the shader guards: a grey, a black, a primary, a channel below zero', () => {
    // no chroma: the epsilon keeps the hue off 0/0, and it comes out 0
    for (const v of [1, 0.5, 0.2346, 1e-7]) {
      expect(wocTintRgb2Hsv([v, v, v])).toEqual([0, 0, v]);
      expect(glslHsv([v, v, v])).toEqual([0, 0, v]);
    }
    // no value: the epsilon keeps the saturation off 0/0
    expect(wocTintRgb2Hsv([0, 0, 0])).toEqual([0, 0, 0]);
    expect(glslHsv([0, 0, 0])).toEqual([0, 0, 0]);
    // the primaries and secondaries, at their sixths of the wheel, a hair under saturated
    const sixths: [Rgb, number][] = [
      [[1, 0, 0], 0],
      [[1, 1, 0], 1 / 6],
      [[0, 1, 0], 2 / 6],
      [[0, 1, 1], 3 / 6],
      [[0, 0, 1], 4 / 6],
      [[1, 0, 1], 5 / 6],
    ];
    for (const [c, hue] of sixths) {
      const [h, s, v] = wocTintRgb2Hsv(c);
      expect(h, `${c}`).toBeCloseTo(hue, 9);
      expect(s, `${c}`).toBe(1 / (1 + 1e-10));
      expect(v, `${c}`).toBe(1);
      expect(glslHsv(c), `${c}`).toEqual([h, s, v]);
    }
    // a channel below zero is held at 0 by the gamma curve, never a NaN
    expect(wocTintLin2Srgb([-0.5, 0.25, 4])).toEqual([0, 0.25 ** (1 / 2.2), 4 ** (1 / 2.2)]);
    for (const c of SPREAD) {
      for (const x of [...wocTintSrgbHsv(c), ...wocTintLin2Srgb(c)]) {
        expect(Number.isFinite(x), `${c}`).toBe(true);
      }
    }
  });

  it('is a hue, a saturation and a value: a textbook conversion agrees', () => {
    const textbook = ([r, g, b]: Rgb): [number, number, number] => {
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d === 0) return [0, 0, max];
      const sector =
        max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [sector / 6, d / max, max];
    };
    let compared = 0;
    for (const c of SPREAD) {
      const [h, s, v] = wocTintRgb2Hsv(c);
      const [th, ts, tv] = textbook(c);
      expect(v).toBe(tv);
      // the shader's epsilon is absolute: it only shows where the chroma is as small
      if (tv - (1 - ts) * tv < 1e-3) continue;
      compared++;
      expect(s, `${c}`).toBeCloseTo(ts, 6);
      // hues compare around the wheel (red sits at both 0 and 1)
      const apart = Math.abs(h - th);
      expect(Math.min(apart, 1 - apart), `${c}`).toBeLessThan(1e-6);
    }
    expect(compared).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// The transfers draw what they drew
// ---------------------------------------------------------------------------

/** The merged layer's fragment text. */
function mergedShader(): string {
  const mat = new THREE.MeshStandardMaterial();
  attachWocHeadMergedTint(mat, true);
  return compiled(mat);
}

/** The skin band and transfer as they shipped with the conversions in the fragment
 *  (literal: the text before this change), `gate` the suit layer's line between them. */
const skinBefore = (gate = ''): string => `vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));
  vec3 rh = wocHtRgb2Hsv(wocHtLin2Srgb(r));
  float dh = mod((hs.x - rh.x) * 360.0 + 540.0, 360.0) - 180.0;
  float w = 1.0 - smoothstep(14.0, 26.0, abs(dh));
  w *= smoothstep(0.08, 0.16, hs.y) * (1.0 - smoothstep(0.8, 0.92, hs.y));
  w *= smoothstep(0.08, 0.16, hs.z);
  vec3 lw = vec3(0.2126, 0.7152, 0.0722);
  float lc = max(dot(c, lw), 1.0e-5);
  float lr = max(dot(r, lw), 1.0e-4);
  ${gate}
  float k = min(lc / lr, 1.8);
  vec3 f = clamp((c / lc) / max(r / lr, vec3(1.0e-4)), vec3(0.5), vec3(2.0));
  o = mix(c, t * k * pow(max(f, vec3(0.0)), vec3(0.55)), w);`;

/** The eye transfer as it shipped with its three conversions in the fragment (literal). */
const EYE_BEFORE = `vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));
  vec3 th = wocHtRgb2Hsv(wocHtLin2Srgb(t));
  float ms = wocHtRgb2Hsv(wocHtLin2Srgb(r)).y;
  float w = smoothstep(ms + 0.08, ms + 0.22, hs.y) * smoothstep(0.03, 0.1, hs.z);
  vec3 iris = wocHtSrgb2Lin(wocHtHsv2Rgb(vec3(th.x, th.y, clamp(hs.z * (0.4 + th.z), 0.0, 1.0))));
  o = mix(c, iris, w);`;

/** Texels a head and a body really hold: skin tones around each reference, lips, the
 *  whites and the irises of an eye, the suit's dark cloth, and the ends of the range. */
const TEXELS: Rgb[] = [
  ...REFS.flatMap((r): Rgb[] => [
    r,
    [r[0] * 1.6, r[1] * 1.5, r[2] * 1.4],
    [r[0] * 0.5, r[1] * 0.45, r[2] * 0.4],
    [r[0] * 1.2, r[1] * 0.7, r[2] * 0.75],
  ]),
  ...[0x101010, 0xf4f0ea, 0x6a8fb0, 0x3c5a2a, 0x7a4a22, 0x1a1c22, 0x3a2a1e, 0xc0392b].map((hex) =>
    hexToLinear(hex),
  ),
  [0, 0, 0],
  [1, 1, 1],
];

const single = (v: number): number => Math.fround(v);

interface Inputs {
  c: Rgb;
  t: Rgb;
  r: Rgb;
}

/** A transfer's output colour: `before` runs the text with the conversions in it, the
 *  other two the shipped text, its two constants handed in as the layer's CPU computes
 *  them (`exact`) or rounded to the single floats a uniform holds (`uploaded`).
 *  `target` false leaves the linear target `t` out of the shipped text's scope, as the
 *  merged layer's eye branch does (it declares the converted `tk` alone): a transfer
 *  that read `t` there would not compile, and here the evaluator refuses the name. */
function drawn(
  text: string,
  { c, t, r }: Inputs,
  how: 'before' | 'exact' | 'uploaded',
  target = true,
): number[] {
  const env = new Map<string, Val>([
    ['c', [...c]],
    ['t', [...t]],
    ['r', [...r]],
    ['o', [...c]],
  ]);
  if (how !== 'before') {
    const round = how === 'uploaded' ? single : (v: number): number => v;
    const [hue, saturation] = wocTintSrgbHsv(r as WocLinearRgb);
    env.set('rk', [round(hue), round(saturation)]);
    env.set('tk', wocTintSrgbHsv(t as WocLinearRgb).map(round));
    if (how === 'uploaded') {
      env.set('t', [...t].map(single));
      env.set('r', [...r].map(single));
    }
    if (!target) env.delete('t');
  }
  run(text, env, FNS);
  return comps(env.get('o') as Val);
}

const worst = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((x, i) => Math.abs(x - b[i])));

describe('the transfers with their constants off the CPU', () => {
  /** Each transfer: its name, its text before and now, and whether the text now may read
   *  the linear target colour (the eye's may not: the merged layer hands it `tk` alone). */
  const LAYERS: [string, string, string, boolean][] = [
    ['skin', skinBefore(), transferOf(SKIN_SHADER), true],
    [
      'skin on the body atlas',
      skinBefore(WOC_SUIT_SKIN_GATE_GLSL),
      transferOf(roleShader('skin', 'suit')),
      true,
    ],
    ['eye', EYE_BEFORE, transferOf(roleShader('eye')), false],
  ];

  it.each(LAYERS)(
    'the %s transfer no longer converts a uniform in the fragment',
    (_n, before, now) => {
      const conversions = (text: string): number => text.split('wocHtRgb2Hsv(').length - 1;
      // one conversion left: the texel's
      expect(conversions(now)).toBe(1);
      expect(now).toContain('vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));');
      expect(conversions(before)).toBeGreaterThan(1);
      const convertsUniform = /wocHt\w+\(wocHtLin2Srgb\([rt]\)\)/;
      expect(before).toMatch(convertsUniform);
      expect(now).not.toMatch(convertsUniform);
    },
  );

  it.each(LAYERS)(
    'the %s transfer draws exactly what it drew, texel for texel',
    (_n, before, now, target) => {
      let moved = 0;
      let cases = 0;
      for (const r of REFS) {
        for (const t of TARGETS) {
          for (const c of TEXELS) {
            const was = drawn(before, { c, t, r }, 'before');
            cases++;
            // with the constants as the CPU computes them: the same arithmetic, the same bits
            expect(drawn(now, { c, t, r }, 'exact', target), `${c} to ${t} against ${r}`).toEqual(
              was,
            );
            // ...and as a GPU holds them: far inside one step of an 8 bit display
            expect(worst(drawn(now, { c, t, r }, 'uploaded', target), was)).toBeLessThan(
              0.01 / 255,
            );
            if (worst(was, c) > 1 / 255) moved++;
          }
        }
      }
      // the spread really exercises the transfer: it recolours a good share of the texels
      expect(cases).toBeGreaterThan(1500);
      expect(moved).toBeGreaterThan(cases / 20);
    },
  );

  it('refuses a name its scope does not hold, as the compiler would', () => {
    // what the eye transfer rests on above: run with no `t` in scope, a text that read the
    // linear target again would throw here (and fail to compile in the merged eye branch)
    const inputs = { c: TEXELS[0], t: TARGETS[0], r: REFS[0] };
    expect(() => drawn(EYE_BEFORE, inputs, 'exact', false)).toThrow('glsl: no variable t');
    expect(() => drawn(transferOf(roleShader('eye')), inputs, 'exact', false)).not.toThrow();
  });

  it('the merged layer runs the very same transfers, its constants read from its rows', () => {
    const merged = mergedShader();
    expect(merged).toContain(transferOf(SKIN_SHADER));
    expect(merged).toContain(transferOf(roleShader('eye')));
    // two conversions in a merged head where there were five: the skin's and the eye's
    // texel, each in its own branch
    expect(merged.split('wocHtRgb2Hsv(').length - 1).toBe(1 + 2);
    expect(merged.split('wocHtLin2Srgb(').length - 1).toBe(1 + 2);
  });
});

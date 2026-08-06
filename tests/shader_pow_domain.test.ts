import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';

// GLSL pow(x, y) is UNDEFINED for x < 0, and every shipping compiler lowers it
// to exp2(y * log2(x)), so a negative base returns NaN rather than a clamped
// value. That NaN is not a local blemish: the VFX materials are additive, so it
// poisons the HDR scene texel, the bloom high-pass carries it into the mip
// chain, and the separable blur (horizontal then vertical) smears one bad texel
// into a HARD-EDGED AXIS-ALIGNED RECTANGLE. OutputGradePass folds the bloom in
// before ACES, and GLSL max(x, y) returns x when y is NaN, so the whole
// rectangle collapses to black rather than to garbage.
//
// The bases that bite are the fresnel-style ones: `1.0 - abs(dot(n, v))` where
// both vectors were normalized IN SHADER. That base is near 1 along the
// silhouette (abs(dot) near 0) and near 0 where the two vectors are ALIGNED or
// ANTI-ALIGNED, i.e. where the surface faces the camera head-on. It is the
// near-zero end that bites: a normalized dot product overshoots 1.0 by an ulp,
// so the base lands at about -1e-7 and the frame gets a black box. That shipped
// as the weapon-skin black square (the Hoarfrost shell, whose uPow is 2.6).
// This gate keeps every pow() base in the tree provably >= 0.
//
// Recognized-safe base forms, no allowlist entry needed:
//   abs(x) / saturate(x) / clamp(x, 0.0, hi) / max(x, 0.0)   the whole base IS
//                                                            the clamping call
//   any of the above scaled by a positive FINITE literal, multiplied or divided
//   1.0 - saturate(x) and 1.0 - clamp(x, lo, 1.0)            x is bounded to 1
// Deliberately NOT recognized: `1.0 - max(x, 0.0)`, which clamps the LOW side
// only and leaves the high side open. That is exactly how the water fresnel used
// to spell this bug.
//
// Every bound the classifier leans on has to be a FINITE literal it can order,
// because two of the ways to write a "clamped" expression are not clamps at
// all: `clamp(x, 0.0, -1.0)` has its bounds reversed, which GLSL leaves
// undefined rather than defining as either bound, and `max(x, 0.0) / 0.0` wraps
// a genuinely non-negative term in a division whose result is undefined and, on
// the shipping lowering, NaN or Inf. Both used to classify safe here.
//
// The classifier is whole-expression, never prefix-matched: `abs(x) - 1.0` and
// `1.0 - saturate(x) * 2.0` both START with a safe-looking token and are both
// genuinely negative-capable, so every arm below parses to the end of the
// expression and settles the top-level operator structure first.
//
// It FAILS CLOSED by design, and the list above is the whole recognized set:
// `length(v)`, `exp(x)`, `x * x`, `smoothstep(a, b, x)`, `1.0 - min(d, 1.0)` and
// even a redundantly parenthesized `(1.0 - saturate(x))` are all non-negative and
// all classified unsafe. A new one of those wants a PROVEN_SAFE_BASES row or a
// new arm here, deliberately: a red is loud and a miss is silent.
//
// Scope is pow() alone. sqrt/log/inversesqrt of a bad argument, and normalize()
// of a zero vector, reach the same additive-then-bloom path (rings.ts already
// carries an `atan(0,0) would NaN into bloom` guard from an earlier incident).
// None of those is unguarded in the tree today; widening this gate to them is a
// separate change.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Roots holding any shader source. Wider than src/ because the offline
 *  asset-pipeline viewer ships its own JS copy of the weapon shaders. */
const SCAN_ROOTS = ['src', 'scripts', 'server', 'headless', 'electron', 'bot'];

interface ProvenSafeBase {
  file: string;
  base: string;
  /** How many sites in that file may carry this base. Pinned so a SECOND, and
   *  entirely different, `pow(w, ...)` in the same file is not blessed by the
   *  row that was written for the first one. */
  sites: number;
  /** Regex asserted against the file's own text: the provenance is a claim about
   *  code elsewhere in that file, so it has to be pinned to that code or it
   *  keeps blessing the site after the line it names is gone. */
  anchor: RegExp;
  why: string;
}

/** Bases that are non-negative by provenance rather than by syntax. */
const PROVEN_SAFE_BASES: ProvenSafeBase[] = [
  {
    file: 'src/render/weapon_vfx.ts',
    base: 'w',
    sites: 1,
    // The anchor pins the WHOLE guarded expression, clamp included. The
    // mathematical range of sin() is not the proof it looks like: GLSL leaves
    // the precision of the trigonometric functions to the implementation, so
    // 0.5 + 0.5 * sin(x) is only provably >= 0 in exact arithmetic. The clamp is
    // what makes the claim hold on a real compiler, so the row stands or falls
    // with it rather than with the sin().
    anchor: /float w = clamp\(0\.5 \+ 0\.5 \* sin\([^;]*, 0\.0, 1\.0\);/,
    why: 'w is the result of a clamp(..., 0.0, 1.0), read one line above the pow()',
  },
  {
    file: 'scripts/asset_pipeline/weapon_vfx.js',
    base: 'w',
    sites: 1,
    anchor: /float w = clamp\(0\.5 \+ 0\.5 \* sin\([^;]*, 0\.0, 1\.0\);/,
    why: 'the offline inspector copy of the same clamped twinkles shader',
  },
  {
    file: 'src/render/worn_stone.ts',
    base: 'wornAxis',
    sites: 1,
    anchor: /vec3 wornAxis = abs\( wornUnitN \)/,
    why: 'wornAxis is an abs() of a normalized vector',
  },
  {
    file: 'src/render/ability_vfx/rings.ts',
    base: '1.0 - uProgress',
    sites: 1,
    anchor: /uniforms\.uProgress\.value = easeOutQuart\(/,
    why: 'uProgress is written from JS as easeOutQuart(min(1, age / dur)), never above 1',
  },
];

/** Every file that currently holds at least one pow(), and how many. Pinned as a
 *  SET with counts, not as a floor: a floor sitting under the real total is what
 *  lets a whole directory leave the scan while the guard stays green. */
const POW_SITES_PER_FILE: Record<string, number> = {
  'src/render/battleground_lantern_fx.ts': 1,
  'src/render/battleground_rune_vfx.ts': 3,
  'src/render/battleground_ward.ts': 1,
  'scripts/asset_pipeline/weapon_vfx.js': 4,
  'src/render/ability_vfx/rings.ts': 1,
  'src/render/ability_vfx/shells.ts': 1,
  'src/render/dungeon.ts': 1,
  'src/render/foliage_shader_core.ts': 1,
  'src/render/pbr_fragment_shader.ts': 1,
  'src/render/post_output_grade.ts': 1,
  'src/render/sky.ts': 1,
  'src/render/water.ts': 1,
  'src/render/weapon_vfx.ts': 4,
  'src/render/worn_stone.ts': 1,
};

// Generated locale bundles are megabytes of prose with no shader in them; a
// stray "pow(" in lore text would be classified as GLSL.
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'i18n.locales', 'i18n.resolved.generated']);

/** Strip block and line comments so commented-out or explanatory pow() text is
 *  ignored. The line arm keeps a `://` in a URL from eating the rest of its
 *  line, which this repo has already shipped once as a live bug (#2499). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Indices of `ops` characters that sit at paren depth 0 in `expr`. Skips the
 *  sign of an exponent literal (1.0e-5) and any leading unary sign. */
function topLevelOperators(expr: string, ops: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ops.includes(ch) && i > 0) {
      const isExponentSign =
        (ch === '-' || ch === '+') && /[eE]/.test(expr[i - 1]) && /[0-9.]/.test(expr[i - 2] ?? '');
      if (!isExponentSign) out.push(i);
    }
  }
  return out;
}

/** Split a call's arguments at depth 0, e.g. `clamp(a, b, 1.0)` -> [a, b, 1.0]. */
function splitArguments(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/** Arguments of `expr` when the WHOLE expression is a call to `name`, else null.
 *  Whole-expression, so `abs(x) - 1.0` does not read as an `abs` call. */
function wholeCallArguments(expr: string, name: string): string[] | null {
  const e = expr.trim();
  const head = new RegExp(`^${name}\\s*\\(`).exec(e);
  if (!head || !e.endsWith(')')) return null;
  const open = head[0].length - 1;
  let depth = 0;
  for (let i = open; i < e.length; i++) {
    if (e[i] === '(') depth++;
    else if (e[i] === ')' && --depth === 0) {
      return i === e.length - 1 ? splitArguments(e.slice(open + 1, -1)) : null;
    }
  }
  return null;
}

const NUMBER = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** The finite scalar an expression denotes, or null when it is not one. Accepts
 *  a `vecN(x)` splat, which GLSL bounds are routinely written as. Anything else,
 *  a uniform or a computed term included, is null: a bound this cannot read is a
 *  bound this cannot ORDER, and an unordered clamp is the undefined case below. */
function literalValue(expr: string): number | null {
  const splat = /^vec[234]\s*\(([^()]*)\)$/.exec(expr.trim());
  const scalar = (splat ? splat[1] : expr).trim();
  if (!NUMBER.test(scalar)) return null;
  const value = Number(scalar);
  return Number.isFinite(value) ? value : null;
}

/** Arguments of a whole-expression `clamp(x, lo, hi)` whose bounds are finite
 *  literals in the RIGHT ORDER, else null. GLSL leaves clamp(x, lo, hi) with
 *  lo > hi undefined, so a reversed pair proves nothing about either end. */
function orderedClampBounds(expr: string): { lo: number; hi: number } | null {
  const clamp = wholeCallArguments(expr, 'clamp');
  if (clamp === null || clamp.length !== 3) return null;
  const lo = literalValue(clamp[1]);
  const hi = literalValue(clamp[2]);
  if (lo === null || hi === null || lo > hi) return null;
  return { lo, hi };
}

/** True when the expression cannot exceed 1.0, so `1.0 - it` stays >= 0. */
function boundedAboveByOne(expr: string): boolean {
  const e = expr.trim();
  if (wholeCallArguments(e, 'saturate') !== null) return true;
  return orderedClampBounds(e)?.hi === 1;
}

/** True when the expression cannot go below 0.0, so pow() is well defined. */
function boundedBelowByZero(expr: string): boolean {
  const e = expr.trim();

  // Additive structure binds loosest, so it settles first. Exactly one shape is
  // provably non-negative, and its right side must be a BARE bounded term: a
  // scaled one (`1.0 - saturate(x) * 2.0`) reaches -1.
  const additive = topLevelOperators(e, '+-');
  if (additive.length > 0) {
    if (additive.length !== 1 || e[additive[0]] !== '-') return false;
    if (literalValue(e.slice(0, additive[0])) !== 1) return false;
    const right = e.slice(additive[0] + 1).trim();
    if (topLevelOperators(right, '*/').length > 0) return false;
    return boundedAboveByOne(right);
  }

  // No additive term: a trailing scale by a POSITIVE FINITE literal cannot
  // change the sign, so drop it and require what remains to BE a clamping call.
  // Multiplication and division are split rather than sharing one arm: `* 0.0`
  // is a degenerate but non-negative zero while `/ 0.0` is undefined and NaN or
  // Inf on the shipping lowering, so the divisor has to be strictly positive and
  // the two cannot be proven by the same rule. Any other top-level product
  // (`abs(a) * sign`, `max(a, 0.0) * -1.0`, `max(a, 0.0) / scale`) is unproven.
  const trailing = /\s*([*/])\s*([^\s*/]+)\s*$/.exec(e);
  let scaled = e;
  if (trailing !== null && topLevelOperators(e, '*/').length === 1) {
    const factor = literalValue(trailing[2]);
    if (factor === null || factor <= 0) return false;
    scaled = e.slice(0, trailing.index).trim();
  }
  if (topLevelOperators(scaled, '*/').length > 0) return false;
  if (wholeCallArguments(scaled, 'abs') !== null) return true;
  if (wholeCallArguments(scaled, 'saturate') !== null) return true;
  if (wholeCallArguments(scaled, 'clamp') !== null) return orderedClampBounds(scaled)?.lo === 0;
  const max = wholeCallArguments(scaled, 'max');
  return (max ?? []).some((arg) => literalValue(arg) === 0);
}

interface PowSite {
  file: string;
  line: number;
  base: string;
}

/** First argument of the pow(...) call whose paren sits at `open`. */
function firstArgument(source: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i).trim();
    } else if (ch === ',' && depth === 1) return source.slice(open + 1, i).trim();
  }
  return null;
}

// `pow \n (` is legal GLSL, and Math.pow / a name merely ending in "pow" is not
// a site. Sticky so the scan can resume after each match.
const POW_CALL = /(^|[^.A-Za-z0-9_])pow\s*\(/g;

// The corpus is read through helpers/source_files_under.ts, not a walk of this
// guard's own: this scan needs the .js and .mjs half of the tree (the offline
// asset-pipeline inspector ships its own JS copy of the weapon shaders) and any
// standalone shader file, and the extension policy behind that belongs in one
// shared place rather than restated per guard. The recursion is still pinned
// below by a mkdtemp fixture driving THIS producer, per tests/CLAUDE.md, since
// the fixture is what proves the guard consumes the walk correctly, and the
// self-audit pins that no second, hand-rolled read was added beside it.
function powSites(roots: string[], base: string): PowSite[] {
  const sites: PowSite[] = [];
  for (const root of roots) {
    for (const entry of sourceFilesUnder(join(base, root), { skipDirectories: SKIPPED_DIRS })) {
      const file = `${root}/${entry.file}`;
      const raw = readFileSync(entry.full, 'utf8');
      if (!raw.includes('pow')) continue;
      const source = withoutComments(raw);
      POW_CALL.lastIndex = 0;
      let match = POW_CALL.exec(source);
      while (match !== null) {
        const open = match.index + match[0].length - 1;
        const argument = firstArgument(source, open);
        if (argument !== null) {
          sites.push({
            file,
            line: source.slice(0, match.index).split('\n').length,
            base: argument,
          });
        }
        match = POW_CALL.exec(source);
      }
    }
  }
  return sites;
}

describe('GLSL pow() bases stay non-negative', () => {
  const sites = powSites(SCAN_ROOTS, repoRoot);

  it('scans every file that currently holds a pow(), at its real site count', () => {
    // A file-SET pin with per-file counts, so a shader leaving the corpus (a
    // moved file, a dropped root, a walk that stops recursing) fails HERE rather
    // than quietly shrinking the surface this guard covers.
    const found: Record<string, number> = {};
    for (const site of sites) found[site.file] = (found[site.file] ?? 0) + 1;
    expect(found).toEqual(POW_SITES_PER_FILE);
  });

  it('never raises a base that a normalized dot product can push negative', () => {
    const unguarded = sites
      .filter((site) => !boundedBelowByZero(site.base))
      .filter(
        (site) =>
          !PROVEN_SAFE_BASES.some((safe) => safe.file === site.file && safe.base === site.base),
      )
      .map((site) => `${site.file}:${site.line} -> pow(${site.base}, ...)`);
    expect(unguarded).toEqual([]);
  });

  it('holds each provenance row to its real site count and its source anchor', () => {
    const mismatched: string[] = [];
    for (const safe of PROVEN_SAFE_BASES) {
      const matching = sites.filter(
        (site) => site.file === safe.file && site.base === safe.base,
      ).length;
      if (matching !== safe.sites) {
        mismatched.push(`${safe.file} -> ${safe.base}: ${matching} sites, row says ${safe.sites}`);
      }
      // The row's reason is a claim about code elsewhere in the file. Pin it, or
      // the row keeps blessing the base after that code is gone.
      const text = readFileSync(join(repoRoot, safe.file), 'utf8');
      if (!safe.anchor.test(text)) {
        mismatched.push(`${safe.file} -> ${safe.base}: anchor ${safe.anchor} no longer matches`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('reproduces the NaN the guard exists to stop', () => {
    // JS Math.pow uses the same exp2(y * log2(x)) lowering as every GLSL
    // compiler, so this IS the shipped failure rather than an analogy for it: an
    // ulp of overshoot in a normalized dot product against Hoarfrost's 2.6.
    const overshoot = Math.abs(1 + Number.EPSILON);
    expect(1 - overshoot).toBeLessThan(0);
    expect((1 - overshoot) ** 2.6).toBeNaN();
    expect(Math.max(0, 1 - overshoot) ** 2.6).toBe(0);
    // And the guard is a no-op on every well-formed input, the silhouette limit
    // included: max() only engages once the base is already negative.
    for (const base of [0, 1e-7, 0.5, 1]) {
      expect(Math.max(0, base) ** 2.6).toBe(base ** 2.6);
    }
  });

  it('rejects the exact spellings that shipped the black rectangle', () => {
    // Per-dimension negatives: each is a base the classifier MUST call unsafe, so
    // a loosened rule cannot quietly re-admit the bug.
    expect(boundedBelowByZero('1.0 - abs(dot(normalize(vN), normalize(vV)))')).toBe(false);
    expect(boundedBelowByZero('1.0 - max(dot(N, V), 0.0)')).toBe(false);
    expect(boundedBelowByZero('sin(3.14159 * vUv.x)')).toBe(false);
    expect(boundedBelowByZero('1.0 - abs(vUv.y * 2.0 - 1.0)')).toBe(false);
    expect(boundedBelowByZero('1.0 - clamp(V.y, 0.0, 2.0)')).toBe(false); // upper bound not 1
    expect(boundedBelowByZero('max(dot(N, V), 0.001)')).toBe(false); // max arg not 0
    expect(boundedBelowByZero('clamp(x, -1.0, 1.0)')).toBe(false); // lower bound not 0
    expect(boundedBelowByZero('0.5 - saturate(x)')).toBe(false); // subtrahend base not 1
  });

  it('is whole-expression, so a safe-looking prefix does not pass', () => {
    // Each opens with a clamping call or a `1.0 -` and still reaches a negative
    // value. A prefix test, or a trailing-scale strip applied before the
    // subtraction rule, admits all of them.
    expect(boundedBelowByZero('abs(x) - 1.0')).toBe(false);
    expect(boundedBelowByZero('abs(x) - 0.5')).toBe(false);
    expect(boundedBelowByZero('saturate(x) - 0.5')).toBe(false);
    expect(boundedBelowByZero('1.0 - saturate(x) * 2.0')).toBe(false);
    expect(boundedBelowByZero('1.0 - clamp(d, 0.0, 1.0) * 3.0')).toBe(false);
    expect(boundedBelowByZero('1.0 - saturate(x) - saturate(y)')).toBe(false);
    expect(boundedBelowByZero('abs(a) * sign')).toBe(false);
    expect(boundedBelowByZero('max(0.0, x) * -1.0')).toBe(false);
    expect(boundedBelowByZero('max(a, 0.0) / scale')).toBe(false);
  });

  it('rejects a wrapper that LOOKS like a clamp and is not one', () => {
    // The two shapes that used to classify safe here. Neither is a clamped
    // term: `/ 0.0` is undefined in GLSL and NaN or Inf on the shipping
    // lowering, and a clamp whose bounds are reversed is undefined outright, so
    // nothing about either end of it is proven.
    expect(boundedBelowByZero('max(x, 0.0) / 0.0')).toBe(false);
    expect(boundedBelowByZero('clamp(x, 0.0, -1.0)')).toBe(false);
    expect(boundedBelowByZero('1.0 - clamp(x, 2.0, 1.0)')).toBe(false);
    // And the same rule applied per dimension: a negative divisor flips the
    // sign, a non-literal one cannot be ordered at all, and a bound that is not
    // a literal is a bound this classifier must not pretend to have read.
    expect(boundedBelowByZero('max(x, 0.0) / -2.0')).toBe(false);
    expect(boundedBelowByZero('max(x, 0.0) / uScale')).toBe(false);
    expect(boundedBelowByZero('clamp(x, 0.0, uHi)')).toBe(false);
    expect(boundedBelowByZero('1.0 - clamp(x, uLo, 1.0)')).toBe(false);
  });

  it('accepts the guarded spellings the fix introduced', () => {
    expect(boundedBelowByZero('max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV))))')).toBe(true);
    expect(boundedBelowByZero('max(0.0, sin(3.14159 * vUv.x))')).toBe(true);
    expect(boundedBelowByZero('max(0.0, 1.0 - abs(vUv.y * 2.0 - 1.0))')).toBe(true);
    expect(boundedBelowByZero('1.0 - clamp(dot(N, V), 0.0, 1.0)')).toBe(true);
    expect(boundedBelowByZero('1.0 - saturate(dot(normal, geometryViewDir))')).toBe(true);
    expect(boundedBelowByZero('max(c, vec3(0.0)) / 0.8')).toBe(true);
    expect(boundedBelowByZero('max(vec3(0.0), c * GAIN + LIFT)')).toBe(true);
    expect(boundedBelowByZero('abs( canopyGN )')).toBe(true);
    expect(boundedBelowByZero('clamp(V.y, 0.0, 1.0)')).toBe(true);
  });

  it('strips comments without letting a URL eat its line', () => {
    expect(withoutComments('a // see https://x.dev/y and pow(bad, 2.0)\nb')).toBe('a \nb');
    expect(withoutComments('x = pow(u, 2.0); // https://x.dev')).toBe('x = pow(u, 2.0); ');
    expect(withoutComments('/* pow(commented, 2.0) */ real')).toBe(' real');
  });

  it('reads the tree only through the shared walker', () => {
    // The other half of the tests/CLAUDE.md contract: the fixture below pins
    // that this producer consumes the walk correctly, and this pins that no
    // second, hand-rolled directory read was added beside it. Over a corpus
    // pinned as a file set, a stray flat read is invisible until the day
    // something moves down a level.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  describe('the producer itself', () => {
    // tests/CLAUDE.md: a guard that scans a directory pins the recursion with a
    // mkdtemp fixture driving its OWN producer, because every real scan root
    // here is already deep enough to pass either way, so no assertion over the
    // real tree can tell a recursive walk from a flat one. The walk itself is
    // helpers/source_files_under.ts and has its own paired test; what this
    // fixture pins is that THIS producer drives it over the whole corpus, at
    // every depth and every extension, and classifies what comes back.
    const fixture = mkdtempSync(join(tmpdir(), 'shader-pow-'));
    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    mkdirSync(join(fixture, 'root', 'nested', 'deeper'), { recursive: true });
    mkdirSync(join(fixture, 'root', 'node_modules'), { recursive: true });
    writeFileSync(join(fixture, 'root', 'top.ts'), 'x = pow(a, 2.0);\n');
    writeFileSync(join(fixture, 'root', 'nested', 'mid.js'), 'y = pow(b, 2.0);\n');
    writeFileSync(join(fixture, 'root', 'nested', 'deeper', 'low.mjs'), 'z = pow (c, 2.0);\n');
    writeFileSync(join(fixture, 'root', 'nested', 'skip.txt'), 'w = pow(d, 2.0);\n');
    writeFileSync(join(fixture, 'root', 'node_modules', 'dep.ts'), 'v = pow(e, 2.0);\n');
    // A standalone shader file. None exists in the tree today, which is exactly
    // why it is pinned here: the first one added must land INSIDE this scan
    // rather than beside it.
    writeFileSync(join(fixture, 'root', 'nested', 'shader.frag'), 'float q = pow(j, 2.0);\n');
    writeFileSync(
      join(fixture, 'root', 'nested', 'tricky.ts'),
      'const url = "https://x.dev/y"; u = pow(f, 2.0);\n' +
        '/* commented = pow(g, 2.0); */\n' +
        'const n = Math.pow(h, 2.0);\n' +
        'const s = lowpow(i);\n',
    );

    const found = powSites(['root'], fixture);

    it('recurses, so a file one level down cannot leave the scan', () => {
      expect(found.map((site) => site.base).sort()).toEqual(['a', 'b', 'c', 'f', 'j']);
    });

    it('keeps the .js, .mjs and shader half of the corpus a .ts-only walk drops', () => {
      expect(found.map((site) => site.file).sort()).toEqual([
        'root/nested/deeper/low.mjs',
        'root/nested/mid.js',
        'root/nested/shader.frag',
        'root/nested/tricky.ts',
        'root/top.ts',
      ]);
    });

    it('finds a spaced call, and skips Math.pow, lowpow, comments and node_modules', () => {
      // `pow (c, 2.0)` is legal GLSL: a startsWith('pow(') scan drops it silently.
      expect(found.some((site) => site.file.endsWith('low.mjs') && site.base === 'c')).toBe(true);
      expect(found.some((site) => site.base === 'd')).toBe(false); // .txt
      expect(found.some((site) => site.base === 'e')).toBe(false); // node_modules
      expect(found.some((site) => site.base === 'g')).toBe(false); // block comment
      expect(found.some((site) => site.base === 'h')).toBe(false); // Math.pow
      expect(found.some((site) => site.base === 'i')).toBe(false); // lowpow
    });
  });
});

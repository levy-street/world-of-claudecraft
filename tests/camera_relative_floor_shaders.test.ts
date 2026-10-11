// Guard: no floor-effect shader in a dungeon instance builds a WORLD point and
// only then applies the camera (`viewMatrix * world`). The instance bands sit a
// hundred thousand yards out, where that float32 product wobbles a floor
// effect's depth by more than its lift over the stone (the flicker in every
// dungeon). The one sanctioned form is src/render/camera_relative_glsl.ts
// (`wocCamRelView`, camera subtracted first) or three's `modelViewMatrix` on a
// positioned mesh. Direction transforms (`viewMatrix * vec4(n, 0.0)`), the
// camera basis (`viewMatrix[i][j]`) and `mat3(viewMatrix)` stay legal.

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMERA_RELATIVE_GLSL } from '../src/render/camera_relative_glsl';

const ROOT = join(__dirname, '..');
const RENDER = join(ROOT, 'src', 'render');

/** Render directories whose content only ever draws inside an instance band. */
const INSTANCE_DIRS = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
  'gravewyrm_sanctum_bosses',
  'gravewyrm_sanctum_fx',
  'wildheart_basin',
  'trash_engine_fx',
  'floor_telegraph',
];

/** Shader modules left on the old form on purpose, with the reason. */
const LEFT_ON_PURPOSE: Record<string, string> = {
  'src/render/water.ts':
    'overworld water bodies only; a few thousand yards out the product is exact',
  'src/render/props.ts':
    'the delve-mouth portal: an upright sheet in the overworld, never on a floor',
};

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function allRenderTs(): string[] {
  return (readdirSync(RENDER, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(RENDER, f));
}

/** Floor shaders the ladder import does not reach: the Warrior kit's baked
 *  impact layers lay their ground smoke and dust flat on any floor. */
const EXTRA_FLOOR_SHADERS = ['src/render/ability_vfx/baked_impact_layers.ts'];

let scanned: string[] | null = null;

/** Every floor-ladder module, every instance-band module, and the render
 *  modules they import directly (shared shader chunks live there). */
function scannedFiles(): string[] {
  if (scanned) return scanned;
  const all = allRenderTs();
  const known = new Set(all.map(rel));
  const seeds = all.filter((f) => {
    const r = rel(f);
    if (INSTANCE_DIRS.some((d) => r.startsWith(`src/render/${d}/`))) return true;
    if (r === 'src/render/blob_shadows.ts' || EXTRA_FLOOR_SHADERS.includes(r)) return true;
    return /from '[./]+floor_vfx_layer'/.test(readFileSync(f, 'utf8'));
  });
  const out = new Set(seeds.map(rel));
  for (const f of seeds) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      const target = posix.normalize(posix.join(posix.dirname(rel(f)), `${m[1]}.ts`));
      if (known.has(target)) out.add(target);
    }
  }
  scanned = [...out].sort();
  return scanned;
}

/** The bodies of a source's template literals (GLSL lives in them). */
function templateBodies(src: string): string[] {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  const skipString = (j: number): number => {
    const q = src[j];
    j++;
    while (j < n && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  const skipTemplate = (j: number): number => {
    while (j < n) {
      const c = src[j];
      if (c === '\\') j += 2;
      else if (c === '`') return j;
      else if (c === '$' && src[j + 1] === '{') {
        let depth = 1;
        j += 2;
        while (j < n && depth > 0) {
          const d = src[j];
          if (d === '`') j = skipTemplate(j + 1) + 1;
          else if (d === "'" || d === '"') j = skipString(j);
          else {
            if (d === '{') depth++;
            else if (d === '}') depth--;
            j++;
          }
        }
      } else j++;
    }
    return n;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === "'" || c === '"') i = skipString(i);
    else if (c === '`') {
      const end = skipTemplate(i + 1);
      out.push(src.slice(i + 1, end));
      i = end + 1;
    } else i++;
  }
  return out;
}

/**
 * The offending products in one GLSL body: `viewMatrix * <operand>` where the
 * operand is a point (anything but a `vec4(..., 0.0)` direction). GLSL line
 * comments are stripped first.
 */
function worldBeforeCameraSites(glsl: string): string[] {
  const code = glsl.replace(/\/\/[^\n]*/g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/(?<![A-Za-z_])viewMatrix\s*\*\s*/g)) {
    const rest = code.slice((m.index ?? 0) + m[0].length);
    const call = /^vec4\s*\(/.exec(rest);
    if (call) {
      let depth = 0;
      let k = 0;
      for (; k < rest.length; k++) {
        if (rest[k] === '(') depth++;
        else if (rest[k] === ')' && --depth === 0) break;
      }
      const inner = rest.slice(rest.indexOf('(') + 1, k);
      let top = 0;
      let lastComma = -1;
      for (let j = 0; j < inner.length; j++) {
        if (inner[j] === '(') top++;
        else if (inner[j] === ')') top--;
        else if (inner[j] === ',' && top === 0) lastComma = j;
      }
      const w = inner.slice(lastComma + 1).trim();
      if (/^0(\.0*)?$/.test(w)) continue; // a direction: the translation drops out
    }
    out.push(`viewMatrix * ${rest.slice(0, 40).split('\n')[0]}`);
  }
  return out;
}

describe('camera-relative floor shaders', () => {
  it('the detector flags world-then-camera products and passes the sanctioned forms', () => {
    expect(worldBeforeCameraSites('gl_Position = projectionMatrix * viewMatrix * w;')).toHaveLength(
      1,
    );
    expect(worldBeforeCameraSites('vec4 mv = viewMatrix * vec4(p, 1.0);')).toHaveLength(1);
    expect(worldBeforeCameraSites('vec4 mv = viewMatrix*modelMatrix*vec4(c,1.);')).toHaveLength(1);
    expect(worldBeforeCameraSites('vec4 mvPosition = viewMatrix * worldPosition;')).toHaveLength(1);
    expect(
      worldBeforeCameraSites(
        [
          'vec3 n = normalize((viewMatrix * vec4(nW, 0.0)).xyz);',
          'vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
          'vec3 l = mat3(viewMatrix) * uSun;',
          'vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          'gl_Position = projectionMatrix * wocCamRelView(w.xyz);',
          '// old: projectionMatrix * viewMatrix * w',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('scans the floor ladder and every instance-band render module', () => {
    const files = scannedFiles();
    // Anchors: the ladder registry, the instance directories and a shared
    // shader chunk reached only through an import.
    for (const anchor of [
      'src/render/blob_shadows.ts',
      'src/render/hollow_crypt/lady_fx.ts',
      'src/render/hollow_crypt/marrow_fx.ts',
      'src/render/hollow_crypt/crypt_fx_floor.ts',
      'src/render/sunken_bastion/bastion_olen_fx.ts',
      'src/render/drowned_temple/temple_tsunami_fx.ts',
      'src/render/gravewyrm_sanctum_bosses/sanctum_boss_art.ts',
      'src/render/wildheart_basin/basin_water.ts',
      'src/render/ignivar_fire_vfx.ts',
      'src/render/ignivar_lava_moat.ts',
      'src/render/nythraxis_soft_fire.ts',
      'src/render/ability_vfx/decals.ts',
      'src/render/ability_vfx/baked_impact_layers.ts',
    ]) {
      expect(files, anchor).toContain(anchor);
    }
  });

  it('no scanned shader builds a world point before applying the camera', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      if (LEFT_ON_PURPOSE[file]) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const body of templateBodies(src)) {
        for (const site of worldBeforeCameraSites(body)) offenders.push(`${file}: ${site}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Temple flood sheet (temple_water_shader.ts) is camera-relative too', () => {
    const src = readFileSync(join(RENDER, 'temple_water_shader.ts'), 'utf8');
    const body = templateBodies(src).find((b) => b.includes('vWPos') && b.includes('mvPosition'));
    expect(body).toBeDefined();
    expect(worldBeforeCameraSites(body ?? '')).toEqual([]);
    expect(body).toContain('wocCamRelView(');
  });

  it('every module calling wocCamRelView splices the helper chunk', () => {
    const missing: string[] = [];
    for (const f of allRenderTs()) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('wocCamRelView(') || rel(f) === 'src/render/camera_relative_glsl.ts')
        continue;
      for (const body of templateBodies(src)) {
        if (body.includes('wocCamRelView(') && !body.includes('${CAMERA_RELATIVE_GLSL}')) {
          // A body may lean on a chunk spliced earlier in the same shader
          // (it interpolates one that carries the helper).
          const chunks = [...body.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]);
          const carried = chunks.some((c) =>
            new RegExp(`const ${c} = (?:/\\* glsl \\*/ )?\`\\$\\{CAMERA_RELATIVE_GLSL\\}`).test(
              src,
            ),
          );
          if (!carried) missing.push(rel(f));
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the left-on-purpose list names only real old-form shaders outside the instance bands', () => {
    for (const [file, reason] of Object.entries(LEFT_ON_PURPOSE)) {
      expect(reason.length).toBeGreaterThan(10);
      expect(INSTANCE_DIRS.some((d) => file.startsWith(`src/render/${d}/`))).toBe(false);
      const src = readFileSync(join(ROOT, file), 'utf8');
      const sites = templateBodies(src).flatMap(worldBeforeCameraSites);
      expect(sites.length, file).toBeGreaterThan(0);
    }
  });

  it('the helper is guarded, global and rotation-after-subtraction', () => {
    expect(CAMERA_RELATIVE_GLSL).toMatch(
      /#ifndef WOC_CAMERA_RELATIVE\n#define WOC_CAMERA_RELATIVE\n/,
    );
    expect(CAMERA_RELATIVE_GLSL).toContain('mat3(viewMatrix) * (world - cameraPosition)');
    expect(CAMERA_RELATIVE_GLSL.trimEnd().endsWith('#endif')).toBe(true);
    expect(worldBeforeCameraSites(CAMERA_RELATIVE_GLSL)).toEqual([]);
  });
});

// ---------------------------------------------------------------- the maths
// A GPU vertex stage in float32, emulated with Math.fround after every
// operation, against the exact (double) view-space depth of a floor point in
// the Hollow Crypt band.

const f = Math.fround;

interface Cam {
  /** Row-major view rotation (R^T of the camera's world rotation). */
  r: number[];
  c: [number, number, number];
}

function camera(x: number, y: number, z: number, yaw: number, pitch: number): Cam {
  // Camera world basis: right, up, back (three's convention, looking down -z).
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const back = [sy * cp, -sp, cy * cp];
  const right = [cy, 0, -sy];
  const up = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  return { r: [...right, ...up, ...back], c: [x, y, z] };
}

function exactViewZ(cam: Cam, p: number[]): number {
  const d = [p[0] - cam.c[0], p[1] - cam.c[1], p[2] - cam.c[2]];
  return cam.r[6] * d[0] + cam.r[7] * d[1] + cam.r[8] * d[2];
}

/** The old form: `viewMatrix * vec4(world, 1.0)` with a float32 matrix. */
function oldViewZ(cam: Cam, p: number[]): number {
  const t = -(cam.r[6] * cam.c[0] + cam.r[7] * cam.c[1] + cam.r[8] * cam.c[2]);
  const w = p.map(f);
  let z = f(f(cam.r[6]) * w[0]);
  z = f(z + f(f(cam.r[7]) * w[1]));
  z = f(z + f(f(cam.r[8]) * w[2]));
  return f(z + f(t));
}

/** The new form: `mat3(viewMatrix) * (world - cameraPosition)`. */
function newViewZ(cam: Cam, p: number[]): number {
  const d = [0, 1, 2].map((i) => f(f(p[i]) - f(cam.c[i])));
  let z = f(f(cam.r[6]) * d[0]);
  z = f(z + f(f(cam.r[7]) * d[1]));
  return f(z + f(f(cam.r[8]) * d[2]));
}

describe('camera-relative precision in an instance band', () => {
  it('drops the depth wobble far under a floor effect lift', () => {
    // A point on the crypt floor and a camera orbiting it at low angles.
    const p = [100_312.37, 7.04, -1_843.61];
    let oldMax = 0;
    let newMax = 0;
    for (let i = 0; i < 360; i++) {
      const yaw = (i / 360) * Math.PI * 2;
      const pitch = 0.08 + (i % 12) * 0.03;
      const dist = 9 + (i % 7) * 2.3;
      const cam = camera(
        p[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
        p[1] + Math.sin(pitch) * dist + 1.7,
        p[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
        yaw,
        pitch,
      );
      const exact = exactViewZ(cam, p);
      oldMax = Math.max(oldMax, Math.abs(oldViewZ(cam, p) - exact));
      newMax = Math.max(newMax, Math.abs(newViewZ(cam, p) - exact));
    }
    // The old product wobbles by more than the lift most floor effects sit at
    // (0.02 to 0.06 yd); the camera-relative one stays within the float32
    // rounding of the two positions (under half a hundredth of a yard).
    expect(oldMax).toBeGreaterThan(0.01);
    expect(newMax).toBeLessThan(0.008);
    expect(newMax * 3).toBeLessThan(oldMax);
  });

  it('is the same view-space point in exact arithmetic', () => {
    const cam = camera(100_300, 12, 40, 0.7, 0.3);
    const p = [100_305.5, 0.5, 44.25];
    const t = -(cam.r[6] * cam.c[0] + cam.r[7] * cam.c[1] + cam.r[8] * cam.c[2]);
    const viaMatrix = cam.r[6] * p[0] + cam.r[7] * p[1] + cam.r[8] * p[2] + t;
    expect(exactViewZ(cam, p)).toBeCloseTo(viaMatrix, 6);
  });
});

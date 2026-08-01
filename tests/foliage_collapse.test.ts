import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyInstanceCollapse,
  type CollapsibleMaterial,
  updateCollapseUniforms,
} from '../src/render/foliage_collapse';
import { instanceCullWindows } from '../src/render/foliage_lod';

// The exact anchors three's WebGLProgram vertex template exposes; the module
// only ever string-replaces against these two includes.
const BASE_VERTEX = [
  '#include <common>',
  'void main() {',
  '#include <uv_vertex>',
  '#include <begin_vertex>',
  '#include <project_vertex>',
  '}',
].join('\n');

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

function compile(mat: CollapsibleMaterial): FakeShader {
  const shader: FakeShader = { uniforms: {}, vertexShader: BASE_VERTEX };
  expect(mat.onBeforeCompile).toBeTypeOf('function');
  mat.onBeforeCompile?.(shader as never, null);
  return shader;
}

describe('foliage collapse: shader injection', () => {
  it('rejects instances outside the window before per-vertex material work', () => {
    const mat: CollapsibleMaterial = {};
    applyInstanceCollapse(mat, 'tree');
    const sh = compile(mat);
    expect(sh.vertexShader).toContain('uniform float uCollapseMin;');
    expect(sh.vertexShader).toContain('uniform float uCollapseMax;');
    // camera-relative XZ distance to the instance's world base, nothing else
    expect(sh.vertexShader).toContain(
      'vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
    );
    expect(sh.vertexShader).toContain(
      'float collapseDist = distance(collapseOrigin, cameraPosition.xz);',
    );
    // window arithmetic: alive on [min, max)
    expect(sh.vertexShader).toContain(
      'float collapseKeep = step(uCollapseMin, collapseDist) * (1.0 - step(uCollapseMax, collapseDist));',
    );
    expect(sh.vertexShader).toContain('if (collapseKeep == 0.0) {');
    expect(sh.vertexShader).toContain('gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    // uniform declarations must land in the prelude, not inside main()
    const mainAt = sh.vertexShader.indexOf('void main()');
    expect(sh.vertexShader.indexOf('uniform float uCollapseMin;')).toBeLessThan(mainAt);
    // the no-fragment return lands before the first stock vertex-main include
    const returnAt = sh.vertexShader.indexOf('return;');
    const uvAt = sh.vertexShader.indexOf('#include <uv_vertex>');
    const beginAt = sh.vertexShader.indexOf('#include <begin_vertex>');
    const projectAt = sh.vertexShader.indexOf('#include <project_vertex>');
    expect(returnAt).toBeGreaterThan(mainAt);
    expect(uvAt).toBeGreaterThan(returnAt);
    expect(beginAt).toBeGreaterThan(uvAt);
    expect(projectAt).toBeGreaterThan(beginAt);
    // The return stays inside the instancing guard, so a non-instanced draw
    // reaches the unchanged UV and later stock chunks.
    expect(sh.vertexShader).toContain(`#ifdef USE_INSTANCING
  vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float collapseDist = distance(collapseOrigin, cameraPosition.xz);
  float collapseKeep = step(uCollapseMin, collapseDist) * (1.0 - step(uCollapseMax, collapseDist));
  if (collapseKeep == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
#endif
#include <uv_vertex>`);
  });

  it('each role reads its own live window: tree ends where the impostor begins', () => {
    const tree: CollapsibleMaterial = {};
    const impostor: CollapsibleMaterial = {};
    const plain: CollapsibleMaterial = {};
    applyInstanceCollapse(tree, 'tree');
    applyInstanceCollapse(impostor, 'impostor');
    applyInstanceCollapse(plain, 'plain');
    const shTree = compile(tree);
    const shImpostor = compile(impostor);
    const shPlain = compile(plain);

    updateCollapseUniforms(instanceCullWindows(138, 146.85));
    expect(shTree.uniforms.uCollapseMin.value).toBe(0);
    expect(shTree.uniforms.uCollapseMax.value).toBe(138);
    expect(shImpostor.uniforms.uCollapseMin.value).toBe(138);
    expect(shImpostor.uniforms.uCollapseMax.value).toBe(146.85);
    expect(shPlain.uniforms.uCollapseMin.value).toBe(0);
    expect(shPlain.uniforms.uCollapseMax.value).toBe(146.85);

    // shared value objects: the next frame's write reaches already-compiled programs
    updateCollapseUniforms(instanceCullWindows(368, 418.15));
    expect(shTree.uniforms.uCollapseMax.value).toBe(368);
    expect(shImpostor.uniforms.uCollapseMin.value).toBe(368);
    expect(shImpostor.uniforms.uCollapseMax.value).toBe(418.15);
  });

  it('composes with an existing hook and rejects before its vertex edits', () => {
    // The wind sway replaces begin_vertex with itself plus offsets. Rejected
    // instances return before that anchor, while live instances execute the
    // byte-unchanged previous hook.
    const windUniform = { value: 0.06 };
    const mat: CollapsibleMaterial = {
      onBeforeCompile(shader) {
        shader.uniforms.uWindStrength = windUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n// wind-pars-marker')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += windAmt;');
      },
    };
    applyInstanceCollapse(mat, 'tree');
    const sh = compile(mat);
    expect(sh.uniforms.uWindStrength).toBe(windUniform); // previous hook still ran
    const windAt = sh.vertexShader.indexOf('transformed.x += windAmt;');
    const returnAt = sh.vertexShader.indexOf('return;');
    expect(windAt).toBeGreaterThan(-1);
    expect(windAt).toBeGreaterThan(returnAt);
    // and the previous hook ran FIRST: both hooks insert right after
    // <common>, so wrapper-first ordering would leave the wind marker ahead
    // of the collapse uniforms instead of behind them
    expect(sh.vertexShader.indexOf('uniform float uCollapseMin;')).toBeLessThan(
      sh.vertexShader.indexOf('// wind-pars-marker'),
    );
  });

  it('program cache keys separate wind-composed materials from plain ones', () => {
    // The default material key stringifies onBeforeCompile, and every wrapper
    // built here stringifies identically even when the wrapped hook (which
    // edits the shader source) differs. Materials whose remaining program
    // parameters coincide would then share a program only one of them links.
    const windless: CollapsibleMaterial = {};
    const windy: CollapsibleMaterial = {
      onBeforeCompile(shader) {
        shader.vertexShader = shader.vertexShader.replace('wind', 'wind');
      },
    };
    const windlessToo: CollapsibleMaterial = {};
    applyInstanceCollapse(windless, 'tree');
    applyInstanceCollapse(windy, 'tree');
    applyInstanceCollapse(windlessToo, 'plain');
    const keyOf = (m: CollapsibleMaterial): string => m.customProgramCacheKey?.() ?? '';
    expect(keyOf(windless)).not.toBe(keyOf(windy));
    // roles share GLSL (only the bound uniform objects differ), so they may
    // and should share a program
    expect(keyOf(windless)).toBe(keyOf(windlessToo));
  });

  it('stays runtime-import-free so plain fakes keep driving it', () => {
    // Not a *_core (it mutates materials and holds shared uniform state), so
    // the architecture sweep never scans it; this is the targeted equivalent.
    // Type-only imports are fine: they erase at build.
    const src = readFileSync(new URL('../src/render/foliage_collapse.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import (?!type )/m);
  });
});

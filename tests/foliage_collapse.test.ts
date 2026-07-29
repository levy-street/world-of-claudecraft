import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyInstanceCollapse,
  type CollapsibleMaterial,
  collapseWindowUniforms,
  updateCollapseUniforms,
} from '../src/render/foliage_collapse';
import { IMPOSTOR_JITTER_GLSL, IMPOSTOR_SWAP_FADE } from '../src/render/foliage_impostor_core';

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
    expect(sh.vertexShader).toContain('uniform float uCollapseFade;');
    // camera-relative XZ distance to the instance's world base, nothing else
    expect(sh.vertexShader).toContain(
      'vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
    );
    expect(sh.vertexShader).toContain(
      'float collapseDist = distance(collapseOrigin, cameraPosition.xz);',
    );
    // the per-instance jittered handoff: the sprite side of the swap
    // evaluates the byte-identical hash (foliage_impostor_core.ts), so the
    // two shaders agree on every tree's swap distance
    expect(sh.vertexShader).toContain(`float collapseJitter = ${IMPOSTOR_JITTER_GLSL};`);
    expect(sh.vertexShader).toContain(
      'float collapseEnd = uCollapseMax - uCollapseFade * collapseJitter;',
    );
    // window arithmetic: alive on [min, jittered end)
    expect(sh.vertexShader).toContain(
      'float collapseKeep = step(uCollapseMin, collapseDist) * (1.0 - step(collapseEnd, collapseDist));',
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
    const guardAt = sh.vertexShader.indexOf('#ifdef USE_INSTANCING');
    const endifAt = sh.vertexShader.indexOf('#endif');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(returnAt);
    expect(endifAt).toBeGreaterThan(returnAt);
    expect(endifAt).toBeLessThan(uvAt);
  });

  it('each role reads its own live window; plain never takes the fade', () => {
    const tree: CollapsibleMaterial = {};
    const rock: CollapsibleMaterial = {};
    const dress: CollapsibleMaterial = {};
    const plain: CollapsibleMaterial = {};
    applyInstanceCollapse(tree, 'tree');
    applyInstanceCollapse(rock, 'rock');
    applyInstanceCollapse(dress, 'dress');
    applyInstanceCollapse(plain, 'plain');
    const shTree = compile(tree);
    const shRock = compile(rock);
    const shDress = compile(dress);
    const shPlain = compile(plain);

    updateCollapseUniforms({
      treeMax: 300,
      rockMax: 345.6,
      dressMax: 192,
      buildingMax: 660,
      fogCull: 546,
      fade: IMPOSTOR_SWAP_FADE,
      spriteFar: 700,
    });
    expect(shTree.uniforms.uCollapseMin.value).toBe(0);
    expect(shTree.uniforms.uCollapseMax.value).toBe(300);
    expect(shTree.uniforms.uCollapseFade.value).toBe(IMPOSTOR_SWAP_FADE);
    expect(shRock.uniforms.uCollapseMax.value).toBe(345.6);
    expect(shRock.uniforms.uCollapseFade.value).toBe(IMPOSTOR_SWAP_FADE);
    expect(shDress.uniforms.uCollapseMax.value).toBe(192);
    expect(shPlain.uniforms.uCollapseMin.value).toBe(0);
    expect(shPlain.uniforms.uCollapseMax.value).toBe(546);
    // ferns and mushrooms have no sprite side, so their boundary never
    // jitters: a fade there would open per-instance holes before the cull
    expect(shPlain.uniforms.uCollapseFade.value).toBe(0);

    // shared value objects: the next frame's write reaches compiled programs
    updateCollapseUniforms({
      treeMax: 368,
      rockMax: 259.2,
      dressMax: 144,
      buildingMax: 300,
      fogCull: 418.15,
      fade: 0,
      spriteFar: 340,
    });
    expect(shTree.uniforms.uCollapseMax.value).toBe(368);
    expect(shTree.uniforms.uCollapseFade.value).toBe(0);
    expect(shRock.uniforms.uCollapseMax.value).toBe(259.2);
    expect(shPlain.uniforms.uCollapseMax.value).toBe(418.15);
  });

  it('exposes the same value objects to the sprite side', () => {
    // foliage_impostor.ts binds these directly, so the sprite half of each
    // handoff reads the very numbers the real half collapsed against.
    const u = collapseWindowUniforms();
    updateCollapseUniforms({
      treeMax: 111,
      rockMax: 222,
      dressMax: 33,
      buildingMax: 555,
      fogCull: 444,
      fade: 5,
      spriteFar: 666,
    });
    expect(u.uTreeMax.value).toBe(111);
    expect(u.uRockMax.value).toBe(222);
    expect(u.uDressMax.value).toBe(33);
    expect(u.uBuildingMax.value).toBe(555);
    expect(u.uFogCull.value).toBe(444);
    expect(u.uFade.value).toBe(5);
    expect(u.uSpriteFar.value).toBe(666);
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

  it('keeps its imports to the pure impostor core so plain fakes keep driving it', () => {
    // Not a *_core (it mutates materials and holds shared uniform state), so
    // the architecture sweep never scans it; this is the targeted equivalent.
    // The one allowed runtime import is foliage_impostor_core (itself a
    // registered pure core): the two shader sides must share the jitter GLSL
    // from one source of truth. Type-only imports erase at build.
    const src = readFileSync(new URL('../src/render/foliage_collapse.ts', import.meta.url), 'utf8');
    const runtimeImports = [...src.matchAll(/^import (?!type ).*from '(.*)';$/gm)].map((m) => m[1]);
    expect(runtimeImports).toEqual(['./foliage_impostor_core']);
  });
});

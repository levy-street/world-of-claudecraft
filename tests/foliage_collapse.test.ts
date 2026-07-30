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
  it('collapses instances outside the window, right before projection', () => {
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
      'transformed *= step(uCollapseMin, collapseDist) * (1.0 - step(uCollapseMax, collapseDist));',
    );
    // uniform declarations must land in the prelude, not inside main()
    const mainAt = sh.vertexShader.indexOf('void main()');
    expect(sh.vertexShader.indexOf('uniform float uCollapseMin;')).toBeLessThan(mainAt);
    // the multiply must land before projection so it is the LAST transformed edit
    const collapseAt = sh.vertexShader.indexOf('transformed *=');
    const projectAt = sh.vertexShader.indexOf('#include <project_vertex>');
    expect(collapseAt).toBeGreaterThan(mainAt);
    expect(projectAt).toBeGreaterThan(collapseAt);
    // and stays harmless for a non-instanced draw of the same material
    expect(sh.vertexShader).toContain('#ifdef USE_INSTANCING');
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

  it('composes with an existing hook and collapses AFTER its vertex edits', () => {
    // The wind sway replaces begin_vertex with itself plus offsets. If the
    // collapse multiplied transformed before those offsets, a collapsed tree
    // would be nudged back off its origin and leave shimmering fragments.
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
    const collapseAt = sh.vertexShader.indexOf('transformed *=');
    expect(windAt).toBeGreaterThan(-1);
    expect(collapseAt).toBeGreaterThan(windAt);
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

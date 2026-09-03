import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the terrain-detail shed, whose
// logic lives in the pure core (terrain_detail_shed_core.ts, Node-tested on
// its own). renderer.ts is not Node-testable, and each pin below is one
// quietly reversible line whose regression every core test would survive.
// Scans anchor on exported symbols and call shapes, never line numbers.
const read = (...parts: string[]): string =>
  readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const rendererSource = read('src', 'render', 'renderer.ts');

function methodBody(search: string): string {
  const start = rendererSource.indexOf(search);
  expect(start, `renderer.ts should still define ${search}`).toBeGreaterThan(-1);
  return rendererSource.slice(start, start + 4000);
}

describe('terrain-detail shed renderer wiring', () => {
  it('keeps the policy core dependency-free (preset, tier, three, and DOM blind)', () => {
    // The fairness judgment rests on the core reading ONLY the governor's
    // pressure/enabled plus dt and the session's own static request passed
    // in: it may import nothing.
    const core = read('src', 'render', 'terrain_detail_shed_core.ts');
    expect(core).not.toMatch(/^import /m);
  });

  it('applies the live level to the shared uniforms wherever a budget state is applied', () => {
    // applyRenderBudgetState is the ONE place every governor output reaches
    // its subsystem (grass, foliage, vfx, lighting, resolution), including
    // the renderer reset path and the prewarm budget-variant walk.
    const apply = methodBody('private applyRenderBudgetState(');
    const body = apply.slice(0, apply.indexOf('\n  }'));
    expect(body).toContain('applyTerrainDetailShed(GFX, state.levels.detail, sharedUniforms)');
    // The shed writes uniform VALUES only: never a mesh's visibility or its
    // shadow casting (that would be a removal, not a cosmetic shed).
    expect(body).not.toMatch(/\.visible\s*=/);
    expect(body).not.toMatch(/\.castShadow\s*=/);
    const core = read('src', 'render', 'terrain_detail_shed_core.ts');
    expect(core).not.toMatch(/\.visible\b/);
    expect(core).not.toMatch(/\.castShadow\b/);
    expect(core).not.toMatch(/needsUpdate/);
    // The per-frame entry point allocates nothing: it writes the three refs
    // from the scalar helper, never through the tuple-building mapping.
    const applyStart = core.indexOf('export function applyTerrainDetailShed(');
    const applyBody = core.slice(applyStart, core.indexOf('\n}', applyStart));
    expect(applyBody).toContain('shedTerrainDetailKnob(');
    expect(applyBody).not.toContain('terrainDetailKnobs(');
    expect(applyBody).not.toMatch(/[=(]\s*\{/);
  });

  it('hands the governor the ?terraindetail= pin and surfaces the live level in perfStats', () => {
    expect(rendererSource).toMatch(
      /new RenderBudgetGovernor\(\{[^}]*pinnedDetailLevel: terrainDetailLevelPin\(\),[^}]*\}\)/,
    );
    const stats = methodBody('perfStats(): RendererPerfStats {');
    expect(stats).toContain('terrainDetailLevel: renderBudget.levels.detail,');
  });

  it('consumes the level through the SAME shared uniform refs the materials attach', () => {
    // terrain.ts and worn_stone.ts attach gfx.ts sharedUniforms by reference
    // (never a { value } copy), so the renderer's in-place write reaches every
    // compiled material with no program relink.
    const terrain = read('src', 'render', 'terrain.ts');
    expect(terrain).toContain('sh.uniforms.uReliefSteps = sharedUniforms.uReliefSteps;');
    const worn = read('src', 'render', 'worn_stone.ts');
    expect(worn).toContain('shader.uniforms.uWornTaps = sharedUniforms.uWornDetailTaps;');
    expect(worn).toContain('shader.uniforms.uWornClampK = sharedUniforms.uWornDetailClampK;');
    // The compiled tap count and the program cache key still read the STATIC
    // request: the live level never selects a program.
    expect(worn).toContain(
      'const taps = !objectSpace && fam.tex.disp !== null ? parallaxTierTaps() : 0;',
    );
    // The governor hears the session's own request, so an Advanced session on
    // tier high with raised dials is admitted, and the applied level reaches
    // the telemetry bucket readout beside the other governed buckets.
    expect(rendererSource).toMatch(/new RenderBudgetGovernor\(\{[^}]*terrainDetail: GFX,[^}]*\}\)/);
    const buckets = methodBody('private graphicsBucketLevels(');
    expect(buckets).toContain('detail: state.levels.detail,');
    expect(worn).toMatch(/`p\$\{parallaxTierTaps\(\)\}c\$\{parallaxTierClampK\(\)\}`/);
    expect(worn).not.toMatch(/customProgramCacheKey[\s\S]{0,600}uWornDetail/);
    expect(terrain).not.toMatch(/customProgramCacheKey[\s\S]{0,600}uReliefSteps/);
  });
});

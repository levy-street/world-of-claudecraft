import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor, type RenderBudgetSample } from '../src/render/render_budget';
import {
  beginRendererFrameTelemetry,
  type RendererFramePhaseMs,
  type RendererWorldPhaseMs,
} from '../src/render/renderer_frame_telemetry_core';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const nameplates = readFileSync(
  new URL('../src/render/nameplate_painter.ts', import.meta.url),
  'utf8',
);

describe('renderer CPU hot path', () => {
  it('reuses picking scratch instead of allocating empty-hit containers', () => {
    expect(renderer).toContain('private readonly raycastNdc = new THREE.Vector2()');
    expect(renderer).toContain(
      'this.raycaster.intersectObjects(this.clickTargets, true, this.raycastHits)',
    );
    expect(renderer).not.toContain('const directHitIds: number[] = []');
  });

  it('batches same-frame nameplate insertion into one live-DOM append', () => {
    expect(renderer).toContain(
      'private readonly nameplateBatch = document.createDocumentFragment()',
    );
    expect(renderer).toContain('this.nameplateLayer.appendChild(this.nameplateBatch)');
  });

  it('manually updates the camera once on ordinary frames', () => {
    expect(renderer).toContain('this.camera.matrixWorldAutoUpdate = false');
    expect(renderer).toContain('if (shakeX !== 0 || shakeY !== 0) this.camera.updateMatrixWorld()');
  });

  it('preserves completed submit and total timings through the reused frame-start buffers', () => {
    const phaseMs: RendererFramePhaseMs = {
      setup: 1,
      entities: 2,
      world: 3,
      nameplates: 4,
      submit: 180,
      total: 190,
    };
    const worldPhaseMs: RendererWorldPhaseMs = {
      lights: 1,
      water: 1,
      terrain: 1,
      props: 1,
      foliage: 1,
      fish: 1,
      vfx: 1,
      camera: 1,
      ambience: 1,
      shadows: 1,
      sky: 1,
      sunSprites: 1,
      godRays: 1,
    };
    const sample: RenderBudgetSample = {
      dt: 1 / 60,
      frameMs: 16,
      totalMs: 0,
      submitMs: 0,
      calls: 120,
      triangles: 180_000,
      grassVisibleTufts: 800,
      grassVisibleChunks: 4,
      activeViews: 12,
      createdViews: 0,
      minRenderScale: 0.65,
      maxRenderScale: 1,
    };

    beginRendererFrameTelemetry(phaseMs, worldPhaseMs, sample);

    expect(sample.submitMs).toBe(180);
    expect(sample.totalMs).toBe(190);
    expect(renderer).toContain(
      'beginRendererFrameTelemetry(framePhaseMs, worldPhaseMs, this.renderBudgetSample);',
    );
    expect(phaseMs).toEqual({
      setup: 0,
      entities: 0,
      world: 0,
      nameplates: 0,
      submit: 0,
      total: 0,
    });

    const governor = new RenderBudgetGovernor({
      tier: 'low',
      budget: GFX_BUDGETS.low,
      enabled: true,
    });
    governor.reset(1, 0.65, 1);
    const state = governor.update(sample);

    expect(state.reason).toBe('submit-stall');
    expect(state.lastSubmitStallMs).toBe(180);
    expect(state.stallHoldSeconds).toBe(18);
  });

  it('fully skips proven-static world branches while reusing telemetry containers', () => {
    expect(renderer).toContain('const frameStats = this.lastFrameStats');
    expect(renderer).toContain('this.foliage.perfStats(frameStats.foliage)');
    expect(renderer).not.toContain('const markPhase =');
    expect(renderer).not.toContain('const markWorldPhase =');
    expect(renderer).toContain('freezeStaticSubtreeMatrices(this.terrainView.group)');
    expect(renderer).toContain('freezeStaticSubtreeMatrices(this.waterView.group)');
    expect(renderer).toContain('freezeStaticSubtreeMatrices(this.eastbrookTownView.group)');
    expect(renderer).toContain('freezeStaticSubtreeMatrices(this.gatherNodes.group)');
  });

  it('compares nameplate primitives before formatting unchanged DOM strings', () => {
    expect(nameplates).toContain(
      'if (anchor.sx === v.nameplateScreenX && anchor.sy === v.nameplateScreenY) continue',
    );
    expect(nameplates).toContain('name === v.nameplateStaticName');
    expect(nameplates).not.toContain("e.auras.some((a) => a.kind === 'stealth')");
  });
});

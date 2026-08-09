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
const nameplateCanvas = readFileSync(
  new URL('../src/render/nameplate_canvas.ts', import.meta.url),
  'utf8',
);
const editorViewport = readFileSync(
  new URL('../src/editor/3d/viewport.ts', import.meta.url),
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

  it('uses one shared canvas instead of per-view nameplate DOM', () => {
    expect(nameplateCanvas).toContain("document.createElement('canvas')");
    expect(nameplateCanvas).toContain("canvas.className = 'nameplate-canvas'");
    expect(nameplateCanvas).toContain('this.ctx.clearRect(0, 0, width, height)');
    expect(renderer).not.toContain('nameplateBatch');
    expect(renderer).not.toContain("np.className = 'nameplate'");
    expect(renderer).not.toContain('nameplate: HTMLDivElement');
  });

  it('releases the shared canvas and document listeners with the renderer host', () => {
    // The LIVE release path is the terminal one every host reaches:
    // disposeRendererResources, from shutdown() (the editor viewport teardown
    // and the live graphics rebuild) and from the constructor's partial-build
    // catch. Optional-chained there on purpose, see the comment at the call.
    const terminalStart = renderer.indexOf('private disposeRendererResources(): void {');
    const terminalEnd = renderer.indexOf('\n  }', terminalStart);
    const terminalBlock = renderer.slice(terminalStart, terminalEnd);
    expect(terminalBlock).toContain('this.nameplatePainter?.dispose()');

    // dispose() is the explicit host-teardown helper. It is unreferenced since
    // the editor viewport moved onto shutdown(), so this keeps its body in step
    // with the terminal path rather than pinning a second LIVE path.
    const disposeStart = renderer.indexOf('dispose(): void {');
    const disposeEnd = renderer.indexOf('\n  }', disposeStart);
    const disposeBlock = renderer.slice(disposeStart, disposeEnd);
    expect(disposeBlock).toContain('this.nameplatePainter.dispose();');
    expect(disposeBlock).toContain('this.travelSpeedFx.dispose();');

    expect(editorViewport).toContain('.shutdown()');
    expect(renderer).toContain('this.nameplatePainter.remove(id);');
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
      ambientScenery: 1,
      zoneVisibility: 1,
      zoneFeatures: 1,
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

  it('attributes visibility, fish, ambient scenery, and zone feature animation separately', () => {
    const terrainMarkAt = renderer.lastIndexOf(
      "this.markRendererWorldPhase(worldPhaseMs, 'terrain', worldStart)",
    );
    const zoneVisibilityAt = renderer.lastIndexOf('this.updateZoneFeatureVisibility(fogFar);');
    const earlyZoneFeatureMarkAt = renderer.indexOf(
      "this.markRendererWorldPhase(worldPhaseMs, 'zoneVisibility', worldStart)",
      zoneVisibilityAt,
    );
    const propsUpdateAt = renderer.indexOf('this.propsView.update(', zoneVisibilityAt);
    const fishUpdateAt = renderer.lastIndexOf('this.fish.update(p.pos.x, p.pos.z, dt);');
    const fishMarkAt = renderer.indexOf(
      "this.markRendererWorldPhase(worldPhaseMs, 'fish', worldStart)",
      fishUpdateAt,
    );
    const motesAt = renderer.indexOf('this.motes.update(p.pos.x, p.pos.z, dt);', fishUpdateAt);
    const ambientMarkAt = renderer.indexOf(
      "this.markRendererWorldPhase(worldPhaseMs, 'ambientScenery', worldStart)",
      motesAt,
    );
    const realmFloraAt = renderer.indexOf('this.realmFlora?.update(this.time);', motesAt);
    const featureMarkAt = renderer.indexOf(
      "this.markRendererWorldPhase(worldPhaseMs, 'zoneFeatures', worldStart)",
      realmFloraAt,
    );

    expect(terrainMarkAt).toBeGreaterThan(-1);
    expect(zoneVisibilityAt).toBeGreaterThan(terrainMarkAt);
    expect(earlyZoneFeatureMarkAt).toBeGreaterThan(zoneVisibilityAt);
    expect(propsUpdateAt).toBeGreaterThan(earlyZoneFeatureMarkAt);
    expect(fishUpdateAt).toBeGreaterThan(-1);
    expect(fishMarkAt).toBeGreaterThan(fishUpdateAt);
    expect(motesAt).toBeGreaterThan(fishMarkAt);
    expect(ambientMarkAt).toBeGreaterThan(motesAt);
    expect(realmFloraAt).toBeGreaterThan(ambientMarkAt);
    expect(featureMarkAt).toBeGreaterThan(realmFloraAt);
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

  it('culls before decluttering and keeps canvas text APIs out of the entity loop', () => {
    expect(nameplates).toContain('isNameplateScreenAnchorVisible');
    expect(nameplates).toContain('declutterNameplatesInPlace');
    expect(nameplates).toContain(
      '!state.initialized || fullPass || plan.urgent || languageChanged',
    );
    expect(nameplates).not.toContain('fillText(');
    expect(nameplates).not.toContain('strokeText(');
    expect(nameplates).not.toContain('measureText(');
    expect(nameplateCanvas).not.toContain('fillText(');
    expect(nameplateCanvas).not.toContain('strokeText(');
    expect(nameplateCanvas).not.toContain('measureText(');
    expect(nameplates.indexOf('if (!isNameplateScreenAnchorVisible(')).toBeLessThan(
      nameplates.indexOf('declutterNameplatesInPlace('),
    );
  });

  it('times the live nameplate pass after its painter update', () => {
    const timingIndex = renderer.indexOf(
      "phaseStart = this.markRendererPhase(framePhaseMs, 'nameplates', phaseStart);",
    );
    const painterIndex = renderer.lastIndexOf('this.nameplatePainter.update(fullNameplatePass);');

    expect(painterIndex).toBeGreaterThan(-1);
    expect(timingIndex).toBeGreaterThan(painterIndex);
  });
});

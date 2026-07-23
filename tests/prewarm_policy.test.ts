import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONSTRAINED_PREWARM_KEEP,
  constrainedEntryViewCreateBudget,
  orderedPrewarmIds,
  type PrewarmPolicyInput,
  prewarmEntryRuns,
  remainingPrewarmViewBudget,
  resolvePrewarmPolicy,
} from '../src/render/prewarm_policy';

// The real desktop constants (renderer.ts), injected so the test pins the actual
// numbers the renderer uses rather than duplicating magic values.
const BASE: PrewarmPolicyInput = {
  constrainedMemory: false,
  asyncCompileSupported: true,
  lowGfx: false,
  defaultMaxMs: 12000,
  constrainedMaxMs: 5000,
  defaultCompileMaxMs: 10000,
  constrainedCompileMaxMs: 2500,
  maxViewsLow: 48,
  maxViewsHigh: 72,
  maxViewsConstrained: 2,
};

// The full manifest id order the renderer builds, for the reorder tests.
const MANIFEST_IDS = [
  'views.required',
  'views.nearby',
  'props.dungeon-doors',
  'interiors.materials',
  'entities.player-archetypes',
  'entities.mob-archetypes',
  'entities.npc-archetypes',
  'objects.quest-archetypes',
  'props.material-variants',
  'foliage.materials',
  'textures.scene',
  'vfx.atlas',
  'world.initial-frame',
  'programs.compile',
  'sky.biome-variants',
  'render.settle-passes',
  'diagnostics.baseline',
];

describe('resolvePrewarmPolicy: unconstrained (desktop) reproduces historical behavior', () => {
  it('runs the full manifest with generous budgets and no reordering', () => {
    const p = resolvePrewarmPolicy(BASE);
    expect(p.minimalManifest).toBe(false);
    expect(p.maxMs).toBe(12000);
    expect(p.compileMaxMs).toBe(10000);
    expect(p.maxViews).toBe(72);
    expect(p.yieldBetweenEntries).toBe(false);
    expect(p.linkPassPerEntry).toBe(false);
    expect(p.compileBeforeFirstFrame).toBe(false);
    expect(p.skipMonolithCompile).toBe(false);
  });

  it('uses the low view cap on the low tier', () => {
    expect(resolvePrewarmPolicy({ ...BASE, lowGfx: true }).maxViews).toBe(48);
  });

  it('never reorders or trims the manifest', () => {
    const p = resolvePrewarmPolicy(BASE);
    expect(orderedPrewarmIds(MANIFEST_IDS, p)).toEqual(MANIFEST_IDS);
    for (const id of MANIFEST_IDS) expect(prewarmEntryRuns(id, p)).toBe(true);
  });
});

describe('resolvePrewarmPolicy: constrained with parallel compile (the iPhone path)', () => {
  const p = resolvePrewarmPolicy({
    ...BASE,
    constrainedMemory: true,
    asyncCompileSupported: true,
  });

  it('caps budget, compile budget, and nearby views hard', () => {
    expect(p.maxMs).toBe(5000);
    expect(p.compileMaxMs).toBe(2500);
    // The production-hub fix: only self plus one required/nearby view may build
    // synchronously at entry, never a crowd that reveals on the first live submit.
    expect(p.maxViews).toBe(2);
  });

  it('yields the event loop, compiles before the first frame, and keeps the monolith', () => {
    expect(p.yieldBetweenEntries).toBe(true);
    expect(p.compileBeforeFirstFrame).toBe(true);
    // With parallel compile the per-entry link passes starve the manifest, so off.
    expect(p.linkPassPerEntry).toBe(false);
    // The async compile entry still runs (links off-thread), so do NOT skip it.
    expect(p.skipMonolithCompile).toBe(false);
  });

  it('restricts the manifest to the keep-list', () => {
    expect(p.minimalManifest).toBe(true);
    expect(prewarmEntryRuns('views.required', p)).toBe(true);
    expect(prewarmEntryRuns('views.nearby', p)).toBe(true);
    expect(prewarmEntryRuns('programs.compile', p)).toBe(true);
    expect(prewarmEntryRuns('world.initial-frame', p)).toBe(true);
    expect(prewarmEntryRuns('render.settle-passes', p)).toBe(true);
    expect(prewarmEntryRuns('textures.scene', p)).toBe(true);
    // The memory-heavy warms are skipped.
    expect(prewarmEntryRuns('entities.mob-archetypes', p)).toBe(false);
    expect(prewarmEntryRuns('sky.biome-variants', p)).toBe(false);
  });

  it('initializes scene textures in bounded batches', () => {
    expect(p.textureBatchSize).toBe(4);
    expect(p.textureMaxMs).toBe(1200);
  });

  it('wires the two-view constrained cap into the renderer', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('const VIEW_PREWARM_MAX_VIEWS_CONSTRAINED = 2;');
    expect(renderer).toContain(
      'this.createPersistentPortalViews(\n            createdViewTypes,\n            deadline,\n            remainingPrewarmViewBudget(policy.maxViews, createdViews),\n          )',
    );
  });

  it('moves programs.compile to just before world.initial-frame', () => {
    const ordered = orderedPrewarmIds(MANIFEST_IDS, p);
    const frameIdx = ordered.indexOf('world.initial-frame');
    const compileIdx = ordered.indexOf('programs.compile');
    expect(compileIdx).toBe(frameIdx - 1);
    // No entry is lost or duplicated by the reorder.
    expect(ordered.length).toBe(MANIFEST_IDS.length);
    expect(new Set(ordered)).toEqual(new Set(MANIFEST_IDS));
  });

  it('honors maxViewsConstrained only when it is below the tier cap', () => {
    const highCap = resolvePrewarmPolicy({
      ...BASE,
      constrainedMemory: true,
      maxViewsConstrained: 999,
    });
    expect(highCap.maxViews).toBe(72); // tier cap still wins when it is lower
  });
});

describe('remainingPrewarmViewBudget', () => {
  it('never allows required substeps to exceed the total entry cap', () => {
    expect(remainingPrewarmViewBudget(2, 0)).toBe(2);
    expect(remainingPrewarmViewBudget(2, 1)).toBe(1);
    expect(remainingPrewarmViewBudget(2, 2)).toBe(0);
    expect(remainingPrewarmViewBudget(2, 7)).toBe(0);
  });

  it('normalizes fractional and invalid budgets', () => {
    expect(remainingPrewarmViewBudget(2.9, 1.2)).toBe(1);
    expect(remainingPrewarmViewBudget(-1, 0)).toBe(0);
  });
});

describe('resolvePrewarmPolicy: constrained WITHOUT parallel compile', () => {
  const p = resolvePrewarmPolicy({
    ...BASE,
    constrainedMemory: true,
    asyncCompileSupported: false,
  });

  it('links group-by-group per entry and skips the synchronous monolith', () => {
    expect(p.linkPassPerEntry).toBe(true);
    expect(p.skipMonolithCompile).toBe(true);
    // No reorder: without off-thread compile there is nothing to front-load.
    expect(p.compileBeforeFirstFrame).toBe(false);
    expect(orderedPrewarmIds(MANIFEST_IDS, p)).toEqual(MANIFEST_IDS);
  });
});

describe('the keep-list is the minimal entry set', () => {
  it('contains exactly the entries needed to enter without a first-frame stall', () => {
    expect([...CONSTRAINED_PREWARM_KEEP].sort()).toEqual(
      [
        'programs.compile',
        'render.settle-passes',
        'textures.scene',
        'views.nearby',
        'views.required',
        'world.initial-frame',
      ].sort(),
    );
  });
});

describe('constrained entry view creation ramp', () => {
  it('creates no optional view on the first live frame, then streams one at a time', () => {
    expect(constrainedEntryViewCreateBudget(true, 0, 8)).toBe(0);
    for (const elapsedMs of [1, 16, 150, 300]) {
      expect(constrainedEntryViewCreateBudget(true, elapsedMs, 8)).toBe(1);
    }
  });

  it('restores the normal budget before the loading and input guard clears', () => {
    expect(constrainedEntryViewCreateBudget(true, 301, 8)).toBe(8);
  });

  it('does not alter unconstrained or already-small budgets', () => {
    expect(constrainedEntryViewCreateBudget(false, 0, 8)).toBe(8);
    expect(constrainedEntryViewCreateBudget(true, 5, 0)).toBe(0);
  });

  it('is wired into the renderer before optional candidate creation', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const budgetMethodStart = renderer.indexOf('private runtimeViewCreateBudget(');
    const budgetMethodEnd = renderer.indexOf(
      '\n  private viewCandidatePriority(',
      budgetMethodStart,
    );
    const budgetMethod = renderer.slice(budgetMethodStart, budgetMethodEnd);
    const budgetAt = budgetMethod.indexOf('const base = constrainedEntryViewCreateBudget(');
    const zeroGuardAt = budgetMethod.indexOf('if (base === 0) return 0;');
    const backoffAt = budgetMethod.indexOf('if (this.viewCreateBackoff > 0)');
    const createAt = renderer.indexOf('this.createCandidateViews(', budgetMethodEnd);
    const elapsedIncrementAt = renderer.indexOf(
      'this.runtimeEntryElapsedMs += Math.min(250, Math.max(0, dt * 1000))',
    );
    expect(budgetMethodStart).toBeGreaterThan(-1);
    expect(budgetMethodEnd).toBeGreaterThan(budgetMethodStart);
    expect(budgetAt).toBeGreaterThan(-1);
    expect(zeroGuardAt).toBeGreaterThan(budgetAt);
    expect(backoffAt).toBeGreaterThan(zeroGuardAt);
    expect(createAt).toBeGreaterThan(budgetMethodEnd);
    expect(elapsedIncrementAt).toBeGreaterThan(createAt);
  });

  it('uses the bounded texture path for constrained prewarm', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      `await this.prewarmInitialSceneTexturesBatched(
                policy.textureBatchSize,
                policy.textureMaxMs,
              )`,
    );
    const collectionStart = renderer.indexOf('private collectInitialSceneTextures(');
    const collectionEnd = renderer.indexOf(
      '\n  private async prewarmInitialSceneTexturesBatched(',
      collectionStart,
    );
    const collectionMethod = renderer.slice(collectionStart, collectionEnd);
    expect(collectionMethod).toContain('this.collectObjectTextures(this.scene, true)');
    expect(collectionMethod).toContain('for (const view of this.views.values())');
    expect(collectionMethod).toContain('this.collectObjectTextures(view.group, false, textures)');

    const methodStart = renderer.indexOf('private async prewarmInitialSceneTexturesBatched(');
    const methodEnd = renderer.indexOf('\n  private renderPrewarmPass(', methodStart);
    const method = renderer.slice(methodStart, methodEnd);
    const batchLoopAt = method.indexOf('for (let i = 0;');
    const deadlineAt = method.indexOf('const deadline = performance.now() + Math.max(0, maxMs)');
    const deadlineGuardAt = method.indexOf('performance.now() < deadline', batchLoopAt);
    const batchStepAt = method.indexOf('i += batch', batchLoopAt);
    const batchEndAt = method.indexOf('Math.min(textures.length, i + batch)', batchLoopAt);
    const uploadAt = method.indexOf('this.prewarmTexture(textures[j])');
    const yieldAt = method.indexOf('await sleep(0)');
    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(deadlineAt).toBeGreaterThan(-1);
    expect(batchLoopAt).toBeGreaterThan(-1);
    expect(deadlineGuardAt).toBeGreaterThan(batchLoopAt);
    expect(batchStepAt).toBeGreaterThan(deadlineGuardAt);
    expect(batchEndAt).toBeGreaterThan(batchLoopAt);
    expect(uploadAt).toBeGreaterThan(batchLoopAt);
    expect(yieldAt).toBeGreaterThan(uploadAt);
    expect(method.slice(yieldAt - 100, yieldAt)).toContain('performance.now() < deadline');
  });
});

describe('runtime entity-view parity', () => {
  it('keeps the full shared visibility range and continuous world submission', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).not.toContain('ENTITY_VIEW_CREATE_RANGE_CONSTRAINED');
    expect(renderer).not.toContain('ENTITY_VIEW_DESTROY_RANGE_CONSTRAINED');
    expect(renderer).not.toContain('resolveRuntimeViewRangePolicy({');
    expect(renderer).toContain('private entityViewCreateRangeSq = ENTITY_VIEW_CREATE_RANGE_SQ;');
    expect(renderer).toContain('private entityViewDestroyRangeSq = ENTITY_VIEW_DESTROY_RANGE_SQ;');
    expect(renderer).not.toContain('options.submit');
    expect(renderer).not.toContain('postOverlayViewCreateBudget(');
  });
});

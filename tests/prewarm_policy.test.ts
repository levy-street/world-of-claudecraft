import { describe, expect, it } from 'vitest';
import {
  CONSTRAINED_PREWARM_KEEP,
  orderedPrewarmIds,
  type PrewarmPolicyInput,
  prewarmEntryRuns,
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
  maxViewsConstrained: 12,
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
  const p = resolvePrewarmPolicy({ ...BASE, constrainedMemory: true, asyncCompileSupported: true });

  it('caps budget, compile budget, and nearby views hard', () => {
    expect(p.maxMs).toBe(5000);
    expect(p.compileMaxMs).toBe(2500);
    // The production-hub fix: at most 12 nearby rigs build synchronously at entry,
    // never the 72 that killed Medium in a populated world.
    expect(p.maxViews).toBe(12);
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
    // The memory-heavy warms are skipped.
    expect(prewarmEntryRuns('entities.mob-archetypes', p)).toBe(false);
    expect(prewarmEntryRuns('textures.scene', p)).toBe(false);
    expect(prewarmEntryRuns('sky.biome-variants', p)).toBe(false);
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
        'views.nearby',
        'views.required',
        'world.initial-frame',
      ].sort(),
    );
  });
});

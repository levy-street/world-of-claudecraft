import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE,
  CONSTRAINED_PREWARM_KEEP,
  CONSTRAINED_PREWARM_RESUME,
  constrainedEntryViewCreateBudget,
  interactionLandmarkViewPriority,
  mandatoryLandmarkViewsReady,
  materialProgramSignature,
  NEARBY_LANDMARK_STREAM_RADIUS,
  orderedPrewarmIds,
  type PrewarmPolicyInput,
  partitionMandatoryLandmarkCandidates,
  partitionResidentSkyBiomes,
  planCompileSubmission,
  prewarmBuildDeadline,
  prewarmCompileAwaitDeadline,
  prewarmEntryResumesAfterSkip,
  prewarmEntryRuns,
  prewarmEntryShouldDefer,
  prewarmProgramContentKeys,
  remainingPrewarmViewBudget,
  resolvePrewarmEntryStatus,
  resolvePrewarmPolicy,
  skyAssetInlineWaitMs,
  withRestoredPrewarmState,
} from '../src/render/prewarm_policy';

// The real desktop constants (renderer.ts), injected so the test pins the actual
// numbers the renderer uses rather than duplicating magic values.
const BASE: PrewarmPolicyInput = {
  constrainedMemory: false,
  asyncCompileSupported: true,
  lowGfx: false,
  finishFullManifestBeforeReveal: false,
  defaultMaxMs: 12000,
  constrainedMaxMs: 5000,
  defaultCompileMaxMs: 10000,
  constrainedCompileMaxMs: 2500,
  maxViewsLow: 48,
  maxViewsHigh: 72,
  maxViewsConstrained: 2,
};

// The full manifest id order the renderer builds, for the reorder tests.
// Kept in lockstep with the renderer by the "matches the renderer's real
// manifest" case below, which parses the source.
const MANIFEST_IDS = [
  'views.required',
  'views.landmarks',
  'views.persistent-portals',
  'views.nearby',
  'props.dungeon-doors',
  'interiors.materials',
  'entities.player-archetypes',
  'entities.mob-archetypes',
  'entities.npc-archetypes',
  'objects.quest-archetypes',
  'props.material-variants',
  'props.ghost-fade-variants',
  'foliage.materials',
  'foliage.great-tree-materials',
  'programs.compile-submit',
  'surface-detail.textures',
  'weather.materials',
  'landmarks.impact-site',
  'world.settle-state',
  'textures.scene',
  'vfx.atlas',
  'vfx.weapon-skins',
  'vfx.ability-primitives',
  'sky.nearby-biomes',
  'world.initial-frame',
  'programs.compile',
  'programs.budget-variants',
  'sky.current-zone',
  'render.settle-passes',
  'diagnostics.baseline',
];

/** The renderer's manifest entries parsed from source: id, and whether the
 *  literal carries required / deadlineExempt properties. */
function parsedManifestEntries(): { id: string; required: boolean; deadlineExempt: boolean }[] {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const start = renderer.indexOf('const manifest: PrewarmManifestEntry[] = [');
  const end = renderer.indexOf('const byId = new Map(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const slice = renderer.slice(start, end);
  const blocks = slice.split(/\n {6}\{\n/).slice(1);
  return blocks.map((block) => {
    const id = /id: '([^']+)'/.exec(block)?.[1];
    expect(id).toBeTruthy();
    // The VALUE matters, not the property's presence: a literal
    // `deadlineExempt: false` is exactly the deferrable-required bug the
    // downstream invariant hunts.
    const exemptLiteral = /deadlineExempt: ([^,\n]+)/.exec(block)?.[1]?.trim();
    return {
      id: id as string,
      required: block.includes('required: true'),
      deadlineExempt: exemptLiteral !== undefined && exemptLiteral !== 'false',
    };
  });
}

describe('resolvePrewarmPolicy: unconstrained desktop', () => {
  it('runs the full manifest with generous budgets and no reordering', () => {
    const p = resolvePrewarmPolicy(BASE);
    expect(p.minimalManifest).toBe(false);
    expect(p.maxMs).toBe(12000);
    expect(p.compileMaxMs).toBe(10000);
    expect(p.maxViews).toBe(72);
    expect(p.yieldBetweenEntries).toBe(false);
    expect(p.linkPassPerEntry).toBe(false);
    expect(p.compileBeforeFirstFrame).toBe(true);
    expect(p.skipMonolithCompile).toBe(false);
    expect(p.skipFullScenePasses).toBe(false);
    expect(p.finishFullManifestBeforeReveal).toBe(false);
  });

  it('keeps the complete desktop Insane manifest behind the entry cover', () => {
    const p = resolvePrewarmPolicy({ ...BASE, finishFullManifestBeforeReveal: true });
    expect(p.finishFullManifestBeforeReveal).toBe(true);

    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(renderer).toContain(
      "finishFullManifestBeforeReveal: GFX.tier === 'insane' && !GFX.constrainedMemory",
    );
    expect(renderer).toContain(
      'const buildDeadline = prewarmBuildDeadline(\n      deadline,\n      hardDeadline,\n      PREWARM_BUILD_RESERVE_MS,\n      policy.finishFullManifestBeforeReveal,\n    );',
    );
    expect(renderer).toContain(
      'prewarmEntryShouldDefer(\n          entryStarted,\n          deadline,\n          hardDeadline,\n          entry.deadlineExempt ?? false,\n          policy.finishFullManifestBeforeReveal,\n        )',
    );
    expect(renderer).toContain(
      'this.createPersistentPortalViews(\n            createdViewTypes,\n            buildDeadline,',
    );
    expect(renderer).toContain(
      'this.createCandidateViews(\n            remainingPrewarmViewBudget(policy.maxViews, createdViews),\n            createdViewTypes,\n            buildDeadline,',
    );
  });

  it('never defers full-manifest entries and does not trim their archetype build', () => {
    expect(prewarmEntryShouldDefer(12_000, 12_000, 15_000, false, true)).toBe(false);
    expect(prewarmEntryShouldDefer(14_999, 12_000, 15_000, false, true)).toBe(false);
    expect(prewarmEntryShouldDefer(15_000, 12_000, 15_000, false, true)).toBe(true);
    expect(prewarmBuildDeadline(12_000, 15_000, 3_000, true)).toBe(15_000);
  });

  it('keeps the ordinary soft deadline and explicit exemption behavior', () => {
    expect(prewarmEntryShouldDefer(11_999, 12_000, 15_000, false, false)).toBe(false);
    expect(prewarmEntryShouldDefer(12_000, 12_000, 15_000, false, false)).toBe(true);
    expect(prewarmEntryShouldDefer(12_000, 12_000, 15_000, true, false)).toBe(false);
    expect(prewarmEntryShouldDefer(15_000, 12_000, 15_000, true, false)).toBe(true);
    expect(prewarmBuildDeadline(12_000, 15_000, 3_000, false)).toBe(9_000);
  });

  it('uses the low view cap on the low tier', () => {
    expect(resolvePrewarmPolicy({ ...BASE, lowGfx: true }).maxViews).toBe(48);
  });

  it('keeps the full manifest and compiles before the first full-scene frame', () => {
    const p = resolvePrewarmPolicy(BASE);
    const ordered = orderedPrewarmIds(MANIFEST_IDS, p);
    const frameIdx = ordered.indexOf('world.initial-frame');
    expect(ordered.indexOf('programs.compile')).toBe(frameIdx - 1);
    expect(new Set(ordered)).toEqual(new Set(MANIFEST_IDS));
    for (const id of MANIFEST_IDS) expect(prewarmEntryRuns(id, p)).toBe(true);
  });

  it('omits uninterruptible whole-scene submits without parallel compile', () => {
    const p = resolvePrewarmPolicy({ ...BASE, asyncCompileSupported: false });
    expect(p.compileBeforeFirstFrame).toBe(false);
    expect(p.skipMonolithCompile).toBe(true);
    expect(p.skipFullScenePasses).toBe(true);
    expect(p.linkPassPerEntry).toBe(false);
    for (const id of BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE) {
      expect(prewarmEntryRuns(id, p)).toBe(false);
    }
    expect(prewarmEntryRuns('textures.scene', p)).toBe(true);
  });

  it('matches the renderer real manifest order', () => {
    expect(parsedManifestEntries().map((entry) => entry.id)).toEqual(MANIFEST_IDS);
  });

  it('submits compiles early and awaits every submitted unit at the compile entry', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const compileEntryAt = renderer.indexOf("id: 'programs.compile',");
    const nextEntryAt = renderer.indexOf("id: 'programs.budget-variants'", compileEntryAt);
    const compileEntry = renderer.slice(compileEntryAt, nextEntryAt);
    expect(compileEntryAt).toBeGreaterThan(-1);
    expect(nextEntryAt).toBeGreaterThan(compileEntryAt);
    // Early-submission shape: units are SUBMITTED as their groups become
    // available (the programs.compile-submit entry, placed before the heavy
    // texture-upload entries) so the driver links off-thread underneath them,
    // and the compile entry awaits EVERY submitted unit so all of their
    // programs are READY before world.initial-frame renders; a program still
    // linking by then links synchronously inside that frame instead, the
    // measured first-draw stall class.
    const submitEntryAt = renderer.indexOf("id: 'programs.compile-submit',");
    expect(submitEntryAt).toBeGreaterThan(-1);
    expect(submitEntryAt).toBeLessThan(renderer.indexOf("id: 'surface-detail.textures'"));
    expect(compileEntry).toContain('await submitCompileUnits(true)');
    // The await-all is bounded (see the dedicated reserve test below), so the
    // literal Promise.all is no longer the awaited expression directly; it is
    // captured and raced against the reserved deadline.
    expect(compileEntry).toContain('const awaitAll = Promise.all(\n');
    expect(compileEntry).toContain('submittedCompileUnits.map((unit) =>');
    expect(compileEntry).toContain('unit.done.then(() => {');
    expect(compileEntry).not.toContain('performance.now() >= gpuSubmitDeadline');
    // Which groups a submission collects and marks is the pure
    // planCompileSubmission; the renderer must route BOTH calls through it
    // with a per-call existence read and the shared dedupe store.
    expect(renderer).toContain('const plan = planCompileSubmission({');
    expect(renderer).toContain("{ id: 'scene', exists: true },");
    expect(renderer).toContain(
      '...stagedCompileGroupsNow().map(([id, group]) => ({ id, exists: group !== null })),',
    );
    expect(renderer).toContain('sharedDedupe: compileDedupe,');
    expect(renderer).toContain('await submitCompileUnits(false)');
  });

  it('reserves await-all room so the initial frame always starts before the hard deadline', () => {
    // The regression (PR 3233 review): programs.compile deleted the old
    // per-unit deadline check and awaited every submitted unit completely
    // unbounded. A pathological driver link tail (no shader disk cache, a
    // serialized linker) that pushed the await past the hard deadline meant
    // prewarmEntryShouldDefer then deferred world.initial-frame itself (it
    // defers ANY entry, even a deadlineExempt one, once entryStartedMs
    // reaches hardDeadlineMs), so the guaranteed behind-the-cover first
    // frame never rendered and the whole scene linked synchronously at
    // first LIVE draw instead.
    expect(prewarmCompileAwaitDeadline(14_000, 2_000)).toBe(12_000);
    // A nonsensical negative reserve never extends the wait past the hard deadline.
    expect(prewarmCompileAwaitDeadline(14_000, -500)).toBe(14_000);

    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    // The cap is derived from the SAME hardDeadline value prewarmEntryShouldDefer
    // sees, not a fresh or looser value.
    expect(renderer).toContain(
      'const compileAwaitDeadline = prewarmCompileAwaitDeadline(\n' +
        '      hardDeadline,\n' +
        '      PREWARM_COMPILE_AWAIT_RESERVE_MS,\n' +
        '    );',
    );
    const compileEntryAt = renderer.indexOf("id: 'programs.compile',");
    const nextEntryAt = renderer.indexOf("id: 'programs.budget-variants'", compileEntryAt);
    const compileEntry = renderer.slice(compileEntryAt, nextEntryAt);
    expect(compileEntryAt).toBeGreaterThan(-1);
    expect(nextEntryAt).toBeGreaterThan(compileEntryAt);
    // The await-all races against the reserved cap; on a lost race the code
    // stops awaiting but never resubmits (compileAsync is already in flight,
    // and every submitted unit's own .then keeps counting as it settles).
    expect(compileEntry).toContain(
      'const budgetMs = Math.max(0, compileAwaitDeadline - performance.now());',
    );
    expect(compileEntry).toContain('const outcome = await Promise.race([');
    expect(compileEntry).toContain("awaitAll.then(() => 'settled' as const)");
    expect(compileEntry).toContain("sleep(budgetMs).then(() => 'timeout' as const)");
    expect(compileEntry).toContain("if (outcome === 'timeout') compileTimedOut = true;");
  });

  it('plans compile submissions so a not-yet-staged group is never lost', () => {
    const submitted = new Set<string>();
    const late = new Set(['weapon-vfx']);
    const recollect = new Set(['scene']);
    // Early entry (priority 46): landmark stages at 48 and weapon-vfx at 61,
    // so neither exists yet; scene always exists.
    const early = planCompileSubmission({
      groups: [
        { id: 'scene', exists: true },
        { id: 'mobs', exists: true },
        { id: 'landmark', exists: false },
        { id: 'weapon-vfx', exists: false },
      ],
      submitted,
      late,
      recollect,
      includeLate: false,
    });
    expect(early.collect).toEqual(['scene', 'mobs']);
    // The regression this pins (found in review): a group with no staged
    // THREE.Group yet must NOT be marked as covered, or every later
    // submission skips it forever and its programs link synchronously inside
    // world.initial-frame. And the live scene is never marked: it keeps
    // growing until world.settle-state, so the compile entry re-collects it.
    expect(early.mark).toEqual(['mobs']);
    for (const id of early.mark) submitted.add(id);
    const tail = planCompileSubmission({
      groups: [
        { id: 'scene', exists: true },
        { id: 'mobs', exists: true },
        { id: 'landmark', exists: true },
        { id: 'weapon-vfx', exists: true },
      ],
      submitted,
      late,
      recollect,
      includeLate: true,
    });
    expect(tail.collect).toEqual(['scene', 'landmark', 'weapon-vfx']);
    expect(tail.mark).toEqual(['landmark', 'weapon-vfx']);
  });

  it('leaves no required entry deferrable downstream of the exempt compile', () => {
    // The regression class that dropped world.initial-frame: every entry
    // ordered at or after programs.compile (which may lawfully consume the
    // whole soft budget) must carry a deadlineExempt property, or a slow
    // compile silently cancels a required entry. This would have caught the
    // granularity regression that pushed elapsed past the soft deadline.
    const entries = parsedManifestEntries();
    const ordered = orderedPrewarmIds(
      entries.map((entry) => entry.id),
      resolvePrewarmPolicy(BASE),
    );
    const compileAt = ordered.indexOf('programs.compile');
    expect(compileAt).toBeGreaterThan(-1);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of ordered.slice(compileAt)) {
      const entry = byId.get(id);
      expect(entry).toBeTruthy();
      if (entry?.required) {
        expect(entry.deadlineExempt, `required entry ${id} is deferrable`).toBe(true);
      }
    }
  });

  it('encodes program-content keys exactly as fine as three program cache key', () => {
    // The residue probe named the cost of a coarser key: 28 instanced-prop
    // colour programs plus 3 instanced depth ones relinked at draw time over
    // a missing instanceColor bit, and 4 more over morph COUNTS collapsed to
    // a boolean. A dedupe key must distinguish every bit three keys on.
    const base = { isSkinnedMesh: false, isInstancedMesh: true, castShadow: true };
    const plain = prewarmProgramContentKeys({ ...base, hasInstanceColor: false }, ['mat-1']);
    const colored = prewarmProgramContentKeys({ ...base, hasInstanceColor: true }, ['mat-1']);
    expect(plain).toHaveLength(1);
    expect(plain).not.toEqual(colored);

    const morphs2 = prewarmProgramContentKeys({ morphTargetCount: 2 }, ['mat-1']);
    const morphs6 = prewarmProgramContentKeys({ morphTargetCount: 6 }, ['mat-1']);
    expect(morphs2).not.toEqual(morphs6);
    expect(prewarmProgramContentKeys({ morphTargetCount: 2 }, ['mat-1'])).toEqual(morphs2);

    // Presence vs absence: three defines USE_MORPHTARGETS on the position
    // attribute's PRESENCE, so present-with-zero and absent are distinct.
    expect(
      prewarmProgramContentKeys({ hasMorphPositions: true, morphTargetCount: 0 }, ['mat-1']),
    ).not.toEqual(prewarmProgramContentKeys({ hasMorphPositions: false }, ['mat-1']));

    // Every remaining object/geometry cache-key bit is its own dimension:
    // morph normal and colour counts, tangents, vertex colour item size
    // (4 flips vertexAlphas), batched meshes.
    const flat = prewarmProgramContentKeys({}, ['mat-1']);
    expect(prewarmProgramContentKeys({ morphNormalCount: 2 }, ['mat-1'])).not.toEqual(flat);
    expect(prewarmProgramContentKeys({ morphColorCount: 1 }, ['mat-1'])).not.toEqual(flat);
    expect(prewarmProgramContentKeys({ hasTangents: true }, ['mat-1'])).not.toEqual(flat);
    expect(prewarmProgramContentKeys({ vertexColorItemSize: 3 }, ['mat-1'])).not.toEqual(
      prewarmProgramContentKeys({ vertexColorItemSize: 4 }, ['mat-1']),
    );
    expect(prewarmProgramContentKeys({ isBatchedMesh: true }, ['mat-1'])).not.toEqual(flat);

    // Per-material keys: a two-material mesh contributes one key per slot.
    expect(prewarmProgramContentKeys({}, ['mat-1', 'mat-2'])).toHaveLength(2);
    // Different material, same shape: distinct keys.
    expect(prewarmProgramContentKeys({}, ['mat-1'])).not.toEqual(
      prewarmProgramContentKeys({}, ['mat-2']),
    );
  });

  it('folds materials that share a program into one signature, and splits real variants', () => {
    // Distinct GLB materials by the hundred link the SAME program; keying the
    // dedupe on uuid kept ~2,725 roots for ~500 unique programs and the mass
    // submission paid ~5,450 compileAsync prologues (a measured 12.4 s). Two
    // materials with identical program-relevant state must collapse.
    const stone = { type: 'MeshStandardMaterial', map: {}, transparent: false };
    const stoneCopy = { type: 'MeshStandardMaterial', map: {}, transparent: false };
    expect(materialProgramSignature(stone)).toBe(materialProgramSignature(stoneCopy));

    // Every program-relevant dimension splits: map presence, transparency,
    // alpha test, vertex colors, side, type, and the shader-hook identity
    // (three keys programs on customProgramCacheKey, whose default is the
    // onBeforeCompile source).
    expect(materialProgramSignature({ ...stone, map: undefined })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(materialProgramSignature({ ...stone, transparent: true })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(materialProgramSignature({ ...stone, alphaTest: 0.5 })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(materialProgramSignature({ ...stone, vertexColors: true })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(materialProgramSignature({ ...stone, side: 2 })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(materialProgramSignature({ ...stone, type: 'MeshLambertMaterial' })).not.toBe(
      materialProgramSignature(stone),
    );
    expect(
      materialProgramSignature({ ...stone, customProgramCacheKey: () => 'rim-glow' }),
    ).not.toBe(materialProgramSignature(stone));
    // Same hook identity collapses again.
    expect(materialProgramSignature({ ...stone, customProgramCacheKey: () => 'rim-glow' })).toBe(
      materialProgramSignature({ ...stone, customProgramCacheKey: () => 'rim-glow' }),
    );
  });

  it('wires the compile dedupe and the widened shadow arm to the measured residue', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    // The dedupe key comes from the shared pure helper, never a hand-rolled
    // string that can drift from three's cache key again.
    expect(renderer).toContain('prewarmProgramContentKeys(');
    expect(renderer).toContain('hasInstanceColor: ');
    expect(renderer).toContain('morphTargetCount: ');
    // The prewarm depth material must match the REAL shadow pass variant:
    // three's shadow depth material uses RGBADepthPacking and depthPacking is
    // in the program cache key, so omitting it links a dead variant (the
    // pre-existing defect the residue probe exposed: every skinned-shadow
    // compile linked BasicDepthPacking, and the frame relinked all of them).
    expect(renderer).toContain('depthPacking: THREE.RGBADepthPacking');
    // The shadow arm covers every caster, not just skinned rigs: static and
    // instanced casters' depth programs were 12 of the frame's 64 residual
    // links.
    const shadowStart = renderer.indexOf('private async compileShadowPrograms(');
    const shadowEnd = renderer.indexOf('\n  // A tiny throwaway target', shadowStart);
    expect(shadowStart).toBeGreaterThan(-1);
    expect(shadowEnd).toBeGreaterThan(shadowStart);
    const shadowMethod = renderer.slice(shadowStart, shadowEnd);
    expect(shadowMethod).toContain('if (!mesh.isMesh || !mesh.castShadow) return;');
    expect(shadowMethod).not.toContain('if (!mesh.isSkinnedMesh || !mesh.castShadow) return;');
  });

  it('keeps the required desktop compiler behind the loading cover after a slow first frame', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const compileEntryAt = renderer.indexOf("id: 'programs.compile'");
    const nextEntryAt = renderer.indexOf("id: 'sky.current-zone'", compileEntryAt);
    const compileEntry = renderer.slice(compileEntryAt, nextEntryAt);

    expect(compileEntryAt).toBeGreaterThan(-1);
    expect(nextEntryAt).toBeGreaterThan(compileEntryAt);
    expect(compileEntry).toContain(
      'deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported',
    );
  });
});

it('restores prewarm state after both successful and failed variant work', async () => {
  let state = { level: 1, marker: 'original' };
  const capture = () => ({ ...state });
  const restore = (snapshot: typeof state) => {
    state = snapshot;
  };

  await withRestoredPrewarmState(capture, restore, async () => {
    state = { level: 0.5, marker: 'temporary' };
  });
  expect(state).toEqual({ level: 1, marker: 'original' });

  await expect(
    withRestoredPrewarmState(capture, restore, async () => {
      state = { level: 0.25, marker: 'failed' };
      throw new Error('compile failed');
    }),
  ).rejects.toThrow('compile failed');
  expect(state).toEqual({ level: 1, marker: 'original' });
});
it('prewarms adaptive quality shader variants behind the desktop loading cover', () => {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const entryAt = renderer.indexOf("id: 'programs.budget-variants'");
  const nextEntryAt = renderer.indexOf("id: 'sky.current-zone'", entryAt);
  const entry = renderer.slice(entryAt, nextEntryAt);

  expect(entryAt).toBeGreaterThan(-1);
  expect(nextEntryAt).toBeGreaterThan(entryAt);
  expect(entry).toContain('renderBudgetShaderPrewarmLevels(originalState)');
  expect(entry).toContain('this.renderPrewarmPass(1 / 60)');
  expect(entry).toContain('renderPasses++');
  expect(entry).toContain('performance.now() >= gpuSubmitDeadline');
  expect(entry).toContain('withRestoredPrewarmState(');
  expect(entry).not.toContain('compilePrewarmColorPrograms(this.scene');
  expect(entry).toContain('deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported');
});
it('settles linked desktop programs only until the independent hard deadline', () => {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  for (const [id, nextId] of [
    ['sky.current-zone', 'render.settle-passes'],
    ['render.settle-passes', 'diagnostics.baseline'],
  ] as const) {
    const entryAt = renderer.indexOf(`id: '${id}'`);
    const nextEntryAt = renderer.indexOf(`id: '${nextId}'`, entryAt);
    const entry = renderer.slice(entryAt, nextEntryAt);
    expect(entryAt).toBeGreaterThan(-1);
    expect(nextEntryAt).toBeGreaterThan(entryAt);
    expect(entry).toContain('deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported');
    expect(entry).toContain('gpuSubmitDeadline');
    expect(entry).not.toContain('finishBehindCover');
  }
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
    expect(p.finishFullManifestBeforeReveal).toBe(false);
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
    expect(prewarmEntryRuns('sky.nearby-biomes', p)).toBe(false);
  });

  it('initializes scene textures in bounded batches', () => {
    expect(p.textureBatchSize).toBe(4);
    expect(p.textureMaxMs).toBe(1200);
  });

  it('wires the two-view constrained cap into the renderer', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(renderer).toContain('const VIEW_PREWARM_MAX_VIEWS_CONSTRAINED = 2;');
    expect(renderer).toContain('remainingPrewarmViewBudget(policy.maxViews, createdViews)');
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

describe('one trim rule for every entry on the shared view budget', () => {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('marks the persistent-portal scan trimmed on the cap arm, like the candidate scan', () => {
    // The reported inconsistency: the two capped scans drew on the same
    // remainingPrewarmViewBudget yet only createCandidateViews marked the cap
    // arm trimmed, so a boot that exhausted the shared budget reported one of
    // them partial and the other completed. The unified rule: either stop
    // with work remaining is a trim.
    const portalStart = renderer.indexOf('private createPersistentPortalViews(');
    const portalEnd = renderer.indexOf('\n  private createCandidateViews(', portalStart);
    const candidateEnd = renderer.indexOf('\n  private createCharacterVisualWithRetry(', portalEnd);
    expect(portalStart).toBeGreaterThan(-1);
    expect(portalEnd).toBeGreaterThan(portalStart);
    expect(candidateEnd).toBeGreaterThan(portalEnd);
    const portal = renderer.slice(portalStart, portalEnd);
    const candidate = renderer.slice(portalEnd, candidateEnd);
    const trimArm = (guard: string): string =>
      `${guard} {\n        trimmed = true;\n        break;\n      }`;
    expect(portal).toContain(trimArm('if (created >= limit)'));
    // The regression shape: the cap arm silently breaking untrimmed.
    expect(portal).not.toContain('if (created >= limit) break;');
    expect(candidate).toContain(trimArm('if (created >= max)'));
  });

  it('gives all four budget-sharing entries an explicit progress hook', () => {
    // views.required and views.landmarks bypass the cap by design (required
    // views must exist for entry), so their hooks honestly report trimmed:
    // false; the capped portal and nearby scans report their live trim flags.
    const block = (id: string, nextId: string): string => {
      const start = renderer.indexOf(`id: '${id}'`);
      const end = renderer.indexOf(`id: '${nextId}'`, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return renderer.slice(start, end);
    };
    expect(block('views.required', 'views.landmarks')).toContain(
      'progress: () => ({ done: requiredViewsCreated, trimmed: false })',
    );
    const landmarks = block('views.landmarks', 'views.persistent-portals');
    expect(landmarks).toContain('done: mandatoryLandmarkIds.length');
    expect(landmarks).toContain('trimmed: false');
    expect(block('views.persistent-portals', 'views.nearby')).toContain(
      'progress: () => ({ trimmed: portalViewsTrimmed })',
    );
    expect(block('views.nearby', 'props.dungeon-doors')).toContain('trimmed: nearbyViewsTrimmed');
  });

  it('a cap-trimmed entry without counts is partial, the portal hook shape', () => {
    expect(resolvePrewarmEntryStatus({ trimmed: true })).toBe('partial');
  });
});

describe('archetype and scene-texture progress hooks stay honest (review round 2)', () => {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const block = (id: string, nextId: string): string => {
    const start = renderer.indexOf(`id: '${id}'`);
    const end = renderer.indexOf(`id: '${nextId}'`, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return renderer.slice(start, end);
  };

  it('derives the player-archetype trim from the build shortfall, not the deadline alone', () => {
    // Skipped builds (createCharacterVisual returning null on unavailable
    // assets) leave planned rigs unwarmed without touching the loop-exit trim
    // flag. Planned is exact for this entry, so done reaching planned is what
    // completed must mean; resolvePrewarmEntryStatus (pinned in the
    // completed-lie block below) then downgrades the shortfall to partial.
    expect(block('entities.player-archetypes', 'entities.mob-archetypes')).toContain(
      'trimmed: built.trimmed || built.visualCount < built.plannedVisuals',
    );
  });

  it('gives the npc-archetype entry the same derived-trimmed rule with matching units', () => {
    const entry = block('entities.npc-archetypes', 'objects.quest-archetypes');
    expect(entry).toContain('done: built.warmed');
    expect(entry).toContain('trimmed: built.trimmed || built.warmed < built.planned');
  });

  it('counts an npc id done only when its model ends warm, never on an asset skip', () => {
    const builderStart = renderer.indexOf('private buildNpcPrewarmGroup(');
    const builderEnd = renderer.indexOf('private buildPlayerPrewarmGroup(', builderStart);
    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    const builder = renderer.slice(builderStart, builderEnd);
    // The old shape counted ids examined before any skip, so a loop that
    // built nothing still reported full work.
    expect(builder).not.toContain('processed');
    const visualAt = builder.indexOf('const visual = createCharacterVisual(entity)');
    const skipAt = builder.indexOf('if (!visual) continue', visualAt);
    const markWarmAt = builder.indexOf('this.prewarmedNpcModels.add(modelKey)', skipAt);
    const builtCountAt = builder.indexOf('warmed++', markWarmAt);
    expect(visualAt).toBeGreaterThan(-1);
    // The asset-unavailable skip leaves the id uncounted...
    expect(skipAt).toBeGreaterThan(visualAt);
    expect(markWarmAt).toBeGreaterThan(skipAt);
    // ...and a built visual counts only after its model is marked warm.
    expect(builtCountAt).toBeGreaterThan(markWarmAt);
  });

  it('reports scene textures in matching units: initialized done against examined planned', () => {
    const entry = block('textures.scene', 'vfx.atlas');
    expect(entry).toContain('done: batched.initialized');
    expect(entry).toContain('planned: batched.planned');
    // The regression shape: workDone as a GPU-residency delta an
    // already-resident texture never moves, mismatched against a planned that
    // counts every texture examined. The delta stays in detail(), labeled.
    expect(entry).not.toContain('done: batched.uploaded');
    expect(entry).toContain('uploadedDelta=${textureUploads}');
  });

  it('the portal entry details its own created count beside the labeled cumulative counter', () => {
    const entry = block('views.persistent-portals', 'views.nearby');
    expect(entry).toContain('portalViewsCreated = result.created');
    expect(entry).toContain('created=${portalViewsCreated};cumulativeViews=${createdViews}');
  });
});

describe('resolvePrewarmPolicy: constrained WITHOUT parallel compile', () => {
  const p = resolvePrewarmPolicy({
    ...BASE,
    constrainedMemory: true,
    asyncCompileSupported: false,
  });

  it('skips every uninterruptible full-scene submit', () => {
    expect(p.linkPassPerEntry).toBe(false);
    expect(p.skipMonolithCompile).toBe(true);
    expect(p.skipFullScenePasses).toBe(true);
    // No reorder: without off-thread compile there is nothing to front-load.
    expect(p.compileBeforeFirstFrame).toBe(false);
    expect(orderedPrewarmIds(MANIFEST_IDS, p)).toEqual(MANIFEST_IDS);
    for (const id of BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE) {
      expect(prewarmEntryRuns(id, p)).toBe(false);
    }
  });
});

describe('the keep-list is the minimal entry set', () => {
  it('contains exactly the entries needed to enter without a first-frame stall', () => {
    expect([...CONSTRAINED_PREWARM_KEEP].sort()).toEqual(
      [
        'programs.compile',
        'render.settle-passes',
        'textures.scene',
        'views.landmarks',
        'views.nearby',
        'views.persistent-portals',
        'views.required',
        // The pre-collection world-state update: without it, textures.scene
        // and the compile units collect a visibility state the initial frame
        // does not draw, and the frame pays the difference synchronously.
        'world.settle-state',
        'world.initial-frame',
      ].sort(),
    );
  });
});

describe('constrained skips that still resume in the background', () => {
  const constrained = resolvePrewarmPolicy({ ...BASE, constrainedMemory: true });
  const desktop = resolvePrewarmPolicy(BASE);

  it('skips the ability-VFX warm-up at entry but keeps its units', () => {
    // Both halves matter: skipping keeps the entry window short, resuming is
    // what stops the six impact sheets from being drawn on the first spell
    // impact of each school, i.e. mid-combat.
    expect(prewarmEntryRuns('vfx.ability-primitives', constrained)).toBe(false);
    expect(prewarmEntryResumesAfterSkip('vfx.ability-primitives', constrained)).toBe(true);
  });

  it('never resumes an entry skipped for its GPU footprint', () => {
    for (const id of [
      'entities.mob-archetypes',
      'entities.npc-archetypes',
      'sky.nearby-biomes',
      'surface-detail.textures',
      'vfx.atlas',
    ]) {
      expect(prewarmEntryRuns(id, constrained)).toBe(false);
      expect(prewarmEntryResumesAfterSkip(id, constrained)).toBe(false);
    }
  });

  it('is inert on the desktop manifest, which runs the entry outright', () => {
    expect(prewarmEntryRuns('vfx.ability-primitives', desktop)).toBe(true);
    expect(prewarmEntryResumesAfterSkip('vfx.ability-primitives', desktop)).toBe(false);
  });

  it('keeps the resume list disjoint from the keep-list', () => {
    expect(CONSTRAINED_PREWARM_RESUME.length).toBeGreaterThan(0);
    for (const id of CONSTRAINED_PREWARM_RESUME) {
      expect(CONSTRAINED_PREWARM_KEEP).not.toContain(id);
    }
  });
});

describe('mandatory interaction-landmark prewarm', () => {
  const entities = [
    { id: 10, kind: 'npc', templateId: 'flight_master', pos: { x: 3, z: -2 } },
    { id: 20, kind: 'object', templateId: 'mailbox', pos: { x: 0, z: -7.5 } },
    {
      id: 30,
      kind: 'object',
      templateId: 'noticeboard_eastbrook',
      pos: { x: 10, z: -8 },
    },
    { id: 40, kind: 'object', templateId: 'dungeon_door', pos: { x: 75, z: 75 } },
  ];

  it('selects the spawn mailbox ahead of nearby NPCs and a remote persistent portal', () => {
    const partition = partitionMandatoryLandmarkCandidates(entities, { x: 2, z: -2 });
    expect(partition.mandatory.map((entity) => entity.id)).toEqual([20]);
    expect([...partition.mandatory, ...partition.ordinary].map((entity) => entity.id)).toEqual([
      20, 10, 30, 40,
    ]);
  });

  it('selects only the noticeboard from a board-adjacent entry position', () => {
    const partition = partitionMandatoryLandmarkCandidates(entities, { x: 10, z: -6 });
    expect(partition.mandatory.map((entity) => entity.id)).toEqual([30]);
  });

  it('selects both landmarks when their authored interaction radii overlap', () => {
    const partition = partitionMandatoryLandmarkCandidates(entities, { x: 6.5, z: -8 });
    expect(partition.mandatory.map((entity) => entity.id)).toEqual([20, 30]);
  });

  it('excludes landmarks outside their authored mailbox 7 and noticeboard 4 radii', () => {
    const partition = partitionMandatoryLandmarkCandidates(entities, { x: 100, z: 100 });
    expect(partition.mandatory).toEqual([]);
    expect(partition.ordinary.map((entity) => entity.id)).toEqual([10, 20, 30, 40]);
  });

  it('streams nearby service landmarks before NPCs without promoting remote ones', () => {
    const nearSq = NEARBY_LANDMARK_STREAM_RADIUS * NEARBY_LANDMARK_STREAM_RADIUS;
    expect(interactionLandmarkViewPriority('mailbox', nearSq)).toBe(0.5);
    expect(interactionLandmarkViewPriority('noticeboard_eastbrook', nearSq + 1)).toBe(1.5);
    expect(interactionLandmarkViewPriority('ore_iron', 0)).toBeNull();
    expect(interactionLandmarkViewPriority(null, 0)).toBeNull();
  });

  it('does not report ready while any mandatory view is absent or compile-pending', () => {
    const requiredIds = [20, 30];
    expect(
      mandatoryLandmarkViewsReady(requiredIds, new Map([[20, { compilePending: false }]])),
    ).toBe(false);
    expect(
      mandatoryLandmarkViewsReady(
        requiredIds,
        new Map([
          [20, { compilePending: false }],
          [30, { compilePending: true }],
        ]),
      ),
    ).toBe(false);
    expect(
      mandatoryLandmarkViewsReady(
        requiredIds,
        new Map([
          [20, { compilePending: false }],
          [30, { compilePending: false }],
        ]),
      ),
    ).toBe(true);
  });

  it('runs the bounded landmark step before persistent portals and generic candidates', () => {
    const policy = resolvePrewarmPolicy({
      ...BASE,
      constrainedMemory: true,
      asyncCompileSupported: true,
    });
    const ordered = orderedPrewarmIds(MANIFEST_IDS, policy).filter((id) =>
      prewarmEntryRuns(id, policy),
    );
    expect(ordered.indexOf('views.landmarks')).toBeLessThan(
      ordered.indexOf('views.persistent-portals'),
    );
    expect(ordered.indexOf('views.landmarks')).toBeLessThan(ordered.indexOf('views.nearby'));

    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const landmarkEntryAt = renderer.indexOf("id: 'views.landmarks'");
    const portalEntryAt = renderer.indexOf("id: 'views.persistent-portals'");
    const nearbyEntryAt = renderer.indexOf("id: 'views.nearby'");
    expect(landmarkEntryAt).toBeGreaterThan(-1);
    expect(portalEntryAt).toBeGreaterThan(landmarkEntryAt);
    expect(nearbyEntryAt).toBeGreaterThan(portalEntryAt);
    expect(renderer.slice(landmarkEntryAt, portalEntryAt)).toContain('deadlineExempt: true');

    const helperStart = renderer.indexOf('private async createMandatoryLandmarkViews(');
    const helperEnd = renderer.indexOf('\n  private createPersistentPortalViews(', helperStart);
    const helper = renderer.slice(helperStart, helperEnd);
    const partitionAt = helper.indexOf('partitionMandatoryLandmarkCandidates(');
    const createAt = helper.indexOf('this.createView(entity)');
    const compileWaitAt = helper.indexOf('await Promise.all(compileWaits)');
    const readinessAt = helper.indexOf('mandatoryLandmarkViewsReady(ids, this.views)');
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(partitionAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(partitionAt);
    expect(compileWaitAt).toBeGreaterThan(createAt);
    expect(readinessAt).toBeGreaterThan(compileWaitAt);
    expect(helper).not.toContain('remainingPrewarmViewBudget');
  });

  it('serializes parallel compile readiness and makes the no-parallel path immediate', () => {
    // #2571 commit 2 extracted the compile wait that used to be inline here
    // into a shared coordinator (compileGate delegating to CompileGateQueue, see
    // src/render/compile_gate.ts) so gateSwapOnCompile/gateSwapFlagOnCompile
    // could reuse it instead of duplicating it. gateViewOnCompile itself still
    // owns the unsupported-browser short-circuit and the compilePending
    // lifecycle; sequencing and timeout diagnostics now live one hop over.
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const gateStart = renderer.indexOf('private gateViewOnCompile(');
    const gateEnd = renderer.indexOf('\n  /** The visual the player currently sees', gateStart);
    const gate = renderer.slice(gateStart, gateEnd);
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);
    expect(gate).toContain('if (!this.asyncCompileSupported) return null;');
    expect(gate).toContain('this.compileGate(group)');
    expect(gate).toContain('view.compilePending = false;');
    expect(gate).toContain(
      'The canvas nameplate (name, target marker, health, and cast bar) keeps',
    );
    expect(gate).toContain('void this.compileGate(target).then(');
    expect(gate.match(/this\.recoverRejectedCompileGate\(/g)).toHaveLength(3);
    expect(gate).toContain('group.visible = priorVisibility;');
    expect(gate).toContain('this.recoverRejectedCompileGate(error, generation, onSettled);');
    expect(gate).not.toContain('onTimeout');

    const compileGateStart = renderer.indexOf('private compileGate(');
    const compileGateEnd = renderer.indexOf('private gateViewOnCompile(', compileGateStart);
    const compileGate = renderer.slice(compileGateStart, compileGateEnd);
    expect(compileGateStart).toBeGreaterThan(-1);
    expect(compileGateEnd).toBeGreaterThan(compileGateStart);
    expect(compileGate).toContain('this.liveCompileGates.run(');
    expect(compileGate).toContain('VIEW_COMPILE_GATE_MAX_MS');
    expect(compileGate).not.toContain('onTimeout');
    expect(renderer).toContain('return GPU_WORK_PRIORITY.ACTIONABLE_VIEW;');
    expect(renderer).toContain(
      'private readonly liveCompileGates = new CompileGateQueue(this.backgroundGpuWork)',
    );

    // The non-cancelling timeout and serial queue, plus dedicated coverage, now
    // live in the shared core: tests/compile_gate.test.ts drives its actual
    // behavior (waits past timeout, settles on compile/rejection, serializes
    // concurrent gates); this pin
    // only confirms the mechanics still exist in source, not duplicated back
    // into gateViewOnCompile.
    const core = readFileSync(new URL('../src/render/compile_gate.ts', import.meta.url), 'utf8');
    expect(core).toContain('export class CompileGateQueue');
    expect(core).toContain('timedOut = true;');
    expect(core).toContain(
      'return this.sharedQueue.run(work, options.priority, options.label, { releaseTail: true })',
    );
    expect(core).toContain('this.tail.then(work)');
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
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
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
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
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
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(renderer).not.toContain('ENTITY_VIEW_CREATE_RANGE_CONSTRAINED');
    expect(renderer).not.toContain('ENTITY_VIEW_DESTROY_RANGE_CONSTRAINED');
    expect(renderer).not.toContain('resolveRuntimeViewRangePolicy({');
    expect(renderer).toContain('private entityViewCreateRangeSq = ENTITY_VIEW_CREATE_RANGE_SQ;');
    expect(renderer).toContain('private entityViewDestroyRangeSq = ENTITY_VIEW_DESTROY_RANGE_SQ;');
    expect(renderer).not.toContain('options.submit');
    expect(renderer).not.toContain('postOverlayViewCreateBudget(');
  });
});

describe('boot prewarm ordering: the sky fetch never starves the compute stages', () => {
  const rendererSource = (): string =>
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8').replace(
      /\r\n/g,
      '\n',
    );

  it('declares the sky entry after the compute stages, just before the first frame', () => {
    // Budget-hungry compute stages come first; the sky entry joins just before
    // the first frame so inline uploads still land behind the loading screen.
    // (parsedManifestEntries pins MANIFEST_IDS === the real source order.)
    const skyIdx = MANIFEST_IDS.indexOf('sky.nearby-biomes');
    expect(skyIdx).toBeGreaterThan(MANIFEST_IDS.indexOf('entities.player-archetypes'));
    expect(skyIdx).toBeGreaterThan(MANIFEST_IDS.indexOf('vfx.ability-primitives'));
    expect(skyIdx).toBe(MANIFEST_IDS.indexOf('world.initial-frame') - 1);
  });

  it('async arm: programs.compile interposes between the sky entry and the first frame', () => {
    // Declaration order (above) is not the async-arm BOOT order:
    // compileBeforeFirstFrame moves programs.compile to just before
    // world.initial-frame, so the real order is the adjacency triple asserted
    // here, and the sky entry's bounded inline-wait reserve is what protects
    // compile RUN time.
    const ordered = orderedPrewarmIds(MANIFEST_IDS, resolvePrewarmPolicy(BASE));
    const skyIdx = ordered.indexOf('sky.nearby-biomes');
    expect(skyIdx).toBeGreaterThan(-1);
    expect(ordered[skyIdx + 1]).toBe('programs.compile');
    expect(ordered[skyIdx + 2]).toBe('world.initial-frame');
  });

  it('kicks the sky prefetch off before the manifest instead of awaiting it inline', () => {
    const source = rendererSource();
    const prefetchAt = source.indexOf('trackPrefetch(ensureSkyBiomeAssets(initialSkyBiomes))');
    const manifestAt = source.indexOf('const manifest: PrewarmManifestEntry[] = [');
    expect(prefetchAt).toBeGreaterThan(-1);
    expect(manifestAt).toBeGreaterThan(-1);
    expect(prefetchAt).toBeLessThan(manifestAt);
    // The starvation shape: a raw inline await of the fetch inside an entry.
    expect(source).not.toContain('await ensureSkyBiomeAssets(');
    // The entry waits only through the budget-bounded prefetch race.
    expect(source).toContain('await waitForPrefetch(skyAssetPrefetch, waitMs, sleep)');
    expect(source).toContain('reserveMs: PREWARM_BUILD_RESERVE_MS');
    // Constrained profiles skip the sky entry, so they must not fetch either.
    expect(source).toContain(
      "const skyAssetPrefetch = prewarmEntryRuns('sky.nearby-biomes', policy)",
    );
  });

  it('defers unfetched biomes to a dedicated lane, never the shared resume queue', () => {
    const source = rendererSource();
    // The lane gate skips two no-deferral cases: every biome already uploaded
    // inline (the pending arm marks the warm complete) and a prefetch that
    // already rejected (the entry, when it ran, reported failed; the lane
    // would log a deferral for work that can never run).
    const deferredLaneAt = source.indexOf(
      'if (skyAssetPrefetch && !skyWarmComplete && skyAssetPrefetch.rejection() === null) {',
    );
    const sharedResumeAt = source.indexOf('resumeDroppedPrewarmEntries(resume, {');
    expect(deferredLaneAt).toBeGreaterThan(-1);
    expect(sharedResumeAt).toBeGreaterThan(-1);
    expect(source).toContain('if (split.missing.length === 0) skyWarmComplete = true;');
    // The dedicated lane chains off the prefetch task itself and enters the
    // GPU queue only after the data is resident: a black-holed network can
    // wedge neither the resume lane nor a bounded released-tail slot.
    const lane = source.slice(deferredLaneAt, source.indexOf('const elapsed', deferredLaneAt));
    expect(lane).toContain('void skyAssetPrefetch.task');
    expect(lane).toContain('this.prewarmTextureInIdle(');
    expect(lane).not.toContain('droppedEntries.push');
    // The WHOLE lane runs at its stated lowest priority: both chunked texture
    // uploads thread BOOT_RESUME through prewarmTextureInIdle alongside the
    // PMREM unit, so the expensive dome upload never outranks the cheap PMREM.
    expect(lane.match(/GPU_WORK_PRIORITY\.BOOT_RESUME/g)).toHaveLength(3);
    expect(source).toContain('priority: number = GPU_WORK_PRIORITY.VISIBLE_PREWARM');
  });

  it('keeps the sky entry deadline-exempt so the dome upload stays behind the cover', () => {
    // At priority 64 the entry sits behind every build, texture, and VFX
    // stage, so without the exemption a long compute tail deadline-skips it
    // and the 2k RGBA16F dome upload (one indivisible call on pinned r165)
    // lands in the in-game lane. Exemption adds no network wait:
    // skyAssetInlineWaitMs returns 0 once the reserve boundary has passed,
    // and prewarmEntryShouldDefer still bounds the entry by the hard
    // deadline. Unconditional on purpose: constrained profiles never run the
    // entry, so the tail entries' conditional form has nothing to gate here.
    const source = rendererSource();
    const skyEntryAt = source.indexOf("id: 'sky.nearby-biomes'");
    const frameEntryAt = source.indexOf("id: 'world.initial-frame'", skyEntryAt);
    expect(skyEntryAt).toBeGreaterThan(-1);
    expect(frameEntryAt).toBeGreaterThan(skyEntryAt);
    expect(source.slice(skyEntryAt, frameEntryAt)).toContain('deadlineExempt: true');
    const parsed = parsedManifestEntries().find((entry) => entry.id === 'sky.nearby-biomes');
    expect(parsed?.deadlineExempt).toBe(true);
  });

  it('resolves every ran entry through the honest status gate', () => {
    const source = rendererSource();
    expect(source).toContain("if (status === 'completed') status = resolvePrewarmEntryStatus(");
  });
});

describe('skyAssetInlineWaitMs: the sky wait can never eat the tail reserve', () => {
  it('waits only up to deadline minus reserve', () => {
    expect(
      skyAssetInlineWaitMs({
        nowMs: 1_000,
        deadlineMs: 13_000,
        reserveMs: 3_000,
        finishFullManifestBeforeReveal: false,
      }),
    ).toBe(9_000);
  });

  it('returns zero once the reserve boundary has passed', () => {
    expect(
      skyAssetInlineWaitMs({
        nowMs: 11_000,
        deadlineMs: 13_000,
        reserveMs: 3_000,
        finishFullManifestBeforeReveal: false,
      }),
    ).toBe(0);
    expect(
      skyAssetInlineWaitMs({
        nowMs: 20_000,
        deadlineMs: 13_000,
        reserveMs: 3_000,
        finishFullManifestBeforeReveal: false,
      }),
    ).toBe(0);
  });

  it('property: the wait never extends past the reserve boundary', () => {
    for (const nowMs of [0, 2_500, 9_000, 9_999, 10_000, 12_000, 30_000]) {
      const waitMs = skyAssetInlineWaitMs({
        nowMs,
        deadlineMs: 13_000,
        reserveMs: 3_000,
        finishFullManifestBeforeReveal: false,
      });
      // Waiting can never push the clock past deadline - reserve; once the
      // boundary has passed the wait is zero.
      expect(waitMs).toBeLessThanOrEqual(Math.max(0, 13_000 - 3_000 - nowMs));
      expect(waitMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('desktop Insane (finish-full-manifest) waits without bound, as its contract requires', () => {
    expect(
      skyAssetInlineWaitMs({
        nowMs: 12_500,
        deadlineMs: 13_000,
        reserveMs: 3_000,
        finishFullManifestBeforeReveal: true,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('partitionResidentSkyBiomes', () => {
  it('splits by residency preserving order', () => {
    const resident = new Set(['vale', 'peaks']);
    expect(
      partitionResidentSkyBiomes(['vale', 'marsh', 'peaks', 'fen'], (b) => resident.has(b)),
    ).toEqual({ resident: ['vale', 'peaks'], missing: ['marsh', 'fen'] });
  });

  it('handles the all-resident and all-missing extremes', () => {
    expect(partitionResidentSkyBiomes(['vale'], () => true)).toEqual({
      resident: ['vale'],
      missing: [],
    });
    expect(partitionResidentSkyBiomes(['vale'], () => false)).toEqual({
      resident: [],
      missing: ['vale'],
    });
    expect(partitionResidentSkyBiomes([], () => true)).toEqual({ resident: [], missing: [] });
  });
});

describe('resolvePrewarmEntryStatus: the completed-lie stays dead', () => {
  it('a deadline-trimmed entry with zero work is partial, never completed', () => {
    // The original bug: entities.player-archetypes hit its build deadline with
    // ZERO visuals built and the summary still said completed. Restoring that
    // lie turns this red.
    const status = resolvePrewarmEntryStatus({ done: 0, planned: 118, trimmed: true });
    expect(status).toBe('partial');
    expect(status).not.toBe('completed');
  });

  it('a partially built entry is partial with its counts intact', () => {
    expect(resolvePrewarmEntryStatus({ done: 37, planned: 118, trimmed: true })).toBe('partial');
  });

  it('an untrimmed entry stays completed', () => {
    expect(resolvePrewarmEntryStatus({ done: 118, planned: 118, trimmed: false })).toBe(
      'completed',
    );
    expect(resolvePrewarmEntryStatus({ trimmed: false })).toBe('completed');
  });

  it('entries without progress tracking keep the historical completed status', () => {
    expect(resolvePrewarmEntryStatus(null)).toBe('completed');
    expect(resolvePrewarmEntryStatus(undefined)).toBe('completed');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE,
  CONSTRAINED_PREWARM_KEEP,
  CONSTRAINED_PREWARM_RESUME,
  compileGroupRunsBeforeInitialPaint,
  constrainedEntryViewCreateBudget,
  interactionLandmarkViewPriority,
  mandatoryLandmarkViewsReady,
  materialProgramSignature,
  NEARBY_LANDMARK_STREAM_RADIUS,
  NEARBY_VIEW_PREWARM_FLOOR,
  nearbyPrewarmViewBudget,
  orderedPrewarmIds,
  orderPrewarmResumeEntries,
  type PrewarmPolicyInput,
  partitionMandatoryLandmarkCandidates,
  partitionResidentSkyBiomes,
  planCompileSubmission,
  portalPrewarmViewBudget,
  prewarmBuildDeadline,
  prewarmCompileAwaitDeadline,
  prewarmEntryResumesAfterSkip,
  prewarmEntryRuns,
  prewarmEntryShouldDefer,
  prewarmProgramContentKeys,
  prewarmResumeIsDebt,
  prewarmSubmitShouldStop,
  remainingPrewarmViewBudget,
  resolvePrewarmEntryStatus,
  resolvePrewarmPolicy,
  skyAssetInlineWaitMs,
  withRestoredPrewarmState,
} from '../src/render/prewarm_policy';
import { PREWARM_SUBMIT_LANE_MAX_MS } from '../src/render/prewarm_submit_stop_core';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

// The real desktop constants (renderer.ts), injected so the test pins the actual
// numbers the renderer uses rather than duplicating magic values.
const BASE: PrewarmPolicyInput = {
  constrainedMemory: false,
  asyncCompileSupported: true,
  lowGfx: false,
  finishFullManifestBeforeReveal: false,
  defaultMaxMs: 3000,
  constrainedMaxMs: 3000,
  defaultCompileMaxMs: 1500,
  constrainedCompileMaxMs: 1500,
  maxViewsLow: 12,
  maxViewsHigh: 16,
  maxViewsConstrained: 2,
};

// Full-line // comments are stripped first, the tests/loopback_guard.test.ts
// rule: the reveal ordering below is explained in prose right beside the code,
// so a commented-out markGpuHitchReveal call must neither satisfy the pin nor
// break the whitespace-only assertion between the mark and the reveal.
const MAIN_SOURCE = codeWithoutLineComments(
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
);

it('pins the production soft, compile, hard, and view budgets plus their policy wiring', () => {
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  for (const literal of [
    'const VIEW_PREWARM_MAX_MS = 3000;',
    'const VIEW_PREWARM_MAX_MS_CONSTRAINED = 3000;',
    'const PREWARM_COMPILE_MAX_MS = 1500;',
    'const PREWARM_COMPILE_MAX_MS_CONSTRAINED = 1500;',
    'const VIEW_PREWARM_HARD_MAX_MS = 5000;',
    'const VIEW_PREWARM_HARD_MAX_MS_CONSTRAINED = 5000;',
    'const PREWARM_BUILD_RESERVE_MS = 1000;',
    'const VIEW_PREWARM_MAX_VIEWS_LOW = 12;',
    'const VIEW_PREWARM_MAX_VIEWS_HIGH = 16;',
  ]) {
    expect(renderer).toContain(literal);
  }
  for (const wiring of [
    'defaultMaxMs: VIEW_PREWARM_MAX_MS,',
    'constrainedMaxMs: VIEW_PREWARM_MAX_MS_CONSTRAINED,',
    'defaultCompileMaxMs: PREWARM_COMPILE_MAX_MS,',
    'constrainedCompileMaxMs: PREWARM_COMPILE_MAX_MS_CONSTRAINED,',
    'maxViewsLow: VIEW_PREWARM_MAX_VIEWS_LOW,',
    'maxViewsHigh: VIEW_PREWARM_MAX_VIEWS_HIGH,',
    '? VIEW_PREWARM_HARD_MAX_MS_CONSTRAINED\n      : (pacing.knobs.hardMaxMs ?? VIEW_PREWARM_HARD_MAX_MS);',
    'const maxMs = Math.max(0, options.maxMs ?? policy.maxMs);',
    'const hardMaxMs = Math.max(maxMs, options.hardMaxMs ?? defaultHardMaxMs);',
  ]) {
    expect(renderer).toContain(wiring);
  }
});

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
  'entities.character-effect-variants',
  'foliage.materials',
  'foliage.great-tree-materials',
  'world.settle-state',
  'post.initial-frame',
  'programs.compile-submit',
  'surface-detail.textures',
  'weather.materials',
  'landmarks.impact-site',
  'textures.scene',
  'vfx.atlas',
  'vfx.weapon-skins',
  'vfx.ability-primitives',
  'vfx.mount-programs',
  'sky.nearby-biomes',
  'world.initial-frame',
  'programs.compile',
  'programs.budget-variants',
  'sky.current-zone',
  'render.settle-passes',
  'diagnostics.baseline',
];

describe('graphics rebuild reveal wiring', () => {
  it('marks the published renderer immediately before recoverable rebuild reveal', () => {
    const coordinatorAt = MAIN_SOURCE.indexOf(
      'const graphicsRebuild = new GraphicsRebuildCoordinator',
    );
    const hideCallbackAt = MAIN_SOURCE.indexOf('hideOpaqueCurtain: () => {', coordinatorAt);
    const markAt = MAIN_SOURCE.indexOf('renderer.markGpuHitchReveal();', hideCallbackAt);
    const hideAt = MAIN_SOURCE.indexOf('hideLoadingScreen();', markAt);
    expect(coordinatorAt).toBeGreaterThan(-1);
    expect(hideCallbackAt).toBeGreaterThan(coordinatorAt);
    expect(markAt).toBeGreaterThan(hideCallbackAt);
    expect(hideAt).toBeGreaterThan(markAt);
    expect(MAIN_SOURCE.slice(markAt + 'renderer.markGpuHitchReveal();'.length, hideAt)).toMatch(
      /^\s*$/,
    );

    // The coordinator uses this callback for both the committed target and the
    // recoverable rollback. Keep the initial world reveal on its existing path.
    const initialRevealAt = MAIN_SOURCE.indexOf('const revealWorld = (): void => {');
    const initialMarkAt = MAIN_SOURCE.indexOf('renderer.markGpuHitchReveal();', initialRevealAt);
    const initialHideAt = MAIN_SOURCE.indexOf('hideLoadingScreen();', initialMarkAt);
    expect(initialRevealAt).toBeGreaterThan(-1);
    expect(initialMarkAt).toBeGreaterThan(initialRevealAt);
    expect(initialHideAt).toBeGreaterThan(initialMarkAt);
  });
});

describe('initial entry detail admission wiring', () => {
  it('arms the capped horizon before the manifest collects compile and texture work', () => {
    const armAt = MAIN_SOURCE.indexOf('renderer.armEntryDetailHorizon();');
    const prewarmAt = MAIN_SOURCE.indexOf('const prewarm = await renderer.prewarmInitialScene({');
    const firstFrameAt = MAIN_SOURCE.indexOf('requestAnimationFrame(frame);', prewarmAt);
    expect(armAt).toBeGreaterThan(-1);
    expect(prewarmAt).toBeGreaterThan(armAt);
    expect(firstFrameAt).toBeGreaterThan(prewarmAt);
  });

  it('keeps the live diagnostic marker separate from horizon admission', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const markAt = renderer.indexOf('markGpuHitchReveal(): void {');
    const markEnd = renderer.indexOf('\n  /**', markAt);
    const mark = renderer.slice(markAt, markEnd);
    expect(mark).not.toContain('entryDetailHorizon.');
  });

  it('installs the scenery reveal gates for every scene prewarm, before settle-state', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const installAt = renderer.indexOf('private installSceneryRevealGates(): void {');
    const prewarmAt = renderer.indexOf('async prewarmInitialScene(');
    const policyAt = renderer.indexOf('const policy: PrewarmPolicy', prewarmAt);
    const prewarmStart = renderer.slice(prewarmAt, policyAt);
    const settleAt = renderer.indexOf("id: 'world.settle-state'");

    expect(installAt).toBeGreaterThan(-1);
    expect(prewarmAt).toBeGreaterThan(installAt);
    expect(settleAt).toBeGreaterThan(prewarmAt);
    expect(prewarmStart).toContain('this.installSceneryRevealGates();');
    expect(renderer.slice(settleAt)).not.toContain(
      'this.propsView.setBandRevealGate(this.propsRevealGate);',
    );
  });
});

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
  it('runs the full manifest inside a short responsive budget', () => {
    const p = resolvePrewarmPolicy(BASE);
    expect(p.minimalManifest).toBe(false);
    expect(p.maxMs).toBe(3000);
    expect(p.compileMaxMs).toBe(1500);
    expect(p.maxViews).toBe(16);
    expect(p.nearbyViewFloor).toBe(NEARBY_VIEW_PREWARM_FLOOR);
    expect(p.yieldBetweenEntries).toBe(true);
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
      'this.createCandidateViews(\n            nearbyPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor),\n            createdViewTypes,\n            buildDeadline,',
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
    // The production 3 s soft budget must leave a real build slice before the
    // 1 s reserve; otherwise nearby/persistent views all spill into gameplay.
    expect(prewarmBuildDeadline(3_000, 5_000, 1_000, false)).toBe(2_000);
  });

  it('stops the compile-submit loop at the GPU submit deadline, except on the Insane arm', () => {
    // The loop check runs BETWEEN units: before the deadline it keeps
    // submitting, at and past it the remainder defers to the compile entry or
    // the resume lane (one uninterrupted loop measured 22 s in production,
    // dropping every entry behind it: hitch-hunt S1/S2).
    expect(prewarmSubmitShouldStop(13_999, 14_000, false)).toBe(false);
    expect(prewarmSubmitShouldStop(14_000, 14_000, false)).toBe(true);
    expect(prewarmSubmitShouldStop(20_000, 14_000, false)).toBe(true);
    // finishFullManifestBeforeReveal (desktop Insane) submits without bound:
    // its contract is a complete manifest behind the cover.
    expect(prewarmSubmitShouldStop(20_000, 14_000, true)).toBe(false);
    // An absent or not-yet-stopped lane verdict changes none of the above.
    expect(prewarmSubmitShouldStop(13_999, 14_000, false, null)).toBe(false);
    expect(
      prewarmSubmitShouldStop(20_000, 14_000, true, {
        stop: false,
        reason: null,
        elapsedMs: 5_999,
        submissions: 40,
      }),
    ).toBe(false);
  });

  it('stops on the lane hard stop even where the deadline is exempted', () => {
    // The deadline clause is the only exemptible one: the lane's own stop
    // (prewarm_submit_stop_core) binds every arm, which is what the Insane
    // arm was missing when one compile-submit entry ate 11.8 s of a 12 s
    // budget and the twelve entries behind it timed out.
    const laneMax = {
      stop: true,
      reason: 'lane-max',
      elapsedMs: PREWARM_SUBMIT_LANE_MAX_MS,
      submissions: 812,
    } as const;
    expect(prewarmSubmitShouldStop(0, 14_000, true, laneMax)).toBe(true);
    expect(prewarmSubmitShouldStop(0, 14_000, false, laneMax)).toBe(true);
    const noUsefulLink = {
      stop: true,
      reason: 'no-useful-link',
      elapsedMs: 12,
      submissions: 8,
    } as const;
    // Both rules stop the lane long before either deadline reading.
    expect(prewarmSubmitShouldStop(0, 14_000, true, noUsefulLink)).toBe(true);
    expect(prewarmSubmitShouldStop(0, Number.POSITIVE_INFINITY, true, noUsefulLink)).toBe(true);
  });

  it('classifies exactly the link/upload debt entries for BOOT_DEBT resume', () => {
    // Positive arm: the debt payers whose unpaid remainder surfaces as
    // first-draw stalls in live frames.
    expect(prewarmResumeIsDebt('programs.compile')).toBe(true);
    expect(prewarmResumeIsDebt('programs.compile-submit')).toBe(true);
    expect(prewarmResumeIsDebt('programs.compile-post-paint')).toBe(true);
    expect(prewarmResumeIsDebt('textures.scene')).toBe(true);
    expect(prewarmResumeIsDebt('surface-detail.textures')).toBe(true);
    // The foliage species stream in with travel (ambient scene, not an
    // event), so their dropped material units are debt too.
    expect(prewarmResumeIsDebt('foliage.materials')).toBe(true);
    // Negative arm over REACHABLE inputs: these three entries declare real
    // resumeUnits, so they are the ids a misclassification would actually
    // route to BOOT_DEBT. They stay cosmetic (below the preview lane) by the
    // per-family criterion in the debt set's doc.
    expect(prewarmResumeIsDebt('props.ghost-fade-variants')).toBe(false);
    expect(prewarmResumeIsDebt('vfx.weapon-skins')).toBe(false);
    expect(prewarmResumeIsDebt('vfx.mount-programs')).toBe(false);
    expect(prewarmResumeIsDebt('vfx.ability-primitives')).toBe(false);
  });

  it('admits only the visible scene compile group before first paint', () => {
    expect(compileGroupRunsBeforeInitialPaint('scene')).toBe(true);
    for (const id of [
      'doors',
      'interiors',
      'players',
      'mobs',
      'npcs',
      'objects',
      'props',
      'ghost-fade-variants',
      'character-effect-variants',
      'ability-materials',
      'foliage',
      'great-tree',
      'weapon-vfx',
      'landmarks.impact-site',
      'mounts',
    ]) {
      expect(compileGroupRunsBeforeInitialPaint(id), id).toBe(false);
    }
  });

  it('orders resume entries program debt, upload debt, then cosmetic, stable within each class', () => {
    // The resume lane is strictly serial in array order, so this ordering is
    // the ONLY thing that can put the link/upload debt ahead of the cosmetic
    // entries (BOOT_DEBT priority arbitrates against other lanes, never
    // inside this one).
    const ordered = orderPrewarmResumeEntries([
      { id: 'props.ghost-fade-variants' },
      { id: 'textures.scene' },
      { id: 'vfx.weapon-skins' },
      { id: 'programs.compile' },
      { id: 'programs.compile-submit' },
    ]);
    // Program links lead the debt class (a met unlinked program blocks the
    // frame; a texture upload is paced), then the upload debt, then cosmetic.
    expect(ordered.map((entry) => entry.id)).toEqual([
      'programs.compile',
      'programs.compile-submit',
      'textures.scene',
      'props.ghost-fade-variants',
      'vfx.weapon-skins',
    ]);
    // All-cosmetic and all-debt lists come back untouched.
    expect(orderPrewarmResumeEntries([{ id: 'vfx.weapon-skins' }])).toEqual([
      { id: 'vfx.weapon-skins' },
    ]);
  });

  it('ties the debt set to real resume-capable manifest entries', () => {
    // Guard against silent drift: a renderer-side rename of a debt entry
    // would otherwise demote that debt to the cosmetic arm with every test
    // green. The synthetic programs.compile-submit dropped entry is the one
    // non-manifest... it IS a manifest id, but its manifest entry declares no
    // resumeUnits: the hand-off is the only producer of a resume entry with
    // that id, so no duplicate-id resume entry can exist.
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const manifestIds = new Set(parsedManifestEntries().map((entry) => entry.id));
    for (const id of [
      'programs.compile',
      'programs.compile-submit',
      'textures.scene',
      'surface-detail.textures',
    ]) {
      expect(manifestIds.has(id), `debt id ${id} is not a manifest entry`).toBe(true);
      expect(prewarmResumeIsDebt(id)).toBe(true);
    }
    // Every manifest entry that declares resumeUnits is classified ON
    // PURPOSE: debt or the cosmetic allowlist below. A new resumable entry
    // must be added to one of the two, never land unclassified.
    const COSMETIC_RESUME_IDS = [
      'props.ghost-fade-variants',
      'entities.character-effect-variants',
      'vfx.atlas',
      'vfx.weapon-skins',
      'vfx.ability-primitives',
      'vfx.mount-programs',
      'sky.current-zone',
      'render.settle-passes',
      // Converted to prewarm slots (variant_prewarm_slot.ts): a landmark
      // clone and two precipitation maps, both first-use-on-a-specific-event
      // warm-ups rather than ambient scene debt.
      'weather.materials',
      'landmarks.impact-site',
    ];
    // Same per-entry block split as parsedManifestEntries, so an entry's
    // resumeUnits can never be attributed to its neighbour. Comments are
    // stripped and the match is anchored to the PROPERTY syntax first: the
    // manifest explains itself in prose beside the code, and lines like
    // `// No resumeUnits: this spawns real particles` are a substring match.
    // Counting those padded the floor to 10 over 7 real declarations, so the
    // count could have halved and the pin stayed green. Raised to 10 real
    // declarations when weather.materials and landmarks.impact-site became
    // prewarm slots.
    const start = renderer.indexOf('const manifest: PrewarmManifestEntry[] = [');
    const end = renderer.indexOf('const byId = new Map(', start);
    const manifestCode = codeWithoutLineComments(renderer.slice(start, end)).replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const resumable = manifestCode
      .split(/\n {6}\{\n/)
      .slice(1)
      .filter((block) => /^\s*resumeUnits:/m.test(block))
      .map((block) => /id: '([^']+)'/.exec(block)?.[1])
      .filter((id): id is string => Boolean(id) && manifestIds.has(id as string));
    // The real declaration count, measured against the source above. A drop
    // here means a resume lane was deleted, not that a comment was reworded.
    expect(resumable.length).toBeGreaterThanOrEqual(10);
    // Every id counted must own a real property declaration, so a block that
    // only TALKS about resumeUnits can never be one of them.
    for (const id of resumable) {
      const block = manifestCode
        .split(/\n {6}\{\n/)
        .find((candidate) => candidate.includes(`id: '${id}'`));
      expect(block && /^\s*resumeUnits:/m.test(block), `${id} has no resumeUnits property`).toBe(
        true,
      );
    }
    for (const id of resumable) {
      expect(
        prewarmResumeIsDebt(id) || COSMETIC_RESUME_IDS.includes(id),
        `manifest entry ${id} declares resumeUnits but is classified neither debt nor cosmetic`,
      ).toBe(true);
    }
  });

  it('binds the landmark and weather entries to the shared prewarm slot', () => {
    // Both entries used to hold their artifact in a manifest-local `let` that
    // the cleanup nulled, which is why neither could resume: the slot keeps it
    // in its own closure instead (variant_prewarm_slot.ts, its own Vitest).
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(renderer).toContain(
      "createVariantPrewarmSlot(variantSlotHost, 'landmarks.impact-site', () =>",
    );
    expect(renderer).toContain('buildImpactSitePrewarmGroup(this.impactSite.group, p.pos)');
    expect(renderer).toContain("createPrewarmGroupSlot(variantSlotHost, 'weather.materials', {");
    // The weather artifact is no group, so the slot's hide arm is the only
    // thing that can take the staged precipitation draw back out of a live
    // frame before its uploads run.
    expect(renderer).toContain('hide: () => this.weather.hidePrewarm(),');
    expect(renderer).toContain(
      "units: (textures) => textureResumeUnits('weather-materials', textures),",
    );
    expect(renderer).toContain('cleanup: () => this.weather.endPrewarm(),');
    // The manifest-local mutable state is gone with them.
    expect(renderer).not.toContain('landmarkPrewarmGroup');
    expect(renderer).not.toContain('weatherPrewarmActive');
    // Both entries bind the slot rather than re-implementing the staging.
    for (const [id, slot] of [
      ['weather.materials', 'weatherSlot'],
      ['landmarks.impact-site', 'landmarkSlot'],
    ]) {
      const start = renderer.indexOf(`id: '${id}'`);
      const entry = renderer.slice(start, renderer.indexOf('      {\n        id:', start + 1));
      expect(entry, id).toContain(`resumeUnits: ${slot}.resumeUnits,`);
      expect(entry, id).toContain(`run: ${slot}.run,`);
    }
    // Hidden at world entry and torn down with every other staged artifact.
    for (const slot of ['landmarkSlot', 'weatherSlot']) {
      const hideStart = renderer.indexOf('const hidePrewarmArtifacts = ');
      const hideEnd = renderer.indexOf('const cleanupPrewarmArtifacts = ', hideStart);
      expect(renderer.slice(hideStart, hideEnd), slot).toContain(`${slot}.hide();`);
      const cleanupEnd = renderer.indexOf('doorPrewarmGroup = null;', hideEnd);
      expect(renderer.slice(hideEnd, cleanupEnd), slot).toContain(`${slot}.cleanup();`);
    }
  });

  it('uses the low view cap on the low tier', () => {
    expect(resolvePrewarmPolicy({ ...BASE, lowGfx: true }).maxViews).toBe(12);
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
    // The tail submit is bounded by BOTH deadlines: gpuSubmitDeadline alone
    // sits 1000 ms past compileAwaitDeadline, so an unbounded tail submit
    // could eat the whole await reserve and leave world.initial-frame drawing
    // still-linking programs (QA finding, hitch-hunt P1).
    expect(compileEntry).toContain(
      "await submitCompileUnits(\n            true,\n            Math.min(gpuSubmitDeadline, compileAwaitDeadline),\n            'programs.compile',\n          );",
    );
    // Deferred units count into the honesty gate: planned includes them and
    // the dropped count marks the entry partial, never completed.
    expect(compileEntry).toContain(
      'compileUnitsPlanned =\n            submittedCompileUnits.length +\n            deferredSubmitUnits.length +\n            postPaintCompileUnits.length;',
    );
    expect(compileEntry).toContain(
      'compileUnitsDropped = deferredSubmitUnits.length + postPaintCompileUnits.length;',
    );
    // The await-all is bounded (see the dedicated reserve test below), so the
    // literal Promise.all is no longer the awaited expression directly; it is
    // captured and raced against the reserved deadline.
    expect(compileEntry).toContain('const awaitAll = Promise.all(\n');
    expect(compileEntry).toContain('submittedCompileUnits.map((unit) =>');
    expect(compileEntry).toContain('unit.done.then(() => {');
    // The entry run never raw-checks the deadline itself: the deadline
    // decision lives in the submit loop, through the pure
    // prewarmSubmitShouldStop, and stopping means DEFERRAL to the resume
    // lane, never a drop (the pins below).
    expect(compileEntry).not.toContain('performance.now() >= gpuSubmitDeadline');
    // The submit loop consults the pure decision BETWEEN units, with the
    // caller-chosen deadline, the Insane exemption flag, and the pacing
    // lane's own hard-stop verdict: without this wiring the 22 s production
    // overrun comes back with every unit test green (QA finding B2), and
    // without the fourth argument the Insane arm has no stop at all (the
    // 11.8 s compile-submit entry of the 17/08 production login).
    expect(renderer).toContain(
      'outOfTime: () =>\n          prewarmSubmitShouldStop(\n            performance.now(),\n            deadlineMs,\n            policy.finishFullManifestBeforeReveal,\n            pacing.shouldStop(performance.now()),\n          ),',
    );
    expect(renderer).toContain('awaitSlot: (outOfTime) => pacing.awaitSlot(outOfTime),');
    expect(renderer).toContain(
      'submitPrewarmCompileUnit(unit, lane, {\n              lifecycle: compileLifecycle,\n              pacing,',
    );
    // Pushed as each unit is submitted, never collected from the loop's return:
    // a rejection inside the loop must not lose already-submitted units from
    // the set the compile entry awaits.
    expect(renderer).toContain('submit: (unit) =>\n          submittedCompileUnits.push(');
    // The loop itself is the extracted runPrewarmCompileSubmission, which owns
    // the between-units check and the never-drop contract; the renderer keeps
    // only the wiring above and the deferral bookkeeping below.
    expect(renderer).toContain('await runPrewarmCompileSubmission(pending, {');
    const submissionCore = readFileSync(
      new URL('../src/render/prewarm_compile_submission_core.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(submissionCore).toContain('if (!(await host.awaitSlot(host.outOfTime))) {');
    expect(submissionCore).toContain('const deferred = pending.slice(i);');
    // The deferral lifecycle, pinned end to end (QA finding B3): stopped
    // units are retained, drained FIRST by the next submission (their groups
    // are already marked, so the plan cannot re-collect them), any leftover
    // is handed to the resume lane under the synthetic id, and the mid-run
    // deferral withholds warm-pool publication like the whole-entry path.
    expect(renderer).toContain('deferredSubmitUnits.push(...(deferred as PrewarmResumeUnit[]));');
    expect(renderer).toContain(
      'const pending = [...deferredSubmitUnits.splice(0, deferredSubmitUnits.length), ...units];',
    );
    expect(renderer).toContain(
      "droppedEntries.push({\n        id: 'programs.compile-submit',\n        units: deferredSubmitUnits.splice(0, deferredSubmitUnits.length),\n      });",
    );
    expect(renderer).toContain('deferPoolPublication ||=');
    // The deferral is visible in the prewarm summary on both entries.
    expect(renderer).toContain('`submitted=${submittedCompileUnits.length};deferred=${');
    expect(renderer).toContain(';deferred=${compileUnitsDropped}');
    // Which groups a submission collects and marks is the pure
    // planCompileSubmission; the renderer must route BOTH calls through it
    // with a per-call existence read and the shared dedupe store.
    expect(renderer).toContain('const plan = planCompileSubmission({');
    expect(renderer).toContain("{ id: 'scene', exists: true },");
    expect(renderer).toContain(
      '...stagedCompileGroupsNow().map(([id, group]) => ({ id, exists: group !== null })),',
    );
    expect(renderer).toContain('sharedDedupe: compileDedupe,');
    expect(renderer).toContain(
      "await submitCompileUnits(false, gpuSubmitDeadline, 'programs.compile-submit');",
    );
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
    // r185 keys vertexNormals (normal-attribute presence) for every material.
    expect(prewarmProgramContentKeys({ hasNormals: true }, ['mat-1'])).not.toEqual(flat);
    expect(prewarmProgramContentKeys({ hasNormals: true }, ['mat-1'])).not.toEqual(
      prewarmProgramContentKeys({ hasTangents: true }, ['mat-1']),
    );
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

  it('splits every input of the opaque bit three keys on, and the flags beside it', () => {
    // three's key carries `opaque` (transparent === false && blending ===
    // NormalBlending && alphaToCoverage === false) plus alphaHash, dithering
    // and premultipliedAlpha. Each is its own class of variant the compile
    // lane would otherwise skip and the first live draw would link.
    const stone = { type: 'MeshStandardMaterial', map: {}, transparent: false };
    const base = materialProgramSignature(stone);
    // AdditiveBlending: opaque with a non-normal blend mode is a second program.
    expect(materialProgramSignature({ ...stone, blending: 2 })).not.toBe(base);
    expect(materialProgramSignature({ ...stone, alphaToCoverage: true })).not.toBe(base);
    expect(materialProgramSignature({ ...stone, alphaHash: true })).not.toBe(base);
    expect(materialProgramSignature({ ...stone, dithering: true })).not.toBe(base);
    expect(materialProgramSignature({ ...stone, premultipliedAlpha: true })).not.toBe(base);
    // NormalBlending spelled out is the default, so it must not split.
    expect(materialProgramSignature({ ...stone, blending: 1 })).toBe(base);
    // ... and each of the four is independent of the others.
    const signatures = new Set([
      base,
      materialProgramSignature({ ...stone, blending: 2 }),
      materialProgramSignature({ ...stone, alphaToCoverage: true }),
      materialProgramSignature({ ...stone, alphaHash: true }),
      materialProgramSignature({ ...stone, dithering: true }),
      materialProgramSignature({ ...stone, premultipliedAlpha: true }),
    ]);
    expect(signatures.size).toBe(6);
  });

  it('wires the compile dedupe and the widened shadow arm to the measured residue', () => {
    // Line comments stripped: a commented-out call site must not keep a
    // positive pin green.
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8').replace(
        /\r\n/g,
        '\n',
      ),
    );
    const compileUnits = codeWithoutLineComments(
      readFileSync(
        new URL('../src/render/initial_scene_compile_units.ts', import.meta.url),
        'utf8',
      ).replace(/\r\n/g, '\n'),
    );
    // The dedupe key comes from the shared pure helper, never a hand-rolled
    // string that can drift from three's cache key again.
    expect(compileUnits).toContain('prewarmProgramContentKeys(');
    expect(compileUnits).toContain('hasInstanceColor: ');
    expect(compileUnits).toContain('morphTargetCount: ');
    // The prewarm depth material must match the REAL shadow pass variant, and
    // that derivation lives in the shared factory (src/render/prewarm_depth_material.ts),
    // pinned against three's WebGLShadowMap source by its own test. The renderer
    // never sets depthPacking itself: the RGBADepthPacking override that matched
    // three 0.165 became a dead variant under 0.185 (its shadow pass draws the
    // default packing), and every character shadow program relinked cold at its
    // first draw (production: 1196 / 662 / 211 / 129 ms frames).
    expect(renderer).toContain("import { prewarmDepthMaterial } from './prewarm_depth_material';");
    // The shadow arm covers EVERY mesh with a material, not just skinned rigs
    // (static and instanced casters' depth programs were 12 of the frame's 64
    // residual links) and not just the casters of the moment: castShadow is a
    // runtime distance toggle, so a rig gated beyond the shadow band must
    // still get its depth twin or it links cold at its first shadow draw.
    // Neither a `castShadow` branch nor a null-material swap belongs here.
    const shadowStart = renderer.indexOf('private async compileShadowPrograms(');
    // Comments are stripped above, so the slice ends on the next declaration.
    const shadowEnd = renderer.indexOf('private prewarmRenderTarget', shadowStart);
    expect(shadowStart).toBeGreaterThan(-1);
    expect(shadowEnd).toBeGreaterThan(shadowStart);
    const shadowMethod = renderer.slice(shadowStart, shadowEnd);
    expect(shadowMethod).toContain('if (!mesh.isMesh || !mesh.material) return;');
    expect(shadowMethod).not.toContain('castShadow');
    expect(shadowMethod).not.toContain('isSkinnedMesh');
    expect(shadowMethod).not.toContain('mesh.material = null');
    expect(shadowMethod).toContain('for (const swap of swaps) swap.mesh.material = swap.material;');
    // Scoped to the shadow arm: the renderer must not hand-build a depth
    // material there (a `new THREE.MeshDepthMaterial(` or a `depthPacking` write
    // in that block would be the override coming back by another door). The
    // factory is fed the caster mesh too: one awaited depth material per
    // (skinning x morph count x instancing) shape, not one shared instance whose
    // single currentProgram slot leaves the sibling programs unpolled.
    // (tests/renderer_shadow_prewarm.test.ts proves the same behaviorally.)
    expect(shadowMethod).not.toContain('depthPacking');
    expect(shadowMethod).not.toContain('new THREE.MeshDepthMaterial(');
    expect(shadowMethod).toContain('prewarmDepthMaterial(this.prewarmDepthMaterials, item, mesh)');
    expect(shadowMethod).toContain(
      'prewarmDepthMaterial(this.prewarmDepthMaterials, material, mesh)',
    );
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
  expect(entry).toContain('runPrewarmBudgetVariants(');
  expect(entry).toContain('renderBudgetShaderPrewarmLevels(');
  expect(entry).toContain('originalState');
  expect(entry).toContain('this.renderPrewarmPass(1 / 60)');
  // The GPU SUBMIT GUARD, never the hard deadline. Each variant runs a real
  // prewarm pass and an already-started WebGL call cannot be cancelled, so a
  // pass launched at hardDeadline - epsilon overshoots the wall and defers
  // every entry behind it, the deadline-exempt debt payers included. The
  // negative arm is the one that matters: this entry was briefly handed
  // hardDeadline, and the pin that had guarded it was rewritten to match.
  expect(entry).toContain('deadlineMs: gpuSubmitDeadline');
  expect(entry).not.toContain('deadlineMs: hardDeadline');
  expect(entry).toContain('withRestoredPrewarmState(');
  expect(entry).not.toContain('compilePrewarmColorPrograms(this.scene');
  expect(entry).toContain('deadlineExempt: !constrainedPrewarm && this.asyncCompileSupported');
});

it('wires the budget-variant recorder into the manifest entry', () => {
  // This used to grep the WHOLE of prewarm_compile_lifecycle.ts for
  // programsBefore/programsAfter/syncMs/passes, all of which already appear in
  // RendererPrewarmCompileUnitStats (and one of which a comment satisfied), so
  // it stayed green with the budget-variant recorder deleted. The RECORDING
  // behaviour is covered directly in tests/prewarm_compile_lifecycle.test.ts;
  // what belongs here is only that the entry is wired to it and publishes the
  // stats, bounded to the entry's own slice.
  const renderer = readFileSync(
    new URL('../src/render/renderer.ts', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const entryAt = renderer.indexOf("id: 'programs.budget-variants'");
  const entryEnd = renderer.indexOf("id: 'sky.current-zone'", entryAt);
  expect(entryAt).toBeGreaterThan(-1);
  expect(entryEnd).toBeGreaterThan(entryAt);
  const entry = codeWithoutLineComments(renderer.slice(entryAt, entryEnd));
  expect(entry).toContain('runPrewarmBudgetVariants(');
  expect(entry).toContain('budgetVariantStats');
  expect(entry).toContain('budgetVariants: () => budgetVariantStats');
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
    expect(p.maxMs).toBe(3000);
    expect(p.compileMaxMs).toBe(1500);
    // The production-hub fix: only self plus one required/nearby view may build
    // synchronously at entry, never a crowd that reveals on the first live submit.
    expect(p.maxViews).toBe(2);
    // No nearby floor on top of the constrained cap: 2 is a process-survival
    // ceiling, and the deferred mob-body stream covers nearby entities.
    expect(p.nearbyViewFloor).toBe(0);
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
    expect(renderer).toContain(
      'portalPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor)',
    );
    expect(renderer).toContain(
      'nearbyPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor)',
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
    expect(highCap.maxViews).toBe(16); // tier cap still wins when it is lower
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

describe('the nearby view floor on the shared budget (review should-fix)', () => {
  // The reported starvation: required and landmark views drain the shared
  // counter while bypassing the cap, and portals draw before nearby, so with
  // the 12/16 budgets a landmark-plus-portal-heavy spawn left zero slots for
  // the nearby entity views, the most actionable entry on the shared cap.
  it('portals may only draw what remains past the floor', () => {
    expect(portalPrewarmViewBudget(12, 0, 4)).toBe(8);
    expect(portalPrewarmViewBudget(12, 5, 4)).toBe(3);
    expect(portalPrewarmViewBudget(12, 8, 4)).toBe(0);
    expect(portalPrewarmViewBudget(12, 20, 4)).toBe(0);
  });

  it('nearby always keeps at least the floor, even with the counter drained', () => {
    expect(nearbyPrewarmViewBudget(12, 0, 4)).toBe(12);
    expect(nearbyPrewarmViewBudget(12, 10, 4)).toBe(4);
    expect(nearbyPrewarmViewBudget(12, 12, 4)).toBe(4);
    // Required plus landmarks alone past the cap: nearby still gets the floor,
    // so total entry views are bounded by maxViews plus the floor.
    expect(nearbyPrewarmViewBudget(12, 20, 4)).toBe(4);
  });

  it('a zero floor reproduces the plain shared-budget draw (the constrained arm)', () => {
    expect(portalPrewarmViewBudget(2, 2, 0)).toBe(0);
    expect(nearbyPrewarmViewBudget(2, 2, 0)).toBe(0);
    expect(nearbyPrewarmViewBudget(2, 1, 0)).toBe(1);
  });

  it('normalizes a fractional or negative floor', () => {
    expect(portalPrewarmViewBudget(12, 0, 4.9)).toBe(8);
    expect(nearbyPrewarmViewBudget(12, 12, -1)).toBe(0);
  });

  it('the unconstrained floor never exceeds the smallest tier budget', () => {
    // resolvePrewarmPolicy clamps by min(floor, baseMaxViews); the constant
    // itself must sit under the 12-view low tier for the clamp to be a no-op
    // on both desktop tiers.
    expect(NEARBY_VIEW_PREWARM_FLOOR).toBeLessThanOrEqual(12);
    expect(NEARBY_VIEW_PREWARM_FLOOR).toBeGreaterThan(0);
    expect(resolvePrewarmPolicy({ ...BASE, lowGfx: true }).nearbyViewFloor).toBe(
      NEARBY_VIEW_PREWARM_FLOOR,
    );
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
    expect(entry).toContain('deadlineExempt: true');
    expect(entry).toContain('progress: () => sceneTextureAdmission?.progress() ?? null');
    // The regression shape: workDone as a GPU-residency delta an
    // already-resident texture never moves, mismatched against a planned that
    // counts every texture examined. The delta stays in detail(), labeled.
    expect(entry).not.toContain('done: sceneTextureUploadDelta()');
    expect(entry).toContain('uploadedDelta=${sceneTextureUploadDelta()}');
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
    const createAt = helper.indexOf('this.createView(entity, undefined, true)');
    const compileWaitAt = helper.indexOf('await Promise.all(compileWaits)');
    const readinessAt = helper.indexOf('mandatoryLandmarkViewsReady(ids, this.views)');
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(partitionAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(partitionAt);
    expect(helper).toContain('this.createView(entity, undefined, true)');
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
    expect(gate).toContain('this.compileGate(group, requiredForEntry)');
    expect(gate).toContain('view.compilePending = false;');
    expect(gate).toContain(
      'The canvas nameplate (name, target marker, health, and cast bar) keeps',
    );
    expect(gate).toContain('void this.compileGate(target).then(');
    expect(gate.match(/this\.recoverRejectedCompileGate\(/g)).toHaveLength(3);
    // The Ignivar boss gates only its cosmetic rig (visibilityTarget), so the
    // restore writes go through that target; for every other view it IS the group.
    expect(gate).toContain('visibilityTarget.visible = priorVisibility;');
    expect(gate).toContain('this.recoverRejectedCompileGate(error, generation, onSettled);');
    expect(gate).not.toContain('onTimeout');

    const compileGateStart = renderer.indexOf('private compileGate(');
    const compileGateEnd = renderer.indexOf('private gateViewOnCompile(', compileGateStart);
    const compileGate = renderer.slice(compileGateStart, compileGateEnd);
    expect(compileGateStart).toBeGreaterThan(-1);
    expect(compileGateEnd).toBeGreaterThan(compileGateStart);
    // One gate, one queue unit per material group of the target: the split
    // is compile_gate_pieces.ts, and each piece arms the one constant for its
    // own work.
    expect(compileGate).toContain('this.liveCompileGates.runPieces(');
    // ...each piece the colour arm, the shadow arm, then the settle over every
    // program variant its materials carry (program_variant_settle.ts), bound to
    // this renderer's material properties and depth-twin cache.
    expect(compileGate).toContain('linkPieceWork(target, color, shadow, settle)');
    expect(compileGate).toContain(
      'const settle = pieceProgramSettle(this.webgl.properties, this.prewarmDepthMaterials);',
    );
    expect(compileGate).toContain('VIEW_COMPILE_GATE_MAX_MS');
    expect(compileGate).not.toContain('onTimeout');
    // The target-ancestry walk lives in compile_priority_core.ts (its own
    // Vitest); the renderer stays a thin caller.
    expect(renderer).toContain(
      'const priority = compilePriorityForTarget(target, this.sim.player.targetId, isCasting);',
    );
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

describe('self-spirit prewarm queue wiring', () => {
  it('preserves the idle delay and runs the compile through the shared GPU queue', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const start = renderer.indexOf('private selfSpirit = new SelfSpiritPrewarmer({');
    const end = renderer.indexOf('\n  // Static terrain/water/features', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const wiring = renderer.slice(start, end);
    const idleAt = wiring.indexOf('idle: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS)');
    const queueAt = wiring.indexOf('this.backgroundGpuWork.run(');
    expect(idleAt).toBeGreaterThan(-1);
    expect(queueAt).toBeGreaterThan(-1);
    expect(wiring).toContain('() => this.warmSelfSpirit()');
    expect(wiring).toContain('GPU_WORK_PRIORITY.VISIBLE_PREWARM');
    expect(wiring).toContain("'self-spirit'");
    expect(wiring).toContain('{ releaseTail: true }');
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
      '\n  private collectMissingViewCandidates(',
      budgetMethodStart,
    );
    const budgetMethod = renderer.slice(budgetMethodStart, budgetMethodEnd);
    // The decision itself lives in view_create_budget_core.ts (its own Vitest);
    // the renderer feeds it and consumes the count before creating candidates.
    expect(budgetMethod).toContain(
      'return runtimeViewCreateBudget(input, this.viewCreateBudgetState);',
    );
    const core = readFileSync(
      new URL('../src/render/view_create_budget_core.ts', import.meta.url),
      'utf8',
    );
    const budgetAt = core.indexOf('const base = constrainedEntryViewCreateBudget(');
    const zeroGuardAt = core.indexOf('if (base === 0) return 0;');
    const backoffAt = core.indexOf('if (state.backoffSeconds > 0)');
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

  it('uses the bounded shared-cursor texture path for constrained prewarm', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const admission = readFileSync(
      new URL('../src/render/initial_scene_texture_admission.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(renderer).toContain(
      'collectInitialPresentationTextures(this.scene, this.views, p.id, p.targetId)',
    );
    expect(admission).toContain('collectObjectTextures(scene, true)');
    expect(admission).toContain('for (const root of priorityRoots)');
    expect(admission).toContain('collectObjectTextures(root, false, textures)');
    expect(renderer).toContain('await ensureSceneTextureAdmission().drainBefore(');
    expect(renderer).toContain('sceneTextureAdmission?.admitOneBefore(deadlineMs);');
    expect(admission).toContain('while (this.cursor < this.textures.length');
    expect(admission).toContain('this.now() < deadlineMs');
    expect(admission).toContain('await this.yieldSlice()');
    expect(admission).toContain('return this.textures.slice(this.cursor);');
  });

  it('settles the capped world before early compile submission and texture collection', () => {
    const entries = parsedManifestEntries();
    const settleAt = entries.findIndex((entry) => entry.id === 'world.settle-state');
    const submitAt = entries.findIndex((entry) => entry.id === 'programs.compile-submit');
    const texturesAt = entries.findIndex((entry) => entry.id === 'textures.scene');
    expect(settleAt).toBeGreaterThan(-1);
    expect(settleAt).toBeLessThan(submitAt);
    expect(settleAt).toBeLessThan(texturesAt);
    expect(entries[settleAt]?.deadlineExempt).toBe(true);
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
    // The starvation shape: a raw inline await of the fetch inside a prewarm
    // entry. No await of it exists anywhere in the renderer; the only one lives
    // in the post-boot sky residency lane (sky_residency_driver.ts's
    // ensureSkyResidency), which re-fetches an evicted biome at idle pace long
    // after boot; the prewarm manifest region itself stays await-free.
    expect(source.match(/await ensureSkyBiomeAssets\(/g) ?? []).toHaveLength(0);
    const driver = readFileSync(
      new URL('../src/render/sky_residency_driver.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const residencyAt = driver.indexOf('private ensureSkyResidency(');
    expect(residencyAt).toBeGreaterThan(-1);
    const residency = driver.slice(residencyAt, driver.indexOf('\n  /**', residencyAt + 1));
    expect(residency).toContain('await ensureSkyBiomeAssets(');
    expect(driver.match(/await ensureSkyBiomeAssets\(/g) ?? []).toHaveLength(1);
    expect(source.slice(manifestAt, source.indexOf('\n  private ', manifestAt))).not.toContain(
      'await ensureSkyBiomeAssets(',
    );
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
    // and the 2k RGBA16F dome upload (pinned r165 paid it as one indivisible
    // call; the installed 0.185 row-batches it via native update ranges, the
    // same total GPU work, per the renderer's sky-entry ruling) lands in the
    // in-game lane. Exemption adds no network wait:
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

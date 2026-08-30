#!/usr/bin/env node
// The export and symbol census for the farming absorb merge (Phase 11d unit 5 of the
// Masterwrought packet; Phase 17 re-runs it as a delivery gate).
//
// WHAT IT ASSERTS. For every exported symbol, content-table row id, i18n catalog key,
// and SimEvent name present on EITHER parent of the merge commit 424ce89a20, that
// name is present in the merged tree unless it is on the written deletion list
// (docs/prd/masterwrought/merge-deletion-list.md). The parent set is ours UNION
// theirs, never base: a name both parents deleted is legitimately gone.
//
//   MISSING = (ours UNION theirs) minus merged minus deletionList   -> must be EMPTY
//   EXTRA   = merged minus (ours UNION theirs)                     -> must be EXACTLY
//             the explained set: EXPLAINED_EXTRAS below UNION every row of the
//             deletion list's "## Explained extras" tables (parseExplainedExtras;
//             consumed since Phase 17, no longer a mere mirror). Every entry carries
//             the phase and ruling that authored it, and a defective doc row fails
//             the census exactly like a defective deletion row.
//
// Either assertion failing exits nonzero. Most classes are keyed BY NAME (never by
// file): the merge's top risk is a dropped hunk, and a name defined in a different
// file is present, not missing. Per-name file sets are kept for the report only (an
// export defined in two files is a duplicate-definition INFO signal).
// THE ONE EXCEPTION is `contentIdRows`, keyed `path:id`, added at the Phase 11d QA
// because the name-keyed rule has a real hole for content tables: an id reused
// across two tables (every farm crop id is also an item id) hides a dropped ROW,
// since the name survives in the other table. That class deliberately treats a
// cross-file MOVE as a finding, which the name-keyed classes do not, so a move or a
// retirement is recorded with a `content row` deletion-list row naming the full
// `path:id` on both sides.
//
// HOW IT READS. The parents are read with git plumbing only (git ls-tree -r
// --name-only <ref> -- <roots>, then the blob contents through one
// `git cat-file --batch` process per parent, the batch form of `git show
// <ref>:<path>`): no checkout, no worktree switch, no stash. The merged side is read
// from disk under --merged-root (default: this repo's root), so a scratch copy can be
// mutated and scanned without touching the real tree (guard 1, mutation).
//
// THE THIRD PARENT (release syncs after the merge). The branch keeps syncing
// release/** after the absorb merge (the first at Phase 11d STEP 0, tip f50b30de29),
// and every sync brings names that are on neither ours nor theirs. Those releases are
// PARENTS of the merged tree, not extras: the parent set is
//   ours UNION theirs UNION release(s)
// where the releases are RELEASE_REF (override: --release <ref>) plus the second
// parent of every later merge commit on the branch's own first-parent chain (a later
// sync; --sync <ref> adds one by hand for a squash sync, --no-auto-sync turns the
// derivation off). MISSING = parents minus merged minus deletionList; EXTRA = merged
// minus parents. A MISSING name that no release parent has but base does is annotated
// release-attributable (the release retired it and a packet parent was behind) and
// reported in its own sub-list; it still needs a deletion-list row. The refs used are
// printed in the header of every run.
//
// GUARDS. (1) Mutation: `--merged-root <scratch copy>` lets the caller delete one
// known symbol and confirm MISSING names it (the recipe is in the deletion list's
// header). (2) Floors: FLOORS pins a minimum size per parent set per class; an
// extractor that silently matches nothing fails instead of comparing two empty sets.
//
// THE EXTRACTORS are mechanical text walks over a conservative JS/TS tokenizer
// (comments dropped, strings and templates atomic, regex literals recognized by the
// usual previous-token rule and bounded to one line), so a commented-out export or an
// export inside a string never counts. The known limits are counted and printed, never
// silent: `export *` re-exports (names unknown), `export default`, `export =`,
// CommonJS `module.exports`, destructured and multi-declarator exports, content ids
// that are not a plain literal, i18n spread / computed members and non-literal leaves,
// union members that are bare aliases this walk could not resolve, and emit sites whose
// argument the walk cannot resolve to an event literal.
// On that last one, updated at the Phase 11d QA: the walk now resolves TWO
// indirections beyond the plain `emit({ type: '<literal>' })` shape, a ternary of
// event literals and the named fanout helpers in SIM_EVENT_FANOUT_HELPERS, in both
// cases reading only the OUTERMOST object literal so a nested `type:` cannot mint a
// kind. Two pins guard what is left: SIM_EVENT_UNION_ONLY fails on any drift in the
// declared-but-never-seen set, and every emitted kind must be a declared union
// member.
//
// USAGE
//   node scripts/merge_audit/symbol_census.mjs [--merged-root <dir>] [--repo <dir>]
//        [--ours <ref>] [--theirs <ref>] [--json <out.json>] [--limit <n>]
//
// The script's own directory (scripts/merge_audit/) is excluded from the merged scan,
// so its exports are never EXTRA once committed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------
// The three refs. base is informational only (the census compares ours UNION theirs
// against merged); it is printed so a reader of the report has all three in one place.
// ---------------------------------------------------------------------------------

export const BASE_REF = 'e56707a675013fc1a86bb19d31a0a8d79a02a197';
export const OURS_REF = 'd5304a78c4a1add6b1ed5a0b66ddb9f8246a4d73';
export const THEIRS_REF = '8cd964d599ebbb6800fc20741690a0b9b6f17b40';

/** The absorb merge itself (parents OURS_REF and THEIRS_REF). Merge commits AFTER it on
 *  the branch's first-parent chain are release syncs; their second parents join the
 *  release parent set. */
export const ABSORB_MERGE_COMMIT = '424ce89a20a8612b70d52745b02746b7b4f4b886';

/** The third parent: the release/v0.40.0 tip synced at Phase 11d STEP 0 (PR #3549).
 *  Override with --release when a newer tip has been synced without a merge commit. */
export const RELEASE_REF = 'f50b30de296945379f8d6076ecc56cca617b8e49';

/** The release tip the branch had ALREADY absorbed before the 11d sync (informational:
 *  the release delta window for sync-attributed deletions is PRIOR_SYNC_TIP..RELEASE_REF). */
export const PRIOR_SYNC_TIP = '65b91fa190f1b6d7935ac38774b1742c3e93bc9c';

export const DELETION_LIST_PATH = 'docs/prd/masterwrought/merge-deletion-list.md';

export const EXPORT_ROOTS = Object.freeze(['src', 'server', 'headless', 'bot', 'scripts']);
export const CONTENT_ROOT = 'src/sim/content';
export const I18N_CATALOG_ROOT = 'src/ui/i18n.catalog';
export const SIM_ROOT = 'src/sim';
export const SIM_EVENT_UNION_FILE = 'src/sim/types.ts';
export const SIM_EVENT_UNION_NAME = 'SimEvent';
/** The SimEvent union discriminates on `type`, not `kind` (src/sim/types.ts). */
export const SIM_EVENT_DISCRIMINANT = 'type';

/**
 * Repo-specific SimEvent FANOUT helpers: functions that take a builder and emit
 * once per recipient, so the literal event kind lives in the CALLER's arrow body
 * and never in an `emit({...})`. Named explicitly rather than inferred, so the
 * indirection the census claims to resolve stays a short auditable list.
 */
export const SIM_EVENT_FANOUT_HELPERS = new Set(['emitToZonePlayers']);

/**
 * SimEvent types the union DECLARES that the emits extractor does not see, pinned
 * so the set cannot drift silently.
 *
 * Two kinds live here. The server-side set: events emitted from `server/` (the
 * social and calendar surfaces), legitimately outside SIM_ROOT, which the sim scan
 * was never going to see and which no sim-side merge hunk can drop. And, since the
 * Phase 17 reconciliation, the announceZoneCelebration set: three zone
 * celebrations whose emit literal Phase 13 moved one indirection PAST the named
 * fanout helper (see the dated entries below), each with a matching `simevent
 * emit` deletion-list row.
 *
 * Four names that used to sit here were a REAL hole, and the Phase 11d QA closed
 * it rather than only reporting it: attunedZone, farmReady, gatherRareEvent and
 * masterworkZone all live in src/sim/professions/, the directory BOTH packets
 * rewrote. The emits walk records only `emit({ type: '<literal>' })`, so an event
 * built in a fanout callback or a ternary of two literals never reached the class,
 * and a hunk dropping the emit CALL while leaving the union arm and the exported
 * helper passed every class in the census. The extractor now resolves both
 * indirections, so those four are ordinary members of the emits class and deleting
 * one of their calls moves it.
 *
 * Drift in either direction FAILS the census and wants a human: a new name means a
 * new indirection the extractor cannot follow, and a name LEAVING means either it
 * became visible (good, drop it here) or it stopped being emitted at all, which is
 * the regression this list exists to surface.
 */
export const SIM_EVENT_UNION_ONLY = Object.freeze([
  // Phase 13 (branch commit 5bbfcb0450; pinned 2026-08-30 at the Phase 17
  // reconciliation): attunedZone, legendaryForgedZone and masterworkZone moved
  // behind the shared announceZoneCelebration prologue
  // (src/sim/professions/gather_events.ts), so each event literal sits in the
  // CALLER's builder arrow one indirection past the named emitToZonePlayers
  // fanout, where this extractor cannot follow it; the actual emit happens
  // inside emitToZonePlayers on the builder's return. All three still fire:
  // declared in src/sim/types.ts, handled by hud.ts, pinned live by
  // tests/professions_attunement_online.test.ts,
  // tests/masterwork_zone_broadcast.test.ts and tests/orange_promotion.test.ts,
  // with matching `simevent emit` deletion-list rows for the two on parents.
  'attunedZone',
  'calendarResult',
  'deedBroadcast',
  'guildInvite',
  'guildInviteCancelled',
  'guildRenamed',
  // Phase 13 helper indirection: see the attunedZone note above.
  'legendaryForgedZone',
  'masterworkZone',
  'motdResult',
  'reliquaryIlluminationBroadcast',
  // release/v0.41.0 (the seventeenth sync): declared in the union and handled by
  // hud.ts, but emitted by no sim or server site on ff2837da1f itself (the
  // tutorial greeting moved to a client-driven flow, src/sim/tutorial/greeting.ts
  // keeps only the sent flag). A release-side dead declaration, reported upstream;
  // pinned here so the drift guard stays honest about what the extractor sees.
  'tutorialGreeting',
]);

/**
 * The SimEvent verdict, as a PURE function of the two sets plus the pin, so it can
 * be tested without a git walk. It used to be four lines inside runCensus(), which
 * no test calls, so the Phase 11d QA pin audit disabled each condition in turn and
 * the suite stayed green every time. Returns the declared-but-never-emitted set,
 * its drift against the pin, and any emitted kind that is not a declared union
 * member (the backstop on the indirect resolver: the plain emit shape reads its
 * literal at depth 0, but the ternary and fanout shapes scan a whole call region,
 * so a `type:` on a nested non-event object could in principle mint a bogus kind).
 *
 * @param {Map<string, Set<string>>|Set<string>} unionSet declared SimEvent types
 * @param {Map<string, Set<string>>|Set<string>} emitsSet emitted SimEvent types
 * @param {readonly string[]} [pinned] the expected declared-but-unseen set
 */
export function simEventVerdict(unionSet, emitsSet, pinned = SIM_EVENT_UNION_ONLY) {
  const unionOnly = [...unionSet.keys()].filter((name) => !emitsSet.has(name)).sort();
  const pinnedSet = new Set(pinned);
  const drift = {
    added: unionOnly.filter((n) => !pinnedSet.has(n)),
    removed: [...pinned].filter((n) => !unionOnly.includes(n)),
  };
  const emitsOutsideUnion = [...emitsSet.keys()].filter((name) => !unionSet.has(name)).sort();
  return {
    unionOnly,
    drift,
    emitsOutsideUnion,
    failed: drift.added.length > 0 || drift.removed.length > 0 || emitsOutsideUnion.length > 0,
  };
}

export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.mts', '.cts', '.mjs', '.js', '.cjs']);
/** Directory segments never walked on either side. */
export const EXCLUDED_DIR_SEGMENTS = Object.freeze(['node_modules', 'dist']);
/** Path prefixes excluded everywhere: the resolved-i18n artifacts (regenerated, not
 *  authored) and this script's own directory, scripts/merge_audit/, which also holds
 *  the phase's sibling audit tools (shard_weight_union.mjs, golden_composition.mjs):
 *  none of these exist on any parent, so scanning them would only mint EXTRA rows for
 *  the auditors themselves. */
export const EXCLUDED_PATH_PREFIXES = Object.freeze([
  'src/ui/i18n.resolved.generated/',
  'scripts/merge_audit/',
]);
/** Generated artifacts are excluded from every extractor so a concurrent regen
 *  (wiki content, sfx manifest, translation keys) cannot move a count. */
export const GENERATED_FILE_RE = /\.generated\.[cm]?[jt]s$/;

export const CLASSES = Object.freeze([
  'exports',
  'contentIds',
  'contentIdRows',
  'i18nKeys',
  'simEventUnion',
  'simEventEmits',
]);

export const CLASS_LABELS = Object.freeze({
  exports: 'exported symbols',
  contentIds: 'content-table row ids',
  contentIdRows: 'content-table rows, keyed file:id',
  i18nKeys: 'i18n catalog keys',
  simEventUnion: 'SimEvent union-declared types',
  simEventEmits: 'SimEvent emitted types',
});

/**
 * Guard 2: minimum size per parent set per class, pinned from the sizes observed at
 * the 11d pre-run (2026-08-21) rounded DOWN by roughly ten percent. An extractor that
 * matches nothing (a tokenizer regression, a moved root, a renamed union) fails here
 * instead of passing by comparing two empty sets. The parents are immutable refs, so
 * these sizes never move unless an extractor does; the release floor is checked
 * against EVERY release parent, so it stays a touch lower for later sync tips.
 * Observed at authoring, 2026-08-21 (release = f50b30de29):
 *   exports       ours 17329 / theirs 16921 / release 17221
 *   contentIds    ours  2958 / theirs  2913 / release  2810
 *   i18nKeys      ours 18008 / theirs 17984 / release 17866
 *   simEventUnion ours   152 / theirs   159 / release   152
 *   simEventEmits ours   142 / theirs   148 / release   142
 */
export const FLOORS = Object.freeze({
  exports: Object.freeze({ ours: 15500, theirs: 15200, release: 15400 }),
  contentIds: Object.freeze({ ours: 2650, theirs: 2600, release: 2500 }),
  // contentIdRows is contentIds keyed file:id, so it is always >= contentIds
  // (a name defined in two tables yields two rows). Reusing the contentIds
  // floors is therefore conservative by construction. Observed 2026-08-21:
  // ours 2973 / theirs 2935 / merged 3084.
  contentIdRows: Object.freeze({ ours: 2650, theirs: 2600, release: 2500 }),
  i18nKeys: Object.freeze({ ours: 16200, theirs: 16100, release: 16000 }),
  simEventUnion: Object.freeze({ ours: 136, theirs: 143, release: 136 }),
  simEventEmits: Object.freeze({ ours: 127, theirs: 133, release: 127 }),
});

/**
 * The explained-extras allowlist: every name present in the merged tree on NEITHER
 * parent must be here, with the phase and ruling that authored it. An EXTRA with no
 * row is a duplicate definition or a stale copy (the extraction-versus-in-place class
 * the merge produces with zero conflict markers) and fails the census. Keep this list
 * and the "Explained extras" section of the deletion list in step.
 */
export const EXPLAINED_EXTRAS = Object.freeze([
  {
    cls: 'exports',
    name: 'WELL_FED_AURA_ID',
    phase: '11c',
    ruling: '11b-D-2 / 11c-D-2',
    reason:
      'the one aura id seam constant (src/sim/wellfed.ts); replaces the retired per-kind wellfed_<kind> ids',
  },
  {
    cls: 'exports',
    name: 'applyWellFedOnMealComplete',
    phase: '11c',
    ruling: '11b-D-2 / 11c-D-2',
    reason:
      'rename of theirs applyWellfedOnConsumeComplete (src/sim/wellfed.ts) when the module became the one mint',
  },
  {
    cls: 'exports',
    name: 'FoodConsuming',
    phase: '11c QA',
    ruling: '11c QA should-fix (architecture): Consuming kind-scoped',
    reason:
      'the food arm of the Consuming union (src/sim/types.ts); Consuming itself survives as the alias',
  },
  {
    cls: 'exports',
    name: 'DrinkConsuming',
    phase: '11c QA',
    ruling: '11c QA should-fix (architecture): Consuming kind-scoped',
    reason: 'the drink arm of the Consuming union (src/sim/types.ts)',
  },
  {
    cls: 'exports',
    name: 'ConsumableDefFacts',
    phase: '11c',
    ruling: '11c-A2-BUILDER',
    reason: 'the builder parameter type of the new src/sim/consuming.ts module',
  },
  {
    cls: 'exports',
    name: 'buildConsuming',
    phase: '11c',
    ruling: '11c-A2-BUILDER',
    reason: 'the one Consuming build site (src/sim/consuming.ts), a new module on the merged tree',
  },
  {
    cls: 'exports',
    name: 'FARM_EFFECT_BONUS_PICK_CAP',
    phase: '11e',
    ruling: 'masterwrought DECISION C (cap the charm in farming, never in the catalog)',
    reason:
      "farming's own cap on a slotted quantity tool effect (src/sim/professions/farming.ts), beside FARM_TONIC_BONUS_PICKS; deliberately NOT a change to TOOL_EFFECTS.makers_charm.bonus, which would re-tune three other professions",
  },
  {
    cls: 'contentIds',
    name: 'col_farm_roster',
    phase: '11e',
    ruling: 'masterwrought DECISION E (one cosmetic collection deed for the roster)',
    reason:
      'the roster deed: category collection, renown 5, no title, triggered on the farm_crop marks generated from FARM_CROP_IDS',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/deeds.ts:col_farm_roster',
    phase: '11e',
    ruling: 'masterwrought DECISION E (one cosmetic collection deed for the roster)',
    reason: 'the same deed row, in the file-scoped class',
  },
  // Phase 11e's crop roster widening. A new content id is EXTRA in three
  // classes at once and in three different NAME FORMS: the bare id in
  // contentIds, the `file:id` key in contentIdRows (twice for a crop, because
  // its FARM_CROPS row and its items.ts produce row share an id but not a
  // file), and the bare id again in i18nKeys for its English catalog name.
  // Measured at STEP 0 before authoring, not discovered after.
  {
    cls: 'contentIds',
    name: 'thornpeak_cabbage_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-3 farmer under DECISION D',
  },
  {
    cls: 'contentIds',
    name: 'thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-3 leaf produce, consumed by recipe_highwatch_barley_bannock',
  },
  {
    cls: 'contentIds',
    name: 'fine_thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_highwatch_barley_bannock in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:thornpeak_cabbage_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-3 farmer under DECISION D',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-3 leaf produce, consumed by recipe_highwatch_barley_bannock',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:fine_thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_highwatch_barley_bannock in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/farm_crops.ts:thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason:
      'the FARM_CROPS row itself; its id equals the produce item id, so this key exists only in the file-scoped class',
  },
  {
    cls: 'i18nKeys',
    name: 'thornpeak_cabbage_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'fine_thornpeak_cabbage',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'contentIds',
    name: 'frost_lentils_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-3 farmer under DECISION D',
  },
  {
    cls: 'contentIds',
    name: 'frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-3 legume produce, consumed by recipe_highwatch_gourd_soup',
  },
  {
    cls: 'contentIds',
    name: 'fine_frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_highwatch_gourd_soup in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:frost_lentils_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-3 farmer under DECISION D',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-3 legume produce, consumed by recipe_highwatch_gourd_soup',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:fine_frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_highwatch_gourd_soup in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/farm_crops.ts:frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason:
      'the FARM_CROPS row itself; its id equals the produce item id, so this key exists only in the file-scoped class',
  },
  {
    cls: 'i18nKeys',
    name: 'frost_lentils_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'fine_frost_lentils',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'contentIds',
    name: 'gilded_yam_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-4 farmer under DECISION D',
  },
  {
    cls: 'contentIds',
    name: 'gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-4 tuber produce, consumed by recipe_evergarden_sunmelon_tart',
  },
  {
    cls: 'contentIds',
    name: 'fine_gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_evergarden_sunmelon_tart in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:gilded_yam_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-4 farmer under DECISION D',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-4 tuber produce, consumed by recipe_evergarden_sunmelon_tart',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:fine_gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_evergarden_sunmelon_tart in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/farm_crops.ts:gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason:
      'the FARM_CROPS row itself; its id equals the produce item id, so this key exists only in the file-scoped class',
  },
  {
    cls: 'i18nKeys',
    name: 'gilded_yam_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'fine_gilded_yam',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'contentIds',
    name: 'evergarden_pumpkin_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-4 farmer under DECISION D',
  },
  {
    cls: 'contentIds',
    name: 'evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-4 gourd produce, consumed by recipe_evergarden_harvest_platter',
  },
  {
    cls: 'contentIds',
    name: 'fine_evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_evergarden_harvest_platter in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:evergarden_pumpkin_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the seed, vendor-stocked at the tier-4 farmer under DECISION D',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'the tier-4 gourd produce, consumed by recipe_evergarden_harvest_platter',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/items.ts:fine_evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its fine twin, consumed by recipe_evergarden_harvest_platter in the same bill',
  },
  {
    cls: 'contentIdRows',
    name: 'src/sim/content/farm_crops.ts:evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason:
      'the FARM_CROPS row itself; its id equals the produce item id, so this key exists only in the file-scoped class',
  },
  {
    cls: 'i18nKeys',
    name: 'evergarden_pumpkin_seed',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
  {
    cls: 'i18nKeys',
    name: 'fine_evergarden_pumpkin',
    phase: '11e',
    ruling: 'masterwrought DECISION B (roster 2/2/4/4, one class per tier)',
    reason: 'its English catalog name (ITEM_ENTITY_IDS)',
  },
]);

// ---------------------------------------------------------------------------------
// Tokenizer: a conservative JS/TS lexer. Comments are dropped, string and template
// literals are single tokens, regex literals are recognized only where the previous
// token allows an expression AND the literal closes on the same line. Anything it
// cannot classify becomes a one-character punct token, so a misread is bounded.
// ---------------------------------------------------------------------------------

const PUNCT_MULTI = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '?.',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '**',
];

const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const ID_START = /[A-Za-z_$#À-￿]/;
const ID_PART = /[A-Za-z0-9_$À-￿]/;

function regexAllowedAfter(prev) {
  if (!prev) return true;
  if (prev.t === 'punct') return prev.v !== ')' && prev.v !== ']';
  if (prev.t === 'id') return REGEX_AFTER_KEYWORD.has(prev.v);
  return false;
}

/**
 * Tokenize JS/TS source.
 * @param {string} src
 * @returns {Array<{t:'id'|'str'|'tpl'|'num'|'regex'|'punct', v:string, line:number, hasSubst?:boolean}>}
 */
export function tokenize(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  const push = (t, v, extra) => {
    const tok = { t, v, line };
    if (extra) Object.assign(tok, extra);
    out.push(tok);
    return tok;
  };

  /** Scan a template literal starting at the opening backtick; returns the index
   *  after the closing backtick. Substitutions are tokenized recursively by a nested
   *  scan of the same source (brace-balanced) and discarded. */
  const scanTemplate = (start) => {
    let j = start + 1;
    let text = '';
    let hasSubst = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        text += src[j] + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (ch === '`') {
        return { end: j + 1, text, hasSubst };
      }
      if (ch === '$' && src[j + 1] === '{') {
        hasSubst = true;
        text += '${}';
        j = scanBalanced(j + 2);
        continue;
      }
      if (ch === '\n') line++;
      text += ch;
      j++;
    }
    return { end: n, text, hasSubst };
  };

  /** From just after a `${`, consume tokens until the matching `}` and return the
   *  index after it. Nested strings, templates, comments, and braces are honored. */
  const scanBalanced = (start) => {
    let depth = 1;
    let j = start;
    let prev = null;
    while (j < n) {
      const ch = src[j];
      if (ch === '\n') {
        line++;
        j++;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        j++;
        continue;
      }
      if (ch === '/' && src[j + 1] === '/') {
        while (j < n && src[j] !== '\n') j++;
        continue;
      }
      if (ch === '/' && src[j + 1] === '*') {
        const close = src.indexOf('*/', j + 2);
        const endc = close < 0 ? n : close + 2;
        for (let k = j; k < endc; k++) if (src[k] === '\n') line++;
        j = endc;
        continue;
      }
      if (ch === "'" || ch === '"') {
        j = scanString(j).end;
        prev = { t: 'str' };
        continue;
      }
      if (ch === '`') {
        j = scanTemplate(j).end;
        prev = { t: 'tpl' };
        continue;
      }
      if (ch === '{') {
        depth++;
        prev = { t: 'punct', v: '{' };
        j++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) return j + 1;
        prev = { t: 'punct', v: '}' };
        j++;
        continue;
      }
      if (ch === '/' && regexAllowedAfter(prev)) {
        const r = scanRegex(j);
        if (r) {
          j = r.end;
          prev = { t: 'regex' };
          continue;
        }
      }
      if (ID_START.test(ch)) {
        let k = j + 1;
        while (k < n && ID_PART.test(src[k])) k++;
        prev = { t: 'id', v: src.slice(j, k) };
        j = k;
        continue;
      }
      prev = { t: 'punct', v: ch };
      j++;
    }
    return n;
  };

  /** Scan a quoted string starting at the quote; unterminated strings end at EOL. */
  const scanString = (start) => {
    const q = src[start];
    let j = start + 1;
    let text = '';
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        const nx = src[j + 1] ?? '';
        if (nx === '\n') {
          line++;
        } else if (nx === 'n') text += '\n';
        else if (nx === 't') text += '\t';
        else text += nx;
        j += 2;
        continue;
      }
      if (ch === q) return { end: j + 1, text };
      if (ch === '\n') return { end: j, text };
      text += ch;
      j++;
    }
    return { end: n, text };
  };

  /** Scan a regex literal at `/`; null when it does not close on this line. */
  const scanRegex = (start) => {
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\n') return null;
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (inClass) {
        if (ch === ']') inClass = false;
        j++;
        continue;
      }
      if (ch === '[') {
        inClass = true;
        j++;
        continue;
      }
      if (ch === '/') {
        j++;
        while (j < n && /[a-z]/.test(src[j])) j++;
        return { end: j, text: src.slice(start, j) };
      }
      j++;
    }
    return null;
  };

  while (i < n) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const s = scanString(i);
      push('str', s.text);
      i = s.end;
      continue;
    }
    if (ch === '`') {
      const startLine = line;
      const tpl = scanTemplate(i);
      const tok = { t: 'tpl', v: tpl.text, line: startLine, hasSubst: tpl.hasSubst };
      out.push(tok);
      i = tpl.end;
      continue;
    }
    if (ch === '/' && regexAllowedAfter(out[out.length - 1] ?? null)) {
      const r = scanRegex(i);
      if (r) {
        push('regex', r.text);
        i = r.end;
        continue;
      }
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let k = i + 1;
      while (k < n && /[0-9A-Za-z_.]/.test(src[k])) {
        // Exponent sign: 1e-5.
        if ((src[k] === 'e' || src[k] === 'E') && (src[k + 1] === '-' || src[k + 1] === '+')) k++;
        k++;
      }
      push('num', src.slice(i, k));
      i = k;
      continue;
    }
    if (ID_START.test(ch)) {
      let k = i + 1;
      while (k < n && ID_PART.test(src[k])) k++;
      push('id', src.slice(i, k));
      i = k;
      continue;
    }
    let matched = false;
    for (const p of PUNCT_MULTI) {
      if (src.startsWith(p, i)) {
        push('punct', p);
        i += p.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    push('punct', ch);
    i++;
  }
  return out;
}

/** Extractors accept either source text or an already-tokenized array. */
function toTokens(srcOrTokens) {
  return Array.isArray(srcOrTokens) ? srcOrTokens : tokenize(srcOrTokens);
}

function isPunct(tok, v) {
  return !!tok && tok.t === 'punct' && tok.v === v;
}
function isId(tok, v) {
  return !!tok && tok.t === 'id' && (v === undefined || tok.v === v);
}

const OPENERS = { '{': '}', '(': ')', '[': ']' };
const CLOSERS = new Set(['}', ')', ']']);

/** Index of the token matching the opener at `i`, or tokens.length when unbalanced. */
function matchingClose(tokens, i) {
  const stack = [];
  for (let j = i; j < tokens.length; j++) {
    const tok = tokens[j];
    if (tok.t !== 'punct') continue;
    if (OPENERS[tok.v]) stack.push(OPENERS[tok.v]);
    else if (CLOSERS.has(tok.v)) {
      // A stray closer that does not match the top (a lexer misread) is skipped.
      if (stack.length && stack[stack.length - 1] === tok.v) stack.pop();
      if (!stack.length) return j;
    }
  }
  return tokens.length;
}

/** From `i` (a member start), skip forward to the index of the next `,` at this depth
 *  or of the enclosing closer (returned index points AT that token). */
function skipToMemberEnd(tokens, i) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const tok = tokens[j];
    if (tok.t !== 'punct') continue;
    if (OPENERS[tok.v]) depth++;
    else if (CLOSERS.has(tok.v)) {
      if (depth === 0) return j;
      depth--;
    } else if (tok.v === ',' && depth === 0) return j;
  }
  return tokens.length;
}

// ---------------------------------------------------------------------------------
// Extractor 1: exported symbol names.
// ---------------------------------------------------------------------------------

const DECL_MODIFIERS = new Set(['declare', 'abstract', 'async']);
const NAMED_DECL_KEYWORDS = new Set([
  'class',
  'interface',
  'type',
  'enum',
  'namespace',
  'module',
  'import',
]);

/** Local binding names introduced by `import` statements (default, namespace, named). */
function collectImportBindings(tokens) {
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (!isId(tokens[i], 'import') || isPunct(tokens[i - 1], '.')) continue;
    // `export import X = ...` and dynamic `import(` are not bindings of this form.
    if (isPunct(tokens[i + 1], '(')) continue;
    let j = i + 1;
    if (isId(tokens[j], 'type') && !isPunct(tokens[j + 1], ',') && !isId(tokens[j + 1], 'from'))
      j++;
    while (j < tokens.length) {
      const tok = tokens[j];
      if (tok.t === 'str') break; // bare `import 'side-effect'` or the module specifier
      if (isId(tok, 'from')) break;
      if (isPunct(tok, '*')) {
        if (isId(tokens[j + 1], 'as') && isId(tokens[j + 2])) out.add(tokens[j + 2].v);
        j += 3;
        continue;
      }
      if (isPunct(tok, '{')) {
        const close = matchingClose(tokens, j);
        let k = j + 1;
        while (k < close) {
          const entry = [];
          while (k < close && !isPunct(tokens[k], ',')) entry.push(tokens[k++]);
          k++;
          let e = 0;
          if (isId(entry[e], 'type') && entry.length > 1) e++;
          if (!entry[e]) continue;
          const local = isId(entry[e + 1], 'as') && entry[e + 2] ? entry[e + 2] : entry[e];
          if (local.t === 'id') out.add(local.v);
        }
        j = close + 1;
        continue;
      }
      if (tok.t === 'id') {
        out.add(tok.v);
        j++;
        continue;
      }
      j++;
    }
  }
  return out;
}

/**
 * @param {string} src
 * @returns {{ names: string[], reexports: string[], limits: Record<string, number> }}
 */
export function extractExports(src) {
  const tokens = toTokens(src);
  const names = [];
  /** Names this file only re-exports (`export { x } from`, `export * as ns from`, or a
   *  local `export { x }` of an imported binding): present by name, but not a
   *  definition for the duplicate-definition report. */
  const reexports = [];
  const imported = collectImportBindings(tokens);
  const limits = {
    exportStar: 0,
    exportDefault: 0,
    exportEquals: 0,
    destructured: 0,
    anonymous: 0,
    unrecognized: 0,
    commonJs: 0,
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === 'id' && tok.v === 'module' && isPunct(tokens[i + 1], '.')) {
      if (isId(tokens[i + 2], 'exports')) limits.commonJs++;
      continue;
    }
    if (!isId(tok, 'export')) continue;
    if (isPunct(tokens[i - 1], '.')) continue;
    let j = i + 1;
    const next = tokens[j];
    if (!next) break;
    if (isId(next, 'default')) {
      limits.exportDefault++;
      continue;
    }
    if (isPunct(next, '*')) {
      if (isId(tokens[j + 1], 'as') && tokens[j + 2]) {
        names.push(tokens[j + 2].v);
        reexports.push(tokens[j + 2].v);
      } else {
        limits.exportStar++;
      }
      continue;
    }
    if (isPunct(next, '=')) {
      limits.exportEquals++;
      continue;
    }
    if (isPunct(next, '{') || (isId(next, 'type') && isPunct(tokens[j + 1], '{'))) {
      const open = isPunct(next, '{') ? j : j + 1;
      const close = matchingClose(tokens, open);
      const isReexport = isId(tokens[close + 1], 'from');
      // Entries: [type] name [as exported] separated by commas.
      let k = open + 1;
      while (k < close) {
        const entry = [];
        while (k < close && !isPunct(tokens[k], ',')) {
          entry.push(tokens[k]);
          k++;
        }
        k++;
        if (!entry.length) continue;
        let e = 0;
        if (isId(entry[e], 'type') && entry.length > 1) e++;
        const local = entry[e];
        if (!local) continue;
        let exported = local;
        if (isId(entry[e + 1], 'as') && entry[e + 2]) exported = entry[e + 2];
        if (exported.t === 'id' || exported.t === 'str') {
          names.push(exported.v);
          if (isReexport || (local.t === 'id' && imported.has(local.v))) reexports.push(exported.v);
        }
      }
      continue;
    }
    while (isId(tokens[j]) && DECL_MODIFIERS.has(tokens[j].v)) j++;
    let kw = tokens[j];
    if (!kw) break;
    if (isId(kw, 'const') && isId(tokens[j + 1], 'enum')) {
      j++;
      kw = tokens[j];
    }
    if (isId(kw, 'const') || isId(kw, 'let') || isId(kw, 'var')) {
      const target = tokens[j + 1];
      if (!target) break;
      if (target.t === 'id') {
        names.push(target.v);
      } else if (isPunct(target, '{') || isPunct(target, '[')) {
        limits.destructured++;
        const close = matchingClose(tokens, j + 1);
        for (let k = j + 2; k < close; k++) {
          const t = tokens[k];
          if (t.t !== 'id') continue;
          const after = tokens[k + 1];
          // `a: b` binds b (skip the key a); `a`, `a = x`, `...a` bind a.
          if (isPunct(after, ':')) continue;
          if (isPunct(after, ',') || isPunct(after, '=') || k + 1 === close) names.push(t.v);
          else if (isPunct(after, '}') || isPunct(after, ']')) names.push(t.v);
        }
      } else {
        limits.unrecognized++;
      }
      continue;
    }
    if (isId(kw, 'function')) {
      let k = j + 1;
      if (isPunct(tokens[k], '*')) k++;
      if (isId(tokens[k])) names.push(tokens[k].v);
      else limits.anonymous++;
      continue;
    }
    if (kw.t === 'id' && NAMED_DECL_KEYWORDS.has(kw.v)) {
      const name = tokens[j + 1];
      if (isId(name)) names.push(name.v);
      else if (name && name.t === 'str' && kw.v === 'module') {
        // `export declare module 'x' {}` ambient: no symbol name.
        limits.unrecognized++;
      } else limits.anonymous++;
      continue;
    }
    limits.unrecognized++;
  }
  return { names, reexports, limits };
}

// ---------------------------------------------------------------------------------
// Extractor 2: content-table row ids (`id: 'x'` / "x" / `x` without substitutions).
// ---------------------------------------------------------------------------------

/**
 * @param {string} src
 * @returns {{ ids: string[], nonLiteral: number, annotationLike: number }}
 */
export function extractContentIds(src) {
  const tokens = toTokens(src);
  const ids = [];
  let nonLiteral = 0;
  let annotationLike = 0;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const tok = tokens[i];
    const isKey = (tok.t === 'id' && tok.v === 'id') || (tok.t === 'str' && tok.v === 'id');
    if (!isKey) continue;
    if (!isPunct(tokens[i + 1], ':')) continue;
    if (isPunct(tokens[i - 1], '.') || isPunct(tokens[i - 1], '?.')) continue;
    const value = tokens[i + 2];
    if (value.t === 'str' || (value.t === 'tpl' && !value.hasSubst)) {
      ids.push(value.v);
    } else {
      nonLiteral++;
      if (value.t === 'id' && (value.v === 'string' || value.v === 'number')) annotationLike++;
    }
  }
  return { ids, nonLiteral, annotationLike };
}

// ---------------------------------------------------------------------------------
// Extractor 3: i18n catalog leaf key paths (dotted), by a textual walk of every
// top-level `= {` object literal in the file.
// ---------------------------------------------------------------------------------

const STATEMENT_START_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'type',
  'interface',
  'function',
  'class',
  'enum',
]);

/**
 * @param {string} src
 * @returns {{ keys: string[], spread: number, computed: number, nonLiteralLeaves: number,
 *            methods: number, shorthand: number, roots: number }}
 */
export function extractI18nKeys(src) {
  const tokens = toTokens(src);
  const keys = [];
  const stats = {
    spread: 0,
    computed: 0,
    nonLiteralLeaves: 0,
    methods: 0,
    shorthand: 0,
    roots: 0,
    typeLiteralRootsSkipped: 0,
  };

  const walkObject = (open, prefix) => {
    let i = open + 1;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (isPunct(tok, '}')) return i;
      if (isPunct(tok, ',') || isPunct(tok, ';')) {
        i++;
        continue;
      }
      if (isPunct(tok, '...')) {
        stats.spread++;
        i = skipToMemberEnd(tokens, i + 1);
        continue;
      }
      if (isPunct(tok, '[')) {
        stats.computed++;
        i = skipToMemberEnd(tokens, i);
        continue;
      }
      if (isPunct(tok, '*')) {
        stats.methods++;
        i = skipToMemberEnd(tokens, i);
        continue;
      }
      if ((isId(tok, 'get') || isId(tok, 'set') || isId(tok, 'async')) && isId(tokens[i + 1])) {
        stats.methods++;
        i = skipToMemberEnd(tokens, i);
        continue;
      }
      if (tok.t !== 'id' && tok.t !== 'str' && tok.t !== 'num') {
        i = skipToMemberEnd(tokens, i);
        continue;
      }
      const key = tok.v;
      const next = tokens[i + 1];
      if (isPunct(next, ':')) {
        const value = tokens[i + 2];
        if (isPunct(value, '{')) {
          const close = walkObject(i + 2, [...prefix, key]);
          i = skipToMemberEnd(tokens, close + 1);
          continue;
        }
        if (value && (value.t === 'str' || value.t === 'tpl')) {
          keys.push([...prefix, key].join('.'));
        } else {
          stats.nonLiteralLeaves++;
        }
        i = skipToMemberEnd(tokens, i + 2);
        continue;
      }
      if (isPunct(next, '(')) {
        stats.methods++;
        i = skipToMemberEnd(tokens, i);
        continue;
      }
      if (isPunct(next, ',') || isPunct(next, '}')) {
        stats.shorthand++;
        i++;
        continue;
      }
      i = skipToMemberEnd(tokens, i);
    }
    return i;
  };

  // A root is every depth-0 `= {` whose statement is not a `type` alias (a type
  // literal's members are shapes, not keys).
  let depth = 0;
  let lastStatementKeyword = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === 'id') {
      if (depth === 0 && STATEMENT_START_KEYWORDS.has(tok.v)) lastStatementKeyword = tok.v;
      continue;
    }
    if (tok.t !== 'punct') continue;
    if (depth === 0 && tok.v === '=' && isPunct(tokens[i + 1], '{')) {
      if (lastStatementKeyword === 'type' || lastStatementKeyword === 'interface') {
        stats.typeLiteralRootsSkipped++;
        i = matchingClose(tokens, i + 1);
        continue;
      }
      stats.roots++;
      const close = walkObject(i + 1, []);
      i = close;
      continue;
    }
    if (OPENERS[tok.v]) depth++;
    else if (CLOSERS.has(tok.v)) depth = Math.max(0, depth - 1);
  }
  return { keys, ...stats };
}

// ---------------------------------------------------------------------------------
// Extractor 4a: the SimEvent union's discriminant literals.
// ---------------------------------------------------------------------------------

const STATEMENT_KEYWORDS = new Set([
  'export',
  'import',
  'type',
  'interface',
  'const',
  'let',
  'var',
  'function',
  'class',
  'enum',
  'declare',
]);

/** Locate `[export] type <name> =` and return the token range of its right-hand side. */
function aliasRange(tokens, name) {
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (!isId(tokens[i], 'type') || !isId(tokens[i + 1], name) || !isPunct(tokens[i + 2], '='))
      continue;
    if (isPunct(tokens[i - 1], '.')) continue;
    const start = i + 3;
    let depth = 0;
    let j = start;
    for (; j < tokens.length; j++) {
      const tok = tokens[j];
      if (tok.t === 'punct') {
        if (OPENERS[tok.v]) depth++;
        else if (CLOSERS.has(tok.v)) depth--;
        else if (tok.v === ';' && depth <= 0) break;
      } else if (
        depth <= 0 &&
        tok.t === 'id' &&
        STATEMENT_KEYWORDS.has(tok.v) &&
        tokens[j].line > tokens[j - 1].line
      ) {
        break;
      }
    }
    return { start, end: j };
  }
  return null;
}

/** Discriminant literals at brace depth 1 of the range, plus bare alias member names. */
function unionMembers(tokens, range, discriminant) {
  const kinds = [];
  const aliases = [];
  const unresolved = [];
  let depth = 0;
  for (let i = range.start; i < range.end; i++) {
    const tok = tokens[i];
    if (tok.t === 'punct') {
      if (tok.v === '{') depth++;
      else if (tok.v === '}') depth--;
      continue;
    }
    if (tok.t !== 'id') continue;
    if (depth === 1 && tok.v === discriminant && isPunct(tokens[i + 1], ':')) {
      const v = tokens[i + 2];
      if (v && v.t === 'str') kinds.push(v.v);
      continue;
    }
    if (depth === 0) {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const prevOk =
        isPunct(prev, '|') || isPunct(prev, '(') || isPunct(prev, '=') || isPunct(prev, '&');
      const nextOk =
        !next ||
        isPunct(next, '|') ||
        isPunct(next, ')') ||
        isPunct(next, ';') ||
        isPunct(next, '&');
      if (prevOk && nextOk) aliases.push(tok.v);
      else unresolved.push(`${tok.v}?`);
    }
  }
  return { kinds, aliases, unresolved };
}

/**
 * @param {string} src the file holding the union (src/sim/types.ts)
 * @param {string} [unionName]
 * @returns {{ kinds: string[], resolvedAliases: string[], unresolvedAliases: string[] }}
 */
export function extractSimEventUnion(src, unionName = SIM_EVENT_UNION_NAME) {
  const tokens = toTokens(src);
  const kinds = [];
  const resolvedAliases = [];
  const unresolvedAliases = [];
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    const range = aliasRange(tokens, name);
    if (!range) {
      unresolvedAliases.push(name);
      return;
    }
    if (name !== unionName) resolvedAliases.push(name);
    const members = unionMembers(tokens, range, SIM_EVENT_DISCRIMINANT);
    kinds.push(...members.kinds);
    unresolvedAliases.push(...members.unresolved);
    for (const a of members.aliases) visit(a);
  };
  visit(unionName);
  return { kinds, resolvedAliases, unresolvedAliases };
}

// ---------------------------------------------------------------------------------
// Extractor 4b: SimEvent emit sites (`<recv>.emit({ type: 'x' ... })`, bare
// `emit({ ... })`, `events.push({ ... })`).
// ---------------------------------------------------------------------------------

/**
 * @param {string} src
 * @returns {{ kinds: string[], sites: number, nonLiteral: number, declarations: number,
 *            helpers: Record<string, number> }}
 */
export function extractSimEventEmits(src) {
  const tokens = toTokens(src);
  const kinds = [];
  const helpers = {};
  let sites = 0;
  let nonLiteral = 0;
  let declarations = 0;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'id') continue;
    if (!isPunct(tokens[i + 1], '(')) continue;
    let helper = null;
    if (tok.v === 'emit') {
      if (isPunct(tokens[i - 1], '.') || isPunct(tokens[i - 1], '?.')) {
        // Build the dotted receiver chain: this.ctx.emit -> "this.ctx.emit(".
        const chain = [];
        let k = i - 1;
        while ((isPunct(tokens[k], '.') || isPunct(tokens[k], '?.')) && isId(tokens[k - 1])) {
          chain.unshift(tokens[k - 1].v);
          k -= 2;
        }
        helper = `${chain.join('.')}.emit(`;
      } else {
        helper = 'emit(';
      }
    } else if (tok.v === 'push' && isPunct(tokens[i - 1], '.') && isId(tokens[i - 2], 'events')) {
      helper = 'events.push(';
    } else if (SIM_EVENT_FANOUT_HELPERS.has(tok.v)) {
      // A repo-specific fanout helper that emits once per recipient from a
      // caller-supplied builder: `emitToZonePlayers(ctx, zone, (pid) => ({ type:
      // 'x', ... }))`. The emit itself is `ctx.emit(build(pid))` inside the
      // helper, where no literal exists, so without naming the helper the event
      // kind never reaches this class at all and a dropped CALL is invisible to
      // the whole census (Phase 11d QA). Named, not inferred, so the set of
      // indirections the census claims to resolve stays auditable.
      helper = `${tok.v}(`;
    }
    if (!helper) continue;
    const first = tokens[i + 2];
    if (!first) break;
    // A declaration (`emit(ev: SimEvent)`, `emit(ev?: SimEvent)`) is not a site.
    // The `?` arm requires the type colon after it: without that check a TERNARY
    // whose condition is a bare identifier (`emit(ready ? {...} : {...})`) is read
    // as an optional parameter and the whole call is discarded, so both of its
    // event literals vanish. The live site survives only because its condition is
    // `withered > 0`, where the token after the identifier is `>` rather than `?`;
    // hoisting that condition to a named boolean would have silently blinded the
    // census to farmReady (Phase 11d QA pin audit).
    const optionalParam = isPunct(tokens[i + 3], '?') && isPunct(tokens[i + 4], ':');
    if (first.t === 'id' && (isPunct(tokens[i + 3], ':') || optionalParam)) {
      declarations++;
      continue;
    }
    if (isPunct(first, ')') && helper === 'emit(' && isId(tokens[i - 1], 'function')) {
      declarations++;
      continue;
    }
    sites++;
    helpers[helper] = (helpers[helper] ?? 0) + 1;
    if (isPunct(first, '{')) {
      // The plain shape: the argument IS the event object literal.
      const close = matchingClose(tokens, i + 2);
      let depth = 0;
      let found = null;
      for (let k = i + 3; k < close; k++) {
        const t = tokens[k];
        if (t.t === 'punct') {
          if (OPENERS[t.v]) depth++;
          else if (CLOSERS.has(t.v)) depth--;
          continue;
        }
        if (
          depth === 0 &&
          t.t === 'id' &&
          t.v === SIM_EVENT_DISCRIMINANT &&
          isPunct(tokens[k + 1], ':') &&
          tokens[k + 2] &&
          tokens[k + 2].t === 'str'
        ) {
          found = tokens[k + 2].v;
          break;
        }
      }
      if (found === null) nonLiteral++;
      else kinds.push(found);
      continue;
    }
    // The INDIRECT shapes, one level deep: the argument is a ternary of two
    // event literals (`emit(cond ? { type: 'farmReady', ... } : { type: ... })`)
    // or an arrow returning one (the fanout helpers above). Scan the whole CALL
    // region (the parenthesis at i+1), not an object literal, because in these
    // shapes the argument list does not start with one.
    //
    // BRACE DEPTH IS LOAD-BEARING here, exactly as it is on the plain path. A
    // first version of this scan accepted a `type:` member at ANY nesting, so
    // `{ type: 'deedProgress', meta: { type: 'attunedZone' } }` minted BOTH, and
    // the emits-outside-union backstop could not see it because the nested name
    // is itself a declared union member. That put a kind in the emits class with
    // nothing emitting it, so a hunk dropping the REAL emit of that kind would
    // still have reported MISSING 0: the hole this resolution exists to close,
    // re-opened one level down (found by the Phase 11d QA fix-round review).
    // Only members of the OUTERMOST object literal in each ternary arm or arrow
    // body count.
    const callClose = matchingClose(tokens, i + 1);
    const indirect = [];
    let objDepth = 0;
    for (let k = i + 2; k < callClose; k++) {
      const t = tokens[k];
      if (t.t === 'punct') {
        if (t.v === '{') objDepth++;
        else if (t.v === '}') objDepth--;
        continue;
      }
      if (
        objDepth === 1 &&
        t.t === 'id' &&
        t.v === SIM_EVENT_DISCRIMINANT &&
        isPunct(tokens[k + 1], ':') &&
        tokens[k + 2] &&
        tokens[k + 2].t === 'str' &&
        (isPunct(tokens[k - 1], '{') || isPunct(tokens[k - 1], ','))
      ) {
        indirect.push(tokens[k + 2].v);
      }
    }
    if (indirect.length === 0) nonLiteral++;
    else for (const kind of new Set(indirect)) kinds.push(kind);
  }
  return { kinds, sites, nonLiteral, declarations, helpers };
}

// ---------------------------------------------------------------------------------
// The deletion list: a Markdown table the script consumes. Columns (any order, matched
// by header text, case-insensitive): Class | Old name | New name | Phase | Ruling |
// Reason. Class is one of: export, content id, i18n key, simevent union, simevent
// emit, literal-only. Only census classes are consumed; literal-only rows are records.
// ---------------------------------------------------------------------------------

const CLASS_BY_LABEL = Object.freeze({
  export: 'exports',
  exports: 'exports',
  'content id': 'contentIds',
  'content ids': 'contentIds',
  // The row class needs its own label or it cannot be discharged AT ALL: a
  // content id that legitimately MOVES file to file (an ordinary extraction, the
  // default in this tree) is MISSING on the old path and EXTRA on the new, and a
  // legitimately RETIRED id is MISSING here even when the contentIds row records
  // it, because the two classes key differently. Without a label every future
  // content deletion or move was an undischargeable FAIL (found by the Phase 11d
  // QA fix-round review, before 11e hit it). Write the row's names as the full
  // `path:id` key, the same form the census reports.
  'content row': 'contentIdRows',
  'content rows': 'contentIdRows',
  'i18n key': 'i18nKeys',
  'i18n keys': 'i18nKeys',
  'simevent union': 'simEventUnion',
  'simevent emit': 'simEventEmits',
  'simevent emits': 'simEventEmits',
  'literal-only': null,
  'literal only': null,
});

function cleanCell(s) {
  return String(s ?? '')
    .trim()
    .replace(/^`|`$/g, '')
    .trim();
}

/**
 * @param {string} markdown
 * @returns {{ rows: Array<{cls: string|null, classLabel: string, oldName: string, newName: string,
 *            phase: string, ruling: string, reason: string, line: number}>, defects: string[] }}
 */
export function parseDeletionList(markdown) {
  const rows = [];
  const defects = [];
  const lines = markdown.split('\n');
  let columns = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const line = raw.trim();
    if (!line.startsWith('|')) {
      columns = null;
      continue;
    }
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (!columns) {
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.includes('class') && lower.includes('old name')) {
        columns = lower;
        continue;
      }
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    const get = (name) => {
      const idx = columns.indexOf(name);
      return idx >= 0 ? cleanCell(cells[idx]) : '';
    };
    const classLabel = get('class').toLowerCase();
    const cls = CLASS_BY_LABEL[classLabel];
    if (cls === undefined) {
      defects.push(`line ${ln + 1}: unknown class '${classLabel}'`);
      continue;
    }
    const row = {
      cls,
      classLabel,
      oldName: get('old name'),
      newName: get('new name'),
      phase: get('phase'),
      ruling: get('ruling'),
      reason: get('reason'),
      line: ln + 1,
    };
    if (!row.phase || !row.ruling) defects.push(`line ${ln + 1}: phase and ruling are required`);
    if (!row.reason || /^deleted\.?$/i.test(row.reason))
      defects.push(`line ${ln + 1}: a reason saying only 'deleted' (or nothing) is a defect`);
    if (cls && !row.oldName) defects.push(`line ${ln + 1}: a census-class row needs an old name`);
    rows.push(row);
  }
  return { rows, defects };
}

// ---------------------------------------------------------------------------------
// The explained-extras tables of the same doc, CONSUMED since Phase 17 (before that
// the doc tables merely mirrored EXPLAINED_EXTRAS; the constant stays untouched for
// the 11b/11c/11e set and the doc carries every later phase's rows). Only tables
// under a `## Explained extras` heading are read, with columns (any order, matched
// by header text): Class | Name | Phase | Ruling | Reason. Class accepts both the
// deletion-table labels (`export`, `content id`, ...) and the census class keys the
// existing doc tables already use (`exports`, `contentIds`, `contentIdRows`,
// `i18nKeys`, `simEventUnion`, `simEventEmits`). The defective-row rule is the
// deletion table's own: a row missing its name, phase, or ruling, or whose reason
// says only 'deleted' (or nothing), fails the census.
// ---------------------------------------------------------------------------------

const EXTRAS_HEADING_RE = /^##\s+Explained extras\b/;

const EXTRA_CLASS_BY_LABEL = Object.freeze({
  export: 'exports',
  exports: 'exports',
  'content id': 'contentIds',
  'content ids': 'contentIds',
  contentids: 'contentIds',
  'content row': 'contentIdRows',
  'content rows': 'contentIdRows',
  contentidrows: 'contentIdRows',
  'i18n key': 'i18nKeys',
  'i18n keys': 'i18nKeys',
  i18nkeys: 'i18nKeys',
  'simevent union': 'simEventUnion',
  simeventunion: 'simEventUnion',
  'simevent emit': 'simEventEmits',
  'simevent emits': 'simEventEmits',
  simeventemits: 'simEventEmits',
});

/**
 * @param {string} markdown
 * @returns {{ rows: Array<{cls: string, classLabel: string, name: string, phase: string,
 *            ruling: string, reason: string, line: number}>, defects: string[] }}
 */
export function parseExplainedExtras(markdown) {
  const rows = [];
  const defects = [];
  const lines = markdown.split('\n');
  let inExtrasSection = false;
  let columns = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const line = raw.trim();
    if (line.startsWith('#')) {
      inExtrasSection = EXTRAS_HEADING_RE.test(line);
      columns = null;
      continue;
    }
    if (!inExtrasSection) continue;
    if (!line.startsWith('|')) {
      columns = null;
      continue;
    }
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (!columns) {
      const lower = cells.map((c) => c.toLowerCase());
      // A deletions-format table (with an Old name column) is never an extras
      // table, even under this heading; parseDeletionList owns that shape.
      if (lower.includes('class') && lower.includes('name') && !lower.includes('old name')) {
        columns = lower;
        continue;
      }
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    const get = (name) => {
      const idx = columns.indexOf(name);
      return idx >= 0 ? cleanCell(cells[idx]) : '';
    };
    const classLabel = get('class').toLowerCase();
    const cls = EXTRA_CLASS_BY_LABEL[classLabel];
    if (cls === undefined) {
      defects.push(`extras line ${ln + 1}: unknown class '${classLabel}'`);
      continue;
    }
    const row = {
      cls,
      classLabel,
      name: get('name'),
      phase: get('phase'),
      ruling: get('ruling'),
      reason: get('reason'),
      line: ln + 1,
    };
    if (!row.name) defects.push(`extras line ${ln + 1}: an explained-extra row needs a name`);
    if (!row.phase || !row.ruling)
      defects.push(`extras line ${ln + 1}: phase and ruling are required`);
    if (!row.reason || /^deleted\.?$/i.test(row.reason))
      defects.push(
        `extras line ${ln + 1}: a reason saying only 'deleted' (or nothing) is a defect`,
      );
    rows.push(row);
  }
  return { rows, defects };
}

// ---------------------------------------------------------------------------------
// Tree readers: the merged side from disk, the parents through git plumbing.
// ---------------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** True when a repo-relative path is in scope for the census at all. */
export function isCensusPath(relPath) {
  const p = toPosix(relPath);
  const ext = path.posix.extname(p);
  if (!SOURCE_EXTENSIONS.includes(ext)) return false;
  if (GENERATED_FILE_RE.test(p)) return false;
  if (p.split('/').some((seg) => EXCLUDED_DIR_SEGMENTS.includes(seg))) return false;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
  return true;
}

function underRoot(relPath, root) {
  return relPath === root || relPath.startsWith(`${root}/`);
}

/** Walk the merged root on disk; returns [relPath, content] pairs for in-scope files. */
export function readMergedTree(mergedRoot, roots = EXPORT_ROOTS) {
  const files = [];
  const walk = (dirAbs, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (EXCLUDED_DIR_SEGMENTS.includes(ent.name)) continue;
        walk(path.join(dirAbs, ent.name), rel);
      } else if (ent.isFile() && isCensusPath(rel)) {
        files.push([rel, fs.readFileSync(path.join(dirAbs, ent.name), 'utf8')]);
      }
    }
  };
  for (const root of roots) walk(path.join(mergedRoot, root), root);
  return files;
}

/** List + read every in-scope file of a ref without a checkout. */
export function readRefTree(repoDir, ref, roots = EXPORT_ROOTS) {
  const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', ref, '--', ...roots], {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (ls.status !== 0) {
    throw new Error(`git ls-tree failed for ${ref}: ${ls.stderr}`);
  }
  const paths = ls.stdout.split('\n').filter((p) => p && isCensusPath(p));
  const input = paths.map((p) => `${ref}:${p}`).join('\n');
  const cat = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoDir,
    input,
    maxBuffer: 2 * 1024 * 1024 * 1024,
  });
  if (cat.status !== 0) {
    throw new Error(`git cat-file --batch failed for ${ref}: ${cat.stderr}`);
  }
  const buf = cat.stdout;
  const files = [];
  let off = 0;
  let idx = 0;
  while (off < buf.length && idx < paths.length) {
    const nl = buf.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = buf.subarray(off, nl).toString('utf8');
    off = nl + 1;
    const parts = header.split(' ');
    if (parts[1] === 'missing' || parts.length < 3) {
      idx++;
      continue;
    }
    const size = Number(parts[2]);
    const content = buf.subarray(off, off + size).toString('utf8');
    off += size + 1;
    files.push([paths[idx], content]);
    idx++;
  }
  if (files.length !== paths.length) {
    throw new Error(
      `git cat-file returned ${files.length} blobs for ${paths.length} paths (${ref})`,
    );
  }
  return files;
}

// ---------------------------------------------------------------------------------
// Census over one tree: returns per-class name -> Set<file> maps plus limit counts.
// ---------------------------------------------------------------------------------

function addName(map, name, file) {
  let set = map.get(name);
  if (!set) {
    set = new Set();
    map.set(name, set);
  }
  set.add(file);
}

/**
 * @param {Array<[string, string]>} files [relPath, content]
 * @returns {{ sets: Record<string, Map<string, Set<string>>>, limits: Record<string, any>,
 *            contentIdsByPath: Map<string, Set<string>>, fileCounts: Record<string, number> }}
 */
export function censusTree(files) {
  const sets = {
    exports: new Map(),
    contentIds: new Map(),
    contentIdRows: new Map(),
    i18nKeys: new Map(),
    simEventUnion: new Map(),
    simEventEmits: new Map(),
  };
  const limits = {
    exports: {
      exportStar: 0,
      exportDefault: 0,
      exportEquals: 0,
      destructured: 0,
      anonymous: 0,
      unrecognized: 0,
      commonJs: 0,
    },
    contentIds: { nonLiteral: 0, annotationLike: 0, filesWithoutIds: [] },
    i18nKeys: {
      spread: 0,
      computed: 0,
      nonLiteralLeaves: 0,
      methods: 0,
      shorthand: 0,
      roots: 0,
      typeLiteralRootsSkipped: 0,
    },
    simEventUnion: { resolvedAliases: [], unresolvedAliases: [], unionFound: false },
    simEventEmits: { sites: 0, nonLiteral: 0, declarations: 0, helpers: {} },
  };
  const contentIdsByPath = new Map();
  /** export name -> files that DEFINE it (re-export-only files excluded). */
  const exportDefinitions = new Map();
  const fileCounts = { exports: 0, contentIds: 0, i18nKeys: 0, simEventEmits: 0 };
  for (const [rel, content] of files) {
    fileCounts.exports++;
    const tokens = tokenize(content);
    const ex = extractExports(tokens);
    const reexported = new Set(ex.reexports);
    for (const name of ex.names) {
      addName(sets.exports, name, rel);
      if (!reexported.has(name)) addName(exportDefinitions, name, rel);
    }
    for (const k of Object.keys(ex.limits)) limits.exports[k] += ex.limits[k];

    if (underRoot(rel, CONTENT_ROOT)) {
      fileCounts.contentIds++;
      const c = extractContentIds(tokens);
      if (!c.ids.length) limits.contentIds.filesWithoutIds.push(rel);
      for (const id of c.ids) {
        addName(sets.contentIds, id, rel);
        // The SAME row, keyed by its defining file. The bare-name class above
        // cannot see a dropped table ROW whenever the id is reused elsewhere,
        // and this packet is full of such reuse (every farm crop id is also an
        // item id: farm_crops.ts and items.ts both define 'bog_beet'). Dropping
        // the crop row alone left the bare-name census at exit 0, proved by
        // mutation in the Phase 11d QA gate review. Keyed file:id, it is MISSING.
        addName(sets.contentIdRows, `${rel}:${id}`, rel);
        addName(contentIdsByPath, `${rel}:${id}`, rel);
      }
      limits.contentIds.nonLiteral += c.nonLiteral;
      limits.contentIds.annotationLike += c.annotationLike;
    }

    if (underRoot(rel, I18N_CATALOG_ROOT)) {
      fileCounts.i18nKeys++;
      const k = extractI18nKeys(tokens);
      for (const key of k.keys) addName(sets.i18nKeys, key, rel);
      for (const f of Object.keys(limits.i18nKeys)) limits.i18nKeys[f] += k[f];
    }

    if (rel === SIM_EVENT_UNION_FILE) {
      const u = extractSimEventUnion(tokens);
      limits.simEventUnion.unionFound = u.kinds.length > 0 || u.resolvedAliases.length > 0;
      limits.simEventUnion.resolvedAliases = u.resolvedAliases;
      limits.simEventUnion.unresolvedAliases = u.unresolvedAliases;
      for (const kind of u.kinds) addName(sets.simEventUnion, kind, rel);
    }

    if (underRoot(rel, SIM_ROOT)) {
      fileCounts.simEventEmits++;
      const e = extractSimEventEmits(tokens);
      for (const kind of e.kinds) addName(sets.simEventEmits, kind, rel);
      limits.simEventEmits.sites += e.sites;
      limits.simEventEmits.nonLiteral += e.nonLiteral;
      limits.simEventEmits.declarations += e.declarations;
      for (const [h, n] of Object.entries(e.helpers))
        limits.simEventEmits.helpers[h] = (limits.simEventEmits.helpers[h] ?? 0) + n;
    }
  }
  return { sets, limits, contentIdsByPath, exportDefinitions, fileCounts };
}

// ---------------------------------------------------------------------------------
// The comparison.
// ---------------------------------------------------------------------------------

function sortedKeys(map) {
  return [...map.keys()].sort();
}

/** Collapse declaration twins (foo.d.mts beside foo.mjs) to one base for dup counting. */
function defBase(file) {
  return file.replace(/\.d\.[cm]?ts$/, '').replace(/\.[cm]?[jt]s$/, '');
}

/**
 * @param {object} args
 * @param {ReturnType<typeof censusTree>} args.ours
 * @param {ReturnType<typeof censusTree>} args.theirs
 * @param {ReturnType<typeof censusTree>} args.merged
 * @param {ReturnType<typeof parseDeletionList>['rows']} args.deletionRows
 * @param {typeof EXPLAINED_EXTRAS} [args.explainedExtras]
 * @param {typeof FLOORS} [args.floors]
 * @param {Array<ReturnType<typeof censusTree>>} [args.releases]
 * @param {ReturnType<typeof censusTree> | null} [args.base]
 */
export function compareCensus({
  ours,
  theirs,
  merged,
  deletionRows,
  explainedExtras = EXPLAINED_EXTRAS,
  floors = FLOORS,
  /** Census results of the release parents (the synced tip plus any later sync tips). */
  releases = [],
  /** Census result of the merge base (informational annotations only). */
  base = null,
}) {
  const perClass = {};
  const deletionByClass = {};
  for (const cls of CLASSES) deletionByClass[cls] = new Map();
  for (const row of deletionRows) {
    if (row.cls) deletionByClass[row.cls].set(row.oldName, row);
  }
  const extrasByClass = {};
  for (const cls of CLASSES) extrasByClass[cls] = new Map();
  for (const e of explainedExtras) extrasByClass[e.cls]?.set(e.name, e);

  let failed = false;
  for (const cls of CLASSES) {
    const o = ours.sets[cls];
    const t = theirs.sets[cls];
    const m = merged.sets[cls];
    const releaseSets = releases.map((re) => re.sets[cls]);
    const onRelease = (name) => releaseSets.some((set) => set.has(name));
    const union = new Set([...o.keys(), ...t.keys()]);
    for (const set of releaseSets) for (const name of set.keys()) union.add(name);
    const baseSet = base ? base.sets[cls] : null;
    const annotate = (name) => {
      const onRel = releaseSets.length ? onRelease(name) : null;
      const inBase = baseSet ? baseSet.has(name) : null;
      return {
        base: inBase,
        onRelease: onRel,
        // A parent-set name absent from merged that NO release parent carries while
        // base does: the release retired it and a packet parent was behind. Anything
        // else absent from merged is a packet-authored deletion or rename.
        attribution: onRel === false && inBase === true ? 'release' : 'packet',
      };
    };
    const missing = [];
    const deleted = [];
    for (const name of [...union].sort()) {
      if (m.has(name)) continue;
      const row = deletionByClass[cls].get(name);
      const oursFiles = [...(o.get(name) ?? [])].sort();
      const theirsFiles = [...(t.get(name) ?? [])].sort();
      const releaseFiles = [
        ...new Set(releaseSets.flatMap((set) => [...(set.get(name) ?? [])])),
      ].sort();
      const entry = { name, oursFiles, theirsFiles, releaseFiles, ...annotate(name) };
      if (row) deleted.push({ ...entry, row });
      else missing.push(entry);
    }
    const missingPacket = missing.filter((e) => e.attribution === 'packet');
    const missingRelease = missing.filter((e) => e.attribution === 'release');
    const extraExplained = [];
    const extraUnexplained = [];
    for (const name of sortedKeys(m)) {
      if (union.has(name)) continue;
      const row = extrasByClass[cls].get(name);
      const files = [...m.get(name)].sort();
      if (row) extraExplained.push({ name, row, files });
      else extraUnexplained.push({ name, files });
    }
    // Two very different reasons an allowlist entry stops being EXTRA, and only
    // one is a regression (split at the Phase 11d QA fix-round review, which
    // reproduced the false failure):
    //  - GONE from merged: the merge lost a symbol it authored itself. FAIL.
    //  - present, but a PARENT now defines it too: a later release independently
    //    added the same name, so the row is merely obsolete. That is a legitimate
    //    tree, and failing it would red-light an ordinary sync. WARN, drop the row.
    const allowlisted = [...extrasByClass[cls].keys()];
    const unusedExtras = allowlisted.filter((name) => !m.has(name));
    const convergedExtras = allowlisted.filter((name) => m.has(name) && union.has(name));
    const staleDeletionRows = [...deletionByClass[cls].keys()].filter(
      (name) => m.has(name) || !union.has(name),
    );
    // A RENAME's target must actually be present in merged. Six of the seven
    // rename rows are covered incidentally because their new name also lives on
    // a parent, but a rename whose target exists on NO parent (the 11c-authored
    // applyWellFedOnMealComplete) was covered only by the WARN below. Without
    // this the merge's own OUTPUT is the one class the detector cannot see
    // disappear (Phase 11d QA audit).
    const missingRenameTargets = [...deletionByClass[cls].values()]
      .filter((row) => row.newName && !/^\(none\)$/i.test(row.newName.trim()))
      .filter((row) => !m.has(row.newName.trim()))
      .map((row) => ({ name: row.newName.trim(), oldName: row.oldName, line: row.line }));
    const floorOurs = floors[cls]?.ours ?? 0;
    const floorTheirs = floors[cls]?.theirs ?? 0;
    const floorRelease = floors[cls]?.release ?? 0;
    const floorFail =
      o.size < floorOurs ||
      t.size < floorTheirs ||
      releaseSets.some((set) => set.size < floorRelease);
    const defs = merged.exportDefinitions;
    const multiFile = (tree) => {
      const d = tree?.exportDefinitions;
      if (!d) return new Set();
      return new Set(
        sortedKeys(d).filter((name) => new Set([...d.get(name)].map(defBase)).size > 1),
      );
    };
    const duplicates =
      cls === 'exports'
        ? sortedKeys(defs)
            .filter((name) => new Set([...defs.get(name)].map(defBase)).size > 1)
            .map((name) => ({ name, files: [...defs.get(name)].sort() }))
        : [];
    // The DELTA is the signal, not the list. The header calls the
    // extraction-versus-in-place duplicate "precisely what the merge produces
    // with ZERO conflict markers", but the full list is merged-only and prints
    // as an INFO of ~250 names that predate the merge, so a duplicate the MERGE
    // created was indistinguishable from them (Phase 11d QA). A name defined in
    // more than one file on merged and on NO parent is a merge artifact.
    const parentMultiFile =
      cls === 'exports'
        ? new Set([
            ...multiFile(ours),
            ...multiFile(theirs),
            ...releases.flatMap((re) => [...multiFile(re)]),
          ])
        : new Set();
    const newDuplicates =
      cls === 'exports' ? duplicates.filter((d) => !parentMultiFile.has(d.name)) : [];
    // unusedExtras is a FAIL, not a WARN. The header's contract is SET EQUALITY
    // ("EXTRA must be EXACTLY the set the ledgers authored"), but only the subset
    // direction was enforced: un-exporting any of the six 11c-authored names gave
    // MISSING 0, extra unexplained 0, a silent WARN, and exit 0 (Phase 11d QA
    // audit reproduced it on buildConsuming). An allowlist entry that stops being
    // EXTRA means the merged tree lost the symbol the merge itself authored.
    if (
      missing.length ||
      extraUnexplained.length ||
      floorFail ||
      unusedExtras.length ||
      missingRenameTargets.length
    )
      failed = true;
    perClass[cls] = {
      counts: {
        ours: o.size,
        theirs: t.size,
        // EVERY release parent's size, not just the first. The floor is checked
        // per parent (releaseSets.some below), so reporting only releaseSets[0]
        // made a genuine failure on the SECOND parent render with every printed
        // value above its floor: a FAIL flag contradicted by its own numbers,
        // with no ref named. Live since this branch carried two release parents
        // (Phase 11d QA audit).
        release: releaseSets.length ? releaseSets[0].size : 0,
        releaseSizes: releaseSets.map((set) => set.size),
        union: union.size,
        merged: m.size,
        missing: missing.length,
        missingPacket: missingPacket.length,
        missingRelease: missingRelease.length,
        deleted: deleted.length,
        extra: extraExplained.length + extraUnexplained.length,
        extraExplained: extraExplained.length,
        extraUnexplained: extraUnexplained.length,
      },
      floors: { ours: floorOurs, theirs: floorTheirs, release: floorRelease, fail: floorFail },
      missing,
      missingPacket,
      missingRelease,
      deleted,
      extraExplained,
      extraUnexplained,
      unusedExtras,
      convergedExtras,
      missingRenameTargets,
      staleDeletionRows,
      duplicates,
      newDuplicates,
    };
  }
  return { perClass, failed };
}

// ---------------------------------------------------------------------------------
// Report formatting.
// ---------------------------------------------------------------------------------

function fmtList(items, limit, render) {
  const out = [];
  const shown = items.slice(0, limit);
  for (const it of shown) out.push(`    ${render(it)}`);
  if (items.length > shown.length) out.push(`    ... ${items.length - shown.length} more`);
  return out;
}

/**
 * @param {object} r the result of runCensus
 * @param {number} [limit] max list rows per section
 */
export function formatReport(r, limit = 60) {
  const L = [];
  L.push('symbol census (Phase 11d unit 5)');
  L.push(`  base   ${r.refs.base} (informational)`);
  L.push(`  ours   ${r.refs.ours}`);
  L.push(`  theirs ${r.refs.theirs}`);
  // The merged side is read from the WORKING TREE, so the report has to say which
  // tree. Without this a run recorded as "census PASS at <sha>" can attest to a
  // state no commit contains: during the 11d QA, HEAD moved under two lanes
  // mid-audit and their reports carried no stamp to notice it with.
  L.push(`  merged ${r.mergedRoot}${r.mergedStamp ? ` ${r.mergedStamp}` : ''}`);
  L.push(
    `  release parent(s) (${r.releaseRefs.length}): ${r.releaseRefs.map((re) => `${re.ref.slice(0, 10)}${re.via ? ` (via merge ${re.via.slice(0, 10)})` : ''}`).join(', ') || '-'}  (prior synced tip ${PRIOR_SYNC_TIP.slice(0, 10)})`,
  );
  L.push(
    `  deletion list ${r.deletionListPath} (${r.deletionRows.length} rows, ${r.deletionConsumed} census-class)`,
  );
  L.push(
    `  files scanned: ours ${r.fileCounts.ours.exports}, theirs ${r.fileCounts.theirs.exports}, merged ${r.fileCounts.merged.exports} (content ${r.fileCounts.merged.contentIds}, catalog ${r.fileCounts.merged.i18nKeys}, sim ${r.fileCounts.merged.simEventEmits} on merged)`,
  );
  L.push(
    `  explained extras: ${r.extrasConstantRows ?? EXPLAINED_EXTRAS.length} constant + ${r.extrasDocRows ?? 0} doc rows (the doc's "Explained extras" tables are consumed, not a mirror)`,
  );
  if (r.deletionDefects.length) {
    L.push('  DELETION LIST DEFECTS (fail):');
    for (const d of r.deletionDefects) L.push(`    ${d}`);
  }
  if (r.extrasDefects?.length) {
    L.push('  EXPLAINED-EXTRAS DEFECTS (fail):');
    for (const d of r.extrasDefects) L.push(`    ${d}`);
  }
  L.push('');
  for (const cls of CLASSES) {
    const c = r.perClass[cls];
    const n = c.counts;
    L.push(`[${cls}] ${CLASS_LABELS[cls]}`);
    L.push(
      `  |ours| ${n.ours}  |theirs| ${n.theirs}  |release| ${(n.releaseSizes ?? [n.release]).join('/')}  |union| ${n.union}  |merged| ${n.merged}  |missing| ${n.missing} (packet ${n.missingPacket}, release-attributable ${n.missingRelease})  |extra| ${n.extra} (explained ${n.extraExplained}, unexplained ${n.extraUnexplained})  deletion-list hits ${n.deleted}`,
    );
    L.push(
      `  floors: ours >= ${c.floors.ours} (observed ${n.ours}), theirs >= ${c.floors.theirs} (observed ${n.theirs}), release >= ${c.floors.release} (observed ${(n.releaseSizes ?? [n.release]).join(', ')})  ${c.floors.fail ? 'FAIL' : 'ok'}`,
    );
    const where = (m) =>
      `[ours: ${m.oursFiles.join(', ') || '-'}] [theirs: ${m.theirsFiles.join(', ') || '-'}] [release: ${m.releaseFiles.join(', ') || '-'}] base:${m.base === null ? '?' : m.base ? 'yes' : 'no'}`;
    L.push(
      `  MISSING, packet-attributable (${c.missingPacket.length})${c.missingPacket.length ? ' FAIL' : ''}:`,
    );
    L.push(...fmtList(c.missingPacket, limit, (m) => `${m.name}  ${where(m)}`));
    L.push(
      `  MISSING, release-attributable (${c.missingRelease.length})${c.missingRelease.length ? ' FAIL' : ''}: (no release parent carries it, base does: the release retired it and a packet parent was behind; still needs a deletion-list row)`,
    );
    L.push(...fmtList(c.missingRelease, limit, (m) => `${m.name}  ${where(m)}`));
    L.push(`  deleted per the list (${c.deleted.length}):`);
    L.push(
      ...fmtList(
        c.deleted,
        limit,
        (d) =>
          `${d.name}${d.row.newName ? ` -> ${d.row.newName}` : ''}  (${d.row.phase}, ${d.row.ruling})  ${where(d)}`,
      ),
    );
    L.push(`  EXTRA explained (${c.extraExplained.length}):`);
    L.push(
      ...fmtList(
        c.extraExplained,
        limit,
        (e) => `${e.name}  [${e.files.join(', ')}]  (${e.row.phase}, ${e.row.ruling})`,
      ),
    );
    L.push(
      `  EXTRA unexplained (${c.extraUnexplained.length})${c.extraUnexplained.length ? ' FAIL' : ''}:`,
    );
    L.push(...fmtList(c.extraUnexplained, limit, (e) => `${e.name}  [${e.files.join(', ')}]`));
    if (c.unusedExtras.length)
      L.push(
        `  FAIL allowlist entries GONE from merged (the merge authored these and then lost ` +
          `them): ${c.unusedExtras.join(', ')}`,
      );
    if (c.convergedExtras?.length)
      L.push(
        `  WARN allowlist entries a PARENT now defines too, so no longer EXTRA (a later release ` +
          `added the same name; the row is obsolete, not a regression): ${c.convergedExtras.join(', ')}`,
      );
    if (c.missingRenameTargets?.length)
      L.push(
        `  FAIL rename targets absent from merged: ${c.missingRenameTargets
          .map((r) => `${r.oldName} -> ${r.name} (deletion list line ${r.line})`)
          .join(', ')}`,
      );
    if (c.staleDeletionRows.length)
      L.push(
        `  WARN deletion-list rows not matching a missing name: ${c.staleDeletionRows.join(', ')}`,
      );
    if (cls === 'exports') {
      // The delta first, because it is the only part the MERGE is answerable for.
      L.push(
        `  ${c.newDuplicates?.length ? 'WARN' : 'INFO'} names newly defined in more than one file ON MERGED and on NO parent (the extraction-versus-in-place duplicate this merge could produce with zero conflict markers): ${c.newDuplicates?.length ?? 0}`,
      );
      L.push(...fmtList(c.newDuplicates ?? [], limit, (d) => `${d.name}  [${d.files.join(', ')}]`));
      L.push(
        `  INFO names DEFINED in more than one merged file (re-export-only files excluded; declaration twins collapsed; most predate the merge, see the delta above): ${c.duplicates.length}`,
      );
      L.push(...fmtList(c.duplicates, limit, (d) => `${d.name}  [${d.files.join(', ')}]`));
    }
    L.push('');
  }
  // The SimEvent types the union DECLARES that the emits extractor never sees.
  // Counted as "nonLiteral" before, which hid which NAMES they were: the emits
  // walk records only emit({ type: '<literal>' }), so an event emitted through a
  // helper callback (emitToZonePlayers) or a ternary is invisible to that class,
  // and a hunk dropping the CALL while leaving the union arm and the helper
  // export passes every class. Four of these are the packets' own, in
  // src/sim/professions/, the directory both packets rewrote (Phase 11d QA).
  // Printed BY NAME so the gap is reviewable rather than a bare count.
  const unionOnly = r.simEventUnionOnly ?? [];
  const unionOnlyDrift = r.simEventUnionOnlyDrift ?? { added: [], removed: [] };
  const drifted = unionOnlyDrift.added.length > 0 || unionOnlyDrift.removed.length > 0;
  L.push(
    `SimEvent types DECLARED but never seen emitted by the extractor (${unionOnly.length}); ` +
      'the server-side ones are legitimately outside the sim scan root, the rest are ' +
      `helper-emitted and are a real blind spot: ${drifted ? 'FAIL, the set DRIFTED' : 'ok, matches the pin'}`,
  );
  L.push(`  ${unionOnly.join(', ') || '-'}`);
  if (r.emitsOutsideUnion?.length)
    L.push(
      `  FAIL emitted kinds that are NOT declared union members (the indirect resolver minted a bogus kind): ${r.emitsOutsideUnion.join(', ')}`,
    );
  if (unionOnlyDrift.added.length)
    L.push(
      `  FAIL new to the blind spot (a helper-emitted event the census cannot see): ${unionOnlyDrift.added.join(', ')}`,
    );
  if (unionOnlyDrift.removed.length)
    L.push(
      `  FAIL left the blind spot: ${unionOnlyDrift.removed.join(', ')} (either it became a literal emit, so drop it from SIM_EVENT_UNION_ONLY, or it stopped being emitted at all)`,
    );
  L.push('');
  L.push('blind spots (counted, never silent):');
  for (const side of ['ours', 'theirs', 'merged']) {
    const lim = r.limits[side];
    L.push(
      `  ${side}: exports{star ${lim.exports.exportStar}, default ${lim.exports.exportDefault}, equals ${lim.exports.exportEquals}, destructured ${lim.exports.destructured}, anonymous ${lim.exports.anonymous}, unrecognized ${lim.exports.unrecognized}, commonJs ${lim.exports.commonJs}} contentIds{nonLiteral ${lim.contentIds.nonLiteral} (annotation-like ${lim.contentIds.annotationLike}), filesWithoutIds ${lim.contentIds.filesWithoutIds.length}} i18n{roots ${lim.i18nKeys.roots}, spread ${lim.i18nKeys.spread}, computed ${lim.i18nKeys.computed}, nonLiteralLeaves ${lim.i18nKeys.nonLiteralLeaves}, methods ${lim.i18nKeys.methods}, shorthand ${lim.i18nKeys.shorthand}} union{found ${lim.simEventUnion.unionFound}, aliases ${lim.simEventUnion.resolvedAliases.join('+') || '-'}, unresolved ${lim.simEventUnion.unresolvedAliases.join('+') || '-'}} emits{sites ${lim.simEventEmits.sites}, nonLiteral ${lim.simEventEmits.nonLiteral}, declarations ${lim.simEventEmits.declarations}}`,
    );
  }
  const helpers = r.limits.merged.simEventEmits.helpers;
  L.push(
    `  emit helpers seen on merged: ${Object.entries(helpers)
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `${h} x${n}`)
      .join(', ')}`,
  );
  L.push(
    `  merged content files with no plain id literal: ${r.limits.merged.contentIds.filesWithoutIds.join(', ') || '-'}`,
  );
  L.push('');
  L.push(r.failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { oursRef: OURS_REF, theirsRef: THEIRS_REF, limit: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--merged-root') opts.mergedRoot = val();
    else if (a === '--repo') opts.repo = val();
    else if (a === '--ours') opts.oursRef = val();
    else if (a === '--theirs') opts.theirsRef = val();
    else if (a === '--json') opts.json = val();
    else if (a === '--deletion-list') opts.deletionList = val();
    else if (a === '--limit') opts.limit = Number(val());
    else if (a === '--release') opts.releaseRef = val();
    else if (a === '--sync') {
      opts.syncRefs = opts.syncRefs ?? [];
      opts.syncRefs.push(val());
    } else if (a === '--no-auto-sync') opts.autoSync = false;
    else if (a === '--no-base') opts.readBase = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/**
 * Later release tips synced after the absorb merge: every merge commit on the branch's
 * own first-parent chain after ABSORB_MERGE_COMMIT contributes its second parent
 * (--first-parent, so the release branch's own PR merges that a sync brings along are
 * not listed twice). RELEASE_REF is always a release parent regardless; this catches
 * the syncs after it. Returns [] when the range cannot be listed (a detached scratch
 * repo, the commit missing).
 * @param {string} repoDir
 * @param {string} [head]
 * @returns {Array<{ref: string, via: string}>}
 */
export function deriveSyncRefs(repoDir, head = 'HEAD') {
  const log = spawnSync(
    'git',
    ['log', '--first-parent', '--merges', '--format=%H %P', `${ABSORB_MERGE_COMMIT}..${head}`],
    { cwd: repoDir, encoding: 'utf8' },
  );
  if (log.status !== 0) return [];
  const out = [];
  for (const line of log.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [via, , second] = parts;
    out.push({ ref: second, via });
  }
  return out;
}

export function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Run the whole census.
 * @param {object} opts
 */
export function runCensus(opts = {}) {
  const repo = path.resolve(opts.repo ?? repoRootFromScript());
  const mergedRoot = path.resolve(opts.mergedRoot ?? repo);
  const deletionListPath = path.resolve(opts.deletionList ?? path.join(repo, DELETION_LIST_PATH));
  const oursRef = opts.oursRef ?? OURS_REF;
  const theirsRef = opts.theirsRef ?? THEIRS_REF;

  const releaseRef = opts.releaseRef ?? RELEASE_REF;

  const deletionMarkdown = fs.readFileSync(deletionListPath, 'utf8');
  const deletion = parseDeletionList(deletionMarkdown);
  const docExtras = parseExplainedExtras(deletionMarkdown);
  const explainedExtras = [...EXPLAINED_EXTRAS, ...docExtras.rows];
  const ours = censusTree(readRefTree(repo, oursRef));
  const theirs = censusTree(readRefTree(repo, theirsRef));
  const merged = censusTree(readMergedTree(mergedRoot));
  // Stamp the tree the merged side was actually read from: HEAD plus whether the
  // working tree was dirty at read time. Only for a real worktree; a scratch
  // --merged-root is not one and gets no stamp.
  const mergedStamp = (() => {
    if (path.resolve(mergedRoot) !== path.resolve(repo)) return 'scratch copy (not a git worktree)';
    const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    if (rev.status !== 0) return '';
    const st = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    const dirty = st.status === 0 && st.stdout.trim().length > 0;
    return `at HEAD ${rev.stdout.trim().slice(0, 10)}${
      dirty ? ' (WORKING TREE DIRTY: this census describes uncommitted state)' : ' (clean)'
    }`;
  })();
  // The release parent set: the synced tip, plus the second parent of every later
  // first-parent merge, plus any --sync additions; resolved to full SHAs and deduped.
  const resolve = (ref) => {
    const rev = spawnSync('git', ['rev-parse', `${ref}^{commit}`], {
      cwd: repo,
      encoding: 'utf8',
    });
    return rev.status === 0 ? rev.stdout.trim() : ref;
  };
  const releaseRefs = [];
  const seenRefs = new Set();
  for (const cand of [
    { ref: releaseRef, via: null },
    ...(opts.autoSync === false ? [] : deriveSyncRefs(repo)),
    ...(opts.syncRefs ?? []).map((ref) => ({ ref, via: null })),
  ]) {
    const full = resolve(cand.ref);
    if (seenRefs.has(full)) continue;
    seenRefs.add(full);
    releaseRefs.push({ ref: full, via: cand.via });
  }
  const releases = releaseRefs.map((re) => censusTree(readRefTree(repo, re.ref)));
  const base = opts.readBase === false ? null : censusTree(readRefTree(repo, BASE_REF));
  const cmp = compareCensus({
    ours,
    theirs,
    merged,
    deletionRows: deletion.rows,
    explainedExtras,
    releases,
    base,
  });
  const simEvent = simEventVerdict(merged.sets.simEventUnion, merged.sets.simEventEmits);
  const {
    unionOnly: simEventUnionOnly,
    drift: simEventUnionOnlyDrift,
    emitsOutsideUnion,
  } = simEvent;
  const failed =
    cmp.failed || deletion.defects.length > 0 || docExtras.defects.length > 0 || simEvent.failed;
  return {
    refs: { base: BASE_REF, ours: oursRef, theirs: theirsRef, priorSyncTip: PRIOR_SYNC_TIP },
    releaseRefs,
    mergedRoot,
    mergedStamp,
    deletionListPath,
    deletionRows: deletion.rows,
    deletionConsumed: deletion.rows.filter((r) => r.cls).length,
    deletionDefects: deletion.defects,
    extrasConstantRows: EXPLAINED_EXTRAS.length,
    extrasDocRows: docExtras.rows.length,
    extrasDefects: docExtras.defects,
    fileCounts: { ours: ours.fileCounts, theirs: theirs.fileCounts, merged: merged.fileCounts },
    /** SimEvent types the union declares that the emits extractor never sees. */
    simEventUnionOnly,
    simEventUnionOnlyDrift,
    emitsOutsideUnion,
    limits: { ours: ours.limits, theirs: theirs.limits, merged: merged.limits },
    perClass: cmp.perClass,
    failed,
    // Raw sets for --json consumers (sorted names with their files).
    sets: {
      ours: serializeSets(ours.sets),
      theirs: serializeSets(theirs.sets),
      merged: serializeSets(merged.sets),
      // EVERY release parent, not just the first: with two of them, serializing
      // only releases[0] made the --json dump disagree with the per-parent floor
      // check that runs over all of them (Phase 11d QA). `release` stays for
      // back-compat readers; `releases` is the honest one.
      release: releases.length ? serializeSets(releases[0].sets) : null,
      releases: releases.map((re) => serializeSets(re.sets)),
    },
    contentIdsByPath: {
      ours: sortedKeys(ours.contentIdsByPath),
      theirs: sortedKeys(theirs.contentIdsByPath),
      merged: sortedKeys(merged.contentIdsByPath),
    },
  };
}

function serializeSets(sets) {
  const out = {};
  for (const cls of CLASSES) {
    out[cls] = {};
    for (const name of sortedKeys(sets[cls])) out[cls][name] = [...sets[cls].get(name)].sort();
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runCensus(opts);
  process.stdout.write(`${formatReport(result, opts.limit)}\n`);
  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
    process.stdout.write(`json written to ${opts.json}\n`);
  }
  process.exitCode = result.failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export const meta = {
  name: 'ip-refactor-tracks',
  description: 'Run the four IP-rename tracks (Vocab, Creatures, World, Text) concurrently, each gated + WM-logged, then serialized integration into feature/ip-pivot (regen-reconciled artifacts)',
  phases: [
    { title: 'Vocab track', detail: 'V1 -> V2 in wt-ip-vocab, sequential, gated' },
    { title: 'Creatures track', detail: 'C1 -> C2 in wt-ip-creatures, sequential, gated (the only id-changing track)' },
    { title: 'World track', detail: 'W1 -> W2 in wt-ip-world, sequential, gated' },
    { title: 'Text track', detail: 'T1 in wt-ip-text' },
    { title: 'Integrate', detail: 'serialized: merge each track into feature/ip-pivot, RE-RUN the generators to reconcile artifacts, re-gate' },
  ],
}

// PRECONDITION (run the spine MANUALLY first, like the world-api W0a-W1 spine):
//   G0 (tests/ip_scrub.test.ts scanner + allowlist) and G1 (NAME-MAP.md filled + operator LOCKED)
//   must be committed on feature/ip-pivot BEFORE this orchestrator runs. Tracks apply the LOCKED
//   NAME-MAP; if it is not LOCKED, every slice STOPS.

const BASE = '/Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft' // feature/ip-pivot (integration target)
const VOCAB_WT = '/Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-vocab'       // track/ip-vocab
const CREAT_WT = '/Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-creatures'   // track/ip-creatures
const WORLD_WT = '/Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-world'       // track/ip-world
const TEXT_WT  = '/Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-text'        // track/ip-text
const PKT = '/Users/reubenhorne/Documents/code/woc-refactor/ip-refactor'
const WM = `${PKT}/02-WORKING-MEMORY.md`

// The regen that EVERY rename slice runs after its English edits (deterministic, idempotent).
const REGEN = 'npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content'
// Base gate: behavior UNCHANGED (parity goldens byte-identical) + the English resolves + guide
// fresh + types. NOTE: tests/ip_scrub is NOT in the per-slice gate -- it is committed RED by G0
// and stays globally RED until Z1 (other slices' names are still present), so a per-slice run
// would always fail. Instead the INSPECTOR re-scans just THIS slice's cleared names (below), and
// Z1 requires the full scanner green. Slices append their extras.
const BASE_GATE = 'npx vitest run tests/parity tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts && npx tsc --noEmit'

const RENAME_NOTE = 'PRIME DIRECTIVE: RENAME DISPLAY, FREEZE IDS. Apply the LOCKED NAME-MAP.md VERBATIM; never invent an off-map name (STOP and append a request row to working memory instead). For ABILITIES/ITEMS edit BOTH English copies byte-identical (the sim content .name AND the i18n.catalog entry) or i18n_resolved_equivalence reds. For MOBS/QUESTS/ZONES edit ONLY the sim content .name (world_entity_i18n re-derives the en slice). After editing, run the regen (' + REGEN + ') and commit the regenerated artifacts (i18n.resolved.generated/*, i18n.resolved.sha256, guide/content.generated.ts) TOGETHER with the source edit (the equivalence gate only passes with both). NEVER edit a src/ui/i18n.locales/<lang>.ts overlay (English only; the maintainer fills locales at release). Every id is FROZEN. tests/parity goldens MUST stay byte-identical (a display rename changes no sim state); if a golden shifts you changed behavior or an id, STOP.'
const COINED_NOTE = 'THIS IS THE COINED-ID SWEEP (C1/C2 only): the one slice type that renames CODE IDS, atomically across every file that keys off them. It is the ONLY place a parity golden may change, and ONLY by the exact renamed token (nothing else). If a golden changes by more than the token swap, STOP. ' + RENAME_NOTE

const SLICES = {
  V1: { repo: VOCAB_WT, branch: 'track/ip-vocab', track: 'Vocab', brief: `${PKT}/V1-abilities.md`, mode: 'plain',
        gate: BASE_GATE, note: RENAME_NOTE,
        allowed: ['src/sim/content/classes.ts', 'src/ui/i18n.catalog/abilities.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  V2: { repo: VOCAB_WT, branch: 'track/ip-vocab', track: 'Vocab', brief: `${PKT}/V2-talents.md`, mode: 'plain',
        gate: `${BASE_GATE.replace('&& npx tsc', '&& npx vitest run tests/talents.test.ts && npx tsc')}`, note: RENAME_NOTE,
        allowed: ['src/sim/content/talents_classic.ts', 'src/ui/talent_i18n.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  C1: { repo: CREAT_WT, branch: 'track/ip-creatures', track: 'Creatures', brief: `${PKT}/C1-creatures-core.md`, mode: 'ULTRACODE',
        gate: `npx vitest run tests/parity tests/architecture.test.ts tests/localization_fixes.test.ts tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts && npx tsc --noEmit`, note: COINED_NOTE,
        allowed: ['src/sim/types.ts', 'src/sim/sim.ts', 'src/render/characters/manifest.ts', 'src/sim/content/zone1.ts', 'src/sim/content/zone2.ts', 'src/sim/content/zone3.ts', 'src/sim/content/temple.ts', 'src/sim/content/dungeons.ts', 'src/sim/content/items.ts', 'src/sim/content/removed_zone1_content.ts', 'src/game/auto_attack.ts', 'src/ui/i18n.catalog/items.ts', 'src/ui/sim_i18n.ts', 'src/ui/world_entity_i18n.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  C2: { repo: CREAT_WT, branch: 'track/ip-creatures', track: 'Creatures', brief: `${PKT}/C2-warlock-pets.md`, mode: 'ULTRACODE',
        gate: `npx vitest run tests/parity tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts && npx tsc --noEmit`, note: COINED_NOTE,
        // NOTE: C2 does NOT touch src/sim/content/classes.ts (V1 owns it, incl. the warlock summon-description demon-noun scrub applied from the LOCKED map) to avoid a cross-track conflict on classes.ts.
        allowed: ['src/sim/content/warlock_pets.ts', 'src/render/characters/manifest.ts', 'src/ui/entity_i18n.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  W1: { repo: WORLD_WT, branch: 'track/ip-world', track: 'World', brief: `${PKT}/W1-items.md`, mode: 'plain',
        gate: BASE_GATE, note: RENAME_NOTE + ' NOTE: "Slimy Murloc Scale" and "Bristleback Maul" are OWNED BY C1 (murloc/Bristleback-coined); do NOT touch those two rows here.',
        allowed: ['src/sim/content/items.ts', 'src/sim/content/item_sets.ts', 'src/sim/content/augments.ts', 'src/sim/content/zone2.ts', 'src/sim/content/zone3.ts', 'src/sim/content/temple.ts', 'src/ui/i18n.catalog/items.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  W2: { repo: WORLD_WT, branch: 'track/ip-world', track: 'World', brief: `${PKT}/W2-mob-mechanic-names.md`, mode: 'plain',
        gate: `npx vitest run tests/parity tests/localization_fixes.test.ts tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts && npx tsc --noEmit`, note: RENAME_NOTE + ' S3: the mob mechanic name has NO id; it keys off the English STRING, so edit the inline name AND its src/ui/sim_i18n.ts AURA_NAME_KEY entry in the SAME commit, then run tests/localization_fixes.test.ts.',
        allowed: ['src/sim/content/dungeons.ts', 'src/sim/content/zone2.ts', 'src/sim/content/zone3.ts', 'src/ui/sim_i18n.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
  T1: { repo: TEXT_WT, branch: 'track/ip-text', track: 'Text', brief: `${PKT}/T1-debrand-text.md`, mode: 'plain',
        gate: `npx tsc --noEmit && npx vitest run tests/i18n_resolved_equivalence.test.ts tests/guide.test.ts`, note: 'De-brand text (comments/docs/README) + optional realm copy. NO ids, NO mechanics. Only regen if you change a player-visible t() string (realm copy); comment/doc edits need no regen. Do not touch the brand name "World of ClaudeCraft" (deferred).',
        allowed: ['README.md', 'server/realm.ts', 'src/main.ts', 'src/ui/i18n.catalog/', 'src/ui/hud.ts', 'src/ui/i18n.resolved.generated/', 'src/ui/i18n.resolved.sha256', 'src/guide/content.generated.ts'] },
}

// Which slices to run this invocation. Edit these two arrays across sessions as tracks land.
const VOCAB = ['V1', 'V2']
const CREATURES = ['C1', 'C2']
const WORLD = ['W1', 'W2']
const TEXT = ['T1']
const INTEGRATE = false // STOP after the tracks, BEFORE integration (operator reviews, then a fresh session integrates via 05-INTEGRATION.md / the integrate stage below)

const IMPL_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['status', 'gateGreen', 'commits', 'filesTouched', 'goldensChanged', 'scannerEntriesCleared', 'wmUpdated', 'summary', 'blockers'],
  properties: {
    status: { type: 'string', enum: ['green', 'red', 'blocked'] },
    gateGreen: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    goldensChanged: { type: 'array', items: { type: 'string' }, description: 'existing tests/parity goldens that changed (MUST be empty for a display rename; C1/C2: token-swap-only)' },
    scannerEntriesCleared: { type: 'array', items: { type: 'string' }, description: 'NAME-MAP old-names this slice removed from the ip_scrub allowlist' },
    wmUpdated: { type: 'boolean' },
    summary: { type: 'string' }, blockers: { type: 'string' },
  } }
const INSPECT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['gateReRunGreen', 'gateTail', 'touchedForbidden', 'forbiddenDetails', 'goldenViolation', 'goldenDetails', 'diffStat'],
  properties: {
    gateReRunGreen: { type: 'boolean' }, gateTail: { type: 'string' },
    touchedForbidden: { type: 'boolean' }, forbiddenDetails: { type: 'string' },
    goldenViolation: { type: 'boolean', description: 'true if an existing golden changed by more than a C1/C2 token swap' }, goldenDetails: { type: 'string' },
    diffStat: { type: 'string' },
  } }
const REVIEW_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['verdict', 'blocking', 'shouldFix', 'coverageGaps'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'PASS_WITH_FOLLOWUPS', 'FAIL'] },
    blocking: { type: 'array', items: { type: 'string' } }, shouldFix: { type: 'array', items: { type: 'string' } }, coverageGaps: { type: 'string' } } }

async function runSlice(id) {
  const cfg = SLICES[id]
  const impl = await agent(
    `You are autonomously executing IP-rename slice ${id} (${cfg.mode}), track ${cfg.track}.
Working dir: ${cfg.repo} -- a DEDICATED git worktree pinned to ${cfg.branch}; it is yours, but the working-memory file ${WM} is SHARED across tracks. ALWAYS run git via 'git -C ${cfg.repo} ...'. Confirm 'git -C ${cfg.repo} branch --show-current' == ${cfg.branch} BEFORE editing; else STOP status:blocked.
Read in full: ${cfg.brief}, ${PKT}/00-SHARED-CONVENTIONS.md, ${PKT}/README.md, the LOCKED ${PKT}/NAME-MAP.md, and the SHARED ${WM} (check the status board + the scanner allowlist before you start; mark slice ${id} in-progress). If NAME-MAP.md STATUS is not LOCKED, STOP status:blocked.
Execute the brief through its Acceptance Criteria. This is a real edit.
SLICE NOTE (authoritative, overrides the brief where explicit): ${cfg.note}

HARD RULES (violate any -> status:blocked, do NOT force):
- NEVER switch branches / no git checkout|switch|restore|worktree|pull|fetch|rebase|reset|stash. Edit, gate, commit-by-path only. Do NOT 'git push'.
- Touch ONLY these repo paths: ${JSON.stringify(cfg.allowed)}. Apply the LOCKED NAME-MAP verbatim; never invent an off-map name. NEVER edit a src/ui/i18n.locales/<lang>.ts overlay. NEVER modify an EXISTING tests/parity/golden/ file (EXCEPTION: a C1/C2 coined-id token swap may change a golden by EXACTLY the renamed token -- if it does, list it in goldensChanged). NEVER loosen/skip the ip_scrub scanner or any assertion; if the gate is red, fix YOUR edit.
- Commit locally, green-only, EXPLICIT paths (the source edit + the regenerated artifacts together), Conventional Commits, no attribution footer / em-dash / en-dash / emoji.
THE GATE: ${cfg.gate}  (use a generous Bash timeout). It must pass before you commit. Run the regen (${REGEN}) after your edits and before the gate.
Effort: xhigh.${cfg.mode === 'ULTRACODE' ? ' ULTRACODE: after the rename, self-verify adversarially -- re-read your diff trying to REFUTE that (a) every id stayed frozen except the declared coined-id swap, (b) no existing golden moved beyond the token swap, (c) both English copies are byte-identical. If you cannot fully refute a behavior/id change, STOP status:blocked.' : ''}

FINAL STEP (required): update ${WM}. Re-read it first (shared), then APPEND-ONLY: flip slice ${id}'s status row to 'done-on-track (${cfg.branch} @ <sha>)', tick the scanner-allowlist entries you cleared, and log which generated artifacts you regenerated. Edit ONLY slice ${id}'s own rows. Set wmUpdated=true.
Return the schema: status, gateGreen, commits, filesTouched, goldensChanged, scannerEntriesCleared, wmUpdated, summary, blockers.`,
    { label: `impl:${id}`, phase: `${cfg.track} track`, schema: IMPL_SCHEMA, agentType: 'claude', effort: 'xhigh' },
  )
  if (!impl || impl.status !== 'green' || !impl.gateGreen) {
    log(`STOP ${id}: implementer status=${impl ? impl.status : 'null'}`)
    return { id, track: cfg.track, verdict: 'STOP', stage: 'implement', impl }
  }
  const inspect = await agent(
    `INDEPENDENT INSPECTOR for IP-rename slice ${id}. Working dir ${cfg.repo}, branch ${cfg.branch}. Do NOT edit; only verify.
Implementer claims ${impl.commits.length} commit(s) ${JSON.stringify(impl.commits)} touching ${JSON.stringify(impl.filesTouched)}, goldensChanged=${JSON.stringify(impl.goldensChanged)}.
1. Re-run the gate FRESH: ${cfg.gate} (generous timeout). Report pass + last ~15 lines.
2. Inspect ONLY this slice's delta: SLICE_RANGE = HEAD~${impl.commits.length}..HEAD. 'git -C ${cfg.repo} diff --stat SLICE_RANGE' + '--name-only'. Every changed file must be within ${JSON.stringify(cfg.allowed)}. EXCLUDE the working-memory file (outside the repo).
3. GOLDEN RULE: 'git -C ${cfg.repo} diff --diff-filter=MD --name-only SLICE_RANGE -- tests/parity/golden/' -- for a plain rename this MUST be empty. For a C1/C2 coined-id sweep, any changed golden's diff must contain ONLY the renamed token (run 'git -C ${cfg.repo} diff SLICE_RANGE -- tests/parity/golden/' and confirm every -/+ pair differs ONLY by the coined token). Set goldenViolation=true if a golden changed on a plain slice, or changed by more than the token swap on C1/C2.
4. ID-FREEZE: grep the source diff for any changed id-key/enum-string OUTSIDE the declared coined-id swap; that is a violation (set touchedForbidden).
5. BYTE-IDENTICAL ENGLISH (abilities/items): confirm the sim record .name and the i18n.catalog entry match for every renamed row. No weakened assertion, no edited locale overlay, no loosened test.
6. IP CLEARED (targeted): for THIS slice's cleared names ${JSON.stringify(impl.scannerEntriesCleared)}, grep the resolved English table (src/ui/i18n.resolved.generated/en.ts) AND the edited content for each old name and confirm ZERO hits (the slice actually renamed them), and confirm no NEW denylist name was introduced. The FULL tests/ip_scrub stays RED until Z1 (expected); do NOT require it green here.
Return: gateReRunGreen, gateTail, touchedForbidden, forbiddenDetails, goldenViolation, goldenDetails, diffStat.`,
    { label: `inspect:${id}`, phase: `${cfg.track} track`, schema: INSPECT_SCHEMA, agentType: 'claude', effort: 'medium' },
  )
  if (!inspect || !inspect.gateReRunGreen || inspect.touchedForbidden || inspect.goldenViolation) {
    log(`STOP ${id}: inspector gate=${inspect ? inspect.gateReRunGreen : 'null'} forbidden=${inspect ? inspect.touchedForbidden : 'n/a'} golden=${inspect ? inspect.goldenViolation : 'n/a'}`)
    return { id, track: cfg.track, verdict: 'STOP', stage: 'inspect', impl, inspect }
  }
  const review = await agent(
    `COVERAGE reviewer for IP-rename slice ${id}. Working dir ${cfg.repo}. Read ${cfg.brief} (Acceptance Criteria + Review) and the LOCKED ${PKT}/NAME-MAP.md.
AUTHORITATIVE NOTE (overrides the brief where it conflicts): ${cfg.note}
Inspect ONLY this slice's delta (HEAD~${impl.commits.length}..HEAD). Job is COVERAGE not filtering: report every unmet acceptance criterion / off-map name / un-renamed NAME-MAP row / mismatched English copy / id that should have stayed frozen / golden that should not have moved, with severity. Verdict FAIL only if a brief acceptance criterion is unmet or a gate cannot catch a drift it claims. Return: verdict, blocking, shouldFix, coverageGaps.`,
    { label: `review:${id}`, phase: `${cfg.track} track`, schema: REVIEW_SCHEMA, agentType: 'claude', effort: 'high' },
  )
  const verdict = (review && review.verdict === 'FAIL') ? 'STOP' : 'PASS'
  log(`Slice ${id}: ${verdict} (gate green, diff clean, review=${review ? review.verdict : 'null'})`)
  return { id, track: cfg.track, verdict, impl, inspect, review }
}

async function runTrack(name, ids) {
  const out = []
  for (const id of ids) {
    const r = await runSlice(id)
    out.push(r)
    if (r.verdict === 'STOP') { log(`Track ${name} HALTED at ${id}`); break }
  }
  return out
}

phase('Vocab track')
// All four tracks run concurrently; each is internally sequential. Each slice sets its own phase.
const [vocabOut, creaturesOut, worldOut, textOut] = await parallel([
  () => runTrack('Vocab', VOCAB),
  () => runTrack('Creatures', CREATURES),
  () => runTrack('World', WORLD),
  () => runTrack('Text', TEXT),
])

const trackGreen = (out) => out.length > 0 && out.every((r) => r.verdict === 'PASS')
const branchesGreen = {
  'track/ip-vocab': trackGreen(vocabOut),
  'track/ip-creatures': trackGreen(creaturesOut),
  'track/ip-world': trackGreen(worldOut),
  'track/ip-text': trackGreen(textOut),
}

phase('Integrate')
let integ = null
if (!INTEGRATE) {
  log('INTEGRATE=false: stopping BEFORE integration per operator handoff. Completed tracks are committed on their track/ip-* branches; a fresh session integrates after operator review (see 05-INTEGRATION.md).')
} else {
  const toMerge = Object.entries(branchesGreen).filter(([, g]) => g).map(([b]) => b)
  if (toMerge.length === 0) {
    log('No track completed cleanly; skipping integration. Surface to operator.')
  } else {
    integ = await agent(
      `You are the SINGLE INTEGRATOR for the IP-rename tracks. Working dir: ${BASE} (the ONLY checkout of feature/ip-pivot). Confirm 'git -C ${BASE} branch --show-current' == feature/ip-pivot and 'git -C ${BASE} status --short' is clean; else STOP.
Merge these track branches into feature/ip-pivot ONE AT A TIME, in this order: ${JSON.stringify(toMerge)}.
For EACH branch:
 1. 'git -C ${BASE} merge --no-ff <branch>'. CONFLICT RULES: the GENERATED artifacts (src/ui/i18n.resolved.generated/*, src/ui/i18n.resolved.sha256, src/guide/content.generated.ts) are NEVER hand-merged -- after the SOURCE files merge, discard the conflicted generated files and RE-RUN the generators to reconcile: 'cd ${BASE} && ${REGEN}', then 'git -C ${BASE} add' the regenerated paths and complete the merge. NAME-MAP.md + the 02-WORKING-MEMORY scanner allowlist/status board = UNION (append-only). Any OTHER conflict or ambiguity -> 'git -C ${BASE} merge --abort' and STOP, report which files; do NOT guess.
 2. Re-gate the INTEGRATED tree: 'cd ${BASE} && ${BASE_GATE}' (add tests/architecture.test.ts + tests/localization_fixes.test.ts if the creatures branch merged). tests/parity goldens must be byte-identical EXCEPT the enumerated C1/C2 token swaps. If red -> STOP and report; do NOT --force, regenerate a golden by hand, or loosen the scanner.
 3. Do NOT push.
After all merges: update ${WM} -- flip the integrated slices to 'merged (<sha>)'; APPEND-ONLY.
Report: per-branch merged+gated-green or stopped+why, the final 'git -C ${BASE} log --oneline', and whether feature/ip-pivot is fully green (and whether tests/ip_scrub is now fully green or still has residual entries for Z1).`,
      { label: 'integrate', phase: 'Integrate', agentType: 'claude', effort: 'high',
        schema: { type: 'object', additionalProperties: false,
          required: ['merged', 'allGreen', 'scannerFullyGreen', 'stoppedReason', 'finalLog'],
          properties: { merged: { type: 'array', items: { type: 'string' } }, allGreen: { type: 'boolean' },
            scannerFullyGreen: { type: 'boolean' }, stoppedReason: { type: 'string' }, finalLog: { type: 'string' } } } },
    )
  }
}

return { vocab: vocabOut, creatures: creaturesOut, world: worldOut, text: textOut, branchesGreen, integ }

# Phase 11b QA: verify the farming absorb

### QA Starter Prompt
```
This is Phase 11b QA of the Masterwrought feature. Phase 11b merged the completed
farming packet into this branch: 160 conflicted paths hand-classified, the ItemDef union
ported, and docs/farming/ re-homed. This audit exists because of ONE structural fact:
a merge of this size destroys its own ability to detect a bad resolution. Every artifact
that would normally catch a regression (goldens, generated bundles, count pins, the
frozen catalog SHA) is re-minted downstream FROM the merged tree, so it will agree with
whatever the resolution produced. A green gate on this phase proves the tree is
self-consistent, not that it is correct. Your job is to be the part that proves correct.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the absorb for resolution fidelity (nothing dropped, nothing duplicated,
nothing silently stale), for the three mechanical rules actually being applied rather
than described, and for the three surfaces no research lane covered, before 11c changes
design on top of it.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT:
- git status clean (Phase 11b committed); SYNC RELEASE per the canonical workflow
  (fetch, resolve the newest origin/release/** by version sort, merge, run the
  release-merge-audit skill on that merge).
- GATE 9, SETTLED 2026-08-20 (the full delegation): farming has no phase-14-qa.md because
  the F14 QA round was NOT waived and NOT skipped. It was FOLDED INTO THE PHASE RECORD.
  docs/prd/masterwrought/farming/progress.md (re-homed there by 11b from docs/farming/)
  carries a "QA-CHECKLIST ROUND (2026-08-20, dispatched LAST per the packet)" block inside
  its Phase 14 section, with reviewer verdicts, LOW-note dispositions, N/A verdicts verified
  against the file list, and a full gate record on the frozen tip 354cff6e77 (12 steps
  green, 2897 files / 40606 tests). EXECUTE: cover F14's thirteen ACTIONABLE-IN-REPO items
  inside Auditor 7's lane, author NO retrospective twin, and record the finding by CITING
  that block rather than restating it. WHY: the round happened and only the FILE is missing,
  so a retro twin would re-litigate a closed audit and add a doc the packet then has to tear
  down. REJECTED: authoring a retrospective farming phase-14-qa.md.
- Memory scan: the test-pin trap index (READ it before judging ANY pin, especially the
  "prove tests RAN" and constant-self-compare traps), the observer-recorder signature
  drift note, the pin-source-must-carry-identity note, the shared-worktree commit-care
  note, and the gate-env DATABASE_URL note (never source .env around a gate or vitest run).
- Establish the three reference trees you will diff against, read-only:
  BASE = git merge-base of the two parents, OURS = the pre-merge feature/masterwrought
  tip, THEIRS = the farming tip the merge commit's second parent names. Every judgment
  below is a four-way read (base, ours, theirs, merged). Never judge the merged tree
  against one parent alone.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
docs/prd/masterwrought/phase-11b-farming-absorb.md (what was promised, and the three
mechanical rules verbatim), the state.md Phase 11b ledger (the four decisions settled
2026-08-20 and copied there as answered, the 11c carry list, the named red list with owners, the three-literal baseline
capture), progress.md's one absorb Notes entry, and the merge commit itself
(git show --stat, then the resolution of every file you audit).
Return: the exact carry list, the exact named red list, and the class counts recorded.

STEP 2 - QA AUDIT. Seven lanes. Run them as an ultracode Workflow, or in two waves of
four, never as seven simultaneous editors of one worktree. Every lane is COVERAGE, not
filtering: report every issue including low-severity and uncertain ones, ranking happens
later. Hard 30-tool-call budget each, report first.

Auditor 1, THE EXTRACTION CENSUS, file by file. This is the class that produces duplicate
or silently stale definitions with ZERO conflict markers, so git never points at it.
- Rebuild the set yourself:
    git diff --name-only --diff-filter=A <BASE> <THEIRS>
  and for every added module whose body looks like a moved block, find the function of
  the same name in its old home on OURS and diff the two bodies line by line. Report
  three verdicts per member: IDENTICAL (safe), OURS-EDIT-PORTED (name the ported lines),
  or DIVERGENT (a third variant, which means both sides edited and the merge chose one
  silently; that is a finding, not a resolution).
- The known members, ten arriving as clean adds and two already present here:
  src/sim/mob/boss_mechanics.ts, server/heavy_self.ts, server/character_blob_size.ts,
  src/render/glb_instanced_props.ts, src/ui/window_open_state.ts, src/ui/report_window.ts,
  src/ui/entity_display_name.ts, src/ui/cast_display_name.ts,
  src/ui/ability_tooltip_lines.ts, src/game/turnstile_gate.ts,
  src/ui/gather_rare_event_feedback.ts, src/sim/wellfed.ts; and already present:
  src/sim/item_lock.ts (farming's shared countRawInSlots export), src/sim/mech_chroma_ownership.ts.
- The one confirmed port, verified by literal: src/ui/cast_display_name.ts must contain
  `if (id === SUNDER_CAST_ID) return t('abilityUi.cast.sundering');` between the SALVAGE
  and TOOL_RECHARGE arms, with SUNDER_CAST_ID imported. Grep hud.ts for a surviving
  castDisplayName definition; there must be none.
- Same check for hud.ts hunks 4 and 5 against ./ability_tooltip_lines (abilityRangeLine,
  playerSpellHasteFrac, abilityCastLine, abilityRequirementLines, describeAbilitySummary,
  resourceDisplayName) and ./entity_display_name (entityDisplayName and its feast-title
  arm). Any masterwrought edit to those bodies (ruinCost lines, spell-haste reads) must be
  PRESENT in the extracted module, not merely absent from hud.ts.
- Prove the negative too: grep the merged tree for any symbol exported twice.

Auditor 2, THE SILENT AUTO-MERGE SWEEP. This is the lane no research covered and it is
where the real damage hides. 251 files were changed by BOTH packets. 160 conflicted and
were hand-resolved under review. The other 91 auto-merged with ZERO conflict markers,
because git merged them by line proximity, not by meaning, and nobody looked at any of
them. Rebuild the set:
    comm -12 <(git diff --name-only <BASE> <OURS> | sort) \
             <(git diff --name-only <BASE> <THEIRS> | sort)
  minus the conflicted paths.
Audit the highest-risk members whole, both parents' diffs side by side: src/sim/sim.ts,
src/sim/sim_context.ts, src/sim/combat/casting_lifecycle.ts, src/sim/content/items.ts,
src/sim/content/professions.ts, src/net/online.ts, src/world_api.ts, src/render/renderer.ts,
src/game/nearby_interaction.ts, server/game.ts, server/pbe_boost.ts,
tests/parity/scenarios.ts, tests/localization_fixes.test.ts (the S3 guard),
.github/workflows/ci.yml, src/ui/world_entity_i18n.ts, src/ui/icons.ts,
src/ui/deed_image_ids.ts, and the deed_i18n.locales and i18n.locales overlays that
auto-merged. For each, answer one question: did both sides' intent survive, or did one
side's edit land inside a region the other side rewrote for a different reason? Two
specific reads are owed because both packets touched them and neither conflicted:
server/game.ts (two independent wire and snapshot growth paths meeting in one file) and
src/world_api.ts (the barrel that must stay COUNT-FREE by rule while gaining
src/world_api/farming.ts).

Auditor 3, THE THREE UNCOVERED SURFACES. Named as UNAUDITED by the completeness critic,
which is not the same as clean. Verify each rather than assuming.
- electron/main.cjs. It is the ONE platform-shell file either packet touches (verified:
  farming changes exactly this file under electron/, android/, ios/, bot/, headless/,
  python/, server/steam/ and server/epic/, and masterwrought changes none of them). The
  change is a single added line: a `biome-ignore lint/suspicious/noUndeclaredEnvVars`
  suppression immediately above `if (process.env.WOC_OPEN_DEVTOOLS === '1')`. Confirm the
  suppression survived the merge STILL ATTACHED to that line (a suppression that drifted
  one line up is silently dead), and that npm run ci:changed over the file is clean.
- server/http/ RouteDef additions. SETTLED 2026-08-20: the verdict is CLEAN, and this lane
  CONFIRMS it on the merged tree rather than re-deriving it, then DELETES the word UNAUDITED
  from the state.md drift record. The four citations the verdict rests on, each to be
  re-read once here: (1) farming's `export const routes` module set is 20 files and is a
  strict SUBSET of masterwrought's 27, the seven extras all being release-side
  (ota_updates, reliquary, reports, seeker_entitlement, steam/routes, user_assets_routes,
  wallet), so farming added NONE; (2) server/farming_commands.ts carries no
  `export const routes` and no RouteDef, because it is a WebSocket command handler and not
  a REST surface; (3) farming's server/main.ts diff is the
  `lockoutNowMs: () => Date.now()` injection at the ctx construction (line 494 on that
  branch) and carries no URL literal; (4) no farming path appears in any `/api/` string in
  that file. Confirm alongside them that no file under server/http/ changed on either side,
  that server/http/registry.ts is untouched, and that no new `export const routes` module
  was added and registered. WHY: server/http/CLAUDE.md forbids an inline route in main.ts,
  and at Phase 17 a record saying UNAUDITED is indistinguishable from a record saying
  nothing. REJECTED: carrying UNAUDITED forward as if it were a verdict.
  Farming's server files are character_blob_size.ts, character_professions.ts,
  community_test_accounts.ts, db.ts, farming_commands.ts, game.ts, heavy_self.ts,
  main.ts, pbe_boost.ts; masterwrought's are character_sheet.ts, game.ts,
  interest_policy.ts, pbe_boost.ts. If server/main.ts's farming diff turns out to be
  anything MORE than the lockoutNowMs injection, an inline route in main.ts is a repo-rule
  violation and a blocking finding, and the settled CLEAN verdict is overturned by that
  measurement rather than defended.
- tests/ci_workflow.test.ts, the sparse-cone union. Neither the test nor
  .github/workflows/ci.yml conflicted (the two packets' rows sit in alphabetically
  disjoint regions), which is exactly why nobody would check it. The merged union is 13
  rows: nine farming (farming/, farming-phase-01, -05, -07, -08, -09, -09b, -12, -13) and
  four masterwrought (masterwrought-phase06-tomes, -phase07, -phase08-qa, -phase10-qa).
  Confirm all 13 are present in the SPARSE_CONE literal AND in all five workflow blocks,
  byte-identical (the block-equality assertion compares whole blocks, so one stray space
  reds it), that the extractor still finds exactly five blocks, and that the set-equality
  side still passes after the doc move re-homed the references. The move is invisible to
  this guard because references travel with the file; a DELETION is not, which is why the
  same rows are the teardown precondition later.

Auditor 4, THE ORDERING RULE AND THE TYPE PORT.
- Read every append-only table's tail region and confirm the three tiers literally:
  release rows first, masterwrought's committed rows next with positions FROZEN (diff
  their order against OURS and require it unchanged), farming's block LAST and
  CONTIGUOUS. Files: src/sim/content/deeds.ts, recipes.ts, profession_items.ts,
  reliquary.ts, src/ui/i18n.catalog/items.ts, hud_chrome.ts, and the sorted
  tests/architecture.test.ts allowlist (which stays sorted).
- Confirm DEED_ORDER[len-1] is 'prog_farming_100' and that this is RECORDED as expected
  rather than treated as a surprise. Confirm no count pin, no golden, no generated
  artifact and no monolith ceiling was touched in this phase; all of those are 11d's, and
  a helpful re-mint here is a blocking finding, not initiative.
- The ItemDef union port: `feast?` on OtherItemDef (the only member admitting kind
  'junk'), `wellfed?` on FoodItemDef beside ours' `wellFed?`, both spellings still
  present, `elixir?` still ours' TimedStatBuffPayload. Then the part that does not
  conflict and therefore was never flagged: read EVERY farming row in
  src/sim/content/items.ts against the union member its `kind` selects. Count them
  yourself. The plan records 30 and a direct count of the incoming diff returns 31 (27 of
  kind 'junk', 4 of kind 'tool'), plus 13 in profession_items.ts. Report the number you
  find and reconcile it; a row that vanished between the two counts is the exact failure
  this audit exists for. 11b was RULED (2026-08-20) to DERIVE both counts and record them
  by kind, so this lane compares its own count against 11b's RECORDED number, and a silent
  adoption of 30 or 31 with no derivation is itself a finding.
- Confirm zero design change: no aura id, magnitude, duration, ladder rung, recipe bill,
  price, charge count, or deed renown moved. Spot-check the four farming dishes against
  THEIRS byte for byte (3/600, 6/900, 9/900, 12/900 with foodHp 90/243/552/980) and
  harvest_feast's charges 10 / durationTicks 3600 / dishItemId.

Auditor 5, THE DOC MOVE AND ITS GUARDS.
- git log --follow on two or three moved files: history must still walk through the
  rename. A copy-and-delete instead of a git mv is a finding. Confirm too that 11b recorded
  the DERIVED docs/farming tracked-file count from git ls-tree rather than adopting 34 or 36
  (settled 2026-08-20 alongside the item-row count).
- Repo-wide grep for `docs/farming/`: zero hits outside the moved README's dated banner.
  Re-derive the out-of-packet citation set rather than trusting the phase file's list
  (which found nine occurrences across six files, including src/sim/content/zone1.ts:918,
  a shipped-source comment no research lane listed).
- THE NEEDLE, and judge it strictly. tests/farming_asset_manifest.test.ts must assert
  against the NEW packet root, and the phase must have WATCHED it fail on an injected
  path. If the report does not say it was watched failing, watch it fail yourself: a
  needle that can never match passes vacuously forever and is worse than no guard,
  because it reads as coverage.
- Confirm docs/design/farming-asset-manifest.json did NOT move, and that the
  journeyEvidence assertion naming docs/screenshots/farming-phase-13 is untouched.
- Confirm only FORWARD-LOOKING assertions were rewritten. Past-tense execution records
  ("delivery followed D22: no push, no PR") must be verbatim. Sample a dozen of the 147
  D22 mentions and confirm history was not swept. Confirm the D22 SUPERSEDED banner sits
  above the D22 bullet with the body intact, and that the moved README's Working
  agreements paragraph no longer claims a worktree, a branch, a no-PR rule, or a
  never-shipping doc set that are all now false.

Auditor 6, PARKED-CLASS INTEGRITY AND CARRY-LIST COMPLETENESS.
- Every parked file is still parked: no generator ran, no golden was re-recorded, no pin
  was bumped. Verify by diffing the parked paths against whichever parent was taken, and
  confirm the choice is recorded per file.
- The named red list is COMPLETE and HONEST: run the full suite, take the red set, and
  require it to equal the list in the ledger. A red that is not on the list is a defect of
  Phase 11b. A listed red that is actually green is a stale list, which is how a real
  failure hides later.
- The 11c carry list is complete against the mutually-exclusive hunks: auras.ts's
  applyWellfedOnConsumeComplete mint, the pruned import, the 'aura.wellFed' DICT values
  (精神饱满 / 精神飽滿 / 잘 먹음 kept versus 饱足 / 飽足 / 포만감 recorded), the
  same-key useElixir and useElixirAura overlay values, and the professions overview prose
  that still says four gathering when the merged truth is five, which 11c WRITES under the
  2026-08-20 ruling (five gathering trades and a ring of ten crafts, the second paragraph's
  four moved to five, plus the five non-Latin overlays). One carry row is a RECORDED
  DECISION rather than a take-ours and must read that way: the nearby-interaction priority,
  settled as placed station first with the farm bed immediately below, pinned in both
  directions. Confirm src/sim/wellfed.ts
  is present, exported, and deliberately unreferenced with that fact written down, rather
  than accidentally orphaned.
- Confirm both new goldens are registered (rift_clear_rewards.json and
  farming_session.json), every scenario row has a golden and vice versa, and each new
  scenario lands in a parity shard.

Auditor 7, FARMING PHASE F14's THIRTEEN ACTIONABLES (per GATE 9 as settled). This is not
retrospective busywork: several of them landed in exactly the regions this merge
rewrote, so verifying them verifies the merge. Confirm each survived the absorb, and
name the ones the merge has now invalidated:
  A1 the mobile-window-open body class on the harvest journal and plant sheet; A2 the
  style batch (.ps-seed's rgba literal and the report window's #ffd100 moved onto tokens);
  A3 the bags feast "set out" key plus its five M16 non-Latin fills (this is the
  src/ui/bags_view.ts conflict; confirm the feast arm still sits above the generic use
  hint); A4 the a11y batch (seed rows as a radiogroup, aria-busy on in-flight sends,
  aria-live on flip-to-ready, the husk-trade row label); A5 the pending generator
  excluding RETIRED_KEYS rows; B6 useItem's feast arm consuming the validated slotIndex
  rather than re-scanning bags; B7 countRawInSlots as ONE shared export plus the exported
  distToBed (this is the item_lock.ts member of the extraction class, so Auditor 1's
  verdict on it feeds here); B8 Sim.mobMeleeRange retired with sim.ts's ceiling LOWERED
  (SETTLED 2026-08-20 as a known 11d ceiling INPUT, never a regression; the two arms are
  spelled out below the list); B9 the gatherDowngrade surface union gaining 'crop'; C10 the wiki
  consumable-effect prose for the dishes; C11 the nameplate comment pair plus the farming
  cast display names (this is the cast_display_name.ts port, so it interlocks with
  Auditor 1's SUNDER arm); C12 tests/mob_boss_mechanics.test.ts depth (this is the
  boss_mechanics.ts member of the extraction class); C13 the handoff rows discharged.

B8, SETTLED 2026-08-20, and CHECK BEFORE RECORDING ANYTHING. masterwrought's src/sim/sim.ts
measures 12650 while the merged file measures 12340, so sim.ts FALLS in this merge. Read the
merged count first, then take the arm that matches it: if 12340 is at or under F14's lowered
pin, the LOWERED PIN HOLDS and the only record owed is a confirmation line; if it is above,
the ledger row names F14's lowered pin, masterwrought's 12650, and the merged 12340, and the
raise is measured against F14's number ONLY. 11d's recorded literals put farming's sim.ts
pin at 12232, so the second arm is the expected one; verify it, never assume it. WHY: F14
retired Sim.mobMeleeRange and the extraction that earned the lower pin is still in the merged
tree, so the pin moved because masterwrought's sim work landed beside it, which is merge
arithmetic and not a behavior regression. REJECTED: treating it as a regression, which would
fund an extraction to undo growth already smaller than one parent's pin.

Dispatch per the Review Dispatch Matrix, FRESH, on the merged diff:
architecture-reviewer (src/sim/), cross-platform-sync (src/world_api/** and the new
farming facet, SimEvent names, both matchers, src/net/online.ts, server/game.ts wire),
privacy-security-review (the arriving server/ files, and ALLOW_DEV_COMMANDS,
Math.random, Date.now, performance.now anywhere in src/sim/), migration-safety
(server/db.ts and the characters.state JSONB path farming writes farmPlots into),
frontend-seam-reviewer (src/ui/, src/render/, src/styles/), qa-checklist LAST as the
phase-completion gate. If NO row matches a given file set, spawn no agent for it; do not
default to running privacy-security-review anyway.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, and nits, the maintainer's
standing rule). Separate fix commits with explicit paths and real bodies. Two constraints
on the fix round specifically:
- A fix here may not change design. If a finding can only be fixed by choosing a
  magnitude, an aura id, or a bill, it becomes a carry-list row for 11c or 11e with a named
  owner, not a quiet decision in a QA fix. The nearby-interaction priority is no longer such
  a case: it was settled 2026-08-20 (placed station first, farm bed immediately below), so a
  deviation from it is a FINDING to fix here, not a carry.
- The fix round is itself unreviewed code: have a FRESH reviewer pass over the fix diff
  before closing. Then rerun npx tsc --noEmit, tests/architecture.test.ts,
  tests/ci_workflow.test.ts, tests/farming_asset_manifest.test.ts, and npm run ci:changed.

STEP 4 - DOCS: progress.md (the Phase 11b QA row); state.md drift (the corrected class
counts, the real item-row count, the completed extraction census with its per-member
verdicts, the silent-auto-merge sweep verdict, the three uncovered-surface verdicts so
the record stops saying UNAUDITED, the F14 survival table, and any carry-list rows this
audit added); memory notes for anything that surprised you, especially a new member of
the extraction-versus-in-place class or a silent auto-merge that turned out to matter.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL; counts found and fixed per lane; the
extraction census table; the silent-auto-merge verdict; the three surface verdicts (the
server/http one being the settled CLEAN verdict with its four citations CONFIRMED, so the
record no longer says UNAUDITED anywhere); the F14 survival table, citing farming
progress.md's folded QA-CHECKLIST ROUND block rather than a twin that was never owed; and the handoff line for Phase 11c naming the carry list as it now
stands. Follow-ups are CUT-or-fix decisions with an owning phase, never future-PR items:
this packet ships in ONE branch and ONE PR.
```

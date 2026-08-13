# Phase 10: Celebrations

Farming has been live since Phase 9. This phase adds the lottery moment and the permanent
records: the golden_harvest rare event per D12 and the farming deeds and title per D13.
Everything here is celebration: zero power, one new roll at harvest, append-only records.
docs/farming/state.md is the authority; if this file contradicts it, state.md wins and this
file plus phase-10-qa.md get swept in the same pass.

Live-surface note (binding): LIVE, additive. The rare event and the deeds join the already-open
farming loop the moment this merges: any harvesting player can roll golden_harvest, and
every farming deed and the farming-100 title become earnable immediately. No dormant
surface, no reachability change to anything that already shipped.

### Starter Prompt

```
This is Phase 10 of the Farming feature: Celebrations.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: farming gets its lottery moment and its permanent records: the golden_harvest rare
event rolled at harvest, the farming deeds, and the farming-100 title.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Use
  git -C ~/Documents/woc-farming-plan for every git command (the Bash cwd resets between
  calls; never rely on cd).
- git status must be clean. If it is not, stop and surface; never stash or discard WIP
  that is not yours.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create branch
  fix/farming-phase-10-celebrations off LOCAL feature/farming-plan (D22: never off
  the release tip, which lacks the packet and all farming work), then MERGE the
  newest release tip INTO the phase branch FIRST: run the release-merge-audit skill
  plus the state.md deviation (al) absorb checklist, re-run the parity and count-pin
  suites, and verify the farming_session golden md5 unchanged. A jump of a minor
  version or more (or a triple-digit intersection) runs
  docs/farming/phase-06b-release-sync.md's shape as its own mid-phase BEFORE this
  phase instead. Record the phase-start commit sha.
- If release moves mid-phase and this branch turns long-lived, merge release in and run
  the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: worktree-cwd-drift-misroutes-git,
  i18n-semantic-regressions-gate-trap, mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets, fanout-agent-delivery-traps, no-claude-session-links.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough) to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-10-celebrations.md, and these sources:
src/sim/professions/farming.ts (the harvest action-time draw block, the draw-count
contract), src/sim/content/deeds.ts (the catalog, the ZONE_FISH earnability template,
the visit-mark idiom), the module exporting the gatherRareEvent SimEvent flavor union and
announceGatherRareEvent (locate by symbol), src/ui/hud.ts (the single gatherRareEvent HUD
case, read by the agent only, never by you), src/game/audio.ts (UI_CUES, the UiCue
union), scripts/sfx/sfx_prompts.mjs, the deeds i18n module under src/ui/i18n.catalog/,
tests/deeds_content.test.ts, tests/professions_farming.test.ts (and any sibling matching
tests/professions_farming*.test.ts), tests/game_audio.test.ts,
tests/localization_fixes.test.ts, the farming_session scenario under tests/parity, and
the CLAUDE.md files: root, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
src/ui/CLAUDE.md, plus docs/design/deeds.md. The orchestrator never reads planning docs
or coordinator monoliths directly; the summary is your only context.
The summary must return, explicitly:
- The file and exported union carrying the gatherRareEvent flavors, the exact flavor
  shape, and the announceGatherRareEvent signature and fanout semantics (including how
  instance space is excluded).
- The harvest action-time draw block's shape in src/sim/professions/farming.ts, the
  current draw-count contract (draws per plant, draws per harvest, zero on denial) and
  the test that pins it, and the exported name of the shared rare-event chance constant.
- The single gatherRareEvent HUD case shape: how the existing flavors localize, the epic
  color class, and the finder-only achievement cue path.
- The full SFX cue recipe as implemented: UI_CUES key, facade method, hud case, prompt
  row, npm run sfx:ui, sfx:manifest, sfx:check, and the completeness guard in
  tests/game_audio.test.ts.
- The deeds catalog structure: the ZONE_FISH earnability template, the visit-mark
  producer idiom, the prog_ deed naming pattern, the title shape, and exactly which
  totals tests/deeds_content.test.ts pins (deed order length, total renown, title
  counts).
- The deeds i18n module and the localization-coverage arms that count deeds.
- The farming_session parity scenario file and the deliberate regen recipe
  (UPDATE_PARITY=1, isolated commit).
- Any progress.md Notes from Phases 1 to 9 that touch harvest, deeds, or the HUD
  celebration path.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Spawn three implementation agents by vertical slice, each owning its slice plus its
tests. Fan-out reminders: request the fan-out explicitly and spawn all three in one
message so they run in parallel; give each agent ONLY the Explore summary plus its own
bullets (never a planning doc to read); never run a teammate in plan mode.
- Agent A, the rare event (sim): add golden_harvest as a fourth flavor on the existing
  gatherRareEvent SimEvent union (no new SimEvent type); roll it at harvest inside the
  action-time draw block in src/sim/professions/farming.ts using the shared rare-event
  chance constant (1 in 90 per D12); five-fold yield; the produce signed; zone-announced
  through the announceGatherRareEvent path so the HUD case stays single. Agent A owns ALL
  edits to src/sim/professions/farming.ts, including the farm:<zone> visit-mark producer
  Agent C's chronicle deeds consume. Restate and re-pin the draw-count contract (harvest
  gains the rare-event draw; plant unchanged; denial still zero). Tests in
  tests/professions_farming.test.ts: the roll fires only at harvest, the yield
  multiplier, the signature, the announcement, the re-stated contract, a same-seed
  determinism pin.
- Agent B, the HUD arm and the cue (ui plus game): the localized golden_harvest line in
  the epic color inside the one gatherRareEvent HUD case; the finder-only achievement cue
  on the existing path; a NEW golden sting cue: UI_CUES key, facade method in
  src/game/audio.ts (widen the UiCue union if the family nests), the hud case, a prompt
  row in scripts/sfx/sfx_prompts.mjs, placeholder clip via npm run sfx:ui, then
  npm run sfx:manifest and npm run sfx:check; the English t() rows in the matching
  src/ui/i18n.catalog/ module. Tests: the tests/game_audio.test.ts completeness arm.
- Agent C, the deeds (content plus i18n): per D13 and docs/design/deeds.md, all
  append-only, cosmetic, ZERO rng: a first-planting deed; a first-harvest chronicle per
  farming zone using farm:<zone> visit marks with an earnability table on the ZONE_FISH
  template (the mark producer itself lands in Agent A's file; coordinate on the mark
  ids); a golden-harvest deed; prog_farming_100 with the farming title. Re-pin the
  tests/deeds_content.test.ts totals (deed order length, total renown, title counts)
  deliberately in the same change. Deed English i18n rows in the matching
  src/ui/i18n.catalog/ module with the release-tier note for the PR body (English-only
  passes the PR tier; any M16-wordy string gets its non-Latin fills in the same change).
  Verify the localization-coverage arms that count deeds.
After the slices merge, YOU (the orchestrator) re-record the farming_session golden:
run npx vitest run tests/parity first to see exactly which scenario moved, then
UPDATE_PARITY=1 regen in an ISOLATED commit containing nothing else, then re-run to
green and confirm no golden outside the farming scenarios changed.

INVARIANTS THIS PHASE MUST KEEP
- Every deed draws zero rng, ever; all deeds are append-only and cosmetic (titles and
  Renown, never power).
- All randomness in src/sim/ goes through ctx.rng; the new roll happens only inside the
  harvest action-time draw block, never at expiry, login, or tick.
- The draw-count contract change is deliberate, stated in the PR body, and isolated: the
  farming_session re-record is its own UPDATE_PARITY=1 commit, and every golden outside
  the farming scenarios stays byte-identical.
- The gatherRareEvent HUD case stays single: all four flavors flow through the one case
  and the one announceGatherRareEvent path.
- No English in any sim or server path: every player-visible string added this phase is
  an English t() key in the matching src/ui/i18n.catalog/ module; every sim emit stays
  text-free and id-carrying (the S3 guard binds).
- Every new cue key has a clip, a manifest row, and a green sfx:check.
- No em dashes, en dashes, or emojis anywhere; every new name is IP-safe per D17.

Out of scope (do NOT do in this phase)
- Buff food (Phase 11).
- The shared feast (Phase 12).
- Wiki prose and the asset manifest (Phase 13).
- Tuning the shared rare-event chance constant or any yield number outside D12.
- Any new SimEvent type, any power-granting reward on any deed.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/deeds_content.test.ts tests/professions_farming.test.ts
  tests/architecture.test.ts tests/localization_fixes.test.ts tests/game_audio.test.ts
- npx vitest run tests/parity (green after the isolated re-record; nothing outside the
  farming scenarios moved)
- npm run ci:changed
- node scripts/gate_select.mjs
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md
(expected for this diff: architecture-reviewer, cross-platform-sync,
frontend-seam-reviewer (the hud case, the src/game/audio.ts cue, and the i18n rows
match its matrix row), and qa-checklist at phase completion; add none beyond what the
matrix matches). Every review agent gets a
hard 30-tool-call budget, the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"), and, if truncated, the resume
line: "Stop reading more files. Output the full report now based on what you have
already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE /
VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a BODY (what changed and why),
explicit paths only, never git add -A, no session links or Claude attribution:
- feat(sim): golden_harvest flavor and the harvest roll (union arm, action-time draw,
  five-fold yield, signed produce, zone announce, re-stated draw-count pin)
- feat(ui): the epic HUD line, finder-only achievement cue, and the golden sting cue
  chain (facade, prompt row, placeholder clip, manifest)
- feat(deeds): the farming deeds, chronicle marks and earnability table,
  prog_farming_100 and title, totals re-pin, deed i18n rows
- test(parity): re-record farming_session for the harvest rare-event draw (isolated,
  UPDATE_PARITY=1, nothing else in the commit)
- docs(farming): progress and state ledgers for Phase 10

STEP 5 - ACCEPTANCE CRITERIA
- [ ] golden_harvest is a fourth flavor on the existing gatherRareEvent union; no new
      SimEvent type; the HUD case remains single.
- [ ] The roll happens at harvest inside the action-time draw block via the shared
      rare-event chance constant; five-fold yield; produce signed; zone-announced
      through announceGatherRareEvent.
- [ ] The draw-count contract is restated (harvest gains the rare-event draw) and
      re-pinned so the pin fails if the count drifts.
- [ ] farming_session re-recorded in an isolated UPDATE_PARITY=1 commit; no golden
      outside the farming scenarios moved.
- [ ] Deeds landed per D13: first planting, a first-harvest chronicle per farming zone
      via farm:<zone> marks with an earnability table, a golden-harvest deed,
      prog_farming_100 with the farming title; all append-only, cosmetic, zero rng.
- [ ] tests/deeds_content.test.ts totals re-pinned deliberately in the same change.
- [ ] Deed English i18n rows landed with the release-tier note in the PR body; the
      localization-coverage arms that count deeds verified; S3 green.
- [ ] Golden sting cue complete: UI_CUES key, facade method, hud case, prompt row,
      placeholder clip, manifest, sfx:check green; tests/game_audio.test.ts green.
- [ ] The epic-colored line and the achievement cue fire for the finder only; the zone
      announcement reaches the zone.
- [ ] Every STEP 3 validation row green; gate_select green modulo the armory exception.

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (the Phase 10 status row, the acceptance list above
copied with its check states, a Notes block for surprises, deviations, and deferrals)
and the docs/farming/state.md ledgers (new SimEvent flavor, new i18n keys, new deeds,
new cue). Any deviation decided in-phase gets swept into
docs/farming/phase-10-celebrations.md AND docs/farming/phase-10-qa.md in the same pass.
Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched, grouped by
surface; validation results per command; review verdicts per agent; deferrals with
reasons; one line handing off to the Phase 10 QA session.

STOPPING RULES
- Stop if the fourth flavor cannot land without breaking the single-HUD-case shape (a
  second case or a forked switch): surface the design instead of forking it.
- Stop if tests/parity reds outside the farming scenarios after the re-record: the
  shared draw order forked for another profession; never regen other goldens to silence
  it.
- Stop if git status is dirty at STEP 0 or the newest release branch cannot be resolved.
- Stop while any review BLOCKING stands.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the standing
environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker, never trust a piped exit code;
PR CI is the arbiter). Push and open the PR against the release branch this phase was
based on, following .github/PULL_REQUEST_TEMPLATE.md. Screenshots via the pr-screenshots
skill apply to the visual phases (12 and 13); this phase needs none. No Claude
attribution or session links in commits or PR text.
```

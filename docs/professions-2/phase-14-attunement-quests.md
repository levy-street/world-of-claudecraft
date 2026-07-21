# Phase 14: Attunement quests and nudges

This phase makes the identity journey live end to end: acceptance lore quests at the masters for
all four wave-one archetypes, honest switching costs through repeatable make-amends quests, the
masters' recurring pull (cadence-capped work-order quests and tier-crossing congratulation
mail, the 2026-07-17 amendment), and
the legibility layer (trend nudges that complete #1295, a pre-commit preview that explains
everything, and the attunement celebration). It is its own slice because it is the first phase
where the PR 2039 quest machinery, the Phase 7 trend classifier, and the Phase 8 masters meet in
player-facing content: every hook it fills already exists, and nothing later depends on it except
the Phase 15 deed pass.

## Context pointers

- `docs/professions-2/state.md`: locked identity costs (first attunement free; make-amends
  escalation 5 + 3 * switchCount with cheap early costs), the validation matrix, and the key
  existing surfaces list (quests, archetype, NPCs).
- `docs/professions-2/progress.md`: the Phase 14 checklist and notes from Phases 7, 8, and 13.
- `docs/professions-2/implementation-plan.md`: team workflow and the Review Dispatch Matrix.
- `src/sim/quests/profession_quest_effects.ts`: the 2039 `completionEffect` handlers
  (`attunePair`, `switchHobby`) and the selection validation this phase's quests ride on.
- `src/sim/quests/quest_commands.ts`: the quest command path; in the S3 scanner scope since
  Phase 7.
- `src/sim/professions/archetype.ts`: `attunedPairs`, `archetypePairId`,
  `ARCHETYPE_PAIR_TARGETS`, `hobbyCandidatesForPair`, `attuneArchetypePair`.
- `src/sim/content/zone1.ts`, `src/sim/content/zone2.ts`, `src/sim/content/zone3.ts`, and
  `src/sim/content/professions.ts`: quest records and the Phase 8 master `NpcDef` rows whose
  `questIds` hooks this phase fills; `src/sim/content/letters.ts` for the letter voice.
- The Phase 7 trend detection module (path recorded in the `state.md` "New surfaces per phase"
  entry for Phase 7): the trending-pair classifier the nudges consume.
- `src/ui/hud/quest/quest_dialog_controller.ts`, `src/ui/profession_identity_card.ts`, and
  `src/ui/profession_identity_view.ts`: the quest dialog and attunement preview surfaces.
- `src/ui/sim_i18n.ts`: the matcher for sim-origin player text (broadcast, nudges).
- Local conventions: `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`,
  `src/sim/content/CLAUDE.md`, `src/ui/CLAUDE.md`, `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 14 of the Professions 2.0 feature: Attunement quests and nudges.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: make the identity journey live end to end: lore quests at the masters for all four
wave-one archetypes, honest switching costs, the masters' recurring pull (work orders and
tier mail), and the legibility layer (nudges, complete
pre-commit preview, celebration).

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean (a concurrent session may share it). Record the
  current HEAD as the phase-start commit in docs/professions-2/progress.md Notes.
- Scan Claude Code memory (MEMORY.md index) for phase-relevant entries: the node25 gate rule
  (run npm run gate under Node 24), the PR 2039 state (attunement machinery and its review
  gaps), and the design-language program (DESIGN.md guardrails for any UI chrome this phase
  touches).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-14-attunement-quests.md (this phase file)
- src/sim/quests/profession_quest_effects.ts and src/sim/quests/quest_commands.ts
- src/sim/professions/archetype.ts
- src/sim/content/zone1.ts, zone2.ts, zone3.ts, professions.ts, letters.ts (quest records,
  the Phase 8 master NpcDefs and their questIds hooks, the retired placeholder quest rows)
- the Phase 7 trend detection module (path in state.md New surfaces, Phase 7 entry)
- src/ui/hud/quest/quest_dialog_controller.ts, src/ui/profession_identity_card.ts,
  src/ui/profession_identity_view.ts, src/ui/sim_i18n.ts
- src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/sim/content/CLAUDE.md,
  src/ui/CLAUDE.md, tests/CLAUDE.md
The summary must return: the attunePair/switchHobby completionEffect contract and where
selection validation runs; the selection whitelist shape and whether it can express each
wave-one target pair; each master's NpcDef location and its empty questIds hook; the current
placeholder quest rows (q_archetype_acceptance, q_prof_make_amends) and every reference to
them (content, i18n keys, locale fills, tests); the trend classifier API and any existing
cadence or tutorial-panel surface; the preview surfaces' current copy and the missing
make-amends return cost line; the i18n pipeline for quest text (entity/quest pipeline,
matcher scope including quest_commands.ts); and the existing suites to extend
(tests/profession_attunement_quests.test.ts, tests/prof_intro_quest.test.ts).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out four agents; give each ONLY the Explore summary, never the planning docs. Use
worktree isolation only if two agents must edit the same file in parallel.

Agent content deliverables:
- Four acceptance lore quests, one per wave-one archetype (Smith, Outfitter, Apothecary,
  Bombardier), each given by its matching master (fill the Phase 8 questIds hooks), each
  using the 2039 attunePair completionEffect with selection.
- Each quest's text explains majors, hobby, dormancy, and the make-amends return cost BEFORE
  the player commits (the legibility rule; no surprise costs after the fact).
- Make-amends live at the masters as repeatable quests (QuestDef.repeatable) using the
  switchHobby path, with the state.md escalation formula (5 + 3 * switchCount); the FIRST
  switch is deliberately cheap per state.md.
- Retire the placeholder quest rows q_archetype_acceptance and q_prof_make_amends cleanly:
  remove the content rows, their i18n keys, and their locale fills per the workflow rules;
  no dangling questIds or orphaned references anywhere.
- One repeatable work-order quest per master (six total; the 2026-07-17 amendment): a
  cadence-capped craft-objective turn-in ("the master needs N of X") on QuestDef.repeatable
  plus the 2039 craft objective, consuming that master's craft materials: a recurring
  material sink with a face on it. Rewards use the state.md work-order tuning target
  (MAINTAINER numbers; stop and ask if they are still absent; never gold-positive against
  the input vendor value) and the cadence cap reuses the nudge cadence pattern so the loop
  can never become an unbounded XP or gold faucet (the q_prof_hobby_switch lesson in
  state.md OPEN items).

Agent sim deliverables:
- Switch cost wiring: the escalation formula resolves in the sim through the make-amends
  completion path, reading attunedPairs history; validation stays server-side.
- Trend nudges completing #1295: the trending-pair chat nudge driven by the Phase 7
  classifier, then a letter-voice follow-up; both cadence-capped so they can never spam.
- The tutorial panel fires exactly once, at the first cap moment, and never again for that
  character.
- Tier-crossing mail (the 2026-07-17 amendment): a one-shot-per-tier congratulation letter
  from the attuned archetype's ANCHOR master (the giver of its lore quest, always the
  zone 1 master under the state.md assignment) when a MAJOR craft crosses a
  TIER_SKILL_STEP boundary, in the Phase 7 letter voice and delivery infra; one-shot flags
  per tier, cadence-safe, never for hobby or dormant crafts, never for unattuned
  characters (the Phase 7 Guild letter owns that moment).

Agent ui deliverables:
- Attunement preview completeness: the preview (identity card/view plus the quest dialog
  surface) gains the make-amends return cost line, closing that 2039 review gap; the full
  picture (majors, hobby, dormancy, return cost) is visible pre-commit in both hosts.
- Attunement celebration: banner plus title grant plus an id-based zone broadcast that
  re-localizes through the sim_i18n matcher; the deed hook is left for Phase 15.

Agent tests deliverables:
- Extend tests/profession_attunement_quests.test.ts and tests/prof_intro_quest.test.ts:
  all four quests attune their pair; the quest availability matrix (unattuned, attuned to
  the matching pair, attuned to a wrong pair) at each master; escalation formula values
  including the cheap first switch; nudge cadence cap and the once-only tutorial panel;
  the preview return cost line; matcher coverage for the broadcast and nudge strings.
- A determinism test for the new sim logic (nudge cadence and switch cost resolution under
  a fixed seed).
- Work-order and tier-mail tests: work-order credit and its cadence cap (a loop of
  immediate re-turn-ins is bounded and never gold-positive); the tier mail fires exactly
  once per tier per craft, only for attuned majors, and never re-fires on load.
- Remove tests pinned to the retired placeholder quests; re-pin deliberately where behavior
  moved to the new quests.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all sim randomness through Rng; no Math.random, Date.now, or performance.now
  in sim logic; cadence timing derives from ticks, never wall clock.
- IWorld both worlds: any new read or command lands on the matching facet file, is
  implemented in BOTH Sim and ClientWorld (live, not a stub), and updates the parity pin in
  tests/world_api_parity.test.ts in the same change.
- Server authority: selection validation and every quest, switch, and cost outcome resolve
  server-side; the client never decides.
- i18n: English-only catalog keys; quest text goes through the entity/quest pipeline; every
  sim/server-origin player string (broadcast, nudges, letter) ships its matcher rule in the
  SAME change; the S3 scanner covers quest_commands.ts, so its player text is in scope.
- Prime directive: nothing existing breaks. Players already attuned via 2039's intro quest
  keep their state; characters mid-placeholder-quest load cleanly (normalize on load, never
  crash); existing quests, deeds, and titles stay earnable.

Out of scope (do NOT do in this phase):
- Jack of All Trades (#1296, wave 2).
- The six future archetype quests (content beats come later).
- The attunement deed itself (Phase 15; only leave the hook).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the state.md validation matrix rows for content and sim changes:
- npx tsc --noEmit
- npx vitest run tests/progression.test.ts tests/professions_crafting.test.ts (content row,
  plus the referential suites for the touched domain); npm run wiki:content (player-facing
  quest content changed)
- npx vitest run tests/architecture.test.ts plus the affected sim suites; determinism check
- The 2039 attunement suites plus quest suites plus the S3 guard: npx vitest run
  tests/profession_attunement_quests.test.ts tests/prof_intro_quest.test.ts
  tests/quest_commands.test.ts tests/quest_credit.test.ts tests/localization_fixes.test.ts
- i18n keys changed: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts
- npm run ci:changed; format only changed files with a scoped biome check --write
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
matching rows. Prompt every review agent for COVERAGE, not filtering: report every
correctness or requirement gap with confidence and severity; filtering happens afterward in
the main session. If any agent's report comes back truncated, re-invoke it to resume and
emit the remainder before acting; never act on a truncated report. No commit while any
BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Commit in slices with explicit paths, never git add -A; every commit carries a body:
- feat(content): archetype lore quests at the wave-one masters
- feat(content): work-order quests at the masters
- feat(professions): switch costs, nudge cadence, and tier-crossing mail
- feat(ui): attunement preview and celebration

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A fresh character can be noticed (trend nudge), walk to a master, attune, see the full
      picture pre-commit, switch once cheaply, and pay escalating amends after.
- [ ] All four wave-one archetypes are reachable: each master offers its lore quest and the
      attunePair effect lands the correct pair.
- [ ] The pre-commit preview explains majors, hobby, dormancy, and the make-amends return
      cost, in both hosts.
- [ ] Make-amends is repeatable at the masters with the 5 + 3 * switchCount escalation and a
      deliberately cheap first switch.
- [ ] Nudges never spam: cadence cap enforced, letter-voice follow-up once per trend window,
      tutorial panel fires exactly once at the first cap moment.
- [ ] Attunement celebration lands: banner, title grant, id-based zone broadcast with
      matcher coverage; deed hook present but inert.
- [ ] Each master offers its cadence-capped work order; turning one in consumes the
      materials and cannot be looped for unbounded XP or gold.
- [ ] Crossing a major-craft tier delivers exactly one congratulation mail from the
      archetype's master; re-crossings, hobby crossings, and unattuned characters deliver
      none.
- [ ] q_archetype_acceptance and q_prof_make_amends are fully retired: no content rows,
      i18n keys, locale fills, tests, or questIds references remain.
- [ ] Players attuned via 2039's intro quest keep their state; mid-quest placeholder
      characters load cleanly.
- [ ] All STEP 3 validation commands green.

STEP 6 - DOC UPDATES + MEMORY:
Update docs/professions-2/progress.md (status table row, Phase 14 checklist, notes with the
phase-start commit and any deferrals). Update docs/professions-2/state.md: the New surfaces
per phase list gains the Phase 14 entry (the four lore quest ids, the make-amends quest
ids, the six work-order quest ids and their cadence cap, the tier-mail one-shot flags, the
nudge cadence surface and its i18n key namespaces, the celebration broadcast id and
matcher rule, and the note that the placeholder quest rows are gone). Record surprises to
Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
Phase status (complete / partial with reasons); files touched; validation results (each
command, pass or fail); review verdicts per spawned agent; deferrals with issue links; one
line QA handoff naming the phase-start commit for the QA diff.

STOPPING RULES:
- Stop if 2039's selection whitelist cannot express a quest's target pair: report the gap
  and the proposed whitelist change; do not widen the whitelist ad hoc without recording the
  decision in state.md.
```

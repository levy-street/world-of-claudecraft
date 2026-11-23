# Phase 12c: The Mastery Curve

Profession pacing becomes real. Today the sim has NO skill cap anywhere (300 is a display
constant in `professions_view.ts` plus display-only `maxSkill` content rows), and the tier-0
"free floor" in `tierProgressMultiplier` grants full gain on the cheapest recipes forever, so a
player can spam any skillReq-0 recipe from 0 to 300 in about 30 minutes of throttled crafting;
fishing caps in about 35. Live community reports confirm both halves: players are asking
whether common recipes are the intended path to 300, and a dormant craft shows the inverted
display where the basic recipe reads Full skill gain while every higher recipe reads No skill
gain. The locked pacing ruling ("fast early, slow top; scarcity, materials and adventure, is
the clock") finally gets its mechanism: the four-state gray-out curve, enforced per-profession
caps as content data, and a ONE-TIME reset of skill values earned under the placeholder rules,
keeping everything players own and know.

Approved by the 2026-07-20 mastery and provenance amendments (state.md is the authority; every
number below is a maintainer-approved number recorded there). Tracked as issue #2235. This
phase must land BEFORE Phase 13: enchanting inherits the throttle scope and the quality-tiered
gain model on its first reachable day, so nothing ships fast and gets nerfed later. The curve,
the caps, and the reset ship in the SAME deploy: nobody levels under the new curve and then
gets reset, and nobody resets into the old curve.

## Context pointers

- `docs/professions-2/state.md`: the 2026-07-20 mastery and provenance amendments block (the
  authority), the updated Tuning targets (curve constants, caps, time-to-master targets), and
  the resolved OPEN items this phase implements (q_prof_hobby_switch xpReward 0).
- `docs/professions-2/progress.md`: phase status and the phase-start commit record.
- `docs/professions-2/implementation-plan.md`: team workflow and the review dispatch matrix.
- `src/sim/professions/wheel.ts`: `gainCraftSkill` (additive-only, unclamped: the craft-side
  clamp choke point), `tierForSkill`, `tierProgressMultiplier` (the free floor to retire:
  `recipeTier <= 0` returns 1 unconditionally), `REDUCED_TIER_MULTIPLIER`,
  `normalizeCraftSkills` (accepts any finite value: the load-side clamp and reset site).
- `src/sim/professions/archetype.ts`: `craftSkillGainMultiplier` (the ONE gain composition,
  consumed by crafting.ts AND the crafting view, so the difficulty label cannot diverge) and
  `archetypeCeilingFor` (majors unlimited, hobby and pre-archetype rare, dormant common).
- `src/sim/professions/gathering.ts`: `queueGatheringGrant` / `drainGatheringGrants` (the
  gathering gain path: flat 1 per harvest today, `Math.max(0, current + amount)`, never reads
  maxSkill) and `normalizeGatheringProficiency` (the second load-side site, including the
  legacy `professions` fallback shape).
- `src/sim/professions/fishing.ts`: the per-catch grant and `fishingBandFor` over the shared
  `proficiency_bands.ts` thresholds.
- `src/sim/professions/crafting.ts`: `CRAFT_SKILL_GAIN`, the craft throttle
  (`CRAFT_THROTTLE_WINDOW_SECONDS` / `CRAFT_THROTTLE_MAX_PER_WINDOW` in
  `src/sim/content/professions.ts`, enforced in the resolve path): the window the enchanting
  and salvage actions join.
- `src/sim/professions/enchanting.ts` and `salvage.ts`: `ENCHANTING_SKILL_GAIN` (flat 1,
  unmultiplied, no throttle today) and the salvage resolver; sim-complete, unwired until
  Phase 13, which is exactly why the pacing machinery lands NOW.
- `src/sim/professions/battlefield_xp.ts`: `BATTLEFIELD_XP_TRICKLE` gains through
  `gainCraftSkill`, so the cap clamp covers it automatically; observe, do not retune.
- `src/sim/content/professions.ts`: the four gathering `maxSkill: 300` display rows that
  become enforced per-profession cap data (and the craft-side rows this phase adds).
- `src/sim/sim.ts`: `CharacterState` (craftSkills, gatheringProficiency, the persisted
  one-shot flag idiom: `recipesGrandfathered` in `src/sim/professions/training.ts` and the
  `guildLetterSent` mailWelcomed shape are the precedents).
- `src/sim/professions/guild_letter.ts` and `src/sim/content/letters.ts`: the authored-letter
  infrastructure the reset notice letter rides (`mailAuthoredLetter` SimContext callback;
  letters register in TWO ui registries with a coverage count pin, see the Phase 7 entry).
- `src/ui/professions_view.ts`: `CRAFT_MAX_SKILL`, `buildSkillBar`, `craftNextUnlock` (the
  unreachable-carrot state to fix: it returns the max state only at 300 today).
- `src/ui/crafting_view.ts`: `CraftDifficulty` (three states today; becomes the four classic
  states from the SAME shared multiplier).
- Pins this phase re-points (full list in the Pin-cost appendix): tests/professions_view.test.ts,
  tests/professions_skill.test.ts, tests/archetype_ceiling.test.ts, tests/crafting_view.test.ts,
  the maxSkill fixture files, and the parity goldens whose digests carry skill values.

## Starter Prompt

```
This is Phase 12c of the Professions 2.0 feature: The Mastery Curve.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: replace the free floor with the four-state gray-out curve, enforce per-profession skill
caps as content data, extend the craft throttle to enchanting and salvage, make enchanting
gains quality-tiered with a soft ceiling, and run the one-time skill reset, all in one deploy.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the tree must be clean; stop if dirty with work you did not create.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate (gate under Node 24),
  combo-recipes-broken-online (the #2033 stub trap), i18n-semantic-regressions-gate-trap
  (reworded prose re-pins), the professions packet entries.
- Record the phase-start commit in docs/professions-2/progress.md Notes.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly): spawn one Explore agent to read
and summarize: docs/professions-2/state.md (the mastery amendments block and the updated
Tuning targets), docs/professions-2/progress.md, this phase file, src/sim/professions/wheel.ts,
archetype.ts (craftSkillGainMultiplier + archetypeCeilingFor), gathering.ts (grant drain +
normalize + the node-tier data), fishing.ts, crafting.ts (gain + throttle), enchanting.ts,
salvage.ts, battlefield_xp.ts, content/professions.ts (maxSkill rows, throttle constants),
the CharacterState persistence and one-shot flag idiom in sim.ts and training.ts
(recipesGrandfathered) and guild_letter.ts (guildLetterSent, mailAuthoredLetter),
src/ui/professions_view.ts and crafting_view.ts, and the CLAUDE.md files for src/sim/,
src/sim/professions/, src/ui/, and tests/. The summary must return: every call site of
gainCraftSkill and queueGatheringGrant; the exact throttle mechanism and its constants; the
one-shot flag idiom end to end (persist, normalize, serialize); the authored-letter
registration recipe including both ui registries and the count pin; and the full list of
tests pinning 300, maxSkill fixtures, gain values, or the three-state difficulty.

STEP 2 - EXECUTE. Suggested slices (sim curve, caps + reset, throttle + enchanting, ui),
sequential or lightly parallel; the sim curve slice lands first since everything reads it.

Slice A, the curve:
- tierProgressMultiplier becomes the four-state curve for EVERY recipe tier INCLUDING 0:
  full (1.0) at or above capability, REDUCED_TIER_MULTIPLIER (0.5) one tier below,
  a new MINIMAL_TIER_MULTIPLIER (0.25) two below, zero three or more below. The free-floor
  early return is deleted; the function comment re-teaches the classic
  orange/yellow/green/gray reading. Deterministic fractional gains; NEVER a skill-up roll
  (a roll would insert an Rng draw into every craft and re-roll every golden; see the
  determinism stopping rule).
- craftSkillGainMultiplier composes unchanged (archetype ceiling zero for above-ceiling
  recipes stays EXACTLY as is for crafting); the dormant/hobby/major identity outcomes
  this produces are the approved design (dormant plateaus on commons, hobby reaches about
  100 with a green crawl to cap, majors master).
- Gathering: per-harvest gain becomes node-tier-relative with the same four-state shape:
  a node of tier T grants full gain while the player's proficiency is below the band that
  tier is meant to carry, then decays by the same 1 / 0.5 / 0.25 / 0 ladder as proficiency
  outgrows it, so t1 nodes gray out and Thornpeak t3 nodes are what finish mining, logging,
  and herbalism (adventure is the clock). Fishing: per-catch gain becomes band-relative
  and FRACTIONAL at the top (band-appropriate catches carry full value early, decaying so
  that proficiency 200 is a thousands-of-catches journey; junk catches stop granting once
  band 0 is outgrown). Exact fractions and boundaries are yours within these shapes; land
  every one as a NAMED exported constant, pinned, beside the Phase 12b rhythm finals in
  state.md Tuning targets.
Slice B, caps and the reset:
- Caps as content data: every profession record carries an enforced maxSkill: the nine
  crafts and enchanting 125; mining, logging, herbalism 100; fishing 200 (the approved
  numbers; they end where content ends and rise with future zones by data edit).
- Clamp at ALL FOUR arms: gainCraftSkill (covers crafting, enchanting, battlefield
  trickle), the gathering drain, normalizeCraftSkills, and normalizeGatheringProficiency
  (including the legacy fallback shape). Missing any arm is a defect: divergent behavior
  between crafting and gathering, or over-cap saves leaking through.
- At cap, ACTIONS STILL WORK: crafts still resolve and still proc masterwork, harvests
  still yield, catches still land; only skill gain stops. Pin this.
- The ONE-TIME reset: at load-time normalize, a character without the new persisted
  one-shot flag has BOTH maps (craftSkills, gatheringProficiency) zeroed and the flag set
  (the recipesGrandfathered / mailWelcomed idiom exactly: optional CharacterState boolean,
  normalize default, serialized unconditionally). Fires exactly once across relog,
  reconnect, restart, and later deploys. NOTHING else changes: the keep list (all items,
  bank, gold, tools, knownRecipes, recipesGrandfathered, attunements and switch history,
  deeds and renown, character level and XP, quests, mail) is a LEDGER in this phase's
  notes, one row each marked reset / kept / derived, and QA pins it row by row.
- The reset notice: a one-time authored system letter through mailAuthoredLetter (the
  Phase 7 infra: content row in letters.ts, BOTH ui letter registries, the coverage count
  pin) telling the player what reset and what they keep. English only; the letter body is
  entity-i18n content like every authored letter.
- The re-crossing audit: enumerate EVERY observer of the two skill maps (deed triggers at
  proficiency 100 and craft 75, celebrations, letters, anything threshold-keyed) and pin
  that each no-ops on a SECOND crossing after reset: no duplicate deed grant, renown, or
  mail. The deed system's already-earned check should make these silent no-ops; "should"
  becomes a test here.
- The staging rehearsal (release evidence, not CI): against a copy of the production
  database, run the reset and diff every character blob before and after; assert the ONLY
  deltas anywhere are the two zeroed maps plus the flag. Record the evidence in
  progress.md Notes; the deploy does not ship without it.
Slice C, throttle scope and enchanting:
- The 10-per-60s craft throttle becomes a SHARED action window: crafting, disenchant,
  enchant-apply, and salvage all draw from one budget (rename or wrap the existing
  window seam; never a second parallel window). The enchanting/salvage arms are testable
  now even though Phase 13 wires the commands.
- Enchanting gains become quality-tiered with the SOFT ceiling: the effective gain tier is
  min(the disenchanted item's quality tier or the applied enchant's tier, the archetype
  ceiling), then the same four-state curve against the player's enchanting capability
  tier. Rarer input always grants at least as much; an epic disenchant NEVER grants zero
  merely for sitting above a pre-archetype ceiling (unlike crafting's hard above-ceiling
  zero, which stays). ENCHANTING_SKILL_GAIN stops being a flat unmultiplied 1.
- q_prof_hobby_switch xpReward becomes 0 (stays repeatable; the resolved OPEN item; the
  quest's job is the switching service, not an XP faucet).
- Battlefield trickle: no retune; verify the cap clamp covers it and record its relative
  share under the new curve in the phase notes for the Phase 15 review.
Slice D, UI and copy:
- crafting_view difficulty becomes the FOUR classic states from the same shared
  multiplier (full / reduced / minimal / none), colored orange / yellow / green / gray;
  information-add, preset-identical.
- professions_view: CRAFT_MAX_SKILL retires in favor of the per-profession content cap;
  buildSkillBar and the pips derive from it; craftNextUnlock gains a cap-aware mastered
  state ("Mastered, for now" copy) instead of advertising an unreachable next tier
  forever; the gathering rows read their content caps (100 / 100 / 100 / 200).
- Every new player string is an English-only t() key in the matching catalog module; any
  new sim-emitted denial or notice is a text-free stable id plus matcher, and the S3 scan
  list (tests/localization_fixes.test.ts) is extended for any new sim module in the same
  change (this trap has fired on every sim extraction in packet history).
- npm run wiki:content regenerated (guide freshness gate); the guide prose full rewrite
  stays Phase 15, touch only what the curve makes factually false.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: the curve and caps are pure arithmetic; ZERO new Rng draws anywhere. All
  goldens stay byte-identical EXCEPT the ones the Pin-cost appendix names (skill values in
  their digests shift under the new gain arithmetic).
- One sim, three hosts: constants and curve live in src/sim/; both hosts read the same
  content caps; the offline host needs nothing for the reset (characters do not persist
  there) but must run the same curve.
- Server authority: the reset, clamps, and gains resolve server-side online; the client
  never decides.
- IWorld: no new members expected (caps ride professionsState / content); if one becomes
  necessary, facet + both worlds + parity pin in the same change.
- i18n: English-only keys; stable ids + matchers for sim text; M16 handling per the house
  rules; the reset letter follows the authored-letter recipe completely.
- Prime directive: nothing breaks. The reset touches EXACTLY two maps and one flag; the
  blob-diff rehearsal is the proof, not a claim.

Out of scope (do NOT do in this phase):
- Wiring enchanting/salvage commands to players (Phase 13 owns the seam; this phase lands
  the pacing machinery they inherit).
- The identical-signer stacking, provenance copy, unified loot-harvest, and mail expiry
  work (Phase 12d).
- Recipe or node content additions; deed additions (Phase 15); work orders (Phase 14).
- Any masterwork constant change (the current constants are FINAL per the amendments; they
  already harmonize with the 125 cap).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx tsc --noEmit; npx vitest run tests/architecture.test.ts (sim purity + determinism).
- The touched-suite sweep: tests/professions_skill.test.ts, tests/professions_view.test.ts,
  tests/crafting_view.test.ts, tests/archetype_ceiling.test.ts,
  tests/professions_crafting.test.ts, tests/professions_gathering.test.ts,
  tests/professions_fishing.test.ts, tests/gathering_rhythm.test.ts,
  tests/professions_enchanting.test.ts, plus every new suite (reset, clamps, re-crossing,
  throttle scope).
- Parity: npx vitest run tests/snapshots.test.ts tests/world_api_parity.test.ts; regen ONLY
  the goldens the appendix names, each in its own reviewed commit.
- i18n: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts.
- npm run wiki:content + tests/guide.test.ts freshness.
- npm run ci:changed; scoped biome on touched files.
- Spawn review agents per the Review Dispatch Matrix (architecture-reviewer and
  test-coverage-auditor always match here; migration-safety for the reset flag;
  qa-checklist at the end). COVERAGE, not filtering; resume truncated agents.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, Conventional Commits):
- feat(professions): the four-state mastery curve replaces the free floor
- feat(professions): enforced per-profession skill caps as content data
- feat(professions): the one-time skill reset with the keep ledger
- feat(professions): shared action throttle and quality-tiered enchanting gains
- feat(ui): four-state difficulty colors and the cap-aware mastered state

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] No recipe grants full gain forever: the free floor is gone; the four-state curve is
      pinned at every boundary for crafting, gathering, fishing, and enchanting.
- [ ] Every profession cap is enforced at gain time and load time; over-cap saves clamp
      down; at cap, crafting still procs masterwork and harvests still yield.
- [ ] The reset fires exactly once per character (relog, reconnect, restart, second deploy
      all pinned); the keep/reset ledger is fully pinned; the blob-diff rehearsal evidence
      is recorded.
- [ ] Re-crossing any skill threshold after reset double-grants nothing.
- [ ] Crafting, disenchant, enchant-apply, and salvage share one throttle window.
- [ ] Enchanting gains are quality-tiered with the soft ceiling: rarer input never grants
      less, and never zero above a pre-archetype ceiling.
- [ ] q_prof_hobby_switch grants 0 XP and stays repeatable.
- [ ] The reset notice letter arrives exactly once, through the authored-letter infra,
      with both registries and the count pin updated.
- [ ] The crafting window shows four difficulty states; the professions window shows the
      real caps and the mastered state; no unreachable next-tier carrot remains.
- [ ] Zero new Rng draws; goldens byte-identical outside the appendix list.
- [ ] All validation rows green; every deliberate re-pin matches the Pin-cost appendix.

STEP 6 - DOC UPDATES + MEMORY: update progress.md (status row, checklist, phase-start
commit, the rehearsal evidence) and state.md (Current phase pointer; the New surfaces
Phase 12c entry with the final constant names, the flag name, the letter id, the i18n
namespaces; Tuning targets updated from placeholders to as-landed finals). Record genuine
surprises to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT: phase status; files touched; validation results per
command; review verdicts; deferrals; one line for the Phase 12c QA handoff naming the
phase-start commit.

STOPPING RULES:
- Stop if any part of the design would require a new Rng draw in the sim (a skill-up
  proc roll, a random reset order): the deterministic-fractions ruling is locked.
- Stop if the reset would need to touch ANY state beyond the two skill maps and the flag.
- Stop if a cap value would need to differ from the resolved numbers (125 / 100 / 200);
  that is a state.md amendment, not an implementation choice.
- Stop if the blob-diff rehearsal shows any unexplained delta; do not ship around it.
```

## Pin-cost appendix (inventoried 2026-07-20 against release/v0.29.0, 475f1e584)

The CLOSED, pre-briefed list of deliberate re-pins and regens. Anything OUTSIDE this list
that reds is a defect to fix, not a cost to absorb. Re-inventory this list if any later
phase lands before 12c starts (the rule from the 12b appendix experience).

- tests/professions_view.test.ts: the CRAFT_MAX_SKILL 300 literal, the 12-pip count, the
  132/300 fill fraction, and the over-cap 450 saturation arms all re-pin to the
  per-profession cap model (over-cap display saturation becomes impossible by
  construction after the clamp; that arm becomes a clamp pin).
- maxSkill: 300 fixture rows re-pin to the resolved caps in:
  tests/professions_window_focus.test.ts, tests/professions_gathering.test.ts,
  tests/professions_contracts.test.ts, tests/snapshots.test.ts,
  tests/gathering_view.test.ts, tests/professions_fishing.test.ts.
- tests/professions_skill.test.ts: the tierProgressMultiplier table re-pins from the
  three-state to the four-state ladder (the tier-0 rows change value by design).
- tests/crafting_view.test.ts: the CraftDifficulty three-state pins become four-state.
- tests/archetype_ceiling.test.ts: unchanged for crafting (the hard ceiling stays); gains
  arms for the enchanting soft-ceiling min() behavior.
- tests/gathering_rhythm.test.ts and tests/professions_gathering.test.ts: gain-per-harvest
  pins re-pin to the node-tier-relative values; the band constants themselves are
  UNCHANGED (12b finals stand).
- tests/professions_fishing.test.ts: accrual arms re-pin to the band-relative fractional
  gains; the one-draw contract, bite constants, and table literals are UNCHANGED.
- Parity goldens: professions_craft and professions_gather regenerate (their digests carry
  craftSkills / gatheringProficiency values that shift under the new arithmetic); each
  regen lands in its own reviewed commit with a byte-diff note. Every OTHER golden stays
  byte-identical (zero new draws, zero new fields); a third regenerating golden is a
  defect.
- tests/profession_attunement_quests.test.ts: the q_prof_hobby_switch xpReward pin
  re-pins to 0.
- The letter registries' coverage count pin extends by one for the reset notice letter.
- NEW suites this phase adds (not re-pins, listed for the QA twin): the reset one-shot
  suite, the keep-ledger row pins, the re-crossing suite, the four-arm clamp suite, the
  shared-throttle suite, and the enchanting soft-ceiling suite.

## As landed (2026-07-20, PR #2242): appendix addendum and deviations

The appendix held for goldens: exactly professions_craft and
professions_gather regenerated, draws and drawDigest byte-identical in both.
The zero-new-fields requirement drove the reset flag design:
masteryResetApplied is CharacterState-ONLY (serializeCharacter writes literal
true; no PlayerMeta field, so samplePlayerMeta sees zero new keys), and the
transient PlayerMeta.pendingMasteryResetNotice (inert false, never
serialized) carries the one-time mail-phase letter send. ADDENDUM rows the
appendix did not list, each a legitimate old-curve premise re-pinned
minimally (the 12b appendix-incompleteness precedent):

- tests/crafting_view.test.ts: beyond the budgeted three-to-four-state row,
  3 tests re-pinned (two-below now reads minimal, the free-floor test became
  the retirement test, the never-gates-craftable fixture moved to a genuinely
  gray row) plus 2 boundary-sweep table rows.
- tests/archetype_ceiling.test.ts: the dormant free-floor progress test
  became the curve-not-ceiling test (gray outside-common at 100; a 30 to
  30.5 yellow arm preserves the ceiling-independence claim).
- tests/professions_crafting.test.ts: two-below re-pinned to minimal 0.25
  with a new three-below zero arm; the high-capability common arm is gray.
- tests/deeds_sites.test.ts: the enchanting threshold-crossing stages move
  from 74 plus flat 1 to 74.75 plus green 0.25.
- tests/deeds.test.ts and tests/deeds_reconcile.test.ts: fixtures carry
  masteryResetApplied true (curve-era blobs; the reconcile arm was caught by
  the FULL gate, not the phase matrix); the pre-curve arm (retro inferences
  read RESET values) is pinned in professions_mastery_reset.test.ts.
- The reset letter needed the five non-Latin M16 fills (the Phase 7 authored
  letter precedent); landed as the fix(i18n) commit.

Fixture rows deliberately NOT re-pinned (pure pass-through view inputs never
compared against content): professions_window_focus maxSkill 300 rows incl.
the fictional skinning row, the professions_contracts type-contract record.

Review-round additions (six reviewers, zero blocking): GOLD_ACCENT_COLOR in
icons.ts (the named TS twin of --gold) replaces the anonymous tint literal;
skill readouts floor and points-to-go ceil in both view cores (fractional
gains never render an uncrossed threshold as crossed, pinned); the
destructive rollback strip-refire arm and the second ui letter registry are
consciously pinned in professions_mastery_reset.test.ts. Phase 13 heads-up:
the shared throttle gates disenchant/salvage BEFORE their rng draw (unwired
today).

QA addendum rows (Phase 12c QA, all additive):
- tests/mastery_reset_rehearsal.test.ts gains the completeness arm (arm 3):
  flag-absent rows must show every craft/gathering leaf, legacy mirror
  included, at exactly 0 in the output; a partial reset now fails the
  synthetic corpus AND the production-copy run instead of tallying as
  applied.
- tests/mastery_reset_online.test.ts (NEW suite): the reset and the notice
  letter through a live GameServer.join plus the restart-relog no-refire
  arm (the db-mock boilerplate from deeds_reconcile.test.ts).
- tests/professions_mastery_reset.test.ts gains the re-crossing positive
  control (a never-earned prog_mining_100 grants fresh on the climb).
- tests/profession_identity_card.test.ts gains the GOLD_ACCENT_COLOR
  lockstep pin (tokens.css --gold = the TS twin = #ffd100).
- scripts/pr_shot_targets.mjs stub values re-staged post-12c-legal
  (craft 125 at cap; gathering 88/45/100/68 over caps 100/100/100/200) and
  the six committed after-shots recaptured; the live IWorld path was always
  correct, the stale stub only misrepresented the UI in the committed
  screenshots.

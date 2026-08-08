# Phase 1: Foundation: the fifth gathering profession

This phase registers farming everywhere the profession chassis looks: the id union,
the profession record, the id list, the UI name and denial copy, the procedural icon,
the wiki, and every test pin that moves when a fifth gathering profession appears. It
adds no gameplay: no patches, no commands, no way to gain skill. The design authority
is `docs/farming/state.md` (D1, D23, the blast-radius reference); this file cites it
rather than re-deriving anything.

Live-surface note (binding): after this phase merges, the farming row renders at 0 in
the professions window gathering section and the character sheet, the wiki farming page
exists, and there is deliberately NO way to gain farming skill yet. Nothing else is
player-reachable.

EXECUTED 2026-08-08 WITH DEVIATIONS (authoritative record: progress.md Phase 1 Notes
and state.md "Locked deviations"; summary here so this file stays honest): (a) the
icon suite's E2 art-backed pin cannot be satisfied procedurally; a PENDING_ART_IDS
allowlist with inverted, self-clearing assertions landed instead (maintainer sign-off
owed); (b) the "isolated golden regen" never happened because the predicted parity
red never materializes (the trace sample drops inert zero keys before digesting;
regen proven byte-identical; the growth phase inherits the first real regen); (c)
the Master Gatherer desc and three gatherDeeds guide bodies were pulled INTO this
phase (fishing-precedent reword); (d) delivery followed D22: no push, no PR; the
branch merged --no-ff into feature/farming-plan and the would-be PR body lives in
progress.md; (e) the blast-radius list gained the sites discovered in flight
(gather_tool_tooltip KIND_KEYS and Partial neighbours, gather_node_tooltip maps,
the two-key guide count prose). This block's lettering is NOT canonical:
state.md's "Locked deviations" ledger is, and it enumerates seven entries
(a) to (g) covering both files' sets (harmonized in Phase 1 QA). Phase 1 QA
passed 2026-08-08, PASS-WITH-FOLLOWUPS: five findings fixed on
fix/farming-phase-01-qa (the char sheet farming icon fallback among them),
deferrals ledgered; full record in progress.md's Phase 1 QA notes.

### Starter Prompt

```
This is Phase 1 of the Farming feature: "Foundation: the fifth gathering profession".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: farming exists everywhere the profession chassis looks, with every silent-miss
site swept and every moved pin re-pinned, and with zero rng change proven by the
parity fingerprint before the deliberate full golden regen.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Use git -C /home/fernandoramirez/Documents/woc-farming-plan for every
  git command (the Bash cwd drifts).
- git status must be clean. If it is not, stop and surface it.
- Re-resolve the NEWEST release branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create
  branch fix/farming-phase-01-foundation off its tip. Record the phase-start commit
  hash for the STEP 3 diff. If release moves mid-phase and this branch goes
  long-lived, merge release in and run the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: node25-breaks-jsdom-gate (the standing armory browser
  gate red), i18n-semantic-regressions-gate-trap, big-diff-reviewer-turn-budgets,
  worktree-cwd-drift-misroutes-git, mutation-checks-commit-first.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent (breadth: very thorough) to read and summarize:
- docs/farming/state.md (all of it: locked decisions, the blast-radius reference, the
  validation matrix) and docs/farming/progress.md.
- This phase file, docs/farming/phase-01-foundation.md.
- The source surface for this phase: the module exporting GatheringProfessionId,
  GATHERING_PROFESSIONS, and GATHERING_PROFESSION_IDS (locate by exported symbol);
  src/ui/gathering_profession_name.ts (GATHERING_PROFESSION_NAME_KEYS);
  src/ui/gathering_view.ts (gatherDeniedLineKey, gatherToolNoNodeKey);
  src/ui/i18n.catalog/hud_chrome.ts; the procedural icon module the existing gather_*
  icons live in (locate by icon id); tests/professions_contracts.test.ts;
  tests/profession_icons.test.ts; tests/snapshots.test.ts (the proficiency round-trip
  literal); tests/professions_skill_caps.test.ts; tests/professions_blob_growth.test.ts;
  the parity harness entry under tests/parity (how goldens sample proficiency and
  where the rng draw-order fingerprint lives in the digest).
- CLAUDE.md files: the root CLAUDE.md, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
  src/ui/CLAUDE.md.
The orchestrator never reads planning docs or coordinator monoliths directly; it works
from this summary. The summary MUST return: (1) the resolved path of the profession id
module, the exact current union member order, and the append-last iteration-order
comment text; (2) the full shape of the fishing GATHERING_PROFESSIONS row to copy;
(3) the current arms and fallthrough behavior of gatherDeniedLineKey and
gatherToolNoNodeKey; (4) the hud_chrome.ts key naming pattern for the four
per-profession families (toolTierUnmet, toolRequired, wieldUnmet, noNodeNearby) and
the display-name key for an existing profession, plus what the M16 wordiness rule
triggers on; (5) the gather_* icon recipe: file, registration, and what
tests/profession_icons.test.ts demands; (6) every pinned literal that must move, with
its current value (the contracts exact-order skills array, the snapshots round-trip
literal, skill caps, blob growth); (7) how the parity digest samples proficiency and
where the rng fingerprint sits, plus the UPDATE_PARITY regen command shape; (8) every
file containing a literal object typed GatheringProficiency; (9) the CLAUDE.md
constraints that bind this phase; (10) anything in state.md or progress.md that
contradicts this brief.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly: spawn the three agents below in parallel, give each agent
ONLY the Explore summary plus its own slice brief, and never put a teammate in plan
mode. Each agent owns its vertical slice including its tests. The slices are
file-disjoint by design; if two agents would touch the same file, serialize them.
Assess the real workload and merge slices if one turns out trivial.

Agent A, sim registration and contract re-pins:
- Append 'farming' LAST to the GatheringProfessionId union (D1).
- Add the GATHERING_PROFESSIONS record row: maxSkill 100, name/icon/description
  following the fishing row's exact shape (icon id gather_farming).
- Append 'farming' LAST to GATHERING_PROFESSION_IDS; keep the append-last
  iteration-order comment (the fishing precedent).
- Never touch CRAFT_RING (D1: farming is a gathering profession, not an eleventh craft).
- Re-pin tests/professions_contracts.test.ts: the exact-order skills array gains a
  fifth row, farming last.
- Re-pin tests/professions_skill_caps.test.ts and tests/professions_blob_growth.test.ts
  (the worst-case save blob grows).
- Run npx tsc --noEmit and add the farming key to every literal GatheringProficiency
  fixture map it surfaces (mostly test fixtures; farming: 0 unless the fixture's
  intent demands otherwise).

Agent B, UI sweep (the silent-miss sites; every one of these misses silently at
runtime today, no compile error):
- src/ui/gathering_profession_name.ts: a GATHERING_PROFESSION_NAME_KEYS row for
  farming (an unlisted id renders NO row).
- src/ui/gathering_view.ts: farming arms in gatherDeniedLineKey and
  gatherToolNoNodeKey with farming-appropriate English copy; today they silently fall
  through to the corpse line and the mining line respectively. Add pins that fail on
  fallthrough: assert the farming id returns a farming-specific key, not the corpse
  or mining key.
- src/ui/i18n.catalog/hud_chrome.ts: the farming display name plus all four
  per-profession key families: toolTierUnmet, toolRequired, wieldUnmet, noNodeNearby.
  English only; never edit locale overlays, with the one M16 exception: every new
  value wordy enough to trip M16 also ships its five non-Latin overlay fills in the
  same change.
- The gather_farming procedural icon following the existing gather_* recipe;
  tests/profession_icons.test.ts demands the id and must go green.

Agent C, wire and wiki:
- tests/snapshots.test.ts: the proficiency round-trip literal gains farming: 0 (the
  gprof key carries the fifth entry for free, wholesale-replace mirror; verify the
  suite proves it round-trips).
- Run npm run wiki:content and stage the regenerated guide content: the farming page
  auto-appears and the gathering summary line updates. npx vitest run
  tests/guide.test.ts must go green.

The orchestrator itself owns the parity verify-then-regen sequence in STEP 3: it is
sequencing-critical and lands as its own isolated commit over the finished tree.

INVARIANTS THIS PHASE MUST KEEP
- Zero rng change is itself an acceptance criterion: every parity golden may move ONLY
  by the mechanical farming field add, and the rng draw-order fingerprint in every
  digest must be identical before the regen.
- Every player-visible string added this phase is a t() key in ENGLISH ONLY in the
  matching src/ui/i18n.catalog/ module; every M16-wordy value ships its five non-Latin
  overlay fills in the same change; no other overlay edit of any kind.
- Sim purity holds in every touched sim file: zero DOM/browser/Three imports, no
  imports from render/ui/game/net, no Math.random, Date.now, or performance.now
  (tests/architecture.test.ts guards it).
- Every moved test pin is re-pinned deliberately to its new literal, never loosened.
- All work happens in ~/Documents/woc-farming-plan; every commit uses explicit paths,
  never git add -A.

Out of scope (do NOT do in this phase):
- No patches, no plot state, no FARM_PATCHES content.
- No commands (plant, harvest), no growth logic, no gain schedule, no way to gain
  farming skill at all.
- No items (seeds, produce, hoes, husks), no vendors, no recipes.
- No NPCs, no quests, no windows, no render work, no map pins.
- No deeds rows (the deeds phase owns them).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/professions_contracts.test.ts tests/profession_icons.test.ts
  tests/snapshots.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts
- npx vitest run tests/professions_skill_caps.test.ts tests/professions_blob_growth.test.ts
- The parity verify-then-regen sequence, exactly this order:
  1. npx vitest run tests/parity BEFORE touching any golden.
  2. Inspect the failure output: the red must be confined to the mechanical farming
     field add in the sampled proficiency map, and the rng draw-order fingerprint in
     every digest must be IDENTICAL. Any other movement means behavior changed: STOP
     (see STOPPING RULES).
  3. UPDATE_PARITY=1 npx vitest run tests/parity to regenerate, then npx vitest run
     tests/parity again to confirm green.
  4. The regen goes in its OWN commit containing nothing but tests/parity/golden/**.
- npx vitest run tests/guide.test.ts
- npm run ci:changed (fix findings with a SCOPED npx @biomejs/biome check --write
  <file>, never whole-tree)
- node scripts/gate_select.mjs
Then run git diff --name-only <phase-start-commit>..HEAD and dispatch ONLY the Review
Dispatch Matrix rows in docs/farming/implementation-plan.md that match the diff.
Expected matches for this phase: cross-platform-sync (sim registration plus the wire
literal), architecture-reviewer (src/sim touched), frontend-seam-reviewer (src/ui
touched), then qa-checklist once the deliverable set is complete. Every review agent
gets: a hard 30-tool-call budget, report-first instructions, and the coverage
instruction "report every issue including low-severity and uncertain ones; ranking
happens later". If an agent truncates or stalls, resume it with exactly: "Stop reading
more files. Output the full report now based on what you have already seen. No more
tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a
BLOCKING stands.

STEP 4 - COMMIT CADENCE
Five Conventional Commits, each with a scope and a body (what changed and why, 1 to 4
sentences after a blank line), explicit paths only, never git add -A, no session links
or Claude attribution anywhere:
1. feat(professions): register farming as the fifth gathering profession (union,
   record row, id list; plus the wiki:content regen output this row caused).
2. feat(ui): farming name keys, denial copy arms, catalog families, and the
   gather_farming icon.
3. test(professions): the re-pin sweep (contracts order, snapshots literal, skill
   caps, blob growth, proficiency fixtures).
4. test(parity): the isolated golden regen, nothing but tests/parity/golden/**.
5. docs(farming): progress and state updates.

STEP 5 - ACCEPTANCE CRITERIA
- [ ] 'farming' is the LAST member of GatheringProfessionId, GATHERING_PROFESSIONS has
      its row with maxSkill 100, and GATHERING_PROFESSION_IDS appends it last with the
      iteration-order comment preserved.
- [ ] Every silent-miss site named in state.md's blast-radius reference has a farming
      arm with a pin that fails on fallthrough: GATHERING_PROFESSION_NAME_KEYS,
      gatherDeniedLineKey, gatherToolNoNodeKey, and the hud_chrome.ts display name
      plus the toolTierUnmet, toolRequired, wieldUnmet, and noNodeNearby families.
- [ ] The gather_farming procedural icon exists; tests/profession_icons.test.ts green.
- [ ] tests/professions_contracts.test.ts green with the fifth skills row pinned in
      exact order.
- [ ] tests/snapshots.test.ts green with farming: 0 in the round-trip literal.
- [ ] npx tsc --noEmit clean: every literal GatheringProficiency fixture compiles.
- [ ] tests/professions_skill_caps.test.ts and tests/professions_blob_growth.test.ts
      re-pinned and green.
- [ ] npm run wiki:content ran; the farming wiki page exists; tests/guide.test.ts green.
- [ ] The pre-regen parity red was ONLY the mechanical field add with the rng
      draw-order fingerprint identical; post-regen tests/parity green; the regen
      commit contains nothing but tests/parity/golden/**.
- [ ] i18n additions are English-only catalog rows (plus the five non-Latin overlay
      fills for every M16-wordy value); tests/localization_fixes.test.ts green.
- [ ] There is no way to gain farming skill: no gain schedule exists, no code path
      grants farming XP, and the row renders 0 in the professions window and the
      character sheet.
- [ ] The PR body flags that farming now automatically satisfies existing
      any-profession gathering deed arms (the accepted default recorded in state.md's
      OPEN items).

STEP 6 - DOC UPDATES + MEMORY
- docs/farming/progress.md: flip the Phase 1 row to done with dates, copy the STEP 5
  acceptance list here with its check states, add a Notes block (surprises,
  deviations, deferrals with reasons).
- docs/farming/state.md: append to the per-phase ledgers (new i18n keys this phase;
  the other ledgers stay empty). Any deviation decided in-phase gets a "Locked
  deviations" line AND gets swept into docs/farming/phase-01-foundation.md and
  docs/farming/phase-01-qa.md in the same pass.
- Record surprises (a silent-miss site not on the list, a pin that behaved
  unexpectedly, a parity subtlety) in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report exactly: phase status (complete or partial, with reasons); files touched
(grouped by commit); validation results (each command, pass or fail); review verdicts
(per agent, with the BLOCKING count at zero); deferrals (each with a reason and owning
phase); and a one-line handoff for the QA session (branch, PR number, base release
branch).

STOPPING RULES
- STOP immediately if the pre-regen parity red shows ANY draw-order change: the rng
  fingerprint moving means sim behavior changed, which this phase forbids. Surface the
  trace; do not regen.
- STOP if you discover a silent-miss site NOT on the state.md blast-radius list: add
  it to state.md first (with a pin), then proceed.
- STOP if git status is dirty at STEP 0, or if a BLOCKING review finding cannot be
  fixed without leaving this phase's scope; surface to the user.

The new professions-window row is a visual change: capture before/after screenshots
per the pr-screenshots skill (desktop, and mobile where relevant), commit them under
docs/screenshots, and reference them from the PR body. Then gate via
node scripts/gate_select.mjs (the armory browser red is the standing environmental
exception; grep the log for "[gate] FAIL"; PR CI is the arbiter), push, and open the
PR against the release branch this phase was based on per
.github/PULL_REQUEST_TEMPLATE.md.
```

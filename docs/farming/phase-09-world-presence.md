# Phase 9: World presence: go-live

GO-LIVE. Every earlier phase merged dormant or decorative; this is the one merge that
opens the loop. Farming gets its face (the four farmer NPCs, farmer_jessica at Eastbrook
(eastbrook_vale) per D20), its front door (the intro quest), and its open sign (vendor
seeds, work orders, the Phase 4 convertHusks range gate). Visuals (Phase 7) and
timers (Phase 8) are already shipped, so the loop opens beautiful and legible on day
one. This is the one phase whose
dormancy flips must be atomic: a partially reachable loop is worse than a dormant one.

Live-surface note (binding): After this phase merges, seeds become purchasable (tiers 1
and 2; tiers 3 and 4 stay seed-back-only market goods per D11), the intro quest
q_farm_intro exists at farmer_jessica, work orders exist, husk conversion is reachable
at the farmer NPCs, watch fees are payable at plant time from bags (no NPC gate per
D9), and the full plant-grow-harvest-cook loop is reachable by ordinary players.
Still unreachable: farming deeds and the golden_harvest event (Phase 10), well-fed
buff dishes (Phase 11), the shared feast (Phase 12).

### Starter Prompt

```
This is Phase 9 of the Farming feature: World presence: go-live.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: farming gets its face, its front door, and its open sign in a single merge:
the four farmer NPCs, the intro quest, vendor stock, work orders, and the
convertHusks range gate, with every dormancy flip landing atomically in this one PR.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other sessions
  share the main checkout; never work there.
- git -C ~/Documents/woc-farming-plan status must be clean. Stop if it is not.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune; then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create
  branch fix/farming-phase-09-world-presence off LOCAL feature/farming-plan
  (D22: never off the release tip, which lacks the packet and all farming work),
  then MERGE the newest release tip INTO the phase branch FIRST: run the
  release-merge-audit skill plus the state.md deviation (al) absorb checklist,
  re-run the parity and count-pin suites, and verify the farming_session golden
  md5 unchanged. A jump of a minor version or more (or a triple-digit
  intersection) runs docs/farming/phase-06b-release-sync.md's shape as its own
  mid-phase BEFORE this phase instead.
- Record the phase-start commit (git rev-parse HEAD) for the STEP 3 diff.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, and
  the phase-relevant topics: pr-screenshot-browser-path (this is a visual phase),
  frozen-clock-rig-hangs-vitest (the journey probe needs an advanceable clock),
  mutation-checks-commit-first, i18n-semantic-regressions-gate-trap,
  big-diff-reviewer-turn-budgets, worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thoroughness: very thorough) to read and summarize:
- docs/farming/state.md (whole file; D9, D11, D17, D20, D21, D23, the seam
  reference on vendors and quests, and the OPEN items list matter most) and
  docs/farming/progress.md (Phase 1 to 8 notes, deviations, and which Phase 4 gate
  and Phase 5 stocking pieces were left dormant and how).
- docs/farming/phase-09-world-presence.md (this phase file).
- Source files for this phase: src/sim/content/zone1.ts (the q_prof_intro template,
  including its requiredItems re-grant), the NPC content modules and NpcDef shape
  (vendorItems, greeting wiring; Explore names the exact files and an existing
  static vendor NPC to copy), the quest objective arms and the gather objective
  precedent (the arm that credits an ACTION, not a collect), the quest_targets
  marker wiring, the work-order content rows near cook_marlow and
  WORK_ORDER_PAYOUT_FRACTION with tests/professions_work_orders.test.ts, the
  farming rollout arms in tests/professions_zone_rollout.test.ts (R37) and exactly
  how the Phase 5 hub-stocking arms were left dormant, the Phase 4 husk-conversion
  permissive gate and the watch-fee plant-time payment in
  src/sim/professions/farming.ts, the parity suite
  layout under tests/parity and the UPDATE_PARITY=1 regen recipe, and the wiki
  freshness gate (tests/guide.test.ts, npm run wiki:content).
- CLAUDE.md files: root, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
  src/ui/CLAUDE.md (quest marker and vendor UI touches), src/guide/CLAUDE.md.
The summary MUST return: (1) the NpcDef and vendor-row shapes with the exact
buyValue semantics (the dead-row trap: a stocked row without a positive buyValue
renders then refuses); (2) the q_prof_intro template anatomy (steps, requiredItems,
completion text wiring, rev field) and the action-objective precedent to copy; (3)
the quest_targets marker recipe; (4) the work-order row shape, the payout guard
arithmetic, and the arithmetic comment convention; (5) the exact dormant R37 arms
and what flips them on; (6) the Phase 4 gate seam to finalize (range-gating
convertHusks to farmer NPCs; the watch fee stays a plant-time bag payment with no
NPC gate per D9); (7) which quest suites exist and which
this phase must run; (8) the parity regen recipe and what a purely mechanical
entity-id-counter shift looks like in a red trace; (9) the NPC greeting i18n path;
(10) any Phase 1 to 8 deviation recorded in progress.md that touches this phase.
The orchestrator never reads planning docs or coordinator monoliths directly: work
from this summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly (this model under-spawns by default). Give each agent
ONLY the Explore summary plus its own slice. Never put a teammate agent in plan
mode. Default split, three agents by vertical slice, each owning its slice AND its
tests; the orchestrator itself owns the parity regen and the journey probe
afterward:

Agent A, NPCs, vendors, and gates:
- The four farmer NPCs, at the D2 hub anchors. farmer_jessica at Eastbrook
  (eastbrook_vale), the face of the skill: vendors tier 1 seeds, brook_carrot (the
  starter fee vegetable, priced in Phase 5 per D9), compost (priced in Phase 4),
  and the rung-one hoe (priced in Phase 5); gives the intro quest; converts husks
  (watch fees are paid at plant time from bags per D9: the farmers are the
  service's flavor and its suppliers, never its gate). A Fenbridge (mirefen_marsh)
  farmer: vendors tier 2 seeds and compost. The Highwatch (thornpeak_heights) and
  Evergarden parterre (evergarden) farmers: vendor compost and serve husk
  conversion ONLY (tier 3 and 4 seeds stay seed-back-only market goods per D11).
- The three non-Jessica names are decided in-phase: original and IP-safe per D17
  (real plant words and zone-flavored coinages, audited at authoring time). State
  the names and the audit result in your report.
- EVERY stocked vendor row carries a positive buyValue, assigned in its pricing
  phase (tier 1 and 2 seeds, brook_carrot, and the rung-one hoe: Phase 5; compost:
  Phase 4; the dead-row trap in the state.md seam reference). Crafted outputs never
  get buyValue.
- Greetings as English i18n rows through the established NPC dialog path; the S3
  guard stays green.
- Range-gate convertHusks to the farmer NPCs (the Phase 4 handoff), with tests for
  the in-range and out-of-range arms. The watch fee stays a plant-time bag payment
  with NO NPC range gate (D8, D9): do not gate it.
- Flip the R37 hub-stocking arms on; tests/professions_zone_rollout.test.ts
  passes.

Agent B, the intro quest:
- q_farm_intro from farmer_jessica on the q_prof_intro template: requiredItems
  grants the rung-one hoe and one vale wheat seed, so a day-one character is never
  dead-ended.
- A NEW farming action objective arm crediting the plant and harvest ACTIONS (the
  gather-objective precedent: inventory cannot prove the deed), with quest_targets
  marker wiring.
- The completion text and Jessica's greeting BOTH state the magic sentence: it
  keeps growing while you are away, and it never spoils.
- English i18n rows for all quest text; the quest suites the Explore summary
  names; a test that the objective credits on the action and not on inventory.
- This phase only ADDS a new quest; if any EXISTING quest's objective indices
  would change meaning, stop (the rev rule).

Agent C, work orders and the wiki:
- One or two produce work-order rows (cook_marlow fits: kitchens consume crops;
  decide the crops in-phase and state the choice) with the machine-enforced
  payout arithmetic: copperReward equals floor(WORK_ORDER_PAYOUT_FRACTION times
  the summed vendor sellValue), guarded by tests/professions_work_orders.test.ts.
  Keep the arithmetic comment on every row.
- Wiki regen: npm run wiki:content; the freshness gate (tests/guide.test.ts)
  passes; farming's page reflects the now-live loop.

Orchestrator-owned, AFTER the agents' work is integrated:
- The deliberate NPC parity golden regen (D23): static NPCs shift the world-ctor
  entity-id counter. First run npx vitest run tests/parity and VERIFY the red is
  mechanical (only id-counter effects, no behavioral drift). Then regen with
  UPDATE_PARITY=1 in an ISOLATED commit. Never hand-edit a golden.
- The full new-player journey probe on a live headless sim: a throwaway vitest
  file driving a real Sim with an injected ADVANCEABLE clock: buy the seed, plant
  with knobs, advance the clock, the ready banner event fires, harvest, cook a
  Phase 6 dish. Record the probe transcript in the PR body, then delete the file
  and verify the tree is clean.

INVARIANTS THIS PHASE MUST KEEP
- Every dormancy flip in this phase is atomic: the vendor rows, the quest, the
  gate finalization, and the R37 arm flips ALL land in this single PR, and none of
  them may be split into a follow-up or merged partially. A player on the merged
  build reaches the whole loop or (pre-merge) none of it.
- The server is authoritative: every purchase, quest credit, fee, conversion, and
  work-order payout resolves server-side; no client ever decides an outcome, and
  no wire command ingests a client-supplied ItemInstancePayload.
- No English in sim paths: all player text this phase adds (greetings, quest text,
  vendor and order strings) reaches the player as t() keys or id-carrying events
  re-localized client-side; src/sim/ and server/ stay language-agnostic; the S3
  guard covers every new emit in the SAME change.
- The quest rev rule: a changed objective index in an EXISTING quest bumps rev;
  this phase only adds a new quest, so any diff that changes an existing quest's
  objective order is a stop signal.
- Determinism: all randomness in every new code path goes through ctx.rng; the
  NPCs, quest arm, and gates draw no rng outside player-action moments; no
  Math.random, Date.now, or performance.now enters src/sim/.
- All parity goldens move only via the deliberate UPDATE_PARITY=1 regen in an
  isolated commit, never by hand.

Out of scope (do NOT do in this phase):
- Farming deeds and the golden_harvest rare event (Phase 10).
- Well-fed buff food (Phase 11).
- The shared feast (Phase 12).
- Wiki prose polish and the asset handoff manifest (Phase 13).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run tests/professions_work_orders.test.ts
  tests/professions_zone_rollout.test.ts tests/localization_fixes.test.ts
  tests/architecture.test.ts plus the quest suites the Explore summary named
- The parity verify-then-regen sequence for the NPC id shift (verify mechanical,
  regen isolated, re-run npx vitest run tests/parity green)
- npm run wiki:content, then the freshness gate (tests/guide.test.ts)
- npm run ci:changed
Then run git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows per the Review Dispatch Matrix in docs/farming/implementation-plan.md.
Expected matches here: architecture-reviewer (sim content and gates);
cross-platform-sync (quest credit and vendor flows cross the wire);
privacy-security-review ONLY if any server/ file moved; frontend-seam-reviewer
(quest marker and vendor UI touches); qa-checklist once the deliverable set is
complete. Every review agent gets a hard 30-tool-call budget, the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"), and, if truncated, the resume line: "Stop reading more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a BLOCKING
stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits with scopes and bodies, EXPLICIT paths, never git add
-A, no session links or Claude attribution. Suggested cut:
1. feat(content): the four farmer NPCs, vendor stock, finalized gates, R37 flips.
2. feat(quests): q_farm_intro, the farming action objective arm, markers, i18n.
3. feat(content): produce work orders and wiki regen.
4. test(parity): deliberate golden regen for the farmer NPC id shift (isolated).
5. docs(farming): progress and state ledger updates, screenshots.

STEP 5 - ACCEPTANCE CRITERIA
- [ ] All four farmer NPCs exist at their hubs with the specified roles; the three
      new names are original and IP-safe per D17 and recorded in state.md.
- [ ] Every stocked vendor row has a positive buyValue; a purchase probe of every
      row succeeds (no dead rows).
- [ ] Tier 3 and 4 seeds are stocked NOWHERE (seed-back-only per D11).
- [ ] q_farm_intro is acceptable at Jessica by a fresh character; requiredItems
      grants the rung-one hoe and one vale wheat seed; the objective credits the
      plant and harvest actions, not inventory; markers point correctly.
- [ ] The completion text and Jessica's greeting both contain the magic sentence.
- [ ] Husk conversion works in range of a farmer NPC and refuses out of range, with
      tests on both arms; the watch fee stays a plant-time bag payment with NO NPC
      range gate (D8, D9), and paying a fee far from any farmer works, with a test.
- [ ] The work-order rows pay floor(WORK_ORDER_PAYOUT_FRACTION times summed vendor
      sellValue), carry the arithmetic comment, and
      tests/professions_work_orders.test.ts passes.
- [ ] The R37 hub-stocking arms are on and tests/professions_zone_rollout.test.ts
      passes.
- [ ] The parity regen is verified mechanical and lands as its own commit;
      tests/parity is green after it.
- [ ] The full new-player journey probe passed on a live headless sim and its
      transcript is in the PR body; the throwaway probe file is deleted.
- [ ] The wiki is regenerated and the freshness gate passes.
- [ ] Every new player-visible string is an English t() key; S3 passes.
- [ ] tsc, the named suites, ci:changed, and gate_select are green (armory browser
      exception aside).
- [ ] Screenshots (desktop and mobile) of Jessica, the quest dialog, and the
      vendor grid are committed under docs/screenshots.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/farming/progress.md: the Phase 9 status row, the acceptance list
  above copied with its check states, and a Notes block (surprises, deviations,
  deferrals with reasons, the NPC names chosen, the work-order crops chosen).
- Update the docs/farming/state.md ledgers: new items and quest, new i18n keys and
  matcher rows, the NPC names, and mark the live-surface change (farming is LIVE).
- Any deviation decided in-phase gets swept into
  docs/farming/phase-09-world-presence.md AND docs/farming/phase-09-qa.md in the
  same pass.
- Record surprises (regen findings, quest arm subtleties) in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or
fail); review verdicts per agent; deferrals; and a one-line handoff for the Phase 9
QA session.

STOPPING RULES
- Stop if any go-live flip cannot be made atomic in this merge: surface the
  dependency instead of shipping a partially reachable loop.
- Stop if the NPC parity regen shows ANY non-mechanical golden movement (anything
  beyond the entity-id counter shift): that is a behavior change, not a regen.
- Stop if crediting the quest objective would change any existing quest's
  objective indices (the rev rule).
- Stop if git status is dirty at session start or the release tip cannot be
  resolved.
- Stop if a review BLOCKING cannot be fixed without out-of-scope changes.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the
standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; the
gate log is the arbiter per D22: no push, no PR). Merge --no-ff into
feature/farming-plan, delete the phase branch, and put the would-be PR body in
progress.md Notes, with before/after screenshots (desktop and mobile) captured
via the pr-screenshots skill, committed under docs/screenshots, and referenced
from the Notes block (this is a visual phase: Jessica, the quest dialog, the
vendor grid).
```

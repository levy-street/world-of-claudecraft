# Phase 13: Enchanting reachable

The enchanting and salvage sims are already complete and tested (`resolveDisenchant` and
`resolveApplyEnchant` in `src/sim/professions/enchanting.ts`; `resolveSalvage` in
`src/sim/professions/salvage.ts`) but no player can reach them: there are no `IWorld` members, no
wire commands, and no UI. This phase wires disenchant, enchant application, AND salvage to
players in both hosts: bags context actions with a destruction confirm, server-validated
commands, and results mirrored online. It is its own slice because it is pure seam-plus-UI work
over finished sim surfaces, independent of the content phases around it. Salvage joins per the
2026-07-17 amendment: this phase builds the exact machinery it needs, so obsolete crafted gear
gets a wave-one destination instead of waiting for wave 2.

## Context pointers

- `docs/professions-2/state.md`: locked decisions, the validation matrix, and the key-surfaces row
  for salvage/disenchant/enchant (sim-complete,
  `lastSalvageResult`/`lastDisenchantResult`/`lastEnchantResult` stashes
  on `PlayerMeta`, no IWorld/wire/UI yet; salvage joins this phase per the 2026-07-17
  amendments).
- `src/sim/professions/salvage.ts`: `resolveSalvage` and its existing sim suite (do not change
  the resolution logic; this phase only makes it reachable).
- `docs/professions-2/progress.md`: phase status and the phase-start commit record.
- `docs/professions-2/implementation-plan.md`: team workflow and the review dispatch matrix.
- `src/sim/professions/enchanting.ts`: `resolveDisenchant`, `resolveApplyEnchant` (do not change
  the resolution logic; this phase only makes it reachable).
- `src/sim/sim.ts`: the `lastDisenchantResult`/`lastEnchantResult` stashes and command plumbing.
- `src/world_api/professions.ts` and `src/world_api/CLAUDE.md`: the facet file and the
  both-worlds rule.
- `src/net/online.ts`: `ClientWorld`; the `ncd`/`gprof` self-wire delta-key pattern (the fix
  template from the #2033 stub trap).
- `server/game.ts`: command dispatch and server-side re-validation.
- `src/ui/` bags context menu surface and `src/ui/CLAUDE.md`: context actions, confirm dialogs,
  toasts, i18n rules; the Phase 5 professions wheel window module for skill visibility.
- Pins: `tests/world_api_parity.test.ts`, `tests/snapshots.test.ts` (`ALL_DELTA_KEYS` +
  `TERSE_TO_IWORLD`), `tests/professions_enchanting.test.ts`.

## Starter Prompt

```
This is Phase 13 of the Professions 2.0 feature: Enchanting reachable.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: make the finished enchanting and salvage sims (disenchant, enchant application, salvage)
reachable by players in both hosts, from the bags UI through IWorld, the wire, and server
dispatch.

STEP 0 - PRE-FLIGHT:
Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
before proceeding. Never base work on main or an older release branch than the newest.
Then run git status; the tree must be clean (a concurrent session may share this
checkout); if it is dirty with work you did not create, stop and ask. Scan Claude Code memory
(the MEMORY.md index) for: the node25 gate rule (run npm run gate under Node 24), combo recipes
broken online (the #2033 ClientWorld stub trap: never land IWorld members as dead stubs; the
ncd/gprof self-wire pattern is the fix template), and the design-language program (DESIGN.md is
adopted but unlanded; UI work uses today's tokens and the shared window shell only). Record the
phase-start commit hash for the QA session.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly): spawn one Explore agent to read and
summarize: docs/professions-2/state.md, docs/professions-2/progress.md,
docs/professions-2/phase-13-enchanting.md, src/sim/professions/enchanting.ts,
src/sim/professions/salvage.ts, the
lastSalvageResult/lastDisenchantResult/lastEnchantResult stashes and command plumbing in
src/sim/sim.ts,
src/world_api/professions.ts, the cprof/ncd/gprof wiring in src/net/online.ts, the command
dispatch in server/game.ts, the bags context menu surface in src/ui/, and the CLAUDE.md files
for src/sim/, src/world_api/, src/ui/, and server/. The summary must return: the exact
signatures and result shapes of resolveDisenchant, resolveApplyEnchant, and resolveSalvage;
where the last-result
stashes live and how existing last-result reads reach IWorld; the self-wire delta-key recipe and
its pins (ALL_DELTA_KEYS + TERSE_TO_IWORLD in tests/snapshots.test.ts); how bags context actions
and confirm dialogs are built today; the state.md validation rows for net/wire, ui/render, and
i18n changes; and the review dispatch matrix.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: run the seam agent first (it fixes the member names and
wire keys), then fan out the ui agent and the tests agent in parallel against the landed seam.
Each agent gets ONLY the Explore summary plus its deliverables below, never the planning docs.

Agent seam deliverables:
- IWorld members on src/world_api/professions.ts: disenchantItem, applyEnchant, and
  salvageItem commands plus last-result reads mirroring
  lastDisenchantResult/lastEnchantResult/lastSalvageResult (typed views, not raw sim
  objects).
- Implement in BOTH Sim and ClientWorld in the same change. The ClientWorld arm must be LIVE
  (the #2033 stub trap): commands go over the wire, and results mirror back on a delta key
  following the ncd/gprof self-wire pattern.
- server/game.ts dispatch: proximity, ownership, and eligibility are re-checked server-side and
  never trusted from the client; destruction and grants resolve server-side and are replay-safe
  (a replayed or duplicated command cannot double-destroy an item or double-grant dust or
  salvage returns), for all three commands.
- Update the parity pin in tests/world_api_parity.test.ts and the ALL_DELTA_KEYS +
  TERSE_TO_IWORLD pins in tests/snapshots.test.ts in the same change.

Agent ui deliverables:
- Bags context action Disenchant, shown on eligible items only, behind a confirm dialog (this is
  destructive). A masterwork or signed instance gets an explicit stronger warning before
  destruction; the plain confirm is not enough for those.
- Apply Enchant flow: starts from the enchant consumable and flows to an eligible target item.
- Result toasts localized: every player string is an English t() key in the matching
  src/ui/i18n.catalog/ module; server-sent result text arrives as a stable id plus values and is
  re-localized by the client matcher (the S3 duty, tests/localization_fixes.test.ts).
- Enchanting skill visible in the wheel window (it levels via the existing #1712 gains; display
  only, no new leveling logic).
- Bags context action Salvage on eligible crafted gear, behind the SAME confirm-dialog
  machinery as Disenchant (destructive; masterwork and signed instances get the stronger
  warning). One confirm family serves all three actions; do not build a second dialog pattern.

Agent tests deliverables:
- Command tests for ALL THREE commands (disenchant, enchant-apply, salvage): server-side
  validation (proximity, ownership, eligibility), replay and
  duplicate safety on destruction and grants, and the offline Sim path. Keep the existing
  salvage sim suite green by name (find it beside tests/professions_enchanting.test.ts)
  and run it in STEP 3.
- Parity and wire tests: both-worlds LIVENESS for the new members (results actually arrive and
  update in ClientWorld), not just member shape.
- UI tests: context-action eligibility, the confirm path, and the signed/masterwork warning
  path; pure view logic lands DOM-free and Node-tested per the UI pure-core rules.
- Keep tests/professions_enchanting.test.ts green without weakening existing pins.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all sim randomness goes through Rng; never Math.random, Date.now, or
  performance.now in sim logic; the 20 Hz tick is untouched.
- Server authority: destruction and grants resolve server-side only and are replay-safe; the
  client never decides outcomes.
- IWorld both worlds: every new member lands on the facet file, implemented LIVE in BOTH Sim and
  ClientWorld, parity-pinned in the same change.
- i18n: English-only catalog keys; all sim/server player text is a stable id plus values,
  re-localized by the client matcher (the S3 guard).
- Prime directive: nothing existing breaks. No existing item flow (bags, trade, equip, bank)
  changes behavior unless the player invokes the new actions.

Out of scope (do NOT do in this phase):
- Batch or salvage-all UI (wave 2 polish; single-item salvage only this phase).
- Enchanting recipe or content depth.
- Tool-enchant reframing (wave 2+).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md net/wire row: npx vitest run tests/snapshots.test.ts
  tests/env_protocol.test.ts tests/bandwidth.test.ts tests/world_api_parity.test.ts.
- npx vitest run tests/professions_enchanting.test.ts plus every new command/UI test file.
- i18n row for the new keys: npm run i18n:gen, then npx vitest run
  tests/i18n_completeness.test.ts tests/localization_fixes.test.ts.
- ui/render row: npx tsc --noEmit, the mobile guard trio, and a mobile screenshot of the bags
  context action (pr-screenshots skill) committed under docs/screenshots.
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
  rows.
- Prompt every review agent for COVERAGE, not filtering: report every correctness or requirement
  gap with confidence and severity; filtering happens afterward in the main session.
- If any agent's output is truncated, re-spawn it to resume from its last completed item; never
  restart finished work.

STEP 4 - COMMIT CADENCE: commit with explicit paths (never git add -A); every commit carries a
body saying what changed and why:
- feat(professions): expose disenchant, enchant-apply, and salvage through IWorld and the wire
- feat(ui): bags disenchant, enchant-apply, and salvage actions with destruction confirm
- docs(professions-2): record phase 13 surfaces in state.md and progress.md

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A player can disenchant an eligible junk item into dust offline (Sim) and online
      (ClientWorld against the server).
- [ ] A player can apply an enchant consumable to eligible gear offline and online.
- [ ] A player can salvage eligible crafted gear into materials offline and online, behind
      the confirm (and the stronger signed/masterwork warning).
- [ ] A replayed or duplicated command cannot double-grant dust or salvage returns, or
      double-destroy an item, for any of the three commands.
- [ ] Destroying a signed or masterwork instance requires the explicit warning path.
- [ ] The new IWorld members are live in BOTH worlds; parity and snapshot pins updated in the
      same change.
- [ ] The enchanting skill shows in the wheel window.
- [ ] All validation rows above are green; the mobile screenshot is committed.

STEP 6 - DOC UPDATES + MEMORY: update docs/professions-2/progress.md (phase 13 checklist, status,
and the phase commit range so QA can diff against the phase-start commit). Update
docs/professions-2/state.md: move the current-phase pointer, and replace the planned Phase 13
line under "New surfaces per phase" with actuals (the exact IWorld member names, wire command
and delta keys, i18n key namespaces, and files created). Record genuine surprises (traps,
broken assumptions) to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT: phase status (complete or partial), files touched, validation
results (each command with pass or fail), review verdicts per agent, deferrals with reasons,
and a one-line QA handoff naming the phase-start commit.

STOPPING RULES: none special for this phase. Stop and surface to the user only if the pre-flight
tree is dirty with work you did not create, or if a locked decision in state.md would need to
change.
```

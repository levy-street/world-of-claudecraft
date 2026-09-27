# Under Cover of Shadow: local preview QA

Implemented against the current `feature/world-quests` checkout (package 0.41.0,
base c5f0329076), using an isolated worktree and a byte-for-byte starting snapshot.
Only this task's patch was applied back to `woc-world-quests`; concurrent glider
work was preserved. No staging, commit, push, or remote mutation.

## Play

Open the existing localhost:5173 preview, enter the world, and type `/dev shadow`.
Talk to Scout Valerie in Eastbrook Vale. Her Duskweave Cloak replaces the action
bar with Pick Pocket (slot 1) and Remove Cloak (slot 2). Recover four distinct
orders while avoiding the marked patrol circles. Remain still for one second
while stealing. Getting caught returns you to Valerie and keeps recovered orders.
Completion restores ordinary controls and awards the WQ reward and a deed.

## Automated evidence

- `node node_modules/vitest/vitest.mjs run tests/world_quest_shadow.test.ts tests/world_quest_shadow_wire.test.ts tests/shadow_controls.test.ts tests/shadow_detection.test.ts tests/world_quests.test.ts tests/deeds_content.test.ts tests/localization_fixes.test.ts --maxWorkers=2`: 141 passed, 3 skipped.
- Architecture, monolith-budget and shadow-controls focused run: 136 passed.
- `npx.cmd tsc --noEmit`: passed in both the isolated and integrated checkouts.
- The four shadow-specific suites above rerun in the integrated checkout: 26 passed.
- `npm.cmd run i18n:gen` and `npm.cmd run wiki:content`: passed, including after integration.
- `npm.cmd run gate`: stopped at i18n freshness because generated artifacts differ from the index. They remain unstaged as required by the user's instructions.
- Remaining canonical gate steps run from `buildFullGateSteps`: SFX/media generators, manifest trackedness, security scan, browser regression suite, typecheck, environment/server/bot builds, and client build passed.
- Manifest freshness also fails on unstaged generated content. `npm.cmd run ci:changed` finds a formatting error in the pre-existing glider callback in `src/main.ts:1993`; this task does not edit that file.
- Whole-suite Vitest was not reached by the full gate. No claim of full release readiness.
- Existing NPC look/voice catalog suites flag the two pre-existing glider NPCs; all seven new shadow NPCs have their required catalog entries.

Read-only reviews covered authority, persistence, snapshot isolation, rewards,
rendering fairness, GPU preparation/disposal, and the action HUD. The reported
vehicle CSS inheritance issue was fixed and its 48 focused CSS tests passed.

## Browser playthrough

Passed in headless Edge with the real client: obtain cloak, click Pick Pocket,
get caught by a patrol, keep the first order, retry, recover the remaining three,
and complete with an actual mobile-layout button click. Cloak/temporary bar clear
on completion. No page errors. Fixture teleports only positioned the player;
steals, detection, timing and rewards used the live simulation and UI.

The harness waits for the actual loading curtain after each teleport and for
simulation state changes (not guessed wall-clock sleeps). Mobile player-frame
occlusion was found during capture, fixed with a safe-area-aware offset, and
verified in the final playthrough. Final mobile CSS regression run: 49 passed.

- [Before](before-desktop.png)
- [Cloak](cloak-desktop.png)
- [First theft](steal-desktop.png)
- [Caught and returned](caught-desktop.png)
- [Mobile layout](cloak-mobile.png)
- [Completed](complete-desktop.png)

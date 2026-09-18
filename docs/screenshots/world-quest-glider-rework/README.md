# Windrider Slalom: glider rework QA

Implemented and integrated into the existing `feature/world-quests` preview,
package 0.41.0, base c5f0329076. Work used the isolated `feature/shadow-cape-wq`
checkout and scoped patches; existing World Quest work was preserved.
No staging, commits, pushes, or remote mutations.

## Play

Open localhost:5173 and type `/dev glider`. Speak with Flightmaster Zephyr.
The glider moves forward automatically: forward accelerates, backward brakes,
left/right steers. Height assistance follows the authored course smoothly.
Jump/swim-up and dive provide optional vertical trim. Pass the rings and land
in the marked ground zone. Skye returns you to the launch point for another run.

## Fixes

- Forward input no longer commands a dive. Walking prediction, automatic camera
  facing, swimming camera pitch, and click-to-move no longer interfere with flight.
- The course descent reaches a dry, collision-checked landing zone. The marker
  conforms to terrain and the glider follows the rendered avatar pose.
- Ground enemies no longer acquire an airborne participant. A real populated-world
  regression reproduced a moor ram acquiring the player across a 57-yard vertical
  gap, cancelling flight and causing lethal fall damage.
- Unexpected combat aborts safely without erasing combat or granting rewards.
  Normal combat actions are blocked while flying; ground behavior resumes afterward.
- Death and quest rotation clear flight safely. Completed replays retain their
  controls and tracker; rewards cannot be duplicated. Countdown is outside the timer.
- NPC appearance, voice aliases, entity names and player text have catalog coverage.

## Verification

Integrated checkout command:

```text
node node_modules/vitest/vitest.mjs run tests/glider_flight.test.ts tests/world_quest_glider.test.ts tests/glider_controls.test.ts tests/glider_course_visual.test.ts tests/world_quest_glider_view.test.ts tests/quest_tracker_controller.test.ts tests/input.test.ts tests/keyboard_turn_facing.test.ts tests/self_motion_gate.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/npc_looks.test.ts tests/npc_voice_coverage.test.ts tests/localization_fixes.test.ts tests/shadow_detection.test.ts tests/world_quest_shadow.test.ts --maxWorkers=2
```

Result: 438 passed, 3 skipped across 16 files. `npx.cmd tsc --noEmit` passed.
Regression tests were observed failing before the relevant fixes, including
the populated-world flight and death cleanup. Read-only review covered simulation,
authority, action locks, rendering lifecycle, and completed-run behavior.

`npm.cmd run gate` stops at i18n freshness because regenerated files differ from
the index and remain unstaged. The full Vitest suite is therefore not claimed
green. Remaining canonical steps are run separately through `buildFullGateSteps`;
their final results are recorded below.

- SFX/media generation and manifest trackedness passed.
- `npm.cmd run security:gate`, `npm.cmd run ci:changed`, and
  `npm.cmd run test:browser` passed.
- Canonical typecheck and environment/server/bot builds passed.
- `npm.cmd run build` passed in the integrated checkout.
- Manifest freshness also fails on unstaged generated artifacts.

Verdict: READY WITH NOTES for local preview; the unstaged freshness checks prevent
claiming a green merge gate.

## Browser evidence

`node tmp/glider-browser.mjs` passed using the real client in Edge. The harness
talked to Zephyr and steered with actual W/A/D keyboard events through all six
rings, landing with full health and a gold result in 9.7 simulation seconds.
After launch it did not teleport, edit position, or grant ring credit. No page
errors occurred. Desktop and mobile result layouts were captured and inspected.
Online behavior shares the tested simulation and client prediction gates, but
this manual playthrough was offline.

- [Ready](ready-desktop.png)
- [In flight](flight-desktop.png)
- [Landed](landed-desktop.png)
- [Mobile result](landed-mobile.png)

# Longer glider and harder pickpocket World Quests

Applied scoped changes from `feature/shadow-cape-wq` to the existing
`feature/world-quests` preview, localhost:5173. No staging, commit or push.

## Behavior

`/dev glider`: a 1,321-yard coastal circuit with 20 rings, progressively narrowing
from 8 to 4 yards in radius. Completion requires 18 rings. All 20 within 52 seconds
earn gold; at least 18 within 68 seconds earn silver. Timeout is 110 seconds.
The same launch and dry landing site are retained. The landing target is now a
thin elevated perimeter with a small hovering beacon, replacing the opaque disc.
Its geometry follows the terrain and keeps normal depth testing.

`/dev shadow`: stealing requires a position within the carrier's rear 120-degree
arc throughout the one-second channel. The action bar explains frontal rejection.
Lantern patrols cross the camp and pause three seconds at both ends. Every carrier
has repeated safe openings of at least three seconds, and Valerie's retreat area
stays outside detection. Getting caught retains collected documents.

## Automated checks

Integrated checkout:

```text
node node_modules/vitest/vitest.mjs run tests/glider_flight.test.ts tests/world_quest_glider.test.ts tests/glider_controls.test.ts tests/glider_course_visual.test.ts tests/world_quest_glider_view.test.ts tests/quest_tracker_controller.test.ts tests/input.test.ts tests/keyboard_turn_facing.test.ts tests/self_motion_gate.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/localization_fixes.test.ts tests/shadow_detection.test.ts tests/world_quest_shadow.test.ts tests/world_quest_shadow_patrol.test.ts tests/shadow_controls.test.ts tests/world_quest_shadow_wire.test.ts --maxWorkers=2
npx.cmd tsc --noEmit
npm.cmd run i18n:gen
```

Tests: 440 passed, 3 skipped across 17 files. TypeScript and i18n generation passed.
Tests cover populated-world flight, ordinary behavior after landing, medal timing,
rear-position authority and channel cancellation, patrol windows, and rendering
geometry/lifecycle. Read-only review found the lowest sampled ring-mesh terrain
clearance is 2.60 yards; server and UI use the same rear-position predicate.

`npm.cmd run gate` stops at i18n freshness because generated artifacts remain
unstaged. Remaining canonical checks are run separately without changing the index.
Full-suite Vitest and a green merge gate are not claimed.

Remaining canonical steps: SFX/media generation, manifest trackedness,
`npm.cmd run security:gate`, `npm.cmd run ci:changed`, `npm.cmd run test:browser`,
typecheck and environment/server/bot builds passed. `npm.cmd run build` passed.
Manifest freshness also fails because generated artifacts remain unstaged.
Verdict: READY WITH NOTES for the local preview.

## Browser evidence

The actual client completed all 20 rings using W/A/D keyboard events, without
position or credit edits after launch: gold in 47.5 seconds, full health at landing.
Desktop and mobile landing captures were inspected. Shadow browser fixtures only
position the player; theft, detection, retry, timing and rewards use the live game.
The harder shadow run recovered all four orders, got caught after the first,
retained it on retry, and completed through an actual mobile action-bar click.
The cloak and temporary bar cleared on completion. No page errors were recorded.
Manual playthroughs were offline; the authoritative shared simulation and wire
regressions cover the multiplayer code path.

- [Previous landing disc](before-landing-mobile.png)
- [Long course in flight](flight-desktop.png)
- [New landing marker](landed-desktop.png)
- [Mobile landing](landed-mobile.png)
- [Rear theft](../world-quest-shadow-harder/behind-desktop.png)
- [Caught with the first order retained](../world-quest-shadow-harder/caught-kept-order.png)
- [Mobile completion](../world-quest-shadow-harder/completed-mobile.png)

## Commit preparation

The scoped index excludes pending investigation visibility, older NPC appearance
and voice work. An exported copy of the exact staged source passed
`npx.cmd tsc --noEmit` and the seven glider/shadow-specific suites (55 tests).
This checks the committed feature independently of those remaining local edits.

The full gate reached the general suite after staging resolved freshness checks.
It reported platform/baseline failures (including unavailable grep/sh, Windows
symlink restrictions and historical path expectations) and was stopped after
triage; no full-suite pass is claimed. WQ issues discovered there were fixed:
nonempty guard greetings, interpolation fixtures, constructor-free action locks,
and explicit deed counters and pending crest entries.

Final focused verification: 389 passed, 4 skipped across 15 suites, including
localization coverage, the affected HUD paths, both WQs and deed obligations.
The exact staged source passed TypeScript again. Remaining canonical steps
passed generation/freshness, security, changed-file Biome, typechecks and all
builds. Browser regressions had 326 passes and one click timeout under parallel
load; that complete 11-test browser file passed on an isolated rerun.

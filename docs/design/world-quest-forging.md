# A Helping Hammer

Smith Mara's workshop at The Last Keep in Drakelands is a personal reaction minigame. Talk to Mara,
then click the requested world supply without carrying an item or returning to
the NPC. Four existing prop models distinguish firewood, an ingot crate, a water
well, and an anvil. Supplies remain at least five yards apart and within the
22-yard interaction reach. The existing grey Last Keep smithy supplies both
the furnace and its built-in anvil. No second furnace or anvil is drawn.

The anvil entity uses a CPU-only rotation-invariant raycast sphere over the authored anvil geometry,
through the existing quest-object body/picking seam. It remains a server-validated
station and carries the normal quest sparkle. The crate sits to the right of the
smithy, firewood stays in place, and the well is within eight yards of Mara.
Only two sacks remain as additional passive dressing.

## Play

- A three-second countdown precedes ten requests. The first seven request one
  supply; the last three request two different supplies in order.
- Transitions shorten from two seconds to one and a half, then one second.
  Clicking during a transition does nothing. A wrong supply adds three seconds
  and briefly locks input; it does not reset the round.
- Gold requires an adjusted time of at most 40 seconds, silver at most 60,
  and bronze covers slower finishes. Every medal completes the WQ.
- Talk again to practice. The best adjusted result persists. Practice never
  repeats the WQ reward, including after save/load.
- Combat, death, leaving the workshop, or a rotation change cancels a live run.

## Implementation

`content/world_quest_forging.ts` owns coordinates and identities. The pure
`minigames/forge_workshop.ts` state machine uses an isolated seeded RNG stream;
`world_quest_forging.ts` validates NPC/object identity and player eligibility
behind the existing talk and pickup commands. Canonical world-quest credit
owns XP and the cosmetic `exp_forge_helper` deed.

The live session is personal, carried by the existing owner quest snapshot,
and omitted from saves. Only the best result and durable completion claim
survive reconnect. `world_quest_forge_wire.ts` bounds and validates the readout.
The session publishes its authoritative observation time at five Hz and on
readiness changes. The UI never assumes a browser or global world clock.
Mara speaks the current request through the existing owner-only NPC speech
bubble. Required speech persists until the authoritative step changes, with a
small upward offset to clear the anvil. The tracker holds progress and mistakes;
medal thresholds and the adjusted finish time appear only after completion.
Speech never intercepts clicks or depends on graphics settings.

The forging quest replaces Evergarden Watch only in the existing calligraphy
roster (`wq3_6`); other rosters and the cycle modulus remain unchanged. This
can retire an unfinished Watch entry in that roster during a mixed deployment.

The smithy is at (371, 2021), with wood at (379, 2019), built-in anvil
at (374.14, 2020.92), ingots at (376, 2014), and well at (385, 2026).
The main gate lane stays open. The original quest ID is retained so existing
completion claims and medals survive relocation.

## Local preview

Use the `feature/world-quests` worktree and `npm run dev`, open the offline game,
then enter `/dev forge`. This arms the relevant offering, raises an under-level
preview character to the minimum level, and teleports near Mara at 379, 2028.
It preserves existing completion claims. Talk to Mara to start or retry.

## Verification

Focused tests live in `forge_workshop.test.ts`, `world_quest_forging.test.ts`,
`forge_workshop_input.test.ts`, `forge_workshop_placement.test.ts`,
`world_quest_forge_view.test.ts`, `forge_speech.test.ts`, and
`quest_tracker_controller.test.ts`. Existing WQ, tracing, snapshot, deed,
architecture, localization, and parity guards cover the shared seams.

The final combined Vitest invocation across those fourteen focused suites passed
677 tests with three existing skips. The mobile CSS follow-up passed its thirty
CSS validity and transform checks. `npx tsc --noEmit`, `npm run ci:changed`,
`npm run security:gate`, `npm run build:server`, and `npm run build:bundle` passed.

Real Edge browser checks completed all thirteen world clicks at both desktop
and 960 by 540 with touch HUD layout, without moving the character or page errors.
Both automated runs earned gold (21.2 and 20.45 simulation seconds); these are
automation timings, not a human difficulty calibration. The small viewport check
used mouse clicks with the touch HUD and does not substitute for a physical phone.
The browser retry also starts from the completed entry without resetting its claim.

Screenshots: [desktop request](../screenshots/world-quest-forging/request-desktop.png),
[desktop result](../screenshots/world-quest-forging/result-desktop.png),
[small viewport request](../screenshots/world-quest-forging/request-small.png),
[small viewport result](../screenshots/world-quest-forging/result-small.png).

`npm run gate` currently stops at i18n freshness: generated English fallback
artifacts differ from the Git index in this uncommitted preview. No files were
staged to bypass that check. Maintainer locale fills and a clean complete gate
remain necessary before release.

### Smithy dressing preview

The placement, interaction and authoritative workshop suites passed fifteen tests
after moving the anvil, well and instructor. The garden, renderer compile gate
and placement suites passed forty-nine tests. `npx tsc --noEmit`,
`npm run ci:changed`, `npm run build:bundle`, and `git diff --check` passed.
`npm run gate` reached the same i18n freshness stop described above.

The dressed workshop completed all thirteen real browser clicks without moving
the character, earning gold with zero mistakes. A completed run could be restarted
after resizing to the touch HUD layout. The review checked passive scenery
preload, all-tier rendering and shared collider placement; the furnace also joins
the low-tier material prewarm catalog. No new assets, lights or interaction targets
were introduced.

Before: [open clearing](../screenshots/world-quest-forging/workshop-desktop.png).
After: [smithy](../screenshots/world-quest-forging/decor-workshop-desktop.png),
[active request](../screenshots/world-quest-forging/decor-request-desktop.png),
[completion](../screenshots/world-quest-forging/decor-result-desktop.png),
[touch layout](../screenshots/world-quest-forging/decor-workshop-mobile.png).

### Last Keep relocation

Placement, interaction, simulation and deed tests passed (54 tests across four
suites). TypeScript, changed-file checks, locale/wiki generation, client build
and diff whitespace checks passed. The full gate still stops at the same i18n
freshness comparison against the index described above.

The gate passage was sampled every quarter yard with player radius 0.7; all
positions remain walkable. The furnace corners and edge midpoints are flat at
height 6. A real desktop browser run completed thirteen clicks without movement,
with zero mistakes and gold in 21.8 simulation seconds. A retry was inspected
with the compact 960 by 540 HUD.

Current preview: [Last Keep workshop](../screenshots/world-quest-forging/last-keep-workshop-desktop.png),
[completed round](../screenshots/world-quest-forging/last-keep-result-desktop.png),
[compact HUD](../screenshots/world-quest-forging/last-keep-workshop-mobile.png).

### Existing grey smithy integration

Removed the added black furnace and its asset registration. The built-in anvil
is clickable through `render/forge_anvil_target.ts` without extra geometry.
Its sphere stays stable under pooled object yaw. Direct builder tests cover
entity tagging, near/far limits, misses, and all seven pooled yaw values.

`npx vitest run tests/forge_anvil_target.test.ts tests/forge_workshop_placement.test.ts tests/world_quest_forging.test.ts tests/forge_workshop_input.test.ts --maxWorkers=2`
passed 18 tests; the subsequent production-dispatch and near-clip checks passed
both anvil tests. Architecture and renderer compile guards also passed.
`npx tsc --noEmit`, `npm run ci:changed`, `npm run wiki:content`,
`npm run build:bundle`, and `git diff --check` passed. `npm run gate` remains
blocked at the existing index-based i18n freshness check.

A real desktop browser round completed all thirteen clicks, including the
built-in anvil, with zero mistakes and gold in 21.35 simulation seconds.
The compact HUD retry was visually inspected.

Current layout: [grey smithy](../screenshots/world-quest-forging/grey-smithy-workshop-desktop.png),
[completed round](../screenshots/world-quest-forging/grey-smithy-result-desktop.png),
[compact HUD](../screenshots/world-quest-forging/grey-smithy-workshop-mobile.png).

### Mara speech presentation

Removed the former top-center request card and its CSS. `render/forge_speech.ts`
projects the owner's session into the existing safe-text chat bubbles, with
persistent required speech, short completion thanks, and cancellation cleanup.
The tracker retains request/step progress and wrong-click feedback. Results show
the adjusted time, medal, mistakes, gold threshold and silver threshold.

Speech/view/tracker, architecture, monolith, HUD performance, localization and
CSS validity suites passed after fixing line-ending formatting. The final speech,
view, tracker, monolith and chat-style invocation passed 46 tests.
`npx tsc --noEmit`, `npm run ci:changed`, and `npm run build:bundle` passed.
`npm run gate` stopped at the same index-based i18n freshness check noted above.

A desktop browser round completed all thirteen clicks with zero errors and gold.
Both desktop and compact landscape show speech anchored above Mara and tracker
progress without live medal thresholds. Portrait reaches the game's existing
rotate-to-landscape screen. This browser uses mouse input, not a physical phone.

Current presentation: [Mara request](../screenshots/world-quest-forging/mara-speech-request-desktop.png),
[result](../screenshots/world-quest-forging/mara-speech-result-desktop.png),
[compact layout](../screenshots/world-quest-forging/mara-speech-workshop-mobile.png).

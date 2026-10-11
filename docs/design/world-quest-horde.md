# The Last Barricade

A personal World Quest at the Wyrmroad forest edge in Wraithwood. Talk to Captain
Rowan to defend a woodland pass using an automatic crossbow repeater. Ordinary
lateral movement controls aiming; stepping backward cancels the attempt.

The Mournstone approach was rejected after a real-browser capture showed that
the authored giant tree canopy obscured the overhead camera despite clear ground
collision. `HORDE_SITE` in `src/sim/content/world_quest_horde.ts` places the final
lane beyond those crowns. Named scatter exclusions clear its edges without
removing landmark trees or changing terrain. Private actors and the barricade
have no shared collision, so nearby players can still pass through.

## Play

- Three-second countdown followed by a ninety-second defense.
- A/D, arrow keys, strafing or horizontal joystick input move the repeater.
- Shoot one of two supply crates to choose an upgrade; its sibling disappears.
  Eleven offers grant +1 shot, +25% fire rate, piercing or explosive ammo, and
  mid-round x2 shots. The repeater caps at eight projectiles and three speed ranks.
- The repeater starts at five volleys per second and reaches 8.75. Waves ramp
  from four to twenty enemies per second, with fragile runners, brutes and a
  final commander accompanied by reinforcements.
- Win by killing the commander and keeping the barricade standing until time ends.
- Score is ten points per kill plus five per remaining barricade percentage point.
  Gold requires 12,000 points and 98% barricade; silver requires 2,000 and 35%.
  Other successful defenses earn bronze. Failure never completes the quest.
- Completion pays the existing 12% level-XP reward and a cosmetic exploration deed.
  Practice can improve the saved best score but never pays the reward again in the
  same rotation, including after reload.

The quest occupies the Wraithwood slot of rotation `wq3_7`; rotation cadence and
the other Wraithwood offerings are preserved. `/dev horde` (alias `/dev barricade`)
stages the quest and teleports to Rowan in development builds.

Normal action bars and mobile combat buttons hide during play. Ability, item,
mount and pet commands are blocked in the simulation, including practice rounds.
An explicit Leave defense button uses ordinary exit intent. Crate labels,
upgrade sounds, firing sounds and batched kill announcements reinforce progress.

## Implementation and bounds

`src/sim/minigames/horde_barricade.ts` owns deterministic combat with isolated
seeded randomness. `src/sim/world_quest_horde.ts` consumes ordinary movement intent
through the existing exclusive movement seam on every host. Dead, mounted,
combat, teleport, departure and rotation paths terminate the personal run.

Only the owner's existing quest snapshot carries the live session. Normal session
updates request a refresh every four simulation ticks; other heavy-field refreshes
may send it earlier. Arrays are capped at 96 units and 96 shots, validated and
deep-copied on decode. Saves strip those arrays and retain only one bounded best
result through the existing character JSON path. No SQL schema or query changes.

Rendering reuses shipped undead geometry through fixed instancing pools and a
prepared crossbow asset. Every actionable object is present at all graphics tiers.
The existing camera composer fits the lane and restores the saved orbit on exit.
Online input retains held turn keys as lateral intent and suspends ordinary
walking prediction during the encounter. It never predicts combat outcomes.

## Verification

Horde-specific suites cover core timing and upgrades, literal actor budgets, owner
isolation, actual Sim completion, reward protection across reload, rotation and
AFK behavior, strict wire decoding, UI projection, rendering, camera and site
clearance. See `tests/horde_*.test.ts` and `tests/world_quest_horde*.test.ts`.

The broader scoped Vitest run passed 912 tests; architecture/localization guards
passed 176 with three existing skips. Browser regression passed 327 tests.
`npx.cmd tsc --noEmit`, `npm.cmd run ci:changed`, and
`node scripts/malware_scan.mjs --gate` passed during integration, as did
`npm.cmd run build:env`, `npm.cmd run build:server`, `npm.cmd run build:bot`,
and `npm.cmd run build`.

`npm.cmd run gate` stops at i18n freshness because regenerated translations differ
from the Git index. Generated files are present, but this local task does not
authorize staging. This is not a completed full-gate pass.
The guide freshness test has the same Git-index limitation; its other checks pass.

Real-input browser evidence lives in `docs/screenshots/world-quest-horde/`.
The first gameplay run won with 481 kills and an intact barricade; those initial
captures exposed the canopy problem and are replaced by the final-site captures.
The relocated encounter also cleared through actual A/D input with 480 kills and
100% barricade, and emulated right-joystick input moved the player four yards in
the expected direction. A final camera offset keeps the repeater above the normal
player frame; camera tests pin both HUD clearance and full-field visibility.
Touch emulation checks joystick routing; physical-device and live-server latency
testing remain outside this local preview.

The final camera capture completed another real-input winning round without page
errors. Desktop and touch-landscape captures show the entire lane and firing
position clear of HUD panels. Final typecheck, changed-file lint and client bundle
build passed; the new horde files also passed a separate untracked-file Biome check.

QA verdict: NOT READY for merge until the generated-file freshness gates can be
completed. The local playable preview and its functional/visual checks are ready.

The upgrade revision has 26 core and 13 wire/integration tests passing, including
crate choice exclusivity, boss retention under actor-pool saturation, repeat rewards
and strict decoding. Five deterministic strong-play runs reached 1,154 to 1,162
kills; a slower decision policy earned four silvers and one gold, while idle play
failed. These are tuning probes, not a substitute for player feedback.

Final upgrade revision verification (2026-09-06):

- `node node_modules/vitest/vitest.mjs run tests/horde_*.test.ts tests/world_quest_horde*.test.ts --maxWorkers=2` (expanded filenames): 69 tests passed in 10 files.
- `npm.cmd run test:browser`: 327 tests passed in 37 files.
- `npm.cmd run ci:changed`: passed; existing warnings remain.
- `node scripts/malware_scan.mjs --gate`: passed, zero high findings after priors.
- `npx.cmd tsc --noEmit`: passed, including after the final label adjustment.
- `npm.cmd run build`, `build:env`, `build:server`, and `build:bot`: passed.
- Final label adjustment: its controller test, scoped Biome, and `node node_modules/vite/bin/vite.js build` passed.
- `npm.cmd run gate`: still stops at generated i18n Git-index freshness, as described above; the full gate has not passed.

Actual A/D browser play earned gold with 1,159 kills, 100% barricade and 12,090
points. Keyboard ability shortcuts did not cancel the run; the action bar was
hidden during play and restored afterward. Emulated right-joystick input moved
4.4 yards in the expected direction, and clicking Leave defense restored normal
controls. The final mobile capture verified a 69px gap between crate labels.
No page errors occurred. Captures are in
`docs/screenshots/world-quest-horde/upgrades/`. The desktop gameplay captures
precede the final outward label alignment; the mobile capture includes it.

Read-only review found a boss-retention defect under saturated crate admission;
that defect is fixed and covered by three regression cases. The final UI/exit
review found no further blocking issue. Local preview is playable; merge readiness
remains NOT READY until the full freshness gate can pass.

## Terminal scene cleanup and heavy-enemy tuning

The renderer previously drew every retained horde state, including won/failed
states preserved for results. This left the last projectiles, enemies and lane
geometry frozen in the normal world. `HordeBarricadeVisual.sync` now shows only
countdown/active states and resets instance counts and impact history on terminal
states. Results remain untouched. Won/failed regressions failed before the fix and
now pass, including same-tick replay without stale hit effects.

Brute health increases from 20 to 120 and commander health from 220 to 1,800.
Ordinary undead retain their previous health and cadence. Spawned heavy-enemy tests
verify survival through an upgraded volley; deterministic and actual Sim clears
remain possible with the existing timer and medal requirements.

Validation: focused render/camera/controller/result tests passed 18 tests; core,
world integration, wire and architecture suites passed 153 tests. Scoped Biome,
`npm.cmd run ci:changed`, `npx.cmd tsc --noEmit`, `npm.cmd run check:ts`,
`npm.cmd run build`, `npm.cmd run build:server`, `npm.cmd run build:env`,
`node scripts/malware_scan.mjs --gate` and `git diff --check` passed.
`npm.cmd run gate` still stops at the existing generated-i18n Git-index freshness
check. Full gate status remains NOT READY for merge.

Actual browser play with the new health pools won with 1,148 kills, 100% barricade
and silver. Browser assertions verified the scene hidden after victory and after
an induced barricade failure on mobile, with normal controls restored. No page
errors occurred. Before/after captures: `docs/screenshots/world-quest-horde/exit-fix/`.
Read-only cleanup and tuning review found no further concrete defect.

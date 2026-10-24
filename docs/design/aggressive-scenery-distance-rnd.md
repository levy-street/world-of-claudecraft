# Aggressive Low scenery distance experiment

14 October 2026. Local R&D on `feature/cel-shading-rnd`, based on `f4a45631064`.
No game defaults changed, no push, merge or deployment.

## Decision

Aggressive scenery cuts deliver large repeatable gains. At 60 yards, Redmi Thornpeak rises from 22.36 to 44.36 FPS and from 22.17 to 44.24 FPS in reverse order; Palmreach rises from 19.13 to 32.53 and from 19.24 to 32.22 FPS. Mac Low gains repeat too: Thornpeak 131.10 to 174.25 and 115.73 to 148.00 FPS; Palmreach 98.08 to 119.52 and 114.42 to 136.19 FPS. All are clearly above the roughly 10 percent comparison-noise threshold. The less aggressive 120-yard option reaches about 38 FPS at Thornpeak and 28-29 FPS in Palmreach on Redmi. Scenery-off reaches about 53 and 57-59 FPS respectively, but deliberately removes nearby scenery. Use the 60-yard prototype as the performance anchor for the next visual-quality experiment; this is evidence for the direction, not a shipping preset or proof of 60 FPS.


My visual call: the aggressive direction is worth pursuing, but this hard cutoff is not ready to ship. Nearby paths, trees, rocks, palms and characters remain readable in the matched views, while Thornpeak loses the expensive Evergarden canopy and Palmreach opens up substantially. The 60-yard version exposes bare terrain and loses environmental depth; during the Palmreach approach, whole giant canopies return abruptly as their footprint enters range. Phone warm routes preserved audited nearby instances and moved roughly 41-42 yards, but they do not establish whole-world gameplay fairness or cold-entry hitch parity. Keep the aggressive mesh budget as the next baseline, then improve the boundary treatment and ground presentation with measured cost. Do not restore full-detail distant landmarks by default. The 120-yard variant is a useful visual tradeoff to compare, not evidence that 60 FPS has been reached.


## Scope and controls

Reuben rejected the first conservative experiment because it exempted the giant
Evergarden trees visible from Thornpeak. That incomplete comparison is retained
under `tmp/distance-conservative`, and is not used to decide the aggressive cuts.
The accepted experiment includes those landmarks.

The baseline is the current Low research build: three-band cel, coconut instance
cells of 128 yards, FXAA off, governor off, fixed noon and camera. The same minified
build from the prior integration is used in every arm; all recorded production
source hashes still match. Redmi uses shader-corpus recording off, Mac uses auto,
consistently within each device. No rebuild or texture/material change between arms.

The local controller is never imported by the game. It caps the shared scenery
horizon used by props, Eastbrook/Fenbridge towns and foliage; caps the registered
zone-feature sweep; hides complete static non-instanced feature subtrees, including
giant trees; and packs static jungle instances while preserving whole multipart
placement bounds. Matrices, colors and counts restore from saved originals.
Dynamic/skinned subtrees keep their existing ownership. Terrain, actors, combat
VFX, atmosphere, lights, materials and gameplay state are untouched.

120, 80 and 60 are scenery distance inputs in yards, not camera far planes or a
strict radius for every vertex. Full object footprints have a four-yard margin.
A surviving batch that spans nearby and distant scenery can retain far instances.
Foliage model quality is fixed at 1, so its existing fog-limit multiplier is 1.

The separate scenery-off diagnostic hides the props and foliage draw roots only
during the main-scene render, restoring their flags in `finally`. It intentionally
removes nearby obstacle/gathering visuals, so it is not a playable preset or a
fairness candidate. Scenery CPU updates and preparation still run; this is a draw
suppression reference, not a total-removal performance ceiling.

## Method

- Redmi 12 5G, Adreno 613: 899 by 394 render buffer, scale 0.68. One warmed page,
  current/120/80/60/off, then off/60/80/120/current. Two 20-second windows per arm
  and scene. USB stay-on, browser wake lock and the owning process remain active.
- M4 Pro Mac: 1600 by 900, two simultaneous uncapped ANGLE Metal browser targets.
  Current versus candidate; reversed browser launch order and candidate order.
  Two 20-second windows per pair and scene. Uptime recorded before each run.
- Actual submitted frames, not rAF alone. Preparation queues must be idle, program
  and preparation counts stable, buffer and quality unchanged, page visible, and
  skipped callbacks below one percent. Compare within a row only; Mac absolute
  rates vary with shared-machine load.
- Thornpeak: player (30, 700), yaw 0.5, pitch 0.3, zoom 8. Palmreach beach:
  (-352, 806), yaw 0, pitch 0.5, zoom 8. Matched wider views use pitch 0.18, zoom 16.
- Warm forward/retreat/orbit routes are separate from FPS windows. They do not
  resolve the prior integration's unmatched cold first-use hitch evidence.

## FPS

Each cell aggregates two 20-second windows by total frames divided by total time.

| Device | Scene | Order | Cutoff | Current Low FPS | Candidate FPS | Gain |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Redmi | thornpeak | forward | 120 yd | 22.36 | 37.59 | +68.1% |
| Redmi | thornpeak | forward | 80 yd | 22.36 | 38.99 | +74.3% |
| Redmi | thornpeak | forward | 60 yd | 22.36 | 44.36 | +98.4% |
| Redmi | thornpeak | forward | Off, diagnostic | 22.36 | 52.91 | +136.6% |
| Redmi | beach | forward | 120 yd | 19.13 | 28.73 | +50.2% |
| Redmi | beach | forward | 80 yd | 19.13 | 29.94 | +56.5% |
| Redmi | beach | forward | 60 yd | 19.13 | 32.53 | +70.0% |
| Redmi | beach | forward | Off, diagnostic | 19.13 | 59.16 | +209.2% |
| Redmi | thornpeak | reverse | Off, diagnostic | 22.17 | 52.98 | +139.0% |
| Redmi | thornpeak | reverse | 60 yd | 22.17 | 44.24 | +99.5% |
| Redmi | thornpeak | reverse | 80 yd | 22.17 | 38.74 | +74.7% |
| Redmi | thornpeak | reverse | 120 yd | 22.17 | 38.53 | +73.8% |
| Redmi | beach | reverse | Off, diagnostic | 19.24 | 56.81 | +195.4% |
| Redmi | beach | reverse | 60 yd | 19.24 | 32.22 | +67.5% |
| Redmi | beach | reverse | 80 yd | 19.24 | 30.47 | +58.4% |
| Redmi | beach | reverse | 120 yd | 19.24 | 28.40 | +47.6% |
| Mac | thornpeak | forward | 120 yd | 166.24 | 212.10 | +27.6% |
| Mac | thornpeak | forward | 80 yd | 120.97 | 157.93 | +30.6% |
| Mac | thornpeak | forward | 60 yd | 131.10 | 174.25 | +32.9% |
| Mac | thornpeak | forward | Off, diagnostic | 111.12 | 163.17 | +46.8% |
| Mac | beach | forward | 120 yd | 141.67 | 170.57 | +20.4% |
| Mac | beach | forward | 80 yd | 121.67 | 146.10 | +20.1% |
| Mac | beach | forward | 60 yd | 98.08 | 119.52 | +21.9% |
| Mac | beach | forward | Off, diagnostic | 106.53 | 145.52 | +36.6% |
| Mac | thornpeak | reverse | Off, diagnostic | 132.68 | 193.51 | +45.9% |
| Mac | thornpeak | reverse | 60 yd | 115.73 | 148.00 | +27.9% |
| Mac | thornpeak | reverse | 80 yd | 99.20 | 124.85 | +25.9% |
| Mac | thornpeak | reverse | 120 yd | 135.40 | 169.02 | +24.8% |
| Mac | beach | reverse | Off, diagnostic | 143.33 | 188.22 | +31.3% |
| Mac | beach | reverse | 60 yd | 114.42 | 136.19 | +19.0% |
| Mac | beach | reverse | 80 yd | 139.49 | 165.67 | +18.8% |
| Mac | beach | reverse | 120 yd | 152.57 | 178.20 | +16.8% |

## Matched wide views

### Phone, thornpeak

[Current Low](../screenshots/aggressive-scenery-distance-rnd/phone-thornpeak-wide-0.webp) | [120 yards](../screenshots/aggressive-scenery-distance-rnd/phone-thornpeak-wide-120.webp) | [80 yards](../screenshots/aggressive-scenery-distance-rnd/phone-thornpeak-wide-80.webp) | [60 yards](../screenshots/aggressive-scenery-distance-rnd/phone-thornpeak-wide-60.webp) | [Scenery off, diagnostic](../screenshots/aggressive-scenery-distance-rnd/phone-thornpeak-wide-off.webp)

### Phone, beach

[Current Low](../screenshots/aggressive-scenery-distance-rnd/phone-beach-wide-0.webp) | [120 yards](../screenshots/aggressive-scenery-distance-rnd/phone-beach-wide-120.webp) | [80 yards](../screenshots/aggressive-scenery-distance-rnd/phone-beach-wide-80.webp) | [60 yards](../screenshots/aggressive-scenery-distance-rnd/phone-beach-wide-60.webp) | [Scenery off, diagnostic](../screenshots/aggressive-scenery-distance-rnd/phone-beach-wide-off.webp)

### Mac, thornpeak

[Current Low](../screenshots/aggressive-scenery-distance-rnd/mac-thornpeak-wide-0.webp) | [120 yards](../screenshots/aggressive-scenery-distance-rnd/mac-thornpeak-wide-120.webp) | [80 yards](../screenshots/aggressive-scenery-distance-rnd/mac-thornpeak-wide-80.webp) | [60 yards](../screenshots/aggressive-scenery-distance-rnd/mac-thornpeak-wide-60.webp) | [Scenery off, diagnostic](../screenshots/aggressive-scenery-distance-rnd/mac-thornpeak-wide-off.webp)

### Mac, beach

[Current Low](../screenshots/aggressive-scenery-distance-rnd/mac-beach-wide-0.webp) | [120 yards](../screenshots/aggressive-scenery-distance-rnd/mac-beach-wide-120.webp) | [80 yards](../screenshots/aggressive-scenery-distance-rnd/mac-beach-wide-80.webp) | [60 yards](../screenshots/aggressive-scenery-distance-rnd/mac-beach-wide-60.webp) | [Scenery off, diagnostic](../screenshots/aggressive-scenery-distance-rnd/mac-beach-wide-off.webp)

## Verification and limits

- `npx vitest run tests/scenery_distance_experiment.test.ts`: 7 tests passed.
- `npx tsc --noEmit`: passed.
- `npx @biomejs/biome check scripts/lib/scenery_distance_experiment.mjs scripts/lib/scenery_distance_experiment.d.mts tests/scenery_distance_experiment.test.ts`: passed.
- `python3 tmp/distance-study/accept.py`: all 104 timing windows passed fixed-quality/buffer, preparation, camera/fog and nearby-placement checks. Fog/camera comparison tolerance is 0.00001, covering floating-point easing residue.
- Both devices produced 40 matched stills and 16 actual movement routes in total, with 8 phone videos. Phone routes moved 41-42 yards; Mac Thornpeak routes moved about 17 yards and Mac Palmreach routes about 42 yards. Routes are qualitative visual evidence, not timing/hitch measurements.
- Bounded independent source review found no remaining rendering ownership/restoration defect. A stale diagnostic suppression counter was corrected after timing; preserved `controller-used.mjs` and hashes prove this is the only post-timing controller change. It resets metadata when scenery-off is disabled, outside the timed rendering path. The regression passes in tests and on the live Redmi; all original hooks were restored and the controller removed afterward.
- `node scripts/gate_select.mjs`: manifest freshness and malware stages passed, then the branch-wide Biome stage failed on two issues already present in HEAD: formatting in `src/sim/content/pvp_honor.ts` and `useIterableCallbackReturn` in `tests/static_instance_cells.test.ts:46`. Later broad test/browser/build stages were not reached. No unrelated cleanup or merge-ready claim.
- The unchanged minified game build was reused after checking its production source hashes. No production rendering source or dependency changed in this task, so it was not rebuilt merely for the injected research controller.


No Windows PC, iPhone, live multiplayer, raid, whole-world or universal PvP
fairness claim. Sampled near-field scenery was checked, but gameplay visibility
needs broader acceptance before shipping a preset. The source and tests restore
original transforms/colors/counts, static visibility and method hooks. No new
materials, programs or scene objects are introduced by the experiment.

Local interactive report with all camera views and phone videos:
`tmp/distance-study/report.html`. Raw samples, accepted/excluded blocks, source
provenance and route audits are in that ignored directory; they are not available
in a fresh clone. This record, the research controller/tests and matched wide
stills are committed. Do not rerun the conservative experiment as if its landmark
exemption answered Reuben's aggressive-distance question.

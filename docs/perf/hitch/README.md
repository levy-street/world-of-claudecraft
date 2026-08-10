# Hitch referee

This directory owns the frozen frame-consistency referee for World of ClaudeCraft.
It measures discrete rendering stalls, GC stutter, allocation pressure, and retained
heap growth. Average FPS is intentionally absent. The graphics-preset throughput
benchmark in `scripts/perf_baseline.mjs` owns average FPS.

## Contract

The referee always uses a headed Google Chrome window with a real GPU, a fixed
1280x720 viewport, an armed adaptive render governor, and a visible window. Every
scenario gets a fresh temporary Chrome profile. Chrome receives
`--disable-gpu-shader-disk-cache`, which Chromium uses to disable its GPU shader disk
cache and GL program disk cache. A fresh profile is removed after its browser closes.

Every raw scenario records the complete requestAnimationFrame series under
`tmp/perf-hitch/`. The compact history in `history.jsonl` keeps these post-warmup
summaries:

- frames at or above 50 ms
- worst frame and p99 frame time
- newly linked WebGL program cache keys
- the warmup-baseline program cache key count (programs linked during boot and warmup)
- textures and pooled visuals created
- the render-budget submit-stall latch
- allocation rate from the existing heap sawtooth tracker
- settled JS heap delta derived from forced-GC boundary readings
- GC-floor growth fitted from the same tracker's complete valley series as a diagnostic
- page errors captured during browser entry and measurement

Incomplete frames that overlap the warmup boundary are excluded. A missing value,
software renderer, context loss, hidden window, stale browser profile, wrong graphics
tier, disabled governor, scenario drift, viewport drift, exact GPU renderer drift,
browser-version drift, complete launch-argument drift, or machine drift invalidates a
gate comparison.

At each boundary the referee sends `HeapProfiler.collectGarbage` twice through the page's
Chrome DevTools Protocol session. It waits 100 ms after each collection to let deferred
finalization settle, then reads `Runtime.getHeapUsage.usedSize`. The warmup collections
finish before `markWarmup()` starts the measured frame window. At the other boundary,
`stop()` freezes the last measured frame before either ending collection runs. Forced-GC
pauses therefore never enter the measured frame series.

The client still exposes GC-floor valleys through the enabled local perf hook. The referee
still fits a least-squares slope across every valley and multiplies it by the measured
first-to-last valley duration. That value and the complete valley series remain in raw and
compact records for fleet comparison, but neither controls calibration or the frozen gate.

## Frozen suite

| Scenario | Mode | Warmup | Measurement | Purpose |
| --- | --- | ---: | ---: | --- |
| `cold-zone-entry` | offline | 3 s | 12 s | First entry into `thornpeak_heights` after a fresh boot |
| `crowd-influx` | online | 3 s | 18 s | Thirty-six deterministic players stream into view with varied class skins, weapon cosmetics, and mounts |
| `cosmetic-churn` | online | 5 s | 20 s | In-view class-skin, weapon-skin, druid-form, and mount changes |
| `sky-crossing` | offline | 3 s | 18 s | Continuous movement across the Thornpeak HDRI biome band |
| `soak` | online | 15 s | 600 s | Fixed-seed interest churn, settled retained heap, and allocation trend |
| `combat-vfx-burst` | offline | 3 s | 18 s | Repeated first-use combat and particle presentation |

The online cases use 36 fixed bot accounts plus one fixed measured-camera account in
the local development database. The measured browser receives the camera fixture's
short-lived token directly and never calls the normal registration route, so the
referee cannot send signup email or analytics. The seeder refuses non-loopback game and
database URLs, gets the authoritative realm from the local server, caps the bot roster
and payload, and writes accounts, tokens, characters, weapon ownership, and loadouts in
one bounded transaction. An exclusive local fixture lock prevents concurrent referee
processes from invalidating each other's tokens. The database client closes before
WebSocket joins. Batched clean logout, owner-authenticated takeover recovery,
online-player drain, and a database-quiet barrier prevent linkdead or join work from
leaking into the next measurement. The fixture rows are reused and are not deleted per
run.

Before every `crowd-influx` run, the referee parks all bots outside the measured interest
radius and drives a recovery, neutral, and presented reset through the normal WebSocket
command surface. The neutral phase uses a six-column parking grid rooted at the northern
Veiled Hollow staging meadow (`HITCH_CROWD_PARKING_LOCATION` in
`scripts/lib/perf_hitch_crowd_reset.mjs`), with 6-unit spacing and a strict 2-unit
per-axis tolerance. The checked-in test pins all 36 targets and every influx position to
dry, collision-clear, standable shipped terrain: each cell is inside the movement
kernel's climb-slope limit and an idle body run through the real `stepPlayerMotion`
settles without measurable displacement, so no parked bot can be slid off its cell by a
collider push-out or a steep-slope slide. The reset grants riding, guarantees each fixed
reins item is in bags, clears combat presentation and removable auras, draws weapons,
removes cosmetics, and converges with every bot dismounted and idle. The presented phase
reapplies server-valid fixed skin, weapon-skin, and mount rotations and waits for every
mount transition to finish. Both phases validate authoritative bot snapshots before the
measured browser opens. This keeps one-time fixture and summon transitions outside the
browser profile and gives every run the same steady first-draw crowd surface.

Every reset command is paced by an issue-once ledger
(`createCrowdCommandLedger`/`paceCrowdResetActions`): a command goes out once,
acknowledgment is the state readback that stops the planner from planning it again, and
an unacknowledged command retries only after its class quiet window. Dev-chat sends
(`/dev mounts`, `/dev combatreset`) are additionally spaced per bot at
`HITCH_CROWD_CHAT_RETRY_MS`, strictly above the server chat ladder's one-token-per-3-s
refill (`server/game.ts` `consumeChatToken`: burst 5, 3 consecutive refusals lock chat
for 20 s), so an unconverged bot can never talk itself into a chat lock. Non-chat
commands retry at `HITCH_CROWD_COMMAND_RETRY_MS`, far beneath the 30-per-second command
lane (`server/msg_lanes.ts`). The crowd raw dump records every bot's server error tail
under `validation.serverErrors`, and the run fails closed if any tail contains a rate
limiter text.

The soak resets every bot to a neutral skin, no weapon cosmetic, and no mount before
opening the measured page. It then divides the fixed roster into three seeded cohorts.
It keeps two cohorts in the measured client's player-interest radius and one outside
it, then swaps one cohort every 10 seconds. Each returning cohort receives the next
seeded combination of class skin, weapon cosmetic, and mount before it re-enters. The
legacy component-wise rotation produced only 13 unique triplets in a ten-minute run. The
current plan deterministically shuffles the complete 8 by 4 by 5 product and reaches all
160 triplets. Every bot receives 20 entries with 20 unique triplets, including the final
cohort entries at 570, 580, and 590 seconds, so retained renderer paths grow under the
same wider schedule in every calibration run.

## Commands

Start the Vite client and the local game server first. The game server must have dev
commands and profiler invulnerability enabled.

```sh
npm run dev
ALLOW_DEV_COMMANDS=1 npm run server
```

Build after changing client instrumentation so the online server sees the current
client:

```sh
npm run build
```

Run the complete frozen suite and compare it with the gate:

```sh
node scripts/perf_hitch.mjs run --preset insane --gate
```

Run one scenario while developing the harness:

```sh
node scripts/perf_hitch.mjs run --preset insane --scenario crowd-influx
node scripts/perf_hitch.mjs run --preset insane --scenario soak --soak-ms 30000
```

`--soak-ms` is only a development override. Calibration rejects it and always uses the
600000 ms soak.

Create the frozen gate from exactly three same-build, full-suite, insane-preset runs:

```sh
node scripts/perf_hitch.mjs calibrate
```

Calibration appends all three runs to `history.jsonl`, verifies the build identity did
not change, rejects missing or insufficient warmup-baseline program evidence in the two
compile-heavy scenarios (each run must link at least `MIN_BASELINE_PROGRAM_COUNT`
programs during boot and warmup; post-warmup compiles stay a mission metric only, so a
healthy build that links zero live programs still recalibrates), rejects missing
settled-heap evidence, rejects any page error,
rejects a non-positive or widely spread soak settled-heap delta, rejects renderer drift,
and rejects any calibrated metric whose gate verdict changes across runs. Mission
metrics are exempt from that flap rule: their targets are frozen expectations the
unfixed build may legitimately straddle across same-build runs (a GC pause lands inside
the measured window in some runs and not others), so a straddling mission verdict does
not invalidate calibration. Every straddle is printed in the calibrate log and recorded
in `gate.json` under `missionStraddles`, and the mission target stays fully enforced in
every gate compare. Relative spread for the settled delta must remain at or below 0.35.
The calibration watchdog is 75 minutes. A valid calibration writes `gate.json` and the
third calibration record as `before.json`.

Print compact history:

```sh
node scripts/perf_hitch.mjs report
```

## Gate meaning

Calibration records observed samples and ranges but does not turn today’s defects into
acceptable targets. The gate bounds remain:

- post-warmup long frames must be at or below the derived noise floor, with zero as the target
- `crowd-influx` and `cosmetic-churn` must link zero post-warmup programs
- every scenario’s worst post-warmup frame must be at or below 100 ms
- soak settled-heap delta must be at or below its calibrated bound
- every scenario’s allocation rate must be at or below its calibrated bound
- every scenario must record zero page errors

Every gate metric carries a named kind, declared once in the store
(`HITCH_METRIC_KINDS` in `scripts/lib/perf_hitch_store.mjs`) and written into each
`gate.json` metric entry:

- mission: `worstFrameMs` (at or below 100 ms, every scenario), `programCompiles`
  (zero in `crowd-influx` and `cosmetic-churn`), and `pageErrorCount` (zero, every
  scenario). These targets are fixed by the mission, never derived from runs, and the
  unfixed build is expected to fail them, so a mission verdict changing across the
  three calibration runs is recorded as a straddle rather than invalidating the freeze.
- calibrated: `longFrames` (noise floor), `allocationRateMbPerSec` (bound), and the
  soak `settledHeapDeltaMb` (bound). These bounds are derived from the three same-build
  calibration runs, so their verdicts must be identical across those runs or the
  calibration is invalid.

`missionStraddles` in `gate.json` lists every mission target the before-build already
straddled across the calibration runs, so the freeze is honest about which mission
verdicts were unstable on the unfixed build. Both kinds are enforced identically in
every gate compare; the kind only changes what invalidates a calibration.

The soak GC-floor slope, valley series, and legacy heap fields remain recorded diagnostics.
They are not validity checks and are not compared with a frozen gate bound.

The expected starting state is a failed gate. Nonzero crowd and cosmetic program links,
long frames above their floor, and worst frames above 100 ms prove the referee detects
the production failure class. Optimization work changes the game until it passes. It
does not loosen this benchmark.

## Three r165 compileAsync patch

`patches/three@0.165.0.patch` fixes a three r165 `compileAsync` disposal race. Crowd churn
or a skin swap can release a material's renderer properties while three's timer poll is
still pending. The unpatched poll then raises the uncaught window error
`TypeError: Cannot read properties of undefined (reading 'isReady')` and leaves the
`compileAsync` promise pending forever.

When renderer properties no longer contain `currentProgram`, there is no shader program
left for that material to wait on. The patch therefore removes the material from the
pending set, preventing the TypeError and allowing the promise to settle. A future three
upgrade must re-verify upstream `compileAsync` behavior and deliberately retain, replace,
or remove the patch and its installed-source guard test.

## Freeze rule

After engineering signoff, `scripts/perf_hitch.mjs`, its files under `scripts/lib/`,
the scenario order and timing, measurement logic, viewport, browser-state controls,
gate semantics, and store tests are immutable. A behavior change needs a separately
versioned referee and explicit engineering approval. Never edit the frozen gate to make
an optimization pass.

The Chrome cache switch is documented in Chromium’s
[`gpu_switches.cc`](https://chromium.googlesource.com/chromium/src/gpu/+/refs/heads/main/config/gpu_switches.cc),
and its program-cache effect is applied in
[`gpu_channel_manager.cc`](https://chromium.googlesource.com/chromium/src/+/lkgr/gpu/ipc/service/gpu_channel_manager.cc).
Lower-level graphics-driver caches remain outside Chrome’s control, so calibration also
requires all three fresh same-build runs to link a substantial warmup-baseline program
count (`MIN_BASELINE_PROGRAM_COUNT` in `scripts/lib/perf_hitch_store.mjs`) in both
compile-heavy scenarios. The baseline count is a coarse guard: it covers boot plus
warmup together, so on its own it only trips when the program instrumentation breaks
or the scenario stops drawing entirely. The real scenario-potency guarantee lives in
the scenario validations: the crowd influx fails closed below 80 percent of bots
rendered or on incomplete cosmetic variety (skins, weapon skins, mounts each above
their floors), and the cosmetic churn carries the same 80 percent floor, which checks
strictly more than the old nonzero-compile requirement did. Post-warmup program
creation itself is the mission metric with a fixed zero target and is never a
calibration requirement, so the referee can always recalibrate after the
compile-storm fixes land.

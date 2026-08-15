# Packet 0 baselines

The numbers every later packet tunes against, captured with the repaired instruments at
the packet 0 close (packet-0-instruments.md, Phase 07). Sections 1 to 3 are the
session-runnable captures (recorded 2026-07-23/24 on the machine below); section 4 lists
the maintainer-only captures with their exact commands, marked PENDING until run. The
committed jitter artifact lives beside this file as `jitter-soak-baseline.json` (the
Packet 6 gap-p99 comparison base). The real-browser frame-gate rows live in
`tests/hud_perf_budget.baseline.md` (the standing gate reads that file, not this one);
this file records the packet-close capture values behind the R13 keep/refresh decision.

## Capture machine

Absolute numbers are same-machine-relative; compare against a re-run here, not across
hardware.

| Field | Value |
|---|---|
| CPU | Apple M4 Max |
| Cores | 16 logical / 16 physical |
| RAM | 128 GB |
| OS | macOS 26.5.2 (arm64) |
| Node | v26.5.0 |
| Browser | Google Chrome 150.0.7871.182 |
| Display | 120 Hz (vsync-paced runs saturate near 120 fps) |

## 1. Local crowd FPS curve (per tier, batches 20/40/60/80)

The FPS-vs-crowd curve on a live local server, one headed render client (real GPU, vsync
off) plus WS bots clustered on it. Commands:

```sh
docker start eastbrook-db
ALLOW_DEV_COMMANDS=1 npm run server     # restart FRESH before each tier (see protocol)
npm run dev                             # worktree Vite on :5173
GAME_URL=http://localhost:5173 SERVER_URL=http://localhost:8787 \
  CROWD_BATCHES=20,40,60,80 CROWD_GFX=<low|medium|high|ultra> \
  CROWD_JSON_OUT=tmp/crowd-<tier>.json npm run perf:crowd
```

Capture protocol, learned the hard way in this capture and binding for re-runs:

- **Fresh server per tier.** A dropped WS session is held in-world for the linkdead grace
  (`LINKDEAD_GRACE_MS`, 5 minutes), so a back-to-back tier run samples the PREVIOUS
  tier's 80 linkdead bots for its first minutes (the entity count reads ~140 at solo and
  dips mid-run as the grace expires). Restart the server between tiers; the tables below
  are all fresh-world runs with consistent per-label entity counts.
- **Pass GAME_URL explicitly** so the render client hits this worktree's own dev server.
- **Ultra ran at a 1600x900 window** (`CROWD_W=1600 CROWD_H=900`); at the default
  1920x1080 the ultra render tab crashed reproducibly mid-run (three attempts, detached
  frame at different depths) under vsync-off peak GPU load on this machine. The other
  tiers ran the 1920x1080 default.
- The bench sends a unique loopback-trusted `X-Forwarded-For` per bot on BOTH the REST
  calls and the WS upgrade (the WS half landed in this packet's close-out; without it the
  per-IP hard WS cap, default 20, refuses every socket past 20 and the exact-join gate
  fails the run).

Values: `fps` is the sampled average over the 2.5 s window (vsync off), `p95`/`p99` are
frame milliseconds, `calls`/`tris` are draw calls and triangles, `ents` is the interest
mirror size, `views` the renderer's active views. Draw counts are real on every tier:
low/medium report the single render pass (no composer), high/ultra report the phase 01
accumulated per-frame counts (the pre-packet instrument reported 1 call / 1 triangle
there, the dead-instrument signature the bench gate now rejects).

### low (1920x1080)

| Sample | fps | p95 ms | p99 ms | calls | tris | ents | views |
|---|---|---|---|---|---|---|---|
| solo | 405.8 | 3.1 | 6.6 | 248 | 850,765 | 60 | 48 |
| crowd-20 | 197.9 | 7.3 | 10.8 | 492 | 835,311 | 79 | 70 |
| crowd-40 | 142.7 | 11.2 | 12.2 | 565 | 985,207 | 102 | 93 |
| crowd-60 | 134.0 | 9.1 | 12.2 | 640 | 1,140,237 | 120 | 114 |
| crowd-80 | 105.2 | 13.1 | 14.1 | 715 | 1,290,579 | 142 | 134 |
| run-through | 94.8 | 14.2 | 16.1 | 715 | 1,292,147 | 141 | 134 |

### medium (1920x1080)

| Sample | fps | p95 ms | p99 ms | calls | tris | ents | views |
|---|---|---|---|---|---|---|---|
| solo | 296.9 | 3.8 | 7.2 | 378 | 2,204,336 | 60 | 50 |
| crowd-20 | 155.0 | 8.2 | 15.2 | 593 | 2,853,401 | 80 | 70 |
| crowd-40 | 111.3 | 12.1 | 13.2 | 666 | 3,001,729 | 102 | 93 |
| crowd-60 | 95.6 | 14.7 | 15.5 | 744 | 3,164,045 | 121 | 114 |
| crowd-80 | 105.8 | 12.2 | 16.0 | 817 | 3,312,815 | 142 | 134 |
| run-through | 96.3 | 14.7 | 16.2 | 816 | 3,311,245 | 141 | 134 |

### high (1920x1080, composer tier: accumulated draw counts)

| Sample | fps | p95 ms | p99 ms | calls | tris | ents | views |
|---|---|---|---|---|---|---|---|
| solo | 260.8 | 4.4 | 7.2 | 727 | 3,038,593 | 60 | 50 |
| crowd-20 | 143.8 | 8.8 | 13.5 | 1,032 | 3,843,854 | 80 | 70 |
| crowd-40 | 105.0 | 12.6 | 13.8 | 1,177 | 4,138,682 | 102 | 93 |
| crowd-60 | 86.8 | 15.4 | 16.2 | 1,330 | 4,460,670 | 121 | 114 |
| crowd-80 | 88.9 | 14.5 | 29.5 | 1,476 | 4,762,488 | 142 | 134 |
| run-through | 79.5 | 28.2 | 30.0 | 1,474 | 4,758,206 | 141 | 134 |

### ultra (1600x900, composer tier: accumulated draw counts)

| Sample | fps | p95 ms | p99 ms | calls | tris | ents | views |
|---|---|---|---|---|---|---|---|
| solo | 261.3 | 4.4 | 7.7 | 727 | 3,040,640 | 60 | 49 |
| crowd-20 | 146.0 | 9.1 | 13.1 | 1,030 | 3,840,715 | 80 | 70 |
| crowd-40 | 106.1 | 13.4 | 14.2 | 1,179 | 4,144,399 | 102 | 93 |
| crowd-60 | 81.0 | 15.7 | 17.1 | 1,330 | 4,460,671 | 121 | 114 |
| crowd-80 | 79.7 | 15.6 | 17.7 | 1,476 | 4,762,489 | 142 | 134 |
| run-through | 76.8 | 16.8 | 32.4 | 1,474 | 4,758,207 | 141 | 134 |

Reading notes:

- The overall trend is the same on every tier: solo to crowd-80 costs roughly 2.5x to
  4x fps. The small crowd-80 fps upticks on medium/high sit inside sample noise; the
  load columns (calls, tris, ents, views) keep growing there, and the p99 keeps rising
  (medium 15.5 to 16.0 ms, high 16.2 to 29.5 ms) even where the p95 dips.
- High and ultra draw nearly identical counts here because this machine's ultra extras
  are pixel-cost (DPR/AO), not draw-count; the ultra table's smaller window also cuts
  its pixel load, so treat high as the composer-tier draw baseline.
- Packet 1 tunes the per-rig ceiling against these tables; the composer-tier draw
  numbers (727 solo to 1,476 at crowd-80) are the first real ones (brainstorm 4.6).

## 2. Server jitter soak (the Packet 6 gap-p99 comparison base)

An 80-bot IDLE social crowd (movement, no combat) plus the roaming observer, on a fresh
local server, observer-gated so the committed artifact cannot be hollow:

```sh
SERVER_URL=http://localhost:8787 BOTS=80 IDLE=1 DURATION_MS=60000 JITTER_MAX_P95=250 \
  JSON_OUT=docs/design/player-performance/jitter-soak-baseline.json npm run perf:load
```

Verdict PASS (80/80 joined plus observer; `minGaps` floor 600). Headline values (full
detail in `jitter-soak-baseline.json`):

| Metric | Value |
|---|---|
| Observer snapshot-gap p50 / p95 / p99 / max | 51.3 / 56.9 / 61.2 / 65.8 ms |
| Observer hitches over 100 / 150 / 250 / 500 ms | 0 / 0 / 0 / 0 (1,173 gaps) |
| Observer avg snapshot size | 10,710 bytes |
| Bot snapshot-gap p95 (median / worst of 80) | 56.8 / 57.0 ms |
| Avg entities in interest | 144 |
| Server loop p95 / max | 16.4 / 23.7 ms (tick 6.1, broadcast 10.8 p95; 504 sim entities, 20.25 Hz) |

Packet 6 compares its gap-p99 against 61.2 ms and the zero hitch counts above, same
command, same machine.

## 3. Real-browser tour captures (PERF_GPU=1, packet close)

Two back-to-back both-viewport captures behind the R13 keep/refresh decision (the
standing rows live in `tests/hud_perf_budget.baseline.md`):

```sh
PERF_GPU=1 PERF_VIEWPORT=both GAME_URL=http://localhost:5173 \
  PERF_OUT=tmp/perf-tour-gpu.json node scripts/perf_tour.mjs
```

| Metric | Run 1 | Run 2 | Committed row | R13 decision |
|---|---|---|---|---|
| desktop frames | 1,586 | 1,589 | tourMinFrames 500 | KEPT (floor keeps 60 Hz headroom) |
| mobile frames | 1,531 | 1,530 | tourMinFrames 500 | KEPT |
| desktop frameLong50 | 0 | 0 | frameLong50 12 | KEPT (hitch storms measure in the hundreds) |
| mobile frameLong50 | 0 | 0 | frameLong50 12 | KEPT |
| desktop hudHotDomWrites | 538 | 539 | hudHotDomWrites 640 | REFRESHED from the stale 153 |
| mobile hudHotDomWrites | 632 | 632 | hudHotDomWrites 640 | anchor covers the worst viewport |
| fct burst (both viewports) | 64/64/64 | 64/64/64 | FCT_POOL_CAP 64 | pool cap-bounded |

Both runs at ~119.5 fps (vsync-paced at 120 Hz), tier ultra. The desktop leg exits
nonzero on the pre-existing `training_dummy.glb` console error (the errors channel, not
a budget failure); the artifact is still written and fully consumable by the
hud_perf_budget ARM 3 gate.

## 4. Maintainer captures (PENDING, commands documented)

These only exist on the live site or post-deploy; the maintainer runs them and appends
the values here.

| Capture | Status |
|---|---|
| Owner-Mac live-site town session: ?perf overlay JSON | PENDING (maintainer) |
| Chrome Performance trace during an arrow-key plaza turn | PENDING (maintainer; settles the CPU-bound presumption, brainstorm section 1) |
| Production peak tick capture (busy evening) | PENDING (maintainer, post-deploy) |
| Production perf summary after 48 h of schema v2 dimensions | PENDING (maintainer, post-deploy) |

Commands:

1. **Live-site town session.** On the owner Mac, open
   `https://worldofclaudecraft.com/?perf`, enter the world, and stand in the town plaza
   at evening population. Copy the ?perf overlay JSON into a dated block here. Then open
   DevTools, Performance panel, record about 10 seconds while holding an arrow-key turn
   in the plaza, and save the trace (`.json.gz`) beside this doc or into the tracker
   issue. The trace formally settles the main-thread CPU-bound presumption that the LOW
   parity repro strongly indicates (brainstorm section 1).
2. **Production peak tick capture.** During a busy evening, from an operator session on
   the admin origin: `POST /admin/api/perf/tick/capture` with body
   `{"durationMs": 60000}`, wait out the window, then `GET /admin/api/perf/tick` and
   record the phase table (the same shape as the local soak's serverPerf block).
3. **Production fleet summary.** At least 48 hours after the packet deploys (so the
   schema version 2 dimensions have data): `GET /admin/api/perf/summary` and record
   `byCrowd`, the zone-valued `byScenario`, `suggestionCounts`, and the worst-10s
   distribution. This seeds the zone/crowd fleet view and sizes the integrated-GPU
   cohort (finding 16).

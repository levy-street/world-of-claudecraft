# Professions 1,000-concurrent baselines (phase 16, R36)

The professions tuning packet's load baseline: synthetic gathering and fishing
sessions at 1,000 connections against a local dev server, captured with
`scripts/load_professions.mjs` (`npm run perf:professions`). Every number here
is a SAME-MACHINE-RELATIVE measurement per R36 (recorded on the maintainer's
Mac, hardware below, with the rig sharing the box); nothing in this file is
CI-asserted. The CI-assertable half of the phase 16 budget split lives in
tests: `tests/professions_wire_budget.test.ts` (ncd/tslot bytes per player per
tick under the delta rules, both timer-wire arms, allocation stability of the
empty arms), `tests/professions_blob_growth.test.ts` (the settled worst-case
professions blob, 8,587 bytes measured after the v0.33.0 equip-slot
retirement re-bound the fixture to all twelve live slots, 9,728 pinned), and
`tests/professions_zone_scaling.test.ts` plus the minimap rim-cull arms in
`tests/minimap_markers.test.ts` (the zone-scaling projection).

Captured 2026-07-31 (UTC). All four scenarios joined exactly 1,000 of 1,000
bots with all 1,000 alive at window close, and passed the rig's own gate
(`evaluateProfessionsLoadRun`: unconditional join and liveness enforcement,
per-observer sample floors, timer-wire arm purity, and window-scoped
hollow-run evidence, whose floors scale with the window instead of accepting
one lone harvest or fishing outcome as proof the run was not hollow: one
piece of role evidence per minute of window, `max(1, floor(durationMs /
60000))`, which is 3 across the 180 s window used here). The gate also holds
each observer's WORST inter-snapshot gap under a 10,000 ms continuity
ceiling, so a mid-window stall fails the run rather than averaging away into
a healthy mean. These four captures clear both arms with margin: worst gaps
of 707 to 795 ms against the ceiling, and roughly 21 (stable wire) to 275
(legacy wire) ncd-carrying snapshots per gather observer against the floor of
3. That second pair is RECONSTRUCTED from each artifact's `roles.*.ncd`
counts, since the committed four predate the per-observer evidence rows; the
fish arm's outcome counts survive only in each run's console verdict. Every
artifact stamps
`gitHead f881426ba1`, the commit whose rig produced it, so the whole set
shares one provenance. Two rounds of commits have landed on top of that tip
since. The fix round: most of it changed the rig itself (transactional
seeding, a helper rename, and moving the window-open perf fetch off the
measured clock), and one commit (cdaf8478a7) also changed a sim LOAD path
(the `addPlayer` signer and `craftedBy` clamp refinements). The QA round then
added five more, of which three matter to a reader of these tables:
`81d4905380` is a SECOND sim load-path change (the item-instance payload
bound), `7298751e2e` changes server teardown and boot behavior (the
mid-handshake save scope and the pool-knob boot lines), and `f53c503eee`
rewrote much of the rig itself. None of them touches a measured loop phase:
both sim load-path changes run once per character as the fleet joins and so
land in the ramp, the teardown and boot changes run outside the window
entirely, and everything else is rig code. A recapture with the current rig
therefore reproduces the server and wire numbers, but reports slightly lower
`rig.loopLagMs` figures than these artifacts carry. One more reason that
figure reads high here: the periodic mid-window `/api/perf` scrape was
awaited INSIDE the measured driver loop, so 18 of the window's 720 loop-lag
samples each carry a scrape round trip and `rig.loopLagMs` modestly
overstates pure loop lag on a saturated box (the server and wire numbers are
unaffected). The QA round has since moved that periodic scrape off the
measured clock too, so recaptures after it read lower still. The QA round's
own three re-captures ran at `c6e9ba1a20`, BEFORE the QA fix commits named
here.
Artifacts, one per scenario beside this file:
`professions-load-mixed-stable.json`, `professions-load-gather-legacy.json`,
`professions-load-gather-stable.json`, `professions-load-fish-stable.json`.
The rig now also stamps the gate's own inputs into each artifact, under
`observerEvidence`: one row per observer carrying `label`, `role`, `gaps`,
`gapMaxMs` (the worst inter-snapshot gap the continuity arm reads),
`sawStableTw`, `ncdFrames` (a COUNT of the snapshots whose ncd map arrived
non-empty, not a boolean), and `fishingOutcomes`, so a reader can re-judge a
committed capture instead of trusting the verdict line beside it, plus
`verdict` itself (the `ok` flag and the failure strings). Alongside those the
artifact carries `gitDirty`, `reportMs`, `observersRequested` and
`observerCount` (the `OBSERVERS` knob against the observers actually staged),
`fishSpotRotations` (fleet-wide self-healing spot rotations, the tell for a
fish run fighting its shore spots), and the db-pool gauges `poolAtWindowOpen`
and `poolAtWindowClose` (waiting, total, idle) scraped from `/metrics`. That endpoint is bearer-gated by the SERVER's
`METRICS_TOKEN` (404 when the server has none, 401 on a wrong credential),
so a run without the token stamps both pool fields null: disclosure, never a
gate input, and such a run is still a valid capture. The four artifacts
committed here carry `verdict` and `observersRequested` but predate the pool
gauges, `observerEvidence`, `reportMs`, and `gitDirty` (the whole-branch
review corrected an earlier blanket "predate every one of these fields"
claim here); the missing gate inputs live outside the files, in the run's
console verdict and log, and a recapture's artifact carries more than these
do.

## Capture machine

| Field | Value |
|---|---|
| CPU | Apple M4 Max |
| Cores | 16 logical / 16 physical |
| RAM | 128 GB |
| OS | macOS 26.5.2 (arm64) |
| Node | v26.5.0 |
| Postgres | throwaway `postgres:16-alpine` container on 127.0.0.1:5434 |
| Branch tip | feature/professions-tuning-packet at f881426ba1 (all four artifacts stamp it) |

## The rig recipe

One scenario per invocation, FRESH server per scenario (a restart clears the
world, the rolling perf ring, and every session). The Postgres password is any
throwaway value; keep the container bound to 127.0.0.1 exactly as shown, and
substitute your value in both places:

```sh
docker run -d --name wocc-prof-load-pg -p 127.0.0.1:5434:5432 \
  -e POSTGRES_USER=eastbrook -e POSTGRES_PASSWORD=<throwaway> \
  -e POSTGRES_DB=eastbrook postgres:16-alpine

# In BOTH shells (server and rig): each side holds 1,000 sockets, and macOS's
# 256 soft default hits EMFILE partway up the ramp.
ulimit -n 10240

# METRICS_TOKEN is optional and must MATCH on both lines below: it is what
# lets the rig scrape the db-pool gauges off the bearer-gated /metrics.
ALLOW_DEV_COMMANDS=1 PERF_TICK_LOG=1 PORT=8799 DB_POOL_MAX_CLIENTS=80 \
  METRICS_TOKEN=<metrics-token> \
  DATABASE_URL=postgres://eastbrook:<throwaway>@127.0.0.1:5434/eastbrook \
  npm run server

DATABASE_URL=postgres://eastbrook:<throwaway>@127.0.0.1:5434/eastbrook \
  SERVER_URL=http://127.0.0.1:8799 BOTS=1000 MODE=mixed STABLE=1 \
  DURATION_MS=180000 METRICS_TOKEN=<metrics-token> \
  JSON_OUT=docs/design/player-performance/professions-load-mixed-stable.json \
  node scripts/load_professions.mjs
```

The four scenarios vary only `MODE` (`mixed` | `gather` | `fish`) and `STABLE`
(`1` requests the stable timer wire; `0` rides the legacy per-tick arm every
`scripts/*.mjs` client rides by default). The rig's own defaults carried the
rest: `WARMUP_MS` 45000, `CONNECT_CONCURRENCY` 20, `OBSERVERS` 32, `TOUR_SEC`
6, `NODES_PER_BOT` 40, `STEP_MS` 250, `BOT_LEVEL` 60, and `REPORT_MS` 10000,
the mid-window `/api/perf` scrape cadence: a 180 s window at one scrape per
10 s is the 18 entries in every artifact's `serverPerfMid`. Most of those
knobs are stamped into each artifact (`warmupMs`, `connectConcurrency`,
`tourSec`, `nodesPerBot`, `stepMs`, `botLevel`, `observersRequested`);
`reportMs` alone is stamped by the CURRENT rig only, and the four artifacts
committed here predate that one field. `REALM_NAME`
defaults to `Claudemoon` and must match the realm the server runs, so a
locally renamed realm has to be passed to the rig as well.

Capture protocol, learned the hard way:

- **Both env vars on the server line are load-bearing, not decoration.**
  `ALLOW_DEV_COMMANDS=1` is what the entire workload rides (`dev_level`,
  `dev_give`, `dev_teleport`, and the `/dev gather` proficiency grants), and
  without `PERF_TICK_LOG=1` the server's detailed-timing switch stays off, so
  the `bcastSelf`, `bcastGrid` and sim-lap rows of every table below read 0.0
  while the rig's gate, which never looks at server perf at all, still stamps
  PASS on the run.
- **`DB_POOL_MAX_CLIENTS=80` is load-bearing, not tuning.** On the 10-client
  default the ramp collapses long before 1,000: the 30 s autosave waves
  (every session, whole blob, no dirty tracking) hold the pool while login
  handshakes wait out the pool connect timeout, surfacing to the client as
  the relabeled 'authentication timed out'. The production default is
  unchanged; the knob parses strictly (decimal digits only, 1 to 97, the
  share of stock postgres:16's 100-connection budget left after the
  superuser reservation). An out-of-range or malformed value is NOT clamped
  down to the ceiling: it falls back to the 10-client default and says so
  with a loud `console.error`. That fallback is why the knob deserves a
  second look before every capture; while the error line was missing, a
  capture launched with 120 ran silently on 10 clients and reproduced the
  exact collapse this bullet warns about.
- **The WS auth deadline is NOT a lever here.** The 10 s timer clears when
  the FIRST frame arrives, before any handshake database work, so raising it
  cannot help the ramp (a knob added mid-phase on that wrong theory was
  reverted by the review round). What converges the ramp instead: the join
  pool TAPERS to five concurrent workers past 70 percent joined, the client
  never aborts a handshake the server is still deciding (30 s client timeout
  against the 10 s server deadline), the retry passes escalate 5 s to 90 s,
  and every bot teleport-disperses at ITS OWN hello (`seedSession` fires the
  `dev_teleport` the moment that bot's join lands, so the fleet spreads while
  it is still joining). The dispersal is the one the code names as the fix
  for the first observed 1,000-bot failure: 1,000 fresh characters otherwise
  pile onto a single spawn point, interest goes quadratic there, the loop
  callback drags past the server's 10 s auth deadline, and the handshakes
  still in flight starve. A mid-handshake socket death used to orphan a
  permanent lease-holding zombie session that made a character unjoinable;
  that server defect was found and FIXED in this phase (the ws_auth
  readyState re-check),
  and post-fix the tail failures are clean rejections the ladder converges.
- **Verify the fresh bind, by hand, before every scenario.** A dying server
  closes its listener before it finishes draining, so a quick restart can
  leave the new process as an EADDRINUSE zombie while the old one serves on.
  After starting the server and before starting the rig, check all three:
  the new server's log contains no EADDRINUSE, something LISTENS on the port
  (`lsof -nP -iTCP:8799 -sTCP:LISTEN`), and `/api/status` reports
  `"players_online":0`. Abort the scenario if any check fails; the recipe
  has no committed wrapper that does this for you. After a release merge, do
  one throwaway boot first: ensureSchema's boot-time CREATE INDEX
  CONCURRENTLY migrations (`play_sessions_ended_account` is one) build on a
  grown throwaway database while the boot holds the advisory lock, and the
  three checks read that first boot as a wedged server.
- **The rig measures itself.** `rig.loopLagMs` in each artifact is the
  driver-loop lag; at 1,000 sockets on the shared box its p95 ran 313 to
  508 ms across the four captures, so treat client-side GAP numbers as
  same-box-relative. Byte counts are unaffected (counted per frame received).
- **Snapshot cadence sheds under saturation by design.** The server keeps
  sim ticks near 15.5 Hz through catch-up but broadcasts once per loop
  callback; at 1,000 professions bots each client received 1.53 to 1.57
  SNAPSHOTS a second (derived from every artifact's observer counts:
  `roles.*.snapshots / observers / 180`). `fleet.rxFramesPerSecondPerBot`
  (2.9 to 3.2) counts every ws frame, snapshots plus event frames; do not
  read it as the broadcast rate.
- **The server phase table is a rolling ring, wider than the window.** The
  `/api/perf` profile keeps the last 1200 LOOP CALLBACKS, roughly 10 to 13
  minutes at the observed callback cadences, so the close scrape
  (`serverPerf`) blends the ramp and warmup with the window (the tell:
  `total.mean` sits below `total.p50` in all four artifacts, and the window
  itself contributes only about 280 of the 1200 entries). Each artifact
  also stores `serverPerfAtWindowOpen`; the ring is already full at window
  open, so the two scrapes cannot be subtracted, but comparing them bounds
  the pre-window drift. The window-scoped client evidence (mean
  inter-snapshot gap about 0.64 to 0.65 s) is the honest steady-state
  callback estimate, matching the ring's p95 rather than its p50.
- **Repeat runs accumulate rows on the throwaway database.** Pass `CLEANUP=1`
  to the rig invocation to delete the seeded accounts at teardown (the
  recipe above omits it, so each scenario leaves its fleet's rows behind);
  even with cleanup, tables referencing accounts with ON DELETE SET NULL
  (chat logs, reports, moderation trails) keep their rows. Those same
  referrers make teardown cost grow with the database it reuses: the delete
  runs as chunked `DELETE FROM accounts WHERE id = ANY(...)` statements, 100
  account ids each so the lock window stays short enough for a character save
  still in flight to interleave, but Postgres still enforces every
  SET NULL reference row by row, and the columns with no index behind them
  (`chat_logs.account_id` is the volume one: the table indexes `created_at`
  and `(character_id, created_at)` only) cost a scan per deleted account.
  Measured at 1.7 s for the fleet against a database holding only about 50k
  chat rows, so a container reused across all four scenarios tears down
  progressively slower. Fine for a disposable container; never point the rig
  anywhere else (the loopback guards refuse it).
- **The entity counts are capture-time-relative.** The four tables' 1,824 to
  1,832 entities predate the rift scheduler (one portal per eligible zone
  hourly, across the zones `eligibleRiftZones()` in `src/sim/rift/portals.ts`
  returns): a recapture at the merged tip reads about ten entities higher from
  rift portal ground objects, from the rift cadence and not from anything the
  professions path does. The v0.34.0 sync adds more capture-time deltas of
  the same class: the 11 expansion-hub mailboxes, and event-frame growth the
  release added (ability ids on every spellfxAt emit, zone pulse ticks) that
  no baseline has measured yet; fold both into the next recapture's
  provenance note rather than comparing raw counts across syncs.

## Results

Server phase times are per LOOP CALLBACK (one broadcast plus however many
catch-up sim ticks ran), from the ring described above at capture close.
Snapshot sizes are bytes per received `snap` frame across the parsing
observers; `ncd/tslot per-snap` is that field's average VALUE-payload byte
cost per snapshot under the delta rules (the field key and separator, 7 bytes
for `ncd` and 9 for `tslot` when present, are excluded by the measurement's
re-stringify). The `Sim tick rate under catch-up` row in each table is a
SINGLE tail sample: `TickRateMeter` averages a 3 s window and the tables read
it from the scrape taken at window close. The 18 mid-window samples each
artifact carries in `serverPerfMid` run 15.38 to 16.03 Hz across the four
scenarios, with per-scenario means of 15.39 to 15.72 Hz, and it is those
means the projection's 'near 15.5 Hz' tracks; the table values stand as
captured.

### 1. mixed-stable (the flagship: 500 gather + 500 fish, stable timer wire)

| Metric | Value |
|---|---|
| Joined / alive at window close | 1000 / 1000 (verdict PASS) |
| Per-client snapshot rate | 1.57/s (gather and fish observers alike) |
| Snapshot bytes, gather observers p50 / p95 / p99 / max | 4,688 / 25,056 / 61,290 / 101,043 |
| Snapshot bytes, fish observers p50 / p95 / p99 / max | 10,453 / 24,234 / 29,919 / 36,033 |
| ncd presence ratio / bytes per snapshot (gather) | 0.074 / 34.7 B |
| tslot presence ratio (both roles) | 0 (fully elided in steady state; the bots never slot an effect, so the tslot budget's non-empty arm is CI-only by design, owned by tests/professions_wire_budget.test.ts) |
| Fleet receive rate per bot | 21,594 B/s at 3.2 frames/s |
| Server loop total p50 / p95 / max | 525.4 / 646.3 / 704.6 ms |
| Server broadcast p50 / p95 / max | 63.4 / 87.5 / 111.6 ms (bcastSelf 15.3 / 24.0 / 30.2) |
| Sim tick rate under catch-up | 15.8 Hz at 1,832 entities |
| Rig loop lag p95 | 475.3 ms |

The per-role byte rows are the SAMPLED quantity: 32 observers on a stride of
31 bots, which under-samples the heaviest interest sets and so understates
fleet-wide snapshot cost. `Fleet receive rate per bot` is the ground truth
(summed over all 1,000 bots) and already carries that tail; reconstructing the
sampled rate from each artifact's `roles` block puts the residual between the
two at about 20 percent here, against 4 to 9 percent in the single-role runs.

### 2. gather-legacy (1,000 gatherers, the pre-stable per-tick ncd arm)

| Metric | Value |
|---|---|
| Joined / alive at window close | 1000 / 1000 (verdict PASS) |
| Per-client snapshot rate | 1.53/s |
| Snapshot bytes p50 / p95 / p99 / max | 12,013 / 28,950 / 45,388 / 63,243 |
| ncd presence ratio / bytes per snapshot | 1.0 / 479.5 B (every frame, whole map) |
| Fleet receive rate per bot | 23,697 B/s at 3.0 frames/s |
| Server loop total p50 / p95 / max | 556.7 / 670.4 / 733.7 ms |
| Server broadcast p50 / p95 / max | 63.1 / 81.6 / 98.6 ms (bcastSelf 16.4 / 27.0 / 36.4) |
| Sim tick rate under catch-up | 15.4 Hz at 1,830 entities |
| Rig loop lag p95 | 421.4 ms |

### 3. gather-stable (1,000 gatherers, stable timer wire; the arm contrast)

| Metric | Value |
|---|---|
| Joined / alive at window close | 1000 / 1000 (verdict PASS) |
| Per-client snapshot rate | 1.56/s |
| Snapshot bytes p50 / p95 / p99 / max | 4,759 / 19,934 / 44,152 / 60,537 |
| ncd presence ratio / bytes per snapshot | 0.076 / 37.2 B |
| Fleet receive rate per bot | 12,397 B/s at 2.9 frames/s |
| Server loop total p50 / p95 / max | 538.7 / 659.8 / 720.8 ms |
| Server broadcast p50 / p95 / max | 54.2 / 72.6 / 97.9 ms (bcastSelf 15.4 / 23.8 / 35.4) |
| Sim tick rate under catch-up | 15.8 Hz at 1,831 entities |
| Rig loop lag p95 | 312.7 ms |

**The arm contrast (2 versus 3, identical workload):** the stable timer wire
cuts the median gather snapshot 2.5x (12,013 to 4,759 B), the steady-state
ncd cost 12.9x (479.5 to 37.2 B per snapshot), and the fleet receive rate
1.9x (23.7 to 12.4 KB/s per bot). This is the measured value of the
negotiated `tw:2` arm for professions traffic, and the number a rollback to
the legacy arm pays back.

### 4. fish-stable (1,000 anglers on 64 discovered shore spots)

| Metric | Value |
|---|---|
| Joined / alive at window close | 1000 / 1000 (verdict PASS) |
| Per-client snapshot rate | 1.53/s |
| Snapshot bytes p50 / p95 / p99 / max | 32,513 / 43,149 / 43,726 / 141,174 |
| ncd / tslot presence | 0 / 0 (fishing populates neither) |
| Fleet receive rate per bot | 42,386 B/s at 3.2 frames/s |
| Server loop total p50 / p95 / max | 588.4 / 658.8 / 702.2 ms |
| Server broadcast p50 / p95 / max | 90.5 / 114.0 / 129.9 ms (bcastGrid 64.0 / 73.2 / 84.9) |
| Sim tick rate under catch-up | 15.4 Hz at 1,824 entities |
| Rig loop lag p95 | 507.6 ms |

The fish scenario's larger snapshots are CO-LOCATION, not professions wire:
1,000 anglers over 64 spots is about 16 anglers per SPOT, and an interest set
holds more than one spot's worth, since the 90 yd player interest radius
(`INTEREST_RADIUS` in `server/game.ts`; the wider 120 yd one is the NPC
radius) reaches past the spot a client stands on. `bcastGrid` (the entity stream)
carries the growth while `bcastSelf` stays flat across all four scenarios
(15.4 to 17.4 ms mean). That matches the packet's standing finding that
professions self-deltas are cheap and crowding is the broadcast cost.

## What the projection takes from this

- At 1,000 active professions bots this box runs the loop callback at about
  0.64 s steady state (1.53 to 1.57 broadcasts a second per client) while
  catch-up holds sim ticks near 15.5 Hz; the professions SELF-delta block
  (`bcastSelf`) is about 16 ms of that callback for a thousand sessions, and
  the entity stream plus the sim tick dominate. Professions wire is not the
  1,000-concurrent bottleneck on either arm.
- The legacy arm's whole-map-per-tick behavior is the one professions term
  that grows with node count times online count; the stable arm's steady
  state is byte-free and the delta pins in
  `tests/professions_wire_budget.test.ts` hold it there.

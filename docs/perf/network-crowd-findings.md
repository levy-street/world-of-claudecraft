# Network / crowd performance: test harness + findings

Work-in-progress. Adds the crowd-load path to the perf profiler (`scripts/profile.mjs
crowd`) and captures a first pass of real-client crowd measurements. Builds on the
perf-profiler tooling.

## How to run

```
ALLOW_DEV_COMMANDS=1 npm run server      # :8787 (bots teleport to cluster)
npm run dev                              # :5173
BROWSER_PATH=/path/to/chrome node scripts/profile.mjs crowd --tier high --crowd 50
```

The `crowd` scenario enters one real online client, then spawns N WS bot clients
(real REST register + char create + WS auth) clustered around the client, and samples
client FPS at solo / half-crowd / full-crowd / crowd-while-moving.

## Harness fixes this branch makes (the scenario was broken before)

- **Char names are letters-only** (the server rejects digits). Both the client name
  (`Pcam<uniq>`) and the bot names (`Pb<uniq>...`) embedded the numeric run stamp, so
  every Create was silently rejected. Map digits to letters.
- **Robust online entry.** A fresh account lands on `charcreate-panel` directly (not
  `charselect`/`realm`), which the old fixed flow never handled. Drive whichever panel
  appears (realm / charcreate / charselect) until the world loads, tolerating the page
  navigation that "Enter World" triggers.
- **Per-bot `X-Forwarded-For` on the WS upgrade, not only on REST.** This is the fix
  for the connection ceiling described below. The REST register/create calls already
  carried a unique XFF per bot; the WebSocket upgrade did not, so every bot's socket
  resolved to `127.0.0.1` and shared one IP. A loopback source is a trusted XFF setter,
  so passing the same header on the `new WebSocket(...)` upgrade gives each bot its own
  apparent IP across the whole join, the way a real crowd of distinct clients does.
- **Staggered bot joins.** Kept as a courtesy (the bots register/create/join in waves
  with a gap) so a single run does not thundering-herd the DB pool; it is no longer
  load-bearing for the ceiling. Join timeout raised to 20s.

## Root cause of the old ~20-24 connection ceiling (FIXED)

The ceiling was **not** server join-path throughput, interest scope, or an idle-drop.
It was the anti-bot **per-IP hard cap** doing its job: `MAX_WS_PER_IP_HARD` (default 20,
`server/main.ts`). Because the harness only set the per-bot XFF on the REST calls and
not on the WS upgrade, all bots shared `127.0.0.1`, so the 21st WS connection was
refused with `close(1008, 'Too many connections from your network')`. The bot then
waited for a `hello` that never arrived and reported `join timeout`, which read like a
throughput problem but was a flat policy reject at 20.

With the XFF now on the WS upgrade (above), each bot is a distinct IP and the cap no
longer bites, so the crowd scales to the size you ask for. No production behaviour
changes: the cap is unchanged and still protects real deployments; only the load-test
harness, which legitimately simulates many distinct clients, now presents distinct IPs.

## Server join-path optimisation (this branch)

With the ceiling gone, the join path itself is the next lever for a reconnect storm
(everyone returning after a restart hitting auth at once):

- **Parallelised the auth reads.** `authenticateWebSocket` ran six DB queries strictly
  in series (token, moderation, character, chat-mute, admin, cosmetics). The five that
  only depend on the resolved `accountId`/`characterId` now run in one `Promise.all`
  batch, so a join holds a pool connection for far less wall-clock and a burst drains
  instead of queueing behind the 10s auth timeout. Error priority (locked > no-character
  > force-rename > too-many-connections) is preserved.
- **`PG_POOL_MAX` env knob.** The `pg` pool size (default 10, unchanged) is now
  env-tunable, so a crowd test or a busy realm can widen it without a code change
  (`server/db.ts`). Keep the sum across realm processes under the database's
  `max_connections`.

## Results after the fix (RTX 3060 Ti, high tier, single-realm dev server)

`profile.mjs crowd --tier high --crowd 50`, `PG_POOL_MAX=30`, headed, vsync off. The
crowd now scales to the requested size: **all 50 bots connect (51 players in scene with
the real client); zero join failures, zero `1008` rejects, no pool/timeout errors**, vs
the old ~21 wall.

| scene | players | fps | 1% low | p99 | jank |
|---|---|---|---|---|---|
| solo | 1 | 103.9 | 76.1 | 12.3ms | 0% |
| crowd-25 | 26 | 70.9 | 40.7 | 18.8ms | 0.35% |
| crowd-50 | 51 | 59.1 | 45.9 | 20.9ms | 0% |
| crowd-50 moving | 51 | 60.2 | 35.4 | 26.8ms | 1.66% |

The server kept up across the whole run (snapshots sustained 59-60 fps with near-zero
jank at 51 players, so the 50ms tick budget was not blown). Each nearby player is a real
client-side render cost (skinned rig + nameplate); that per-player cost is the separate
FPS-under-crowd lever, and is what the crowd-adaptive character LOD (PR #1013, in the
release) targets - it is why the 1% low at 51 players (45.9) is actually steadier than
the old un-LOD'd 21-player run (~33-40).

## How to run a real 40-50 crowd now

```
npm run db:up                            # Postgres on :5433
ALLOW_DEV_COMMANDS=1 npm run server      # :8787 (bots teleport to cluster)
npm run dev                              # :5173
BROWSER_PATH=/path/to/chrome node scripts/profile.mjs crowd --tier high --crowd 50
```

`MAX_WS_PER_IP_HARD` no longer needs raising (each bot is a distinct apparent IP). If
you specifically want to test the per-IP cap itself, set it low and watch the reject.

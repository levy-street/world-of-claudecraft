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
- **Staggered bot joins.** 50 simultaneous WS auth + character-load joins overwhelm the
  server join path (most time out); join in waves with a gap so the world loop drains
  each set. Join timeout raised to 20s.

## First findings (RTX 3060 Ti, high tier, offline single-realm dev server)

- Single player baseline: ~85-89 fps.
- ~21 real players in view: ~65-77 fps, 1% low drops from ~45 to ~33-40. So each nearby
  player is a real client-side render cost (skinned rig + nameplate), and the 1% lows
  dip under crowd - the place to optimise client FPS for crowds.

## Open: the ~20-24 connection ceiling

Despite staggering, only ~20-24 bots stay connected (the rest fail with `join timeout`);
the client then renders ~21. It is NOT the interest scope (players enter at 90yd, the
bots cluster at 28yd) and NOT an idle-drop (the server only clears stale held input, it
does not disconnect). It looks like server join-path throughput under the world loop
(DB character-load concurrency / event-loop contention). Reaching 40-50 connected needs
a server-side look (DB pool size, join batching). The client-render cost is separately
measurable and is the FPS-under-crowd lever.

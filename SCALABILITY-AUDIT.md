# Horizontal Scalability Audit: World of ClaudeCraft

Status: assessment only, no code changes. Scope: can this project scale
horizontally, where does it stop scaling today, and what would have to change to
push each ceiling higher. Written against the current tree (server/game.ts,
server/main.ts, server/db.ts, server/realm.ts, headless/).

## 1. Executive summary

The project already has one, and only one, real axis of horizontal scale: the
**realm (shard)**. Each realm is one Node process that owns one authoritative
`Sim`, and you add capacity by starting more realm processes against the same
Postgres. That model is clean, deliberate, and enforced (a per-realm advisory
lock makes a duplicate process fail fast). It scales the product to many
thousands of concurrent players across many worlds.

What it does not do is scale a **single world** past one CPU core. A realm is a
single-threaded 50 ms game loop plus a single-threaded broadcast pass, both
pinned to one process on one machine. When one realm gets popular, you cannot add
a second machine to help it; you can only make the box bigger (vertical) or split
players into a second, isolated realm they cannot see or play with.

Two shared resources sit under everything and will become the next ceilings after
per-realm CPU: the **single Postgres instance** (every realm shares one
`DATABASE_URL`, and each process opens a pool of only 10 connections) and the
**in-process, non-replicated state** (leaderboard cache, World Market, presence,
WebSocket sessions) that assumes exactly one process per realm.

So the honest answer to "can this scale horizontally": **yes across realms, no
within a realm, and the database is a shared single point that all realms lean
on.** The rest of this document lays out each ceiling and the concrete options
for raising it, cheapest-first.

## 2. Current architecture (what actually runs)

```
                         one shared Postgres (DATABASE_URL)
                    +---------------------------------------------+
                    |  accounts, characters(JSONB state),         |
                    |  auth_tokens, world_state(market:<realm>),  |
                    |  social, moderation, ...                    |
                    +----+------------------+---------------------+
                         |                  |
        (10-conn pool)   |                  |   (10-conn pool)
                    +----+-----+       +----+-----+
                    | Realm A  |       | Realm B  |     ... one process per realm
                    | process  |       | process  |
                    |  1 Sim   |       |  1 Sim   |
                    |  50ms    |       |  50ms    |
                    |  loop    |       |  loop    |
                    +----+-----+       +----+-----+
                         |                  |
                    WS + REST          WS + REST
                    (all players       (all players
                     of realm A)        of realm B)
```

Key facts confirmed in the code:

- **One Sim per process, single-threaded.** `GameServer` runs a `setInterval(50ms)`
  loop (game.ts ~line 1063). Inside it: catch up sim ticks at fixed `DT = 1/20`,
  route events, then `broadcastSnapshots()`. All game logic and all broadcast
  serialization happen on the one Node main thread. No `worker_threads`, no
  `cluster`, no offloading.
- **Broadcast is O(viewers x neighbors).** `broadcastSnapshots()` (game.ts ~line
  3373) loops every connected session, and for each does a spatial
  `grid.forEachInRadius` interest scan and builds a per-player JSON snapshot. The
  code itself notes the interest scan is "O(viewers x neighbors)" and is "the real
  driver of broadcast cost in a crowd." This is the dominant per-realm cost and it
  grows super-linearly when many players cluster in one spot (a capital city, a
  world boss, a queue).
- **Realm = shard, enforced.** `REALM` comes from `REALM_NAME` (realm.ts). Every
  realm process shares one `DATABASE_URL`. `acquireRealmSingletonLock` takes a
  Postgres advisory lock keyed on the realm name; a second process for the same
  realm throws at boot. So the "one authoritative process per realm" rule is a hard
  invariant, not a convention.
- **Isolation between realms is total.** Characters, friends, guilds, presence, and
  the World Market are all realm-scoped. Two realms are two separate universes that
  happen to share a login database. Character and guild names are globally unique
  across realms (a cross-realm `UNIQUE` constraint).
- **One Postgres, small pools.** `server/db.ts` opens `new Pool({ max: 10 })` per
  process. All realms point at the same database. Persistence is whole-character
  **JSONB** blobs in `characters.state`, autosaved every 30 s and on leave/shutdown.
- **In-memory shared state.** Leaderboards are served from an in-memory cache in
  main.ts (never per-request under load). The World Market is a per-realm JSONB row
  loaded and mutated in process. Presence and all WebSocket sessions live only in
  the owning process's memory. Nothing is replicated; nothing is in Redis or a
  message bus (there is none in the tree).

## 3. The scaling ceilings, in the order you will hit them

### Ceiling 1: single-realm CPU (the real wall)

A realm is one core. The 50 ms loop must finish the sim tick(s) plus the full
broadcast within its budget; the tick profiler and EMA (`tickMsAvg`) exist
precisely because this is the watched number. Because broadcast cost is
O(viewers x neighbors), the ceiling is not a flat "N players" but "N players and
how densely they stack." A few hundred spread out is cheap; a few hundred stacked
on one world boss can blow the frame budget and cause the loop to run long,
skipping ticks (the loop is written to survive this by having one broadcast cover
several catch-up ticks, which is graceful degradation, not more capacity).

You cannot currently add a second process to help one realm. This is the headline
horizontal-scaling gap.

### Ceiling 2: shared Postgres

Every realm shares one database. Today the write pattern is forgiving (batched
30 s autosaves of JSONB blobs, not per-action writes), so the DB is not the first
wall. But it is the shared single point: it is where all realms converge, it is a
single instance in DEPLOY.md (managed Azure Flexible Server, one server), and each
process is capped at 10 pooled connections. As realm count grows, or if save
cadence ever tightens, this becomes the shared bottleneck and the shared blast
radius (DB down = every realm down).

### Ceiling 3: connection and bandwidth per process

All of a realm's WebSocket sockets terminate on its one process. Node can hold
many thousands of sockets, but each tick serializes and pushes a JSON snapshot to
each of them from the same thread that just ran the sim. There is per-IP
connection capping (`MAX_WS_PER_IP_HARD`, default 20) and backpressure handling
(`ws_backpressure.ts`), so the plumbing is thoughtful, but the fan-out work itself
is on the critical path and competes with the sim for the one core.

### Ceiling 4: in-process singletons block multi-process-per-realm

Even if you wanted to run two processes for one realm tomorrow, the leaderboard
cache, the World Market row held in memory, presence, and session tables are all
process-local and assume a single writer. They would diverge or corrupt across two
processes. This is what makes "just run two" impossible without design work, and
it is enforced on purpose by the advisory lock.

## 4. Can it scale horizontally? Yes, with three distinct meanings

It helps to separate three different things people mean by "scale horizontally,"
because this codebase answers them very differently.

1. **More total players / more worlds.** Already solved. Add realms. This is
   linear, cheap, and safe (advisory lock + shared login DB). Good for total
   population growth where players do not need to share one world.

2. **One world bigger than one core.** Not solved, and the hardest. Requires
   either splitting a world across processes by geography (zone sharding) or
   splitting the work of one world across threads/machines (harder). See options
   below.

3. **The stateless edges (REST, auth, static, admin, wiki).** Mostly independent
   of the game loop and much easier to scale, but today they are served by the same
   process for convenience. These can be peeled off and load-balanced with little
   game-logic risk.

## 5. Options to raise each ceiling (cheapest and safest first)

### Tier A: raise the current ceilings without changing the model

These keep "one realm = one process" intact and buy real headroom.

- **Vertical first, deliberately.** More cores does not help one realm's loop
  (single-threaded), but a faster single-core clock and more memory directly raise
  Ceiling 1. Right-size the box to single-thread performance, not core count. Cheap,
  immediate, no code.
- **Split the stateless surfaces off the game process (Ceiling 3 relief).** Serve
  REST auth, static client, `/wiki`, admin dashboard, player-card images, and the
  leaderboard reads from separate horizontally-scaled instances behind the load
  balancer, leaving the game process to do only the game loop and WS. Much of this
  is already read-only or cache-backed. This is the highest value-to-risk change: it
  frees the one core for the sim without touching sim logic.
- **Managed Postgres with read replicas and a pooler (Ceiling 2 relief).** Point
  read-only surfaces (leaderboards, player cards, profile pages, wiki content,
  admin reads) at a read replica; keep authoritative writes on the primary. Put a
  connection pooler (PgBouncer, or the managed equivalent) in front so per-process
  pool sizing stops being a hard wall as realm count grows. Revisit `max: 10` per
  process once a pooler exists.
- **Tighten the broadcast hot path (Ceiling 1 relief, code-level).** The interest
  scan is the driver. Wins that stay within the one-process model: cap or
  distance-tier updates harder in dense crowds (partly done via `isUpdateDue`
  tiers), precompute per-cell viewer sets so the scan is not re-walked per viewer,
  and consider moving snapshot serialization off the main thread into a worker pool
  (the sim stays single-threaded and authoritative; only the JSON encode/fan-out is
  parallelized). This is the single most effective lever for raising per-realm
  population before any sharding.

### Tier B: scale one world past one core

These break the "one process per world" assumption and are genuinely bigger
projects. Pick based on how much a single shared world matters to the product.

- **Zone sharding (recommended if one big world is the goal).** Split a realm's map
  into zones, each owned by its own process (its own `Sim` subset), with a handoff
  protocol at zone borders and a lightweight router that keeps a player's socket
  pointed at the process owning their current zone. Classic-era MMOs did exactly
  this. It fits the existing "authoritative Sim, interest-scoped snapshots" design
  because interest is already spatial. The hard parts: cross-zone visibility at
  borders, entity handoff, and party/raid members split across zones. This is the
  natural next architecture and reuses more of the current code than any other
  option.
- **Separate instanced content onto their own processes.** Dungeons, delves, and
  arenas are self-contained and already isolated in gameplay terms. Running each
  instance (or pools of them) as separate processes offloads a large, spiky chunk of
  simulation from the open-world process without needing full zone sharding. Lower
  risk than open-world sharding and a good first step toward it.
- **Externalize the shared singletons (prerequisite for any multi-process realm).**
  Before two processes can serve one realm, the leaderboard cache, World Market,
  presence, and cross-zone chat must move to shared infrastructure: a cache/message
  layer (Redis or Postgres LISTEN/NOTIFY for pub/sub) so processes see one truth.
  Presence and social broadcast especially need a bus. There is none today, so this
  is net-new infrastructure.

### Tier C: architectural bets (only if the product demands one massive shared world)

- **Authoritative simulation on a thread/process grid** (spatial partition with a
  message bus between partitions). This is the "seamless single world" endgame and a
  large investment. Only justified if the design explicitly wants thousands of
  players in one visible world.
- **Move the RL/headless path onto its own horizontal fleet.** `headless/env_server.ts`
  already reuses the same deterministic Sim with no rendering. Training throughput
  scales by running many independent headless Sims, which is embarrassingly parallel
  and needs no shared world state. This is a separate, easy horizontal axis worth
  calling out: it scales by process count today.

## 6. Concrete scenarios

**Scenario 1: modest growth, players tolerate separate worlds.**
Do nothing structural. Add realms as population grows, keep Postgres managed, and
right-size each realm's box for single-thread speed. This is the current design
working as intended and is genuinely fine up to many realms. First upgrade when
needed: peel the stateless surfaces (Tier A) and add a Postgres read replica.

**Scenario 2: one realm is a hit and its city/world bosses stutter.**
The realm is CPU-bound on broadcast. Order of moves: (1) move stateless surfaces
and reads off the process, (2) optimize the interest scan and move snapshot
serialization to a worker pool, (3) if still saturated, pull instanced content
(dungeons/arenas) onto separate processes. Only after all that does zone sharding
become worth its complexity.

**Scenario 3: the product goal is one large seamless world.**
This requires Tier B/C. Sequence: externalize the singletons onto a bus (Redis or
NOTIFY/LISTEN) first, then instance content off the open-world process, then zone
sharding with border handoff. Budget this as a multi-milestone effort, not a
patch. It is the only path that lets a second machine help one world.

**Scenario 4: database becomes the shared risk.**
Introduce a connection pooler, split reads to replicas, and consider partitioning
the largest tables by realm (character/state, social, moderation) so a hot realm
does not contend with quiet ones. Longer term, a per-realm-group database removes
the single global blast radius at the cost of losing global name uniqueness (a
product decision).

## 7. What to do first (recommended sequence)

1. Split stateless surfaces (REST/auth/static/wiki/admin/leaderboard reads) off the
   game process and load-balance them. Highest value, lowest game-logic risk.
2. Add a Postgres pooler plus a read replica; route reads to the replica. Relieves
   the shared DB before it is a wall.
3. Optimize the broadcast path and move snapshot serialization to a worker pool.
   Directly raises per-realm population, no sharding required.
4. Pull instanced content (dungeons/delves/arenas) onto separate processes.
   Offloads spiky simulation and is a stepping stone to sharding.
5. Only if a single seamless world is a product goal: externalize the in-process
   singletons onto a bus, then implement zone sharding with border handoff.

Steps 1 to 4 keep the "one authoritative Sim per world" invariant intact and are
mostly infrastructure and hot-path work. Step 5 is the real architectural change
and should not start until 1 to 4 are exhausted.

## 8. One-line verdict per axis

- Total players across many worlds: scales now, linearly, by adding realms.
- Stateless edges (auth/static/reads): easy to scale, just not separated yet.
- A single world beyond one core: does not scale today; needs zone sharding or an
  instance/thread split, plus externalized shared state.
- Database: single shared instance and single blast radius; relieve with
  pooler + replicas before it becomes the wall.
- RL/headless training: already embarrassingly parallel by process count.

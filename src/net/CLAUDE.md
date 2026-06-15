<!-- src/net/ — the online client. Architecture, IWorld seam, and dependency
     rules live in ROOT + src/ CLAUDE.md — don't repeat them; this file covers
     only the wire protocol + REST auth that live here. -->

# src/net/ — online client (`ClientWorld` + REST `Api`)

`online.ts` is the whole area: a REST `Api` (auth, characters, realms, leaderboard)
and `ClientWorld implements IWorld`, which mirrors authoritative server snapshots
and sends commands over one WebSocket. **PRESENTATION ONLY** — it never computes
outcomes (combat, loot, quest credit, talents), only reflects server state. The
client even runs `abilitiesKnownAt` / `computeQuestState` locally, but purely to
*display* what the server already decided; the server re-validates everything.

## Wire protocol — MUST stay in lockstep with `server/game.ts`
There is no `server/CLAUDE.md`; read `server/game.ts` directly when touching this.
- **Server → client** (handled in `onMessage`): `hello` (pid, seed, realm) ·
  `snap` · `events` (pushed to `eventQueue`, drained by `drainEvents`) · `social`
  (sets `socialInfo`, flips `socialDirty`) · `error` (disconnect).
- **Client → server**: `auth` (`buildWebSocketAuthMessage`) · `input` (20 Hz move
  intent via `sendInput`, `setInterval` 50 ms) · `cmd` (every IWorld action via the
  private `cmd()` helper).
- **Snapshot decode** (`applySnapshot`): `snap.ents` (others) + `snap.self`
  (extended state) go through `applyWire`; `snap.keep` = ids alive-but-unchanged,
  protected from the prune at the end. Encoder is server `wireEntity` — fields are
  terse (`x/y/z/f/hp/mhp/k/tid/nm/lv/auras…`); **self adds `res/cds/inv/qlog/tal/
  party/trade/duel/arena/market…`** Keep field names byte-identical on both sides.
- **Delta invariant:** the server OMITS heavy/unchanged fields (`cds`, `inv`,
  `equip`, `qlog`, `qdone`, `tal`, `stats`, `party`…). Guard every one with
  `if (s.X !== undefined)` and keep the prior value otherwise — do NOT default a
  missing field to empty, that wipes local state. (`tests/snapshots.test.ts`.)
- **Lite vs full:** identity fields (`k`, `tid`, `nm`…) ride only in "full" records
  (`hasIdentity = w.k !== undefined`); a lite record for an unknown id is skipped.
  This split is what `tests/bandwidth.test.ts` measures — preserve it.
- **Interest scoping** mirrors the server's ~120 yd radius (`NPC_INTEREST_RADIUS`);
  entities not in `ents`/`keep` are pruned each snapshot.

## Auth & connect flow
REST first: `Api.login`/`register` → bearer `token`; `Api.characters()` lists the
realm's chars; `Api.realms()`/`setRealm(url)` pick a realm origin (`base`). Then
`new ClientWorld(token, characterId, cls, base)` opens the WS (realm origin, else
page host), sends `auth` on open, waits for `hello`. No auto-reconnect — `onclose`
clears the send timer and fires `onDisconnect`; the app re-creates the world.

## Adding a networked action
1. Add the method to `IWorld` (`world_api.ts`). 2. Implement here as a one-line
`this.cmd({ cmd: 'foo', … })`. 3. Add the matching `cmd === 'foo'` handler in
`server/game.ts` and surface results via an `events` frame or a `self` snapshot
field. 4. If it returns state, mirror that field in `applySnapshot` (delta-guarded)
and add it to the snapshot test's expected-field lists. Also implement it in the
offline `Sim` so both worlds satisfy `IWorld`.

## Never
- Never mutate game state authoritatively here or "predict" an outcome. The only
  sanctioned optimism is the trivial local UI nudges already present
  (`targetEntity` setting `targetId`; `pendingQuestCommands`) — keep that scope.
- Never read `Math.random`/timing into *gameplay*; `performance.now` here is for
  render interpolation only (`lastSnapAt`, per-entity `netInterval`), not logic.

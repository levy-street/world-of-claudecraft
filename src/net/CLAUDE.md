<!-- src/net/: the online client. Architecture, IWorld seam, and dependency
     rules live in ROOT + src/ CLAUDE.md, don't repeat them; this file covers
     only the wire protocol + REST auth that live here. -->

# src/net/ : online client (`ClientWorld` + REST `Api`)

`online.ts` is the core: a REST `Api` (auth, characters, realms, leaderboard, wallet
linking) and `ClientWorld implements IWorld`, which mirrors authoritative server
snapshots and sends commands over one WebSocket. **PRESENTATION ONLY**, it never
computes outcomes (combat, loot, quest credit, talents), only reflects server state.
The client even runs `abilitiesKnownAt` / `computeQuestState` locally, but purely to
*display* what the server already decided; the server re-validates everything.
`wallet.ts` is a small sibling: Wallet-Standard Solana connect in the browser, with
no `sim/` dependency (the account-to-wallet link is verified server-side).

## Wire protocol: MUST stay in lockstep with `server/game.ts`
See `server/CLAUDE.md` for server conventions; read `server/game.ts` directly for the exact wire encoding.
- **Server to client** (handled in `onMessage`): `hello` (pid, seed, realm,
  `softWords`) · `snap` · `events` (pushed to `eventQueue`, drained by
  `drainEvents`) · `social` (sets `socialInfo`, flips `socialDirty`) · `socialpos`
  (in-place friend/guildmate position refresh) · `censor` (live soft-profanity
  word-list update) · `error` (disconnect).
- **Client to server**: `auth` (`buildWebSocketAuthMessage`) · `input` (20 Hz move
  intent via `sendInput`, `setInterval` 50 ms) · `cmd` (every IWorld action via the
  private `cmd()` helper).
- **Snapshot decode** (`applySnapshot`): `snap.ents` (others) + `snap.self`
  (extended state) go through `applyWire`; `snap.keep` = ids alive-but-unchanged,
  protected from the prune at the end. Encoder is server `wireEntity`; fields are
  terse (`x/y/z/f/hp/mhp/k/tid/nm/lv/auras…`); **self adds `res/cds/inv/qlog/tal/
  party/trade/duel/arena/market…`** Keep field names byte-identical on both sides.
- **Delta invariant:** the server OMITS heavy/unchanged fields (`cds`, `inv`,
  `equip`, `qlog`, `qdone`, `tal`, `stats`, `party`…). Guard every one with
  `if (s.X !== undefined)` and keep the prior value otherwise; do NOT default a
  missing field to empty, that wipes local state. The full delta-key set (the 25
  `maybe(...)` keys the encoder may omit) and the terse-key to IWorld-name mapping are
  pinned by `ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` in `tests/snapshots.test.ts` (W0a).
- **Lite vs full:** identity fields (`k`, `tid`, `nm`…) ride only in "full" records
  (`hasIdentity = w.k !== undefined`); a lite record for an unknown id is skipped.
  This split is what `tests/bandwidth.test.ts` measures; preserve it.
- **Interest scoping** mirrors the server's distance tiers: players and pets enter at
  `INTEREST_RADIUS` and drop at `INTEREST_DROP_RADIUS`, NPCs use the wider
  `NPC_INTEREST_RADIUS`/`NPC_DROP_RADIUS`, with enter/drop hysteresis to stop boundary
  churn. Entities not in `ents`/`keep` are pruned each snapshot.

## Auth & connect flow
REST first: `Api.login`/`register` to bearer `token`; `Api.characters()` lists the
realm's chars; `Api.realms()`/`setRealm(url)` pick a realm origin (`base`). Then
`new ClientWorld(token, characterId, cls, base)` opens the WS (realm origin, else
page host), sends `auth` on open, waits for `hello`. No auto-reconnect; `onclose`
clears the send timer and fires `onDisconnect`; the app re-creates the world.

## Adding a networked action
1. Add the method to the owning FACET interface under `src/world_api/<facet>.ts`
(a combat action to `src/world_api/combat.ts`, a market action to `market.ts`, ...);
the aggregate `IWorld` in `src/world_api.ts` re-exports it via `extends`, so render/ui
see it unchanged. Add the wire token to the shared `COMMAND_NAMES` table in
`src/world_api.ts` (append-only: the wire string IS the protocol, never rename or
remove one). 2. Implement here as a one-line `this.cmd({ cmd: 'foo', ... })`; the
`cmd()` send path is typed to `ClientCommand`, so a token missing from the table is a
compile error. 3. Add the matching `case 'foo':` in `server/game.ts` `dispatchMessage`
and surface results via an `events` frame or a `self` snapshot field. 4. If it returns
state, mirror that field in `applySnapshot` (delta-guarded) and add it to the snapshot
test's expected-field lists, plus the `ALL_DELTA_KEYS` registry (W0a). Also implement
it in the offline `Sim` so both worlds satisfy `IWorld`. The send-set subset-of-dispatch
lockstep is pinned by `tests/command_schema.test.ts` (W0b).

## i18n: carries text but does NOT translate it
`online.ts` imports no `t()` and renders no UI; its only player-facing text is connection
failure, kept as stable English that `main.ts` re-localizes.
- **Disconnect literals (byte-identical gotcha):** the two reasons it emits,
  `'Connection to the server was lost.'` (`onclose`) and `'rejected by server'` (the
  `error`-frame fallback), flow through `onDisconnect(reason)` and map in
  `userFacingApiError` to `t('loading.connectionLost')`/`t('loading.connectionRejected')`.
  Keep these literals byte-identical here AND in those match arms in the SAME change (the
  compare is on the lowercased raw literal, not the rendered `t()` value).
- Server `error`-frame text (`msg.error`) and REST `data.error` pass through verbatim and
  are localized in `main.ts` (`userFacingApiError`, plus `tServer` for moderation/throttle);
  never hard-code your own copy here. The `` `request failed (${res.status})` `` fallback
  stays English by design (the "diagnostic errors stay English" rule).

## Never
- Never mutate game state authoritatively here or "predict" an outcome. The only
  sanctioned optimism is the trivial local UI nudges already present
  (`targetEntity` setting `targetId`; `pendingQuestCommands`); keep that scope.
- Never read `Math.random`/timing into *gameplay*; `performance.now` here is for
  render interpolation only (`lastSnapAt`, per-entity `netInterval`), not logic.

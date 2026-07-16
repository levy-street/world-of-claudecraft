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

## Sibling modules (module-first)
New net logic that does not need `ClientWorld`'s private socket state lands as a
tested sibling module here, never as more methods on `online.ts`. The live set:
- `char_sort.ts` / `charselect_action.ts`: pure, i18n-KEY-returning character-select
  cores; `charselect_action` is the single source of truth for BOTH the Enter World
  button's label/enabled state AND its enter-vs-takeover click routing, so the two
  can never drift (tests: `tests/char_sort.test.ts`, `tests/charselect_action.test.ts`).
- `reconnect_policy.ts`: pure decision on whether an `error` frame during a reconnect
  is fatal or one of the two bounded transient classes (see Reconnect below).
- `backoff.ts`: pure full-jitter reconnect schedule (`computeBackoffDelay`: 0.5x to
  1.5x of the exponential step, clamped at the max delay AFTER jitter, rng injected
  so tests pin exact delays; `tests/backoff.test.ts`).
- `realm_population.ts`: pure, i18n-KEY-returning realm-list population banding core
  (Low/Medium/High/Full labels plus tooltip keys from online count vs the advertised
  cap; `tests/realm_population.test.ts`).
- `native_*.ts`: the Capacitor native-app seam (Apple/Discord sign-in, device
  attestation, update check), gated on `NATIVE_APP`; each has a `tests/native_*.test.ts`.
- `wallet.ts`: Wallet-Standard Solana connect in the browser, no `sim/` dependency
  (the account-to-wallet link is verified server-side).

## Wire protocol: MUST stay in lockstep with `server/game.ts`
See `server/CLAUDE.md` for server conventions; read `server/game.ts` directly for the exact wire encoding.
- **Server to client**: the live frame list is the `msg.t` branches in `onMessage`
  (`online.ts`). Semantics worth knowing: `hello` carries pid/seed/realm and resets
  a reconnected transport; `events` push to `eventQueue` (drained by `drainEvents`);
  `social` sets `socialInfo` and flips `socialDirty`; `censor` live-updates the
  soft-profanity word list; an `error` frame ends the session (subject to
  `reconnect_policy.ts`).
- **Client to server**: `auth` (`buildWebSocketAuthMessage`), `input` (20 Hz move
  intent via `sendInput`, `setInterval` 50 ms), `cmd` (every IWorld action via the
  private `cmd()` helper).
- **Snapshot decode** (`applySnapshot`): `snap.ents` (others) + `snap.self`
  (extended state) go through `applyWire`; `snap.keep` = ids alive-but-unchanged,
  protected from the prune at the end. Encoder is server `wireEntity`; fields are
  terse (`x/y/z/f/hp/mhp/k/tid/nm/lv/auras...`); **self adds `res/cds/inv/qlog/tal/
  party/trade/duel/arena/market...`** Keep field names byte-identical on both sides.
- **Delta invariant:** the server OMITS heavy/unchanged fields (`cds`, `inv`,
  `equip`, `qlog`, `qdone`, `tal`, `stats`, `party`...). Guard every one with
  `if (s.X !== undefined)` and keep the prior value otherwise; do NOT default a
  missing field to empty, that wipes local state. The full delta-key set the encoder
  may omit and the terse-key to IWorld-name mapping are pinned by `ALL_DELTA_KEYS` +
  `TERSE_TO_IWORLD` in `tests/snapshots.test.ts` (W0a).
- **Lite vs full:** identity fields (`k`, `tid`, `nm`...) ride only in "full" records
  (`hasIdentity = w.k !== undefined`); a lite record for an unknown id is skipped.
  This split is what `tests/bandwidth.test.ts` measures; preserve it.
- **Interest scoping** mirrors the server's distance tiers: players and pets enter at
  `INTEREST_RADIUS` and drop at `INTEREST_DROP_RADIUS`, NPCs use the wider
  `NPC_INTEREST_RADIUS`/`NPC_DROP_RADIUS` (all four constants live in
  `server/game.ts`), with enter/drop hysteresis to stop boundary
  churn. Entities not in `ents`/`keep` are pruned each snapshot.

## Auth & connect flow
REST first: `Api.login`/`register` to bearer `token`; `Api.characters()` lists the
realm's chars; `Api.realms()`/`setRealm(url)` pick a realm origin (`base`). Then
`new ClientWorld(token, characterId, cls, base)` opens the WS (realm origin, else
page host), sends `auth` on open, waits for `hello`.

## Reconnect and session resume
An unexpectedly dropped socket auto-reconnects with jittered exponential backoff
(`computeBackoffDelay` in `backoff.ts`: `RECONNECT_BASE_DELAY_MS` doubling to the
`RECONNECT_MAX_DELAY_MS` cap with 0.5x to 1.5x full jitter, up to
`RECONNECT_MAX_ATTEMPTS`; constants + rationale in `online.ts`). The jitter exists so
a server restart never gets the whole realm reconnecting in lockstep; do not remove
it or reintroduce a fixed schedule. The server holds the
character in-world (linkdead) for five minutes and a re-auth resumes the session;
past the grace a successful auth is simply a fresh join from the last save, so
retrying stays correct at any point. `onConnectionLost` fires per drop,
`onReconnected` on the post-reconnect `hello` (which resets input acking and rebuilds
the mirror from an empty interest set); `onDisconnect` fires only when the session is
over for good (retries exhausted, or a fatal server `error` frame).
- `reconnect_policy.ts` tolerates a bounded run of two transient rejection classes,
  each with its own counter reset on the post-reconnect `hello`: `'character already
  in world'` (a black-holed drop leaves the old socket counted as live until the
  server keepalive sweep notices; `RECONNECT_CONFLICT_ERROR`, wire contract with
  `server/linkdead.ts` `planJoin`) and `'authentication timed out'` (a slow or
  browning-out database rejects the handshake retryably; `RECONNECT_TIMEOUT_ERROR`,
  byte-identical to `server/ws_auth.ts` `WS_AUTH_ERROR.authTimedOut`, bounded by
  `MAX_TIMEOUT_REJECTIONS`). Every other `error` frame stays FATAL by default; the
  capacity refusals (`'realm is full'`, `'too many connections from your network'`)
  rely on that default so a full realm is never hammered by auto-retry. Keep every
  one of these literals byte-identical on both sides in the same change.
- A `visibilitychange` handler schedules a near-immediate retry (a 0 to 1000 ms
  random spread in the same `reconnectTimer` slot, so foregrounded tabs do not
  stampede together) when a suspended mobile tab foregrounds, and drives the close
  path itself when `onclose` was never delivered (the zombie-socket case).
  `sendLogout()` signals a deliberate logout so the server skips the linkdead grace;
  call it before a page reload.
Tests: `tests/linkdead.test.ts`, `tests/net_online_visibility_reconnect.test.ts`.

## Adding a networked action
1. Add the method to the owning FACET interface under `src/world_api/<facet>.ts`
(a combat action to `src/world_api/combat.ts`, a market action to `market.ts`, ...);
the aggregate `IWorld` in `src/world_api.ts` re-exports it via `extends`, so render/ui
see it unchanged. Add the wire token to the shared `COMMAND_NAMES` table in
`src/world_api.ts` (append-only: the wire string IS the protocol, never rename or
remove one), tag it in `COMMAND_FACETS`, and update the `IWORLD_MEMBERS` pin in
`tests/world_api_parity.test.ts` (W0c), all in the same change (full recipe:
`src/world_api/CLAUDE.md`). 2. Implement here as a one-line
`this.cmd({ cmd: 'foo', ... })`; the `cmd()` send path is typed to `ClientCommand`,
so a token missing from the table is a compile error. 3. Add the matching
`case 'foo':` in `server/game.ts` `dispatchMessage` and surface results via an
`events` frame or a `self` snapshot field. 4. If it returns state, mirror that field
in `applySnapshot` (delta-guarded) and add it to the snapshot test's expected-field
lists, plus the `ALL_DELTA_KEYS` registry (W0a). Also implement it in the offline
`Sim` so both worlds satisfy `IWorld`. The send-set subset-of-dispatch lockstep is
pinned by `tests/command_schema.test.ts` (W0b); the facet tags by
`tests/command_facets.test.ts` (W6).

## i18n: carries text but does NOT translate it
`online.ts` imports no `t()` and renders no UI; its only player-facing text is connection
failure, kept as stable English that `main.ts` re-localizes.
- **Disconnect literals (byte-identical gotcha):** the two reasons it emits,
  `'Connection to the server was lost.'` (retries exhausted) and `'rejected by server'`
  (the `error`-frame fallback), flow through `onDisconnect(reason)` and map in
  `userFacingApiError` to `t('loading.connectionLost')`/`t('loading.connectionRejected')`.
  Keep these literals byte-identical here AND in those match arms in the SAME change (the
  compare is on the lowercased raw literal, not the rendered `t()` value).
- Server `error`-frame text (`msg.error`) and REST `data.error` pass through verbatim and
  are localized in `main.ts` (`userFacingApiError`, plus `tServer` for moderation/throttle);
  never hard-code your own copy here. The `` `request failed (${res.status})` `` fallback
  stays English by design (the "diagnostic errors stay English" rule).

## Never
- Never mutate game state authoritatively here or "predict" an OUTCOME: no
  client-side anticipation of combat, casts, resources, loot, aggro, or anything
  else the server resolves. The only sanctioned optimism inside `net/` is the
  trivial local UI nudges already present (`targetEntity` setting `targetId`;
  `pendingQuestCommands`); keep that scope.
- **Display-layer locomotion anticipation is the one sanctioned prediction**, and
  it lives OUTSIDE `net/` (`src/render/self_motion.ts`): a visual-only pose for
  the LOCAL player that is (a) bounded by measured latency with a hard cap,
  (b) always blending toward the authoritative server pose, (c) never written
  into `ClientWorld` mirrored state or any `IWorld` read that logic consumes
  (targeting, range checks, quest triggers, and interest all use authoritative
  positions), and (d) never affects what is sent to the server. Widening any of
  those four constraints is a maintainer decision, see
  `docs/online-movement-latency.md`.
- **The heading is NOT predicted, it is client-authoritative input.** The facing
  channel (`input.facing`, applied outright by the server, corpse-guard only)
  has always been client-driven for mouselook; `src/game/keyboard_turn_facing.ts`
  streams keyboard turns on the SAME channel (with the turn flags zeroed on the
  wire, except the engage-edge frame that still fires the server's manual-turn
  behaviors) so the server never integrates a turn a round trip late. That is
  real input, not anticipation: constraint (d) above does not apply to it, and
  its authority stays exactly what mouselook already had.
- Never read `Math.random`/timing into *gameplay*; `performance.now` here is for
  render interpolation only (`lastSnapAt`, per-entity `netInterval`), not logic.

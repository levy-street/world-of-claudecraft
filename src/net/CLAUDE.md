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
tested sibling module here, never as more methods on `online.ts`. Exemplars
(enumerate the live set: `ls src/net`):
- `char_sort.ts` / `charselect_action.ts`: pure, i18n-KEY-returning character-select
  cores; `charselect_action` is the single source of truth for BOTH the Enter World
  button's label/enabled state AND its enter-vs-takeover click routing, so the two
  can never drift (tests: `tests/char_sort.test.ts`, `tests/charselect_action.test.ts`).
- `reconnect_policy.ts`: pure decision on whether an `error` frame during a reconnect
  is fatal or one of the two bounded transient classes (see Reconnect below).
- `backoff.ts`: pure full-jitter reconnect schedule (`computeBackoffDelay`: 0.5x to
  1.5x of the exponential step, clamped at the max delay AFTER jitter, rng injected
  so tests pin exact delays; `tests/backoff.test.ts`).
- `entry_watch.ts`: `watchWorldEntry`, the world-entry poll loop `main.ts`'s
  `enterWorld` drives: polls a connecting world for readiness, gives up after
  `ENTRY_TIMEOUT_MS` with no sign of life, and exposes `noteActivity()` so a
  legitimate transient-rejection retry (see Reconnect below) pushes that deadline
  out instead of being killed mid-backoff (`tests/entry_watch.test.ts`).
- `realm_population.ts`: pure, i18n-KEY-returning realm-list population banding core
  (Low/Medium/High/Full labels plus tooltip keys from online count vs the advertised
  cap; `tests/realm_population.test.ts`).
- `native_*.ts`: the Capacitor native-app seam (Apple/Discord sign-in, device
  attestation, update check), gated on `NATIVE_APP`; covered by the
  `tests/native_*.test.ts` suites.
- Wire-decode siblings extracted from `online.ts`, all following the one decode idiom
  (DOM-free, ClientWorld-free, every field re-validated, a malformed row DROPPED rather
  than rendered so a version-skewed frame never puts `undefined` in a sentence):
  `snapshot_timer_wire.ts` (stable cooldown-timer decode; UNKNOWN version markers are
  isolated from both the legacy and the stable arm, so a future server can never make an
  older client reinterpret fields it does not understand), `guild_bank_log_wire.ts` (the
  `gbanklog` frame; the renderable-op vocabulary is a CLOSED allowlist deliberately
  restated on this side of the wire, so server-internal diagnostic ops could never render
  as guild history even from a regressed server), `account_cosmetics_wire.ts`
  (`self.cosmetics`; malformed input yields all-empty defaults, never a throw).
- `net_pipeline_stats.ts`: always-on snapshot-pipeline counters (parse/apply timing,
  approx bytes, raw inter-arrival gap). Clock-injected (it never reads `performance.now`
  itself) and deliberately bucket-agnostic: `src/net` never imports `src/game`;
  `src/main.ts` is the junction that drains the digest into the perf monitor once per
  animation frame.
- `quest_state_optimistic.ts`: the pure resolution behind the `pendingQuestCommands`
  optimism (scope in Never, below): while a `turnin` is in flight, prerequisite checks
  treat that quest as done, so a follow-up quest appears in the same gossip re-render
  instead of a snapshot later (issue 1667 rationale in its header).
- Wallet/economy cluster (`wallet*.ts`, `desktop_wallet_*.ts`,
  `mobile_wallet_deeplink.ts`, `stripe_checkout.ts`, `economy_sdk.ts`,
  `woc_market_sdk.ts`, `seeker_entitlement_sync.ts`, `discord_onboarding_gate.ts`):
  non-custodial Solana linking plus the CLAUDIUM economy client and the $WOC
  Exchange client (`woc_market_sdk.ts`, typed and never-throws like
  `economy_sdk.ts`; marketplace bond and settlement transactions are
  service-built and signed through the same Wallet Standard path as the
  Claudium purchase, config-off behind `WOC_MARKET_ENABLED`; a failed call's
  `WocMarketFail` carries the parsed error body as `params` so parametric
  codes such as `woc_market.claim_cooldown` can render their values, the
  `ApiError.params` convention). Wallet-bridge throws are classified for
  players by `src/ui/wallet_bridge_reason_text.ts`, whose byte-exact message
  map is drift-pinned against this directory's sources (plus the mobile
  launcher's and the desktop hand-off's throw sites, incl. the two in
  `src/main.ts`): rewording a bridge throw string updates that map in the
  same change. The contracts: the account-to-wallet LINK is always challenge+signature
  verified server-side (`server/wallet.ts`), nothing here is imported by `src/sim/`, and
  `economy_sdk.ts` is same-origin only (the game server's `/api/claudium/*` proxy, never
  the economy service) and NEVER throws into render: every failure resolves to the typed
  unavailable state the disabled UI already renders. Cross-host handoffs: the desktop
  shell mints a one-time code and the system browser completes connect/sign on the
  separate `wallet-handoff.html` entry (`wallet_handoff_browser.ts` +
  `desktop_wallet_handoff.ts`, results riding back through the `/api/desktop-wallet/*`
  routes); mobile web deep-links to a wallet app with an encrypted return channel
  (`mobile_wallet_deeplink.ts`, re-checked on return by `wallet_resume.ts`'s
  visibility/focus handlers); `discord_onboarding_gate.ts` is the shared predicate that
  keeps a just-completed Discord login on the `/desktop-login` handoff page from racing
  into loading the game. Only the enter-online call site in `src/main.ts` consumes it
  today; the resume guard there still inlines its own equivalent checks, so a change to
  the predicate must keep that inline arm aligned (or migrate it onto the predicate).
- `resume_play.ts`: the mobile WebView resume marker (`RESUME_KEY`), stamped while
  in-world and consumed by `src/main.ts` on boot so an OS-evicted WebView reload
  re-enters the world instead of landing on home; freshness-bounded
  (`RESUME_MAX_AGE_MS`), realm-scoped, self-disarming after `MAX_RESUME_ATTEMPTS`,
  cleared on deliberate logout and session end (`tests/resume_play.test.ts`).

## Wire protocol: MUST stay in lockstep with `server/game.ts`
See `server/CLAUDE.md` for server conventions; read `server/game.ts` directly for the exact wire encoding.
- **Server to client**: the live frame list is the `msg.t` branches in `onMessage`
  (`online.ts`). Semantics worth knowing: `hello` carries pid/seed/realm and resets
  a reconnected transport; `events` push to `eventQueue` (drained by `drainEvents`);
  `social` sets `socialInfo` and flips `socialDirty`; `censor` live-updates the
  soft-profanity word list; an `error` frame ends the session (subject to
  `reconnect_policy.ts`).
- **Client to server**: versioned world auth (`ONLINE_WORLD_AUTH_TYPE`, built by
  `buildWebSocketAuthMessage`), `input` (move intent via
  `sendInput`: an unconditional interval timer plus a changed-only gated flush; the
  cadence constants and gate predicate live in `input_send_cadence.ts`, kept in
  lockstep with the server contract by `tests/input_cadence_model.test.ts`), `cmd`
  (every IWorld action via the private `cmd()` helper).
- **Snapshot decode** (`applySnapshot`): `snap.ents` (others) + `snap.self`
  (extended state) go through `applyWire`; `snap.keep` = ids alive-but-unchanged,
  protected from the prune at the end. Encoder is server `wireEntity`; fields are
  terse (`x/y/z/f/hp/mhp/k/tid/nm/lv/auras...`); **self adds `res/cds/inv/qlog/tal/
  party/trade/duel/arena/market...`** Keep field names byte-identical on both sides.
  `applySnapshot` is the spine, not the whole decode story: field-family decodes live
  in the wire-decode siblings above (`snapshot_timer_wire.ts`,
  `account_cosmetics_wire.ts`, `guild_bank_log_wire.ts`); a new decode block is a new
  sibling, never more inline code here.
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
The REST-login-then-WS narrative reads straight from `online.ts`; the one contract worth
pinning here: the WS open sends the current `ONLINE_WORLD_AUTH_TYPE` discriminator, and
old or future world-layout epochs fail closed BEFORE character admission.

## Reconnect and session resume
An unexpectedly dropped socket auto-reconnects with jittered exponential backoff
(`computeBackoffDelay` in `backoff.ts`: `RECONNECT_BASE_DELAY_MS` doubling to the
`RECONNECT_MAX_DELAY_MS` cap with 0.5x to 1.5x full jitter, up to
`RECONNECT_MAX_ATTEMPTS`; constants + rationale in `online.ts`). The jitter exists so
a server restart never gets the whole realm reconnecting in lockstep; do not remove
it or reintroduce a fixed schedule. The server holds the
character in-world (linkdead) for five minutes and a re-auth resumes the session;
past the grace a successful auth is simply a fresh join from the last save, so
retrying stays correct at any point. `onConnectionLost` fires per drop with
`(attempt, maxAttempts, nextRetryAtMs)` so the reconnect overlay (`src/ui/reconnect_overlay.ts`)
can show live attempt/countdown feedback instead of a static string (countdown math lives in
the pure `src/ui/reconnect_status_core.ts`, owned by `ui/` since it is consumed solely by the
overlay); `onReconnected` fires on the post-reconnect `hello` (which
resets input acking and rebuilds
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
  **The tolerance applies to the very FIRST join attempt a `ClientWorld` makes, not
  only a mid-session auto-reconnect** (`isTransientReconnectRejection`/
  `isTransientTimeoutRejection` take no `reconnectAttempts` argument): a char-select
  "Enter World" click, or a page reload after a client-side bug, lands in the exact
  same "server has not yet noticed the old socket died" window a later drop does,
  since the roster's `online` flag that routed the click can lag a real drop by
  seconds. The deliberate "this character is actively played elsewhere" case stays
  fast and explicit through its own UI (the char-select Take Over button + confirm,
  `takeoverCharacter`), which never reaches this rejection at all. `main.ts`'s
  `enterWorld` entry poll cooperates via `entry_watch.ts` (`watchWorldEntry`, the
  poll loop + dead-time budget extracted so the boot coordinator only wires
  callbacks): its `noteActivity()` is called on every `onConnectionLost` tick, so
  an active, visibly-retrying first attempt is never killed out from under itself
  by the flat "nothing ever responded" timeout.
- A `visibilitychange` handler schedules a near-immediate retry (a 0 to 1000 ms
  random spread in the same `reconnectTimer` slot, so foregrounded tabs do not
  stampede together) when a suspended mobile tab foregrounds, and drives the close
  path itself when `onclose` was never delivered (the zombie-socket case).
  `sendLogout()` signals a deliberate logout so the server skips the linkdead grace;
  call it before a page reload.
Tests: `tests/linkdead.test.ts`, `tests/net_online_visibility_reconnect.test.ts`,
`tests/entry_watch.test.ts`.
A reload instead of an in-socket reconnect (the mobile WebView eviction case) is
handled by `resume_play.ts`, above.

## Adding a networked action
1. Do the seam step first, owned by `src/world_api/CLAUDE.md`: facet member,
`COMMAND_NAMES` wire token (append-only: the wire string IS the protocol, never rename
or remove one), `COMMAND_FACETS` tag, and the `IWORLD_MEMBERS` pin (W0c), all in the
same change. 2. Implement here as a one-line
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
- **Disconnect literals (byte-identical gotcha):** its ordinary local reasons include
  `'Connection to the server was lost.'` (retries exhausted) and `'rejected by server'`
  (the `error`-frame fallback), flow through `onDisconnect(reason)` and map in
  `userFacingApiError` to `t('loading.connectionLost')`/`t('loading.connectionRejected')`.
  The server's flood-kick reason `'message rate exceeded'` (`MSG_RATE_KICK_REASON` in
  `server/msg_rate_limit.ts`) rides the same `error`-frame path verbatim and maps to
  `t('loading.messageRateExceeded')`; it is deliberately session-fatal (no
  `reconnect_policy.ts` transient arm: an immediately reconnecting flooder re-floods), and
  its server-to-matcher lockstep is source-pinned by `tests/localization_fixes.test.ts`.
  Keep these literals byte-identical here AND in those match arms in the SAME change (the
  compare is on the lowercased raw literal, not the rendered `t()` value).
- Server `error`-frame text (`msg.error`) and REST `data.error` pass through verbatim and
  are localized in `main.ts` (`userFacingApiError`, plus `tServer` for moderation/throttle);
  never hard-code your own copy here. One handshake-only exception is deliberate: an old server
  rejects `ONLINE_WORLD_AUTH_TYPE` with `authentication required`, which `ClientWorld` upgrades
  to the direction-neutral incompatible-world reason before `onDisconnect`; an established
  session's same literal remains untouched. The `` `request failed (${res.status})` `` fallback
  stays English by design (the "diagnostic errors stay English" rule).

## Never
- Never mutate game state authoritatively here or "predict" an OUTCOME: no
  client-side anticipation of combat, casts, resources, loot, aggro, or anything
  else the server resolves. The only sanctioned optimism inside `net/` is the
  trivial local UI nudges already present (`targetEntity` setting `targetId`,
  shielded from stale in-flight snapshots by `pendingTargetEcho`;
  `pendingQuestCommands`, whose resolution logic is the pure
  `quest_state_optimistic.ts`); keep that scope. Both follow the same
  reconcile-on-snapshot contract: display-only, and the server's value always
  wins within a bounded window (`tests/target_echo_client.test.ts` pins the
  target one).
- **Local-player movement prediction is the one sanctioned prediction**, and it
  lives OUTSIDE `net/` (`src/render/self_prediction.ts` + `self_prediction_core.ts`
  on movement wire v2; design authority `docs/design/movement-reconciliation.md`):
  the drawn pose is the shared kernel stepped over the SAME per-tick input
  frames the client actually sent, reconciled exact-match against the acked
  authoritative pose (`ackCt` + `rpx/rpy/rpz/rpf`). Its constraints: (a) prediction
  state is never written into `ClientWorld` mirrored state or any `IWorld` read
  that logic consumes (targeting, range checks, quest triggers, and interest
  all use authoritative positions); (b) the drawn pose reflects only input that
  is really on the wire, never an outcome guess; (c) corrections exist only on
  server override epochs (`ovE`/`ovA`) and genuine reconcile mismatches, and
  the display absorbs them through the handoff offset bounded by
  `MAX_SELF_REWIND_YD_PER_SEC`; (d) the feel bar is
  `tests/movement_latency_baseline.test.ts` in strict mode, and any change here
  must keep it green. Changing this model is a maintainer decision. The legacy
  display extrapolator (`src/render/self_motion.ts`, leash + servo + block
  episode, pinned by `tests/self_motion.test.ts`) is only the mid-deploy v1
  fallback under its original latency-cap constraints. Both the v2 exact-match
  predictor and the v1 fallback use the per-`ClientWorld` `riftCollisionToken`
  registered on `riftState` for rift wall resolution, and v1 also strips and
  reapplies the raised-tier lift via `self_motion_rift_lift.ts`. Delves stay
  excluded because their portcullis clamps are not mirrored client-side. On v2,
  gated states and `?nopredict` use the plain interpolated fallback in
  `src/render/self_render_position_core.ts`, with the rewind-clamped handoff.
  The legacy extrapolator is deleted when v1 is retired, not before.
- **The heading is NOT predicted, it is client-authoritative input.** The facing
  channel (`input.facing`, applied outright when the player may turn)
  has always been client-driven for mouselook; `src/game/keyboard_turn_facing.ts`
  streams keyboard turns on the SAME channel (with the turn flags zeroed on the
  wire, except the engage-edge frame that still fires the server's manual-turn
  behaviors) so the server never integrates a turn a round trip late. That is
  real input, not anticipation: constraint (d) above does not apply to it, and
  its authority stays exactly what mouselook already had. A keyboard turn's
  release heading remains wire-owned until its input sequence is acknowledged,
  preventing a rounded snapshot from masquerading as an applied final heading.
- Never read `Math.random`/timing into *gameplay*; `performance.now` here is for
  render interpolation only (`lastSnapAt`, per-entity `netInterval`), not logic.

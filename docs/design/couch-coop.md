# Couch Co-Op: shared-screen play for up to 4 local players

Status: design approved for implementation (feat/couch-coop).

## Goal

Families play together on one screen: one machine, one camera, up to 4 players.
Works in all three hosting modes the project already has:

- **Offline**: Play Offline, everyone shares the one local `Sim`.
- **Online, same account**: 2-4 characters from one account join the realm
  together from one client (family mode).
- **Online, separate accounts**: each local player signs into their own
  account from the same client.

Player 1 keeps the existing keyboard/mouse (+ first gamepad) controls and the
full HUD. Players 2-4 join with additional gamepads and play with a compact
control set. This is shared-screen (one camera), not split-screen.

## What the codebase already gives us

- `Sim` is inherently multi-player: `addPlayer()`, `removePlayer(pid)`,
  per-player `moveInput` in `PlayerMeta`, and every command method takes an
  optional `pid`. The offline `Sim` can host 4 local players without sim
  changes beyond a spawn-near-partner option.
- The renderer draws every entity in the world already; local players 2-4
  render exactly like other players do online today.
- The party system (frames, XP split, tap rights) works in-sim, so partied
  local players get party frames in the existing HUD for free.
- Online, a session is just `new ClientWorld(token, characterId, cls, ...)`;
  the wire protocol needs no message changes for extra sessions, only an
  additive `coop` flag on the auth frame for the same-account cap carve-out.
- `gamepad_map.ts` is a pure mapping core reused per pad.

## Design

### Input: pads 2-4 (`src/game/coop_slots.ts`, pure + a thin manager)

- Pad assignment: the first connected pad stays Player 1's (existing
  `GamepadManager`). Any other connected pad that presses Start while
  unassigned triggers the join flow for the lowest free slot (P2-P4).
- Per-frame, each assigned slot derives from its pad snapshot:
  left stick -> camera-relative move flags + facing (twin-stick style against
  the shared camera yaw), face buttons -> ability slots 1-4, right shoulder ->
  tab-target, left shoulder -> interact/loot, hold Start ~2s -> leave.
- Pure module consumes `GamepadSnapshot`s (id/buttons/axes) so it unit-tests
  without a browser; the thin manager polls `navigator.getGamepads()`.
- No rebinding for co-op pads in v1; P1's bindings are untouched.

### Camera: one framing camera (`src/game/coop_camera.ts`, pure)

- Anchor = centroid of the local players' render positions; distance =
  max(P1's chosen zoom, distance that fits all players given fov/aspect,
  with padding), clamped to a max. P1 keeps yaw/pitch control.
- Soft leash: a co-op player's outward move input is zeroed beyond
  `LEASH_YD` (60) from the party centroid, so nobody can walk off-camera.
  Online this also keeps everyone inside Player 1's ~120 yd interest scope,
  which is what lets one `ClientWorld` mirror render the whole local party.
- Renderer gets one additive override: when co-op is active `main.ts` feeds
  it an anchor + distance instead of the self entity position.

### Offline joins

- Join overlay (Start on an unassigned pad): D-pad cycles the 9 classes with
  the localized class name, A confirms, B cancels. Names default to
  "<class name> <slot>" (offline characters are session-only by design).
- The new player spawns next to Player 1 and is auto-partied (invite +
  accept via the sim party commands), so party frames, XP split, and loot
  rules behave exactly like an online party.
- Death: a co-op player auto-releases and resurrects at the spirit healer
  after a short countdown (shown on their party frame slot); no ghost run in
  v1 because a ghost cannot leave the shared camera anyway.
- Leave (hold Start / pad disconnect): `removePlayer(pid)`; nothing persists,
  matching offline single-player.

### Online joins

- Same overlay flow; after the class-pick step comes an account step:
  - **Same account (family)**: pick one of the account's other characters
    (roster from the existing characters REST). The client opens a second
    `ClientWorld` with the primary session's token and that character id,
    with `coop: true` on the auth frame.
  - **Separate account**: a small login form (existing login REST) issues
    that player's own token; the extra session is otherwise identical.
- Secondary sessions are input-only: they stream move intent + commands and
  are never rendered from; the primary session's world mirror renders
  everyone (guaranteed in-range by the leash). Party auto-invite/accept runs
  over the real online party system.
- Reconnect/dropout: a secondary that loses its socket shows its slot as
  reconnecting and rejoins via the existing linkdead resume; leaving tears
  the session down through the normal leave path (character saves).

### Server: the same-account session cap carve-out

`MAX_ACTIVE_SESSIONS_PER_ACCOUNT = 1` (v0.20.0, anti-bot) stays the default.
`planJoin` (pure, `server/linkdead.ts`) learns a co-op arm: a join carrying
`coop: true` may run the account up to `MAX_COOP_SESSIONS_PER_ACCOUNT = 4`
live sessions **only when every live session on the account shares the
joiner's IP** (one household). The bot economics don't change: mail already
moves goods within an account, and multi-account farming is untouched (the
separate-accounts path was never account-capped; the per-IP hard limit of 20
still applies). GM exemption unchanged.

### HUD / UI

- Party frames (existing) are the co-op players' status UI.
- One compact co-op strip in the game menu: assigned slots, join hint when an
  unassigned pad is connected, leave hint. All new strings are `t()` keys in
  the English catalog per the contributor i18n policy.
- DEV-only `?coop=N` URL param spawns N offline co-op bots without pads
  (mirrors the `?mech` pattern) for testing and screenshots.

## Out of scope (v1)

- Split-screen viewports; per-player full HUD (bags, talents, quest log) for
  P2-P4; co-op pad rebinding; mobile touch co-op; offline co-op persistence;
  cross-machine "online together on separate screens" (that's just the
  existing game).

## Tests

- `tests/coop_slots.test.ts`: pad->slot assignment, join gesture, leave,
  move-flag/facing math, ability edges.
- `tests/coop_camera.test.ts`: centroid, fit distance, clamps, leash veto.
- `tests/coop_sim.test.ts`: 4 local players in one offline Sim: spawn-near,
  auto-party, per-pid movement in one tick, ability cast per pid, death
  auto-res, removePlayer cleanup.
- `tests/linkdead.test.ts`: planJoin co-op arm (cap 4, same-IP required,
  mixed-IP reject, default path unchanged).

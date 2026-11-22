# Party pings on the HUD (`src/ui/hud/pings/`)

The ping wheel, the Ping key, and what the group's pings do on this client. The
rules are the sim's (`src/sim/social/party_pings.ts`: range, rate limit, expiry,
party scope); the world icon is the renderer's (`src/render/party_pings.ts`).

- `ping_wheel_core.ts` (pure): the four wedges (Warning top, Attack left, On My Way
  right, Assist bottom), which wedge a pointer offset lights, the tap-versus-hold
  rule (`PING_TAP_MAX_MS`), what a tap pings, what a release sends.
- `ping_wheel_controller.ts` (DOM, cold): the key's press and release, the SVG wheel
  built once on first open, Escape and the centre cancel. One single-shot hold timer,
  no repeating driver.
- `ping_feed_core.ts` (pure): new-ping detection, the view range, the chat line keys,
  each kind's sound (existing sampled cues only), the minimap point.
- `ping_feed_controller.ts` (DOM): the fast-band tick: sound and chat line once per
  new ping in view, the badges on the minimap.
- `hud_pings.ts`: the Hud factory (untyped Hud, members welded in
  `tests/party_pings_hud.test.ts`), built lazily. Hud holds one field and one
  fast-band call; main.ts reaches it through `src/game/targeting_actions.ts`.

Every surface honours `settings.partyPings` (`src/game/party_pings_setting.ts`):
off, the key does nothing and nothing from others' pings shows or sounds. The
icons are our own procedural badges (`src/ui/ping_icons.ts`); the kind colours
live in `PARTY_PING_COLORS` and the `--color-ping-*` tokens, pinned equal.

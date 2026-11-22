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
- `ping_chat_line_core.ts` (pure): the chat callout's parts (sender, the callout
  words, the unit name and its reaction) from two templates, `chatLine` and the
  kind's `callout*Unit`, so a locale keeps its own word order; the `.ping-kind-N`
  colour class; the unit reaction rule (hostile red, friendly green, neutral yellow).
- `ping_chat_line.ts` (DOM): those parts as nodes: the kind's badge, the sender and a
  pinged player as clickable chat names (the Hud player menu), the tinted callout.
- `ping_feed_controller.ts` (DOM): the fast-band tick: sound and chat line once per
  new ping in view (the line lands on the party channel, solo too), the badges on
  the minimap.
- `hud_pings.ts`: the Hud factory (untyped Hud, members welded in
  `tests/party_pings_hud.test.ts`), built lazily. Hud holds one field and one
  fast-band call; main.ts reaches it through `src/game/targeting_actions.ts`.

A ground ping aims with `WorldPicking.groundHit` (`src/render/ping_ground_ray_core.ts`:
the cursor ray marched against the sim's own floor query), never the flat plane at the
player's feet that click-to-move uses; `groundPingContext` turns a hit the sim would
refuse into no ping.

Every surface honours `settings.partyPings` (`src/game/party_pings_setting.ts`):
off, the key does nothing and nothing from others' pings shows or sounds.
`settings.partyPingsChat` ("Show Pings in Chat", default on) drops only the chat line. The
icons are our own procedural badges (`src/ui/ping_icons.ts`); the kind colours
live in `PARTY_PING_COLORS` and the `--color-ping-*` tokens, pinned equal.

# The Ravenpost, the Event Calendar, and the Homestead Glens

Three social-infrastructure systems shipped together on `feature/mail-calendar-housing`.
One sim, three hosts: every rule below resolves inside `src/sim/` (or, for guild
events, the server's SocialService) and reaches the HUD only through `IWorld`.

## 1. The Ravenpost (in-game mail)

Classic-MMO mail with a raven-courier identity instead of a plain postbox.

- **Mailboxes are raven pillars**: interactable `kind:'object'` entities
  (`templateId 'mailbox'`), one per town hub (Eastbrook, Fenbridge, Highwatch)
  plus one on every homestead plot. A votive ember under the letterbox lights
  up for the viewer while they have unread mail.
- **Sending**: at any pillar, to any character on the realm (online or not),
  with a subject, a body, attached coin, and up to 3 item stacks. Postage is a
  flat 30c; attachments are escrowed out of the bags at send time. Player mail
  rides the raven for ~45 sim-seconds before landing.
- **Authored letters**: the one-time Ravenpost welcome letter (also the feature
  announcement for existing characters, gated by the persisted `mailWelcomed`
  flag) and quest thank-you letters (`content/letters.ts`) that questgivers
  send a couple of minutes after selected turn-ins. Localized per `letterId`
  through the entity dictionary in all 21 locales.
- **Reading**: the mailbox window (inbox/send tabs) opens by interacting with a
  pillar; taking attachments moves coin/parcels to the purse/bags; a letter
  with parcels cannot be deleted. The minimap envelope indicator shows the
  unread count everywhere.
- **Architecture**: `PostOffice` class behind `SimContext` (the `market.ts`
  shape): world-scoped book keyed by stable character identity, persisted as a
  per-realm `world_state` JSONB row (`mail:<realm>`), written atomically with
  character bags on the leave path. `mailInfo` streams only near a pillar
  (delta key `mail`); `mailUnread` streams always (`mailU`). All outcomes are
  structured `mailResult` events the client renders from `t()` keys, so the
  sim stays language-agnostic with no new i18n matchers.

## 2. The Event Calendar

A month-grid window (default keybind `I`) with two lanes:

- **System events**: recurring data rules (`SYSTEM_EVENTS` in
  `src/ui/calendar_view.ts`), display-only pointers at real activities: Raid
  Call (Tue), Market Day (Wed), Fiesta Night (Fri), Arena Clash (Sat), Fishing
  Derby (Sun), Delve Day (7th), Moongate Communion (15th). No gameplay
  modifiers, so graphics/UI neutrality is untouched.
- **Guild events**: officers and the Guild Master book dated events (title,
  optional note and UTC hour) up to a year out, capped at 25 upcoming per
  guild. Rows live in the new `guild_events` table (additive DDL in
  `SOCIAL_SCHEMA`), ride the existing `social` frame inside `GuildInfo.events`,
  and prune as they age out. Titles/notes pass the chat mute/rate/hard-word
  gates; outcomes are structured `calendarResult` events.
- Offline, the calendar shows the system lane only (social is online-only, as
  elsewhere).

## 3. The Homestead Glens (player housing)

Teleport-only player housing in a far-west x-band, the mirror of the dungeon/
arena/delve bands on the east side.

- **The deed**: Steward Fenwick (`land_steward`, a new NPC in Eastbrook) sells
  the homestead deed for a flat 100 gold behind the shared confirm dialog.
  Ownership persists as `homesteadOwned` in the character JSONB and streams as
  the `homeO` delta key.
- **The Glens**: 24 identical plot slots stacked along z at `x = -900`, each a
  flat garden disc inside its own bowl-walled glen. The heightfield is a
  dedicated arm of the shared `terrainHeight` (strictly gated on
  `x <= -600`), so sim, colliders, and renderer agree and the overworld strip
  is byte-identical.
- **Travel**: the Steward teleports an owner to a free per-visit slot (the
  `Homestead` module behind `SimContext` owns occupancy; slots release within
  a second of the visitor leaving the band; characters saved inside rejoin
  beside the Steward). The plot's Homestead Gate portal teleports back.
- **The plot**: cottage, well, fence ring with a south gate, garden trees and
  shrubs, campfire, and a personal Ravenpost mailbox. Rendered lazily per slot
  (`src/render/homestead.ts`) from the CC0 Quaternius village + foliage GLBs
  already bundled; the house and well collide via plot-local colliders.
- **Out of scope for v1** (deliberate): interiors, decoration/customization,
  guest visits, plot upgrades, a wiki page for the Glens.

## Test surface

`tests/mail.test.ts`, `tests/mailbox_view.test.ts`, `tests/calendar_view.test.ts`,
`tests/homestead.test.ts`, guild-event coverage in `tests/social_system.test.ts`,
plus updates to the W0a/W0b/W0c seam registries, the entry-window parity list,
and the localization coverage manifests.

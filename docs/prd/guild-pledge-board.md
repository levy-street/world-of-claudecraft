# Guild Pledge Board

Status: planned for the release AFTER v0.40.0. Owner spec captured 2026-08-23.

## Why

Players who join guilds retain far better than players who do not. The pledge
board gives an unguilded player a first, low-stakes step toward a guild: a
public declaration on their character that they aspire to join one, and a
discovery surface that ranks guilds so the aspiration has somewhere to point.

## What ships

### The guilds board (the town signpost window)

REVISED 2026-08-25 (owner decision): the discovery surface is the WORLD's
guild signposts, not the leaderboard window. Interacting with any town
noticeboard opens the Guild Signpost window (`src/ui/hud/guild_board/`):
guilds ranked by the SUM of every member's lifetime XP (`server/db.ts` guild
high-score board) with the recruitment column:

- Each row shows the guild's pledge note (a short free-text line the guild
  sets: "not accepting pledges", "serious raiders", "chill, invites open"),
  whether pledging is open, and any minimum level. The note is length-clamped
  and hard-tier censored at write time (`server/social.ts`); soft profanity
  masks client-side by the viewer's own filter setting.
- An eligible viewer gets a Pledge button on the row; an ineligible one sees
  why (closed, level cap, their own cooldown).
- Clicking a guild name drills into its public roster (GET
  `/api/guilds/roster`, `server/guild_roster.ts`): the Guild Master, then
  officers, then members, each rank tier ranked by lifetime XP.
- The leaderboard window's `guilds` tab stays the PLAIN ranking (no
  recruitment column, no pledge affordances).

### Pledging

- A character holds at most ONE active pledge (it is a public line on the
  character, so it is singular by construction).
- Pledging is a declaration, never membership: no guild chat, no bank, no
  roster row. The character's nameplate guild line reads as a pledge (see
  Nameplate below) instead of a membership.
- Pledging again elsewhere replaces the previous pledge (one implicit
  withdraw). Withdrawing is free.
- Joining ANY guild clears the character's pledge.

### The guild-side dashboard

- GM and officers (the `GUILD_BANK_EDIT_RANKS` officer-plus family) get a
  Pledges tab in the guild UI: every open pledge (name, class, level, when),
  with Accept and Reject.
- Accept, REVISED 2026-08-26 (owner decision): the pledge is the player's
  standing request to join, so it persists across logout and only resolves on
  a definite outcome.
  - Pledger ONLINE: accept sends the standard guild invite (the existing
    invite flow; the invite, not the accept, is what creates membership). The
    pledge stays on the board until the player actually joins (joining any
    guild clears it), so an invite that expires or drops at logout never
    destroys the request.
  - Pledger OFFLINE: accept seats them directly as a member (the pledge is
    their standing consent; there is no one online to hand an invite to).
    They find themselves in the guild on their next login. Acceptance wipes
    the rejection ladder either way, exactly like a real invite. The seat
    consumes the pledge in the same transaction, so a withdraw or decline
    racing the accept rolls the seat back instead of seating a player who
    just said no.
  - A refused accept (guild full, pledger already guilded elsewhere) leaves
    or resolves the pledge accordingly: full keeps it on the board; already
    guilded drops the stale pledge. Founding a guild also counts as joining
    one and clears the founder's standing pledge.
  - Block policy: a pledge is guild-scoped consent. A per-officer block still
    suppresses the ONLINE invite delivery (the silent fake-success arm of the
    invite flow), and that arm leaves the request standing, exactly like an
    invite the pledger never answered, so the board row itself never reveals
    a block. (The invite flow's own refusal messages are a separate,
    pre-existing observation surface, not changed here.) The OFFLINE seat is
    not gated on any single officer's block relationship: the player asked
    the guild, and the guild said yes.
  - Declining the guild's invite withdraws the pledge: an explicit "no" to
    the guild you pledged to ends the standing request, so a declined player
    can never be seated offline afterwards. Letting an invite expire or
    logging out with it pending is NOT a withdrawal; the request stands.
- Reject removes the pledge, advances that player's cooldown ladder for THIS
  guild (below), and cancels any still-pending invite an earlier accept sent
  (both sides hear the cancel), so an officer's explicit no always stops the
  join.
- Per-guild settings, officer-plus editable: pledges on/off, minimum pledge
  level, and the pledge note (shown on the board).
- Every new pledge notifies online GM/officers with an in-game chat line.

### The rejection cooldown ladder (anti-spam)

Per (guild, account), not per character:

- 1st rejection: that account cannot pledge to that guild for 1 day.
- 2nd rejection: 1 week.
- 3rd rejection: forever.
- ANY guild invite from that guild to that account wipes the ladder (an
  invite is the guild saying "we actually do want you").

### Nameplate: pledge line + guild colour by guild lifetime XP

- A member's guild line keeps its current form. A PLEDGE's line renders the
  pledge wording (localized "Pledge of {guild}") in a visually distinct
  (dimmer) style, so a pledge never reads as a member.
- The guild line's COLOUR now tiers by the guild's collective lifetime XP
  (absolute thresholds in a pure sim leaf, so every host derives the same
  tier). Cosmetic only; thresholds tuned so a fresh guild starts at the base
  tier and the top tier is rare.

## Guild board categories: "New player friendly" + "Officers online"

ADDED 2026-09-10 (owner decision). The signpost board has been the main way
new players find a guild, so it grows two things: a category a guild can opt
into, and a live sign that someone who can actually answer a pledge is online.

### The "New player friendly" category

- A per-guild opt-in, officer-plus editable beside the other recruiting
  settings (the Pledges tab's editor): one tick box, off by default. A guild
  DECLARES it; the board never infers it from level floors or notes.
- The board row of an opted-in guild wears a "New player friendly" chip on
  its recruiting sub-line (the sprout glyph), so the tag reads at a glance
  next to the accepting status and the level floor.
- Every board carries a filter strip above the ranking with one tick box per
  category (one today). The SERVER filters its cached ranking BEFORE paging
  (`GET /api/leaderboard?board=guilds&category=newPlayerFriendly`), so pages
  stay full and the total counts matching guilds; entries keep their REALM
  rank rather than renumbering, so a filtered board still says where each
  guild stands among every guild. A category no guild wears renders the
  filtered empty state with a "Show all guilds" way back; an unknown category
  is the whole board, never an error.
- The Proving Shore's signpost (the tutorial island's recruits' board) opens
  the window with the box TICKED, so a player deciding who to travel with
  sees the guilds that want them first. Every other board, and any opener
  that names no board, opens on the whole ranking. If that default view
  comes back EMPTY (no guild has opted in yet), the window falls back once
  to the whole ranking with the box cleared, so a brand-new player never
  meets an empty board as their first impression; a filter the player
  flipped on themselves keeps its honest empty state and its "Show all
  guilds" way back. The noticeboard event
  carries the board's own `boardId` for this (every board shares one
  templateId); the client-side rule is `defaultGuildBoardCategory`
  (`src/ui/guild_leaderboard_view.ts`).
- The vocabulary is a closed, append-only table in
  `src/sim/guild_board_category.ts` shared by all three hosts. Adding a
  category (PvP, endgame raiding, ...) is a row there plus its guild-side
  opt-in column and wire field; the filter, the query parameter and the
  strip need no change. The wider per-category filter UI is deliberately
  NOT built yet: one tick box today.
- Wire back-compat: `newPlayerFriendly` is optional on the
  `guild_pledge_settings` command; a client that predates categories omits
  it and the server keeps the guild's stored flag rather than clearing an
  opt-in the older client never saw (`server/guild_pledge_settings_cmd.ts`).

### The "Officers online" dot

- A guild whose Guild Master or an officer holds a session RIGHT NOW shows a
  green dot beside its name on the board. Hovering, focusing (keyboard) or
  long-pressing (touch) it opens the shared tooltip listing who is online,
  the Guild Master first; the dot's accessible name carries the same list,
  and the filter strip's legend explains the dot without a hover.
- Two freshness regimes on purpose (`server/guild_board_presence.ts`): WHO
  the officers are is a slow, viewer-identical read (`topGuildOfficers`,
  `server/guild_board_db.ts`) behind one cached single-flight read on the
  board's TTL, bust-wired into the moderation hook; WHETHER each is online
  is answered live against this realm process's sessions at serve time, per
  served page, so the dot never shows a logged-out officer for a cache
  window. Names only ride the wire, never character ids.
- Realm-scoped board only: the cross-realm board cannot see other realms'
  sessions, so it carries no presence rather than a wrong one. A server
  that predates presence sends no field, and the client shows no dot.
- Presence names characters who are online right now to an anonymous
  caller (the board is a public read), so it rides the shared per-IP
  public-read budget: a caller past the budget still gets the board, only
  without presence, so a scraper cannot poll officer activity at request
  rate while a player at a signpost is never met with a 429. Officers only,
  names only, no positions; the roster read carries the moderation
  eligibility screen and is bust-wired to the moderation hook.

## Architecture (the seams this rides)

- Guilds are ONLINE-ONLY (social service + Postgres); the offline Sim never
  sees a pledge. Entity wire fields default empty offline.
- `server/guild_pledges_db.ts`: `GUILD_PLEDGES_SCHEMA` (pledges +
  per-guild-account ladder rows + guild pledge settings), applied by
  ensureSchema. Ladder rows keep forever BY DESIGN (the third tier is
  permanent); pledge rows are bounded at one per character.
- `server/guild_pledges.ts`: the service behind an injected db interface
  (SocialService pattern): pledge/withdraw/list/accept/reject/settings, the
  ladder arithmetic in a pure helper, officer notification fan-out via the
  existing notice channel, ladder wipe hooked into the guild invite path.
- Wire: `Entity.pledgeGuild` (string, '' default) and `Entity.guildTier`
  (small int) beside the existing `guild`; stamped by the server on join and
  on change, mirrored by ClientWorld, defaulted by the offline Sim. New WS
  commands ride `COMMAND_NAMES` + dispatch + the social frames, with the
  command-schema and snapshot delta-key pins updated in the same change.
- UI: leaderboard guilds tab extension; a Pledges tab + settings in the
  social window's guild panel; nameplate painter pledge wording + tier
  colour tokens.
- Guild board categories: `src/sim/guild_board_category.ts` (the closed
  vocabulary + filter rule), `server/guild_board_db.ts` (the ranked read and
  the officer roster, extracted from db.ts), `server/guild_board_presence.ts`
  (the live "officers online" layer both dispatch arms share through
  `buildGuildBoardResponse` in `server/leaderboard.ts`),
  `server/guild_pledge_settings_cmd.ts` (the command parse), and the client
  wire sibling `src/net/guild_board_wire.ts`. The `guilds` row gains
  `new_player_friendly`; `GuildLeaderboardEntry` gains `newPlayerFriendly`
  and `onlineOfficers`; `GuildPledgeSettings` gains `newPlayerFriendly`.

## Out of scope (this iteration)

- Pledge chat channels, pledge-visible guild info beyond the note, pledge
  caps per guild, auto-accept rules, cross-realm pledges.

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
- Accept sends the standard guild invite (the existing invite flow; the
  invite, not the accept, is what creates membership) and removes the pledge.
- Reject removes the pledge and advances that player's cooldown ladder for
  THIS guild (below).
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

## Out of scope (this iteration)

- Pledge chat channels, pledge-visible guild info beyond the note, pledge
  caps per guild, auto-accept rules, cross-realm pledges.

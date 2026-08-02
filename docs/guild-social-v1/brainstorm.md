# Guild Social v1: brainstorm and current state

## Vision
Guilds should feel alive the moment a member logs in, and the roster should quietly honor
tenure. Everything in this PR is cosmetic or moderation hygiene: no permissions change, no
economy change, no new persistence beyond one wire field.

## Approved scope (user-confirmed)
1. **Billboard on login.** The guild MOTD (already shipped as "the guild billboard") gets a
   chat-log line at login, next to the existing zone-welcome lines. Shows once per client
   session, re-shows if the text changes mid-session, never re-shows on linkdead resume,
   shows nothing when the MOTD is empty.
2. **Tenure badges.** Roster rows show a small badge derived from `joined_at`: New (under 14
   days), no badge (14 days to 90 days), Veteran (90 days and up). Pure cosmetics, computed
   client-side from a new `joinedAt` wire field.
3. **Guild-name screening.** `SocialService.guildCreate` currently validates shape only
   (`validateGuildName`: 3 to 24 chars, letters and single interior spaces). Character
   names, map names, and pet names all pass through `offensiveName` (`server/auth.ts`);
   guild names do not, yet they render on nameplates, leaderboards, and chat headers for
   everyone. Close the gap.

## Explicitly out of scope (deferred, do not build here)
- Custom rank names / permission tables, and any fourth fixed rank.
- The guild bank, treasury, and guild creation fee (PR B, `feature/guild-bank`).
- Member notes, officer notes, recruitment board, guildmate login notices.
- Any change to who can set the MOTD or to the MOTD edit UI.

## Current state (verified against the tree)
- The billboard ships end to end: `guilds.motd` + `guilds.motd_set_by` columns
  (`server/social_db.ts`, `SOCIAL_SCHEMA`), the `guild_set_motd` wire command behind the
  chat gate stack (mute, rate limit, hard-word filter) in `server/game.ts`,
  `SocialService.guildSetMotd` (officer gate, length clamp `GUILD_MOTD_MAX`, lone-surrogate
  trim), `GuildInfo.motd` / `motdSetBy` on the `IWorldSocialGraph` facet
  (`src/world_api/social_graph.ts`), the Guild-tab render in
  `src/ui/social_window.ts` (`billboardHtml`, escaped, never linkified), i18n keys under
  `hudChrome.social.billboard.*`, and `tests/guild_billboard_wire.test.ts`.
- The MOTD is already delivered at login: `sendSocialSnapshot` (`server/game.ts`) pushes the
  `{ t: 'social' }` frame during join, and `ClientWorld` (`src/net/online.ts`) sets
  `socialInfo` from it. Nothing new crosses the wire for Phase 1.
- The client login-welcome block in `src/ui/hud.ts` (zone welcome + join-channels tip) is
  the anchor point for the login line. The resume path deliberately skips login notices.
- `guild_members.joined_at` exists in the schema but is not on the wire;
  `GuildMemberInfo` carries `rank` and `lastLogin` only.
- Offline `Sim` has no guilds (`socialInfo` is null; guild methods are no-op stubs), so both
  features are online-only by construction and need no sim change.

## Reuse map
- Decision-module shape: `src/ui/row_unlock_toast.ts` (pure, host-agnostic, Node-tested).
- Pure roster core: `src/ui/social_view.ts` (`guildView`, `guildRosterItems`, already in the
  `UI_PURE_CORES` allowlist).
- Screening: `offensiveName` in `server/auth.ts`; injection precedent: `SocialService` takes
  its collaborators as constructor deps, so the screen lands as an injected predicate and
  the in-memory `FakeDb` tests (`tests/social_system.test.ts`) stay hermetic.
- Server-text localization: the `guild.*` block in `src/ui/server_i18n.ts` DICT re-localizes
  the service's English error lines; any new literal gets its DICT row in the same change.

## Open questions
None. All design decisions are locked in `state.md`.

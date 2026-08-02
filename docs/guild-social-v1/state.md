# Guild Social v1: cross-phase state

Current phase: Phase 1 complete (2026-08-02); Phase 1 QA next.

## Locked design decisions
- Base branch `release/v0.34.0`; branch `feature/guild-social-v1`; this PR lands BEFORE the
  guild bank PR (`feature/guild-bank`), which will rebase over it (both touch
  `server/social.ts` and the social snapshot).
- Login line semantics: track the last shown MOTD string in a pure client module; show the
  line whenever the current MOTD is non-empty and differs from the last shown value. Fresh
  login shows it (nothing shown yet), a mid-session `guild_set_motd` change shows it again,
  linkdead resume does not (the Hud and module state survive resume). No server change.
- The MOTD text is player-authored: spliced verbatim into the localized template, escaped,
  never linkified, never passed through `t()` itself.
- Tenure thresholds: New is under 14 days since `joinedAt`; Veteran is 90 days or more; in
  between renders no badge. Client clock (`Date.now` in ui code is fine; never in sim).
- `joinedAt` rides the wire as epoch milliseconds on each guild member row, sourced from
  `guild_members.joined_at`.
- Guild-name screening is an injected predicate on `SocialService` (wired to
  `offensiveName` from `server/auth.ts` in `server/game.ts`), refusing with a new English
  error literal that gets its `server_i18n.ts` DICT row in the same change. Screening
  applies at creation only; existing guild names are not retro-scanned in this PR.

## Non-negotiable constraints (from root CLAUDE.md)
- No sim change is expected in this PR; if one becomes necessary, stop and re-plan.
- Every new player-visible string: English-only `t()` key in `src/ui/i18n.catalog/`
  (M16: a wordy value also needs its five non-Latin fills); server player text gets its
  matcher row in `src/ui/server_i18n.ts` in the same change (S3 guard).
- No em dashes, en dashes, or emojis anywhere. Conventional Commits with scope and a body.
- Shared checkout care: commit with explicit paths, never `git add -A`.

## Validation matrix
- ui-only change: `npx tsc --noEmit` + `npx vitest run tests/social_view.test.ts
  tests/social_window.test.ts tests/localization_fixes.test.ts`.
- wire/snapshot change (Phase 2 `joinedAt`): add `npx vitest run tests/social_frames.test.ts
  tests/social_system.test.ts tests/snapshots.test.ts`.
- any code change: `npm run ci:changed` (scoped Biome), fix with a scoped
  `npx @biomejs/biome check --write <file>`.
- pre-merge: `npm run gate` (release-tier rules do not apply on a feature branch, but the
  gate must be green).

## Key file paths
- `src/ui/hud.ts`: login-welcome block; `motdResult` handling; DO NOT grow it, wire only.
- `src/ui/social_window.ts` (`billboardHtml`, roster render, `rankLabel`).
- `src/ui/social_view.ts` (pure core, `UI_PURE_CORES`): `guildView`, `guildRosterItems`.
- `src/world_api/social_graph.ts`: `GuildInfo`, `GuildMemberInfo`.
- `server/social.ts` (`SocialService.guildCreate`, `validateGuildName`, snapshot build) and
  `server/social_db.ts` (`guildMembers` query).
- `server/game.ts` (`sendSocialSnapshot`, SocialService construction site).
- `src/ui/server_i18n.ts` (the `guild.*` DICT block).
- `src/ui/i18n.catalog/hud_chrome.ts` (`hudChrome.social.billboard.*`) and the catalog
  module owning `hud.social.*` roster strings.
- Tests: `tests/guild_billboard_wire.test.ts`, `tests/social_system.test.ts` (+ its
  `FakeDb` in `tests/social_shared.ts`), `tests/social_view.test.ts`,
  `tests/social_window.test.ts`, `tests/social_frames.test.ts`.

## Ledger (fill in as phases complete)
- New files: `src/ui/guild_motd_login.ts` (pure decision helper `decideGuildMotdLine`),
  `tests/guild_motd_login.test.ts`.
- New wire fields: (Phase 2 will add `joinedAt` to the guild member row of the social frame)
- New i18n keys: `hudChrome.social.billboard.loginLine` ('Guild billboard: {text}'), plus
  its five M16 non-Latin overlay fills (ja_JP, ko_KR, ru_RU, zh_CN, zh_TW) in the same
  change; generated i18n artifacts regenerated via `npm run i18n:gen`.
- New server literals + DICT rows: (none yet)
- Phase 1 wiring: `Hud.updateGuildBillboardEcho()` on the `Hud.update()` slow band (row
  registered in `tests/hud_update_drive.test.ts`), latch field `Hud.lastShownGuildMotd`,
  appended to the chat log on the `guild` channel with `chatChannelColor('guild')`.
  The module is registered in `UI_PURE_CORES` + `BARE_NAMED` + `EXPECTED_BARE_NAMED`
  (`tests/architecture.test.ts`).

## Known gotchas
- The social snapshot is re-pushed on ANY social change; the login-line module must key off
  the MOTD value, not off snapshot arrival, or every roster change re-triggers it.
- `tests/world_api_parity.test.ts` pins IWorld MEMBERS; Phase 2 changes a member's row TYPE
  only, which does not touch the pin, but `tests/social_frames.test.ts` and the
  `social_system` snapshot shapes will need updating.
- Guild and officer chat fan-outs bypass `routeEvents`; not in scope here, but do not copy
  their patterns for the login line (it is purely client-side).

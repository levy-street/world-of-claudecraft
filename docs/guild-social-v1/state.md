# Guild Social v1: cross-phase state

Current phase: Phase 2 QA (final) complete (2026-08-02). Verdict PASS-WITH-FOLLOWUPS: all
review fixes committed; `npm run gate` and the PR are the orchestrator's remaining steps,
and packet teardown awaits the user's explicit confirmation (docs/guild-social-v1/ left in
place). Full matrix results and the deferral ledger: progress.md.

## Locked design decisions
- Base branch `release/v0.34.0`; branch `feature/guild-social-v1`; this PR lands BEFORE the
  guild bank PR (`feature/guild-bank`), which will rebase over it (both touch
  `server/social.ts` and the social snapshot).
- Login line semantics: track the last shown MOTD string in a pure client module; show the
  line whenever the current MOTD is non-empty and differs from the last shown value. Fresh
  login shows it (nothing shown yet), a mid-session `guild_set_motd` change shows it again,
  linkdead resume does not (the Hud and module state survive resume). No server change.
- The MOTD text is player-authored: spliced verbatim into the localized template, escaped,
  never linkified, never passed through `t()` itself. (Phase 1 QA drift: "verbatim" means
  untranslated; the chat-log echo DOES run the display-side profanity mask
  (`Hud.maskChat`) like every other player-authored chat-pane body, per the QA ruling in
  progress.md. The latch still keys on the raw text.)
- Tenure display, REVISED 2026-08-02 (user-approved design revision, superseding the
  original rank-chip-plus-tenure-chip model): each roster row shows ONE chip. Officers and
  the leader show their rank label exactly as before, never a tenure chip; a non-officer
  member shows the tenure tier AS the displayed role label: Recruit (under 7 days since
  `joinedAt`), Member (7 to 29 days, and the null-`joinedAt` defensive arm), Veteran
  (30 days or more; the shipped `TENURE_RECRUIT_MS`/`TENURE_VETERAN_MS` constants in
  `src/ui/social_view.ts`, revised from the plan's original New/14d + Veteran/90d during
  implementation). Display-only: the underlying GuildRank, every
  permission computation, the context menu, sorting, and the wire shape are untouched.
  Client clock (`Date.now` in ui code is fine; never in sim).
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
- New wire fields: `joinedAt` (epoch ms, `number | null`) on each guild member row of the
  social frame, sourced from `guild_members.joined_at` (NOT NULL in the DDL; the null arm
  is defensive and renders no badge). Nullable end to end mirroring `lastLogin`:
  `server/social_db.ts` query map, `SocialDb`/`GuildMemberEntry` (`server/social.ts`),
  `GuildMemberInfo` (`src/world_api/social_graph.ts`), `GuildRow` (`src/ui/social_view.ts`).
  ClientWorld needed no decode change (whole-object social-frame assignment), and the
  `socialpos` in-place merge does not touch it.
- New i18n keys: `hudChrome.social.billboard.loginLine` ('Guild billboard: {text}'), plus
  its five M16 non-Latin overlay fills (ja_JP, ko_KR, ru_RU, zh_CN, zh_TW) in the same
  change; generated i18n artifacts regenerated via `npm run i18n:gen`.
- New server literals + DICT rows: `'That guild name is not allowed.'` emitted by
  `SocialService.guildCreate` on a screened name; DICT key `guild.nameNotAllowed` filled in
  every locale of `src/ui/server_i18n.ts` and `src/ui/server_i18n.newlocales.ts` (H3
  parity), placeholder-free so the EXACT matcher auto-registers it.
- Phase 2 i18n keys: `hud.social.tenure.new` ('New') and `hud.social.tenure.veteran`
  ('Veteran') in `src/ui/i18n.catalog/merge.ts` (the `hud.social` owner); 'Veteran' is
  wordy per M16, so its five non-Latin overlay fills (ja_JP, ko_KR, ru_RU, zh_CN, zh_TW)
  landed in the same change; artifacts regenerated via `npm run i18n:gen`.
- Phase 2 wiring: `tenureTier(joinedAt, now)` + `TENURE_NEW_MS`/`TENURE_VETERAN_MS` are
  pure exports of `src/ui/social_view.ts` (already in `UI_PURE_CORES`; the clock is a
  parameter, `Date.now()` stays in the painter). `guildMemberRowHtml(m, now)` is a
  module-level EXPORTED function of `social_window.ts` (extracted in review so the render
  arm is behavior-tested; the caller hoists one `Date.now()` per rebuild). The badge is a
  `<span class="rank soc-tenure-<tier>">` chip after the rank chip (always-visible text),
  tinted with the PANEL-AWARE text tokens (`--color-text-light` new,
  `--color-text-muted` veteran) in `src/styles/components.css`, never the raw accent or a
  static green (review: same-gold-as-rank on dark presets, sub-AA on Parchment).
  Screening is a REQUIRED 4th `SocialService` constructor param (review: no fail-open
  default; a host that forgets it fails to compile); `server/game.ts` passes
  `offensiveName`; FakeDb tests inject via `setup({ isNameOffensive })`, whose harness
  default screens nothing.
- Phase 1 wiring: `Hud.updateGuildBillboardEcho()` on the `Hud.update()` slow band (row
  registered in `tests/hud_update_drive.test.ts`), latch field `Hud.lastShownGuildMotd`,
  appended to the chat log on the `guild` channel with `chatChannelColor('guild')`.
  The module is registered in `UI_PURE_CORES` + `BARE_NAMED` + `EXPECTED_BARE_NAMED`
  (`tests/architecture.test.ts`).
- Phase 1 QA: the echo splices `this.maskChat(motdLine.emit)` (profanity mask, QA ruling;
  see progress.md for both deferred-item rulings). No other code drift.
- Phase 2 QA (final): test-only seam pins in `tests/server/title_reads.test.ts` (the
  `gm.joined_at` SQL alias + epoch map + finite guard), `tests/server_i18n.test.ts` (the
  refusal literal in the samples), `tests/social_system.test.ts` (game.ts offensiveName
  wiring source pin, fail-closed ctor via ts-expect-error, format-gate-before-screen
  negative), `tests/social_frames.test.ts` (socialpos preserves joinedAt), and
  `tests/guild_motd_login.test.ts` (HUD echo mask/channel/color source pin). Code drift:
  the tenure chip CSS selectors are now `.soc-name .rank.soc-tenure-*` (specificity
  de-tie vs the rank tint; the HTML class list is unchanged), and
  `hud.social.tenure.new` has five non-Latin overlay fills like Veteran. Screenshot
  tooling: `scripts/pr_shot_targets.mjs` stages joinedAt in the guild-roster fixture and
  adds a `guild-login-line` target; captures live in `docs/screenshots/guild-social-v1/`.
- Design revision (2026-08-02, user-approved): one role chip per roster row. The pure
  resolver `guildDisplayedRole(rank, tier)` (`src/ui/social_view.ts`) maps officers and the
  leader to their rank and everyone else to the tenure tier ('new' / 'veteran') or 'member'
  (the mid-tenure and null-`joinedAt` arm); `roleLabel` in `social_window.ts` localizes it
  (tiers via `hud.social.tenure.*`, ranks via `rankLabel`, so all five keys stay in use)
  and the row emits `<span class="rank[ soc-tenure-<tier>]">`. The separate tenure chip
  markup and `tenureLabel` are gone; the de-tied `.soc-name .rank.soc-tenure-*` selectors
  remain for the two tier tints, the Member/rank chips keep the plain `.rank` gold. Roster
  after-shots recaptured; before-shots and login-line shots untouched.

## Known gotchas
- The social snapshot is re-pushed on ANY social change; the login-line module must key off
  the MOTD value, not off snapshot arrival, or every roster change re-triggers it.
- `tests/world_api_parity.test.ts` pins IWorld MEMBERS; Phase 2 changes a member's row TYPE
  only, which does not touch the pin, but `tests/social_frames.test.ts` and the
  `social_system` snapshot shapes will need updating.
- Guild and officer chat fan-outs bypass `routeEvents`; not in scope here, but do not copy
  their patterns for the login line (it is purely client-side).

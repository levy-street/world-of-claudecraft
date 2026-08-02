# Guild Social v1: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: billboard on login | Complete | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Not started | | |
| Phase 2: tenure badges + name screening | Not started | | |
| Phase 2 QA (final, offers teardown) | Not started | | |

## Phase 1 deliverables
- [x] `src/ui/guild_motd_login.ts`: pure decision module (last-shown tracking), Node-tested.
- [x] HUD wiring: login line rendered via `Hud.log` from the existing welcome block or the
      first `socialInfo` application; no new banner section in `hud.ts`.
- [x] English i18n key(s) under `hudChrome.social.billboard.*` for the login line.
- [x] Tests: decision-module unit tests (first show, change re-show, empty suppressed,
      resume no re-show); extend `tests/guild_billboard_wire.test.ts` or a sibling.

## Phase 1 QA checklist
- [ ] All Phase 1 acceptance criteria verified; fixes applied and committed.
- [ ] No dead code, no unused imports, S3 guard green.

## Phase 2 deliverables
- [ ] `joinedAt` (epoch ms) on the guild member wire row: `server/social.ts` snapshot build,
      `server/social_db.ts` query, `src/world_api/social_graph.ts` `GuildMemberInfo`.
- [ ] Tenure tier pure function + badge render in the roster (social_view + social_window).
- [ ] English i18n keys for the two badges.
- [ ] `guildCreate` screening: injected predicate wired to `offensiveName`, new error
      literal + `server_i18n.ts` DICT row, `FakeDb` test coverage.
- [ ] Tests: tenure boundaries (13d23h, 14d, 89d, 90d), wire round-trip with `joinedAt`,
      screening accept/refuse cases.

## Phase 2 QA checklist
- [ ] All Phase 2 acceptance criteria verified; fixes applied and committed.
- [ ] Whole-packet `qa-checklist.md` pass; `npm run gate` green.
- [ ] Packet teardown offered (delete `docs/guild-social-v1/` on explicit confirmation).

## Notes
Phase 1 (2026-08-02):
- The welcome block in the `Hud` constructor runs before `socialInfo` exists online (the
  social frame arrives after construction), so the login line hooks into the slow-HUD band
  in `Hud.update()` next to `socialWindow.refreshIfChanged()`: a value-diffed latch that
  fires the first time a non-empty MOTD is observed, matching the state.md rule exactly.
- Module is bare-named `guild_motd_login.ts` (filename pinned by the phase prompt), so per
  the frontend-seam review it is registered in all three architecture-test lists
  (`UI_PURE_CORES`, `BARE_NAMED`, `EXPECTED_BARE_NAMED`) to keep the purity sweep's teeth.
  State lives on `Hud` as a `lastShownGuildMotd` field; the module is a pure
  argument-and-return function taking the `SocialInfo`-shaped view, so both world shapes
  (Sim's literal null, ClientWorld's frame mirror) are pinned by its unit tests.
- M16 applied: `hudChrome.social.billboard.loginLine` ('Guild billboard: {text}') is wordy,
  so the five non-Latin overlay fills (ja_JP, ko_KR, ru_RU, zh_CN, zh_TW) landed in the same
  change. This supersedes the acceptance bullet "no locale overlay touched" (state.md's own
  constraints section mandates M16); no other overlay rows were touched.
- Frontend-seam review (1 BLOCKING, 6 SHOULD-FIX) applied: the `Hud.update()` drive is
  registered in `tests/hud_update_drive.test.ts` (chrome surface, slow band, split pin
  bumped 71 to 72); the echo lives in a named `updateGuildBillboardEcho()` method like its
  mail/market siblings; the line is tagged to the `guild` chat channel (visible on the
  Guild filter tab) with its color from `chatChannelColor('guild')`, not a hex literal.
- Known accepted quirks (deliberate, consistent with existing surfaces): the MOTD setter
  sees both the existing `result.set` confirm and the new billboard line; `[[i:...]]`
  tokens in the MOTD render as item links (same decoder as player chat); the echo, like
  the social window's own billboard render, does not pass through the profanity mask; a
  cleared-then-reset identical MOTD re-shows by design.

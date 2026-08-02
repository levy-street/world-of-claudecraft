# Guild Social v1: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: billboard on login | Complete | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Complete | 2026-08-02 | 2026-08-02 |
| Phase 2: tenure badges + name screening | Complete | 2026-08-02 | 2026-08-02 |
| Phase 2 QA (final, offers teardown) | Not started | | |

## Phase 1 deliverables
- [x] `src/ui/guild_motd_login.ts`: pure decision module (last-shown tracking), Node-tested.
- [x] HUD wiring: login line rendered via `Hud.log` from the existing welcome block or the
      first `socialInfo` application; no new banner section in `hud.ts`.
- [x] English i18n key(s) under `hudChrome.social.billboard.*` for the login line.
- [x] Tests: decision-module unit tests (first show, change re-show, empty suppressed,
      resume no re-show); extend `tests/guild_billboard_wire.test.ts` or a sibling.

## Phase 1 QA checklist
- [x] All Phase 1 acceptance criteria verified; fixes applied and committed.
- [x] No dead code, no unused imports, S3 guard green.

## Phase 2 deliverables
- [x] `joinedAt` (epoch ms) on the guild member wire row: `server/social.ts` snapshot build,
      `server/social_db.ts` query, `src/world_api/social_graph.ts` `GuildMemberInfo`.
- [x] Tenure tier pure function + badge render in the roster (social_view + social_window).
- [x] English i18n keys for the two badges.
- [x] `guildCreate` screening: injected predicate wired to `offensiveName`, new error
      literal + `server_i18n.ts` DICT row, `FakeDb` test coverage.
- [x] Tests: tenure boundaries (13d23h, 14d, 89d, 90d), wire round-trip with `joinedAt`,
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
  tokens in the MOTD render as item links (same decoder as player chat); a
  cleared-then-reset identical MOTD re-shows by design. (The profanity-mask quirk
  originally listed here was overturned by the Phase 1 QA ruling below.)

Phase 2 (2026-08-02):
- joinedAt is nullable end to end mirroring lastLogin (`number | null`): the DDL is NOT
  NULL so the live query always yields a value; null is the defensive arm (and the FakeDb
  default, deliberately, so an unstamped test member can never read as an epoch-0
  Veteran). The DB map guards with Number.isFinite (discord_db precedent, review fix).
- Screening ordering pinned by test: validateGuildName first, then the predicate on the
  TRIMMED name, then the DB call, so a refused create leaves no row, no founder credit,
  no membership. The refusal literal is asserted byte-for-byte so it cannot desync from
  the server_i18n EXACT matcher row (guild.nameNotAllowed, all 22 locales, H3 green).
- Review dispatch (per the matrix): privacy-security-review APPROVE (0 BLOCKING),
  cross-platform-sync PASS (0 BLOCKING, 0 SHOULD-FIX), frontend-seam-reviewer PASS with
  fixes (0 BLOCKING). All BLOCKING/SHOULD-FIX items fixed in commits 757f00ef4 and
  4daca27b5: required (fail-closed) screening ctor param, finite joined_at guard,
  panel-aware chip tokens (--color-text-light / --color-text-muted; the first cut's
  --color-primary resolved to the same gold as the rank chip on dark presets and
  --color-friendly went sub-AA on Parchment), and behavioral render tests for
  guildMemberRowHtml (extracted to a module-level exported function with one hoisted
  clock read per rebuild).
- SHOULD-FIX items resolved by verification, not code: guild_create rate limiting is
  covered by the WS pre-parse (R6) + lane-token (R5) budgets with the flood kick
  (server/game.ts consumeLane); before/after screenshots are owned by the Phase 2 QA
  step per this packet's plan (capture with pr-screenshots: roster badges desktop +
  mobile, and the login line).
- Deferred (recorded for Phase 2 QA / follow-up, all NICE-TO-HAVE or out of scope):
  (1) no moderation audit row on a screened-name refusal (consistent with the character
  and pet name screens, which are equally silent; a counter or moderation_db row is the
  right shape if wanted); (2) admin renameAdminGuild runs validateGuildName but not
  offensiveName (operator remediation path, deliberate; state in the PR body);
  (3) offensiveName's space-stripping normalization can false-positive on multi-word
  guild names whose join spans a banned term (filter tuned for spaceless usernames;
  usability risk, not a bypass); (4) a member crossing a tenure boundary while the panel
  sits open keeps the old badge until the next social frame or reopen (commented in the
  painter; a wall-clock driver would break the cold-window contract); (5) mobile online
  rows wrap rather than ellipsize (pre-existing .soc-name.soc-link mobile rule), and the
  whisper button's accessible name concatenates name+rank+tenure+title with no separator
  (pre-existing pattern): both VERIFY-in-browser items for the QA phase's mobile/axe
  passes; (6) joinedAt rides as epoch ms while sibling lastLogin is ISO (both documented
  in-place; align only if a formatter is ever shared); admin_guilds_db exposes a raw
  Date under the same joinedAt name to a different consumer.

Phase 1 QA (2026-08-02):
- Audit result: implementation verified against every Phase 1 acceptance criterion; all
  claimed seam-review fixes confirmed in the committed code (drive-registry row with the
  71-to-72 chrome split bump, `chatChannelColor('guild')` + guild channel tag, named
  `updateGuildBillboardEcho`, the three architecture-list registrations, both-world-shape
  tests). Validation suites, `npx tsc --noEmit`, `npm run ci:changed`, and an `i18n:gen`
  freshness re-run all green; no dead code or unused imports; only the five M16 overlay
  rows touched.
- Deferred ruling 1 (character switch without reload): NO FIX NEEDED. A `Hud` is 1:1 with
  a character: `new Hud(` has exactly one call site inside `startGame` in `src/main.ts`,
  gated by the one-way `hasBegunWorldEntry` latch, and every route back to character
  select (options logout, account logout, fatal overlay) is a `location.reload()`. The
  `lastShownGuildMotd` latch cannot carry across characters. It DOES survive linkdead
  resume, and `ClientWorld.socialInfo` is never reset to null on reconnect, so the
  no-re-show-on-resume rule holds too.
- Deferred ruling 2 (profanity mask): MASK, fixed in this QA pass. Consistency within the
  chat pane wins over consistency with the social window: guild chat bodies in the same
  pane are masked (`appendChatMessageBody`), so the echo now splices
  `this.maskChat(motdLine.emit)` (whole-string, the chat-bubble precedent). The latch
  keys on the raw text, so toggling Filter Profanity never re-triggers the line. Known
  narrow edge, accepted: a soft-word substring inside an `[[i:...]]` item id would star
  the token and degrade the link to `[?]` (masking errs toward filtering). The social
  window `billboardHtml` stays unmasked (pre-existing, its editor input shows raw text;
  out of scope here).
- Residual nice-to-have (not fixed, pre-existing `appendLog` behavior): a MOTD containing
  only a `[[q:id]]` token renders it literally in the echo (the item-link branch keys on
  `'[[i:'`), while guild chat would render a quest link.

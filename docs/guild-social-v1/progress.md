# Guild Social v1: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: billboard on login | Complete | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Complete | 2026-08-02 | 2026-08-02 |
| Phase 2: tenure badges + name screening | Complete | 2026-08-02 | 2026-08-02 |
| Phase 2 QA (final, offers teardown) | Complete (gate + teardown pending, see notes) | 2026-08-02 | 2026-08-02 |
| Revision: one-chip roster role | Complete | 2026-08-02 | 2026-08-02 |

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
- [x] All Phase 2 acceptance criteria verified; fixes applied and committed.
- [x] Whole-packet `qa-checklist.md` pass (all rows except the gate row; see the matrix
      results in the notes). `npm run gate` PENDING: deliberately left to the orchestrator
      to run on a quiet machine, per the QA-session instructions.
- [ ] Packet teardown offered (delete `docs/guild-social-v1/` on explicit confirmation).
      NOT torn down: teardown needs the user's explicit confirmation; the directory is
      left in place until then.

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

Phase 2 QA (final, 2026-08-02):
- Audit shape: fresh-session audit of the b30f030a8..67b162e49 diff; six review agents
  dispatched (correctness, test-coverage-auditor, privacy-security-review APPROVE,
  cross-platform-sync APPROVE, frontend-seam-reviewer PASS, qa-checklist READY with
  0 BLOCKING / 0 SHOULD-FIX). Validation: `npx tsc --noEmit` clean; the ten listed
  suites plus tests/server_i18n.test.ts and tests/server/title_reads.test.ts all green
  (474 passed, 3 skipped); `npm run ci:changed` exit 0; `npm run i18n:gen` freshness
  clean.
- Findings fixed (commit 80caa76eb, test-only): the PgSocialDb.guildMembers joined_at
  read had no test (SQL alias, epoch-ms map, absent-stamp null, Number.isFinite guard,
  all now pinned in tests/server/title_reads.test.ts); the refusal literal was not in
  the tests/server_i18n.test.ts samples (server/social.ts is outside the S3 scan, so the
  emit could drift from the DICT with a green gate; now byte-bound in every locale); the
  game.ts offensiveName wiring, the fail-closed 4th ctor param (ts-expect-error), and
  the format-gate-before-screen ordering negative are now pinned; the socialpos merge is
  asserted to preserve a non-null joinedAt; the rendered-row clock moved years from real
  time so a wall-clock read inside the row builder would flip cases; the CSS pin binds
  each tier's token per rule and forbids Date.now() in the row builder.
- Findings fixed (commit df5151efa): tenure chip selectors de-tied to
  `.soc-name .rank.soc-tenure-*` so they out-specify the rank gold tint instead of
  winning a source-order tie (frontend-seam SHOULD-FIX; pin updated); the five
  non-Latin overlay fills for `hud.social.tenure.new` added alongside the Veteran ones
  and artifacts regenerated (frontend-seam SHOULD-FIX; note the M16 regex itself does
  not require fills for 'New', so this is belt-and-braces, not a gate fix); the HUD
  echo's consumer contracts (maskChat, guild channel tag, chatChannelColor) source-
  pinned in tests/guild_motd_login.test.ts (the qa-checklist gate's one named residual
  seam).
- Deferred WITH REASON (frontend-seam SHOULD-FIX, not fixed): the Veteran chip's
  10px/muted-token contrast tier. The chip rides `--color-text-muted`, the same token
  the adjacent `.soc-sub` line already uses on this panel, and theme.ts runs it through
  ensureReadable per preset; the tier is always distinguishable by its text label
  (never color-only), and a chip-local font bump or token swap would break the `.rank`
  family metrics / re-tint siblings. If small-text muted contrast is ever raised, that
  is a theme.ts token change, not a chip change.
- Screenshots (this phase owned them): captured with scripts/pr_screenshots.mjs via two
  new/extended entries in scripts/pr_shot_targets.mjs (commit 03f16664f: joinedAt
  staging in the guild-roster fixture, a guild-login-line target, mobile scroll-into-
  view). Committed in 9b32451a9 under docs/screenshots/guild-social-v1/: before/after x
  desktop/mobile for the roster tenure chips and the login billboard line (8 PNGs).
  The before side was shot at the feature merge-base (1348366901d). Capture trap hit
  and resolved: a dev server from ANOTHER checkout already held :5173, so the first run
  silently shot stale code; re-captured against this worktree's :5174.
- Whole-feature qa-checklist.md matrix results:
  - Three-host consistency: PASS (offline Sim socialInfo stays literal null; both
    surfaces render online only; no null-guild crash; headless untouched).
  - Determinism: PASS (zero src/sim/ paths in the whole-feature diff).
  - i18n completeness: PASS (catalog keys English-only; M16 fills for loginLine,
    Veteran, and now New; guild.nameNotAllowed in all 22 locales of both DICT files;
    localization_fixes + i18n_completeness green; MOTD and guild names spliced
    verbatim).
  - Server authority: PASS (screening in SocialService before any row; command path
    only; client gained no mutation paths; fail-closed ctor pinned by tsc).
  - Persistence: PASS (no DDL; joined_at pre-existing NOT NULL column; defensive null
    arm tested).
  - Moderation: PASS (refusal localized, generic copy leaks no matched term).
  - UI/mobile: PASS (mobile landscape captures show the chips and the login line;
    badges are always-visible text, never hover-only).
  - Copy: PASS (added-line scan across the whole feature diff: no em/en dashes or
    emojis; locale files scanned separately for the two dash codepoints).
  - Screenshots: PASS (paths above, to be referenced from the PR body).
  - Gate: PENDING (orchestrator runs `npm run gate`; not run here by instruction).
- Remaining deferrals from Phase 2, re-verified this session, all stand: (1) no
  moderation audit row on a screened refusal (precedent confirmed: the character-name
  screen in server/characters.ts refuses with no audit row either; a follow-up shape,
  not this PR); (2) admin renameAdminGuild runs validateGuildName only (confirmed in
  server/admin_guilds_db.ts; deliberate operator remediation path, admin-gated, no
  player path to rename; STATE IN THE PR BODY); (3) offensiveName space-stripping can
  cross-word false-positive on multi-word names (pre-existing filter tuning, usability
  not bypass); (4) badge staleness while the panel sits open (documented in the
  painter; the cold-window no-driver contract wins); (5) mobile row wrap + whisper
  accessible-name concatenation (verified in the mobile captures: rows wrap acceptably;
  both pre-existing patterns); (6) joinedAt epoch-ms vs lastLogin ISO asymmetry
  (documented in place; admin_guilds_db's raw-Date joinedAt serves a different
  consumer). Nice-to-haves recorded, not done: a behavior test for the echo's
  masking (the source pin covers it), the `[[q:id]]` literal-render quirk, and
  offensiveName's non-string fail-open arm (unreachable via guildCreate).

Revision: one-chip roster role (2026-08-02, user-approved design revision):
- The roster previously showed every row's rank chip PLUS a separate tenure chip
  (New/Veteran) beside it. Now each row shows ONE chip: officers and the leader keep
  their rank label with no tenure chip; a non-officer member shows the tenure tier AS
  the displayed role label (New under 14 days, Member 14 to 89 days or null joinedAt,
  Veteran at 90 days or more). Thresholds unchanged; display-only (rank, permissions,
  context menu, sort, and the wire shape untouched; see the revised locked decision in
  state.md).
- Implementation: new pure resolver `guildDisplayedRole(rank, tier)` +
  `GuildDisplayedRole` in `src/ui/social_view.ts`; `social_window.ts` replaced
  `tenureLabel` + the tenureSpan markup with `roleLabel` and the single
  `<span class="rank[ soc-tenure-<tier>]">` chip. The de-tied
  `.soc-name .rank.soc-tenure-*` selectors stay (tier tints only; comment revised);
  no i18n key changes (tenure.new/veteran and all three rank keys remain in use).
- Tests: `tests/social_view.test.ts` gained the resolver suite (13d23h/14d/89d/90d
  boundaries, null-joinedAt arm, leader/officer passthrough at any tenure, unknown-rank
  fallback); `tests/social_window.test.ts` rendered-row suite moved to an exact
  one-chip-array assertion (a reappearing second chip or an officer tenure label fails
  decisively) and the source pins track the new role derivation.
- Screenshots: after-roster-desktop.png and after-roster-mobile.png recaptured against
  THIS worktree's dev server (port re-verified after the :5173 collision trap from the
  Phase 2 QA notes); before-shots and the login-line shots untouched.

Revision (2026-08-02, user-directed, quick pass): tenure tier 'new' renamed 'recruit'
(label Recruit, class soc-tenure-recruit, key hud.social.tenure.recruit with refreshed
non-Latin fills) and thresholds moved to 7/30 days (was 14/90). View core, window, CSS,
catalog, locales, and both test suites updated; tsc + social_view/social_window/
i18n_completeness/architecture green. Roster after-screenshots still show the old 'New'
label on the youngest member; recapture owed if the maintainer wants pixel-current shots.

Revision 2 (2026-08-02, user-directed): all five role labels now share the one plain
.rank chip treatment; the per-tier soc-tenure-* tint classes and their CSS were removed
(label text alone distinguishes tiers). Pins updated to forbid a tier class returning.

# Guild Social v1: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: billboard on login | Not started | | |
| Phase 1 QA | Not started | | |
| Phase 2: tenure badges + name screening | Not started | | |
| Phase 2 QA (final, offers teardown) | Not started | | |

## Phase 1 deliverables
- [ ] `src/ui/guild_motd_login.ts`: pure decision module (last-shown tracking), Node-tested.
- [ ] HUD wiring: login line rendered via `Hud.log` from the existing welcome block or the
      first `socialInfo` application; no new banner section in `hud.ts`.
- [ ] English i18n key(s) under `hudChrome.social.billboard.*` for the login line.
- [ ] Tests: decision-module unit tests (first show, change re-show, empty suppressed,
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
(fill in per phase)

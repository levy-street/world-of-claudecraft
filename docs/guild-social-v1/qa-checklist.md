# Guild Social v1: whole-feature QA matrix

Run once at packet completion (Phase 2 QA), on top of the per-phase QA passes.

- **Three-host consistency**: offline `Sim` has no guilds; verify the login line and badges
  simply never render offline (no null-guild crash), and the online `ClientWorld` path
  renders both. Headless env untouched.
- **Determinism**: no `src/sim/` changes landed. If any did, stop: that is out of scope.
- **i18n completeness**: every new string is an English `t()` key in
  `src/ui/i18n.catalog/`; locale overlays untouched; MOTD text and guild names spliced
  verbatim; new server error literal has its `server_i18n.ts` DICT row;
  `npx vitest run tests/localization_fixes.test.ts` green.
- **Server authority**: screening happens in `SocialService`, not the client; the client
  gained no new mutation paths.
- **Persistence**: no schema change; `joinedAt` reads the existing column. Characters and
  guilds saved before this PR load unchanged.
- **Moderation**: new guild names refuse offensive content; refusal copy localized; the
  refusal does not leak which term matched.
- **UI/mobile**: roster badges and the login line render on a phone viewport (run a mobile
  screenshot script with `npm run dev`); badges do not rely on hover.
- **Copy**: no em dashes, en dashes, or emojis in any new text.
- **Screenshots**: roster with badges + login line captured per the `pr-screenshots` skill,
  committed under `docs/screenshots`, referenced in the PR body.
- **Gate**: `npm run gate` green on the branch; PR follows
  `.github/PULL_REQUEST_TEMPLATE.md`.

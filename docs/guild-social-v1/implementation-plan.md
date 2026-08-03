# Guild Social v1: implementation plan

Two implementation phases, each followed by a QA phase, each run as its own Claude Code
session. Model: the newest Claude coding model available (Fable 5 at plan time), xhigh
effort. This packet is small; no phase is batch-heavy, so no ultracode Workflow is expected.

| Phase | Slice | Surfaces |
|---|---|---|
| 1 | Billboard on login | `src/ui/` only |
| 1 QA | Verify Phase 1 | |
| 2 | Tenure badges + guild-name screening | `server/social.ts`, wire type, `src/ui/` |
| 2 QA | Verify Phase 2, close packet | |

## Team workflow (every phase)
1. **Pre-flight**: `git status` clean in THIS worktree
   (`world-of-claudecraft-guild-social`); scan Claude Code memory (`MEMORY.md` index) for
   guild-domain entries.
2. **Load context**: spawn one Explore agent to read `state.md`, `progress.md`, this file's
   phase section, and the phase's listed source files; it returns a focused summary. Do not
   read `src/ui/hud.ts` or planning docs whole in the main loop.
3. **Execute**: this packet's phases are single-session sized; fan out only if a phase
   splits cleanly (for example Phase 2: one agent for the server + wire slice, one for the
   ui slice, each writing its own tests). Cap manual fan-out at 5.
4. **Validate + review**: run the `state.md` validation matrix rows that match the diff;
   spawn review agents per the dispatch matrix below (prompt for COVERAGE, not filtering:
   "report every issue including low-severity and uncertain ones"). Do not commit until no
   BLOCKING findings remain.
5. **Docs + memory**: update `progress.md` and `state.md` (ledger section); record
   surprises to memory. Commit with explicit paths, Conventional Commits with scope + body.

Code hygiene in every phase: module-first (new logic in sibling modules, `hud.ts` stays a
thin consumer), tests for every new behavior, zero unused imports, no dead code, no
generated-file hand-edits.

## Review dispatch matrix (canonical copy for this packet)
Spawn ONLY agents whose row matches the diff:

| Agent | Spawn ONLY when the diff touches | Skip for |
|---|---|---|
| `privacy-security-review` | `server/` (Phase 2 touches `server/social.ts` + `server/game.ts`) | Phase 1 (pure ui) |
| `migration-safety` | `server/*_db.ts` or a persisted-state shape | both phases as planned (no DDL; `joinedAt` is read-only) unless the query change grows beyond a SELECT column |
| `database-performance-reviewer` | SQL cost/cadence changes | both phases as planned (one added column in an existing query) |
| `cross-platform-sync` | `src/world_api/**`, `server/game.ts` wire, `src/ui/server_i18n.ts` | Phase 1 |
| `architecture-reviewer` | `src/sim/` | both phases (no sim changes; if sim changed, stop and re-plan) |
| `frontend-seam-reviewer` | `src/ui/` | neither (both phases touch ui) |
| `qa-checklist` | a phase is COMPLETE | mid-phase work |

## Phase 1: billboard on login

### Starter prompt
```
This is Phase 1 of the Guild Social v1 feature: billboard on login.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-social (feature/guild-social-v1).

Goal: show the guild billboard (MOTD) as a localized chat-log line at login and whenever
its text changes mid-session, with zero server changes.

STEP 0 - PRE-FLIGHT: verify git status is clean in this worktree; scan memory.

STEP 1 - LOAD CONTEXT (via one Explore agent, not directly):
- docs/guild-social-v1/state.md (locked decisions, validation matrix)
- docs/guild-social-v1/progress.md (Phase 1 checklist)
- src/ui/row_unlock_toast.ts (the decision-module shape to copy)
- src/ui/hud.ts: ONLY the login-welcome block, the socialInfo application path, and the
  motdResult handling (do not read the file whole)
- src/net/online.ts: ONLY where the social frame sets socialInfo
- src/ui/i18n.catalog/hud_chrome.ts: the hudChrome.social.billboard.* block
- tests/guild_billboard_wire.test.ts, src/ui/CLAUDE.md, src/styles/CLAUDE.md
Return: the exact hook point for the login line, the billboard key names, and the
socialInfo re-push cadence.

STEP 2 - EXECUTE (single session, no fan-out needed):
Deliverables:
- src/ui/guild_motd_login.ts: a pure module exporting a small decision helper: given the
  previous shown-MOTD value and the current socialInfo guild MOTD, return whether to emit
  the line and the new shown value. No DOM, no i18n, Node-tested directly.
- Wire it where socialInfo is applied to the HUD so the rule in state.md holds: shows on
  fresh login, re-shows on text change, suppressed when empty, no re-show on linkdead
  resume, and NOT re-triggered by unrelated social snapshot re-pushes.
- One or two English i18n keys under hudChrome.social.billboard.* (for example loginLine
  with {text} and, if the setter is shown, loginSetBy with {name}); MOTD text spliced
  verbatim and escaped; render via Hud.log with a distinct color, following the existing
  welcome-line pattern.
- Tests: unit tests for the decision module covering first show, unchanged suppress,
  change re-show, empty suppress, and cleared-then-set again.

INVARIANTS IN PLAY: i18n English-only catalog keys, player text spliced verbatim, no
hud.ts growth beyond thin wiring, no em dashes or emojis, no sim or server changes.

Out of scope: any server change, any MOTD edit-UI change, tenure badges, name screening.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run tests/guild_billboard_wire.test.ts
  tests/localization_fixes.test.ts plus the new test file; npm run ci:changed.
- Dispatch per the matrix in implementation-plan.md: frontend-seam-reviewer only.

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(ui): show the guild billboard as a login notice
- test(ui): cover the guild motd login decision module

STEP 5 - ACCEPTANCE:
- [ ] Fresh login with a non-empty MOTD logs exactly one localized line.
- [ ] guild_set_motd mid-session logs the new text once; unrelated snapshot pushes do not.
- [ ] Empty MOTD logs nothing; offline (no guild) logs nothing and does not crash.
- [ ] All listed suites green; no locale overlay touched.

STEP 6 - DOCS: update progress.md and state.md ledger (new file, new keys).

STEP 7 - FINAL RESPONSE: phase status, files touched, validation results, review verdicts,
one-line handoff for Phase 1 QA.

STOPPING RULES: stop and ask if the hook point requires a server change or a new wire
field; that contradicts the locked design.
```

## Phase 1 QA

### QA starter prompt
```
This is Phase 1 QA of the Guild Social v1 feature.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-social.

Goal: audit Phase 1 for correctness, missing tests, dead code, and i18n completeness.

STEP 0: git status clean (Phase 1 committed); memory scan.
STEP 1: Explore agent summarizes state.md, progress.md Phase 1 checklist, and the Phase 1
diff (git diff against the packet-start commit).
STEP 2: spawn parallel review agents (COVERAGE not filtering): a correctness agent (every
deliverable and acceptance item actually met; edge cases: motd set while the social window
is open, guild leave then rejoin mid-session, resume), a test-coverage agent (assertions
decisive, both suppress arms tested), and frontend-seam-reviewer. Resume any truncated
agent with: "Stop reading more files. Output the full report now. Format: BLOCKING /
SHOULD-FIX / NICE-TO-HAVE / VERDICT."
STEP 3: fix all BLOCKING and SHOULD-FIX; rerun the Phase 1 validation rows; commit fixes
separately with explicit paths.
STEP 4: update progress.md (Phase 1 QA complete) and state.md drift; record memory notes.
STEP 5: (not final phase; no teardown.)
STEP 6: end with QA verdict, counts, deferred items, one-line handoff to Phase 2.
```

## Phase 2: tenure badges + guild-name screening

### Starter prompt
```
This is Phase 2 of the Guild Social v1 feature: tenure badges + guild-name screening.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-social.

Goal: put joinedAt on the guild member wire row and render New / Veteran roster badges from
it, and refuse offensive guild names at creation.

STEP 0 - PRE-FLIGHT: git status clean; memory scan.

STEP 1 - LOAD CONTEXT (via one Explore agent):
- docs/guild-social-v1/state.md (thresholds, injection decision, error-literal rule)
- server/social.ts: guildCreate, validateGuildName, the snapshot build that produces guild
  member rows, and the constructor deps shape
- server/social_db.ts: guildMembers query; server/auth.ts: offensiveName
- src/world_api/social_graph.ts: GuildMemberInfo; src/net/online.ts: social frame decode
- src/ui/social_view.ts (guildView, guildRosterItems), src/ui/social_window.ts (roster
  render, rankLabel), src/ui/server_i18n.ts (the guild.* DICT block)
- tests/social_system.test.ts + tests/social_shared.ts (FakeDb), tests/social_frames.test.ts
Return: the member-row shape end to end, the deps-injection idiom, and the exact error
emission style guildCreate uses today.

STEP 2 - EXECUTE: fan out two agents in parallel, each writing its own tests:
Server + wire agent deliverables:
- joinedAt (epoch ms) added to the guild member row: social_db query, SocialService
  snapshot build, GuildMemberInfo type, ClientWorld decode. Update tests/social_frames and
  tests/social_system shapes.
- guildCreate screening via a new injected predicate in SocialService deps (game.ts wires
  offensiveName from server/auth.ts; FakeDb tests inject their own). Refusal emits a new
  English error literal following the existing guildCreate error style.
- The new literal's DICT row in src/ui/server_i18n.ts in the SAME change (S3 guard).
UI agent deliverables:
- Tenure tier helper (pure, in or beside social_view.ts): under 7 days Recruit, 30 days
  or more Veteran, else none; boundary-tested either side of both thresholds. (As
  shipped: the plan originally said New/14d + Veteran/90d; the tiers were retuned to
  Recruit/7d + Veteran/30d during implementation, see state.md.)
- Badge render in the roster rows in social_window.ts; two short English i18n keys under
  the hud.social.* roster namespace; badges never rely on hover; mobile-checked.

INVARIANTS IN PLAY: server authority (screening in SocialService, never the client), i18n
(English catalog keys; guild names and MOTD spliced verbatim; DICT row same change), no
sim change, no em dashes or emojis, module-first.

Out of scope: retro-scanning existing guild names, rank changes, any MOTD change, DDL.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run tests/social_system.test.ts tests/social_frames.test.ts
  tests/social_view.test.ts tests/social_window.test.ts tests/localization_fixes.test.ts
  tests/snapshots.test.ts; npm run ci:changed.
- Dispatch per the matrix: privacy-security-review, cross-platform-sync,
  frontend-seam-reviewer.

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(social): send guild member joinedAt on the social snapshot
- feat(ui): render tenure badges on the guild roster
- fix(social): screen guild names for offensive content at creation

STEP 5 - ACCEPTANCE:
- [ ] Roster shows Recruit under 7 days, nothing 7 to 29 days, Veteran at 30 days or
      more (retuned from the original New/14d + Veteran/90d, see state.md).
- [ ] joinedAt round-trips server to client; pre-existing tests updated, none orphaned.
- [ ] guildCreate refuses a screened name with a localized error; FakeDb tests cover
      accept and refuse; the client cannot bypass (command path only).
- [ ] All listed suites green; locale overlays untouched.

STEP 6 - DOCS: update progress.md and the state.md ledger (wire field, keys, literal).

STEP 7 - FINAL RESPONSE: status, files, validation, review verdicts, handoff to Phase 2 QA.

STOPPING RULES: stop and ask if screening turns out to require an async call inside
SocialService that its call sites cannot await, or if joinedAt forces an IWorld MEMBER
change (the pin in tests/world_api_parity.test.ts should not move for a row-type change).
```

## Phase 2 QA (final)

### QA starter prompt
```
This is Phase 2 QA of the Guild Social v1 feature (final phase).

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-social.

Goal: audit Phase 2, then close the packet.

STEP 0: git status clean; memory scan.
STEP 1: Explore agent summarizes state.md ledger, progress.md Phase 2 checklist, and the
Phase 2 diff.
STEP 2: parallel review agents (COVERAGE not filtering): correctness (thresholds exact,
wire round-trip, screening not bypassable, existing-guild names unaffected), test-coverage
(negative cases per dimension, decisive assertions), plus per the dispatch matrix:
privacy-security-review, cross-platform-sync, frontend-seam-reviewer, and qa-checklist
(phase-complete gate). Resume truncated agents with the standard "Stop reading. Output the
full report now." message.
STEP 3: fix all BLOCKING and SHOULD-FIX; run the whole-packet qa-checklist.md matrix and
npm run gate; capture PR screenshots per the pr-screenshots skill (roster badges, login
line; desktop and mobile) into docs/screenshots.
STEP 4: update progress.md and state.md; record memory notes.
STEP 5 - PACKET TEARDOWN: if everything is green, surface any deferred follow-ups, then
ask the user explicitly: "All phases are complete and green. OK to delete
docs/guild-social-v1/ (the planning scaffolding) before the PR?" Delete only on explicit
confirmation, only that directory, explicit paths.
STEP 6: end with QA verdict, counts, teardown status, and "packet complete" plus the PR
next step (PR body per .github/PULL_REQUEST_TEMPLATE.md, base release/v0.34.0 or the
newest release branch at merge time).
```

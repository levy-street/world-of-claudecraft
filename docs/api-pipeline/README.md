# API Pipeline Re-Architecture: packet record

This packet re-architected every REST surface on the authoritative game server
(`/api`, `/admin/api`, `/oauth`, `/internal`) behind one in-house request pipeline
(`server/http/`): table router, middleware onion, typed schemas, RFC 9457 errors with
stable machine codes, BOLA ownership loaders, a two-tier rate limiter, top-level
security headers and CORS, structured logging, and the token-gated `/metrics`
exporter. The work shipped as 25 QA-gated implementation phases (plus the 18b
late-arrivals insert and three closeout phases), delivered on
`feature/api-re-architecture` behind the single `API_DISPATCH` flag
(default `new`; `legacy` is the one-flag rollback to the retained ladder).

**PACKET CLOSED (2026-07-05).** The migration is complete and the per-phase working
documents (`phase-NN-*.md`, `brainstorm.md`, `implementation-plan.md`) were removed at
closure; they remain available in git history (this directory, before the closure
commit). The documents below are the durable record and are still pointed to by
shipped code and tests; keep their paths and headings stable.

| File | What it is |
|---|---|
| [state.md](state.md) | The cross-phase cheat sheet: locked decisions, constraints, deviation and constant indexes, and the `## Old-ladder deletion exit criteria (next release)` section that gates the next-release ladder-deletion PR (linked by `server/http/CLAUDE.md`; do not rename the heading). |
| [progress.md](progress.md) | The phase-by-phase record of what shipped, each QA gate outcome, and the release-merge slice records (pointed to by `server/wallet.ts`, `server/leaderboard.ts`, `server/discord.ts`). |
| [qa-checklist.md](qa-checklist.md) | The whole-feature integration matrix, run once at packet completion (pinned by `tests/server/http/rate_limit.test.ts`). |
| [source-spec.md](source-spec.md) | The originating SPEC this packet decomposed. Its `main.ts`/`db.ts` line anchors are stale; anchor on symbol names. |
| [phase-20-rollback-runbook.md](phase-20-rollback-runbook.md) | The World Market realm-scope backfill deploy and rollback runbook (pointed to by `server/market_backfill.ts`; follow it at deploy time). |

The only remaining follow-up is the next-release ladder-deletion PR, gated by the
exit criteria in `state.md` (owner: the maintainer). Deferred items (API versioning,
ETag, Deprecation/Sunset, OpenAPI, the CSP Report-Only effort, the 415/Origin enforce
flips) are listed in the same section.

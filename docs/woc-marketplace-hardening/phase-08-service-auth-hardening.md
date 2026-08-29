# Phase 08: Service auth hardening and fail-closed config

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: SERVICE. Worktree `/Users/fernando/Documents/woc-rewards-service-pr31`, branch
  `integration/woc-market-settlement`. Code lives under `service/`; validate with
  `npm run build` and `npm test` in that directory.
- Closes: B5, the fail-open config mediums, and the compose staleness default.
- review.md: B5, Mediums "Dev chain fails open on unset NODE_ENV" and "Compose default
  halts the market".

## Goal

One authorization decision per request, computed on one normalized path, with
constant-time secret comparison, and a service that fails CLOSED on every configuration
gap.

## Findings context (verified 2026-08-11; re-verify line numbers)

- B5 at `service/src/server.ts:131`: the marketplace admin routing normalizes the path,
  but the pre-existing Claudium refund and gift-card clawback gates compare the RAW URL
  exactly while their handlers strip the query string later; appending a query string
  skips the admin-secret tier while the request still reaches the handler with only the
  game/internal secret. Internal and admin secrets are compared with plain `!==`.
- Dev chain activates on unset NODE_ENV (a stray flag turns a real deployment into free
  items); the market can run real settlements against in-memory stores when
  `DATABASE_URL` is missing.
- `docker-compose.yml` defaults price staleness to 120000ms, the exact permanent-halt
  value the code comments warn about (code default is 1 hour).

## Deliverables

1. Normalize the request path ONCE, before every authorization tier and dispatch
   decision; every gate (marketplace admin, Claudium refund, gift-card clawback, and any
   other exact-match gate a sweep finds) compares the normalized path. Regression test
   reproduces the query-string bypass shape and proves it now requires the admin secret.
2. Constant-time, length-guarded secret comparison for the internal AND admin secrets
   (mirror the game server's timingSafeEqual pattern); unset secret denies.
3. Fail closed: the dev chain constructs only when the environment is explicitly
   dev/test AND the dev flag is set; market settlement paths refuse to start against
   in-memory stores (require `DATABASE_URL` when the market is enabled). Boot tests for
   both refusals.
4. Align the compose price-staleness default with the code default; comment WHY in the
   compose file (the permanent-halt trap).

## Out of scope

The bond releaser (phase 09); verifier changes (phase 10); oracle instance wiring
(phase 11).

## Validation

In `service/`: `npm run build`, `npm test`. All new behavior tested, including the
bypass regression and both fail-closed boot refusals.

## Reviewers

Game roster does not apply here. Dispatch two generic read-only subagents: a security
lens (auth tier ordering, normalization coverage, timing safety, fail-closed posture)
and a correctness lens (every deliverable met, tests decisive), both prompted for
COVERAGE.

## Acceptance criteria

- [ ] Query-string bypass test red on old code, green on new; every exact-match gate
      swept and normalized
- [ ] Secrets compared constant-time with length guard; unset secret denies (tested)
- [ ] Boot refusal tests: non-dev environment cannot get the dev chain; market with no
      `DATABASE_URL` refuses
- [ ] Compose default aligned and explained

## Wrap-up

Update progress.md and state.md (in the GAME worktree packet; note the service tip hash).
Next file: `docs/woc-marketplace-hardening/phase-08-qa.md`.

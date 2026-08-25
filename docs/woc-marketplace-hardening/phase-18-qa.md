# Phase 18 QA: Dashboard guardrails

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-dashboard-pr13`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-trading`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 18. Canonical QA workflow in `implementation-plan.md`.
Repo: DASHBOARD, worktree `/Users/fernando/Documents/woc-rewards-dashboard-pr13`;
packet docs update in the game worktree.

## What was promised (audit every item)

Role-gated game proxy with a non-privileged-role test matrix; mint-config decimals with
a rendered-figure test; WMB_-only release validation, typed forfeit confirmation,
destination reset, immutable actor ID; overview resilience.

## Phase-specific probes

- Proxy bypass hunt: the catch-all `[...path]` route is one entry; grep for any OTHER
  route or fetch helper that reaches the game internal API without the new role check
  (server-side fetches in page frontmatter included); one unguarded path is BLOCKING.
- Role model integrity: where do roles come from, and can a request forge one (header,
  cookie claim, client-supplied)? The check must key on the server session, not a
  client-visible flag.
- Decimals: check the CONVERSION direction too (display AND any amount submitted back
  to the service for release must use the same source of truth; a display-only fix that
  still submits 9-decimal raw amounts pays 1000x on the money path).
- Confirmation UX: the typed confirmation must bind to the SPECIFIC reference being
  forfeited, not a generic "yes".
- Audit rows: verify the actor ID survives a username change scenario in a test.

## Reviewers

Generic security and correctness subagents on the final diff.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-19-dashboard-tooling.md`.

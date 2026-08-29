# Phase 12: Wire completeness and environment truth

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H8, the undocumented-env medium, and the health-rail medium.
- review.md: H8, Medium "Undocumented required env; wrong health rail".

## Goal

Everything the service computes reaches the player, and everything the deployment needs
is documented and honestly health-checked.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H8 at `server/woc_market_routes.ts:332`: `estimateView` drops `split` (the three USD
  fee legs), so the p2p "Fee / You receive" lines render blank for every player;
  `quoteView` drops `signatureRequired`, which kills the dev-economy payment path.
- `WOC_MARKET_SERVICE_URL` and `DASHBOARD_INTERNAL_SECRET` are read but absent from the
  game `.env.example`; the service health rail keys on names the market never reads.
- Phase 04 introduced a confirming-age bound knob and phase 09 may have changed the
  quote response shape (check state.md): both need documenting here.

## Deliverables

1. `estimateView` carries the fee split; the Fee and You-receive lines render real
   values end to end (server serialization test pinning the wire fields + a UI
   view-core test rendering them).
2. `quoteView` carries `signatureRequired`; the dev-economy payment path works end to
   end (test at the route level; note anything phase 09's amount-ownership change
   requires here).
3. `.env.example` documents every market env var actually read (sweep the code for
   `process.env` reads in market modules; include the phase 04 bound knob); the health
   rail keys on config names the market actually reads.
4. Wire-shape pins: a test enumerates the market view serializers' fields so a future
   dropped field fails a pin, not a player surface.

## Out of scope

New UX behavior (phases 14, 15); service-side quote computation (phase 09).

## Validation

`npx tsc --noEmit`; the new wire-pin and view tests plus marketplace suites;
`npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`cross-platform-sync` (wire fields), `privacy-security-review` (env documentation must
not leak secret VALUES, names only), `frontend-seam-reviewer` (fee-line rendering),
`test-coverage-auditor`. `qa-checklist` last.

## Acceptance criteria

- [ ] Fee and You-receive lines render real values (view-core test; visual check noted
      for the phase 15 screenshot pass)
- [ ] Dev-economy payment path green with `signatureRequired` flowing
- [ ] `.env.example` complete against a code sweep; health rail keys on real names
- [ ] Wire pins fail on a deliberately dropped field (mutation-checked)

## Wrap-up

Update progress.md and state.md (final wire shapes for phases 14/15/21). Next file:
`docs/woc-marketplace-hardening/phase-12-qa.md`.

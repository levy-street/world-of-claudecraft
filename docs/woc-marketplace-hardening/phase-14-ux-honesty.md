# Phase 14: UX honesty on the money surface

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H13, the wallet-bridge i18n medium, and the `wocUsdText` currency medium.
- review.md: H13, Medium "i18n" cluster (wallet-bridge raw English, hardcoded "$").

## Goal

Every state the money surface shows a player is true, every control it offers works, and
every consequence is disclosed before the player commits money.

## Findings context (verified 2026-08-11; re-verify locations; the offer controller now
lives in `src/ui/hud/woc_trade/` after phase 01)

- H13 (was `hud.ts:19117`, `trade_woc_panel.ts:105`, `woc_market_window.ts:800`): the
  seller cannot decline an incoming offer (dead wiring) and cannot cancel a directed
  listing (the PRD's own mitigation, unreachable); ANY closed listing renders "settled"
  and a false "You have received a payment"; Activity pay rows never name the item; the
  p2p Pay flow skips the quote-review panel; there is no pre-bid "bids cannot be
  withdrawn" disclosure.
- Wallet-bridge failures render raw English `err.message`; `wocUsdText` concatenates a
  hardcoded "$" instead of Intl currency formatting.

## Deliverables

1. Working seller controls: decline an incoming offer and cancel a directed listing,
   wired end to end (any server command phase 06 noted as missing lands here; both rails
   respect the phase 02 settlement-aware guards).
2. Truthful outcome states: closed-unsold, cancelled, expired, and settled render
   distinct honest text; "You have received a payment" appears ONLY when a payment
   actually settled; a confirming buy-now says confirming, not complete; Activity pay
   rows name the item.
3. Informed commitment: the p2p Pay flow passes through the quote-review panel; a
   pre-bid disclosure states bids cannot be withdrawn before the first bond charge.
   Per ruling R9 (state.md; ask at session start if unresolved): the trade window's
   $WOC arm gains its terms affordance (the Exchange window's checkbox is the model)
   so the offer send and pay arm stop hard-coding acceptTerms while showing nothing;
   use the language phase 07's drafts adopted.
4. Localized money surface: wallet-bridge failures map to `t()` keys (raw `err.message`
   never renders; the message still logs for devs); `wocUsdText` uses the Intl-based
   money formatter everywhere it prints.

All view logic lands in the woc_trade view-core (or sibling pure cores) with unit tests;
painters stay thin.

## Out of scope

Visual design polish and screenshots (phase 15); new marketplace features.

## Validation

`npx tsc --noEmit`; view-core and command tests; the S3 guard
(`tests/localization_fixes.test.ts`); `npm run ci:changed`; commit, then
`node scripts/gate_select.mjs`.

## Reviewers

`frontend-seam-reviewer`, `cross-platform-sync` (any new command/wire),
`test-coverage-auditor`. `qa-checklist` last.

## Acceptance criteria

- [ ] Decline and cancel work end to end (tests at command and view-core level)
- [ ] The four outcome states render distinct truthful text; false payment line gone
- [ ] Pay flow shows quote review; pre-bid disclosure precedes the first charge
- [ ] Zero raw wallet-bridge English; zero hardcoded currency symbols (grep proves it)
- [ ] Every new string is an English catalog key; S3 green

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-14-qa.md`.

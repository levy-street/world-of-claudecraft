# Referral cards HUD

`ReferralCardsController` consumes a server-projected snapshot and sends typed intents
through its injected host. It never awards items, decides eligibility, or mutates cards.
`referral_cards_view.ts` owns DOM-free stamp and participant decisions. `types.ts` is
the narrow DOM host contract and re-exports the shared `sim/referral_contract.ts`
snapshot and actions. `createReferralCardsHud` composes it through IWorld, the shared
window-focus bridge, and the HUD's slow cadence. The quest log links to the bounded
cards page; the launcher count and title ownership come from account-wide projections.

The controller is cold chrome driven by a snapshot revision. The launcher is updated
only on revision changes, including while the window is closed. Stamp animation is
cosmetic, uses the browser animation API with reduced-motion support, and is followed
by an explicit redeem button. Animation completion never claims a reward.

Dialogs use `installPromptDialog`; the parent owns window focus and Escape handling.
Call `relocalize()` on locale changes and `destroy()` on teardown. Every notification
has a server identity, so rendering a repeated snapshot does not repeat a prompt.
Animation and prompt history retain only the current bounded page and notice batch.
The real-browser fixture in `scripts/referral_cards_screenshots.mjs` verifies desktop,
portrait and landscape fit, touch-target sizing, explicit redemption and focus return.

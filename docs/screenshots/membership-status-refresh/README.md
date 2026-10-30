# Membership status refresh

Component captures from PR4668's existing membership layout, using the real
`subscriptionOffersHtml` renderer and game styles. The before renderer comes from
`6f4febdce186b740e8ad304f48876424c7791d55`. Fixtures use a pending monthly checkout
and a confirmed monthly trial; no Stripe checkout or payment was created.

| Viewport | Before | Pending confirmation | Confirmed |
| --- | --- | --- | --- |
| Desktop, 1440 x 1000 | [Before](before-desktop.png) | [Pending](pending-desktop.png) | [Confirmed](confirmed-desktop.png) |
| Mobile portrait, 390 x 844 | [Before](before-mobile.png) | [Pending](pending-mobile.png) | [Confirmed](confirmed-mobile.png) |
| Mobile landscape, 844 x 390 | [Before](before-landscape.png) | [Pending](pending-landscape.png) | [Confirmed](confirmed-landscape.png) |

Chromium reported no page errors or horizontal overflow in any capture (see
`verification.json`). The smaller viewports show the top of the scrollable store.
`tests/store_membership_refresh.test.ts` exercises the actual store timer, delayed
confirmation, unchanged DOM, focus, scroll, account changes and request suppression.
Screen-reader announcement output and live Stripe plan changes were not manually tested.

PR4678's newer artwork and reward dialogs are separate changes; they are not imported
into this PR by these screenshots.

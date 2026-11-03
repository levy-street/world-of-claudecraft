# Manage subscription hidden without a subscription

Component fixture captures: the real WOC Store window shell
(`daily_rewards_chrome_view.ts`), the production `subscriptionOffersHtml` renderer and
the shipped styles, with a synthetic canceled account that the billing service still
reports as having a billing customer (`canManage: true`) and allows a new checkout.
The before images use `src/ui/store_subscription_offers.ts` from `release/v0.46.0`. No
billing request or live account was involved.

Desktop is 1440 by 900; mobile is 844 by 390. Both pages loaded without browser errors.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop | [Before](before-desktop.png) | [After](after-desktop.png) |
| Mobile | [Before](before-mobile.png) | [After](after-mobile.png) |

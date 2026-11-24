# Memberships tab and purchase dialogs

Component captures: the production `StoreSubscription` renderer inside the WOC Store
window shell, with the shipped styles and a synthetic active monthly member (both
offers, the token offer). The purchase dialogs use `PurchaseRewardDialogs` and
`showMembershipWelcome` with a fixture token and mount reins parcel. No live billing
session, Stripe request or purchase was involved. Before is `release/v0.45.5`.

Desktop is 1440 by 900; mobile is 390 by 844. Every capture was checked for page
errors and horizontal overflow.

| Surface | Before | After |
| --- | --- | --- |
| Desktop Memberships tab | [Before](before-desktop.png) | [After](after-desktop.png), [scrolled](after-desktop-scrolled.png) |
| Mobile Memberships tab | [Before](before-mobile.png) | [After](after-mobile.png), [scrolled](after-mobile-scrolled.png) |
| Purchase loot window | None (mail only) | [Desktop](loot-desktop.png), [mobile](loot-mobile.png) |
| Membership congratulation | None | [Desktop](welcome-desktop.png), [mobile](welcome-mobile.png) |

# Membership UI verification

These captures use the production component renderers and styles with controlled
character, bank and store data. The before components come from the PR foundation
commit `7eef16c0b11ef6cb5828bacc5ee0e7af220df3d4`. They are component evidence,
not a live payment or multiplayer-world end-to-end test.

Desktop is 1440 by 900. Mobile roster is 390 by 844; bank and store are 844 by 390.
The token-control capture scrolls the mobile shop to its purchase controls.
All captures were checked for browser errors and horizontal overflow. New touch
controls have a 40-pixel minimum target. Browser regressions cover the controls
and membership expiry returning the bank to its Personal tab.

| Surface | Before | After |
| --- | --- | --- |
| Desktop character list | [Before](before-roster-desktop.png) | [After](after-roster-desktop.png) |
| Mobile character list | [Before](before-roster-mobile.png) | [After](after-roster-mobile.png) |
| Desktop bank | [Before](before-bank-desktop.png) | [After](after-bank-desktop.png) |
| Mobile bank | [Before](before-bank-mobile.png) | [After](after-bank-mobile.png) |
| Desktop shop | [Before](before-shop-desktop.png) | [After](after-shop-desktop.png) |
| Mobile shop | [Before](before-shop-mobile.png) | [After](after-shop-mobile.png) |

[Mobile token controls](after-shop-mobile-token.png)

## Trial and annual bundle extension

The extension captures use the same production renderers with both offers and
trial eligibility enabled. All three viewport sizes have no browser errors or
horizontal overflow; checkout controls are 40 pixels high and keyboard reachable.
[Forced-colors evidence](extension-shop-forced-colors.png) shows readable labels,
visible borders and the keyboard focus outline on the monthly checkout control.

| Viewport | Initial offer | Annual offer scrolled into view |
| --- | --- | --- |
| Desktop, 1440 by 900 | [Monthly](extension-shop-desktop.png) | [Annual](extension-shop-desktop-annual.png) |
| Portrait, 390 by 844 | [Monthly](extension-shop-portrait.png) | [Annual](extension-shop-portrait-annual.png) |
| Landscape, 844 by 390 | [Monthly](extension-shop-landscape.png) | [Annual](extension-shop-landscape-annual.png) |

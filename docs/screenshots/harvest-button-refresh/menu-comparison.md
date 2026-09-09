# Harvest preference menu comparison

The menu-before and menu-after images use the production HarvestPreferenceController,
game stylesheets, fonts and item art in an isolated browser HUD fixture. The fixture
selects Rough Hide and supplies the boar's hide, tusk and meat choices.
These are component screenshots, not a connected gameplay session.

Viewports: desktop 1440 x 900, touch portrait 390 x 844, touch landscape 844 x 390.
The full material catalog was also checked with its source details: its body scrolls
while Apply and Cancel remain visible. Permanent interaction and layout regressions
live in tests/browser/harvest_preference.browser.test.ts.

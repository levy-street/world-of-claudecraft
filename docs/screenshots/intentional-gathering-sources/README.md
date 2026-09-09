# Gathering source component previews

These are Chromium component captures using the real gathering-goal view/painter
and shipped styles. The Coppermail Sabatons recipe is real; inventory counts are
a fixture. They are not full-gameplay screenshots.

- Before: PR4 head `1e115547cdcf82df3aa0a69a71f836bd4ff2f012`.
- After: PR5 source-discovery working tree stacked on that PR4 head.
- Desktop: 900 x 750. Mobile: 390 x 850 with the real `body.mobile-touch` class.
- The bounded tracker scrolls vertically when its contents exceed the rail height.

The parent checked real native disclosure clicks, preserved open state and focus
after repaint, no goal/preference callback from source toggles, no horizontal
overflow, native `list-item` markers, at least 24px desktop and 40px mobile summary
hit areas, and working Clear/Set controls. Both panel widths were 238px and
material widths 218px, matching their scroll widths.

| View | Before | After |
|---|---|---|
| Desktop | [before-desktop.png](before-desktop.png) | [after-desktop.png](after-desktop.png) |
| Mobile | [before-mobile.png](before-mobile.png) | [after-mobile.png](after-mobile.png) |

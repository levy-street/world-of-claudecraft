# Courier window

The pure core owns whole-stack selections and invalidates drafts when exact slot
identity changes. The window consumes courier snapshots, owns no inventory, and
submits one request through its injected IWorld callback. Refresh is driven by
Hud's slow band; no timer, layout probe, or direct bank operation belongs here.
The owner's bank is previewed only while the courier is ready. Cargo remains
visible after membership expiry. Closing the window never cancels a journey.

Bank and inventory panes reuse the shared item socket, rarity and owned-item marks.
The center portrait is a static WebP cropped from the supplied-model capture at
`docs/screenshots/membership-courier/donkey-ground.png`; this window creates no
WebGL renderer or animation driver. Portrait layouts stack the
bank, courier and inventory in the same order; each storage grid scrolls independently.

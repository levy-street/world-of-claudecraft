# OSSBrain v0.42.0 integration checks

Captured on 2026-09-08 from candidate `09ffd281f4` integrated with release
`6111e6d206`. Chromium ran the local offline game with ANGLE Metal and
graphics preset 1. Phone-sized captures use the responsive mobile-touch class;
they are browser checks, not physical-device performance measurements.
The repository's `enterOfflineGame` helper dismissed entry overlays.

- Desktop: [Loot Explorer](loot-explorer-desktop-after.webp),
  [Rift encounter labels](loot-explorer-rift-after.webp),
  [Harvest Journal](harvest-journal-window.png), [Perfecting](perfecting-window.png).
- Landscape phone, 844 x 390:
  [prior CSS replay](loot-explorer-mobile-844-before-css-replay.webp) and
  [corrected layering](loot-explorer-mobile-844-after.webp).
- Portrait phone, 390 x 844:
  [orientation guard](loot-explorer-mobile-390-after.webp).
  The game requires landscape; the rotate prompt is intentionally visible.
- [Forced colors](loot-explorer-forced-colors.webp) also retains that portrait
  orientation guard. The browser confirmed `forced-colors: active`.

The **prior CSS replay** is explicitly a controlled reconstruction on the same
integrated client: the earlier unlayered Loot Explorer width, height, flex and
overflow declarations were injected, captured, then removed. It is not a
historical screenshot or a new art approval.

[browser-checks.json](browser-checks.json) records the assertions: world entry,
all three keyboard shortcuts, empty search after opening, truthful Rift labels,
locale and filter-focus preservation, responsive bounds, and forced colors.
No browser JavaScript errors were observed.

[asset-metadata-remint-proof.json](asset-metadata-remint-proof.json) records a
separate 48-GLB check against the pre-remint staged blobs. Substituting each
canonical new fingerprint back to its previous value reproduced the complete
previous file byte-for-byte, including size. This establishes metadata-only
resealing; it does not replace historical capture identities, image scores, or
owner approval.

# Placeholder art completion - visual evidence

Before images were captured from `release/v0.36.0` at
`5819c005a7666f161aee8c0b54d9007c865bb494`; after images were captured from this
worktree. Desktop uses 1600×900 and mobile landscape uses 844×390. The capture scripts
dismiss only the software-renderer notice, wait for lazy Guide images to decode, and
fail on page errors or missing weapon/deed/tooltip surfaces.

The paired PNGs cover:

- bags, equipment, vendor, and item-tooltip weapon art;
- all 27 Guide specialization cards and representative family crests;
- the combat status crest and runtime aura icon routing;
- the Book of Deeds honor-rank and Thornhollow battleground groups;
- all 18 corrected mob portraits in matching labeled contact sheets.

Runtime surfaces were captured with:

```sh
CAPTURE_OUT=docs/screenshots/placeholder-art-completion-2026-08-09 \
CAPTURE_LABEL=after GAME_URL=http://127.0.0.1:5174 \
node scripts/capture_placeholder_art_evidence.mjs

CAPTURE_OUT=docs/screenshots/placeholder-art-completion-2026-08-09 \
CAPTURE_LABEL=after GAME_URL=http://127.0.0.1:5174 \
CAPTURE_MOBILE=1 node scripts/capture_placeholder_art_evidence.mjs

CAPTURE_OUT=docs/screenshots/placeholder-art-completion-2026-08-09 \
CAPTURE_LABEL=after GAME_URL=http://127.0.0.1:5174 \
node scripts/snapshot_weapon_views.mjs
```

The same commands used `CAPTURE_LABEL=before` and the untouched baseline server for
the comparison set. The portrait sheets preserve the manifest order recorded in
`docs/achievements/placeholder-art-completion-2026-08-09/portrait-rerender-evidence.json`.

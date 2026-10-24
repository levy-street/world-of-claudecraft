# Warrior Season 2 icon batch

Fifteen individual paintings replace the procedural inventory icons for the complete
Arms, Fury and Protection Season 2 sets. This local contribution targets
`feature/v045-integration` at `5167aabadeea7b21f0921e6d3973350072428b19`.
The other 120 Season 2 armor pieces remain pending. Map-loot replacements and the
other entries in the icon audit are outside this first batch.

## Art and provenance

Each item has its own generation and exact prompt in [accepted-art.json](accepted-art.json).
Shipping files are opaque 128px WebP, totaling about 44 KiB. Original generations and
512px masters remain in the local ignored `tmp/imagegen/v045-icon-backlog/` directory;
their hashes are recorded in the manifest. These source files are not included in Git.
The same directory contains the local `review.html` gallery.

All fifteen paintings were reviewed at 512, 128, 40, 28 and 22 pixels, plus grayscale
and circular crops. See the [small-size sheet](../../screenshots/warfare-season2-warrior-icons/small-size-review.png).
The asset audit found no exact duplicates and one perceptual candidate: the Arms and
Protection leg armor. Visual review confirmed distinct angular brass/oxblood and
rounded silver/navy designs; their shared paired-leg silhouette is intentional.

## Verification

- `pnpm exec vitest run tests/warfare_season2_icon_art.test.ts tests/item_icons.test.ts --maxWorkers=2 --reporter=dot`: 27 tests passed across two files. The new two-test reproducer failed before integration.
- `pnpm exec tsc --noEmit`: passed.
- `node scripts/item_art_audit.mjs --verify-only`: passed; 2,055 catalog entries, 2,084 live entries and 127 pending art entries.
- `node scripts/icon_asset_audit.mjs docs/achievements/warfare-season2-warrior-icons-2026-10-22/accepted-art.json tmp/icon-audit/warrior-assets --no-sheets`: passed; 15 assets, zero contract issues.
- Explicit Biome checks of the changed source, audit script, tests and accepted-art manifest: passed. `npm run ci:changed` checked zero files because this contribution is uncommitted, so it was not used as lint evidence. The public mapping is excluded by repository Biome configuration and covered by the item-art audit.
- `git diff --check`: passed.
- Independent frontend review: no consequential findings in the resolver, provenance, or small-size artwork.
- In-game inventory captures: all 15 static icon URLs verified on desktop and mobile landscape. [Desktop after](../../screenshots/warfare-season2-warrior-icons/bag-icons-after-desktop.png) and [mobile after](../../screenshots/warfare-season2-warrior-icons/bag-icons-after-mobile.png) show the complete batch. Corresponding before captures and URL reports are in the same directory. The software-rendering warning does not obscure the after icon grids. The before mobile view has a greeting overlay, so its URL report supplies fallback evidence where the grid is obscured.

The full/selective gate, production build and wider browser surfaces have not been
run. This is a locally verified first batch, not a merge-readiness declaration.
No commit, push, merge or deployment has been performed.

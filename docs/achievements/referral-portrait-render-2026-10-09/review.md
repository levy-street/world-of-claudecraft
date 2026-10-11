# Referral portrait job coverage: reviewed renderer remint

The job builder now follows the runtime target-portrait catalog: the four buddy
templates use their existing static portraits, while all 355 generated mob
portraits and all 27 finder thumbnails remain covered. Changing the tracked job
builder requires a real receipt for every generated mob row. No guard exception
or bootstrap bypass was added.

The normal renderer completed all 355 jobs at 128 pixels, with zero failed jobs
and zero page errors. `renderer-receipt.json` is an unmodified copy of its output.

```powershell
$env:PORTRAIT_RECEIPT = 'tmp/referral-portrait-render-receipt.json'
node scripts/render_finder_portraits.mjs
node scripts/build_mob_portrait_source_manifest.mjs --write --receipt tmp/referral-portrait-render-receipt.json --allow-environment-remint
node scripts/build_mob_portrait_source_manifest.mjs --check
```

The prior environment was Darwin/arm64, Chrome 155.0.8059.39, ANGLE SwiftShader
LLVM 10.0.0. The actual new receipt records Windows/x64, Edge 154.0.4258.62,
ANGLE SwiftShader Subzero. This deliberate environment remint preserves the
actual rendered bytes and records their real environment instead of claiming
the earlier environment reproduced them.

All 355 mob images and 24 finder thumbnails changed bytes; three finder images
are byte-identical. No image is missing or changes dimensions. `comparison.json`
records every old/new SHA-256 and the RGBA channel differences for all 382 images.
The maximum mean absolute channel difference is 1.111268 on the 0–255 scale.

All 379 changed before/after pairs were visually reviewed in the ten
[contact sheets](../../screenshots/referral-portrait-render-2026-10-09/).
Each pair shows the previous image on the left and the new image on the right.
The review found matching subjects, poses, framing, backgrounds, and geometry;
no new missing rigs, blank subjects, or clipping regressions were observed.
Differences are minor shading and encoding variation. Existing tight framing,
including the Ysolei finder image, is preserved. These reviewed outputs are
accepted together with their real receipt. The 19 existing corrective portrait
hash pins now name these accepted bytes; their model and tint assertions remain.

The initial images and manifest were preserved in the ignored task backup before
capture. No source model, animation, camera, lighting, or backdrop was edited for
this remint. The earlier historical bootstrap review remains unchanged.

# Referral integration portrait merge

The integration branch added creature models and refreshed portraits after the
referral branch was based. The merge retains those latest model, animation, and
visual mappings. The referral job builder continues to exclude the four buddy
templates whose runtime target portraits use the static `public/ui/portraits`
images. The three upstream `public/ui/mobs/buddy_*.webp` files are therefore
removed as unused duplicates.

The tracked job-builder change requires a fresh renderer receipt for all live
mob portrait rows. The normal `scripts/render_finder_portraits.mjs` pipeline
renders the merged tree. The receipt records the actual Windows Chrome
SwiftShader environment; no receipt, output hash, or source fingerprint is
invented. The latest upstream portraits were selected for conflicting images
before capture and retained in an ignored comparison backup.

Commands:

```powershell
$env:BROWSER_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:PORTRAIT_RECEIPT = 'tmp/referral-portrait-merge-receipt.json'
node scripts/render_finder_portraits.mjs
node scripts/build_mob_portrait_source_manifest.mjs --write --receipt tmp/referral-portrait-merge-receipt.json --allow-environment-remint
node scripts/build_mob_portrait_source_manifest.mjs --check
```

The first attempt with the installed Edge executable exited during browser
startup without rendering images. Chrome ran the same unmodified render script.

The first Chrome pass rendered 353 of 355 jobs, but Windows returned an UNKNOWN
file-open error while writing two images. The pipeline withheld its receipt as
required. A full isolated retry ran after other build and gate readers stopped.
The interrupted retry between those runs did not produce a receipt either.

The isolated run completed 355 of 355 jobs with zero failed jobs and zero page
errors. Its unmodified receipt is `integration-2026-10-12-renderer-receipt.json`.
The normal receipt-backed manifest write and freshness check both passed.

`integration-2026-10-12-comparison.json` records the full before/after hashes and
RGBA comparisons. Of 355 live mob images, 250 remain byte-identical and 105 have
minor environment variations. Eighteen of 27 finder thumbnails differ; nine
remain byte-identical. The only absent files are the three intentionally removed
unused buddy mob images. Maximum mean absolute channel difference is 1.195527
on the 0 to 255 scale. All live images remain 128 by 128 pixels.

All 123 changed before/after pairs were visually inspected in the four dated
contact sheets under `docs/screenshots/referral-portrait-render-2026-10-09`.
Latest upstream subjects, geometry, poses, and framing remain intact; no blank
subjects or additional clipping was observed. The existing tight Ysolei finder
framing remains. Only the Wreck Warden literal acceptance hash changes relative
to the merged test, retaining the upstream warrior model and no-tint assertions.

Validation completed after the final capture:

- `pnpm exec vitest run tests/mob_portrait_source_manifest.test.ts tests/target_portrait_view.test.ts tests/mob_portrait_jobs.test.mjs tests/mob_portrait_render_env.test.ts tests/mob_portrait_background.test.mjs --maxWorkers=2`: 47 tests passed in five files.
- `pnpm exec biome check tests/mob_portrait_source_manifest.test.ts tests/target_portrait_view.test.ts`: passed.
- `git diff --cached --check` over portrait assets, manifest, tests, and evidence: passed.

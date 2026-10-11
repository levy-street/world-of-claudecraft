# Buried Hoard collapsed cavern polish

The larger hoards now read as a roofless cavern: a covered arrival, tall layered rock walls, broken ceiling ledges and hanging roots surround an open fighting area. A welded, flat ground mesh replaces the visible floor stripes with continuous mineral soil and irregular biome patches. Five existing overworld GLBs supply sparse oak, pine, palm, willow and dead-tree silhouettes. Amberfall leaves retain their painted texture with an autumn hue.

Simulation, floor height, collision, seeds, enemies and ordinary Rift rooms are unchanged. Trees keep a conservative rotated-crown clearance from the central lane. Low retains the same enclosing shell and hero trees. Roof, wall and crown cutaways keep the camera-to-player sightline clear at every preset; they restore their original poses as the camera moves away.

## Implementation

- `src/render/hoard_cavern_ground{,_core}.ts`: continuous ground, mineral-to-biome blending, shared grain and reference-counted GPU resources.
- `src/render/hoard_cavern_foliage{,_core}.ts`: immutable GLB extraction, shared materials and geometry, deterministic hero placement and autumn leaf tint.
- `src/render/hoard_cavern_core.ts`, `hoard_cavern_shell.ts`, `hoard_cavern_cutaway.ts`: broken roof, roots, camera sightline tests and per-instance cutaways.
- `src/render/hoard_valley.ts` integrates the siblings behind its existing preparation gate. The renderer changes only the existing update call's arguments.
- Paired tests cover continuous flat geometry, shared resource retirement, preset parity, transformed crown clearance, roof restoration and per-instance cutaways.

No new GLB, dependency, wire field or player-facing text was added. Geometry, textures and shader variants enter through the valley's existing GPU preparation gate. Per-visit resources are released on retirement; asset geometry and materials remain shared.

## Visual evidence

The previous version is preserved in [buried-hoard-valley](../buried-hoard-valley/), from baseline commit `8a4e98605f`. The matching Amberfall entrance comparison is [before desktop](../buried-hoard-valley/legendary-amberfall-day-desktop-ultra.png), [after desktop](legendary-amberfall-day-desktop-ultra.png), [before phone](../buried-hoard-valley/legendary-amberfall-day-landscape-phone-low.png), [after phone](legendary-amberfall-day-landscape-phone-low.png).

`basin/` contains all eight Legendary dig-site zones, Epic Nightbloom and Common Amberfall, each by day and night at desktop 1600x900 Ultra and landscape phone 844x390 Low. Common is an unchanged indoor comparison. The basin view advances the camera beyond the entry to show the ground and trees; it is not the same framing as the entrance comparison. `camera-*` frames use the gameplay chase camera at arrival and at four raised orbit headings.

Captured with the existing treasure-map in-game rig following `.claude/skills/pr-screenshots/SKILL.md`. Desktop Ultra and phone Low deliberately compare graphics presets. No browser assets were replaced with mock renders.

## Performance

[Raw measurements](performance-low-landscape.json): Windows, Ryzen 5 5600, 32 GB, real desktop GPU, headed browser, 844x390 Low, adaptive governor disabled, 25 Legendary Drakelands enemies. Each sample lasts 15 seconds after warmup.

| Scenario | Mean FPS | 1% low FPS | p95 frame | p99 frame | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Open basin | 114.7 | 54.7 | 11.2 ms | 14.3 ms | 0 |
| Raised camera orbit at arrival | 140.9 | 53.9 | 9.7 ms | 14.3 ms | 0 |

The orbit exercises instance-buffer updates as scenery cuts away. These are desktop measurements at phone resolution, not physical-phone measurements. God mode and no-aggro are enabled; this does not benchmark a prolonged boss fight with spell effects.

## Validation

The global `node scripts/gate_select.mjs` passed generated i18n/manifest freshness, SFX, the malware gate and changed-file Biome after import ordering was corrected. Its planner widened to the entire branch suite. That run failed `tests/eastbrook_gameplay_integration.test.ts`, `keeps the fixed-seed world projection stable through wandering and respawn`, after roughly 320 seconds; the remaining full run was stopped after the failure. This is not a clean global gate, and no baseline reproduction establishes the failure's cause.

Final focused run: 61 suites passed, 842 tests passed and 2 skipped. This includes every `rift*.test.ts` and `treasure_vault*.test.ts`, all cavern/valley suites, architecture, monolith budgets and asset/preload guards. `npx tsc --noEmit` and `npm run build:bundle` passed. The build transformed 5835 modules and emitted 1755 hashed media assets.

The focused command was run in PowerShell:

```powershell
$suites = Get-ChildItem tests -File | Where-Object { $_.Name -match '^(hoard_(cavern|valley)|rift.*|treasure_vault.*|architecture|monolith_budget|defer_launcher_preloads|render_glb_replacement_assets|render_asset_preload)\.?.*test\.ts$' } | ForEach-Object { $_.FullName }
npx vitest run @suites --maxWorkers=3
npx tsc --noEmit
npm run build:bundle
```

Frontend/resource and test-coverage reviews were completed. Their camera occlusion, rotated-crown clearance and resource-retirement findings were fixed and covered. Camera frames confirm that the raised camera cuts the roof away and that the normal arrival view retains it. Scenery cutaways are immediate rather than animated fades.

No push or pull request was made. The remaining validation limitations are the failed global gate, physical-phone performance and sustained combat profiling.

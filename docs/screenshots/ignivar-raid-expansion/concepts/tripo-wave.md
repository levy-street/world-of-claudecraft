# Ignivar raid expansion Tripo wave

This is the executable handoff for the six approved concept images. It intentionally
stops before paid work while no rotated `TRIPO_API_KEY` is configured locally. Never use
the credential exposed in conversation.

## Locked contracts

| Job ID | Lane | Shipping path | Face limit | Runtime height |
|---|---|---|---:|---:|
| `raid_ember_sentinel_v1` | creature generation, local KayKit rig | `public/models/creatures/ignivar_ember_sentinel.glb` | 4,000 | 1.85 |
| `raid_crucible_warden_v1` | creature generation, local KayKit rig | `public/models/creatures/ignivar_crucible_warden.glb` | 4,000 | 2.10 |
| `raid_cinder_artificer_v1` | creature generation, local KayKit rig | `public/models/creatures/ignivar_cinder_artificer.glb` | 4,000 | 1.95 |
| `raid_varkhul_forge_master_v1` | creature generation, local KayKit rig | `public/models/creatures/varkhul_forge_master.glb` | 8,000 | 2.90 |
| `raid_varkhul_warhammer_v1` | hammer weapon | `public/models/weapons/varkhul_warhammer.glb` | 800 | 1.45 |
| `raid_varkhul_grand_forge_v1` | prop | `public/models/props/varkhul_grand_forge.glb` | 2,000 | 4.80 |

The four humanoids use the same KayKit manual-rig path because Varkhul must retain a
calibrated `handslot.r` for the separate hammer. Their VisualDefs use `Idle`,
`Walking_A`, `Running_A`, `1H_Melee_Attack_Chop`, `Spellcasting`, and `Death_A`.

Wave ceilings are 27,500 triangles and 4.7 MiB. Individual hard ceilings are 8,000
triangles and 1.5 MiB per creature, 1,500 triangles and 120 KiB for the hammer, and
6,000 triangles and 350 KiB for the forge. All embedded textures ship as KTX2 at 512 px,
and all six GLBs require meshopt.

## Credential and balance gate

From the task worktree, securely configure a newly rotated key through the ignored root
`.env` or the process environment. Do not print it. Confirm presence with a boolean-only
check, then run:

```powershell
node scripts/asset_pipeline/pipeline.mjs balance
```

Stop if balance fails. Every later command reuses the fixed job ID, so completed paid
stages remain resumable under `tmp/asset_pipeline/<job-id>/`.

## Humanoid generation and local rigging

Run each command to the human review stop. The referenced PNG is used directly, so no
second concept task is purchased.

```powershell
node scripts/asset_pipeline/pipeline.mjs creature --name ignivar_ember_sentinel --image docs/screenshots/ignivar-raid-expansion/concepts/ignivar_ember_sentinel.png --rig-type biped --height 1.85 --face-limit 4000 --job raid_ember_sentinel_v1 --new-job --until generate
node scripts/asset_pipeline/pipeline.mjs creature --name ignivar_crucible_warden --image docs/screenshots/ignivar-raid-expansion/concepts/ignivar_crucible_warden.png --rig-type biped --height 2.10 --face-limit 4000 --job raid_crucible_warden_v1 --new-job --until generate
node scripts/asset_pipeline/pipeline.mjs creature --name ignivar_cinder_artificer --image docs/screenshots/ignivar-raid-expansion/concepts/ignivar_cinder_artificer.png --rig-type biped --height 1.95 --face-limit 4000 --job raid_cinder_artificer_v1 --new-job --until generate
node scripts/asset_pipeline/pipeline.mjs creature --name varkhul_forge_master --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_forge_master.png --rig-type biped --height 2.90 --face-limit 8000 --job raid_varkhul_forge_master_v1 --new-job --until generate
```

Inspect `preview_model/front.png`, `right.png`, `back.png`, and `hero.png` for each job.
Reject missing limbs, fused hands, silhouette drift, unreadable cores, thin card-like
armor, or a model that is not a real T-pose. Regeneration must use `--redo concept` on the
same job and must be approved before proceeding.

After approval, rig the existing `raw.glb` locally in the same job ledger. This preserves
the Tripo task receipt while adding the KayKit skeleton, clips, and handslots at zero
additional API cost.

```powershell
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw tmp/asset_pipeline/raid_ember_sentinel_v1/raw.glb --name ignivar_ember_sentinel --job raid_ember_sentinel_v1
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw tmp/asset_pipeline/raid_crucible_warden_v1/raw.glb --name ignivar_crucible_warden --job raid_crucible_warden_v1
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw tmp/asset_pipeline/raid_cinder_artificer_v1/raw.glb --name ignivar_cinder_artificer --job raid_cinder_artificer_v1
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw tmp/asset_pipeline/raid_varkhul_forge_master_v1/raw.glb --name varkhul_forge_master --job raid_varkhul_forge_master_v1
```

Inspect every static angle and every clip PNG. For Varkhul, also inspect
`preview/held_attack.png`: the test hammer must follow the right hand through the attack
without a 90-degree roll, hand penetration, or visible wrist separation. Then run:

```powershell
node scripts/asset_pipeline/pipeline.mjs qa --job raid_ember_sentinel_v1
node scripts/asset_pipeline/pipeline.mjs qa --job raid_crucible_warden_v1
node scripts/asset_pipeline/pipeline.mjs qa --job raid_cinder_artificer_v1
node scripts/asset_pipeline/pipeline.mjs qa --job raid_varkhul_forge_master_v1
```

Each QA must report PASS. Preserve `job.json`, `job.log`, `qa.json`, raw GLB, final GLB,
and previews in the job directory until the contribution merges.

## Hammer and forge

Generate both static models only to the model review stop:

```powershell
node scripts/asset_pipeline/pipeline.mjs weapon --name varkhul_warhammer --family hammer --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_warhammer.png --face-limit 800 --job raid_varkhul_warhammer_v1 --new-job --until generate
node scripts/asset_pipeline/pipeline.mjs prop --name varkhul_grand_forge --height 4.80 --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_grand_forge.png --face-limit 2000 --job raid_varkhul_grand_forge_v1 --new-job --until generate
```

Approve the hammer only if the grip, shaft, striking face, and wedge peen are distinct and
the heavy end is at the top. Approve the forge only if it is a true volume, floor-seated,
front-facing, and the anvil remains physically connected and usable from the arena side.

Resume the approved jobs without redoing generation:

```powershell
node scripts/asset_pipeline/pipeline.mjs weapon --name varkhul_warhammer --family hammer --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_warhammer.png --face-limit 800 --job raid_varkhul_warhammer_v1
node scripts/asset_pipeline/pipeline.mjs prop --name varkhul_grand_forge --height 4.80 --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_grand_forge.png --face-limit 2000 --job raid_varkhul_grand_forge_v1
node scripts/asset_pipeline/pipeline.mjs qa --job raid_varkhul_warhammer_v1
node scripts/asset_pipeline/pipeline.mjs qa --job raid_varkhul_grand_forge_v1
```

Review the hammer's all-class held previews and the forge turntable. If orientation is
wrong, resume the same job with `--flip` for the hammer or `--rotate-y <degrees>` for the
forge. Repeat the exact correction flag on every later resume.

After PASS, apply only these two static lanes. The pipeline copies the GLBs and appends
their exact CREDITS rows idempotently.

```powershell
node scripts/asset_pipeline/pipeline.mjs weapon --name varkhul_warhammer --family hammer --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_warhammer.png --face-limit 800 --job raid_varkhul_warhammer_v1 --apply
node scripts/asset_pipeline/pipeline.mjs prop --name varkhul_grand_forge --height 4.80 --image docs/screenshots/ignivar-raid-expansion/concepts/varkhul_grand_forge.png --face-limit 2000 --job raid_varkhul_grand_forge_v1 --apply
```

## Humanoid finalization

The existing `scripts/assets/ignivar_herald/finalize_kaykit.mjs` was inspected first. It
contains Ignivar-specific rigid-head selection, VFX sockets, clip authoring, task ID, and
fingerprint inputs, so it must not be reused or generalized for this wave.

Add one asset-specific finalizer under `scripts/assets/ignivar_raid_expansion/` after the
approved job outputs exist. It must process a fixed four-row table, not accept arbitrary
paths. For each humanoid it must:

1. Open the manual-rig output and retain only the generated `body` and first Rig_Medium skin.
2. Retain the six VisualDef clips plus `Hit_A`; remove unrelated player clips and unused skins.
3. Assert `handslot.r` and `handslot.l`, one skin, floor seating, in-place clips, and the
   per-asset triangle and byte ceilings.
4. Stamp `assetId`, Tripo model and task IDs, KayKit rig method, approved concept hash, and
   a source fingerprint over the finalizer, concept, prompts, durable receipt, manual-rig
   source, optimizer/compressor sources, and lockfile.
5. Write only the four fixed destinations under `public/models/creatures/`.
6. Run texture compression with the existing KTX installation. On this Windows host:

```powershell
$env:PATH = "C:\Users\el_en\.codex\tools\ktx-4.4.0\bin;$env:PATH"
node scripts/assets/compress_glb_textures.mjs public/models/creatures/ignivar_ember_sentinel.glb public/models/creatures/ignivar_crucible_warden.glb public/models/creatures/ignivar_cinder_artificer.glb public/models/creatures/varkhul_forge_master.glb
```

7. Append four idempotent CREDITS rows through the existing
   `scripts/asset_pipeline/lib/integrate.mjs` `appendCreditsRow` helper. Do not rewrite any
   audio row.

Write a durable `generation-receipts.json` beside this document containing, per job, the
concept SHA-256, Tripo model version, every task ID, actual credits consumed, raw GLB hash,
final GLB hash, QA verdict, and approval date. Never include an output URL or credential.

## Shipping gate enabled after Tripo

Only after all six final GLBs exist, replace the concept-only asset test with the final
GLB contract assertions. The enabled gate must prove exact file hashes and bytes, per-file
and aggregate triangles, meshopt, KTX2 textures, one skin and KayKit clips on every
humanoid, calibrated handslots on Varkhul, the hammer grip convention, forge floor seating
and centering, source-fingerprint equality, media-manifest hashes, and CREDITS coverage.

Then regenerate the media manifest once, outside this worker's current ownership:

```powershell
node scripts/build_media_manifest.mjs generate
```

Finish with standalone raw and shipped previews, `qa --job` for all six jobs, focused
asset tests, typecheck, asset budget, and the repository contribution gate.

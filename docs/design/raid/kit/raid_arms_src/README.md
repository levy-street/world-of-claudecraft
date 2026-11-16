# The raid's five weapon appearances: sources

The painted models behind the Smith's Heart weapon appearances
(`public/models/weapons/<model>.glb`, skins in `src/sim/content/weapon_skins.ts`), built the
raid's trash bodies' way (`../raid_mobs_src/README.md`): a ChatGPT turnaround sheet, a Tripo
multiview build, then a local script that puts the mesh into the game's held-weapon shape.
They replace the first pass, the procedural models of `scripts/assets/smith_heart_arms/`, which
no longer builds what ships and is kept as the design reference each sheet was drawn from.

`sheet_<model>.webp` is each weapon's sheet as WebP, `prompts.json` holds every sheet's exact
prompt, `arms.json` holds each model's fit, and `normalize.mjs` is the script that wrote the
shipped GLBs. The style boards, the split views and the Tripo downloads stay local
(`tmp/raid_arms_painted/`), like the trash bodies'.

| Weapon | Skin | Model | Sheet | Tripo P2 task | Face limit | Tripo texture task | Credits |
|---|---|---|---|---|---|---|---|
| Seamcaller | `seamcaller_maul` | `seamcaller_maul` | `sheet_seamcaller_maul.webp` | `4236931b-0f88-4f30-9c2b-95862b0f8fae` | 4000 | `df39912f-07ee-4371-9bce-f9c26f05b24b` | 120 |
| Squallcrest | `squallcrest_sword` | `squallcrest` | `sheet_squallcrest.webp` | `41b93f1d-e7b1-444e-90a4-e4d010433df1` | 3000 | `4e9e5900-d1c6-4840-965a-c08fe5304665` | 120 |
| Rimelight Staff | `rimelight_staff` | `rimelight_staff` | `sheet_rimelight_staff.webp` | `0dfff579-5694-4355-88c4-effa9d09d975` | 3500 | `5ae7c349-ff89-405d-bf33-b890f7c3b13e` | 120 |
| Hearthbrand | `hearthbrand_sword` | `hearthbrand` | `sheet_hearthbrand.webp` | `db12f9f5-eb85-4bd6-b78f-a04409b253d9` | 3000 | `27f9dabb-ac17-4794-811a-4f6b6a636319` | 120 |
| Heartmeld Staff | `duskwick_staff` | `duskwick_staff` | `sheet_duskwick_staff.webp` | `280939b6-d2db-4637-964b-45ab5788ecee` | 4500 | `23fcdc04-dbbb-442f-90ae-efdff4a45f71` | 120 |

Credits are 110 for the model and 10 for the texture.

## The sheets

One new ChatGPT chat per weapon with two images attached: a board of the game's own shipped
epic weapons of that family, rendered from their GLBs, as the only style reference; and four
renders of the weapon's first-pass model as the design to keep. No other game's art, names or
terms went in. The prompt is `_shared_open`, then the weapon's `brief`, then `_shared_sheet`
(`prompts.json`): one 3:2 image with FRONT, LEFT SIDE and BACK views on white, with nothing
floating, glowing or detached, so the 3D build gets one solid object and the game's own effect
rig supplies everything that moves.

The Seamcaller's first sheet drew a real historical rune on its cheeks. A follow-up in the same
chat replaced it with an invented mason's mark (a hammer head over a three-stroke zigzag); that
second sheet is the one here.

## The models

1. The sheet split into its three views, each a 1536 square on white.
2. Tripo multiview to model (`P2-20260801`, front, left and back views, textured, `quad` off,
   `orientation: align_image`) at the face limit above: 2,997 to 4,704 triangles.
3. Tripo texture (`v3.5-20260815`) on that model with the same three views as its
   `texture_prompt` images, `pbr` off and `delight` off, so the colour map keeps the sheet's
   painted light instead of a flattened albedo. It also repaired the Squallcrest, whose first
   colour map came back blank grey.
4. `normalize.mjs` with the weapon's row of `arms.json`, run from the repository root:

   ```
   node docs/design/raid/kit/raid_arms_src/normalize.mjs \
     docs/design/raid/kit/raid_arms_src/arms.json <model> \
     public/models/weapons/<model>.glb --double-sided
   ```

   `source` in `arms.json` names the local Tripo download; fetch a task's model again by its
   id to rebuild one.

`normalize.mjs` turns the model so its wide axis lies on X, scales it to `span`, puts the
handle's axis on x = z = 0 from the vertices of `gripBand`, and seats the fist (`fistY`) at
`gripFrac` of the height from the foot, so the hand closes on the leather wrap. The foot's
depth below the fist is pinned in `tests/smith_heart_raid_arms.test.ts`. It writes the shape
the skin host is prewarmed for (`tests/weapon_skin_prewarm_host.test.ts`): one node, one
material, POSITION, NORMAL and TEXCOORD_0, a 1024 WebP colour map, one flat
occlusion/roughness/metal texel block (no occlusion, rough 0.9, metal 0, the painted look of
the game's epic weapons) and a 512 WebP normal map, with no compression extension. The meshes
are not closed, so every material is double-sided and the five models are listed in
`WEAPON_VFX_DOUBLE_SIDED_SKINS` (`src/render/weapon_vfx.ts`).

## The paint and the glow

The game lights a weapon by picking the texels of its colour map inside a hue window
(`src/render/weapon_vfx_emissive_core.ts`). A painted map is full of pale tints of that same
hue (silver with a blue cast, bronze near amber), and they would all glow. Two settings in
`arms.json` keep the glow to the parts meant to burn:

- `glowGate`: inside the hue window, a texel less vivid than `vivid` has its saturation capped
  at `capS`, so only the crystals, gems, bolts and molten cracks pass the game's test.
- `tone` (and `toneVivid` for the glowing paint): values above `knee` are compressed toward
  `cap`, so white silver and cream stone do not bloom into a blank shape under the Armory
  light.

## The effects

Each weapon's effect rig is its `WEAPON_VFX` entry in `src/render/weapon_vfx.ts`, anchored by
fractions of the model's bounding box plus offsets in model units, so the anchors were measured
again on these models. The per-weapon rows of `src/render/weapon_vfx_tuning.ts` hold the
strengths the owner signed off on 2026-11-13: the Seamcaller's crown crystals circle its head on
an oval, the Squallcrest strikes about twice a second, and the Hearthbrand carries embers, a
slow melt and smoke with no flames on its sides.

## Cards and previews

`scripts/armory_thumbs.mjs` renders each store card (`public/ui/store/armory/<skin>.webp`) from
the shipped GLB with its live effect rig. The 128 px previews (`public/ui/weapons/<model>.jpg`)
come from the asset pipeline's `renderWeaponIcon`, like every other weapon's.

# Smaller low armor and under-armor atlases (PR 4360 review, note N3)

The review asked for the low armor atlases and the under-armor atlases to be cut down. Both
are, and the change is visible, so this page shows it.

| Files | Count | Colour atlas, before | After | Download, before / after | Texture memory on a BC7 desktop, before / after |
|---|---|---|---|---|---|
| Low armor pack (`public/models/chars/players/woc/armor/*_low.glb`) | 18 | 1024x1024 | 1024x512 | 4.56 MB / 3.61 MB | 25.34 MB / 12.67 MB |
| Under-armor atlas (`public/textures/skins/woc/*_underarmor.ktx2`) | 16 | 1024x1024 | 512x512 | 1.39 MB / 0.52 MB | 22.37 MB / 5.59 MB |

The texture memory column is arithmetic (8 bits a pixel with a full mip chain, every file
resident), not a device measurement. The medium and top armor files are untouched.

Who sees it: the low armor pack is what every character wears on the Low preset, so armor is
softer there and only there. The under-armor atlas is the cloth suit under the armor, drawn
wherever no armor piece covers it, on every preset.

## Before and after

Shipped above, rebuilt below. The offline client, the local player as every class in both body
types, the idle clip held on its first frame, the time of day held at noon, the same camera.
Both rows come from ONE build: the shipped files were put back under `public/` for the upper
row, so the textures are the only difference. Cells are cut at 1:1 from a 1280x800 viewport and
are never scaled, since a scaled cell would hide exactly the softness this page is here to show.

| What | Sheet |
|---|---|
| Low preset, full kit: the low armor atlases | [low-armor.png](low-armor.png) |
| Low preset, chest piece only: the under-armor suits on arms and legs | [low-under-armor.png](low-under-armor.png) |
| High preset, chest piece only: the under-armor suits under the top-detail armor | [high-under-armor.png](high-under-armor.png) |

## How they are built

- Low armor: the knob is `ATLAS_SIZES.low` in `scripts/assets/woc_character/armor_atlas.mjs`
  (colour 1024x512, emissive 256x128). It is a re-pack at the smaller size, not a squash: cells
  stay square in texels.
- Under-armor: there is no knob. An atlas is the artist's 1024x1024 master scaled to 512x512
  (Lanczos) and encoded by `scripts/assets/compress_standalone_textures.mjs`. That puts it at
  the texel density of the body's own map, which it swaps onto.

Both sizes are pinned as literals by `tests/woc_texture_budget.test.ts`, so a rebuild at the old
size fails there, and every shipped file is hash-pinned by
`scripts/assets/woc_character/export_split.json`.

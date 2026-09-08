# Hero spell atlas production handoff

These assets were authored in Blender 5.2.1 for three separate material families, using a built-in ImageGen production reference saved alongside the sources. The reference has a visible backdrop and glow despite the request; it is guidance only and contributes no pixels to the runtime atlases.

The animation uses authored analytic density fields and geometry. It is **not a fluid simulation**. Fire combines an advected multiscale volume with localized combustion radiance, cooling smoke, and ballistic embers. Frost combines an outward crown of irregular faceted crystals, fractured plates, flying splinters, and low cold vapor. Healing uses a deformed, folded liquid sheet with a curled lip, geometric filaments, view-dependent transparency, and ballistic stretched droplets.

## Runtime contract

- `pyroblast_atlas.webp`, `frost_nova_atlas.webp`, `chain_heal_atlas.webp`
- Each is 4096 × 4096, 8 × 8 cells, 64 frames, 30 fps, one-shot duration 2.1333 seconds.
- Each tile is 512 × 512 with 8 transparent gutter pixels on every side. Content is 496 × 496.
- Frame order is row-major, left-to-right, top-to-bottom, zero-based.
- RGB is rendered sRGB color and lighting, with localized authored fire/healing emission. Alpha is linear, straight/unassociated opacity and is preserved losslessly in WebP.
- No bloom, environment, ground plane, contact shadow, typography, UI, or arena is baked.
- Use linear filtering, clamp sampling, and disable atlas mipmaps. Zero-alpha color is extended four pixels around the silhouette to avoid dark fringes with linear filtering.
- Either premultiply once in the shader and blend `ONE / ONE_MINUS_SRC_ALPHA`, or use consistently configured straight-alpha blending.
- An inset content UV rect for frame `f` is `(((f % 8)*512+8)/4096, (floor(f/8)*512+8)/4096, 496/4096, 496/4096)` in top-origin image coordinates. Flip the vertical coordinate once if the engine requires bottom-origin UVs.

Content-space origin pivots, with y measured down from the content top:

| Family | Pivot | Orthographic frame width/height |
|---|---|---|
| Pyroblast | `(0.5, 0.79450047)` | 6.70 world units |
| Frost Nova | `(0.5, 0.64255944)` | 7.25 world units |
| Chain Heal | `(0.5, 0.69388533)` | 6.30 world units |

Use the content pivot when sampling the inset content rectangle. Separate tile-space pivots are stored in the JSON for renderers that sample entire cells.

## Auxiliary maps

No normal, separate lighting, or motion-vector atlas is supplied. There is no encoding/scale/Y convention to apply to such maps. Do not reinterpret beauty channels as normal or vector data. A volume has no unique surface normal, and optical-flow estimates would not satisfy a correct motion-vector contract. Runtime frame crossfading remains valid.

## Editable sources and validation

`bake_hero_assets.py` builds and saves the three `.blend` scenes. Shape keys preserve the liquid-sheet animation; node and object keyframes preserve the fire and crystal animation. Individual source renders are retained as RGBA16 PNGs at 744 × 744. The 4096 × 4096 master PNG atlases are lossless RGBA8 derivatives for packaging.

`package_hero_assets.py` packs the renders, downsamples with premultiplied-alpha filtering, builds light/dark contact sheets and animated previews, records every frame's alpha bounds, and checks empty endpoints, unclipped edges, and exact decoded WebP alpha. An optional `--budget-bytes` applies a WebP size limit. It changes no visual structure from Blender.

The final WebP fallbacks retain quality 90 and total 6,696,396 bytes. The original six-megabyte WebP target was superseded by the integration decision to generate KTX2 runtime textures from these lossless masters and recover hosting room elsewhere. KTX2 encoding, vertical orientation, GPU compression and browser compositing are owned by the integration task.

`hero_asset_manifest.json` is the compact integration manifest. The per-family `_metadata.json` files include per-frame statistics, phase ranges, origin pivots, camera-plane bounds relative to the origin, color/alpha contract, file sizes, and validation results. `delivery_validation.json` records source PNG bit depth, integrity hashes, decoded alpha checks, temporal opacity metrics, and preview decode validation. `hero_effects_preview.mp4`, the animated WebP, and the contact sheets are review artifacts, not runtime files.

Rebuild with Blender in background mode, `--python bake_hero_assets.py -- --mode full --effect all --samples 64 --resolution 744`, then run `package_hero_assets.py` with Python/Pillow/NumPy and FFmpeg on PATH.

# Masterwrought Phase 06 art provenance (2026-08-11)

Provenance and accepted-output record for the original art assets the
inscription base catalog shipped. All are project-owned originals authored
in-repo (hand-written SVG compositions, rasterized and encoded through the
owning converter pipelines); no external generation service, source pack, or
third-party reference was used. This file is shared by the phase 06 agents:
extend it by appending a section, never by rewriting an existing one.

## Deed crests

The three inscription milestone crests, each an in-repo hand-written SVG in
the phase 05 deed-crest family style (blackened bronze medallion, antique-gold
double rim, four cardinal spikes, diagonal rim studs, deep blue field), with
only the inset subject changed per deed. Each source was rasterized at 512px
RGBA with sharp (density 72, the SVG's intrinsic 512px size) and ingested via
`npm run assets:deeds` (`scripts/convert_deed_icons_webp.mjs`), which
downscales to the served 128px WebP and regenerates `src/ui/deed_image_ids.ts`.
Unlike phase 05, the committed sources live under `deeds/<deedId>.svg` in this
directory and are byte-identical to the rendered bytes (the title element is in
the authoring bytes, no post-render amendment). All three encoded crests
measure alpha bounds 11..116 on both axes, ink center exactly (63.5, 63.5),
coverage 0.5073, matching the phase 05 rare-crest geometry exactly.

- Asset: `public/ui/deeds/prog_inscription_rare.webp` (Written in Fine Ink,
  the inscription rare-tier milestone; an ink quill in the rare-blue register
  over an open scroll with fine ink script, on the rare-blue enamel field)
  - Accepted sha256: `a165b790da1fb23e97bf4824df7595383ea14550a4f566e583054d113abe9368`
  - Accepted bytes: 4920 (128x128 WebP, alpha, q82 encode)
  - Committed source: `deeds/prog_inscription_rare.svg`, sha256
    `2335facbfef1c75f880de88306433721c7e419a7ce697bccd0eac945f6637bed`
- Asset: `public/ui/deeds/prog_inscription_50.webp` (Quill and Pigment, the
  50-skill milestone; a crossed pale-gold quill and pigment brush with a
  crimson pigment tip over a crimson swash, under the warm 50-family glow)
  - Accepted sha256: `a9dc7528e104550baf7bed4f864fee96cb68d90e60fe6a9385bae65f18de9ab4`
  - Accepted bytes: 4794 (128x128 WebP, alpha, q82 encode)
  - Committed source: `deeds/prog_inscription_50.svg`, sha256
    `a160a33e57e8922155f98bc59b98c0fee6d7714d353063b56e873309f283598d`
- Asset: `public/ui/deeds/prog_grandmaster_inscription.webp` (Grandmaster
  Inscription, the 125-cap milestone; a grand illuminated tome, crimson cover
  with gilded border, corner fittings, clasp, and a gold rosette sunburst,
  inside the grandmaster laurel wreath of the phase 05 grandmaster crest)
  - Accepted sha256: `cee13b0815db111d330e11cc29773f6ab6d9c793ba1e5b47b04d56d74057498e`
  - Accepted bytes: 5392 (128x128 WebP, alpha, q82 encode)
  - Committed source: `deeds/prog_grandmaster_inscription.svg`, sha256
    `43b56c0f66333738e05f203510b3e5dc71c338ab88e9fa4684c3dfffea5e20ce`

The accepted WebP hashes above are the authoritative pins; they are mirrored
by `ACCEPTED_PHASE06_CREST_SHA256` in `tests/deed_icons.test.ts` (the PR #3295
authored-art lesson: the contract is pinned beside the blob, and a re-encode
moves BOTH the pin and this record after re-review, never the pin alone).

## Item icons (2026-08-11)

Six placeholder originals in the `woc-item-icon-v1` house style (one hero
object on the opaque dark house ground with a top-left key light and a
grounded contact shadow) for the inscription base catalog: three bound
volumes (the Sheenleaf Primer in the uncommon silvery-green leather register,
the Goldleaf Folio in gilded gold-leaf brown, the Sunpetal Grimoire in the
rare-blue register under a radiant sun-petal seal) and three rolled parchment
scrolls (silver-green ribbon tie, gold wax seal, radiant sun-petal wax seal).
Each is a distinct hand-written SVG authored at the 128px shipping square.
Unlike the phase 05 item icons (whose authoring SVGs were not retained), the
committed sources live beside this file as `<itemId>.svg` and are the exact
bytes that rendered the shipping art; `rasterize_item_icons.mjs` (run from
the repo root with `node`) supersamples each at 4x, downscales to 128px,
flattens onto the opaque ground, strips alpha, and encodes with the item
converter's tuned q82 WebP settings, verifying geometry, opacity, colorspace,
the 15 KiB budget, and byte-uniqueness. Provenance rows live in
`public/ui/items/mapping.json` (the `masterwrought-phase06-inscription`
`woc_original_svg` batch, placeholder license pending commissioned painted
icons); audit admission lives in
`docs/achievements/item-art-consistency-2026-08-09/` (counts 834 to 840 art
files, 849 to 855 live items). Review evidence: each icon was inspected at
128px and a 22px downscale (identity, silhouette, and register all hold; the
three books and three scrolls stay distinct at both sizes).

| id | accepted sha256 | bytes |
|---|---|---|
| silverleaf_primer | `320bc483406dc83ac4887a709b49b1f3d2eaf4d82b12d722aa61613fbdb6fedd` | 1348 |
| goldleaf_folio | `05e6336c571307025403bed93d3d0ce9e1cc6b99c2011054bb9cc60de4108213` | 1662 |
| sunpetal_grimoire | `7a580b1114d9cdf19e2790c8de1b1185f23756d1d9df5fb8279219c4cbcca344` | 1966 |
| silverleaf_scroll | `cc8cf8dc576cf7608a7c28350eb1a5f4973e34be86e996d4bd7e2b90b4111cfa` | 1282 |
| goldleaf_scroll | `ffd5d9630440c1b674bccdda32bf4c9c18800de65b62295c270e15d22bd9095c` | 1270 |
| sunpetal_scroll | `75141f7d9123abd14eac8205e33bb89a78a0e9aa333cc0d212f0d1e7e3df7aa8` | 1392 |

The two silverleaf ids display the Sheenleaf register (Sheenleaf Primer,
Sheenleaf Scroll); ids are frozen and keep silverleaf, matching
`silverleaf_herb` whose display is Sheenleaf.

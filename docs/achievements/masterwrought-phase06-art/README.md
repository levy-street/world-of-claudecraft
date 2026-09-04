# Inscription deed and tome source provenance

Provenance and accepted-output record for the inscription deed art and retained tome inputs.
All shipping art is project-owned and was authored in-repo; no external generation service,
source pack, or third-party reference was used.

## Deed crests

The three inscription milestone crests, each an in-repo hand-written SVG in
the phase 05 deed-crest family style (blackened bronze medallion, antique-gold
double rim, four cardinal spikes, diagonal rim studs, deep blue field), with
only the inset subject changed per deed. Each source was rasterized at 512px
RGBA with sharp (density 72, the SVG's intrinsic 512px size) and ingested via
`npm run assets:deeds` (`scripts/convert_deed_icons_webp.mjs`), which
downscales to the served 128px WebP and regenerates `src/ui/deed_image_ids.ts`.
The superseded SVG masters are recoverable from commit
`dc302206596eed5b1b0793e6d210918e70173448`. All three encoded crests
measure alpha bounds 11..116 on both axes, ink center exactly (63.5, 63.5),
coverage 0.5073, matching the phase 05 rare-crest geometry exactly.

- Asset: `public/ui/deeds/prog_inscription_rare.webp` (Written in Fine Ink,
  the inscription rare-tier milestone; an ink quill in the rare-blue register
  over an open scroll with fine ink script, on the rare-blue enamel field)
  - Accepted sha256: `a165b790da1fb23e97bf4824df7595383ea14550a4f566e583054d113abe9368`
  - Accepted bytes: 4920 (128x128 WebP, alpha, q82 encode)
  - Historical SVG source: recoverable from commit
    `dc302206596eed5b1b0793e6d210918e70173448`
- Asset: `public/ui/deeds/prog_inscription_50.webp` (Quill and Pigment, the
  50-skill milestone; a crossed pale-gold quill and pigment brush with a
  crimson pigment tip over a crimson swash, under the warm 50-family glow)
  - Accepted sha256: `a9dc7528e104550baf7bed4f864fee96cb68d90e60fe6a9385bae65f18de9ab4`
  - Accepted bytes: 4794 (128x128 WebP, alpha, q82 encode)
  - Historical SVG source: recoverable from commit
    `dc302206596eed5b1b0793e6d210918e70173448`
- Asset: `public/ui/deeds/prog_grandmaster_inscription.webp` (Grandmaster
  Inscription, the 125-cap milestone; a grand illuminated tome, crimson cover
  with gilded border, corner fittings, clasp, and a gold rosette sunburst,
  inside the grandmaster laurel wreath of the phase 05 grandmaster crest)
  - Accepted sha256: `cee13b0815db111d330e11cc29773f6ab6d9c793ba1e5b47b04d56d74057498e`
  - Accepted bytes: 5392 (128x128 WebP, alpha, q82 encode)
  - Historical SVG source: recoverable from commit
    `dc302206596eed5b1b0793e6d210918e70173448`

The accepted WebP hashes above are the authoritative pins; they are mirrored
by `ACCEPTED_PHASE06_CREST_SHA256` in `tests/deed_icons.test.ts` (the PR #3295
authored-art lesson: the contract is pinned beside the blob, and a re-encode
moves BOTH the pin and this record after re-review, never the pin alone).

## Tome model inputs

`silverleaf_primer.svg`, `goldleaf_folio.svg`, and `sunpetal_grimoire.svg` are
retained because their exact paths and bytes feed the deterministic
inscription-tome source fingerprint. Together with the exporter, model
specification, fingerprint helper, and lockfile, they pin the corresponding
shipping GLBs under `public/models/weapons/`.

The accepted painted WebPs supersede the temporary item icons that once came
from these sources. The three scroll SVGs and the placeholder rasterizer were
removed. Do not move or edit the retained tome inputs without running the full
export, optimization, review, and fingerprint pipeline in
`scripts/assets/inscription_tomes/`.

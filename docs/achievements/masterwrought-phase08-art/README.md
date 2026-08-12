# Masterwrought Phase 08 art provenance (2026-08-12)

Provenance and accepted-output record for the nine apex armor item icons and
the apex bag icon the skill-100 rung shipped. All are project-owned originals
authored in-repo (hand-written SVG compositions in the woc-item-icon-v1
register: single subject at roughly 70 percent fill, opaque dark painted
vignette, warm top-left key light, contact shadow, no text); no external
generation service, source pack, or third-party reference was used. Disclosed
placeholders pending commissioned paintings, the same license override as the
phase 05/06/07 siblings in `public/ui/items/mapping.json`.

Each committed SVG source in this directory was rasterized to a 512x512
fully-opaque sRGB PNG master with sharp (`rasterize_item_icons.mjs`, run from
the repo root; unlike the phase 07 sibling it READS the committed sources
rather than composing them in-script) and ingested via `npm run assets:items`
(`scripts/convert_item_icons_webp.mjs`), which validates intake, encodes the
served 128px WebP, and deletes the PNG master, leaving the WebP the shipping
source of truth.

Accepted shipped bytes (sha256 of `public/ui/items/<id>.webp`):

- `spiritweld_girdle.webp` 21698ccab0dbab4b4a2bf6dc3766f8cc60704c595935558e86375714dfbb1699
- `forgefold_legguards.webp` 35ee96eee3d30e9d47af39bec032709bc95d13e0bbfa41807c47a25819619472
- `wardspeaker_sabatons.webp` 9208b4dab4f7986ce04e915e92357fe9da195ab67796a36d199d3388cc8da4a3
- `briarstep_jerkin.webp` 02213db46e96f94b62bf8cbbeb93468e7e110c6ad2c5b53d961eea9a96aa5aab
- `fenbloom_breeches.webp` f0985327e46141d7eaf22b1687d1a53a74aca99510339555cb3a329f8e67417c
- `barksong_handguards.webp` 0ea99cb77dc7aaf9a9757125c53344faa4b017e12aa19511c8b85b6e0e88a27e
- `sunspun_vestments.webp` 341b5e9c6352321599b85cf39e89e13d9229047084be4a5d7177fd5f466f013a
- `sunspun_leggings.webp` 0cffdf151880a660916a87c84464451bbb84465445ab4015391f12a12547210a
- `sunspun_handwraps.webp` 7b88450a1daddb0c126ab5b3bf73ac03c3b9e2664a4a58e2ca8ae52c23bfe53a
- `sunspun_haversack.webp` 56e7afb2be8c9b454d5cb1637046fe8be589d3db172b9b9106e54eb20141c00e

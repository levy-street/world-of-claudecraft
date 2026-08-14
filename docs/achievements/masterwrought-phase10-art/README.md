# Masterwrought Phase 10 art provenance (2026-08-14)

Provenance and accepted-output record for the eight apex consumable and crafting
station item icons the skill-100 alchemy and cooking rungs shipped (three flasks,
three role foods, and the two apex stations). All are project-owned originals
authored in-repo (hand-written SVG compositions in the woc-item-icon-v1
register: single subject at roughly 70 percent fill, opaque dark painted
vignette, warm top-left key light, contact shadow, no text); no external
generation service, source pack, or third-party reference was used. Disclosed
placeholders pending commissioned paintings, the same license override as the
phase 05/06/07/08/09 siblings in `public/ui/items/mapping.json`.

Each committed SVG source in this directory was rasterized to a 512x512
fully-opaque sRGB PNG master with sharp (`rasterize_item_icons.mjs`, run from
the repo root; like the phase 08 and 09 siblings it READS the committed sources
rather than composing them in-script) and ingested via `npm run assets:items`
(`scripts/convert_item_icons_webp.mjs`), which validates intake, encodes the
served 128px WebP, and deletes the PNG master, leaving the WebP the shipping
source of truth.

The acceptance review ran at the 512 master, 128, 40, 28, and 22 px plus 28 px
grayscale. Three compositions were recomposed after that review: the cauldron's
belly and rune band (the band was wide enough to swallow the iron belly, which
then read as a floating brew), the hearth's fire, spit height, and laden board
(the roast and the flame merged into one shape at 22 px), and the skewer sticks
(too thin to survive the downsample, so the fan read as one lump).

Accepted shipped bytes (sha256 of `public/ui/items/<id>.webp`):

- `ironhusk_flask.webp` 8c717b5d4f82d7f7a0d4a7f5ae33fa6b4fbb8da6af9aa10fd5b7fd5ed970ffa0
- `warboar_flask.webp` d8df17ce50834343381091c3e8b635636eb0031ba968b848508a792761be63b4
- `runewater_flask.webp` c0b6a79e49a8ed54322baebe1929e1bf82aba23b0728710c0c24a4569f7e1460
- `stonepot_stew.webp` 914b5be938d251a785cff19797c5894acf7515d85d699a2b51fbf7af97a2a48c
- `warspice_skewers.webp` d56392481000b771361afe91bdec2e4d63232813ba8d1dd9877686ecf9713b3e
- `sageleaf_chowder.webp` f22acafe2e0ceb982e1c45c6b180507ccea4d2c4e1b41de54c8a3c734e57cd98
- `grand_cauldron.webp` 550c750a35801530535fd02e4777e810b20e2bb63aeb669ddec35952dacce5ec
- `laden_hearth.webp` f3b30113525466159ef5df7de4c408740a63fe5fcf8303a448e3dced8de975eb

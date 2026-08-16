# Masterwrought Phase 11 art provenance (2026-08-16)

Provenance and accepted-output record for the 28 apex recipe pattern item icons
(src/sim/content/apex_patterns.ts): the kind:'recipe' drops teaching the 28
apex recipes across the R8 channels (ten raid gear patterns, ten rift armor
patterns, eight Heroic Quartermaster consumable patterns). All are
project-owned originals authored in-repo (hand-written SVG compositions in the
woc-item-icon-v1 register: single subject at roughly 70 percent fill, opaque
dark painted vignette, warm top-left key light, contact shadow, no text); no
external generation service, source pack, or third-party reference was used.
Disclosed placeholders pending commissioned paintings, the same license
override as the phase 05/06/07/08/09/10 siblings in
`public/ui/items/mapping.json`.

The set is ONE parchment-scroll template family: a per-craft-family emblem
inked on the sheet (chestplate for armorcrafting, crossed blades for
weaponcrafting, stretched hide for leatherworking, needle and thread for
tailoring, faceted gem for jewelcrafting, cog for engineering, quill for
inscription, flask for alchemy, steaming pot for cooking), with a per-family
parchment tint, wax-seal color, and ribbon, plus small deterministic per-item
variations (seal tilt, ribbon position, edge tear, rule length) so every
committed WebP is byte-distinct (tests/item_icons.test.ts, "distinct committed
artwork").

Each committed SVG source in this directory was rasterized to a 512x512
fully-opaque sRGB PNG master with sharp (`rasterize_item_icons.mjs`, run from
the repo root; like the phase 08/09/10 siblings it READS the committed sources
rather than composing them in-script) and ingested via `npm run assets:items`
(`scripts/convert_item_icons_webp.mjs`), which validates intake, encodes the
served 128px WebP, and deletes the PNG master, leaving the WebP the shipping
source of truth.

The acceptance review ran at the 512 master, 128, 40, 28, and 22 px plus 28 px
grayscale: the scroll silhouette, family seal color, and emblem all survive the
downsample; at 22 px the family reads from the parchment tint and seal.

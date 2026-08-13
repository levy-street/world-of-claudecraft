# Masterwrought Phase 09 art provenance (2026-08-13)

Provenance and accepted-output record for the ten apex weapon, jewelry, and
tool item icons the skill-100 rung shipped. All are project-owned originals
authored in-repo (hand-written SVG compositions in the woc-item-icon-v1
register: single subject at roughly 70 percent fill, opaque dark painted
vignette, warm top-left key light, contact shadow, no text); no external
generation service, source pack, or third-party reference was used. Disclosed
placeholders pending commissioned paintings, the same license override as the
phase 05/06/07/08 siblings in `public/ui/items/mapping.json`.

Each committed SVG source in this directory was rasterized to a 512x512
fully-opaque sRGB PNG master with sharp (`rasterize_item_icons.mjs`, run from
the repo root; like the phase 08 sibling it READS the committed sources
rather than composing them in-script) and ingested via `npm run assets:items`
(`scripts/convert_item_icons_webp.mjs`), which validates intake, encodes the
served 128px WebP, and deletes the PNG master, leaving the WebP the shipping
source of truth.

Accepted shipped bytes (sha256 of `public/ui/items/<id>.webp`):

- `duskforged_warblade.webp` 976a4528a2cef224fa01d11cefca88286b34e70924404209007eb24dd7df228b
- `duskforged_bulwark.webp` fe7b7f3edb4963922a6c9fb5dc6dad768ab0fc6fbddbe4d90468270b321f6407
- `ridgebreaker.webp` 1a02239ce60961d543195ff774a9951e060519d192122bf64474aa117c21737b
- `wyrmfall_pendant.webp` 31191e8d1aa6be4493b48978850a01677a9a3761f34cff122fe74b6daf377076
- `warhewn_signet.webp` 1cc7afcd621b57c606b4a7b36562da231a14b8bc8ea78e99ae81154b13496319
- `prismglass_loop.webp` 15ee5ca3b34d128d94715e3bec17b592fa5d8e51f2912d07138143b59ab084d8
- `makers_charm.webp` e3ee91cee117eaa89874d90c82bee55d65c467daa9bbfb0a924d66077bcb7bd7
- `gyrelens_array.webp` 2c5a4b049c1afe698864366ece91016961eff359cfe75a0b88f81dddad97f46d
- `masters_field_forge.webp` 349d04f0c0b89c32462ec357a82515545df0c25383a89fb344454b239c656bae
- `voidbound_grimoire.webp` 37cc6556f91c5a67f5b0f36879b65e5d125d11799bff96c5132eed06cc31b4b3

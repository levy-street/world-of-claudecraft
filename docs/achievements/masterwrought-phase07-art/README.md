# Masterwrought Phase 07 art provenance (2026-08-11)

Provenance and accepted-output record for the ten intermediate-material item
icons the skill-75 rung shipped. All are project-owned originals authored
in-repo (hand-written SVG compositions in the woc-item-icon-v1 register:
single subject at roughly 70 percent fill, opaque dark painted vignette, warm
top-left key light, contact shadow, no text); no external generation service,
source pack, or third-party reference was used. Disclosed placeholders
pending commissioned paintings, the same license override as the
wyrmfall/jewelcrafting/inscription siblings in `public/ui/items/mapping.json`.

Each committed SVG source in this directory was rasterized to a 512x512
fully-opaque sRGB PNG master with sharp (`rasterize_item_icons.mjs`, run from
the repo root) and ingested via `npm run assets:items`
(`scripts/convert_item_icons_webp.mjs`), which validates intake, encodes the
served 128px WebP, and deletes the PNG master, leaving the WebP the shipping
source of truth.

Accepted shipped bytes (sha256 of `public/ui/items/<id>.webp`):

- `duskforged_billet.webp` 8ff13ded23b98249119df7fe198a70f22f7d88fe7548dc353cd0c0380098c84d
- `forgefold_plating.webp` 1e4e15c8797ed2239e653b6385dec023ef930810cc520091ea9447c4739ede3c
- `wyrmhide_cording.webp` d8dac026d8f5dd1ec9144357ca83f14b3d7d4d49cc02b5bcc50134b44b94d017
- `sunspun_bolt.webp` 0e84d1eefd24f512c32b98b9569b6f560a1d18c230bb144374c5317b6aba75b7
- `prismglass_setting.webp` f468be833d1b83af07129cda774d10d87622633a1659dcc5887a70f8ca163d63
- `precision_chassis.webp` 3d8aaa7539a291d14dabb0722b1cfd7778d8c4209204fad5828330fd27b303a9
- `quickening_catalyst.webp` 174968cc194de16cdb0ee7eaf9296113ba70c706226f529936b417b7c5fdd9ac
- `seasoned_stock.webp` fb9db4cf0bef1e42fd1e0b00ddbd5da14efebcb72fdbc07d1272be00a1b2f0b3
- `lucent_reagent.webp` 2cd8e1693d9c6ae8e809bbb87489b929985a524ba1709bc6d769836d3e4454ba
- `sablewax_vellum.webp` 27643072a53c69b1afda1a66333cefba93215e8710dfe284fc5fb1399135ccc7

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

Accepted shipped bytes (sha256 of `public/ui/items/<id>.webp`):

- `pattern_barksong_handguards.webp` 82f19a0c65254faf0ea2a8c7b4416d00e7c14423ddd84d09faff2288f62b6373
- `pattern_briarstep_jerkin.webp` 36791a2e86404b7e2bd7858a5c6a930948ef059347f4554c59f1cf0ec00f4cd4
- `pattern_duskforged_bulwark.webp` 1472192dbc6c88d1f0563fc7b8305318f1060d88cfad7eefae94a8772fef30bb
- `pattern_duskforged_warblade.webp` 74195319a34cd8d8efaf89d87c12e9c9b37225ecd9d3872628b03413f336ed50
- `pattern_fenbloom_breeches.webp` abad28dc92c28714b11764d0f11dfcdf3ef90284bd59539620fe2cacc0f05726
- `pattern_forgefold_legguards.webp` 5ac9a7dd53f882580b5a6697bd4c878cf691840d672bdbe51d0fd2cf79f7dce1
- `pattern_grand_cauldron.webp` 46f37fc9975a3e78e03ff9c67966eb208fe131b4b4766f79ffbc5c8125732b14
- `pattern_gyrelens_array.webp` 2210d5857e8d69822668b2fac8dd5a8579da25b552f014665d024431cc31919e
- `pattern_ironhusk_flask.webp` a049956fc62f43e7e02d4eed41b161a402958b4ce29dc5118b34c7f6f2b4d8be
- `pattern_laden_hearth.webp` 5002497aaef4eb28283a2ef601ddb8116ab66407975976d47b67a0c02ee05b03
- `pattern_makers_charm.webp` 1d2db5ec459c540f6c5308e9371978e2931a6fa09fd0e43f748abf88c4a55c37
- `pattern_masters_field_forge.webp` 6a3c404d4bd26e856d6d9f9d4ab8e335d60c12ef7dfb7eb460551cda7f92408e
- `pattern_prismglass_loop.webp` abf0055fcf50c902f4b196b39679ffd6d652653f332e3bd2b2b13f675db8b864
- `pattern_ridgebreaker.webp` 7632638593124d4c83a6be22b4c1185f64ea7124762635244456cbd262a389d2
- `pattern_runewater_flask.webp` fdd09d14110437a04ed5b45203f43af9387d337143add00e552ca213f754257f
- `pattern_sageleaf_chowder.webp` 05e37f86ba141aa5cd663036a66d0ec558e7bcb79f4a93539ec52553c5fb7722
- `pattern_spiritweld_girdle.webp` 1104eec284b93bef825cef71414f30f23987630b6c8dd24ea544dc294c18902d
- `pattern_stonepot_stew.webp` b2fbd74ee921437ed9be1f8359af1ec93b22805c8ebc7b4e97ee4cd013eb3249
- `pattern_sunspun_handwraps.webp` 1532e1ec3816c82ea51cafacb066b6cb86b060840e5104f46c9a7dc0b8329ddc
- `pattern_sunspun_haversack.webp` b6b06c6e758c607c0db185307711868b58a33ee6a5b2b6e104db878ad9942604
- `pattern_sunspun_leggings.webp` 0ab01c389f024be01432d01cf6b89a832e8407395e20752edb65d586224d0e78
- `pattern_sunspun_vestments.webp` 7e677ce0fd2c53211c52ee2f3984d0fe7c0114278ba1775ce69204720999cded
- `pattern_voidbound_grimoire.webp` 9c2b9180166105abc54542ae2ba2d98263be76ab57a212343ebefef0251237f4
- `pattern_warboar_flask.webp` ec43be2fb487a8cfba9e290f2359060f452b9f900c8e0415db86fe912c346be8
- `pattern_wardspeaker_sabatons.webp` 9ceb08c01934f93ce4d84b1cbd1bf5a887bafc44f1f5a1cca1af459fb2298e2d
- `pattern_warhewn_signet.webp` d549fa39c2c06b5f8299438fab16881b28ea613ae5be14d881e97ce78bc7d96e
- `pattern_warspice_skewers.webp` 830c1507890f609f2bb23da5e94ebbebadaab7994194a6d5ce24390e32e40524
- `pattern_wyrmfall_pendant.webp` d9321bca26f6a4005727e79b88982ed06009f768d3038752f71780bd4082db0b

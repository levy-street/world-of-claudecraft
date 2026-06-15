<!-- public/ — static runtime assets (GLB models / textures / HDRIs / VFX) served as-is.
     Area-scoped notes only; root CLAUDE.md covers the repo. Don't duplicate it. -->

# public/ — Static runtime assets

Files served verbatim by Vite (dev) and bundled into `dist/` (prod). Almost all
are CC0 art packs (see `CREDITS.md`). **Most in-world geometry/textures are NOT
here** — the renderer generates them procedurally in `src/render/`; these files
are the imported KayKit/Quaternius/Kenney models plus PBR/HDRI/sprite assets.

## Layout
| Path | Contents | Loaded by |
|---|---|---|
| `models/chars` | 9 character `.glb` (knight, mage, rogue, barbarian, skeletons…) | GLB |
| `models/creatures` | 22 animated creature `.glb` (wolf, dragon, goblin…) | GLB |
| `models/dungeon` | 59 modular dungeon `.glb` (walls, pillars, torches, chests…) | GLB |
| `models/foliage` | 23 nature `.glb` (trees, bushes, rocks, mushrooms) | GLB |
| `models/props` | 38 village/prop `.glb` (anvil, barrel, blacksmith, well…) | GLB |
| `models/weapons` | 19 weapon/shield `.glb` | GLB |
| `textures/terrain` | ambientCG PBR sets (`*_Color/NormalGL/Roughness/AO.jpg`) | texture |
| `textures/water` | 3 water normal maps (MIT, three.js) | texture |
| `env` | 8 HDRIs (`*_1k.hdr` + `*_2k.hdr`) for IBL/sky | RGBELoader |
| `vfx` | 16 particle sprites (`.png`) | texture |

Top level also holds favicons/PWA icons, `manifest.webmanifest`,
`loading-screen.jpg`, logos, and `server-unavailable.html` (static offline page).

## How these are served
- **Runtime loading:** `src/render/assets/loader.ts` (`loadGltf` / HDR / texture,
  meshopt-decoded, promise-cached). URLs resolve through `src/render/assets/media.ts`
  `assetUrl()` — logical path in **dev** (`/models/...`), content-hashed path in **prod**.
- **Build:** `scripts/build_media_manifest.mjs` walks `models/ textures/ env/ vfx/`,
  content-hashes each file, writes `src/render/assets/manifest.generated.ts`
  (`generate`) and copies hashed files to `dist/media/` (`emit`). Both run inside
  `npm run build`.

## Gotchas / never
- GLBs are **meshopt-compressed**; the loader sets the meshopt decoder. Raw
  uncompressed exports won't load — optimize via `scripts/assets/build_assets.mjs`.
- Only `models/ textures/ env/ vfx/` are in the manifest. A new asset category
  needs adding to `MEDIA_ROOTS` in the manifest script, or it won't ship to prod.
- **Don't add large binaries casually** — raw source packs aren't committed; keep
  only shipped, optimized assets. New art ⇒ add an attribution row to `CREDITS.md`.
- Don't reach for a file here when procedural generation already covers it.

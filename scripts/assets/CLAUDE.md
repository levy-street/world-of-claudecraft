<!-- scripts/assets/ — OFFLINE GLB/texture build pipeline. Run by hand, not by
     `npm run build`. Separate from the renderer's runtime procedural geometry
     (src/render/) AND from the media manifest (scripts/build_media_manifest.mjs).
     See ../CLAUDE.md for the rest of scripts/. -->

# scripts/assets/

Offline asset pipeline: optimize raw downloaded model packs into shipping files
under `public/`. Run manually (not part of `npm run build`):
`node scripts/assets/build_assets.mjs scripts/assets/specs/<spec>.json`.

- **`specs/*.json`** declare *what* to build — `{ items: [{ src, out, type, … }] }`.
  `src` is usually under `tmp/asset_src` (raw packs, gitignored); `out` is relative
  to `public/`. Specs: `characters`, `dungeon`, `props`, `textures`, `lookdev`, `foliage`.
- **`build_assets.mjs`** processes each item with `@gltf-transform` + `meshoptimizer`
  + `sharp`: `resample → prune → dedup → (textureCompress) → meshopt`. Types:
  `character`/`static` are geometry-safe (never join/flatten/**simplify** — would
  corrupt rigs/hard edges); `copy` is a byte-for-byte copy (HDRIs, plain textures).
  Clip names (`Armature|Idle`) are stripped to the last `|` segment + deduped;
  `keepClips`/`renameClips`/`maxTex` are optional per item.
- **`build_foliage.mjs`** is a superset for `foliage.json`: adds `weld + simplify`
  (target `ratio`), strips constant-white `COLOR_0`, and hue-rotates leaf textures
  via `recolor` rules. Use this only for foliage.

## Relationship to the rest
- **Output → `public/`** (the GLB/texture/HDRI tree the game loads at runtime).
- **Runtime procedural generation** in `src/render/` is a *separate* path — most
  geometry/textures are generated in-browser; this pipeline only bakes the imported assets.
- The **runtime media manifest** (`src/render/assets/manifest.generated.ts`) is
  generated separately by `../build_media_manifest.mjs`, which content-hashes
  whatever ends up in `public/`. Asset licenses: `CREDITS.md`.

## Never
- Don't add `simplify` to a `character`/`static` item in `build_assets.mjs` — that's
  exactly why `build_foliage.mjs` exists separately.

<!-- scripts/assets/: OFFLINE GLB/texture build pipeline. Run by hand, not by
     `npm run build`. Separate from the renderer's runtime procedural geometry
     (src/render/) AND from the media manifest (scripts/build_media_manifest.mjs).
     See ../CLAUDE.md for the rest of scripts/. -->

# scripts/assets/

Offline asset pipeline: optimize raw downloaded model packs into shipping files
under `public/`. Run manually (not part of `npm run build`):
`node scripts/assets/build_assets.mjs scripts/assets/specs/<spec>.json`.
For reference-image reconstruction and procedural GLB authoring, read the living
`docs/image-to-glb-asset-workflow.md` runbook before adding a model-specific exporter.

- **`specs/*.json`** declare *what* to build: `{ items: [{ src, out, type, ... }] }`.
  `src` is usually under `tmp/asset_src` (raw packs, gitignored); `out` is relative
  to `public/`. Specs: `characters`, `characters_v2`, `skeletons_v2`, `dungeon`,
  `props`, `textures`, `lookdev`, `asset_bits`, `foliage`, `biome_packs`
  (`ls specs/` for the live set). A new asset pack is a new spec JSON, never
  hardcoded paths in the script.
- **`build_assets.mjs`** processes each item with `@gltf-transform` + `meshoptimizer`
  + `sharp`: `resample`, `prune`, `dedup`, `(textureCompress)`, `meshopt`. Types:
  `character`/`static` are geometry-safe (never join/flatten/**simplify**, would
  corrupt rigs/hard edges); `copy` is a byte-for-byte copy (HDRIs, plain textures).
  Clip names (`Armature|Idle`) are stripped to the last `|` segment + deduped.
  Per-item options (`keepClips`/`maxTex`/`attachMeshes`, bulk `srcDir`/`outDir`
  instead of `src`/`out`, a top-level `defaults` block, `--shard i/n`) live in
  `build_assets.mjs`.
- **`build_foliage.mjs`** is a superset for `foliage.json`: adds `weld + simplify`
  (target `ratio`), strips constant-white `COLOR_0`, and hue-rotates leaf textures
  via `recolor` rules. Use this only for foliage.
- **`compress_glb_textures.mjs` is the mandatory FINAL step after ANY exporter run.**
  Every embedded texture in a shipped GLB is KTX2/Basis (`KHR_texture_basisu`) so it
  stays GPU-compressed in memory instead of decoding to a full RGBA bitmap (the decode
  amplification of the old webp embeds is what got the native iOS client jetsam-killed
  at world entry). The exporters above still emit webp; re-running one and committing
  its raw output silently reverts that asset, and `tests/glb_texture_compression.test.ts`
  turns the drift red. Recover with
  `node scripts/assets/compress_glb_textures.mjs && node scripts/build_media_manifest.mjs generate`.
  It needs the `ktx` tool from KhronosGroup/KTX-Software 4.3+ on PATH (no sudo: expand
  the release pkg with `pkgutil --expand-full`, add its `bin/` to PATH). The one
  sanctioned exception, WEAPON_VFX skin models, is excluded automatically (their
  emissive derivation must drawImage the baseColor; see the test header).
- **Per-asset procedural exporters** (`banker_chest/`, `eastbrook_town/`,
  `eastbrook_grand_armoury/`, `eastbrook_mailbox/`, `eastbrook_noticeboard/`) author GLBs
  from reference images: deterministic `model.js` factory, browser `export_entry.js`,
  driver `export_<asset>.mjs`, and a spec with `keepExtras: true`. The condensed procedure
  is the `image-to-glb` skill (`.claude/skills/image-to-glb/SKILL.md`); a new asset copies
  the mailbox/noticeboard archetype (or the town contract-table archetype for a wave),
  never a bespoke pipeline.
- **Source fingerprints are load-bearing.** Eastbrook-era exporters stamp a sha256 over a
  pinned input list (factory/entry/exporter/spec, `build_assets.mjs`, reference
  turnarounds, the shared atlas, and `package-lock.json`) into the GLB extras, and tests
  recompute it live. Any change to a fingerprinted input, including a lockfile-only bump,
  means re-exporting the affected families (`--no-preview`), regenerating the media
  manifest, and re-pinning the sha256/fingerprint literals in tests, docs, and capture
  evidence JSONs in the same change.

## Relationship to the rest
- **Output to `public/`** (the GLB/texture/HDRI tree the game loads at runtime).
- **Runtime procedural generation** in `src/render/` is a *separate* path, most
  geometry/textures are generated in-browser; this pipeline only bakes the imported assets.
- The **runtime media manifest** (`src/render/assets/manifest.generated.ts`) is
  generated separately by `../build_media_manifest.mjs`, which content-hashes
  whatever ends up in `public/`. Asset licenses: `CREDITS.md`.

## Never
- Don't add `simplify` to a `character`/`static` item in `build_assets.mjs`, that's
  exactly why `build_foliage.mjs` exists separately.

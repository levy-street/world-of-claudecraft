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
- **Per-asset procedural exporters** (`banker_chest/`, `eastbrook_town/`,
  `eastbrook_grand_armoury/`, `eastbrook_mailbox/`, `eastbrook_noticeboard/`) author GLBs
  from reference images: deterministic `model.js` factory, browser `export_entry.js`,
  driver `export_<asset>.mjs`, and a spec with `keepExtras: true`. The condensed procedure
  is the `image-to-glb` skill (`.claude/skills/image-to-glb/SKILL.md`); a new asset copies
  the mailbox/noticeboard archetype (or the town contract-table archetype for a wave),
  never a bespoke pipeline.
- **BLENDER-authored assets (`last_bell_crew/`, `warden_hale_statue/`): edit the MESH,
  never generate a shape and fit it over the model.** The `model.js`/browser archetype
  above is a *procedural* pipeline and stays that way; Blender work is not. For anything
  added to an existing body (hair, a beard, an apron, plating, carried weight), derive it
  from the host's OWN faces: copy the faces, displace along their normals, taper the
  offset to zero at the patch rim so the addition matches the surface by construction and
  its edges stay welded flush. `grow_patch` in `last_bell_crew/parts.py` is the primitive.
  A generated shell is unrelated to the surface it sits on and reads as a slab with a hard
  rim however it is tuned, so when a result looks taped on and small parameter changes do
  not help, change the METHOD, not the numbers. Explore in the live Blender session over
  the MCP, editing real geometry and rendering between steps; then bake the settled
  operation into the factory and re-render the HEADLESS output to confirm the two agree.
  Revolve-and-loft builders stay right for hard, genuinely separate props (a bronze
  circlet, a helm crest, an oilskin hat), and wrong for anything organic.
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

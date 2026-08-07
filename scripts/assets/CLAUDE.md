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
  **Held props (weapons, shields) have their own protocol:**
  `docs/design/last-bell-held-prop-workflow.md`. Read it before mounting or
  verifying anything a character carries; it catalogs the five failure modes
  that let a wrong sword grip survive multiple "verified" claims, and the
  authoring/capture/gate workflow that replaced them. In short: derive a candidate
  seat if you like, but the verdict is always FRAMES (three-plus yaws, every clip,
  contact-point crops), never the score that produced it; a human in the live session
  is the final word and is usually faster than another search round; and a settled seat
  is BAKED INTO THE BODY GLB (`"fixed": True` in `cast.py`) rather than re-derived at
  runtime, so the book and the game read one artifact instead of two.
- **`last_bell_crew/` specifics live in `crew.py`'s module docstring:** the BASE BODY
  ROSTER (what each KayKit base can hide, and the welded-part traps, e.g. the druid's
  antlers are part of its head mesh) and the ordered SHIPPING A FIGURE INTO THE GAME
  sequence. Read the roster before picking a base for a new NPC, and the sequence before
  claiming a figure is in the game. **`node scripts/assets/last_bell_crew/ship.mjs <members>`
  is that whole sequence in one command** (export raw, optimize into `public/`, photograph
  the SHIPPED GLB into plates, rebuild the page, regenerate the media manifest) and it is
  the supported way to ship a figure. Run it rather than the steps by hand: a raw export
  will not load at runtime (the loader requires meshopt), `build_assets.mjs` optimizes
  every GLB in its spec's `srcDir` so a shared staging dir silently re-optimizes stale
  raws over shipped models, and photographing before optimizing puts the book back to
  picturing a file that never shipped.
- **Both Blender exporters share the browser archetype's SHAPE**, and only the factory
  differs: deterministic factory -> `tmp/asset_src` raw -> spec -> `build_assets.mjs` ->
  `public/`, except the factory is `model.py` run under `blender --background` (the
  `warden_hale_statue` driver resolves the binary via `BLENDER_PATH`). Run by hand, never
  from `npm run build`, so the toolchain stays off the contributor critical path. The
  exception is earned in both cases by needing an armature evaluator the browser/three
  path does not have: `warden_hale_statue` re-poses and skin-bakes the rigged KayKit
  knight, `last_bell_crew` re-skins and repaints rigged bodies. Prefer the browser
  archetype for anything that is neither.
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

# public/models/chars/

Character rigs and their animation-clip GLBs, consumed by `src/render/characters/`
(see that directory's CLAUDE.md for the rig-merge/skinning pipeline). Subtrees:

- `chars/players/`: player race/class body rigs (plus the `Mech/` subtree).
- `chars/enemies/`: enemy mob body rigs.
- `chars/forms/`: shapeshift form rigs (`metamorphosis.glb`).
- `chars/modular/`: the modular part library (`warrior_modular.glb`, one GLB carrying
  every part; see `src/render/characters/modular.ts`).
- `*_anims.glb` files (ability, hit-variety, swim, bow sets): animation-clip-only
  GLBs that add clips to a static rig file. They are wired via `VisualDef.animUrls`
  in `src/render/characters/manifest.ts` and authored with the
  `blender-anim-pipeline` skill (pose-sample-and-blend via `scripts/anim/*` build
  scripts; Blender is the escalation path).

## Rig rules (the ones that break silently)

- **Never simplify a skinned rig**: simplify corrupts skin weights.
  `scripts/assets/build_assets.mjs` treats the `character` type as geometry-safe for
  exactly this reason; route new rigs through it (or the `asset-pipeline` skill),
  never an ad-hoc `gltf-transform optimize` with simplify flags.
- **Meshopt only, KTX2 textures**: the shared compression truth in
  `public/models/CLAUDE.md` applies in full (a Draco rig silently fails to load;
  `scripts/assets/compress_glb_textures.mjs` is the mandatory texture step and
  asserts skins/animations survive).
- **Verify before committing**: `npx gltf-transform inspect <file>.glb` must show
  `JOINTS_0`/`WEIGHTS_0` and the expected animation clips after any optimization
  pass; a rig that loses its skin or clips is a functional regression, not a size
  win.
- Rigs are by far the largest per-file budget in `public/models/`; do not compress
  one down to prop-tier sizes, rig detail and animation fidelity matter more here.

## Wiring

Bodies, forms, mounts, and clip GLBs all register as `VisualDef` entries (`url`,
`animUrls`, `clips`) in `src/render/characters/manifest.ts`, which maps every sim
identity (class, mob template/family, NPC id, form) onto a rigged asset plus clip
names; `characters/assets.ts` preloads and assembles them.
`manifestUrlsForGraphics` / `characterPreloadUrls` in `manifest.ts` are the preload
source: `characterPreloadUrls` returns the union of both material tiers, keeping
preload tier-independent (`tests/render_asset_preload.test.ts` guards the v0.16.0
"Could not start the renderer" bug class). Manifest regen and naming: the shared
`public/models/CLAUDE.md` (match the adjacent kit's casing; mixed conventions
already exist here).

New bodies come from the `asset-pipeline` skill (rig + base clip vocabulary); new
clips on an already-shipped rig come from the `blender-anim-pipeline` skill.

# Deepglass arena art kit

Procedural Blender authoring for the Deepglass models: the cradle pylon, the
goal gate, the powerup station, the boost vent, and the thrustpack's burner
plume. Everything is generated from these scripts, there is no hand-modelled
`.blend` to keep in sync, so a change to a profile or a bake setting is a re-run,
not a remodel.

Output lands in `tmp/asset_src/deepglass/`, which is exactly what
`scripts/assets/specs/deepglass.json` reads.

## Running

Blender must be **open** with the BlenderMCP addon's server started (sidebar
`N` → BlenderMCP → Connect); the bridge is a plain socket on `127.0.0.1:9876`
and cannot run under `blender --background`. Then, per asset:

```
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_pylon.py
```

`dg_lib.py` is not run directly, each asset script `exec()`s it, because the
addon gives every call a fresh namespace and nothing persists between them.

## The full loop

```
# 1. author + bake (one call per asset, ~2 min each on CPU Cycles)
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_pylon.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_gate.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_station.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_vent.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_plume.py

# 2. optimise into public/
node scripts/assets/build_assets_fork.mjs scripts/assets/specs/deepglass.json  (the fork copy: honours keepAttributes)

# 3. MANDATORY: KTX2/Basis, or the assets ship as webp and the
#    glb_texture_compression test goes red (needs `ktx` 4.3+ on PATH)
node scripts/assets/compress_glb_textures.mjs \
  public/models/deepglass/cradle_pylon.glb \
  public/models/deepglass/goal_gate.glb \
  public/models/deepglass/powerup_station.glb \
  public/models/deepglass/boost_vent.glb

# 4. manifests: runtime media + the editor's placeable-asset catalogue
node scripts/build_media_manifest.mjs generate
node scripts/gen_asset_catalog.mjs
```

## The plume is a different kind of asset

`dg_plume.py` has no textures and no bake, it is pure geometry whose UVs are
DATA, read straight by `src/render/jet_fire.ts`:

| channel | meaning |
| --- | --- |
| `UVMap.x` | where the vertex sits AROUND the plume, 0..1 |
| `UVMap.y` | how far ALONG it, 0 at the nozzle mouth, 1 at the veil tip, past 1 out on the tail |
| `UVData.x` | how far ACROSS a ribbon, 0 on the spine and 1 at the edge |
| `UVData.y` | a per-ribbon seed, so the three do not wobble in lockstep |

Two things in the pipeline will quietly destroy that, and both are handled:

- **`prune` strips vertex attributes no material reads.** Correct for a
  downloaded pack, fatal here, nothing in the GLB references these UVs. The
  spec entry carries `"keepAttributes": true`.
- **`meshopt` quantises positions into a normalised box** and puts the offset
  and scale back on the node, and glTF's V axis runs the other way from
  Blender's. `preparePlumeGeometry` in `jet_fire.ts` bakes the node transform
  back down and un-flips V at load, so object space is the space this script
  authored in, which the shader depends on, because it stretches the plume by
  scaling object-space Y and that only means "out of the nozzle" while the
  mesh's own origin IS the nozzle.

## Things that will bite you again

- **Bake base colour through EMIT, never the DIFFUSE pass.** A metal has no
  diffuse albedo, so a Cycles DIFFUSE bake writes every brass texel near-black
  and the whole kit ships looking like cast iron. `bake_asset` routes the
  Base Color socket through an Emission shader instead.
- **Never assign `image.colorspace_settings` after baking.** On a *generated*
  image that re-runs the generator and silently throws the bake away, you get
  correct-looking bake logs and uniformly black PNGs. Colour space is fixed at
  creation in `_img(is_data=...)`.
- **Cycles on CPU.** The Metal backend crashes Blender 5.1 inside
  `MetalKernelPipeline::compile` while serialising its binary archive.
  `reset_scene()` pins `cycles.device = 'CPU'`.
- **Previews render through EEVEE.** `render_preview()` draws offscreen with
  `draw_view3d` because an uncomposited Blender window never redraws its
  viewport; `RENDERED` shading under Cycles would return before the async
  viewport render produced a pixel, so it swaps the engine for the shot.
- **The window-less context.** Every `bpy.ops` call that reads
  active/selected objects needs `ctx_override()`.

## Scale and orientation contract

The runtime reads all four through `src/render/deepglass_kit.ts`, and the sim
positions come from `src/sim/deepglass/layout.ts`. If you change a dimension
here, that module's placement constants have to move with it.

| model | authored size | origin | axis |
| --- | --- | --- | --- |
| `pylon` | 8.7 yd tall | base of the plinth | +Z up |
| `goal_gate` | 39 yd mouth, 8.2 yd deep | ON the scoring plane | +X = deeper into the goal |
| `powerup_station` | 9 yd tall, 6.6 yd wide | the orb's centre | symmetric top/bottom |
| `boost_vent` | 3.5 yd across | ring centre | +Z through the ring |

The gate is authored around +Z and rotated to +X in `dg_gate.py` before export,
so the GLB's own axis already matches the sim's ring planes at x = ±30.

Node names matter: `deepglass_kit.ts` looks up `vent_cowl` / `vent_rotor` and
`station_frame` / `station_ring_a|b|c` by name so it can spin them
independently. Renaming a Blender object breaks that silently, the part just
stops appearing.

## Editor

All four are in the Studio asset browser under the **deepglass** category
(`gen_asset_catalog.mjs` picks up anything under `public/models/`). Note that
the editor normalises a placed asset to ~2.2 yd at scale 1, so the pylon wants
roughly scale 4 to match the size it is authored at.

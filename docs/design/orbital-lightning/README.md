# Orbital Lightning: Blender VFX study

Blender authoring source and runtime handoff for Tempest Vharok's in-game lightning
ability. The scene uses a stationary placeholder and contains no targeting, damage,
hit detection or combat authority. Those systems live in the deterministic game
simulation; the renderer consumes its cue timeline.

Open `OrbitalLightning.blend` in Blender 5.2.1 LTS. The saved scene is on the first
discharge; press Space to play the timeline and Numpad 0 for the gameplay camera.
Material preview shows geometry; the rendered preview includes lighting and bloom.
`preview.webp` is the compact checked-in visual review. Full PNG sequences, stills,
contact sheets, videos and delivery archives are generated locally and gitignored.

## Art direction and timing

Six condensed white-blue cores sit inside open, counter-rotating electrical
meridians. Negative space between core and shell keeps the silhouette distinct at
gameplay distance. The blue shell, finer unstable arcs, sparse sparks and white
core have separate materials and objects.

The summon lasts 0.65 seconds. Charge lasts 1.8 seconds. The six 0.125-second
discharges start 0.25 seconds apart. A contracting prefire halo identifies the
next firing orb; ground brackets appear 0.65 seconds before their authored preview
impact. Each strike has a white center, cobalt trail, branching arcs, a brief
ground crown, radial ring, sparks and 0.55 seconds of fading ground electricity.
The effect ends after approximately 5 seconds, with no boss translation.

These timings describe the artwork, not authoritative gameplay timings. Snap event
starts and aim points to the actual server encounter contract during integration.

## Editable source

`config.py` groups orb count, orbit radius/height/speed, charge duration, shot delay,
orb size/brightness, horizontal shot reach, lightning thickness, branch count,
impact size, residual duration, global emission intensity, summon/prefire/shot
durations, FPS and random seed. Adjust it and regenerate. Root custom properties
record the baked settings; editing those properties alone does not rebuild geometry
or retime existing keyframes.

`build.py` constructs the effect, `primitives.py` holds the reusable geometry and
animation helpers, and `preview.py` holds only the presentation scene. The source
is also embedded as Blender text blocks. Animation uses native keyframes, curve
point animation, material emission and object transforms, without simulations,
frame handlers or external textures. Curves keep the lightning editable. Seeded
randomness makes rebuilding repeatable. Cycles and a restrained compositor glow
provide the rendered presentation. Blender 5 compositor API migration reference:
[official compositor migration](https://developer.blender.org/docs/release_notes/5.0/migration/compositor_migration/).

From this worktree, with Blender on PATH:

```sh
blender --background --factory-startup --python-exit-code 1 --python docs/design/orbital-lightning/build.py
blender --background --factory-startup docs/design/orbital-lightning/OrbitalLightning.blend --python-exit-code 1 --python docs/design/orbital-lightning/validate.py
blender --background --factory-startup docs/design/orbital-lightning/OrbitalLightning.blend --python-exit-code 1 --python docs/design/orbital-lightning/render.py
blender --background --factory-startup docs/design/orbital-lightning/OrbitalLightning.blend --python-exit-code 1 --python docs/design/orbital-lightning/render.py -- animation
blender --background --factory-startup docs/design/orbital-lightning/OrbitalLightning.blend --python-exit-code 1 --python docs/design/orbital-lightning/export_components.py
```

The render helper currently selects NVIDIA OptiX; change device selection for a
different GPU or CPU. It does not change the saved scene. Always build in a fresh
background process: the builder intentionally refuses a loaded artist file.

Encode the 24 FPS PNG sequence using FFmpeg:

```sh
ffmpeg -framerate 24 -i docs/design/orbital-lightning/frames/%04d.png -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart docs/design/orbital-lightning/preview.mp4
```

## Export and engine integration

Only `ASSET_OrbitalLightning` is effect artwork. `PREVIEW_ONLY_DoNotExport` includes
the placeholder, player scale dummy, ground, camera, lights and range etchings.

`orb_components.glb` contains one local-origin core, outer energy shell, local arcs
and sparks, as separate meshes. Instance its geometry for the orbit formation.
`impact_components.glb` contains a local-origin impact component reference. Both
are static, Y-up glTF inputs without camera, lights or preview geometry. See
`exports.json` for their measured sizes and triangle counts. The optimized runtime
copies are `public/vfx/orbital-lightning/orb.glb` and `impact.glb`.

Recreate the following in the engine rather than exporting the entire Blender
timeline as a monolithic GLB:

- Orbit transforms, stage timing, per-orb intensity and prefire emphasis.
- Dynamic beam endpoints, lightning branches and short-lived trails, using pooled
  ribbons or low-sided geometry. The fixed directions here are preview choreography.
- Impact ground decals/rings, sparse sparks, emission flicker and cleanup.
- Bloom and lighting. Cycles emission lighting and the compositor do not transfer
  into glTF. Native shader emission animation and visibility keys are not exported.

Use server-owned timestamps and target positions received through `IWorld`.
Animation must not infer hits or apply damage. Ground telegraphs must match the
actual danger area and survive low graphics settings. Spawn a dedicated render
module, pool effect resources and prewarm through the existing GPU scheduler.
Use the current boss visual center as an attachment reference without moving it.

## Performance and review

Separate objects make authoring easy but are not a shipping draw-call budget.
Merge compatible static pieces or instance shared geometry, and replace complex
curve tubes with beam ribbons where appropriate. Keep the white core and
telegraphs at every tier; reduce only cosmetic arcs/sparks. The asset uses no dense
particle systems, subdivisions modifiers, physics caches or transparent shell stacks.
Measure overdraw, draw calls and simultaneous casts in the real multiplayer scene
before calling it production-ready.

The first render review found overly white shell arcs and a flat-looking impact.
The polish pass restores cobalt shell contrast, accelerates charge pulses and adds
a short jagged impact crown. `preview.webp` shows the reviewed active sequence.
`validation.json` records per-frame checks of stationarity, sequential firing,
attached beam origins, orbit radius, charged cores and the clean final frame.

The integrated implementation has deterministic simulation, cue mirroring, renderer
and asset coverage. Blender `build.py`, `validate.py` and `export_components.py`
remain the source-side checks for the editable scene and component exports.

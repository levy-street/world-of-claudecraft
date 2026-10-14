<!-- src/render/deepglass_scene/: render-local notes only. Root, src and
     src/render CLAUDE.md already apply. -->

# src/render/deepglass_scene/: the Deepglass arena world's renderer layer

The orchestration `renderer.ts` used to carry inline for the standalone
Deepglass arena world (`presentationMode === 'deepglass'`), behind the
`index.ts` barrel. The scenery itself stays in the flat `src/render/deepglass*.ts`
modules; this directory only composes and drives them.

- `scene.ts` (`DeepglassScene`): built ONLY in the Deepglass world. The bell,
  arena, card crowd, Tidehold monument FX, the bout-only warm bench, and the
  per-frame bout pass (in the order the renderer ran it inline).
- `bodies.ts`, `cues.ts`, `hud_feed.ts`: thrustpacks/wake/rush/ice/auras, the
  edge-detected sound cues, the match strip feed.
- `ball.ts` (`DeepglassBallFx`): the Tidesow views and comet trail. Inert until
  a Tidesow entity spawns, so the renderer owns one in every world.
- Pure cores (registered in `RENDER_PURE_CORES`, tested in
  `tests/deepglass_scene_cores.test.ts`): `deepglass_camera_core.ts` (bell boom
  limit, FOV ease; outside the Deepglass world the FOV base is the land base,
  unchanged), `deepglass_pose_core.ts` (travel pitch, dash flip),
  `deepglass_cue_core.ts` (crowd level, burner drive, cue edges).

Everything here reads the flier state (`Entity.dgFlight`) that only the
Deepglass sim sets, so none of it can reach the built-in world.

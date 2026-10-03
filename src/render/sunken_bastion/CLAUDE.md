# src/render/sunken_bastion: the Sunken Bastion's open-air sea fortress

The render half of the Sunken Bastion rework (`docs/design/dungeon-rework/sunken_bastion.md`).
The sim layout (`src/sim/content/sunken_bastion_layout.ts`) and its gates and spawns
(`src/sim/content/sunken_bastion.ts`) are the single source; everything here derives
from them. Shape copied from `../hollow_crypt/` (the pilot's package).

| Module | Role |
|---|---|
| `bastion_interior.ts` | Composes the interior group (terrain graded for the sea, headland rock, kit, gates, water, lights, sky and sea, the Fogbeacon, surf). Called by `dungeon.ts` `buildInterior` for interior `sunken_bastion`, attached through the compile gate. |
| `bastion_plan_core.ts` | PURE: lights and flame sockets, surf points, the shore mask, fog banks, sea stacks, the beacon lamp and its idle sweep, Vael's fog streams, edge dressing. In `RENDER_PURE_CORES`. |
| `bastion_kit_plan_core.ts` | PURE: every kit placement (sim props, curtain walls, edge pieces, light holders, set dressing). In `RENDER_PURE_CORES`. |
| `bastion_headland_core.ts` | PURE: the headland rock heightfield draped in the void between and under the terraces (never on a walkable floor). In `RENDER_PURE_CORES`. |
| `bastion_kit.ts` | Loads and bakes `public/models/props/sunken_bastion_kit.glb` (Blender source `docs/design/dungeon-rework/kit/build_sunken_bastion_kit.py`, shipped by `scripts/assets/sunken_bastion_kit/build.mjs`), instances every piece, procedural stand-ins when it is missing. |
| `bastion_sky_sea.ts` | The storm dome (low sun, torn cloud, lightning, rain curtains), the swell with shore foam, water mist, fog banks, rain, gulls, sea stacks. All motion on `sharedUniforms.uTime`. |
| `bastion_beacon.ts` | The Fogbeacon's lamp glow, its sweeping beam (idle, or driven by `setBeaconYaw` during Vael), Vael's fog streams. |
| `bastion_shore.ts` | The headland rock mesh and the surf spray. |
| `bastion_water.ts` | Standing water: the moat, the Drowning Yard's flood, tide pools (water surface order 0). |
| `bastion_lights.ts` | Flames, halos, floor pools (`ground` rung), budgeted point lights through the fire-light sink. |
| `bastion_gates.ts` | Portcullises, the drawbridge and the fog walls, driven by the shared gate memory (`../hollow_crypt/crypt_gate_state_core.ts`). |
| `bastion_fx_core.ts` / `bastion_fx.ts` | PURE plan plus painter for the floor telegraphs (trash cones, rings, lanes, kick glyphs, Brine Burst), drawn through the shared `../floor_telegraph` kit; boss casts register through `registerBastionTelegraph`. Hosted by `rift_death_zone.ts`. |
| `bastion_boss_fx_core.ts` / `bastion_boss_fx.ts` | PURE plan plus painter for the boss visuals (buttress states and crashes, the lit posts, the hook chain and its guide, the Undertow Wake, the beam pool, the reveal, the Hymn flood, the Hermit dome). Owned by `BastionFx` under its compile gate; reads only IWorld entity state. |

Rules:
- Cosmetic only: nothing here decides or hides an outcome. Density sheds with the
  effects tier; the Fogbeacon's beam is actionable during Vael (the reveal) and draws on
  every tier. Fog banks sway in place over the sea and fade near the camera, so they
  never veil a fight; standing water sits under the floor VFX ladder.
- No new directional or hemisphere light: the storm sun is the `sunkenBastion` state of
  `interior_light_rig.ts`; point lights go through the fire-light sink only.
- Tall render-only dressing never stands on walkable ground without a sim collider (the
  Sea Gate towers and the drawbridge piers carry collider-only props).
- Dev loop: the vite watcher ignores `**/tmp/**`, so a worktree under `C:/tmp` needs a
  dev-server restart to serve an edit.

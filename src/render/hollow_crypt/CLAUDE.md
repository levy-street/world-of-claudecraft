# src/render/hollow_crypt: the Hollow Crypt's open-air necropolis

The render half of the Hollow Crypt rework (`docs/design/dungeon-rework/hollow_crypt.md`).
The sim layout (`src/sim/content/hollow_crypt_layout.ts`) and its gates
(`src/sim/content/hollow_crypt.ts`) are the single source; everything here derives
from them.

| Module | Role |
|---|---|
| `crypt_interior.ts` | Composes the interior group (terrain, kit, gates, lights, sky). Called by `dungeon.ts` `buildInterior` for interior `hollow_crypt`, attached through the compile gate. |
| `crypt_plan_core.ts` | PURE: wisp rivers, light spots and styles, moon shafts, the crag ring, cliff-edge dressing, the gate reveal curve. In `RENDER_PURE_CORES`. |
| `crypt_set_dressing_core.ts` | PURE: render-only set dressing placements (no colliders). In `RENDER_PURE_CORES`. |
| `crypt_kit_plan_core.ts` | PURE: every kit placement (sim props, the arcade derived from its columns, cliff-edge rails, curtain walls, light holders, set dressing) and each piece's support rule. In `RENDER_PURE_CORES`; audited by `tests/hollow_crypt_kit_support.test.ts`. |
| `crypt_gate_state_core.ts` | PURE: the gate memory (state, reveal clock) fed by `../gate_objects.ts`. In `RENDER_PURE_CORES`. |
| `crypt_atmosphere.ts` | Sky dome with the moon and clouds, mist sea, soul column, wisps, dust, moonbeams, crag ring. All motion on `sharedUniforms.uTime`. |
| `crypt_lights.ts` | Flames, halos, floor pools (floor ladder, `ground` band), budgeted point lights through the fire-light sink. |
| `crypt_gates.ts` | Gate structures; one shader patch reads a per-gate `uOpen`, refreshed in `onBeforeRender` from the gate memory. |
| `crypt_creature_fx_core.ts` | PURE: the hero creatures' effect plan: the drake's jaw anchors (measured off its Blender clips), the Barrowflame torrent and scorch timeline, the ghost-fire ramp (`GHOST_FIRE_RAMP`, warm green-white, never cyan), cone spots, shockwave and tail-sweep curves, the touchdown test. In `RENDER_PURE_CORES`. |
| `crypt_creature_fx.ts` | The Ossuary Drake's Barrowflame Breath (inhale, a ghost-fire torrent of upright flame tongues over the whole cone on the Ignivar flame atlas, heat shimmer, ember lift, scorch), tail sweep, wing buffet and landing blast; the Chapel Gargoyle's awakening, dive shockwave and cracks, and Stone Shriek. Three GPU particle draws plus pooled floor shaders, one gated root, built by `rift_death_zone.ts` beside `crypt_trash_fx.ts`. |
| `morthen_fx_core.ts` | PURE: Morthen the Lich Bishop's stance (the bell staff, the scythe after his Last Rites at `MORTHEN_LAST_RITES_FRACTION`, read off his mirrored health with hysteresis), the rig gestures that swap it (`VisualDef.phaseClips`), his body anchors and the transform, swing-trail and dissolve timings. In `RENDER_PURE_CORES`; `tests/morthen_lich.test.ts`. |
| `morthen_fx.ts` | His body effects on the crypt particle kit: soul smoke trail (dark green-grey), wisps, rib fire, soul-green sparks off the mitre eye, the unfolding burst, the bell's toll rings on Shadow Pulse, scythe crescents and staff-strike rings, the smoke dissolve on death. Sends the stance and toll gestures through `rift_death_zone.ts`'s `playGesture`. One gated root. |
| `crypt_kit.ts` | Loads and bakes `public/models/props/hollow_crypt_kit.glb` (Blender source in `docs/design/dungeon-rework/kit/`), instances every piece, procedural stand-ins when it is missing. |

Rules:
- Cosmetic only: nothing here decides or hides an outcome. Density sheds with the
  effects tier; telegraph readability wins (floor pools sit on the `ground` rung, arena
  floors stay dark, lit dressing stays in the wall band).
- No new directional or hemisphere light: the moon is the `hollowCrypt` state of
  `interior_light_rig.ts`; point lights go through the fire-light sink only.
- Tall render-only dressing never stands on walkable ground without a sim collider.
- Nothing floats: every piece stands on the floor under its own footprint, rests on the
  top of what carries it, hangs from a piece, or rises from the chasm floor, and every
  flame burns in a placed holder. Rails on ramps are SHEARED (posts plumb), never tilted.
  `tests/hollow_crypt_kit_support.test.ts` checks the shipped GLB against the real floor.

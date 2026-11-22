# src/render/hazard_pool/: hazard pools

Dense, glossy tar on the floor that a player must keep out of. One look and ONE
shader program for both kinds of pool:

- **Static pools**: a room's authored hazard zones, built with the room (the
  Drowned Litany's Blackwater today, through `delve_marsh_dressing.ts`
  `placeMarshBlackwaterPools`).
- **Dynamic pools**: boss-dropped pools the world lists through
  `IWorld.activeHazardPools()` (Sister Nhalia's Blackwater Mark today), drawn by
  the one `DynamicHazardPools` host the renderer owns.

A new boss pool needs no new render code: list it from the sim through
`activeHazardPools()` (pure rows in `src/sim/delves/boss_pool_views.ts`, the
online mirror in `src/net/hazard_pool_mirror.ts`) with an existing style, or add
a style to `HAZARD_POOL_LOOKS`.

| Module | Owns |
|---|---|
| `hazard_pool_core.ts` | Pure (in `RENDER_PURE_CORES`): the style looks, the Litany tier mapping, the outward-only edge margin, the island clearance, the dynamic lifecycle `hazardPoolPhase`. |
| `hazard_pool_shader.ts` | The one GLSL pair: organic outward-only edge, thin-edge glow, gloss, deep dome, lifecycle uniforms. |
| `hazard_pool_mesh.ts` | Disc geometry with per-pool attributes; the material factory and its style/phase writers. |
| `static_pools.ts` | `placeHazardPools`: one mesh per zone into a room group, one material per style per room. |
| `dynamic_pools.ts` | `DynamicHazardPools`: pooled slots, gated attach, reconcile by id, post-removal drain. |

## Rules
- **The footprint is the mechanic.** Inside the sim radius the tar is always
  full; the organic edge only wanders OUTWARD (`hazardPoolEdgeMargin`), so a
  player never takes damage on floor that looks dry. A dynamic pool shows its
  whole footprint from its first frame and stays full for as long as the world
  lists it; it drains only after the world drops it.
- **Every tier draws the same pool.** The tar is unlit colour math (no bloom, no
  lights, no Lambert swap), so the Low preset reads exactly as High. Nothing here
  takes a graphics tier or the FPS governor. Reduced motion only holds the
  dynamic host's clock (flow and pulse) still; it never hides a pool.
- **One program.** Style and life are uniforms and per-pool data rides vertex
  attributes, so every material links the same program. The static Litany
  dressing links it inside the room's gated attach at delve entry; the dynamic
  host attaches its slots through the renderer's compile gate at construction.
  A change to the shader source is a new program for both: keep them on one.
- **Floor ladder:** every pool sits in the `encounter` band (a hazard paints
  over player ground effects): marsh at step 2, ember at 3, violet at 4, below
  every boss telegraph (steps 8 and up).
- **Islands stay dry:** a pool's peak (`lift + dome`) stays under the Litany's
  dry stepping-stone tops (`HAZARD_POOL_ISLAND_TOP`).
- **Instance-band precision:** the noise runs in pool-local yards and the
  position goes through `modelViewMatrix`; never `viewMatrix * <world point>`.

## Tests
`tests/hazard_pool_core.test.ts` (looks, edge rule, lifecycle invariants),
`tests/hazard_pool_render.test.ts` (static builder and dynamic host),
`tests/boss_pool_views.test.ts` (sim rows, wire stability, the online mirror).

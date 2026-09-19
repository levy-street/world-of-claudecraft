# VFX floor layering

Boss mechanics on the floor must always read over player VFX on the floor. This
document is the design behind the floor VFX ladder in
`src/render/floor_vfx_layer_core.ts` (policy) and `src/render/floor_vfx_layer.ts`
(the Three-side twin), pinned by `tests/floor_vfx_layer.test.ts`.

## The problem

Every floor-anchored effect in the renderer (a terrain-draped disc, a telegraph
cone, a soak ring, a consecration wash, a blob shadow) is a transparent mesh with
depth-write off, hugging the ground on a small lift or a polygon offset. The depth
buffer therefore cannot arbitrate between two of them: whichever paints last wins
the blend outright. When two share a `renderOrder`, three.js falls back to
bounding-sphere depth, which flips as the camera orbits (`src/render/water.ts`
records the same failure on the sea). `renderOrder` is the only stable arbiter.

Before the ladder, every module picked its own small integer, and nothing related
them. Ignivar's telegraphs sat at 1 to 7 while a paladin's consecration sat at 7
to 11, a mage's ground effects at 5 to 9, and Ring of Frost at 7 to 10, so a
player's ground effect painted over the boss telegraph a raid had to dodge. Two
further traps made it worse:

- Several telegraph pieces had no `renderOrder` at all (default 0), the same rung
  as the water surface, so a boss safe zone could lose to a puddle.
- A Group's `renderOrder` is promoted by three.js to the `groupOrder` sort key,
  which outranks every `renderOrder` in the scene. A player effect parked in a
  Group at 3 painted over a boss mesh at 30 no matter what the numbers said.

## The ladder

Four bands, bottom to top. Each band owns a span of consecutive orders. A module
keeps its internal stack (fill under rim under sweep) as steps inside its band,
and a step is clamped so it can never cross into the band above.

| Band | What lands here |
|---|---|
| `ground` | The world's own marks: blob shadows, mob night glow, torch and brazier pools, scorch decals. |
| `player` | Class ability ground VFX: buff auras, dissolve decals, shock rings, consecration, runes, meteor footprints, trap rings. |
| `encounter` | Boss and encounter mechanics: telegraphs, soak zones, hazard fields, death zones, sigils, markers. |
| `reticle` | The player's own ground aim guide. Additive, so it brightens what lies under it and never hides a telegraph. The click-to-move marker and the AoE landing flash are normal-blended, so they ride the top rung of the `player` band instead. |

The exact bases and spans are pinned in the test, not repeated here. The ladder
sits above the water surface (0) and the world's default band, and below the
camera-attached overlays (underwater tint, sky).

Steps follow one rule per band. Inside `encounter`, every module uses step =
the order it shipped with before the ladder, minus one, so the cross-module order
the raids were authored with (Varkhul's modules against the Ignivar soak telegraph
they share) is preserved exactly and no new tie appears; a piece that had no
order sits on the band floor. Inside `player`, each module packs its own stack
from step 0, since player effects only ever overlap other player effects there.
A builder that serves two callers picks its band per spawn: the meteor telegraph
in `src/render/mage_ground_fx.ts` rides `player` for the mage's own Meteor and
`encounter` for the sim's world warnings (Ignivar meteors, Varkhul anvils and
forgestorm, Nythraxis grave eruptions), which arrive with a persistent id.

## Rules for a floor module

- Take every `renderOrder` from `floorVfxRenderOrder(layer, step)`; never write a
  bare integer. The band's top rung is `floorVfxLayerTopOrder(layer)` for a piece
  that must paint over everything else in the band (Ignivar's judgment cue beams);
  it is the same rung a clamped step lands on, so keep ordinary stacks well below
  the span end.
- A render module that sets a bare `renderOrder` and is NOT on the ladder must be
  named in the test's out-of-scope list with a reason; the completeness sweep
  fails otherwise. A Group carrying a `renderOrder` anywhere under `src/render/`
  fails the same test unless it is one of the pinned pre-existing carriers.
- Put the order on renderable leaves (mesh, points, sprite, line), never on a
  Group. `applyFloorVfxLayer(root, layer, step)` does this for a subtree and
  resets every Group to 0.
- Register the module in `FLOOR_VFX_LAYERED_MODULES` in the test with its band.
  The registry pins that the module imports the seam, names only its own band,
  and (for strict modules) leaves no bare literal. A boss module cannot slip a
  `'player'` call, and a player module cannot promote itself to `'encounter'`.
- Blending is unchanged by the ladder. Additive materials stay order-invariant in
  colour; the ladder matters for normal-blended fills and for what a bright
  additive stack does to a telegraph's readability.

## What is deliberately out of scope

- Vertical VFX that is not floor-anchored keeps its own orders: the pooled
  `src/render/ability_vfx/` families that stand up from the ground (pillars,
  ribbons, buff shells, overlay sprites, impact flipbook sheets, spirit puppets)
  and the particle cloud in `src/render/vfx.ts`. They are depth-tested against
  the world and additive, so their order only affects blend arithmetic among
  themselves, not what a player can read. A boss module whose vertical pieces
  belong to a floor mechanic (the Varkhul forge beams) still rides the ladder so
  its stack cannot tie with a player band.
- The selection ring under a target and the static dungeon hazard pools stay on
  their existing orders. They are not VFX a player emits or a boss casts.
- Two world markers far from any raid floor (the mount call beacon and the race
  line marker root) still carry an order on a Group. They are pre-existing and
  out of scope here; a module that gains a floor mechanic near them must move
  its order to leaves first.
- Materials, lifts, polygon offsets, and depth flags are untouched; the ladder
  changes only which floor mesh paints last.

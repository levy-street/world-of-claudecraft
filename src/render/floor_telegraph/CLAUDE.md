# src/render/floor_telegraph: the shared dungeon floor telegraph

One look for every dungeon's floor telegraphs: the Hollow Crypt and Sunken
Bastion trash casts (cones, rings, lanes, kick glyphs, death-burst fuses) and the
Bastion's boss casts all lay through `TelegraphKit`.

| Module | Role |
|---|---|
| `telegraph_look_core.ts` | PURE (`RENDER_PURE_CORES`): the threat palette (`danger`, `lethal`, `control`, `interrupt`), element accents, the per-frame layer intensities (`telegraphLook`), the edge outline stations. |
| `telegraph_material.ts` | The floor shader (tint, swept fill, fill front, yard-true outline, warning pulse, cosmetic bands and motes, the kick glyph) and the additive edge curtain shader. |
| `floor_tell_core.ts` | PURE (`RENDER_PURE_CORES`): the shared SOAK tell's numbers (the team's playtest of 2026-11-25 on the Hammer Council): a pip round the rim per player the soak needs, lit one per player inside (`soakPips`, `countInside`). |
| `floor_tell.ts` | `FloorTellPool`: a fixed pool of shared soak markers built by the OWNER in its constructor under its gated root and laid over its share footprints each frame (`paint`, `hide`, `settle` every frame for the decay, `hideAll`). |
| `soak_marker_core.ts` | PURE (`RENDER_PURE_CORES`): the shared SOAK marker's plan (the owner's request of 2026-11-26, a raid-language soak marker in our own procedural style): the element palettes (`SOAK_PALETTES`: fire, earth, air, lightning, shadow, frost, water) and each element's character (`SOAK_CHARACTER`: grains, rim crackle, flame tongues, smoke, wind streams, speed), the clips (`soakMarkerStage`, `soakMarkerLook`: Birth blooms out of the middle, Hold loops, Decay draws it back in), the converging rings (`soakRipple`), the wisps per tier (`soakWispCount`). |
| `soak_marker.ts` | `SoakMarker`: the marker's painter, two draws (the vortex disc, mostly additive light over the floor: counter-rotating noise, spiral filaments, a hot inner ring, a darker turbulent centre, the luminous rim at the sim's radius with its soft halo, rings converging on the middle, inward chevrons, the soakers' pips, an optional countdown arc, a ready ring; and one ribbon mesh of wisps spiralling up, camera-relative; the rim, pips, chevrons and arc draw whole from the first frame and go at once with the mark, only the body blooms and decays), built once by the owner, no texture, no light. Worn by `FloorTellPool`'s share slots and by `../ignivar_soak_telegraph.ts` (a soak carried on a player). |
| `telegraph_kit.ts` | Pooled fans and lanes: footprint draped on the real floor plus the curtain; built once per slot, attached by the OWNER through its compile gate. On the floor VFX ladder's `encounter` band. |

Rules:
- A boss circle the raid must SHARE (a soak, a split) wears the shared soak
  marker (`FloorTellPool`) over its footprint, and the marker ALONE: its owner
  hides its own painted fan under it (never two areas at once). It draws whole on
  every tier (it is the mechanic's information); reduced motion only holds it
  still. A circle the raid must KEEP OUT of (a knockback, a pulse, a spread, a
  strike, a crack) keeps its own painted footprint at the sim's radius in its
  threat colour: the 2026-11-25 "avoid" overlay (chevrons out, a throbbing rim)
  was removed on every boss by the owner's call of 2026-11-26.
  Adopters: the Hammer Council (Falling Rock in earth:
  `../smith_heart_fx/council_fx.ts`), the Thunder's Cradle
  (lightning, `../smith_heart_fx/breath_fight_fx.ts`), Weight of the Anvil (earth,
  `../smith_heart_fx/final_kit_fx.ts`); a soak carried on a player wears the same
  marker through `../ignivar_soak_telegraph.ts` (Varkhul's Shared Pyre in fire,
  Balgath's Barrow Burden in shadow).
- A SHARE soak's colour is its ELEMENT (the owner's call of 2026-11-26, like the
  retail raid soak marker): the element picks the marker's palette and character.
  The share meaning never rides the hue: it lives in the SHAPE and the MOTION (a
  vortex pulled in, rings converging from the rim, chevrons pointing in, wisps
  rising, the soakers' pips), against a keep-out mark's plain painted footprint. The share marker's rim (a crisp luminous ring) is
  the sim's radius; past it (to `SOAK_MARKER.outer`) only the rim's own soft
  halo, light only, never a fill, so the floor outside stays readable. A share
  marker only ever moves IN (the Round 02 rule: outward motion says keep out):
  no ring, front or flare travels past its rim; its birth blooms from the
  middle out TO the rim and flares the rim in place. Pinned by
  `tests/floor_telegraph_soak_marker.test.ts`.
- Every other telegraph's colour is the THREAT, never the school: a new keep-out
  circle, cone, ring or lane picks one of the four threat colours
  (`tests/floor_telegraph_look.test.ts` pins every crypt and Bastion spec to the
  palette, kick glyphs to `interrupt`). The element rides `accent`.
- The share marker draws whole on every tier; only its wisps' count follows the
  tier's detail (`soakWispCount`, never zero). Reduced motion holds it still (no
  bloom, no decay). Pinned by `tests/floor_telegraph_soak_marker.test.ts`.
- The footprint (tint, fill, front, outline) is identical on every tier; only the
  curtain, bands and motes shed on the low tier (`TelegraphKit` `detail`).
- The fill is the sim's cast bar (`telegraphFillOf`); nothing here changes timing.
- Painters pass the FLOOR height under the caster; the kit floats the shape a hand
  over it (never add a lift in the painter, or the footprint z-fights the floor).
- A raid may dress a footprint's PAINT over the kit's own uniforms (the Heat's molten
  telegraphs, `../smith_heart_fx/heat_telegraph.ts`), never its drape or its fill.

# src/render/floor_telegraph: the shared dungeon floor telegraph

One look for every dungeon's floor telegraphs: the Hollow Crypt and Sunken
Bastion trash casts (cones, rings, lanes, kick glyphs, death-burst fuses) and the
Bastion's boss casts all lay through `TelegraphKit`.

| Module | Role |
|---|---|
| `telegraph_look_core.ts` | PURE (`RENDER_PURE_CORES`): the threat palette (`danger`, `lethal`, `control`, `interrupt`), element accents, the per-frame layer intensities (`telegraphLook`), the edge outline stations. |
| `telegraph_material.ts` | The floor shader (tint, swept fill, fill front, yard-true outline, warning pulse, cosmetic bands and motes, the kick glyph) and the additive edge curtain shader. |
| `floor_tell_core.ts` | PURE (`RENDER_PURE_CORES`): the shared SOAK / AVOID tell (the team's playtest of 2026-11-25 on the Hammer Council): `share` (gather in: chevrons pointing IN and rings converging, a pip round the rim per player the soak needs, lit one per player inside: `soakPips`, `countInside`) and `avoid` (keep out: chevrons pointing OUT, rings growing to the rim, the rim throbbing outward); the direction in the shape and the motion (`tellBand`, pinned), the frame's look (`floorTellLook`). |
| `floor_tell.ts` | `FloorTellPool`: the tell's painter, a fixed pool of flat discs (one draw each, one program) built by the OWNER in its constructor under its gated root and laid over its footprint each frame (`paint`, `hide`). |
| `telegraph_kit.ts` | Pooled fans and lanes: footprint draped on the real floor plus the curtain; built once per slot, attached by the OWNER through its compile gate. On the floor VFX ladder's `encounter` band. |

Rules:
- A boss circle the raid must SHARE (a soak, a split) or KEEP OUT of (a
  knockback, a pulse, a spread) wears the shared tell (`FloorTellPool`) over its
  footprint: never a bespoke arrow or ring of its own. It draws whole on every
  tier (it is the mechanic's information); reduced motion only holds it still.
  First adopter: the Hammer Council (Falling Rock shares, Wake the Stone and
  Resonance avoid: `../smith_heart_fx/council_fx.ts`).
- The colour is the THREAT, never the school: a new telegraph picks one of the four
  threat colours (`tests/floor_telegraph_look.test.ts` pins every crypt and Bastion
  spec to the palette, kick glyphs to `interrupt`). The element rides `accent`.
- The footprint (tint, fill, front, outline) is identical on every tier; only the
  curtain, bands and motes shed on the low tier (`TelegraphKit` `detail`).
- The fill is the sim's cast bar (`telegraphFillOf`); nothing here changes timing.
- Painters pass the FLOOR height under the caster; the kit floats the shape a hand
  over it (never add a lift in the painter, or the footprint z-fights the floor).
- A raid may dress a footprint's PAINT over the kit's own uniforms (the Heat's molten
  telegraphs, `../smith_heart_fx/heat_telegraph.ts`), never its drape or its fill.

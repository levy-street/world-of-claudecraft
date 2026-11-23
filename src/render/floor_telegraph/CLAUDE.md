# src/render/floor_telegraph: the shared dungeon floor telegraph

One look for every dungeon's floor telegraphs: the Hollow Crypt and Sunken
Bastion trash casts (cones, rings, lanes, kick glyphs, death-burst fuses) and the
Bastion's boss casts all lay through `TelegraphKit`.

| Module | Role |
|---|---|
| `telegraph_look_core.ts` | PURE (`RENDER_PURE_CORES`): the threat palette (`danger`, `lethal`, `control`, `interrupt`), element accents, the per-frame layer intensities (`telegraphLook`), the edge outline stations. |
| `telegraph_material.ts` | The floor shader (tint, swept fill, fill front, yard-true outline, warning pulse, cosmetic bands and motes, the kick glyph) and the additive edge curtain shader. |
| `telegraph_kit.ts` | Pooled fans and lanes: footprint draped on the real floor plus the curtain; built once per slot, attached by the OWNER through its compile gate. On the floor VFX ladder's `encounter` band. |

Rules:
- The colour is the THREAT, never the school: a new telegraph picks one of the four
  threat colours (`tests/floor_telegraph_look.test.ts` pins every crypt and Bastion
  spec to the palette, kick glyphs to `interrupt`). The element rides `accent`.
- The footprint (tint, fill, front, outline) is identical on every tier; only the
  curtain, bands and motes shed on the low tier (`TelegraphKit` `detail`).
- The fill is the sim's cast bar (`telegraphFillOf`); nothing here changes timing.
- Painters pass the FLOOR height under the caster; the kit floats the shape a hand
  over it (never add a lift in the painter, or the footprint z-fights the floor).

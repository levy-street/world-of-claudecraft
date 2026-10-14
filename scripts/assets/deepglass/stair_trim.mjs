// Stair trim for the Deepglass ring-city flights (SPACEY, 2026-09-23: "add side
// rails to these steps so it doesn't look weird and add a flat landing on each
// side so it transitions cleanly into the terrain ... same color as the
// default cobble ... ensure the collision works on the side rails and the flat
// exit and entry").
//
// For every stair flight (an inline model/custom built by citadel.ts
// stairBlock: 10 verts a step, local +z climbs, origin 0.5 under the foot
// plaza) this adds, in the flight's own frame:
//   - one model/custom "Stair trim": a sloped cheek wall on each side standing
//     RAIL_H over the nosing line and buried RAIL_DEPTH under it (it hides the
//     sawtooth step ends), a post at each wall end, and a flat landing slab at
//     the foot (plaza height) and the head (flush with the top tread);
//   - collider/box segments along each wall (full-height OBBs), SHORT ones:
//     a box's pass-under floor is the ground at its centre (colliders.ts
//     passesUnder), so one long box per wall let a body at the foot of a
//     26-yard flight walk straight under it;
//   - a flat collider/plane over each landing, at the slab's top.
// The flights themselves get the Warden Cobbles look (tile 14, like the
// ground swatch) and a tint tuned to the painted cobbles beside them.
// Idempotent: everything named STAIR_TRIM_NAMES is removed first.
//
//   node scripts/assets/deepglass/stair_trim.mjs <in.map.json> <out.map.json>
// Default (GLB mode, see stair_trim_core.mjs): swaps each stairBlock flight for
// its baked dg_stair_flights.py GLB and writes the rail/landing collision.
//   LIGHT=0.3 HUE=0 SAT=1 to override the tint.
import fs from 'node:fs';
import { trimStairs } from './stair_trim_core.mjs';

const [IN, OUT] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));

// SPACEY, 2026-09-23 (second pass): "make the steps the same color as the stone
// on the walls with that seamless texture" - the Warden Wall kit's stonewash.
// Rails: "4x the width" of the first 0.7, then "another 2x wider" (5.6).
const { TEX, TILE, RAIL_WIDE, LIGHT, HUE, SAT, MUSIC } = process.env;
const { flights, added } = trimStairs(doc, {
  tex: TEX ?? 'WardenStone',
  tile: Number(TILE ?? 7), // the kit's own ~7 yd repeat (trim path only)
  railWide: Number(RAIL_WIDE ?? 5.6),
  look: {
    modelLight: Number(LIGHT ?? 0),
    modelHue: Number(HUE ?? 0),
    modelSat: Number(SAT ?? 1),
  },
  music: MUSIC || undefined,
  log: (l) => console.log(l),
});
fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(`${flights} flights trimmed, ${added} placements added -> ${OUT}`);

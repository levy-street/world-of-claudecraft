// Lay the arena kit (bl_dg_arena.py) into a map document.
//
//   node scripts/assets/deepglass/place_arena.mjs <in.json> <out.json>
//
// Sixteen 22.5-degree wedges make the bowl, one of them the gatehouse where
// the north bridge lands; sixteen floor wedges and a core disc pave the ground
// from the bell's axis to the stands. Every piece is an ordinary editable
// placement: select, drag and delete them like any other asset.
//
// Re-runnable. Besides laying the kit it cleans up what the v2 gate and floor
// replace (2026-09-25):
//   - the procedural bowl's old collider/wall + collider/box volumes (v1);
//   - the causeway slabs, the stair flight, its rail boxes and the hidden
//     causeway colliders that climbed through the old gate passage (the gate carries its own
//     terrace, hall and stair now, with authored collision);
//   - the hidden sphere colliders on the cradle pylons: the pylons' own
//     `basic` cylinder is widened to their plinth instead;
//   - the concourse wedges (the floor wedges pave that ring);
//   - props standing where the gate's seating blocks and stair now are;
//   - the plaza's 0.34 terrain stamp (the floor is its own deck at 0.40, and
//     terrain 6 cm under it z-fights at range).
import fs from 'node:fs';

const R_BELL = 49.4;
const R_IN = 63.4;
const R_OUT = 99.4;
const TOP_Y = 27;
const WEDGES = 16;
const WSPAN = (Math.PI * 2) / WEDGES;
const FLOOR = 0.4;
/** The floor wedge's own origin: the middle of its radial run (bl_dg_arena.py RF0..RF1). */
const R_FLOOR_MID = (3.5 + 63.9) / 2;
/** The pylon's plinth radius at the placed scale (dg_pylon.py: 1.52). */
const PYLON_COLLIDE_R = 1.55;

// the rake, mirroring dgBowlDeckY in src/sim/deepglass/layout.ts
const ROWS = 34;
const ROW_RUN = 0.95;
const LANDINGS = [12, 24];
const LAND_D = 1.85;
function deckY(r) {
  if (r <= R_IN) return 0;
  const rise = TOP_Y / ROWS;
  let rr = R_IN;
  let y = 0;
  for (let i = 0; i < ROWS; i++) {
    if (LANDINGS.includes(i)) {
      if (r < rr + LAND_D) return y;
      rr += LAND_D;
    }
    if (r < rr + ROW_RUN) return y;
    rr += ROW_RUN;
    y += rise;
  }
  return TOP_Y;
}

const VOM_AT = new Set([0, 2, 6, 8, 10, 14]);
const GATE_AT = 4; // +Z, where the north bridge lands
const r3 = (v) => Math.round(v * 1000) / 1000;
/** Every piece is DETACHED at ground 0 with `y` as its lift. A grounded
 *  placement seats on the terrain under its centre (colliders.ts), and the
 *  gatehouse's centre stood on the old ramp's stamps: the whole gate, render
 *  and collision, rode 1.1 yd high and its forecourt was a wall. The kit is
 *  authored against the arena's own floor, so it keeps its own datum. */
const ANCHOR = { collide: true, collisionMode: 'baked', detached: true, groundY: 0 };

/** A wedge-frame placement: the piece is authored with +X outward, so a
 *  three.js rotY of -phi aims it down the radius it sits on. */
function put(out, assetId, phi, radius, y, { face = 'out' } = {}) {
  out.push({
    assetId,
    x: r3(Math.cos(phi) * radius),
    z: r3(Math.sin(phi) * radius),
    y: r3(y),
    scale: 1,
    rotY: r3(face === 'in' ? -phi + Math.PI : -phi),
    ...ANCHOR,
  });
}

const [, , inPath, outPath] = process.argv;
const doc = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const before = doc.placements.length;
const dropped = {};
const drop = (why, pred) => {
  const n = doc.placements.filter(pred).length;
  if (n) dropped[why] = (dropped[why] ?? 0) + n;
  doc.placements = doc.placements.filter((p) => !pred(p));
};

// 1) the old procedural bowl's hand-built collision
drop('old bowl colliders', (p) => {
  if (p.assetId !== 'collider/wall' && p.assetId !== 'collider/box') return false;
  const r = Math.hypot(p.x, p.z);
  return r >= 60 && r <= 106 && !(Math.abs(p.x) < 13 && p.z > 50);
});
// 2) any kit already laid (re-runnable), the causeway with it
// (the floor lamps a first run turned into braziers stay: they are the
// map's own lamps, told apart by their scale)
const LAMP_SCALE = 0.55;
drop(
  'previous kit',
  (p) =>
    p.assetId.startsWith('deepglass/arena_') &&
    !(p.assetId === 'deepglass/arena_brazier' && Math.abs(p.scale - LAMP_SCALE) < 1e-6),
);
// 3) the old gate corridor: stair flight, causeway colliders, pillar props,
//    and props standing on the new stair / in the new seating blocks
const inGateCorridor = (p) => Math.abs(p.x) < 13 && p.z > 55 && p.z < 112;
drop(
  'old gate stair + colliders',
  (p) =>
    inGateCorridor(p) &&
    (p.assetId === 'deepglass/stair_flight_16' ||
      p.assetId === 'collider/plane' ||
      p.assetId === 'collider/sphere' ||
      p.assetId === 'collider/box' ||
      p.assetId === 'props/deepglass_pillar'),
);
drop(
  'props on the new stair',
  (p) =>
    p.assetId === 'props/streetlamp_veiled_crystal' && Math.abs(p.x) < 8 && p.z > 64 && p.z < 90,
);
// 4) the hidden spheres doubling the cradle pylons
drop(
  'pylon spheres',
  (p) => p.assetId === 'collider/sphere' && Math.abs(Math.hypot(p.x, p.z) - 26) < 0.6,
);
for (const p of doc.placements) {
  if (p.assetId === 'deepglass/cradle_pylon') p.collideRadius = PYLON_COLLIDE_R;
}
// 4b) the veiled-crystal street lamps on the arena floor read as dark purple
//     mushrooms beside the gold kit: they become the arena's own braziers,
//     a size down, and the one standing on the processional axis goes
let lampsSwapped = 0;
doc.placements = doc.placements.filter((p) => {
  if (p.assetId !== 'props/streetlamp_veiled_crystal' || Math.hypot(p.x, p.z) > 64) return true;
  if (Math.abs(p.x) < 0.5 && p.z > 30) return false;
  return true;
});
for (const p of doc.placements) {
  if (p.assetId !== 'props/streetlamp_veiled_crystal' || Math.hypot(p.x, p.z) > 64) continue;
  p.assetId = 'deepglass/arena_brazier';
  p.scale = LAMP_SCALE;
  p.y = FLOOR;
  p.rotY = 0;
  delete p.collideRadius;
  Object.assign(p, ANCHOR);
  lampsSwapped++;
}
// ...and their point lights move up to the fire bowls
for (const l of doc.lights ?? []) {
  if (Math.abs(Math.hypot(l.x, l.z) - 40) < 0.5 && Math.abs(l.y - 4.5) < 0.01)
    l.y = r3(FLOOR + 7.9 * LAMP_SCALE);
}
// 5) the market's third stall pair stood in what is now the gate's seating
//    block: bring it down the processional to the promenade, keeper and all
let movedStalls = 0;
for (const p of doc.placements) {
  if (
    Math.abs(p.z - 66) < 1.6 &&
    Math.abs(p.x) > 10.5 &&
    Math.abs(p.x) < 17.5 &&
    /^props\/(market_stand_|farmcrate_|barrel)/.test(p.assetId)
  ) {
    p.z = r3(p.z - 24);
    movedStalls++;
  }
}
const favors = doc.content?.npcs?.dg_stallkeeper_favors;
if (favors && Math.abs(favors.pos.z - 66) < 0.5) favors.pos.z = 42;
// 6) the plaza stamp: the floor is its own deck now. And the old walkable
//    ramp up to the bridge (a ladder of level stamps rising 0 -> 6 along the
//    gate's axis): the gate's own stair replaces it, and left in place it
//    reached the terrace deck's height at the facade and z-fought it there
const beforeEdits = (doc.terrainEdits ?? []).length;
doc.terrainEdits = (doc.terrainEdits ?? []).filter(
  (e) => !(e.mode === 'level' && Math.abs(e.x) <= 9 && e.z >= 78 && e.z <= 106),
);
const shedRamp = beforeEdits - doc.terrainEdits.length;
let flattened = 0;
for (const e of doc.terrainEdits ?? []) {
  if (e.mode === 'level' && e.x === 0 && e.z === 0 && e.radius === 44 && e.delta !== 0) {
    e.delta = 0;
    flattened++;
  }
}

// 7) lay the kit
const add = [];
for (let i = 0; i < WEDGES; i++) {
  const phi = i * WSPAN;
  if (i === GATE_AT) put(add, 'deepglass/arena_gatehouse', phi, (R_IN + R_OUT) / 2, 0);
  else
    put(
      add,
      VOM_AT.has(i) ? 'deepglass/arena_stand_vom' : 'deepglass/arena_stand',
      phi,
      (R_IN + R_OUT) / 2,
      0,
    );
  // the paved floor, axis to stands, one wedge per bearing (each carries its
  // pylon's gold socket on its centre line); the gate's wedge carries the
  // runner down the processional and its bridge over the tide channel
  put(
    add,
    i === GATE_AT ? 'deepglass/arena_floor_gate' : 'deepglass/arena_floor',
    phi,
    R_FLOOR_MID,
    0,
  );
  // the awning over the back rows, not across the gatehouse, which is taller
  if (i !== GATE_AT) {
    put(add, 'deepglass/arena_canopy', phi, (R_OUT - 20 + R_OUT + 2.2) / 2, TOP_Y + 2.8);
  }
  // lamps round the floor's edge, on the half-angles so they miss the seams
  put(add, 'deepglass/arena_brazier', (i + 0.5) * WSPAN, R_IN - 2.4, FLOOR);
  // banners standing on the crown walk, every other bay
  if (i % 2 === 0) {
    put(add, 'deepglass/arena_banner', (i + 0.5) * WSPAN, R_OUT - 1.2, TOP_Y + 1.1);
  }
}
add.push({ assetId: 'deepglass/arena_floor_core', x: 0, z: 0, y: 0, scale: 1, rotY: 0, ...ANCHOR });
// the Warden's box, opposite the gate, looking down into the bell
put(add, 'deepglass/arena_box', 12 * WSPAN, R_OUT - 5.0, deckY(R_OUT - 5.0), { face: 'in' });
// the two boards, hard against the cradle so they block the fewest sightlines
for (const i of [2, 6]) {
  put(add, 'deepglass/arena_scoreboard', (i + 0.0) * WSPAN + WSPAN / 2, R_BELL + 3.0, FLOOR);
}
// two braziers on the gate stair's landing (bl_dg_arena.py: the landing runs
// 73.53 -> 76.85 up the gate's axis at y 3.20)
for (const x of [-5.6, 5.6]) {
  add.push({
    assetId: 'deepglass/arena_brazier',
    x,
    z: 75.19,
    y: 3.2,
    scale: 1,
    rotY: 0,
    ...ANCHOR,
  });
}
// pennant masts flanking the stair's foot
for (const x of [-11, 11]) {
  add.push({
    assetId: 'deepglass/arena_pennant',
    x,
    z: 60,
    y: FLOOR,
    scale: 1,
    rotY: 0,
    ...ANCHOR,
  });
}

// 8) the old bowl's outer wall also lived as a ring of movement blockers at
// r = 99. The kit's facade has three walk-through arches per wedge, so the
// ring would seal every one of them.
const blockersBefore = (doc.blockers ?? []).length;
doc.blockers = (doc.blockers ?? []).filter((b) => {
  const r1 = Math.hypot(b.x1, b.z1);
  const r2 = Math.hypot(b.x2, b.z2);
  return !(r1 > 95 && r1 < 104 && r2 > 95 && r2 < 104);
});
const shedBlockers = blockersBefore - doc.blockers.length;

doc.placements.push(...add);
doc.meta.updatedAt = Date.now();
fs.writeFileSync(outPath, JSON.stringify(doc));

const counts = {};
for (const p of add) counts[p.assetId] = (counts[p.assetId] ?? 0) + 1;
for (const [k, v] of Object.entries(dropped)) console.log(`dropped ${v} ${k}`);
console.log(`swapped ${lampsSwapped} floor lamps for braziers`);
console.log(
  `moved ${movedStalls} market pieces${favors ? ' and the favors stallkeeper' : ''}; ` +
    `flattened ${flattened} plaza stamp(s); shed ${shedRamp} old ramp stamps`,
);
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`shed ${shedBlockers} blocker segments from the old outer wall`);
console.log(`placements ${before} -> ${doc.placements.length}`);

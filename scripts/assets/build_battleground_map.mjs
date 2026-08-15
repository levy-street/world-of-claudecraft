// Build the Thornhollow Fields battleground map document
// (data/battleground/thornhollow.map.json) from the combat plan plus the
// Thornhollow art kit.
//
// The field is Thornhollow Fields' original, combat-tuned layout, dressed at
// Thornhollow: same 100x280 footprint, same three chambers, same two crossings
// per curtain, same keeps, cover, rune pads and graveyards, now built out of the
// authored map's catalogue architecture, photographed ground textures, sculpted
// relief and light.
//
// The map document is a normal map-editor document, so it can still be opened
// and hand-edited in the editor; it is BUILT rather than hand-placed because it
// carries a couple of thousand placements and a half-million painted cells that
// have to stay point-symmetric to the yard. The pipeline is:
//
//   node scripts/assets/build_battleground_map.mjs      -> data/battleground/thornhollow.map.json
//   node scripts/assets/compile_thornhollow.mjs         -> src/sim/thornhollow_field.generated.ts
//
// Both steps are deterministic (same inputs, byte-identical output) and both are
// freshness-gated by tests/battleground_band.test.ts. Commit both results.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDressing } from './battleground/dressing.mjs';
import {
  BASES,
  GRAVEYARDS,
  HALF_X,
  HALF_Z,
  LOCATIONS,
  POWER_RUNES,
  SPEED_RUNES,
} from './battleground/field_plan.mjs';
import {
  buildPaint,
  GRASS_GROUND,
  makePaintSampler,
  SOFT_GROUND,
} from './battleground/ground_paint.mjs';
import { pieceExtents } from './battleground/kit.mjs';
import { makeHeightAt } from './battleground/stamp_chain.mjs';
import { terrainStamps } from './battleground/terrain.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS_PATH = join(ROOT, 'data', 'battleground', 'thornhollow_assets.json');
const OUT_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(ROOT, 'data', 'battleground', 'thornhollow.map.json');

const assetData = JSON.parse(readFileSync(ASSETS_PATH, 'utf8'));

// Authoring timestamps are FIXED, not wall-clock: the builder has to be
// byte-deterministic so the freshness gate can diff a rebuild against the
// committed document.
const AUTHORED_AT = 1785175003886;
const REVISED_AT = 1785902400000;

const stamps = terrainStamps();
const heightAt = makeHeightAt(stamps);

// ---------------------------------------------------------------------------
// Game-mode anchors: the tagged placements the field compiler turns into the
// record the mode reasons about. Tagged placements never render and never
// collide; the mode draws its own flags, runes and banners as entities.
// ---------------------------------------------------------------------------

const TEAM = [
  {
    name: 'Crimson',
    flagAsset: 'dungeon/banner_triple_red',
    bannerAsset: 'dungeon/banner_shield_red',
  },
  {
    name: 'Azure',
    flagAsset: 'dungeon/banner_triple_blue',
    bannerAsset: 'dungeon/banner_shield_blue',
  },
];

const anchors = [];
for (const base of BASES) {
  const t = TEAM[base.team];
  anchors.push({
    assetId: t.flagAsset,
    x: base.flag.x,
    z: base.flag.z,
    rotY: base.team === 0 ? 0 : Math.PI,
    scale: 2.1,
    collide: false,
    y: 2.5,
    name: `${t.name} flag`,
    regionRole: `flag${base.team}`,
  });
  anchors.push({
    assetId: t.bannerAsset,
    x: base.banner.x,
    z: base.banner.z,
    rotY: base.team === 0 ? 0 : Math.PI,
    scale: 1.7,
    collide: false,
    y: 0.4,
    name: `${t.name} spawn banner`,
    regionRole: `banner${base.team}`,
  });
  // Author order IS spawn order: the compiler sorts by name, so the numbers
  // here are the ring order the mode assigns fighters to.
  base.spawns.forEach((s, i) => {
    anchors.push({
      assetId: 'collider/sphere',
      x: s.x,
      z: s.z,
      rotY: 0,
      scale: 1,
      collide: false,
      sizeX: 2,
      sizeY: 2,
      sizeZ: 2,
      name: `${t.name} spawn ${i + 1}`,
      regionRole: `spawn${base.team}`,
    });
  });
  const plot = GRAVEYARDS[base.team];
  anchors.push({
    assetId: 'collider/box',
    x: plot.x,
    z: plot.z,
    rotY: 0,
    scale: 1,
    collide: false,
    sizeX: plot.hw * 2,
    sizeY: 4,
    sizeZ: plot.hd * 2,
    name: `${t.name} graveyard`,
    regionRole: `graveyard${base.team}`,
  });
}
for (const [role, pads, label] of [
  ['speedRune', SPEED_RUNES, 'Sprint rune'],
  ['powerRune', POWER_RUNES, 'Power rune'],
]) {
  for (const pad of pads) {
    anchors.push({
      assetId: 'collider/box',
      x: pad.x,
      z: pad.z,
      rotY: 0,
      scale: 1,
      collide: false,
      sizeX: 3,
      sizeY: 0.4,
      sizeZ: 3,
      name: label,
      regionRole: role,
    });
  }
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

// The ground is painted FIRST, so the scatter can read it: a grass tuft only
// grows out of painted grass, a fern only sits on soft ground.
const biomePaint = buildPaint();
const swatchAt = makePaintSampler(biomePaint);
const { placements, lights, decals } = buildDressing({
  assetData,
  heightAt,
  grassGround: (x, z) => GRASS_GROUND.has(swatchAt(x, z)),
  softGround: (x, z) => SOFT_GROUND.has(swatchAt(x, z)),
});

// ---------------------------------------------------------------------------
// Collision audit: what you can see, you can touch
// ---------------------------------------------------------------------------
//
// Playtesting found a whole class of props that render as solid objects and
// have no collision at all: posts, lanterns, fallen columns, braziers, and worst
// of all fifteen-yard trees a body walks straight through. Individually each one
// is a one-line oversight; together they make the field feel fake.
//
// So it is not a one-off fix. Every placement is measured against its own baked
// collision body, and one that reads SOLID has to collide or be named here with
// a reason. The build FAILS otherwise, which means the mistake cannot be made
// again quietly.
//
// A body is "solid" when it is at least this wide in BOTH horizontal axes and
// stands at least this tall. Below the height floor a piece is ground litter
// (the physics step carries a body over anything under 0.9yd anyway); below the
// span floor it is a rail, a banner edge or a flat slab.
const SOLID_MIN_SPAN = 0.35;
const SOLID_MIN_TOP = 0.5;

/** The only placements allowed to render solid and not collide, each with the
 *  reason it is honest rather than an oversight. */
const NON_COLLIDING_BY_DESIGN = new Map([
  [
    'Wall torch',
    'mounted above head height on a wall that already blocks; its own body is never reachable',
  ],
  ['Grave rail', 'art laid over an explicit invisible rail volume, which is what actually blocks'],
  [
    'Hollow slope',
    'the wooded lip OUTSIDE the ramparts: out of play, unreachable, and pure silhouette',
  ],
  ['Undergrowth', 'ferns and bushes, which the open world does not collide either'],
]);

const solidProblems = [];
const guessedBodies = [];
const unmeasured = new Set();
let solidChecked = 0;
for (const p of placements) {
  if (p.assetId.startsWith('collider/') || p.assetId === 'grass/patch' || p.hidden) continue;
  let body;
  try {
    body = pieceExtents(assetData, p.assetId);
  } catch {
    unmeasured.add(p.assetId);
    // A COLLIDING piece with no baked body falls back to a guessed circle whose
    // radius is a per-family factor times its scale. This field blocks with
    // MEASURED bodies only, so that fallback is a defect here, not a feature.
    if (p.collide)
      guessedBodies.push(`${p.assetId} "${p.name ?? '(unnamed)'}" at (${p.x}, ${p.z})`);
    continue;
  }
  const s = p.scale > 0 ? p.scale : 1;
  const spanX = body.width * s * (p.scaleX ?? 1);
  const spanZ = body.depth * s * (p.scaleZ ?? 1);
  const top = body.top * s * (p.scaleY ?? 1);
  if (Math.min(spanX, spanZ) < SOLID_MIN_SPAN || top < SOLID_MIN_TOP) continue;
  solidChecked++;
  if (p.collide) continue;
  if (NON_COLLIDING_BY_DESIGN.has(p.name)) continue;
  solidProblems.push(
    `${p.assetId} "${p.name ?? '(unnamed)'}" at (${p.x}, ${p.z}): renders ` +
      `${spanX.toFixed(2)}x${spanZ.toFixed(2)}yd and ${top.toFixed(2)}yd tall with no collision`,
  );
}
if (guessedBodies.length > 0) {
  throw new Error(
    `${guessedBodies.length} colliding placement(s) have no baked collision body, so they would\n` +
      'block with a guessed circle instead of their own measured shape. Use a species that is\n' +
      'in data/battleground/thornhollow_assets.json, or stop it colliding:\n  ' +
      guessedBodies.join('\n  '),
  );
}
if (solidProblems.length > 0) {
  throw new Error(
    `${solidProblems.length} placement(s) render solid but do not collide. Give each one\n` +
      "`collide: true, collisionMode: 'baked'`, or add its name to NON_COLLIDING_BY_DESIGN\n" +
      'with the reason it is honest:\n  ' +
      solidProblems.join('\n  '),
  );
}

// Perimeter blockers: a belt-and-braces seal around the rect, independent of
// the rampart art, so no seam between two wall modules can ever leak a body out
// of the field.
const blockers = [];
for (const [x1, z1, x2, z2] of [
  [-HALF_X, -HALF_Z, HALF_X, -HALF_Z],
  [HALF_X, -HALF_Z, HALF_X, 0],
  [HALF_X, 0, HALF_X, HALF_Z],
  [HALF_X, HALF_Z, -HALF_X, HALF_Z],
  [-HALF_X, HALF_Z, -HALF_X, 0],
  [-HALF_X, 0, -HALF_X, -HALF_Z],
]) {
  blockers.push({ x1, z1, x2, z2 });
}

const map = {
  version: 2,
  meta: {
    id: 'thornhollow_v3',
    name: 'Thornhollow Fields',
    description:
      'Thornhollow Fields: a walled hollow in the old growth below Thornpeak. ' +
      'Crimson and Azure hold a keep at either end of the ravine floor, two curtain ' +
      'walls carve the field into three chambers, and the Ruin Courtyard between them ' +
      'settles what the flags cannot.',
    createdAt: AUTHORED_AT,
    updatedAt: REVISED_AT,
    seed: 20061,
    parentId: '',
  },
  content: {
    zones: [
      {
        id: 'blank_world',
        name: 'Thornhollow',
        zMin: -HALF_Z,
        zMax: HALF_Z,
        levelRange: [1, 1],
        biome: 'vale',
        hub: { x: 0, z: 0, radius: 8, name: '' },
        graveyard: { x: 0, z: 0 },
        lakes: [],
        pois: [],
        welcome: '',
      },
    ],
    camps: [],
    npcs: {},
    objects: [],
    roads: [],
  },
  terrainEdits: stamps,
  placements: [...anchors, ...placements],
  biomePaint,
  blockers,
  waterLevel: -40,
  worldHalfX: HALF_X,
  playerStart: { x: 0, z: -113 },
  propsMode: 'empty',
  decorationsMode: 'empty',
  presentationMode: 'blank',
  skybox: 'builtin:vale_day',
  locations: LOCATIONS,
  lights,
  terrainStyle: { slopeRock: false, snowCaps: false, rimMountains: false, shoreSand: false },
  assetViewDistance: 400,
  weather: { clouds: { coverage: 0.32, height: 78 } },
  lighting: {
    sunIntensity: 2.5,
    sunColor: 16773330,
    hemiIntensity: 0.75,
    skyColor: 10469608,
    envScale: 1.05,
    sunAzimuthDeg: 118,
    sunElevationDeg: 46,
  },
  decals,
};

writeFileSync(OUT_PATH, JSON.stringify(map));
const kinds = new Set(placements.map((p) => p.assetId));
console.log(
  `wrote ${OUT_PATH}: ${stamps.length} stamps, ${anchors.length} anchors, ` +
    `${placements.length} placements over ${kinds.size} assets, ${lights.length} lights, ` +
    `${decals.length} decals, paint ${biomePaint.cols}x${biomePaint.rows}`,
);
console.log(
  `  collision audit: ${solidChecked} solid-reading placements, all colliding or named` +
    (unmeasured.size > 0
      ? `; no baked body to measure for ${[...unmeasured].sort().join(', ')}`
      : ''),
);

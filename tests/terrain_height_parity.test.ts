import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BEACON_SPIRAL } from '../src/sim/beacon_spiral';
import { CASTLE, LAST_SPRING } from '../src/sim/castle_layout';
import { STABLE_FLAT } from '../src/sim/content/mounts';
import {
  ARENA_SLOT_COUNT,
  ARENA_X,
  ARENA_X_MAX,
  ARENA_X_MIN,
  arenaOrigin,
  BUILTIN_WORLD,
  DELVE_BAND_X_MIN,
  DELVE_LIST,
  DELVE_SLOT_COUNT,
  DELVE_X_MIN,
  DUNGEON_LIST,
  DUNGEON_OVERFLOW_X_BASE,
  DUNGEON_X_THRESHOLD,
  delveOrigin,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  RIFT_BAND_X_MAX,
  RIFT_BAND_X_MIN,
  RIFT_MAX_FLOORS,
  RIFT_SLOT_COUNT,
  RIFT_X_MIN,
  riftInstanceOrigin,
  STRIP_MAX_X,
  STRIP_MIN_X,
  VC_PRACTICE_BAND_X_MIN,
  VC_PRACTICE_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  YUMI_BAND_X_MAX,
  YUMI_BAND_X_MIN,
  YUMI_MAZE_SLOT_COUNT,
  YUMI_MAZE_X,
  yumiMazeOrigin,
} from '../src/sim/data';
import { GALE_HARBOR_DECKS, type GaleDeckDef } from '../src/sim/gale_harbor';
import { REACH_DECKS } from '../src/sim/reach_decks';
import { SOWFIELD_FLAT, STAND_NORTH, STAND_SOUTH } from '../src/sim/vale_cup_layout';
import {
  computeBorderEdges,
  GARDEN_BED_PADS,
  groundHeight,
  HOLLOW_FALLS,
  MIREFEN_IMPACT_CRATER,
  terrainHeight,
} from '../src/sim/world';

const FIXTURE_URL = new URL('./fixtures/terrain_height_parity.v1.f64le.gz', import.meta.url);
const UPDATE = process.env.UPDATE_TERRAIN_HEIGHT_PARITY === '1';
const MAGIC = 'WOCTH001';
const FORMAT_VERSION = 1;
const HEADER_BYTES = 20;
const LANE_COUNT = 2;
const SEEDS = [20_061, 1_337, 42, 2_147_483_647] as const;
const ATLAS_STEP = 6;
const ATLAS_MARGIN = 72;

interface HeightPoint {
  label: string;
  x: number;
  z: number;
  seed: number;
}

function buildPoints(): HeightPoint[] {
  const points: HeightPoint[] = [];
  const seen = new Set<string>();

  const add = (label: string, x: number, z: number, seed?: number): void => {
    const resolvedSeed = seed ?? SEEDS[points.length % SEEDS.length];
    const key = `${x},${z},${resolvedSeed}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push({ label, x, z, seed: resolvedSeed });
  };

  const addStencil = (label: string, x: number, z: number, radius: number): void => {
    add(`${label} center`, x, z);
    const diag = Math.SQRT1_2;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [diag, diag],
      [diag, -diag],
      [-diag, diag],
      [-diag, -diag],
    ] as const;
    for (const scale of [0.29, 0.86, 1.03]) {
      for (let i = 0; i < dirs.length; i++) {
        const [dx, dz] = dirs[i];
        add(
          `${label} ring ${scale} ${i}`,
          x + dx * radius * scale + Math.SQRT2 / 997,
          z + dz * radius * scale + Math.PI / 991,
        );
      }
    }
  };

  const addRect = (label: string, x0: number, x1: number, z0: number, z1: number): void => {
    for (const tx of [0, 0.25, 0.5, 0.75, 1]) {
      for (const tz of [0, 0.25, 0.5, 0.75, 1]) {
        add(`${label} rect ${tx} ${tz}`, x0 + (x1 - x0) * tx, z0 + (z1 - z0) * tz);
      }
    }
  };

  const atlasMinX = WORLD_MIN_X - ATLAS_MARGIN;
  const atlasMaxX = WORLD_MAX_X + ATLAS_MARGIN;
  const atlasMinZ = WORLD_MIN_Z - ATLAS_MARGIN;
  const atlasMaxZ = WORLD_MAX_Z + ATLAS_MARGIN;
  for (let z = atlasMinZ; z <= atlasMaxZ; z += ATLAS_STEP) {
    for (let x = atlasMinX; x <= atlasMaxX; x += ATLAS_STEP) {
      add('dense overworld atlas', x, z);
    }
  }

  const atlasSpanX = atlasMaxX - atlasMinX;
  const atlasSpanZ = atlasMaxZ - atlasMinZ;
  for (let k = 1; k <= 8_192; k++) {
    add(
      'irrational scatter',
      atlasMinX + ((k * Math.SQRT2) % atlasSpanX),
      atlasMinZ + ((k * (Math.PI + Math.SQRT2)) % atlasSpanZ),
    );
  }

  for (const zone of BUILTIN_WORLD.zones) {
    const x0 = zone.xMin ?? STRIP_MIN_X;
    const x1 = zone.xMax ?? STRIP_MAX_X;
    addRect(`zone ${zone.id}`, x0, x1, zone.zMin, zone.zMax);
    addStencil(`zone ${zone.id} hub`, zone.hub.x, zone.hub.z, zone.hub.radius * 1.6);
    if (zone.graveyard)
      addStencil(`zone ${zone.id} graveyard`, zone.graveyard.x, zone.graveyard.z, 8);
    for (let i = 0; i < zone.lakes.length; i++) {
      const lake = zone.lakes[i];
      addStencil(`zone ${zone.id} lake ${i}`, lake.x, lake.z, lake.radius * 1.84);
    }
    for (let i = 0; i < zone.pois.length; i++) {
      const poi = zone.pois[i];
      addStencil(`zone ${zone.id} poi ${poi.id ?? i}`, poi.x, poi.z, 8);
    }
  }

  for (let i = 0; i < BUILTIN_WORLD.camps.length; i++) {
    const camp = BUILTIN_WORLD.camps[i];
    addStencil(`camp ${i} ${camp.mobId}`, camp.center.x, camp.center.z, camp.radius * 1.8 + 1);
  }
  for (let i = 0; i < BUILTIN_WORLD.roads.length; i++) {
    const road = BUILTIN_WORLD.roads[i];
    for (let j = 0; j < road.length; j++) {
      addStencil(`road ${i} point ${j}`, road[j].x, road[j].z, 8);
    }
  }
  for (let i = 0; i < (BUILTIN_WORLD.terrainEdits?.length ?? 0); i++) {
    const edit = BUILTIN_WORLD.terrainEdits?.[i];
    if (edit) addStencil(`terrain edit ${i}`, edit.x, edit.z, edit.radius);
  }
  for (const dungeon of DUNGEON_LIST) {
    addStencil(`dungeon door ${dungeon.id}`, dungeon.doorPos.x, dungeon.doorPos.z, 8);
  }

  const borders = computeBorderEdges(BUILTIN_WORLD.zones);
  for (let i = 0; i < borders.length; i++) {
    const edge = borders[i];
    const alongs = [
      edge.lo,
      edge.lo + (edge.hi - edge.lo) * 0.25,
      edge.passAt,
      edge.lo + (edge.hi - edge.lo) * 0.5,
      edge.lo + (edge.hi - edge.lo) * 0.75,
      edge.hi,
    ];
    for (const along of alongs) {
      for (const offset of [-110, -104, -52, -26, -12, -1, 0, 1, 12, 26, 52, 104, 110]) {
        if (edge.kind === 'h') add(`border ${i}`, along, edge.at + offset);
        else add(`border ${i}`, edge.at + offset, along);
      }
    }
  }

  const namedFeatures = [
    { label: 'Galecrest raider pad', x: 252, z: 250, r: 19 },
    { label: 'Galecrest raider pad', x: 210, z: 410, r: 19 },
    { label: 'Galecrest raider pad', x: 354, z: 664, r: 19 },
    { label: 'Galecrest stable pad', x: 299, z: 531, r: 17 },
    { label: 'Galecrest Beacon lawn', x: 498, z: 308, r: 16 },
    { label: 'Galecrest Mirror Tarn shore', x: 300, z: 560, r: 32 },
    { label: 'Beacon dock stair cutting', x: 503.3, z: 325.3, r: 10.6 },
    { label: 'Last Spring bank', x: LAST_SPRING.x, z: LAST_SPRING.z, r: 18 },
    { label: 'Palmreach reach pool walkway', x: -370, z: 1004, r: 16 },
    { label: 'Bridgemere island', x: -360, z: 362, r: 19 },
    {
      label: 'Mirefen impact crater',
      x: MIREFEN_IMPACT_CRATER.x,
      z: MIREFEN_IMPACT_CRATER.z,
      r: MIREFEN_IMPACT_CRATER.radius,
    },
    {
      label: 'Hollow falls',
      x: HOLLOW_FALLS.terrace.x,
      z: HOLLOW_FALLS.terrace.z,
      r: HOLLOW_FALLS.terrace.radius,
    },
  ] as const;
  for (const feature of namedFeatures) {
    addStencil(feature.label, feature.x, feature.z, feature.r);
  }
  for (let i = 0; i < GARDEN_BED_PADS.length; i++) {
    const pad = GARDEN_BED_PADS[i];
    addStencil(`Evergarden bed pad ${i}`, pad.x, pad.z, pad.r + 4);
  }

  addRect('Last Keep castle pad', CASTLE.pad.x0, CASTLE.pad.x1, CASTLE.pad.z0, CASTLE.pad.z1);
  addRect('Last Keep inner ward', CASTLE.ward.x0, CASTLE.ward.x1, CASTLE.ward.z0, CASTLE.ward.z1);
  addRect(
    'Sowfield level pad',
    SOWFIELD_FLAT.xMin - SOWFIELD_FLAT.falloff,
    SOWFIELD_FLAT.xMax + SOWFIELD_FLAT.falloff,
    SOWFIELD_FLAT.zMin - SOWFIELD_FLAT.falloff,
    SOWFIELD_FLAT.zMax + SOWFIELD_FLAT.falloff,
  );
  addRect(
    'Sowfield north stand',
    STAND_NORTH.xMin,
    STAND_NORTH.xMax,
    STAND_NORTH.zMin,
    STAND_NORTH.zMax,
  );
  addRect(
    'Sowfield south stand',
    STAND_SOUTH.xMin,
    STAND_SOUTH.xMax,
    STAND_SOUTH.zMin,
    STAND_SOUTH.zMax,
  );
  addRect(
    'Highwatch stable pad',
    STABLE_FLAT.x1 - STABLE_FLAT.falloff,
    STABLE_FLAT.x2 + STABLE_FLAT.falloff,
    STABLE_FLAT.z1 - STABLE_FLAT.falloff,
    STABLE_FLAT.z2 + STABLE_FLAT.falloff,
  );
  addStencil('Old Beacon spiral', BEACON_SPIRAL.x, BEACON_SPIRAL.z, BEACON_SPIRAL.balconyOut + 0.6);

  const addDeck = (label: string, deck: GaleDeckDef): void => {
    const dirX = Math.sin(deck.rot);
    const dirZ = Math.cos(deck.rot);
    for (const along of [-deck.hl * 1.03, -deck.hl, 0, deck.hl, deck.hl * 1.03]) {
      for (const across of [-deck.hw * 1.03, -deck.hw, 0, deck.hw, deck.hw * 1.03]) {
        add(label, deck.x + along * dirX + across * dirZ, deck.z + along * dirZ - across * dirX);
      }
    }
  };
  for (let i = 0; i < GALE_HARBOR_DECKS.length; i++) {
    addDeck(`Galecrest deck ${i}`, GALE_HARBOR_DECKS[i]);
  }
  for (let i = 0; i < REACH_DECKS.length; i++) addDeck(`Palmreach deck ${i}`, REACH_DECKS[i]);

  const instanceXs = new Set<number>([
    DUNGEON_X_THRESHOLD,
    DUNGEON_OVERFLOW_X_BASE,
    ARENA_X_MIN,
    ARENA_X,
    ARENA_X_MAX,
    DELVE_BAND_X_MIN,
    DELVE_X_MIN,
    VC_PRACTICE_BAND_X_MIN,
    VC_PRACTICE_X,
    RIFT_BAND_X_MIN,
    RIFT_X_MIN,
    RIFT_BAND_X_MAX,
    YUMI_BAND_X_MIN,
    YUMI_MAZE_X,
    YUMI_BAND_X_MAX,
  ]);
  for (const dungeon of DUNGEON_LIST) {
    const x = instanceOrigin(dungeon.index, 0).x;
    instanceXs.add(x - 300);
    instanceXs.add(x);
    instanceXs.add(x + 300);
  }
  const instanceZs: number[] = [];
  for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
    const z = instanceOrigin(0, slot).z;
    instanceZs.push(z);
    if (slot + 1 < INSTANCE_SLOT_COUNT) {
      instanceZs.push((z + instanceOrigin(0, slot + 1).z) / 2 + Math.E / 113);
    }
  }
  for (const x of [...instanceXs].sort((a, b) => a - b)) {
    for (const z of instanceZs) {
      add('instance x routing west', x - Math.SQRT2 / 13, z);
      add('instance x routing exact', x, z);
      add('instance x routing east', x + Math.PI / 17, z);
    }
  }

  const localOffsets = [-240, -24 * Math.SQRT2, 0, 24 * Math.SQRT2, 240];
  for (const dungeon of DUNGEON_LIST) {
    for (const slot of [0, 1, 12, INSTANCE_SLOT_COUNT - 1]) {
      const origin = instanceOrigin(dungeon.index, slot);
      for (const dx of localOffsets) {
        for (const dz of localOffsets)
          add(`dungeon ${dungeon.id} slot ${slot}`, origin.x + dx, origin.z + dz);
      }
    }
  }
  for (let slot = 0; slot < ARENA_SLOT_COUNT; slot++) {
    const origin = arenaOrigin(slot);
    addStencil(`arena slot ${slot}`, origin.x, origin.z, 80);
  }
  for (const delve of DELVE_LIST) {
    for (const slot of [0, 1, 12, DELVE_SLOT_COUNT - 1]) {
      const origin = delveOrigin(delve.index, slot);
      addStencil(`delve ${delve.id} slot ${slot}`, origin.x, origin.z, 120);
    }
  }
  for (let slot = 0; slot < RIFT_SLOT_COUNT; slot++) {
    for (let floor = 0; floor < RIFT_MAX_FLOORS; floor++) {
      const origin = riftInstanceOrigin(slot, floor);
      addStencil(`rift slot ${slot} floor ${floor}`, origin.x, origin.z, 160);
    }
  }
  for (let slot = 0; slot < YUMI_MAZE_SLOT_COUNT; slot++) {
    const origin = yumiMazeOrigin(slot);
    addStencil(`Yumi maze slot ${slot}`, origin.x, origin.z, 100);
  }

  return points;
}

function captureFixture(points: readonly HeightPoint[]): Buffer {
  const raw = Buffer.allocUnsafe(HEADER_BYTES + points.length * LANE_COUNT * 8);
  raw.write(MAGIC, 0, 'ascii');
  raw.writeUInt32LE(FORMAT_VERSION, 8);
  raw.writeUInt32LE(points.length, 12);
  raw.writeUInt32LE(LANE_COUNT, 16);
  let offset = HEADER_BYTES;
  for (const point of points) {
    raw.writeDoubleLE(terrainHeight(point.x, point.z, point.seed), offset);
    offset += 8;
    raw.writeDoubleLE(groundHeight(point.x, point.z, point.seed), offset);
    offset += 8;
  }
  return gzipSync(raw, { level: 9 });
}

describe('terrain height bit identity', () => {
  // Cross-host libm parity. The authored corpus is bit-identical for a given host,
  // but the transcendental calls under terrainHeight (pow/exp/sin) are permitted a
  // half-ULP each by IEEE 754, and glibc and Apple's libm land on different sides
  // for a handful of inputs. Accept a ONE-ULP gap for finite, non-zero results
  // only; two-ULP drift, any signed-zero change, and any non-finite mismatch still
  // fail, so a real regression in the height field cannot hide behind this.
  const ulpView = new DataView(new ArrayBuffer(8));
  function orderedBits(value: number): bigint {
    ulpView.setFloat64(0, value);
    const bits = ulpView.getBigUint64(0);
    // Map IEEE754 to a monotonic integer so adjacent doubles differ by exactly 1.
    return bits & 0x8000000000000000n ? 0x8000000000000000n - (bits & 0x7fffffffffffffffn) : bits;
  }
  function heightsMatch(actual: number, expected: number): boolean {
    if (Object.is(actual, expected)) return true;
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    // Rejects a signed-zero flip and any crossing of zero.
    if (actual === 0 || expected === 0) return false;
    const a = orderedBits(actual);
    const b = orderedBits(expected);
    return (a > b ? a - b : b - a) <= 1n;
  }

  it('keeps terrainHeight and groundHeight within one ULP over the authored world corpus', () => {
    const points = buildPoints();
    if (UPDATE) writeFileSync(FIXTURE_URL, captureFixture(points));

    const fixture = gunzipSync(readFileSync(FIXTURE_URL));
    expect(fixture.toString('ascii', 0, 8)).toBe(MAGIC);
    expect(fixture.readUInt32LE(8)).toBe(FORMAT_VERSION);
    expect(fixture.readUInt32LE(12)).toBe(points.length);
    expect(fixture.readUInt32LE(16)).toBe(LANE_COUNT);
    expect(fixture.byteLength).toBe(HEADER_BYTES + points.length * LANE_COUNT * 8);

    let comparisons = 0;
    let offset = HEADER_BYTES;
    const mismatches: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const actualTerrain = terrainHeight(point.x, point.z, point.seed);
      const expectedTerrain = fixture.readDoubleLE(offset);
      offset += 8;
      comparisons++;
      if (!heightsMatch(actualTerrain, expectedTerrain) && mismatches.length < 20) {
        mismatches.push(
          `terrainHeight point ${i} (${point.label}) x=${point.x} z=${point.z} seed=${point.seed}: expected ${expectedTerrain}, received ${actualTerrain}`,
        );
      }

      const actualGround = groundHeight(point.x, point.z, point.seed);
      const expectedGround = fixture.readDoubleLE(offset);
      offset += 8;
      comparisons++;
      if (!heightsMatch(actualGround, expectedGround) && mismatches.length < 20) {
        mismatches.push(
          `groundHeight point ${i} (${point.label}) x=${point.x} z=${point.z} seed=${point.seed}: expected ${expectedGround}, received ${actualGround}`,
        );
      }
    }

    expect(comparisons).toBeGreaterThanOrEqual(200_000);
    expect(mismatches, mismatches.join('\n')).toHaveLength(0);
  }, 30_000);
});

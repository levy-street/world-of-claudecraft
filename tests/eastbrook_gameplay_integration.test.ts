import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildingContainsPoint } from '../src/sim/building_layout';
import {
  colliderInternalsForTest,
  isBlocked,
  lineOfSightClear,
  pathCrossesFence,
  resolveMovement,
} from '../src/sim/colliders';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { STATION_RADIUS, STATIONS } from '../src/sim/content/professions';
import { FURY_ENTITY_ID, FURY_NPC_ID } from '../src/sim/content/pvp_honor';
import { ZONE1_CAMPS, ZONE1_NPCS, ZONE1_PROPS, ZONE1_ROADS } from '../src/sim/content/zone1';
import { BUILTIN_WORLD, CAMPS, PLAYER_START, QUESTS, setActiveWorldContent } from '../src/sim/data';
import {
  EASTBROOK_LAYOUT,
  EASTBROOK_NPC_PLACEMENTS_BY_ID,
  EASTBROOK_STATIONS_BY_ID,
  localToWorld,
  samplePolyline,
} from '../src/sim/eastbrook_layout';
import {
  findPath,
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from '../src/sim/pathfind';
import { petOf, setPetMode, summonPet } from '../src/sim/pet/pet_commands';
import { isAtStation } from '../src/sim/professions/stations';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type NpcDef,
  type ZonePropsDef,
} from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 20061;
const ZONE1_TOWN_NPC_IDS = EASTBROOK_LAYOUT.services.npcs
  .map((npc) => npc.id)
  .filter((id) => id in ZONE1_NPCS);

afterEach(() => setActiveWorldContent(null));

function npcEntity(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) => candidate.kind === 'npc' && candidate.templateId === templateId,
  );
  if (!entity) throw new Error(`missing NPC entity ${templateId}`);
  return entity;
}

function standAt(sim: Sim, pid: number, target: { x: number; z: number }): Entity {
  const player = sim.entities.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  player.pos = sim.groundPos(target.x, target.z);
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return player;
}

function stableTownNpcPayload(): Record<string, Omit<NpcDef, 'pos' | 'facing'> | NpcDef> {
  return Object.fromEntries(
    Object.entries(ZONE1_NPCS).map(([id, def]) => {
      if (def.dynamic) return [id, def];
      const { pos: _pos, facing: _facing, ...stable } = def;
      return [id, stable];
    }),
  );
}

function midpoint(a: { x: number; z: number }, b: { x: number; z: number }) {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function expectWalkableRoute(
  label: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  bodyRadius: number,
): void {
  const options = {
    seed: SEED,
    bodyRadius,
    maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
    minGround: (x: number, z: number) => waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH,
    maxSpan: 128,
  } as const;
  let route = findPath(from, to, options);
  expect(route.length, `${label} has no route`).toBeGreaterThan(0);
  let current = { ...from };
  let waypointIndex = 0;
  let stalledTicks = 0;
  expect(isBlocked(SEED, current.x, current.z, bodyRadius), `${label} start blocked`).toBe(false);
  expect(isBlocked(SEED, to.x, to.z, bodyRadius), `${label} destination blocked`).toBe(false);

  // Follow the path through the real collision resolver. This mirrors runtime
  // movement: a tangent grid waypoint may slide around a collider before the
  // follower reaches it, so proof is based on actual resolved positions.
  for (let stepIndex = 0; stepIndex < 2_000; stepIndex++) {
    if (Math.hypot(to.x - current.x, to.z - current.z) <= 0.2) break;
    while (
      waypointIndex < route.length - 1 &&
      Math.hypot(route[waypointIndex].x - current.x, route[waypointIndex].z - current.z) <= 0.25
    ) {
      waypointIndex++;
    }
    const waypoint = route[waypointIndex] ?? to;
    const dx = waypoint.x - current.x;
    const dz = waypoint.z - current.z;
    const distance = Math.max(Math.hypot(dx, dz), Number.EPSILON);
    const stride = Math.min(0.2, distance);
    const desired = {
      x: current.x + (dx / distance) * stride,
      z: current.z + (dz / distance) * stride,
    };
    const resolved = resolveMovement(SEED, current.x, current.z, desired.x, desired.z, bodyRadius);
    expect(
      pathCrossesFence(current.x, current.z, resolved.x, resolved.z, bodyRadius),
      `${label} crosses a fence`,
    ).toBe(false);
    expect(isBlocked(SEED, resolved.x, resolved.z, bodyRadius), `${label} resolved blocked`).toBe(
      false,
    );
    const moved = Math.hypot(resolved.x - current.x, resolved.z - current.z);
    const previousGround = groundHeight(current.x, current.z, SEED);
    const nextGround = groundHeight(resolved.x, resolved.z, SEED);
    expect(nextGround, `${label} enters deep water`).toBeGreaterThanOrEqual(
      waterLevelAt(resolved.x, resolved.z, SEED) - PLAYER_SWIM_DEPTH,
    );
    expect(
      (nextGround - previousGround) / Math.max(moved, Number.EPSILON),
      `${label} exceeds climb slope`,
    ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    current = resolved;
    stalledTicks = moved < 1e-4 ? stalledTicks + 1 : 0;
    if (stalledTicks >= 4) {
      route = findPath(current, to, options);
      waypointIndex = 0;
      stalledTicks = 0;
    }
  }
  expect(Math.hypot(to.x - current.x, to.z - current.z), `${label} endpoint`).toBeLessThanOrEqual(
    0.2,
  );
}

function placeEntity(sim: Sim, entity: Entity, point: { x: number; z: number }): void {
  entity.pos = sim.groundPos(point.x, point.z);
  entity.prevPos = { ...entity.pos };
  entity.vx = 0;
  entity.vy = 0;
  entity.vz = 0;
  entity.onGround = true;
  entity.fallStartY = entity.pos.y;
  sim.rebucket(entity);
}

// Re-minted 2026-08-18 for the harbor move (commit d19aa33f76,
// docs/design/eastbrook-revamp/site-plan.md): the fixture's premise is "the
// same world with the town expressed as plain legacy prop rows", so both
// worlds present identical collision everywhere. The old-town rows that used
// to sit here now stand on ground that became Wolf Run open country, and a
// scattered wolf spawn deflected off a house row that existed only in this
// fixture. Every row below is probed from the live derived ZONE1_PROPS and
// EASTBROOK_LAYOUT values: the six harbor lots as plain building rows (the
// chapel keeps its assetId because an assetId-less chapel collides as the
// legacy COMPOSED tower-and-hall pair, not the authored single OBB the live
// town presents), the well beacon row at its civic square position, the two
// sized market stalls (w/d/height drive the authored OBB collider), the
// three smithy-yard fences at their probed endpoints, and no town campfire
// (the retired [3, -4] row sat inside what is now Wolf Run: exactly the
// class of collider that forked the wolf projection). Round 4 dropped the
// armoury landmark row: the live town no longer places it, and the barracks
// garrison that took the lot rides through unchanged as decorProps in BOTH
// worlds via the ...current spread. Round 6b re-probed the two stall rows to
// the opened-out market square: this fixture only holds if its plain rows carry
// the SAME collision as the live authored stalls, so a stale position here
// forks the wolf projection at the bottom of this file rather than the town.
function legacyEastbrookProps(current: ZonePropsDef): ZonePropsDef {
  const townBuildingIds = new Set(
    [...EASTBROOK_LAYOUT.preservedBuildings, ...EASTBROOK_LAYOUT.buildings].map(
      (building) => building.id,
    ),
  );
  return {
    ...current,
    buildings: [
      { kind: 'house', x: 12, z: -94, w: 7, d: 5.5, rot: -2.356194490192345 },
      { kind: 'house', x: -2, z: -122, w: 7, d: 5.5, rot: -2.0344439357957027 },
      { kind: 'inn', x: -38, z: -88, w: 7.5, d: 6, rot: -2.5535900500422257 },
      {
        kind: 'chapel',
        assetId: '/models/props/eastbrook_chapel.glb',
        x: 2,
        z: -78,
        w: 5.5,
        d: 6,
        rot: 0.7853981633974483,
      },
      { kind: 'house', x: -28, z: -122, w: 5.5, d: 4.5, rot: 2.5535900500422257 },
      { kind: 'house', x: -16, z: -128, w: 5.5, d: 4.5, rot: 0.5880026035475675 },
      ...current.buildings.filter((building) => !building.id || !townBuildingIds.has(building.id)),
    ],
    wells: [
      { x: -14.75, z: -102, r: 1.5 },
      ...current.wells.filter((well) => well.id !== EASTBROOK_LAYOUT.civic.wellBeacon.id),
    ],
    stalls: [
      {
        x: -20.5,
        z: -94,
        rot: 2.4805494847391065,
        r: 1.7804493814764857,
        w: 2.8,
        d: 2.2,
        height: 2.7,
      },
      {
        x: -19,
        z: -108,
        rot: 0.6610431688506869,
        r: 1.7804493814764857,
        w: 2.8,
        d: 2.2,
        height: 2.7,
      },
      ...current.stalls.filter((stall) => !stall.id?.startsWith('eastbrook_market_stall_')),
    ],
    fences: [
      {
        x1: 4.395154415649398,
        z1: -123.83357574154984,
        x2: 2.8746281909495415,
        z2: -124.59383885389975,
        width: 0.28,
        height: 0.9,
      },
      {
        x1: 4.529318494299386,
        z1: -123.43108350559987,
        x2: 0.7727242920997393,
        z2: -115.91789510120057,
        width: 0.28,
        height: 0.9,
      },
      {
        x1: 0.37023205614977694,
        z1: -115.78373102255058,
        x2: -1.1502941685500798,
        z2: -116.5439941349005,
        width: 0.28,
        height: 0.9,
      },
      ...current.fences.filter((fence) => !fence.id?.startsWith('eastbrook_fence_')),
    ],
    benches: current.benches?.filter((bench) => !bench.id.startsWith('eastbrook_')),
    walls: current.walls?.filter((wall) => !wall.id.startsWith('eastbrook_wall_')),
  };
}

describe('Eastbrook authored gameplay data integration', () => {
  it('replaces only the town prop inventory and preserves every exterior prop row in order', () => {
    // Round 4: the preserved Grand Armoury row retired with the barracks
    // swap; the building table is exactly the authored layout lots now, and
    // the KayKit barracks + watch tower garrison the old lot as decorProps
    // (pinned in tests/eastbrook_grand_armoury.test.ts).
    expect(ZONE1_PROPS.buildings.map((building) => building.id)).toEqual(
      EASTBROOK_LAYOUT.buildings.map((building) => building.id),
    );
    expect(ZONE1_PROPS.buildings.some((building) => building.landmark)).toBe(false);
    // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the well beacon moved with
    // the civic square to the harbor site.
    expect(ZONE1_PROPS.wells).toEqual([
      expect.objectContaining({
        id: EASTBROOK_LAYOUT.civic.wellBeacon.id,
        x: -14.75,
        z: -102,
        r: 1.5,
      }),
    ]);
    expect(
      ZONE1_PROPS.stalls.map((stall) => [stall.id, stall.x, stall.z, stall.w, stall.d]),
    ).toEqual(
      EASTBROOK_LAYOUT.market.stalls.map((stall) => [
        stall.id,
        stall.position.x,
        stall.position.z,
        stall.width,
        stall.depth,
      ]),
    );
    expect(ZONE1_PROPS.stalls.map((stall) => stall.id)).not.toContain(
      'eastbrook_market_stall_artisans',
    );
    expect(ZONE1_PROPS.benches?.map((bench) => bench.id)).toEqual(
      EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id),
    );
    expect(ZONE1_PROPS.walls?.map((wall) => wall.id)).toEqual(
      EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
    );
    expect(ZONE1_PROPS.fences.map((fence) => fence.id)).toEqual(
      EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
    );

    expect(ZONE1_PROPS.mines).toEqual([{ x: -38, z: 138, rot: 0.8 }]);
    expect(ZONE1_PROPS.docks).toEqual([
      { x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } },
    ]);
    // Re-pinned for owner refinement round 6: the vale bandit camp swapped
    // centers with the wild boar camp, so the first two tents, the first two
    // crates and the first campfire (the band's own dressing) travelled north
    // with it, while Gorrak's rows stayed put. The same round added a
    // fisherman's camp on the strand south of the quay, one tent and one fire
    // beside the beached rowboats.
    // Re-pinned again for owner round 6b: Gorrak's camp joined the main bandit
    // band northeast, so his two tents, his two crates and his fire travelled
    // with the boss to the reunited camp around (115, 42).
    expect(ZONE1_PROPS.tents).toEqual([
      { x: 58, z: 25, rot: 0.4, scale: 1 },
      { x: 68, z: 16, rot: 2.1, scale: 1 },
      { x: 113, z: 47, rot: 1.2, scale: 1.3 },
      { x: 119, z: 39, rot: -0.6, scale: 1 },
      { x: -90.5, z: -78.5, rot: -0.9, scale: 1 },
    ]);
    expect(ZONE1_PROPS.crates).toEqual([
      [56, 22],
      [64, 26],
      [112, 44],
      [118, 40],
      [66, 14],
    ]);
    expect(ZONE1_PROPS.campfires).toEqual([
      [59, 17],
      [111, 46],
      [-93.5, -76.5],
      [-30, 146],
      [-61, 56],
    ]);
    expect(ZONE1_PROPS.mudHuts).toEqual([
      [-73, 59],
      [-78, 54],
      [-69, 55],
    ]);
    expect(ZONE1_PROPS.ruinRings).toEqual([
      { x: 80, z: 78, ringR: 7, columns: 7 },
      { x: -5, z: -60, ringR: 8, columns: 6 },
    ]);
    // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76): the
    // Eastbrook graveyard row moved to the chapel green; the second
    // (exterior) row is unchanged. Re-pinned again for owner refinement
    // round 6, which added two anchors: the north-Vale yard on the Copper Dig
    // road that gives the new gy_vale_north release its headstones, and a
    // second chapel-green plot filling the west half of the wrought-iron
    // churchyard enclosure.
    // Re-pinned for owner round 6b: the retired Vale Chapel Yard anchor at
    // (4, -56) is gone with its graveyard record, because its Pale Keeper stood
    // 15 yd from the rebuilt Eastbrook Rest and read as a duplicate.
    expect(ZONE1_PROPS.graveyards).toEqual([
      { x: -2, z: -70 },
      { x: -22, z: 118 },
      { x: -9, z: -70 },
    ]);
    // Re-pinned for owner refinement round 6b: the Collapsed Reliquary mouth
    // left the town chapel rise and moved to the Mirror Lake shore, so the
    // delve marker travels with it (src/sim/content/zone1.ts delveMarkers).
    expect(ZONE1_PROPS.delveMarkers).toEqual([{ x: -136, z: 112, delveId: 'collapsed_reliquary' }]);
  });

  // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76,
  // docs/design/eastbrook-revamp/site-plan.md), then for owner refinement
  // round 3: the wall and its gates are retired by design, so every road
  // carries gateId null and there is no gate crossing to contain. Round 3
  // added the inn lane (appended last, the by-index spread rule), trimmed
  // the beach promenade to the pulled-in strand, and re-tied the coast
  // track to hug the new waterline.
  it('keeps every preserved exterior road on its authored prefix with no gate crossing', () => {
    expect(ZONE1_ROADS).toHaveLength(7);
    for (let index = 0; index < EASTBROOK_LAYOUT.roads.length; index++) {
      const authored = EASTBROOK_LAYOUT.roads[index];
      expect(ZONE1_ROADS[index].slice(0, authored.points.length)).toEqual(authored.points);
      expect(authored.gateId).toBeNull();
    }
    expect(ZONE1_ROADS.map((road) => road.at(-1))).toEqual([
      { x: -32, z: 140 },
      { x: -92, z: -56 },
      { x: 65, z: -65 },
      { x: -9.2, z: -134 },
      { x: -9, z: -100.4 },
      { x: -96, z: -66 },
      { x: -44, z: -98 },
    ]);
  });

  it('moves only the 15 town NPC placement fields and preserves key order and all other payload', () => {
    expect(Object.keys(ZONE1_NPCS)).toEqual([
      'the_merchant',
      'marshal_redbrook',
      'trader_wilkes',
      'apothecary_lin',
      'brother_aldric',
      'smith_haldren',
      'fisherman_brandt',
      'foreman_odell',
      'bursar_fernando',
      'card_master',
      'chronicler_saul',
      'forgemistress_darva',
      'cook_marlow',
      'weaver_ottilie',
      'tinker_gizzel',
    ]);
    // Reminted for the paladin-only Dawnbound Tome chain, which hangs q_divine_tome
    // off Brother Aldric. The payload covers everything but pos/facing, so a quest
    // added to a town NPC moves it; the placement assertions below still pin every
    // position independently.
    // Everything except pos/facing, hashed: the placement rebuild must not have
    // touched any other NpcDef field. Re-minted deliberately when the gathered
    // materials came off the station masters' vendorItems rows (the ruling that
    // no NPC stocks a gathered material), which is a content change to this
    // payload, not placement drift. Any UNEXPLAINED move here is the bug it
    // was written to catch.
    //
    // Re-minted a second time when Eastbrook stopped stocking the tier-2 and
    // tier-3 land tools, the hub rule that a zone sells the tiers its own
    // nodes use (Eastbrook is entirely tier-1 ground). Exactly three of the 16
    // payloads moved and all three moves are vendorItems rows: trader_wilkes
    // (six tools dropped, both rods kept), forgemistress_darva (two picks
    // dropped) and tinker_gizzel (four axes and sickles dropped). Nothing else
    // in any def, and no placement field, changed. The three row assertions
    // that follow re-check that those are still the rows this case owns.
    //
    // Re-minted a third time by phase 05 of the bank-storage packet, which put
    // the Burlap Reagent Pouch (the one vendor-sold materials-only bag) on the
    // two counters that already stock bags: trader_wilkes and weaver_ottilie,
    // appended at the END of both lists. Exactly two of the payloads moved and
    // both moves are vendorItems rows. Nothing else in any def, and no
    // placement field, changed.
    //
    // The moved rows, asserted BEFORE the digest below so they actually
    // run: a failing expect throws, so stating them after the hash meant they
    // never evaluated in the one case they exist to describe. Ordered this way
    // a drift in some OTHER field of some other NPC moves the hash while these
    // stay green, which is the diagnostic the digest alone cannot give.
    //
    // Re-minted again at the release/v0.41.0 sync, where the Sowfield
    // demolition retired Groundskeeper Bram with the Vale Cup module: his
    // whole record (the one dynamic payload) left the table, and no other def
    // or placement field moved. MEASURED on the merged tree.
    expect(ZONE1_NPCS.trader_wilkes.vendorItems).toEqual([
      'baked_bread',
      'spring_water',
      'roasted_boar',
      'tough_jerky',
      'minor_healing_potion',
      'minor_mana_potion',
      'linen_pouch',
      'travelers_knapsack',
      'copper_mining_pick',
      'handaxe',
      'gathering_sickle',
      'ironreel_fishing_rod',
      'silverstream_fishing_rod',
      'burlap_reagent_pouch',
    ]);
    expect(ZONE1_NPCS.weaver_ottilie.vendorItems).toEqual([
      'linen_pouch',
      'travelers_knapsack',
      'gathering_sickle',
      'spool_of_thread',
      'burlap_reagent_pouch',
    ]);
    expect(ZONE1_NPCS.forgemistress_darva.vendorItems).toEqual([
      'copper_mining_pick',
      'smithing_flux',
    ]);
    expect(ZONE1_NPCS.tinker_gizzel.vendorItems).toEqual([
      'handaxe',
      'simple_fishing_pole',
      'arcanite_bar',
    ]);
    // Re-minted a fourth time (2026-08-18) for the harbor move (commit
    // d19aa33f76, docs/design/eastbrook-revamp/site-plan.md; the reword
    // itself landed with the wave D waterfront, 88f14c6078): exactly one
    // non-placement field moved, Apothecary Lin's greeting, because the
    // spider wood she warns about sits northeast of the harbor site instead
    // of east of the old ring. Asserted BEFORE the digest, same as the
    // vendor rows above, so the one moved field is described where it can
    // actually fail.
    expect(ZONE1_NPCS.apothecary_lin.greeting).toBe(
      'Careful where you step in the northeastern woods, friend.',
    );
    expect(createHash('sha256').update(JSON.stringify(stableTownNpcPayload())).digest('hex')).toBe(
      '3943f298cc9eff07d9dc040c8ff68d401da70e4a1ba9c17efc681aebc0fede44',
    );
    expect(ZONE1_TOWN_NPC_IDS).toHaveLength(15);
    for (const id of ZONE1_TOWN_NPC_IDS) {
      const placement = EASTBROOK_NPC_PLACEMENTS_BY_ID[id];
      expect(ZONE1_NPCS[id].pos).toEqual(placement.position);
      expect(ZONE1_NPCS[id].facing).toBe(placement.facing);
    }
  });

  // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76,
  // docs/design/eastbrook-revamp/site-plan.md): FURY moved with the chapel
  // to the chapel green; position and facing probed from the live layout.
  // Re-pinned for owner round 6b: FURY is the honor quartermaster, a service
  // NPC, so he left the chapel step (7 yd from Brother Aldric) for the town's
  // eastern edge; his facing is still derived, so it moved with him.
  it('spawns layout-authored FURY under a reserved id without shifting nextId or RNG', () => {
    expect(EASTBROOK_NPC_PLACEMENTS_BY_ID.fury).toEqual({
      id: 'fury',
      position: { x: 16, z: -78 },
      facing: -2.2455372690184494,
      anchorId: 'eastbrook_chapel',
      bodyRadius: 0.6,
    });
    expect(BUILTIN_WORLD.npcs[FURY_NPC_ID]).toMatchObject({
      id: 'fury',
      pos: { x: 16, z: -78 },
      facing: -2.2455372690184494,
      dynamic: true,
    });
    expect(FURY_ENTITY_ID).toBe(1_000_000_001);

    const npcsWithoutFury = { ...BUILTIN_WORLD.npcs };
    delete npcsWithoutFury[FURY_NPC_ID];
    const worldWithoutFury = { ...BUILTIN_WORLD, npcs: npcsWithoutFury };
    setActiveWorldContent(worldWithoutFury);
    const withoutFury = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: worldWithoutFury,
    });
    setActiveWorldContent(BUILTIN_WORLD);
    const withFury = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });

    expect(withoutFury.entities.has(FURY_ENTITY_ID)).toBe(false);
    const fury = withFury.entities.get(FURY_ENTITY_ID);
    if (!fury) throw new Error('missing reserved FURY entity');
    expect({
      id: fury.id,
      kind: fury.kind,
      templateId: fury.templateId,
      x: fury.pos.x,
      z: fury.pos.z,
      spawnX: fury.spawnPos.x,
      spawnZ: fury.spawnPos.z,
      facing: fury.facing,
      prevFacing: fury.prevFacing,
    }).toEqual({
      id: 1_000_000_001,
      kind: 'npc',
      templateId: 'fury',
      x: 16,
      z: -78,
      spawnX: 16,
      spawnZ: -78,
      facing: -2.2455372690184494,
      prevFacing: -2.2455372690184494,
    });
    expect([...withFury.entities.keys()].filter((id) => id !== FURY_ENTITY_ID)).toEqual([
      ...withoutFury.entities.keys(),
    ]);
    expect(withFury.nextId).toBe(withoutFury.nextId);
    expect(withFury.rng.next()).toBe(withoutFury.rng.next());
  });

  // Owner round 6b widened the station-to-master band from 3 yd to 4.5 yd:
  // forgemistress_darva now stands 4.2 yd out and tinker_gizzel 3.2 yd out, on
  // opposite sides of their adjacent benches, so the crafts lane stops reading
  // as one huddle. Each master still works their own station, which is the
  // failure this bound exists to catch.
  it('moves the four Eastbrook stations with their masters and preserves every other station field', () => {
    for (const station of STATIONS.slice(0, 4)) {
      const placement = EASTBROOK_STATIONS_BY_ID[station.id];
      expect(station.pos).toEqual(placement.position);
      expect(station.type).toBe(placement.type);
      expect(station.masterNpcId).toBe(placement.masterNpcId);
      expect(
        Math.hypot(
          station.pos.x - ZONE1_NPCS[station.masterNpcId].pos.x,
          station.pos.z - ZONE1_NPCS[station.masterNpcId].pos.z,
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        Math.hypot(
          station.pos.x - ZONE1_NPCS[station.masterNpcId].pos.x,
          station.pos.z - ZONE1_NPCS[station.masterNpcId].pos.z,
        ),
      ).toBeLessThanOrEqual(4.5);
    }
    expect(STATIONS.slice(4)).toEqual([
      {
        id: 'station_fenbridge_tannery',
        type: 'tannery',
        zoneId: 'mirefen_marsh',
        pos: { x: 1.0670827486441765, z: 315.3263500973041 },
        masterNpcId: 'tanner_hesk',
      },
      {
        id: 'station_highwatch_apothecary',
        type: 'apothecary',
        zoneId: 'thornpeak_heights',
        pos: { x: 7, z: 660 },
        masterNpcId: 'alchemist_verane',
      },
    ]);
    expect(STATION_RADIUS).toBe(20);
  });

  it('moves only the Eastbrook mailbox and keeps the player and graveyard contracts', () => {
    expect(MAILBOXES).toEqual([
      {
        x: EASTBROOK_LAYOUT.services.mailbox.position.x,
        z: EASTBROOK_LAYOUT.services.mailbox.position.z,
      },
      { x: 6, z: 294 },
      { x: 6, z: 654 },
      { x: -33, z: 1025 },
      { x: 397, z: 1905 },
      { x: -23, z: 1555 },
      { x: -353, z: 2067 },
      { x: -354, z: 356 },
      { x: -364, z: 1415 },
      { x: 354, z: 1436 },
      { x: -294, z: 815 },
      { x: 314, z: 816 },
      { x: 427, z: 355 },
      { x: 299, z: 76 },
      // The Proving Shore tutorial island's camp mailbox (Dawnrest Camp hub
      // at (-300, 50) offset (-6, 6)), the one authored row carrying a
      // facing (rotated to face the camp ground).
      { x: -306, z: 56, facing: Math.PI },
    ]);
    // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the spawn moved to the
    // harbor quay and the graveyard contract to the chapel green. Every
    // behavioral test in this file consumes PLAYER_START symbolically, so
    // the moved spawn is re-pinned here as exported data.
    expect(PLAYER_START).toEqual({ x: -94, z: -58 });
    expect(EASTBROOK_LAYOUT.services.graveyard.position).toEqual({ x: -2, z: -70 });
    expect(EASTBROOK_LAYOUT.services.graveyard.legacyReleasePoint).toEqual({ x: 0, z: -70 });
  });
});

describe('Eastbrook runtime collision, spawn, and services', () => {
  it('spawns every moved NPC exactly at its authored point and facing without safe-position drift', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    for (const placement of EASTBROOK_LAYOUT.services.npcs) {
      const entity = npcEntity(sim, placement.id);
      expect({ x: entity.pos.x, z: entity.pos.z }, placement.id).toEqual(placement.position);
      expect(entity.facing, `${placement.id} facing`).toBe(placement.facing);
      expect(entity.prevFacing, `${placement.id} previous facing`).toBe(placement.facing);
      expect(isBlocked(SEED, entity.pos.x, entity.pos.z, placement.bodyRadius), placement.id).toBe(
        false,
      );
    }
  });

  it('blocks every wall wing while players and pets pass through all six exact gate centers', () => {
    for (const segment of EASTBROOK_LAYOUT.wall.segments) {
      expect(
        isBlocked(SEED, segment.footprint.center.x, segment.footprint.center.z, 0.5),
        segment.id,
      ).toBe(true);
    }
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      const length = Math.hypot(gate.crossing.x, gate.crossing.z);
      const ux = gate.crossing.x / length;
      const uz = gate.crossing.z / length;
      const from = { x: ux * 26.5, z: uz * 26.5 };
      const to = { x: ux * 32.5, z: uz * 32.5 };
      for (const bodyRadius of [0.5, 0.6]) {
        const result = resolveMovement(SEED, from.x, from.z, to.x, to.z, bodyRadius);
        expect(
          Math.hypot(result.x - to.x, result.z - to.z),
          `${gate.id} radius ${bodyRadius}`,
        ).toBeLessThan(0.05);
      }
    }
  });

  it('uses exact authored collider shapes and visual heights', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const stallCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.x === stall.position.x &&
        collider.z === stall.position.z,
    );
    expect(stallCollider).toMatchObject({
      type: 'obb',
      hw: stall.width / 2,
      hd: stall.depth / 2,
      rot: stall.rotation,
    });
    expect(
      colliders.find(
        (collider) =>
          collider.type === 'obb' &&
          collider.x === 3.5 &&
          collider.z === 11.5 &&
          collider.hw === 1.4 &&
          collider.hd === 1.1 &&
          collider.rot === -2.788602,
      ),
      'retired artisan stall collider',
    ).toBeUndefined();

    const well = EASTBROOK_LAYOUT.civic.wellBeacon;
    const wellCollider = colliders.find(
      (collider) =>
        collider.type === 'circle' &&
        collider.x === well.position.x &&
        collider.z === well.position.z,
    );
    expect(wellCollider).toMatchObject({ type: 'circle', r: well.radius });
    expect(wellCollider?.cameraTopY).toBeCloseTo(
      groundHeight(well.position.x, well.position.z, SEED) + well.height,
    );

    // Re-pinned 2026-08-18 for the harbor move (commit d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the town wall is retired
    // by design, so this is now an ABSENCE pin, mirroring the retired
    // artisan stall above: the layout exposes zero segments and no static
    // OBB stands on the old wall ring.
    expect(EASTBROOK_LAYOUT.wall.segments).toHaveLength(0);
    expect(EASTBROOK_LAYOUT.wall.gates).toHaveLength(0);
    expect(
      colliders.filter(
        (collider) =>
          collider.type === 'obb' &&
          Math.abs(Math.hypot(collider.x, collider.z) - EASTBROOK_LAYOUT.wall.radius) < 1.5,
      ),
      'retired wall ring colliders',
    ).toHaveLength(0);

    const fence = EASTBROOK_LAYOUT.fences[0];
    const fenceCenter = midpoint(fence.start, fence.end);
    const fenceCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.isFence === true &&
        collider.x === fenceCenter.x &&
        collider.z === fenceCenter.z,
    );
    expect(fenceCollider).toMatchObject({
      type: 'obb',
      hd: fence.width / 2,
      isFence: true,
    });
    expect(fenceCollider?.cameraTopY).toBeCloseTo(
      groundHeight(fenceCenter.x, fenceCenter.z, SEED) + fence.height,
    );

    const board = EASTBROOK_LAYOUT.services.noticeboard;
    const boardCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.x === board.position.x &&
        collider.z === board.position.z,
    );
    expect(boardCollider).toMatchObject({
      type: 'obb',
      hw: board.nativeDimensions.width / 2,
      hd: board.nativeDimensions.depth / 2,
      rot: board.rotation,
    });
    expect(boardCollider?.cameraTopY).toBeCloseTo(
      groundHeight(board.position.x, board.position.z, SEED) + board.nativeDimensions.height,
    );
  });

  it('keeps every standing point, station, service route, quest NPC, and graveyard route clear', () => {
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      expect(
        isBlocked(SEED, building.frontStandingPoint.x, building.frontStandingPoint.z, 0.6),
        building.id,
      ).toBe(false);
    }
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      expect(
        isBlocked(SEED, stall.frontStandingPoint.x, stall.frontStandingPoint.z, 0.5),
        stall.id,
      ).toBe(false);
    }
    const boardStanding = EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint;
    expect(isBlocked(SEED, boardStanding.x, boardStanding.z, 0.6), 'noticeboard').toBe(false);
    for (const station of EASTBROOK_LAYOUT.services.stations) {
      expect(isBlocked(SEED, station.position.x, station.position.z, 0.8), station.id).toBe(false);
      expect(isAtStation(STATIONS, station.position, station.type), station.id).toBe(true);
    }
    for (const route of EASTBROOK_LAYOUT.services.routes) {
      for (const point of samplePolyline(route.points, 0.2)) {
        expect(isBlocked(SEED, point.x, point.z, route.bodyRadius), route.id).toBe(false);
      }
    }
    const questNpcIds = new Set<string>();
    for (const quest of Object.values(QUESTS)) {
      questNpcIds.add(quest.giverNpcId);
      questNpcIds.add(quest.turnInNpcId);
      for (const id of quest.turnInNpcIds ?? []) questNpcIds.add(id);
    }
    for (const id of ZONE1_TOWN_NPC_IDS.filter((candidate) => questNpcIds.has(candidate))) {
      const npc = ZONE1_NPCS[id];
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.6), id).toBe(false);
    }
  });

  // Re-anchored 2026-08-18 for the harbor move (commit d19aa33f76,
  // docs/design/eastbrook-revamp/site-plan.md): the square anchor moved to
  // the new market square and the six retired gate destinations left the
  // list with the wall (36 became 30). Round 3 promoted the trio of decor
  // homes into layout buildings, adding their entrances (33). Round 4
  // retired the preserved armoury from placement, dropping its entrance (32).
  // Round 6 removed eastbrook_home_rise from the layout after live review,
  // dropping its entrance too (31), then appended the harbour quarter's three
  // coastal buildings along the dock road, each bringing its own entrance
  // back into the proof (34).
  it('pathfinds bidirectionally from the square to every service, NPC, station, and entrance', () => {
    // Middle of the new market square: inside the civic ring, clear of the
    // well beacon and the benches, and directly connected to the east-road
    // circulation (the east road's authored tail ends beside it at -11,-101).
    const square = { x: -12.5, z: -100.5 };
    const destinations = [
      ...EASTBROOK_LAYOUT.services.npcs.map((npc) => ({ id: npc.id, point: npc.position })),
      ...EASTBROOK_LAYOUT.services.stations.map((station) => ({
        id: station.id,
        point: station.position,
      })),
      {
        id: EASTBROOK_LAYOUT.services.mailbox.id,
        point: EASTBROOK_LAYOUT.services.mailbox.frontStandingPoint,
      },
      {
        id: EASTBROOK_LAYOUT.services.noticeboard.id,
        point: EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
      },
      {
        id: EASTBROOK_LAYOUT.services.graveyard.id,
        point: EASTBROOK_LAYOUT.services.graveyard.position,
      },
      ...[...EASTBROOK_LAYOUT.preservedBuildings, ...EASTBROOK_LAYOUT.buildings].map(
        (building) => ({ id: `${building.id}:entrance`, point: building.frontStandingPoint }),
      ),
    ];
    expect(destinations).toHaveLength(34);
    const moverProfiles = [
      { id: 'player', bodyRadius: PLAYER_BODY_RADIUS },
      // Pet locomotion deliberately shares PLAYER_BODY_RADIUS; keep this
      // explicit so the town route proof cannot drift to a guessed pet size.
      { id: 'pet', bodyRadius: PLAYER_BODY_RADIUS },
    ] as const;
    for (const destination of destinations) {
      for (const mover of moverProfiles) {
        expectWalkableRoute(
          `${destination.id} outbound ${mover.id} r${mover.bodyRadius}`,
          square,
          destination.point,
          mover.bodyRadius,
        );
        expectWalkableRoute(
          `${destination.id} inbound ${mover.id} r${mover.bodyRadius}`,
          destination.point,
          square,
          mover.bodyRadius,
        );
      }
    }
  });

  it('summons a passive pet and follows its owner through every gate in both directions', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Gatekeeper');
    const owner = sim.entities.get(pid);
    if (!owner) throw new Error('missing pet owner');
    summonPet(sim.ctx, owner, 'gloomshade');
    const pet = petOf(sim.ctx, pid);
    if (!pet) throw new Error('missing summoned pet');
    setPetMode(sim.ctx, 'passive', pid);

    const follow = (ownerPoint: { x: number; z: number }, petPoint: { x: number; z: number }) => {
      placeEntity(sim, owner, ownerPoint);
      placeEntity(sim, pet, petPoint);
      pet.aggroTargetId = null;
      pet.petPath = [];
      pet.inCombat = false;
      for (let tick = 0; tick < 100 && dist2d(owner.pos, pet.pos) > 3.5; tick++) sim.tick();
      expect(dist2d(owner.pos, pet.pos)).toBeLessThanOrEqual(3.5);
    };

    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      const length = Math.hypot(gate.crossing.x, gate.crossing.z);
      const ux = gate.crossing.x / length;
      const uz = gate.crossing.z / length;
      const inside = { x: ux * 24, z: uz * 24 };
      const outside = { x: ux * 32, z: uz * 32 };
      follow(outside, inside);
      expect(Math.hypot(pet.pos.x, pet.pos.z), `${gate.id} outward`).toBeGreaterThan(
        EASTBROOK_LAYOUT.wall.radius,
      );
      follow(inside, outside);
      expect(Math.hypot(pet.pos.x, pet.pos.z), `${gate.id} return`).toBeLessThan(
        EASTBROOK_LAYOUT.wall.radius,
      );
    }
  });

  it('makes the new inn the sole Eastbrook rest area and uses rotation-correct local transforms', () => {
    const inn = ZONE1_PROPS.buildings.find((building) => building.id === 'eastbrook_inn');
    if (!inn) throw new Error('missing Eastbrook rest fixtures');
    // Round 4: the armoury retired from placement, so no zone1 building row
    // carries its landmark and the barracks lot front grants no rest.
    expect(ZONE1_PROPS.buildings.some((building) => building.landmark)).toBe(false);
    const innPlacement = EASTBROOK_LAYOUT.buildings.find(
      (building) => building.id === 'eastbrook_inn',
    );
    if (!innPlacement) throw new Error('missing authored Eastbrook inn');
    const restPoint = innPlacement.frontStandingPoint;
    const barracksFront = { x: 12, z: -5.5 };
    expect(isBlocked(SEED, restPoint.x, restPoint.z, 0.5)).toBe(false);
    expect(isResting({ inCombat: false, pos: { ...restPoint, y: 0 } } as Entity)).toBe(true);
    expect(isResting({ inCombat: false, pos: { ...barracksFront, y: 0 } } as Entity)).toBe(false);

    const arbitrary = { kind: 'inn', x: 37, z: -19, w: 8, d: 3, rot: 0.731 } as const;
    const inside = localToWorld({ x: arbitrary.x, z: arbitrary.z }, arbitrary.rot, 3.9, 1.4);
    const outside = localToWorld({ x: arbitrary.x, z: arbitrary.z }, arbitrary.rot, 4.1, 1.4);
    expect(buildingContainsPoint(arbitrary, inside.x, inside.z)).toBe(true);
    expect(buildingContainsPoint(arbitrary, outside.x, outside.z)).toBe(false);
  });

  it('keeps targetless Saul interaction outside mailbox reach at his measured face point', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Chronicler Visitor');
    const saul = npcEntity(sim, 'chronicler_saul');
    const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
    if (!mailbox) throw new Error('missing Eastbrook mailbox');
    // Re-measured 2026-08-18 for the harbor move (commit d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): Saul now works beside the
    // noticeboard at the bank corner and the mailbox pillar moved across the
    // square, so the measured face point (saul.pos plus 1.5 yd along his
    // facing, taken from the runtime entity) is far outside mailbox reach
    // rather than a stride from it. The targetless-interact regression this
    // stages is unchanged.
    const facePoint = { x: 11.032050294337843, z: -86.25192455849323 };

    expect(Math.hypot(facePoint.x - saul.pos.x, facePoint.z - saul.pos.z)).toBeCloseTo(1.5, 12);
    const mailboxDistance = Math.hypot(facePoint.x - mailbox.pos.x, facePoint.z - mailbox.pos.z);
    expect(mailboxDistance).toBe(24.090753748334464);
    expect(mailboxDistance).toBeGreaterThan(INTERACT_RANGE);

    const talkToNpc = vi.spyOn(sim, 'talkToNpc');
    const visitor = standAt(sim, pid, facePoint);
    visitor.targetId = null;
    sim.drainEvents();
    sim.interact(pid);
    expect(talkToNpc).toHaveBeenCalledTimes(1);
    expect(talkToNpc).toHaveBeenCalledWith(saul.id, pid);
    expect(sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'mailbox' }));
  });

  it('keeps bank, market, mail, noticeboard, card, vendor, quest, and crafting interactions live', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('mage', 'Second');

    const banker = npcEntity(sim, 'bursar_fernando');
    const firstPlayer = standAt(sim, first, banker.pos);
    firstPlayer.targetId = banker.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'bank', pid: first }));

    const merchant = npcEntity(sim, 'the_merchant');
    standAt(sim, first, merchant.pos);
    expect(sim.marketInfoFor(first)).not.toBeNull();

    const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
    if (!mailbox) throw new Error('missing Eastbrook mailbox');
    const atMailbox = standAt(sim, first, mailbox.pos);
    atMailbox.targetId = mailbox.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'mailbox', pid: first }),
    );

    const noticeboard = [...sim.entities.values()].find(
      (entity) => entity.kind === 'object' && entity.templateId === 'noticeboard_eastbrook',
    );
    if (!noticeboard) throw new Error('missing Eastbrook noticeboard');
    const atNoticeboard = standAt(
      sim,
      first,
      EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
    );
    atNoticeboard.targetId = noticeboard.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual({
      type: 'noticeboard',
      noticeboardId: 'noticeboard_eastbrook',
      state: 'empty',
      pid: first,
    });
    expect(noticeboard.lootable).toBe(true);

    const trader = npcEntity(sim, 'trader_wilkes');
    const buyer = standAt(sim, first, trader.pos);
    buyer.targetId = trader.id;
    const buyerMeta = sim.meta(first);
    if (!buyerMeta) throw new Error('missing buyer metadata');
    buyerMeta.copper = 10_000;
    sim.buyItem(trader.id, 'baked_bread', undefined, first);
    expect(sim.countItem('baked_bread', first)).toBeGreaterThan(0);

    const marshal = npcEntity(sim, 'marshal_redbrook');
    const quester = standAt(sim, first, marshal.pos);
    quester.targetId = marshal.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'questAccepted', questId: 'q_wolves', pid: first }),
    );

    const cardMaster = npcEntity(sim, 'card_master');
    standAt(sim, first, cardMaster.pos);
    standAt(sim, second, cardMaster.pos);
    sim.joinCardDuelQueue(first);
    sim.joinCardDuelQueue(second);
    sim.tick();
    expect(sim.cardDuelMatchFor(first)).not.toBeNull();
    expect(sim.cardDuelMatchFor(second)).not.toBeNull();

    for (const station of EASTBROOK_LAYOUT.services.stations) {
      expect(isAtStation(STATIONS, station.position, station.type), station.id).toBe(true);
    }
  });

  it('keeps the fixed-seed world projection stable through wandering and respawn', {
    // Two complete shipped-world simulations run through wandering and respawn.
    // Loaded five-worker CI can exceed the old 90s budget while the bounded
    // projection still completes deterministically.
    timeout: 180000,
  }, () => {
    const stabilitySeed = 4_242;
    const legacyWorld = {
      ...BUILTIN_WORLD,
      props: legacyEastbrookProps(BUILTIN_WORLD.props),
      services: {
        ...BUILTIN_WORLD.services,
        // Re-probed from the live layout for owner round 6b. The fixture used
        // to hold the OLD town's mailbox literal (7, -8) in this slot, and that
        // is the same trap the legacy town campfire fell into above: the old
        // post spot is Wolf Run open country now, so it was a collider present
        // in this world and nowhere else. It went unnoticed until this round's
        // camp and graveyard moves reflowed the shared wander stream and walked
        // wolf 88 across it at tick 547, deflecting it in the legacy world
        // only. The premise here is identical collision in both worlds, so the
        // row follows the live pillar.
        mailboxes: [
          {
            x: EASTBROOK_LAYOUT.services.mailbox.position.x,
            z: EASTBROOK_LAYOUT.services.mailbox.position.z,
          },
          ...MAILBOXES.slice(1),
        ],
      },
    };
    setActiveWorldContent(legacyWorld);
    const legacy = new Sim({
      seed: stabilitySeed,
      playerClass: 'warrior',
      noPlayer: true,
      world: legacyWorld,
    });
    setActiveWorldContent(BUILTIN_WORLD);
    const rebuilt = new Sim({ seed: stabilitySeed, playerClass: 'warrior', noPlayer: true });

    const stableProjection = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((entity) => entity.kind === 'mob' || entity.kind === 'object')
        .filter((entity) => entity.templateId !== 'mailbox')
        .map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          templateId: entity.templateId,
          x: entity.pos.x,
          z: entity.pos.z,
          facing: entity.facing,
          level: entity.level,
          dead: entity.dead,
          hp: entity.hp,
          spawnPos: entity.spawnPos,
          wanderTarget: entity.wanderTarget,
          wanderTimer: entity.wanderTimer,
          respawnTimer: entity.respawnTimer,
        }));
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.postOffice.mailboxIds).toEqual(legacy.postOffice.mailboxIds);
    expect(rebuilt.entities.get(rebuilt.postOffice.mailboxIds[0])?.pos).toMatchObject({
      x: EASTBROOK_LAYOUT.services.mailbox.position.x,
      z: EASTBROOK_LAYOUT.services.mailbox.position.z,
    });
    expect(CAMPS).toEqual(BUILTIN_WORLD.camps);
    expect(ZONE1_CAMPS).toHaveLength(14);

    for (let tick = 0; tick < 2_500; tick++) {
      setActiveWorldContent(legacyWorld);
      legacy.tick();
      setActiveWorldContent(BUILTIN_WORLD);
      rebuilt.tick();
    }
    expect(rebuilt.tickCount).toBe(2_500);
    expect(legacy.tickCount).toBe(2_500);
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.nextId).toBe(legacy.nextId);

    const rebuiltWolf = [...rebuilt.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'forest_wolf',
    );
    const legacyWolf = rebuiltWolf ? legacy.entities.get(rebuiltWolf.id) : undefined;
    if (!rebuiltWolf || !legacyWolf) throw new Error('missing fixed-seed wolf pair');
    for (const wolf of [legacyWolf, rebuiltWolf]) {
      wolf.dead = true;
      wolf.hp = 0;
      wolf.lootable = false;
      wolf.corpseTimer = 0;
      wolf.respawnTimer = 0;
    }
    setActiveWorldContent(legacyWorld);
    legacy.ctx.respawnMob(legacyWolf);
    setActiveWorldContent(BUILTIN_WORLD);
    rebuilt.ctx.respawnMob(rebuiltWolf);
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.rng.next()).toBe(legacy.rng.next());
  });
});

describe('the first sixty seconds: starter pull lanes from spawn', () => {
  // The town is furnished with solid props now, so pin explicitly what the
  // fixtures that moved to open ground implied: a new character can walk out
  // of the spawn square to each nearby starter camp, and at the camp's edge
  // a ranged pull has a clear 25 yd sight lane to the camp's heart.
  it('walks out to the starter camps and sights a ranged pull at each', () => {
    // The level-1 quest targets: the first camps a fresh character is sent
    // at. (The spider wood is a later, longer walk whose winding route the
    // simple follower here cannot prove; its lane is covered by the
    // route-existence check below.)
    const starterMobs = new Set(['wild_boar', 'forest_wolf']);
    const nearest = [...CAMPS]
      .map((camp) => ({
        camp,
        d: Math.hypot(camp.center.x - PLAYER_START.x, camp.center.z - PLAYER_START.z),
      }))
      .filter(({ camp }) => starterMobs.has(camp.mobId))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    expect(nearest.length).toBe(2);
    for (const { camp } of nearest) {
      // The pull spot as a player finds it: walk the pathfinder's own route
      // out of town and stop at the first waypoint inside ranged pull
      // distance of the camp's heart. That keeps the spot on walkable
      // ground even where the beeline crosses a rim.
      const route = findPath(PLAYER_START, camp.center, {
        seed: SEED,
        bodyRadius: 0.5,
        maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
        minGround: (x: number, z: number) => waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH,
        maxSpan: 160,
      });
      expect(route.length, `${camp.mobId} has a route from spawn`).toBeGreaterThan(0);
      const pull =
        route.find((p) => Math.hypot(p.x - camp.center.x, p.z - camp.center.z) <= 25) ??
        route[route.length - 1];
      expect(isBlocked(SEED, pull.x, pull.z, 0.5), `${camp.mobId} pull spot`).toBe(false);
      expectWalkableRoute(`${camp.mobId} camp approach`, PLAYER_START, pull, 0.5);
      expect(lineOfSightClear(SEED, pull, camp.center), `${camp.mobId} pull sight lane`).toBe(true);
      expect(
        Math.hypot(pull.x - camp.center.x, pull.z - camp.center.z),
        `${camp.mobId} pull distance`,
      ).toBeLessThanOrEqual(25);
    }
  });

  it('every camp within 90 yd of spawn keeps a route and a pull sight lane', () => {
    for (const camp of CAMPS) {
      const d = Math.hypot(camp.center.x - PLAYER_START.x, camp.center.z - PLAYER_START.z);
      if (d > 90) continue;
      const route = findPath(PLAYER_START, camp.center, {
        seed: SEED,
        bodyRadius: 0.5,
        maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
        minGround: (x: number, z: number) => waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH,
        maxSpan: 160,
      });
      expect(route.length, `${camp.mobId} at ${camp.center.x},${camp.center.z}`).toBeGreaterThan(0);
      const pull =
        route.find((p) => Math.hypot(p.x - camp.center.x, p.z - camp.center.z) <= 25) ??
        route[route.length - 1];
      expect(lineOfSightClear(SEED, pull, camp.center), `${camp.mobId} pull sight lane`).toBe(true);
    }
  });
});

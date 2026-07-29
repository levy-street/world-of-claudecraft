// overworld minimap core (minimap_markers): the delve-vs-overworld discriminator,
// the DISCRIMINATED Marker union per draw kind, the friend/guild/party/stranger
// classification, same-input -> same-output determinism, the ClientWorld-vs-Sim parity
// assertion, and the reused-container allocation budget (the proxy,
// wrapper-level: the per-marker variant objects are rebuilt by design, so only the
// container + reused array reference are the floor).
//
// The in-delve schematic branch is owned by delve_map.ts + delve_map_painter.ts;
// this core models only the overworld branch (minimapMode names the boundary). The
// canvas no-magic-values guard is in tests/minimap_painter.test.ts.

import { describe, expect, it } from 'vitest';
import { DELVE_X_MIN, GATHER_NODES, QUESTS, STATIONS, YUMI_MAZE_X } from '../src/sim/data';
import { isQuestTurnInNpc } from '../src/sim/types';
import { createMinimapMarkers, type MinimapMarker, minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';
import { assertAllocationStable } from './util/alloc_probe';

// A real quest whose giver is also a turn-in npc, so a single npc can carry both the
// 'available' ('!') and 'ready' ('?') glyph branches against real content.
function requireQuestWithGiver() {
  const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
  if (!quest) throw new Error('expected a quest with a giverNpcId');
  return quest;
}
function requireReadyQuest() {
  const quest = Object.values(QUESTS).find(
    (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
  );
  if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
  return quest;
}
const GIVER_QUEST = requireQuestWithGiver();
const READY_QUEST = requireReadyQuest();

const S = 162;
const PPY = 1.7; // base scale at zoom 1
// An overworld player z (delve positions are x in the delve band; x = 0 is overworld).
const PZ = 100;

// One scenario as plain construction. `shape` toggles between a "Sim-shaped" stub
// carrying sim-only junk fields the core must ignore and a lean "ClientWorld-mirror"
// stub, so decision-15 parity is a real two-shape assertion.
function makeWorld(shape: 'sim' | 'client'): IWorld {
  const junk = shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {};
  const ent = (over: Record<string, unknown>) => ({
    dead: false,
    lootable: false,
    aggroTargetId: null,
    questIds: [],
    templateId: '',
    ...junk,
    ...over,
  });
  const player = ent({ id: 1, kind: 'player', name: 'Me', pos: { x: 0, z: PZ }, facing: 0.5 });
  const entities = new Map<number, unknown>([
    [1, player],
    [2, ent({ id: 2, kind: 'player', name: 'Friend', pos: { x: 5, z: PZ } })],
    [3, ent({ id: 3, kind: 'player', name: 'Guild', pos: { x: -5, z: PZ } })],
    [4, ent({ id: 4, kind: 'player', name: 'Nobody', pos: { x: 6, z: PZ } })],
    // id 5 is a party member too: the entity loop must SKIP it (party loop draws it).
    [5, ent({ id: 5, kind: 'player', name: 'Mate', pos: { x: 7, z: PZ } })],
    [
      6,
      ent({
        id: 6,
        kind: 'npc',
        name: 'Giver',
        templateId: GIVER_QUEST.giverNpcId,
        questIds: [GIVER_QUEST.id],
        pos: { x: 8, z: PZ },
      }),
    ],
    [8, ent({ id: 8, kind: 'npc', name: 'Quiet', questIds: [], pos: { x: 9, z: PZ } })],
    [9, ent({ id: 9, kind: 'object', templateId: 'dungeon_door', pos: { x: 10, z: PZ } })],
    [10, ent({ id: 10, kind: 'object', lootable: true, pos: { x: 11, z: PZ } })],
    [11, ent({ id: 11, kind: 'mob', aggroTargetId: 1, pos: { x: 12, z: PZ } })],
    [12, ent({ id: 12, kind: 'mob', aggroTargetId: null, pos: { x: 13, z: PZ } })],
    [13, ent({ id: 13, kind: 'mob', dead: true, lootable: true, pos: { x: 14, z: PZ } })],
    // far beyond the rim -> culled.
    [14, ent({ id: 14, kind: 'mob', pos: { x: 80, z: PZ } })],
  ]);
  const partyInfo = {
    leader: 1,
    raid: false,
    members: [
      { pid: 1, cls: 'warrior', dead: 0, x: 0, z: PZ }, // self, skipped
      { pid: 5, cls: 'mage', dead: 0, x: 7, z: PZ }, // on-map disc, alive (pip)
      { pid: 16, cls: 'priest', dead: 1, x: 0, z: PZ + 80 }, // off-map arrow, dead
    ],
  };
  const socialInfo = {
    friends: [
      { id: 20, name: 'Friend', online: true },
      { id: 21, name: 'Offline', online: false },
    ],
    blocks: [],
    guild: { id: 1, name: 'G', rank: 'member', members: [{ id: 22, name: 'Guild', online: true }] },
  };
  return {
    player,
    entities,
    partyInfo,
    socialInfo,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    stationPlacements: STATIONS,
    questState: (q: string) => (q === GIVER_QUEST.id ? 'available' : 'unavailable'),
    // The gather-node reads. This scenario is not about gathering, but the core
    // consults both members for any node inside the rim, and whether one IS
    // inside the rim is a fact about world content, not about this fixture. It
    // used to carry neither member and passed only because no node happened to
    // sit near (0, PZ); the moment one did, every test in this file threw on
    // `inventory is not iterable`. Supplying them makes the fixture answer for
    // itself whatever the map looks like.
    inventory: [],
    nodeHarvestableByMe: () => true,
    // The quest-marker inputs both worlds expose (the phase 23 classifier):
    // questsDone always, and the crafting identity whose cadenceBlockedQuests
    // mirror drives the cooldown variant. The sim shape carries a fuller
    // identity; the client shape only what the cprof mirror guarantees.
    questsDone: new Set<string>(),
    craftingIdentity:
      shape === 'sim'
        ? { version: 1, synced: true, attunedPairs: [], cadenceBlockedQuests: [] }
        : { version: 1, synced: false, cadenceBlockedQuests: [] },
  } as unknown as IWorld;
}

function buildMarkers(world: IWorld): MinimapMarker[] {
  // Snapshot to a fresh array (the core reuses its container) so callers can compare.
  return createMinimapMarkers()
    .build(world, S, PPY)
    .markers.map((m) => ({ ...m }));
}

describe('minimapMode (delve vs overworld discriminator)', () => {
  it('returns overworld for an overworld position with no run (both shapes)', () => {
    expect(minimapMode(makeWorld('sim'))).toBe('overworld');
    expect(minimapMode(makeWorld('client'))).toBe('overworld');
  });

  it('returns delve when the player is in a delve band with an active run', () => {
    const w = makeWorld('client') as unknown as {
      player: { pos: { x: number } };
      delveRun: unknown;
    };
    w.player.pos.x = DELVE_X_MIN + 200; // a delve-band x
    w.delveRun = {
      delveId: 'd',
      modules: ['m'],
      moduleIndex: 0,
      origin: { x: DELVE_X_MIN + 200, z: 0 },
    };
    expect(minimapMode(w as unknown as IWorld)).toBe('delve');
  });

  it('returns yumiMaze anywhere in the Protect Yumi band, run or not', () => {
    const w = makeWorld('client') as unknown as { player: { pos: { x: number } } };
    // Read the band from data.ts: the grid world relocated every instance band onto
    // the far-east instance plane, so a literal x here would rot on the next move.
    w.player.pos.x = YUMI_MAZE_X;
    expect(minimapMode(w as unknown as IWorld)).toBe('yumiMaze');
  });
});

describe('createMinimapMarkers: the discriminated union per draw kind', () => {
  it('emits exactly the expected kinds, classifies friend/guild, and skips party + stranger', () => {
    const markers = buildMarkers(makeWorld('sim'));
    const kinds = markers.map((m) => m.kind);
    // ally (friend), ally (guild), npc('!'), npc('•'), portal, object-loot, mob(aggro),
    // mob, mob-loot, party-disc (pid 5), party-arrow (pid 16), player. The stranger
    // (id 4) and the party member (id 5) produce NO entity-loop marker; id 14 is culled.
    //
    // The two gather-node entries are content, not fixture: wood_eastbrook_4 and
    // wood_eastbrook_5 sit 25.0 and 40.6 yards from (0, PZ), inside the
    // 43.53-yard rim, and the node loop runs between the party loop and the
    // player arrow. They appeared when the Eastbrook wood stands were spread up
    // the north road instead of clumped at Webwood; a future stand near (0, 100)
    // legitimately re-mints this list, which is why the whole ordered sequence is
    // asserted rather than a subset.
    expect(kinds).toEqual([
      'ally',
      'ally',
      'npc',
      'npc',
      'portal',
      'object-loot',
      'mob',
      'mob',
      'mob-loot',
      'party-disc',
      'party-arrow',
      'gather-node',
      'gather-node',
      'player',
    ]);
    const allies = markers.filter((m) => m.kind === 'ally') as Extract<
      MinimapMarker,
      { kind: 'ally' }
    >[];
    expect(allies.map((a) => a.ally)).toEqual(['friend', 'guild']);
  });

  it('marks the aggroed mob and the available-quest npc glyph', () => {
    const markers = buildMarkers(makeWorld('sim'));
    const mobs = markers.filter((m) => m.kind === 'mob') as Extract<
      MinimapMarker,
      { kind: 'mob' }
    >[];
    expect(mobs.map((m) => m.aggro)).toEqual([true, false]);
    const npcs = markers.filter((m) => m.kind === 'npc') as Extract<
      MinimapMarker,
      { kind: 'npc' }
    >[];
    // The giver has an available (not ready) quest -> '!'; the quiet npc -> '•'.
    expect(npcs.map((n) => n.glyph)).toEqual(['!', '•']);
    // The marker variant behind each glyph: gold first-offer, neutral none.
    expect(npcs.map((n) => n.marker)).toEqual(['available', 'none']);
  });

  it("renders the '?' glyph when an npc has a ready turn-in (distinct from '!')", () => {
    const world = makeWorld('client') as unknown as {
      entities: Map<number, { templateId: string; questIds: string[] }>;
      questState: (q: string) => string;
    };
    const npc = world.entities.get(6);
    if (!npc) throw new Error('expected the seeded giver npc');
    npc.templateId = READY_QUEST.giverNpcId as string;
    npc.questIds = [READY_QUEST.id];
    world.questState = (q) => (q === READY_QUEST.id ? 'ready' : 'unavailable');
    const npcs = buildMarkers(world as unknown as IWorld).filter(
      (m) => m.kind === 'npc',
    ) as Extract<MinimapMarker, { kind: 'npc' }>[];
    expect(npcs[0].glyph).toBe('?');
    expect(npcs[0].marker).toBe('ready');
  });

  it('stamps the repeat and cooldown variants identically for both world shapes', () => {
    // The phase 23 blue "!" at the minimap surface, from a real cadenced work
    // order re-pointed onto the seeded npc: after one completion the offer
    // stamps 'repeat'; inside the window (the cadenceBlockedQuests mirror)
    // it stamps 'cooldown' where the npc previously showed the neutral dot.
    // Driven through BOTH stub shapes (acceptance (a)'s both-worlds arm).
    // This pins the CLASSIFIER over each world's data shape; true
    // world-to-world parity of the inputs themselves rests on the online
    // cadence/attunement suites pinning the qdone and cprof mirrors.
    const workOrder = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
    if (!workOrder) throw new Error('expected a cadenced work order');
    for (const shape of ['sim', 'client'] as const) {
      const world = makeWorld(shape) as unknown as {
        entities: Map<number, { templateId: string; questIds: string[] }>;
        questState: (q: string) => string;
        questsDone: Set<string>;
        craftingIdentity: { cadenceBlockedQuests: string[] };
      };
      const npc = world.entities.get(6);
      if (!npc) throw new Error('expected the seeded giver npc');
      npc.templateId = workOrder.giverNpcId;
      npc.questIds = [workOrder.id];
      world.questsDone = new Set([workOrder.id]);
      world.questState = (q) => (q === workOrder.id ? 'available' : 'unavailable');
      const offered = buildMarkers(world as unknown as IWorld).filter(
        (m) => m.kind === 'npc',
      ) as Extract<MinimapMarker, { kind: 'npc' }>[];
      expect(offered[0].glyph, `${shape}: offered again`).toBe('!');
      expect(offered[0].marker, `${shape}: offered again`).toBe('repeat');

      world.questState = () => 'unavailable';
      world.craftingIdentity.cadenceBlockedQuests = [workOrder.id];
      const blocked = buildMarkers(world as unknown as IWorld).filter(
        (m) => m.kind === 'npc',
      ) as Extract<MinimapMarker, { kind: 'npc' }>[];
      expect(blocked[0].glyph, `${shape}: inside the window`).toBe('!');
      expect(blocked[0].marker, `${shape}: inside the window`).toBe('cooldown');

      // The negative arm: the same unavailable state WITHOUT the mirror set
      // keeps the pre-phase neutral dot (an older server payload degrades to
      // today's behavior rather than guessing).
      world.craftingIdentity.cadenceBlockedQuests = [];
      const bare = buildMarkers(world as unknown as IWorld).filter(
        (m) => m.kind === 'npc',
      ) as Extract<MinimapMarker, { kind: 'npc' }>[];
      expect(bare[0].glyph, `${shape}: no mirror`).toBe('•');
      expect(bare[0].marker, `${shape}: no mirror`).toBe('none');
    }
  });

  it("folds across an NPC's quests: a ready turn-in beats a completed repeatable", () => {
    // Acceptance (c) at THIS surface: the fold accumulator (and its break on
    // ready) runs over more than one quest. The work order's giver also
    // gives the attune quest; its ready '?' must win the glyph over the
    // repeat-blue offer.
    const workOrder = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
    if (!workOrder) throw new Error('expected a cadenced work order');
    const attune = Object.values(QUESTS).find(
      (q) => q.giverNpcId === workOrder.giverNpcId && !q.repeatable,
    );
    if (!attune) throw new Error('expected a plain quest at the work-order giver');
    const world = makeWorld('sim') as unknown as {
      entities: Map<number, { templateId: string; questIds: string[] }>;
      questState: (q: string) => string;
      questsDone: Set<string>;
    };
    const npc = world.entities.get(6);
    if (!npc) throw new Error('expected the seeded giver npc');
    npc.templateId = workOrder.giverNpcId;
    world.questsDone = new Set([workOrder.id]);
    world.questState = (q) =>
      q === workOrder.id ? 'available' : q === attune.id ? 'ready' : 'unavailable';
    // BOTH orders: with the ready quest first, a fold degenerated to
    // last-value-wins answers 'repeat' (the mutation round proved the
    // ready-last order alone leaves exactly that mutant green).
    for (const questIds of [
      [attune.id, workOrder.id],
      [workOrder.id, attune.id],
    ]) {
      npc.questIds = questIds;
      const npcs = buildMarkers(world as unknown as IWorld).filter(
        (m) => m.kind === 'npc',
      ) as Extract<MinimapMarker, { kind: 'npc' }>[];
      expect(npcs[0].glyph, questIds.join(',')).toBe('?');
      expect(npcs[0].marker, questIds.join(',')).toBe('ready');
    }
  });

  it('classifies party members: an on-map disc (alive -> pip) and an off-map arrow (dead)', () => {
    const markers = buildMarkers(makeWorld('sim'));
    const disc = markers.find((m) => m.kind === 'party-disc') as Extract<
      MinimapMarker,
      { kind: 'party-disc' }
    >;
    const arrow = markers.find((m) => m.kind === 'party-arrow') as Extract<
      MinimapMarker,
      { kind: 'party-arrow' }
    >;
    expect(disc.cls).toBe('mage');
    expect(disc.dead).toBe(false);
    expect(disc.pip).toBe(true);
    expect(disc.radius).toBeGreaterThan(0);
    expect(arrow.cls).toBe('priest');
    expect(arrow.dead).toBe(true);
    expect(Number.isFinite(arrow.angle)).toBe(true);
  });

  it('places the player marker last at the centre, rotated to -facing', () => {
    const markers = buildMarkers(makeWorld('sim'));
    const last = markers[markers.length - 1] as Extract<MinimapMarker, { kind: 'player' }>;
    expect(last.kind).toBe('player');
    expect(last.mx).toBe(S / 2);
    expect(last.my).toBe(S / 2);
    expect(last.angle).toBe(-0.5);
  });

  it('sets the committed zone id for the #zone-label', () => {
    const model = createMinimapMarkers().build(makeWorld('sim'), S, PPY);
    expect(typeof model.zoneId).toBe('string');
    expect(model.zoneId.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('Sim-shaped and ClientWorld-mirror-shaped stubs produce identical markers', () => {
    const sim = makeWorld('sim');
    const client = makeWorld('client');
    expect(sim).not.toBe(client);
    expect(buildMarkers(sim)).toEqual(buildMarkers(client));
  });

  it('is deterministic: identical inputs produce deep-equal markers', () => {
    expect(buildMarkers(makeWorld('sim'))).toEqual(buildMarkers(makeWorld('sim')));
  });
});

describe('allocation budget (the reused-reference proxy, wrapper floor)', () => {
  it('reuses the returned container AND its markers array across calls', () => {
    // The wrapper floor: the container object + its markers array stay identical. The
    // per-marker variant objects ARE rebuilt each call (a discriminated union cannot
    // share one fat reused slot), so we probe only the container, not its array
    // elements; at the minimap's 10Hz cadence that churn is covered by perf_tour.
    const core = createMinimapMarkers();
    const world = makeWorld('sim');
    expect(() => assertAllocationStable(() => core.build(world, S, PPY))).not.toThrow();
  });
});

describe('station markers (Professions 2.0)', () => {
  // A viewer in the Eastbrook square: the four zone-1 stations (forge,
  // kitchens, loom, toolworks) sit inside the rim at this scale, while the
  // Fenbridge tannery (z 314) and Highwatch apothecary (z 660) sit far
  // beyond it. Station markers are STATIC content positions: no per-viewer
  // state, so both host shapes and any social/profession stub state must
  // produce byte-identical markers (the graphics-fairness doctrine).
  const VIEW_POS = { x: 0, z: 10 };

  function makeStationWorld(shape: 'sim' | 'client', over: Record<string, unknown> = {}): IWorld {
    const junk = shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {};
    const player = {
      id: 1,
      kind: 'player',
      name: 'Me',
      pos: { ...VIEW_POS },
      facing: 0,
      dead: false,
      lootable: false,
      aggroTargetId: null,
      questIds: [],
      templateId: '',
      ...junk,
    };
    return {
      player,
      entities: new Map([[1, player]]),
      partyInfo: null,
      socialInfo: { friends: [], blocks: [], guild: null },
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      stationPlacements: STATIONS,
      questState: () => 'unavailable',
      nodeHarvestableByMe: () => true,
      // Paired with nodeHarvestableByMe above: both gather-node reads, both
      // needed by any viewer with a node inside the rim, which the "field
      // viewer" case below now is (wood_eastbrook_5 is 12 yards from (0, 150)).
      inventory: [],
      ...over,
    } as unknown as IWorld;
  }

  function stationMarkers(world: IWorld): MinimapMarker[] {
    return buildMarkers(world).filter((m) => m.kind === 'station');
  }

  it('projects one marker per in-range station at the exact canvas px (both shapes)', () => {
    for (const shape of ['sim', 'client'] as const) {
      const markers = stationMarkers(makeStationWorld(shape));
      // The four Eastbrook stations; the two other-zone stations are culled.
      expect(markers, shape).toHaveLength(4);
      // The forge (STATIONS[0], x 7, z 16.5) lands at the projected px:
      // mx = half - dx * pxPerYard, my = half - dz * pxPerYard.
      const half = S / 2;
      const forge = STATIONS[0];
      expect(forge.id).toBe('station_eastbrook_forge');
      const projected = markers.find(
        (m) =>
          Math.abs(m.mx - (half - (forge.pos.x - VIEW_POS.x) * PPY)) < 1e-9 &&
          Math.abs(m.my - (half - (forge.pos.z - VIEW_POS.z) * PPY)) < 1e-9,
      );
      expect(projected, `${shape}: forge marker at the projected px`).toBeDefined();
    }
  });

  it('culls stations beyond the rim: a field viewer far from every town sees none', () => {
    const world = makeStationWorld('sim');
    (world.player as unknown as { pos: { x: number; z: number } }).pos = { x: 0, z: 150 };
    expect(stationMarkers(world)).toHaveLength(0);
  });

  it('reads the active IWorld station surface, so a custom world leaks no built-in markers', () => {
    expect(stationMarkers(makeStationWorld('sim', { stationPlacements: [] }))).toEqual([]);
    const custom = [
      {
        id: 'custom_station',
        type: 'forge',
        zoneId: 'custom',
        pos: { x: 2, z: 12 },
        masterNpcId: 'custom_master',
      },
    ] as const;
    const markers = stationMarkers(makeStationWorld('sim', { stationPlacements: custom }));
    expect(markers).toEqual([
      {
        kind: 'station',
        mx: S / 2 - (2 - VIEW_POS.x) * PPY,
        my: S / 2 - (12 - VIEW_POS.z) * PPY,
      },
    ]);
  });

  it('is host- and viewer-invariant: shapes and unrelated stub state never change the set', () => {
    const base = stationMarkers(makeStationWorld('sim'));
    expect(stationMarkers(makeStationWorld('client'))).toEqual(base);
    // Differing quest/social/profession state (another viewer, effectively):
    // the station layer must not read ANY of it.
    const busy = makeStationWorld('client', {
      questState: () => 'available',
      nodeHarvestableByMe: () => false,
      socialInfo: {
        friends: [{ id: 20, name: 'Friend', online: true }],
        blocks: [],
        guild: { id: 1, name: 'G', rank: 'member', members: [] },
      },
    });
    expect(stationMarkers(busy)).toEqual(base);
  });

  it('draws stations before the player arrow (draw order: the arrow stays on top)', () => {
    const markers = buildMarkers(makeStationWorld('sim'));
    expect(markers[markers.length - 1].kind).toBe('player');
    const lastStation = markers.map((m) => m.kind).lastIndexOf('station');
    expect(lastStation).toBeGreaterThanOrEqual(0);
    expect(lastStation).toBeLessThan(markers.length - 1);
  });
});

describe('minimap corpse marker (ghost run)', () => {
  it('marks the body with a corpse skull only while the player is a ghost', () => {
    const world = makeWorld('sim');
    // alive (not a ghost): no corpse marker
    expect(buildMarkers(world).some((m) => m.kind === 'corpse')).toBe(false);
    // a ghost with a nearby body: a corpse marker appears at the body
    (world.player as unknown as { ghost: boolean; corpsePos: unknown }).ghost = true;
    (world.player as unknown as { ghost: boolean; corpsePos: unknown }).corpsePos = {
      x: 3,
      y: 0,
      z: PZ,
    };
    expect(buildMarkers(world).some((m) => m.kind === 'corpse')).toBe(true);
  });
});

// The gather-node marker's locked dimension. The viewer stands ON
// the new tier-2 mirefen vein (ore_mirefen_t2), where the rim covers exactly
// five nodes in GATHER_NODES order: ore_mirefen_1, ore_mirefen_3,
// wood_mirefen_1, herb_mirefen_3 (all tier 1) and the tier-2 vein itself at
// the map centre. Actionable info on every preset: locked resolves from the
// bags, never a graphics knob.
//
// The count has moved twice with content, re-minted each time rather than
// loosened. It read five, then four when herb_mirefen_1 (4 yards under the
// (60, 380) pool) moved onto dry shore 47.0 yards out, past the 43.53-yard
// rim; the v0.32.0 merge then moved the anchor vein itself off (48,352)
// (an expansion collider took the spot), and from (36,350) wood_mirefen_1
// sits back inside the rim at 32.8 yards. That widens the coverage the arms
// below care about: an ore vein a pick unlocks beside a herb patch AND a
// wood stand it does not.
describe('gather-node markers: the locked dimension', () => {
  const T2 = { x: 36, z: 350 }; // ore_mirefen_t2, pinned literally (moved at the v0.32.0 merge)

  function makeGatherWorld(
    shape: 'sim' | 'client',
    opts: {
      inventory?: { itemId: string; count: number }[];
      harvestable?: (id: string) => boolean;
      /** The viewer's counters (R22): a tooled fixture must also carry the
       *  proficiency its tools ask, or the wield-filtered scan reads them
       *  as unusable exactly like the sim's harvest gate would. */
      gatheringProficiency?: Record<string, number>;
    } = {},
  ): IWorld {
    const junk = shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {};
    const player = {
      id: 1,
      kind: 'player',
      name: 'Me',
      pos: { x: T2.x, z: T2.z },
      facing: 0,
      dead: false,
      lootable: false,
      aggroTargetId: null,
      questIds: [],
      templateId: '',
      ...junk,
    };
    return {
      player,
      entities: new Map([[1, player]]),
      partyInfo: null,
      socialInfo: null,
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      stationPlacements: STATIONS,
      inventory: opts.inventory ?? [],
      gatheringProficiency: opts.gatheringProficiency ?? {},
      nodeHarvestableByMe: opts.harvestable ?? (() => true),
      questState: () => 'unavailable',
    } as unknown as IWorld;
  }

  function gatherMarkers(world: IWorld) {
    return buildMarkers(world).filter((m) => m.kind === 'gather-node') as Extract<
      MinimapMarker,
      { kind: 'gather-node' }
    >[];
  }

  it('a toolless viewer sees EVERY node locked (#2343: bare hands never gather)', () => {
    const markers = gatherMarkers(makeGatherWorld('sim'));
    expect(markers.map((m) => m.locked)).toEqual([true, true, true, true, true]);
    // The centre marker is the tier-2 vein under the viewer, still ready:
    // locked is the tool dimension, never the respawn one.
    const centre = markers.find((m) => m.mx === S / 2 && m.my === S / 2);
    expect(centre).toMatchObject({ locked: true, ready: true });
  });

  it('the WIELDED tier-2 pick unlocks only the ore nodes; herb stays locked without a sickle', () => {
    const tooled = gatherMarkers(
      makeGatherWorld('sim', {
        inventory: [{ itemId: 'iron_mining_pick', count: 1 }],
        // The pick must wield (R22): mining 40, its own requirement.
        gatheringProficiency: { mining: 40 },
      }),
    );
    // GATHER_NODES rim order: ore t1, ore t1, wood t1, herb t1, ore t2
    // (centre): the pick unlocks the ores alone; the wood stand and the herb
    // patch both stay locked without their own implements.
    expect(tooled.map((m) => m.locked)).toEqual([false, false, true, true, false]);
    // The R22 arm: the SAME pick with the counter short is unusable, so
    // every ore row stays locked on the map exactly as the sim's wield
    // denial would refuse the harvest (owned is not earned).
    const unearned = gatherMarkers(
      makeGatherWorld('sim', { inventory: [{ itemId: 'iron_mining_pick', count: 1 }] }),
    );
    expect(unearned.map((m) => m.locked)).toEqual([true, true, true, true, true]);
    // Locked composes WITH the respawn dimension, never replaces it: a
    // cooling locked vein keeps ready=false (the silhouette the painter keeps
    // readable under the locked tint).
    const cooling = gatherMarkers(makeGatherWorld('sim', { harvestable: () => false }));
    const centre = cooling.find((m) => m.mx === S / 2 && m.my === S / 2);
    expect(centre).toMatchObject({ locked: true, ready: false });
  });

  it('both IWorld shapes produce identical gather markers (decision-15 parity)', () => {
    expect(gatherMarkers(makeGatherWorld('sim'))).toEqual(gatherMarkers(makeGatherWorld('client')));
  });

  it('the proficiency map is read ONCE per build (the offline getter copies per access)', () => {
    // The hoist this pins is the change's entire purpose: Sim's
    // gatheringProficiency getter spread-copies the live map on every access,
    // so a per-profession read is per-build garbage no reference probe can
    // see. Model the copying getter and count: the multi-profession rim
    // (ore + wood + herb professions in range) must cost exactly one read.
    let reads = 0;
    const world = makeGatherWorld('sim', {
      inventory: [{ itemId: 'iron_mining_pick', count: 1 }],
    }) as { gatheringProficiency?: Record<string, number> };
    delete world.gatheringProficiency;
    Object.defineProperty(world, 'gatheringProficiency', {
      get() {
        reads++;
        return { mining: 40 };
      },
    });
    const markers = gatherMarkers(world as unknown as IWorld);
    expect(markers.length).toBeGreaterThan(0); // the rim really had nodes
    expect(reads).toBe(1);
  });

  it('both shapes agree on the R22 wield axis, each locked vector pinned literally', () => {
    // The toolless parity arm above cannot discriminate on the wield axis: an
    // empty bag with an empty counter map locks every node in both shapes, so
    // the two would still agree if the wield filter were wired into only one
    // of them. These fixtures carry the SAME covering tier-2 pick in BOTH
    // shapes and differ only in the counter, which is precisely the field a
    // mirror can drop (the Sim getter copies the live map; ClientWorld
    // rebuilds it from the gprof wire field). Agreement alone is not the
    // assertion either: each shape's locked vector is pinned literally, so a
    // pair that agreed on a WRONG vector still reds.
    const PICK = [{ itemId: 'iron_mining_pick', count: 1 }];
    // Covering but unwieldable (R22): mining 0 puts nothing to work, so every
    // node in the rim stays locked, the tier-1 ores included, even though the
    // bags hold a pick that covers them.
    const unearnedSim = gatherMarkers(
      makeGatherWorld('sim', { inventory: PICK, gatheringProficiency: { mining: 0 } }),
    );
    const unearnedClient = gatherMarkers(
      makeGatherWorld('client', { inventory: PICK, gatheringProficiency: { mining: 0 } }),
    );
    expect(unearnedSim.map((m) => m.locked)).toEqual([true, true, true, true, true]);
    expect(unearnedClient).toEqual(unearnedSim);
    // The same pick at the pick's own requirement flips the ore rows open
    // (rim order: ore t1, ore t1, wood t1, herb t1, ore t2 at the centre);
    // the wood stand and the herb patch keep locking for want of their own
    // implements, in both shapes.
    const earnedSim = gatherMarkers(
      makeGatherWorld('sim', { inventory: PICK, gatheringProficiency: { mining: 40 } }),
    );
    const earnedClient = gatherMarkers(
      makeGatherWorld('client', { inventory: PICK, gatheringProficiency: { mining: 40 } }),
    );
    expect(earnedSim.map((m) => m.locked)).toEqual([false, false, true, true, false]);
    expect(earnedClient).toEqual(earnedSim);
    // The pair genuinely discriminates: the counter, and nothing else, moved
    // the vector, so this parity assertion is not two copies of one constant.
    expect(earnedSim.map((m) => m.locked)).not.toEqual(unearnedSim.map((m) => m.locked));
  });
});

describe('gather-node markers scale with the rim, not the node table (phase 16)', () => {
  // The zone-scaling half of the client projection: the SCANNED set is the
  // whole authored table (an accepted O(nodes) walk at the minimap's 10 Hz
  // redraw), but the DRAWN set must stay bounded by the rim cull however many
  // zones ship nodes. Both arms below fail if the cull is dropped or its
  // comparison flips; neither moves when a new zone adds nodes.
  function nodeWorldAt(x: number, z: number): IWorld {
    const player = {
      id: 1,
      kind: 'player',
      name: 'Me',
      pos: { x, z },
      facing: 0,
      dead: false,
      lootable: false,
      aggroTargetId: null,
      questIds: [],
      templateId: '',
    };
    return {
      player,
      entities: new Map([[1, player]]),
      partyInfo: null,
      socialInfo: null,
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      stationPlacements: [],
      inventory: [],
      gatheringProficiency: {},
      nodeHarvestableByMe: () => true,
      questState: () => 'unavailable',
    } as unknown as IWorld;
  }
  function nodeMarkersAt(x: number, z: number) {
    return buildMarkers(nodeWorldAt(x, z)).filter((m) => m.kind === 'gather-node');
  }
  const RIM_PX = S / 2 - 7; // byte-faithful to the core's half - RIM_INSET

  it('draws exactly the in-rim subset, probed standing on one node of every zone', () => {
    const zones = [...new Set(GATHER_NODES.map((n) => n.zoneId))];
    // Every shipped zone carries nodes since the v0.32.0 starter kits, so the
    // probe genuinely tours the whole world.
    expect(zones.length).toBeGreaterThanOrEqual(14);
    for (const zoneId of zones) {
      const anchor = GATHER_NODES.find((n) => n.zoneId === zoneId);
      if (!anchor) throw new Error(`no node in ${zoneId}`);
      const inRim = GATHER_NODES.filter((n) => {
        const dx = (n.pos.x - anchor.pos.x) * PPY;
        const dz = (n.pos.z - anchor.pos.z) * PPY;
        return dx * dx + dz * dz <= RIM_PX * RIM_PX;
      });
      const drawn = nodeMarkersAt(anchor.pos.x, anchor.pos.z);
      expect(drawn, `zone ${zoneId}`).toHaveLength(inRim.length);
      // Position identity, not just cardinality: a cull that kept the WRONG
      // nodes at the right count must fail, so pin the projected coordinate
      // set (markers carry no node id; mx/my is half - delta * PPY).
      const expectCoords = inRim
        .map(
          (n) =>
            `${S / 2 - (n.pos.x - anchor.pos.x) * PPY},${S / 2 - (n.pos.z - anchor.pos.z) * PPY}`,
        )
        .sort();
      expect(drawn.map((m) => `${m.mx},${m.my}`).sort(), `zone ${zoneId} coords`).toEqual(
        expectCoords,
      );
      // Standing on a node always draws at least that node, and the rim
      // genuinely culls (far zones never ride along).
      expect(inRim.length).toBeGreaterThanOrEqual(1);
      expect(inRim.length).toBeLessThan(GATHER_NODES.length);
    }
  });

  it('a viewer far from every node draws zero node markers regardless of the table size', () => {
    expect(nodeMarkersAt(99000, 99000)).toHaveLength(0);
  });
});

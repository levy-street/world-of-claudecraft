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
import { QUESTS } from '../src/sim/data';
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
    questState: (q: string) => (q === GIVER_QUEST.id ? 'available' : 'unavailable'),
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
    // A real delve-band x: the band is CAPPED east by the Protect Yumi maze
    // band (YUMI_BAND_X_MIN = 8000), so the old open-ended 100000 probe now
    // classifies as the maze.
    w.player.pos.x = 5000;
    w.delveRun = { delveId: 'd', modules: ['m'], moduleIndex: 0, origin: { x: 5000, z: 0 } };
    expect(minimapMode(w as unknown as IWorld)).toBe('delve');
  });

  it('returns yumiMaze anywhere in the Protect Yumi band, run or not', () => {
    const w = makeWorld('client') as unknown as { player: { pos: { x: number } } };
    w.player.pos.x = 8400;
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

import { describe, it, expect } from 'vitest';
import {
  arrowHeadingDeg,
  buildMobDropIndex,
  questWaypointTarget,
  screenArrowDeg,
  waypointDistance,
  type WaypointContent,
} from '../src/ui/quest_waypoint';
import type { CampDef, GroundObjectDef, MobTemplate, NpcDef, QuestDef, QuestObjective, QuestProgress } from '../src/sim/types';

// --- fixtures -------------------------------------------------------------

function npc(id: string, x: number, z: number): NpcDef {
  return { id, name: id, title: '', pos: { x, z }, facing: 0, color: 0, questIds: [], greeting: '' };
}

function quest(id: string, objectives: QuestObjective[], turnInNpcId = 'turnin'): QuestDef {
  return {
    id, name: id, giverNpcId: 'giver', turnInNpcId, text: '', completionText: '',
    objectives, xpReward: 0, copperReward: 0, itemRewards: {},
  };
}

function progress(questId: string, counts: number[], state: QuestProgress['state'] = 'active'): QuestProgress {
  return { questId, counts, state };
}

function content(overrides: Partial<WaypointContent>): WaypointContent {
  return {
    quests: {},
    npcs: {},
    camps: [],
    groundObjects: [],
    mobForItem: () => undefined,
    ...overrides,
  };
}

const PLAYER = { x: 0, z: 0 };

// --- target derivation ----------------------------------------------------

describe('questWaypointTarget', () => {
  it('returns null for an unknown quest', () => {
    expect(questWaypointTarget(progress('nope', []), 'active', PLAYER, content({}))).toBeNull();
  });

  it('points at the turn-in NPC once the quest is ready', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'kill', targetMobId: 'wolf', count: 5, label: '' }], 'handIn') },
      npcs: { handIn: npc('handIn', 12, 34) },
      camps: [{ mobId: 'wolf', center: { x: 99, z: 99 }, radius: 5, count: 3 }],
    });
    expect(questWaypointTarget(progress('q', [5], 'ready'), 'ready', PLAYER, c)).toEqual({ x: 12, z: 34 });
  });

  it('points a kill objective at the nearest camp for that mob', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'kill', targetMobId: 'wolf', count: 5, label: '' }]) },
      npcs: { turnin: npc('turnin', 0, 0) },
      camps: [
        { mobId: 'wolf', center: { x: 100, z: 0 }, radius: 5, count: 3 },
        { mobId: 'wolf', center: { x: 10, z: 0 }, radius: 5, count: 3 },
        { mobId: 'bear', center: { x: 1, z: 0 }, radius: 5, count: 3 },
      ],
    });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toEqual({ x: 10, z: 0 });
  });

  it('points an interact objective at the target NPC', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'interact', targetNpcId: 'elder', count: 1, label: '' }]) },
      npcs: { elder: npc('elder', 5, 7), turnin: npc('turnin', 0, 0) },
    });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toEqual({ x: 5, z: 7 });
  });

  it('points a ground-object collect at the nearest matching object position', () => {
    const obj: GroundObjectDef = { itemId: 'herb', name: 'Herb', positions: [{ x: 50, z: 0 }, { x: 3, z: 4 }] };
    const c = content({
      quests: { q: quest('q', [{ type: 'collect', targetObjectItemId: 'herb', count: 3, label: '' }]) },
      npcs: { turnin: npc('turnin', 0, 0) },
      groundObjects: [obj],
    });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toEqual({ x: 3, z: 4 });
  });

  it('points a mob-drop collect at the nearest camp of the dropping mob', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'collect', itemId: 'pelt', count: 4, label: '' }]) },
      npcs: { turnin: npc('turnin', 0, 0) },
      camps: [{ mobId: 'wolf', center: { x: 8, z: 0 }, radius: 5, count: 3 }],
      mobForItem: (id) => (id === 'pelt' ? 'wolf' : undefined),
    });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toEqual({ x: 8, z: 0 });
  });

  it('falls back to the turn-in NPC when a collected item has no known source', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'collect', itemId: 'mystery', count: 1, label: '' }], 'handIn') },
      npcs: { handIn: npc('handIn', 21, 22) },
    });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toEqual({ x: 21, z: 22 });
  });

  it('targets the FIRST incomplete objective', () => {
    const c = content({
      quests: {
        q: quest('q', [
          { type: 'interact', targetNpcId: 'a', count: 1, label: '' },
          { type: 'interact', targetNpcId: 'b', count: 1, label: '' },
        ]),
      },
      npcs: { a: npc('a', 1, 1), b: npc('b', 2, 2), turnin: npc('turnin', 0, 0) },
    });
    // first objective done (1/1), second incomplete (0/1) -> point at b
    expect(questWaypointTarget(progress('q', [1, 0]), 'active', PLAYER, c)).toEqual({ x: 2, z: 2 });
  });

  it('heads to the turn-in NPC when every objective is met but the quest is not yet ready', () => {
    const c = content({
      quests: { q: quest('q', [{ type: 'kill', targetMobId: 'wolf', count: 5, label: '' }], 'handIn') },
      npcs: { handIn: npc('handIn', 9, 9) },
    });
    expect(questWaypointTarget(progress('q', [5]), 'active', PLAYER, c)).toEqual({ x: 9, z: 9 });
  });

  it('returns null when not even the turn-in NPC can be resolved', () => {
    const c = content({ quests: { q: quest('q', [{ type: 'collect', itemId: 'x', count: 1, label: '' }]) } });
    expect(questWaypointTarget(progress('q', [0]), 'active', PLAYER, c)).toBeNull();
  });
});

describe('buildMobDropIndex', () => {
  const mob = (id: string, itemIds: (string | undefined)[]): MobTemplate => ({
    loot: itemIds.map((itemId) => ({ itemId, chance: 1 })),
  } as unknown as MobTemplate);

  it('maps each item to the first mob that drops it and skips currency entries', () => {
    const index = buildMobDropIndex({
      wolf: mob('wolf', ['pelt', undefined]),
      bear: mob('bear', ['pelt', 'claw']),
    });
    expect(index.get('pelt')).toBe('wolf'); // first mob wins
    expect(index.get('claw')).toBe('bear');
    expect(index.has('undefined')).toBe(false);
    expect(index.size).toBe(2);
  });
});

// --- on-screen arrow heading ----------------------------------------------

describe('screenArrowDeg', () => {
  const FROM = { x: 100, y: 100 };

  it('points the up-glyph straight up (0deg) when the target is above', () => {
    expect(screenArrowDeg(FROM, { x: 100, y: 0 })).toBeCloseTo(0); // y up = smaller y
  });

  it('rotates 90deg to point right when the target is to the right', () => {
    expect(screenArrowDeg(FROM, { x: 200, y: 100 })).toBeCloseTo(90);
  });

  it('rotates 180deg to point down when the target is below', () => {
    expect(screenArrowDeg(FROM, { x: 100, y: 200 })).toBeCloseTo(180);
  });

  it('rotates 270deg to point left when the target is to the left', () => {
    expect(screenArrowDeg(FROM, { x: 0, y: 100 })).toBeCloseTo(270);
  });

  it('points up-right (45deg) on a diagonal', () => {
    expect(screenArrowDeg(FROM, { x: 200, y: 0 })).toBeCloseTo(45);
  });
});

describe('waypointDistance', () => {
  it('measures planar (x,z) distance in yards', () => {
    expect(waypointDistance({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });
});

describe('arrowHeadingDeg', () => {
  const BASE = { x: 100, y: 100 };
  const front = (x: number, y: number) => ({ x, y, behind: false });
  const behind = (x: number, y: number) => ({ x, y, behind: true });

  it('uses the toward probe when it is in front of the camera', () => {
    // toward probe to the right -> 90deg; away probe is ignored.
    expect(arrowHeadingDeg(BASE, front(200, 100), behind(0, 100))).toBeCloseTo(90);
  });

  it('falls back to the away probe + 180deg when the toward probe is behind', () => {
    // The target is behind the camera so its projection mirrors to the LEFT
    // (270deg); the away probe (in front, to the right) gives 90deg, +180 = 270.
    expect(arrowHeadingDeg(BASE, behind(0, 100), front(200, 100))).toBeCloseTo(270);
  });

  it('treats a non-finite toward probe as unusable and uses the away probe', () => {
    expect(arrowHeadingDeg(BASE, front(NaN, 100), front(100, 200))).toBeCloseTo(0); // away down(180)+180=360->0
  });

  it('returns null when neither probe is usable', () => {
    expect(arrowHeadingDeg(BASE, behind(200, 100), behind(0, 100))).toBeNull();
    expect(arrowHeadingDeg(BASE, front(NaN, 100), front(100, Infinity))).toBeNull();
  });
});

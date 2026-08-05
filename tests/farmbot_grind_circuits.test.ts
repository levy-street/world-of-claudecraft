import { describe, expect, it } from 'vitest';
import {
  campMobLevel,
  defaultGrindTables,
  type GrindCamp,
  type GrindTables,
  nextLevelZoneId,
  pickCamp,
  zoneCampsFor,
} from '../farmbot/grind_circuits';
import { type CampDef, type MobTemplate, mobXpValue, type ZoneDef } from '../src/sim/types';

function camp(over: Partial<GrindCamp> & { mobId: string }): GrindCamp {
  return {
    center: { x: 0, z: 0 },
    radius: 20,
    count: 4,
    zoneId: 'zone_a',
    minLevel: 5,
    maxLevel: 6,
    ...over,
  };
}

function tables(over: Partial<GrindTables> = {}): GrindTables {
  const mobs: Record<string, MobTemplate> = {
    wolf: { id: 'wolf', name: 'wolf', minLevel: 5, maxLevel: 6 } as MobTemplate,
    boar: { id: 'boar', name: 'boar', minLevel: 1, maxLevel: 2 } as MobTemplate,
    bear: { id: 'bear', name: 'bear', minLevel: 9, maxLevel: 10 } as MobTemplate,
  };
  return {
    camps: [
      camp({ mobId: 'wolf', center: { x: 10, z: 0 }, count: 4 }),
      camp({ mobId: 'boar', center: { x: 20, z: 0 }, count: 6, minLevel: 1, maxLevel: 2 }),
      camp({ mobId: 'bear', center: { x: 30, z: 0 }, count: 2, minLevel: 9, maxLevel: 10 }),
    ],
    mobs,
    zoneIdAt: () => 'zone_a',
    xpValue: mobXpValue,
    zoneDefs: [],
    ...over,
  };
}

describe('farmbot pickCamp', () => {
  const campsOf = (t: GrindTables) => zoneCampsFor('zone_a', t);

  it('picks the nearest viable camp in the level window', () => {
    // player 6: wolf (6) in window, boar (2) gray-ish/window-miss, bear (10) too high
    const picked = pickCamp(6, campsOf(tables()), { x: 0, z: 0 }, mobXpValue);
    expect(picked?.mobId).toBe('wolf');
  });

  it('rejects gray mobs outright', () => {
    // player 20 vs a level-2 camp: zd 8, diff -18 >= 8 -> gray
    expect(mobXpValue(2, 20)).toBe(0);
    expect(pickCamp(20, campsOf(tables()), { x: 0, z: 0 }, mobXpValue)).toBeNull();
  });

  it('respects the [playerLevel-2, playerLevel+3] window even when not gray', () => {
    // player 4: boar (2) is below the window (4-2) even though it pays a sliver of xp
    expect(mobXpValue(2, 4)).toBeGreaterThan(0);
    expect(pickCamp(4, campsOf(tables()), { x: 0, z: 0 }, mobXpValue)?.mobId).toBe('wolf');
  });

  it('breaks distance ties by density', () => {
    const t = tables();
    t.camps = [
      camp({ mobId: 'wolf', center: { x: 10, z: 0 }, count: 2 }),
      camp({ mobId: 'wolf', center: { x: 10, z: 0 }, count: 6 }),
    ];
    expect(pickCamp(6, campsOf(t), { x: 0, z: 0 }, mobXpValue)?.count).toBe(6);
  });

  it('skips camps whose mobId has no template', () => {
    const t = tables();
    t.camps = [camp({ mobId: 'no_such_mob' })];
    expect(zoneCampsFor('zone_a', t)).toEqual([]);
  });
});

describe('farmbot nextLevelZoneId', () => {
  const zoneDefs = [
    { id: 'low', levelRange: [1, 7] },
    { id: 'mid', levelRange: [6, 13] },
    { id: 'high', levelRange: [13, 20] },
    { id: 'empty', levelRange: [2, 5] },
  ] as unknown as ZoneDef[];
  const someCamps = (): CampDef[] => [
    { mobId: 'wolf', center: { x: 0, z: 0 }, radius: 10, count: 3 },
  ];

  it('moves to the lowest band covering the level that has camps', () => {
    const t = tables({
      zoneDefs,
      zoneIdAt: () => 'mid',
      camps: someCamps(),
    });
    expect(nextLevelZoneId(8, t)).toBe('mid');
    expect(nextLevelZoneId(14, { ...t, zoneIdAt: () => 'high', camps: someCamps() })).toBe('high');
  });

  it('skips band zones with no camps', () => {
    const t = tables({ zoneDefs, zoneIdAt: () => 'mid', camps: someCamps() });
    // level 3: 'low' and 'empty' cover it but have no camps in this table
    expect(nextLevelZoneId(3, t)).toBeNull();
    // level 8: only 'mid' covers it, and it has camps
    expect(nextLevelZoneId(8, t)).toBe('mid');
  });

  it('returns null past every band', () => {
    const t = tables({ zoneDefs, zoneIdAt: () => 'mid', camps: someCamps() });
    expect(nextLevelZoneId(21, t)).toBeNull();
  });
});

describe('farmbot grind tables against real content', () => {
  it('zone1 camps live in eastbrook_vale with starter-band levels', () => {
    const real = defaultGrindTables();
    const camps = zoneCampsFor('eastbrook_vale', real);
    expect(camps.length).toBeGreaterThan(5);
    for (const c of camps) {
      expect(campMobLevel(c)).toBeLessThanOrEqual(9); // eastbrook band is 1-7 plus a couple of rares
    }
    // a level-3 player finds viable work, a level-20 player finds only gray
    expect(pickCamp(3, camps, camps[0].center, real.xpValue)).not.toBeNull();
    expect(pickCamp(20, camps, camps[0].center, real.xpValue)).toBeNull();
  });

  it('real band progression: eastbrook -> mirefen -> thornpeak', () => {
    const real = defaultGrindTables();
    expect(nextLevelZoneId(3, real)).toBe('eastbrook_vale');
    expect(nextLevelZoneId(8, real)).toBe('mirefen_marsh');
    expect(nextLevelZoneId(14, real)).toBe('thornpeak_heights');
  });
});

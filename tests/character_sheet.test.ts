import { describe, expect, it } from 'vitest';
import { type CharacterSheetInput, characterSheet, splitCopper } from '../server/character_sheet';
import type { CharacterRow } from '../server/db';
import { zoneAt } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import type { CharacterState } from '../src/sim/sim';
import { type PlayerClass, virtualLevel } from '../src/sim/types';

function makeState(over: Partial<CharacterState> = {}): CharacterState {
  return {
    level: 20,
    xp: 0,
    lifetimeXp: 50_000,
    prestigeRank: 1,
    copper: 123456,
    hp: 500,
    resource: 200,
    pos: { x: 5, z: 0 },
    facing: 0,
    equipment: {},
    inventory: [{ itemId: 'wolf_pelt', qty: 3 } as any],
    questLog: [{ questId: 'q1', counts: [1], state: 'active' }],
    questsDone: [],
    arena1v1Rating: 1600,
    arena1v1Wins: 10,
    arena1v1Losses: 4,
    ...over,
  } as CharacterState;
}

function makeRow(cls: PlayerClass, level: number, state: CharacterState): CharacterRow {
  return {
    id: 7,
    account_id: 1,
    name: 'Thrallish',
    class: cls,
    level,
    state,
    is_gm: false,
    force_rename: false,
  };
}

function input(over: Partial<CharacterSheetInput> = {}): CharacterSheetInput {
  return {
    row: makeRow('shaman', 20, makeState()),
    visibility: 'owner',
    realm: 'Claudemoon',
    origin: 'https://worldofclaudecraft.com',
    guild: 'Echoes of Claude',
    rank: { scope: 'realm', rank: 27, total: 4012 },
    updatedAt: '2026-06-23T00:00:00.000Z',
    ...over,
  };
}

describe('splitCopper', () => {
  it('splits copper into gold/silver/copper', () => {
    expect(splitCopper(123456)).toEqual({ gold: 12, silver: 34, copper: 56 });
    expect(splitCopper(0)).toEqual({ gold: 0, silver: 0, copper: 0 });
    expect(splitCopper(99)).toEqual({ gold: 0, silver: 0, copper: 99 });
  });
});

describe('characterSheet — shared fields', () => {
  it('derives classLabel, zone, virtualLevel, prestige, spec, avatar + profile urls', () => {
    const sheet = characterSheet(input());
    expect(sheet.name).toBe('Thrallish');
    expect(sheet.realm).toBe('Claudemoon');
    expect(sheet.class).toBe('shaman');
    expect(sheet.classLabel).toBe('Shaman');
    expect(sheet.level).toBe(20);
    expect(sheet.virtualLevel).toBe(virtualLevel(50_000));
    expect(sheet.prestigeRank).toBe(1);
    expect(sheet.zone).toBe(zoneAt(0).name);
    expect(sheet.guild).toBe('Echoes of Claude');
    expect(sheet.rank).toEqual({ scope: 'realm', rank: 27, total: 4012 });
    expect(sheet.avatarUrl).toBe('https://worldofclaudecraft.com/avatar/shaman/0.png');
    expect(sheet.profileUrl).toBe('https://worldofclaudecraft.com/c/Thrallish');
    expect(sheet.arena['1v1']).toEqual({ rating: 1600, wins: 10, losses: 4 });
  });

  it('backfills virtualLevel from level when lifetimeXp is absent', () => {
    const sheet = characterSheet(
      input({ row: makeRow('mage', 12, makeState({ lifetimeXp: undefined, level: 12 })) }),
    );
    expect(sheet.virtualLevel).toBe(12);
  });
});

describe('characterSheet — owner variant', () => {
  it('includes stats, vitals, gold, and exact position', () => {
    const sheet = characterSheet(input({ visibility: 'owner' }));
    expect(sheet.gold).toEqual({ gold: 12, silver: 34, copper: 56 });
    expect(sheet.pos).toEqual({ x: 5, z: 0 });
    expect(sheet.stats).toBeDefined();
    expect(sheet.vitals).toBeDefined();
    expect(sheet.vitals!.hp).toBe(500);
  });

  it('stats equal recalcPlayerStats output for the same class/level/gear', () => {
    const cls: PlayerClass = 'warrior';
    const level = 18;
    const sheet = characterSheet(
      input({ row: makeRow(cls, level, makeState({ level, talents: undefined, equipment: {} })) }),
    );
    // Independently derive via the engine's one true function.
    const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
    e.level = level;
    recalcPlayerStats(e, cls, {});
    expect(sheet.stats).toEqual({ ...e.stats });
    expect(sheet.vitals!.maxHp).toBe(e.maxHp);
    expect(sheet.vitals!.resource.max).toBe(e.maxResource);
  });
});

describe('characterSheet — public variant leaks nothing sensitive', () => {
  it('omits stats, vitals, gold, and exact position', () => {
    const sheet = characterSheet(input({ visibility: 'public' }));
    expect(sheet.stats).toBeUndefined();
    expect(sheet.vitals).toBeUndefined();
    expect(sheet.gold).toBeUndefined();
    expect(sheet.pos).toBeUndefined();
    // but keeps the safe public subset
    expect(sheet.name).toBe('Thrallish');
    expect(sheet.zone).toBe(zoneAt(0).name);
    expect(sheet.virtualLevel).toBe(virtualLevel(50_000));
    expect(sheet.guild).toBe('Echoes of Claude');
  });

  it('serialized public JSON contains no inventory, questLog, pos, gold, stats, or vitals', () => {
    const json = JSON.stringify(characterSheet(input({ visibility: 'public' })));
    for (const leak of ['inventory', 'questLog', 'stats', 'vitals', 'gold', '"pos"']) {
      expect(json).not.toContain(leak);
    }
  });

  it('property check: no owner-only key survives across many class/level combos', () => {
    const classes: PlayerClass[] = [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ];
    for (const cls of classes) {
      for (const level of [1, 10, 20]) {
        const sheet = characterSheet(
          input({ visibility: 'public', row: makeRow(cls, level, makeState({ level })) }),
        );
        expect('stats' in sheet).toBe(false);
        expect('vitals' in sheet).toBe(false);
        expect('gold' in sheet).toBe(false);
        expect('pos' in sheet).toBe(false);
      }
    }
  });
});

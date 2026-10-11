import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { lootItemUsableByClasses, usableRollGroup } from '../src/sim/loot/class_locked_drop';
import { pickRollGroupWinner, rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { LootEntry, PlayerClass } from '../src/sim/types';
import { rollWorldBossLoot } from '../src/sim/world_boss';

// A drop that is BOTH soulbound and class-restricted only rolls when some
// loot-eligible class can use it (src/sim/loot/class_locked_drop.ts). The
// live case is the Crucible sigils: each covers one three-class group.

const VARKHUL = 'varkhul_forgefather_of_the_last_flame';
const IGNIVAR = 'ignivar_herald_of_the_last_flame';
const SIGIL_FAMILY_CLASSES: Record<string, readonly PlayerClass[]> = {
  anvil: ['warrior', 'druid', 'mage'],
  ember: ['paladin', 'hunter', 'priest'],
  tempest: ['shaman', 'rogue', 'warlock'],
};
const sigilFamily = (id: string): string | undefined => /^sigil_([a-z]+)_/.exec(id)?.[1];

function raid(classes: readonly PlayerClass[]): { sim: Sim; metas: PlayerMeta[] } {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const metas = classes.map((cls, i) => {
    const meta = sim.ctx.players.get(sim.addPlayer(cls, `Raider${i}`));
    if (!meta) throw new Error('expected raider');
    return meta;
  });
  return { sim, metas };
}

// One kill of `bossId` through the live roller, with or without a heroic
// claim; returns every item id the corpse got.
function killOnce(sim: Sim, metas: PlayerMeta[], bossId: string, heroic: boolean): string[] {
  const template = MOBS[bossId];
  const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
  sim.ctx.instances.length = 0;
  if (heroic) {
    sim.ctx.instances.push({
      id: -1,
      dungeonId: 'crucible',
      difficulty: 'heroic',
      partyKey: 'raid',
      mobIds: [mob.id],
    } as unknown as (typeof sim.ctx.instances)[number]);
  }
  rollLoot(sim.ctx, mob, metas[0], metas);
  return (mob.loot?.items ?? []).map((s) => s.itemId);
}

// Rolls a boss's live table once per seed and returns every sigil it paid.
function sigilsFromKills(
  bossId: string,
  classes: readonly PlayerClass[],
  heroic: boolean,
  kills = 200,
): string[] {
  const { sim, metas } = raid(classes);
  const sigils: string[] = [];
  for (let seed = 0; seed < kills; seed++) {
    sim.rng = new Rng(seed);
    sigils.push(...killOnce(sim, metas, bossId, heroic).filter((id) => id.startsWith('sigil_')));
  }
  return sigils;
}

// A mocked table that exercises every gate arm at once: an all-locked group,
// a locked plain row, and an unlocked plain row after them (anvil sigils are
// warrior, druid, and mage only; the core is unrestricted).
const LOCKED_TABLE: LootEntry[] = [
  { itemId: 'sigil_anvil_legs', chance: 1, rollGroup: 'locked_group' },
  { itemId: 'sigil_anvil_helmet', chance: 1 },
  { itemId: 'lastflame_core', chance: 0.5 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('class-locked soulbound drops: the usability predicate', () => {
  it('gates a soulbound class-locked sigil on the eligible classes', () => {
    expect(lootItemUsableByClasses('sigil_anvil_helmet', new Set(['warrior']))).toBe(true);
    expect(lootItemUsableByClasses('sigil_anvil_helmet', new Set(['priest', 'mage']))).toBe(true);
    expect(lootItemUsableByClasses('sigil_anvil_helmet', new Set(['paladin', 'priest']))).toBe(
      false,
    );
    expect(lootItemUsableByClasses('sigil_anvil_helmet', new Set())).toBe(false);
  });

  it('leaves items that are only one of soulbound or class-restricted alone', () => {
    // Class-restricted but tradeable (Emberward has requiredClass, no soulbound).
    expect(lootItemUsableByClasses('varkhul_emberward', new Set(['mage']))).toBe(true);
    // Soulbound with no class list.
    expect(lootItemUsableByClasses('forgefathers_ember', new Set(['mage']))).toBe(true);
    // Neither, and an unknown id.
    expect(lootItemUsableByClasses('worn_sword', new Set(['mage']))).toBe(true);
    expect(lootItemUsableByClasses('no_such_item', new Set(['mage']))).toBe(true);
  });
});

describe('class-locked soulbound drops: usableRollGroup', () => {
  const group: LootEntry[] = [
    { itemId: 'a', chance: 0.25, rollGroup: 'g' },
    { itemId: 'b', chance: 0.25, rollGroup: 'g' },
    { itemId: 'c', chance: 0.5, rollGroup: 'g' },
  ];

  it('returns the same array when every row is usable (byte-identical weights)', () => {
    expect(usableRollGroup(group, () => true)).toBe(group);
  });

  it('redistributes a removed row across the kept rows in proportion, keeping the total', () => {
    const uneven: LootEntry[] = [
      { itemId: 'a', chance: 0.1, rollGroup: 'g' },
      { itemId: 'b', chance: 0.3, rollGroup: 'g' },
      { itemId: 'c', chance: 0.6, rollGroup: 'g' },
    ];
    const kept = usableRollGroup(uneven, (id) => id !== 'c');
    expect(kept.map((e) => e.itemId)).toEqual(['a', 'b']);
    // 1:3 stays 1:3 (an even split would read 0.5 / 0.5).
    expect(kept[0].chance).toBeCloseTo(0.25, 12);
    expect(kept[1].chance).toBeCloseTo(0.75, 12);
    // The guaranteed slot stays guaranteed: the top of the roll range still pays.
    expect(pickRollGroupWinner(1 - Number.EPSILON, kept, new Set())?.itemId).toBe('b');
  });

  it('keeps a partial group partial (the nothing share is preserved)', () => {
    const partial: LootEntry[] = [
      { itemId: 'a', chance: 0.1, rollGroup: 'g' },
      { itemId: 'b', chance: 0.3, rollGroup: 'g' },
    ];
    const kept = usableRollGroup(partial, (id) => id === 'b');
    expect(kept).toHaveLength(1);
    expect(kept[0].chance).toBeCloseTo(0.4, 12);
    expect(pickRollGroupWinner(0.5, kept, new Set())).toBeNull();
  });

  it('empties the group when no row is usable', () => {
    expect(usableRollGroup(group, () => false)).toEqual([]);
    expect(pickRollGroupWinner(0, [], new Set())).toBeNull();
  });
});

describe('class-locked soulbound drops: the live Crucible tables', () => {
  it('a paladin + priest raid only ever wins Ember sigils from Varkhul, one per kill', () => {
    // Before the gate, two thirds of these kills paid an Anvil or Tempest
    // sigil neither raider could redeem or trade.
    const sigils = sigilsFromKills(VARKHUL, ['paladin', 'priest'], false);
    expect(sigils).toHaveLength(200);
    expect(new Set(sigils.map(sigilFamily))).toEqual(new Set(['ember']));
    // Both slot axes stay reachable after the reweight.
    expect(sigils.some((id) => id.endsWith('_legs'))).toBe(true);
    expect(sigils.some((id) => id.endsWith('_helmet'))).toBe(true);
  });

  it('a mixed raid still rolls every family it can use, and only those', () => {
    const classes: PlayerClass[] = ['warrior', 'rogue'];
    const sigils = sigilsFromKills(IGNIVAR, classes, false);
    expect(sigils).toHaveLength(200);
    const families = new Set(sigils.map(sigilFamily));
    expect(families).toEqual(new Set(['anvil', 'tempest']));
    for (const family of families) {
      const covers = SIGIL_FAMILY_CLASSES[family ?? ''];
      expect(
        classes.some((cls) => covers.includes(cls)),
        family,
      ).toBe(true);
    }
  });

  it('gates the Heroic Robe sigil append the same way', () => {
    expect(HEROIC_BOSS_LOOT[VARKHUL]?.some((e) => e.itemId === 'sigil_tempest_chest')).toBe(true);
    const sigils = sigilsFromKills(VARKHUL, ['shaman'], true, 60);
    // One merged-partition sigil plus the guaranteed Robe sigil per kill.
    expect(sigils).toHaveLength(120);
    expect(new Set(sigils.map(sigilFamily))).toEqual(new Set(['tempest']));
    expect(sigils.filter((id) => id.endsWith('_chest'))).toHaveLength(60);
  });

  it('a raid covering every sigil family rolls exactly like a full nine-class raid', () => {
    // Nothing is removed, so the group keeps its authored weights: every kill
    // pays the same items, seed for seed.
    const allNine: PlayerClass[] = [
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
    for (const heroic of [false, true]) {
      const covering = sigilsFromKills(VARKHUL, ['warrior', 'paladin', 'shaman'], heroic, 150);
      expect(covering).toHaveLength(heroic ? 300 : 150);
      expect(covering).toEqual(sigilsFromKills(VARKHUL, allNine, heroic, 150));
      expect(new Set(covering.map(sigilFamily))).toEqual(new Set(['anvil', 'ember', 'tempest']));
    }
  });
});

describe('class-locked soulbound drops: mocked tables (every arm)', () => {
  function rollMocked(classes: PlayerClass[], heroic: boolean) {
    const { sim, metas } = raid(classes);
    sim.rng = new Rng(77);
    const draws = vi.spyOn(sim.ctx.rng, 'next');
    const items = killOnce(sim, metas, VARKHUL, heroic);
    const count = draws.mock.calls.length;
    draws.mockRestore();
    return { items, draws: count, nextDraw: sim.rng.next() };
  }
  const sigilsOf = (items: string[]) => items.filter((id) => id.startsWith('sigil_')).sort();

  it('withholds a locked plain row and an all-locked group from the base table', () => {
    vi.spyOn(MOBS[VARKHUL], 'loot', 'get').mockReturnValue(LOCKED_TABLE);
    const priest = rollMocked(['priest'], false);
    expect(sigilsOf(priest.items)).toEqual([]);
    const warrior = rollMocked(['warrior'], false);
    expect(sigilsOf(warrior.items)).toEqual(['sigil_anvil_helmet', 'sigil_anvil_legs']);
    // Same draws in the selection pass whatever the class mix: the emptied
    // group still draws its one next(), the locked row still draws its chance.
    expect(priest.draws).toBe(warrior.draws);
    expect(priest.nextDraw).toBe(warrior.nextDraw);
    // The trailing unlocked row is decided on the same draw for both.
    expect(priest.items.includes('lastflame_core')).toBe(warrior.items.includes('lastflame_core'));
  });

  it('withholds the same arms from the heroic append', () => {
    vi.spyOn(MOBS[VARKHUL], 'loot', 'get').mockReturnValue([]);
    vi.spyOn(HEROIC_BOSS_LOOT, VARKHUL, 'get').mockReturnValue(
      LOCKED_TABLE.map((entry) =>
        entry.rollGroup ? { ...entry, rollGroup: 'locked_h_group' } : entry,
      ),
    );
    const priest = rollMocked(['priest'], true);
    expect(sigilsOf(priest.items)).toEqual([]);
    const warrior = rollMocked(['warrior'], true);
    expect(sigilsOf(warrior.items)).toEqual(['sigil_anvil_helmet', 'sigil_anvil_legs']);
    expect(priest.draws).toBe(warrior.draws);
    expect(priest.nextDraw).toBe(warrior.nextDraw);
  });

  it('reads the whole eligible set, not just the killer', () => {
    vi.spyOn(MOBS[VARKHUL], 'loot', 'get').mockReturnValue(LOCKED_TABLE);
    const { sim, metas } = raid(['priest', 'mage']);
    sim.rng = new Rng(77);
    expect(sigilsOf(killOnce(sim, metas, VARKHUL, false))).toEqual([
      'sigil_anvil_helmet',
      'sigil_anvil_legs',
    ]);
  });
});

describe('class-locked soulbound drops: world boss personal loot', () => {
  it("gates each contributor's personal copy on that contributor's own class", () => {
    const sim = new Sim({ seed: 42, noPlayer: true, playerClass: 'warrior' });
    const a = sim.addPlayer('warrior', 'Alpha');
    const b = sim.addPlayer('priest', 'Bravo');
    const metas = [a, b].map((pid) => {
      const meta = sim.ctx.players.get(pid);
      if (!meta) throw new Error('expected contributor');
      return meta;
    });
    const mob = createMob(sim.nextId++, MOBS.thunzharr_waking_peak, 20, { x: 0, y: 0, z: 0 });
    // A locked plain row, then a half-and-half group whose first row is
    // warrior-only (anvil) and second priest-usable (ember). Tools only, so
    // no quality draws follow the selection.
    vi.spyOn(MOBS[mob.templateId], 'loot', 'get').mockReturnValue([
      { itemId: 'sigil_anvil_helmet', chance: 1 },
      { itemId: 'sigil_anvil_legs', chance: 0.5, rollGroup: 'wb_gear' },
      { itemId: 'sigil_ember_legs', chance: 0.5, rollGroup: 'wb_gear' },
    ]);
    // Every draw lands at 0.25: inside the anvil half of the authored group.
    const draws = vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.25);
    rollWorldBossLoot(sim.ctx, mob, metas);
    const byOwner = (pid: number) =>
      (mob.loot?.items ?? []).filter((s) => s.personalFor?.includes(pid)).map((s) => s.itemId);
    expect(byOwner(a).sort()).toEqual(['sigil_anvil_helmet', 'sigil_anvil_legs']);
    // The priest rolled too (positive control): the group reweights onto the
    // one row a priest can use, so the same 0.25 pays Ember instead of nothing.
    expect(byOwner(b)).toEqual(['sigil_ember_legs']);
    // One chance plus one group draw per contributor, gated or not.
    expect(draws).toHaveBeenCalledTimes(4);
  });
});

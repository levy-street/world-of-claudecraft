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

// Rolls a boss's live table once per seed and returns every sigil it paid.
function sigilsFromKills(
  bossId: string,
  classes: readonly PlayerClass[],
  heroic: boolean,
  kills = 200,
): string[] {
  const { sim, metas } = raid(classes);
  const template = MOBS[bossId];
  const sigils: string[] = [];
  for (let seed = 0; seed < kills; seed++) {
    sim.rng = new Rng(seed);
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
    sigils.push(
      ...(mob.loot?.items ?? []).map((s) => s.itemId).filter((id) => id.startsWith('sigil_')),
    );
  }
  return sigils;
}

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

  it('redistributes a removed row across the kept rows, keeping the group total', () => {
    const kept = usableRollGroup(group, (id) => id !== 'c');
    expect(kept.map((e) => e.itemId)).toEqual(['a', 'b']);
    expect(kept.map((e) => e.chance)).toEqual([0.5, 0.5]);
    // The guaranteed slot stays guaranteed: the top of the roll range still pays.
    expect(pickRollGroupWinner(0.999999, kept, new Set())?.itemId).toBe('b');
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

  it('a full-coverage raid rolls on the authored weights, unchanged', () => {
    const everyone: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
    const sigils = sigilsFromKills(VARKHUL, everyone, false, 300);
    expect(new Set(sigils.map(sigilFamily))).toEqual(new Set(['anvil', 'ember', 'tempest']));
  });

  it('never changes the rng draw count: the class mix cannot shift later rolls', () => {
    const nextDrawAfterKill = (classes: PlayerClass[]): number => {
      const { sim, metas } = raid(classes);
      sim.rng = new Rng(77);
      const mob = createMob(-1, MOBS[VARKHUL], 20, { x: 0, y: 0, z: 0 });
      rollLoot(sim.ctx, mob, metas[0], metas);
      return sim.rng.next();
    };
    expect(nextDrawAfterKill(['priest'])).toBe(nextDrawAfterKill(['warrior']));
    expect(nextDrawAfterKill(['warlock', 'hunter'])).toBe(nextDrawAfterKill(['druid']));
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
    vi.spyOn(MOBS[mob.templateId], 'loot', 'get').mockReturnValue([
      { itemId: 'sigil_anvil_helmet', chance: 1 },
      { itemId: 'sigil_anvil_legs', chance: 1, rollGroup: 'wb_gear' },
    ]);
    rollWorldBossLoot(sim.ctx, mob, metas);
    const byOwner = (pid: number) =>
      (mob.loot?.items ?? []).filter((s) => s.personalFor?.includes(pid)).map((s) => s.itemId);
    expect(byOwner(a).sort()).toEqual(['sigil_anvil_helmet', 'sigil_anvil_legs']);
    expect(byOwner(b)).toEqual([]);
  });
});

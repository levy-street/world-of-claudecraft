import { describe, expect, it } from 'vitest';
import { RIFT_GEAR_ITEM_IDS } from '../src/sim/content/rift/items';
import { classSpecs } from '../src/sim/content/talents';
import { BUILTIN_WORLD, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { RIFT_BAND_SHELLS } from '../src/sim/rift/band_ladder';
import { RIFT_BAND_SHELL_BY_SPEC, riftBandShellFor } from '../src/sim/rift/band_shell_choice';
import { addRiftProgressionLoot, createRiftGearInstance } from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const MIGHT = 'riftbound_band_of_might';
const INSIGHT = 'riftbound_band_of_insight';
const GUILE = 'riftbound_band_of_guile';

// The intended ring for every live spec, written out literally so a change to
// the table has to change this list too (never derived from the table itself).
const EXPECTED: ReadonlyArray<readonly [PlayerClass, string, string]> = [
  ['warrior', 'arms', MIGHT],
  ['warrior', 'fury', MIGHT],
  ['warrior', 'prot', MIGHT],
  ['paladin', 'holy', INSIGHT],
  ['paladin', 'protection', MIGHT],
  ['paladin', 'retribution', MIGHT],
  ['hunter', 'beast_mastery', GUILE],
  ['hunter', 'marksmanship', GUILE],
  ['hunter', 'survival', GUILE],
  ['rogue', 'assassination', GUILE],
  ['rogue', 'combat', GUILE],
  ['rogue', 'subtlety', GUILE],
  ['priest', 'discipline', INSIGHT],
  ['priest', 'holy', INSIGHT],
  ['priest', 'shadow', INSIGHT],
  ['shaman', 'elemental', INSIGHT],
  ['shaman', 'enhancement', MIGHT],
  ['shaman', 'restoration', INSIGHT],
  ['mage', 'arcane', INSIGHT],
  ['mage', 'fire', INSIGHT],
  ['mage', 'frost', INSIGHT],
  ['warlock', 'affliction', INSIGHT],
  ['warlock', 'demonology', INSIGHT],
  ['warlock', 'destruction', INSIGHT],
  ['druid', 'balance', INSIGHT],
  ['druid', 'feral', MIGHT],
  ['druid', 'restoration', INSIGHT],
];

const EXPECTED_FALLBACK: Readonly<Record<PlayerClass, string>> = {
  warrior: MIGHT,
  paladin: MIGHT,
  hunter: GUILE,
  rogue: GUILE,
  priest: INSIGHT,
  shaman: INSIGHT,
  mage: INSIGHT,
  warlock: INSIGHT,
  druid: INSIGHT,
};

const ALL_CLASSES = Object.keys(CLASSES) as PlayerClass[];

describe('Riftbound band choice by spec', () => {
  it.each(EXPECTED)('%s %s gets %s', (cls, spec, band) => {
    expect(riftBandShellFor(cls, spec)).toBe(band);
    expect(createRiftGearInstance('spec-pin', 'C', cls, 1, 0, [], spec).itemId).toBe(band);
  });

  it('covers every live spec of every class, and nothing else', () => {
    const live = ALL_CLASSES.flatMap((cls) => classSpecs(cls).map((s) => `${cls}:${s}`)).sort();
    const pinned = EXPECTED.map(([cls, spec]) => `${cls}:${spec}`).sort();
    const table = ALL_CLASSES.flatMap((cls) =>
      Object.keys(RIFT_BAND_SHELL_BY_SPEC[cls].specs).map((s) => `${cls}:${s}`),
    ).sort();
    expect(live.length).toBeGreaterThanOrEqual(27);
    expect(pinned).toEqual(live);
    expect(table).toEqual(live);
  });

  it.each(ALL_CLASSES)('%s with no spec or an unknown spec gets its class fallback', (cls) => {
    expect(riftBandShellFor(cls)).toBe(EXPECTED_FALLBACK[cls]);
    expect(riftBandShellFor(cls, null)).toBe(EXPECTED_FALLBACK[cls]);
    expect(riftBandShellFor(cls, 'not_a_spec')).toBe(EXPECTED_FALLBACK[cls]);
    // An inherited Object key is not a spec.
    expect(riftBandShellFor(cls, 'toString')).toBe(EXPECTED_FALLBACK[cls]);
    expect(createRiftGearInstance('fallback-pin', 'C', cls, 1).itemId).toBe(EXPECTED_FALLBACK[cls]);
  });

  it('no druid spec gets the Agility band (druid damage scales with Strength, not Agility)', () => {
    for (const spec of classSpecs('druid')) {
      expect(RIFT_BAND_SHELLS[riftBandShellFor('druid', spec)].primary).not.toBe('agi');
    }
    expect(RIFT_BAND_SHELLS[riftBandShellFor('druid')].primary).not.toBe('agi');
  });

  it('no class reaches all three bands across its specs (the Reliquary personal-page premise)', () => {
    for (const cls of ALL_CLASSES) {
      const reach = new Set([
        riftBandShellFor(cls),
        ...classSpecs(cls).map((s) => riftBandShellFor(cls, s)),
      ]);
      expect(reach.size, cls).toBeLessThan(RIFT_GEAR_ITEM_IDS.length);
    }
  });
});

describe('Riftbound band mint sites read the spec', () => {
  function bossNear(sim: Sim, pid: number) {
    const boss = createMob(sim.nextId++, MOBS.rift_boss_arcane, 23, {
      ...expectDefined(sim.entities.get(pid)).pos,
    });
    boss.dead = true;
    boss.lootable = true;
    boss.loot = { copper: 0, items: [] };
    sim.entities.set(boss.id, boss);
    return boss;
  }

  it('a first clear mints each winner the band of their current spec', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [], npcs: {} },
    });
    const feral = sim.addPlayer('druid', 'Feral');
    const balance = sim.addPlayer('druid', 'Balance');
    const enhance = sim.addPlayer('shaman', 'Enhance');
    const resto = sim.addPlayer('shaman', 'Resto');
    const holy = sim.addPlayer('paladin', 'Holy');
    const specs: Array<[number, string]> = [
      [feral, 'feral'],
      [balance, 'balance'],
      [enhance, 'enhancement'],
      [resto, 'restoration'],
      [holy, 'holy'],
    ];
    for (const [pid, spec] of specs) expectDefined(sim.players.get(pid)).talents.spec = spec;
    const boss = bossNear(sim, feral);
    addRiftProgressionLoot(
      sim.ctx,
      boss,
      'spec-clear',
      'C',
      specs.map(([pid]) => pid),
    );
    const rings = expectDefined(boss.loot).items.filter((s) => s.instance?.rift);
    expect(rings.map((s) => [s.personalFor?.[0], s.itemId])).toEqual([
      [feral, MIGHT],
      [balance, INSIGHT],
      [enhance, MIGHT],
      [resto, INSIGHT],
      [holy, INSIGHT],
    ]);
  });
});

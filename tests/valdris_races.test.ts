// Playable races (Valdris): identity persistence, back-compat defaulting, the
// cosmetic base aspect (scale + tint), and the racial passives contract: one
// small always-on effect per race, folded by recalcPlayerStats (human's is
// rested-XP only so pre-race saves keep byte-identical combat numbers).

import { describe, expect, it } from 'vitest';
import {
  FACTION_LIST,
  factionOfRace,
  isPlayerRace,
  RACE_LIST,
  RACES,
  racesOfFaction,
} from '../src/sim/content/races';
import { Sim } from '../src/sim/sim';
import type { PlayerRace } from '../src/sim/types';

const makeSim = () =>
  new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Probe', autoEquip: true });

describe('race registry', () => {
  it('defines exactly twelve races, four per faction', () => {
    expect(RACE_LIST).toHaveLength(12);
    expect(new Set(RACE_LIST).size).toBe(12);
    for (const faction of FACTION_LIST) {
      expect(racesOfFaction(faction)).toHaveLength(4);
    }
  });

  it('derives faction from race', () => {
    expect(factionOfRace('human')).toBe('kael');
    expect(factionOfRace('elf_exile')).toBe('kael');
    expect(factionOfRace('elf')).toBe('veth');
    expect(factionOfRace('shadow_walker')).toBe('veth');
    expect(factionOfRace('stone_warden')).toBe('ossara');
  });

  it('validates race ids strictly', () => {
    expect(isPlayerRace('dwarf')).toBe(true);
    expect(isPlayerRace('orc')).toBe(false);
    expect(isPlayerRace('')).toBe(false);
    expect(isPlayerRace(42)).toBe(false);
    expect(isPlayerRace(undefined)).toBe(false);
  });

  it('every race has a base aspect (scale + tint) and exactly one distinct racial effect', () => {
    for (const race of RACE_LIST) {
      const def = RACES[race];
      expect(Object.keys(def).sort()).toEqual(['faction', 'id', 'racial', 'scale', 'tint']);
      expect(def.scale).toBeGreaterThan(0.5);
      expect(def.scale).toBeLessThan(1.5);
      expect(def.tint).toBeGreaterThan(0);
      expect(def.tint).toBeLessThanOrEqual(0xffffff);
      expect(Object.keys(def.racial)).toHaveLength(1);
    }
    // no two races share an effect kind: twelve races, twelve distinct passives
    const kinds = RACE_LIST.map((r) => Object.keys(RACES[r].racial)[0]);
    expect(new Set(kinds).size).toBe(RACE_LIST.length);
  });
});

describe('race persistence and back-compat', () => {
  it('a new character created with a race keeps it through serialize/load', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('mage', 'Sable', { race: 'dark_fae' });
    expect(sim.meta(pid)!.race).toBe('dark_fae');
    expect(sim.entities.get(pid)!.race).toBe('dark_fae');

    const state = sim.serializeCharacter(pid)!;
    expect(state.race).toBe('dark_fae');

    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('mage', 'Sable', { state });
    expect(sim2.meta(pid2)!.race).toBe('dark_fae');
    expect(sim2.entities.get(pid2)!.race).toBe('dark_fae');
  });

  it('a pre-race save loads as Human (Kael) without touching its position', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Old');
    const state = sim.serializeCharacter(pid)!;
    delete (state as { race?: PlayerRace }).race; // simulate a pre-race JSONB blob
    state.pos = { x: 5, z: 300 }; // an island (Landing) position

    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Old', { state });
    const meta = sim2.meta(pid2)!;
    expect(meta.race).toBe('human');
    expect(factionOfRace(meta.race)).toBe('kael');
    const e = sim2.entities.get(pid2)!;
    expect(e.pos.z).toBeCloseTo(300, 0);
  });

  it('junk race values from a tampered payload fall back to Human', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('rogue', 'Tamper');
    const state = sim.serializeCharacter(pid)!;
    (state as { race?: string }).race = 'dragon_god';

    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('rogue', 'Tamper', { state: state });
    expect(sim2.meta(pid2)!.race).toBe('human');
  });

  it('a saved race wins over a creation-time race option', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('priest', 'Kept', { race: 'nomad' });
    const state = sim.serializeCharacter(pid)!;

    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('priest', 'Kept', { state, race: 'gnome' });
    expect(sim2.meta(pid2)!.race).toBe('nomad');
  });

  it('setPlayerRace validates and mirrors onto the entity', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('shaman', 'Setter');
    expect(sim.setPlayerRace(pid, 'frost_kin')).toBe(true);
    expect(sim.meta(pid)!.race).toBe('frost_kin');
    expect(sim.entities.get(pid)!.race).toBe('frost_kin');
    expect(sim.setPlayerRace(pid, 'not_a_race' as PlayerRace)).toBe(false);
    expect(sim.meta(pid)!.race).toBe('frost_kin');
  });
});

describe('racial passives', () => {
  // Human is the reference body: its racial is rested-XP only, so a human's
  // combat stats are exactly the class/level/gear baseline.
  const pair = (cls: Parameters<Sim['addPlayer']>[0], race: PlayerRace) => {
    const sim = makeSim();
    const h = sim.entities.get(sim.addPlayer(cls, 'Ref', { race: 'human' }))!;
    const r = sim.entities.get(sim.addPlayer(cls, 'Raced', { race }))!;
    return { h, r };
  };

  it('human keeps the pre-race combat baseline (cosmetic scale 1, rested-only racial)', () => {
    expect(Object.keys(RACES.human.racial)).toEqual(['restedRatePct']);
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Legacy');
    const e = sim.entities.get(pid)!;
    expect(sim.meta(pid)!.race).toBe('human');
    expect(e.scale).toBe(1);
  });

  it('primary-attribute racials multiply the summed attribute', () => {
    const { h: hm, r: gn } = pair('mage', 'gnome');
    expect(gn.stats.int).toBe(Math.round(hm.stats.int * 1.05));
    const { h: hr, r: sw } = pair('rogue', 'shadow_walker');
    expect(sw.stats.agi).toBe(Math.round(hr.stats.agi * 1.03));
    const { h: hw, r: qw } = pair('warrior', 'stone_warden');
    expect(qw.stats.str).toBe(Math.round(hw.stats.str * 1.03));
    expect(qw.attackPower).toBeGreaterThan(hw.attackPower); // str feeds warrior AP
    const { h: hp, r: fk } = pair('priest', 'frost_kin');
    expect(fk.stats.sta).toBe(Math.round(hp.stats.sta * 1.03));
    // sta feeds hp, though at level 1 the 3% can round away entirely
    expect(fk.maxHp).toBeGreaterThanOrEqual(hp.maxHp);
    const { h: hs, r: nm } = pair('shaman', 'nomad');
    expect(nm.stats.spi).toBe(Math.round(hs.stats.spi * 1.05));
  });

  it('derived-stat racials fold at their own steps', () => {
    const { h: hw, r: dw } = pair('warrior', 'dwarf');
    expect(dw.stats.armor).toBe(Math.round(hw.stats.armor * 1.05));
    const { h: he, r: el } = pair('hunter', 'elf');
    expect(el.dodgeChance).toBeCloseTo(he.dodgeChance + 0.01, 10);
    const { h: hf, r: df } = pair('warlock', 'dark_fae');
    expect(df.critChance).toBeCloseTo(hf.critChance + 0.01, 10);
    const { h: hx, r: ee } = pair('mage', 'elf_exile');
    expect(ee.castPushbackReduction).toBeCloseTo(hx.castPushbackReduction + 0.2, 10);
    const { h: hd, r: dc } = pair('paladin', 'desert_clan');
    expect(dc.maxHp).toBe(Math.round(hd.maxHp * 1.03));
    const { h: hg, r: sm } = pair('mage', 'sand_mage');
    expect(sm.spellPower).toBe(Math.round(hg.spellPower * 1.05));
  });

  it('setPlayerRace applies the racial immediately', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('mage', 'Switch', { race: 'human' });
    const before = sim.entities.get(pid)!.stats.int;
    sim.setPlayerRace(pid, 'gnome');
    expect(sim.entities.get(pid)!.stats.int).toBe(Math.round(before * 1.05));
    expect(sim.entities.get(pid)!.scale).toBeCloseTo(RACES.gnome.scale, 5);
  });

  it('humans accrue rested XP 25% faster at an inn', () => {
    const sim = makeSim();
    const human = sim.addPlayer('warrior', 'Innkeep', { race: 'human' });
    const elf = sim.addPlayer('warrior', 'Wanderer', { race: 'elf' });
    // park both inside the Eastbrook inn footprint (zone1 PROPS)
    for (const pid of [human, elf]) {
      const e = sim.entities.get(pid)!;
      e.pos.x = 12;
      e.pos.z = -6;
    }
    for (let i = 0; i < 200; i++) sim.tick();
    const restedHuman = sim.meta(human)!.restedXp;
    const restedElf = sim.meta(elf)!.restedXp;
    expect(restedElf).toBeGreaterThan(0);
    expect(restedHuman / restedElf).toBeCloseTo(1.25, 3);
  });

  it('the cosmetic body scale still tracks the race', () => {
    const sim = makeSim();
    const a = sim.entities.get(sim.addPlayer('warrior', 'Tiny', { race: 'gnome' }))!;
    const b = sim.entities.get(sim.addPlayer('warrior', 'Huge', { race: 'stone_warden' }))!;
    expect(a.scale).toBeCloseTo(RACES.gnome.scale, 5);
    expect(b.scale).toBeCloseTo(RACES.stone_warden.scale, 5);
  });
});

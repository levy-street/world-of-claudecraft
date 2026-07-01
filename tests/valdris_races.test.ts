// Playable races (Valdris): identity persistence, back-compat defaulting, and
// the gameplay-neutrality contract (races carry a cosmetic scale, never stats).

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

  it('races are identity only: no stats, no abilities, just a cosmetic scale', () => {
    for (const race of RACE_LIST) {
      const def = RACES[race];
      expect(Object.keys(def).sort()).toEqual(['faction', 'id', 'scale']);
      expect(def.scale).toBeGreaterThan(0.5);
      expect(def.scale).toBeLessThan(1.5);
    }
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

describe('race gameplay neutrality', () => {
  it('two same-class characters of different races have identical combat stats', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Tiny', { race: 'gnome' });
    const b = sim.addPlayer('warrior', 'Huge', { race: 'stone_warden' });
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect(ea.stats).toEqual(eb.stats);
    expect(ea.maxHp).toBe(eb.maxHp);
    expect(ea.attackPower).toBe(eb.attackPower);
    expect(ea.moveSpeed).toBe(eb.moveSpeed);
    // the ONLY divergence is the cosmetic body scale
    expect(ea.scale).toBeCloseTo(RACES.gnome.scale, 5);
    expect(eb.scale).toBeCloseTo(RACES.stone_warden.scale, 5);
  });
});

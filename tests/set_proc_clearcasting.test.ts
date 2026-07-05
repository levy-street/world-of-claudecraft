import { describe, expect, it } from 'vitest';
import { recalcPlayerStats } from '../src/sim/entity';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SetProc } from '../src/sim/types';

type ProcInternals = {
  players: Map<number, PlayerMeta>;
  applySetProcs(source: Entity, target: Entity | null, trigger: SetProc['trigger']): void;
  time: number;
};

const mournweaveEquipment = {
  chest: 'necromancers_starshroud',
  feet: 'necromancers_soulsteps',
  legs: 'necromancers_legwraps',
  shoulder: 'necromancers_soulspire_mantle',
};

function equipMournweave(sim: Sim): Entity {
  const internals = sim as unknown as ProcInternals;
  const p = sim.player;
  const meta = internals.players.get(p.id);
  if (!meta) throw new Error('missing player meta');
  p.level = 20;
  Object.assign(meta.equipment, mournweaveEquipment);
  recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
  return p;
}

describe('Clearcasting set proc', () => {
  it('resolves from the 4-piece Mournweave caster set', () => {
    const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: false });
    const p = equipMournweave(sim);

    expect(p.setProcs).toContainEqual({
      id: 'set_clearcasting',
      name: 'Clearcasting',
      trigger: 'spellCast',
      chance: 0.1,
      aura: 'next_cast_free',
      duration: 12,
      icd: 4,
    });
  });

  it('draws no rng and grants no aura when the player has no set procs', () => {
    const sim = new Sim({ seed: 12, playerClass: 'mage', autoEquip: false });
    const internals = sim as unknown as ProcInternals;
    const p = sim.player;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });

    internals.applySetProcs(p, null, 'spellCast');
    sim.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
  });

  it('eventually grants Clearcasting and blocks another proc during the ICD', () => {
    const sim = new Sim({ seed: 13, playerClass: 'mage', autoEquip: false });
    const internals = sim as unknown as ProcInternals;
    const p = equipMournweave(sim);

    for (let i = 0; i < 500 && !p.auras.some((a) => a.kind === 'next_cast_free'); i++) {
      internals.applySetProcs(p, null, 'spellCast');
    }

    expect(p.auras.some((a) => a.id === 'set_clearcasting' && a.kind === 'next_cast_free')).toBe(
      true,
    );
    expect(p.procReadyAt.set_clearcasting).toBe(internals.time + 4);

    p.auras = p.auras.filter((a) => a.id !== 'set_clearcasting');
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });

    internals.applySetProcs(p, null, 'spellCast');
    sim.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(p.auras.some((a) => a.id === 'set_clearcasting')).toBe(false);
  });
});

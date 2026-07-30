import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function joinParty(sim: Sim, leaderId: number, memberId: number): void {
  sim.partyInvite(memberId, leaderId);
  sim.partyAccept(memberId);
}

describe('Mass Barrier specialization theme', () => {
  for (const [spec, personalBarrierId, personalBarrierCooldown] of [
    ['arcane', 'temporal_barrier', 12],
    ['fire', 'blazing_barrier', 30],
    ['frost', 'ice_barrier', 30],
  ] as const) {
    it(`also starts ${personalBarrierId}'s cooldown for a ${spec} caster`, () => {
      const sim = new Sim({ seed: 86, playerClass: 'mage', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec, rows: { 17: 'mag_r17_mass_barrier' } })).toBe(true);

      sim.castAbility('mass_barrier');

      expect(sim.player.cooldowns.get(personalBarrierId)).toBe(personalBarrierCooldown);
    });
  }

  for (const [spec, school] of [
    ['arcane', 'arcane'],
    ['fire', 'fire'],
    ['frost', 'frost'],
  ] as const) {
    it(`stores the ${school} visual school for a ${spec} caster`, () => {
      const sim = new Sim({ seed: 87, playerClass: 'mage', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec, rows: { 17: 'mag_r17_mass_barrier' } })).toBe(true);
      const player = sim.player;
      const allyId = sim.addPlayer('warrior', `Ally${spec}`);
      const ally = sim.entities.get(allyId)!;
      ally.pos = { ...player.pos };
      ally.prevPos = { ...player.pos };
      player.resource = player.maxResource;
      joinParty(sim, player.id, ally.id);

      sim.castAbility('mass_barrier');
      sim.tick();

      const barrier = player.auras.find((a) => a.id === 'mass_barrier');
      const allyBarrier = ally.auras.find((a) => a.id === 'mass_barrier');
      expect(barrier?.school).toBe(school);
      expect(allyBarrier?.school).toBe(school);
    });
  }

  it('shields nearby group members but never unrelated friendly players', () => {
    const sim = new Sim({ seed: 89, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'frost', rows: { 17: 'mag_r17_mass_barrier' } })).toBe(true);
    const caster = sim.player;
    const memberId = sim.addPlayer('warrior', 'Grouped');
    const outsiderId = sim.addPlayer('warrior', 'Outsider');
    const member = sim.entities.get(memberId)!;
    const outsider = sim.entities.get(outsiderId)!;
    for (const ally of [member, outsider]) {
      ally.pos = { ...caster.pos };
      ally.prevPos = { ...caster.pos };
    }
    joinParty(sim, caster.id, member.id);

    sim.castAbility('mass_barrier');
    sim.tick();

    expect(caster.auras.some((aura) => aura.id === 'mass_barrier')).toBe(true);
    expect(member.auras.some((aura) => aura.id === 'mass_barrier')).toBe(true);
    expect(outsider.auras.some((aura) => aura.id === 'mass_barrier')).toBe(false);
  });

  it('always includes a higher-id caster when five allies are co-located', () => {
    const sim = new Sim({ seed: 88, playerClass: 'warrior', autoEquip: true });
    const lowerIdAllies = [sim.player];
    for (let i = 0; i < 4; i++) {
      const allyId = sim.addPlayer('warrior', `Tie${i}`);
      lowerIdAllies.push(sim.entities.get(allyId)!);
    }
    const casterId = sim.addPlayer('mage', 'TieMage');
    const caster = sim.entities.get(casterId)!;
    sim.setPlayerLevel(20, casterId);
    expect(
      sim.applyTalents({ spec: 'arcane', rows: { 17: 'mag_r17_mass_barrier' } }, casterId),
    ).toBe(true);
    for (const ally of lowerIdAllies) {
      ally.pos = { ...caster.pos };
      ally.prevPos = { ...caster.pos };
    }
    for (const ally of lowerIdAllies.slice(0, 4)) joinParty(sim, caster.id, ally.id);
    sim.convertPartyToRaid(caster.id);
    joinParty(sim, caster.id, lowerIdAllies[4].id);
    expect(sim.partyOf(caster.id)?.raid).toBe(true);
    caster.resource = caster.maxResource;

    sim.castAbility('mass_barrier', casterId);
    sim.tick();

    const shielded = [...sim.entities.values()].filter((entity) =>
      entity.auras.some((aura) => aura.id === 'mass_barrier'),
    );
    expect(caster.auras.some((aura) => aura.id === 'mass_barrier')).toBe(true);
    expect(shielded).toHaveLength(5);
  });
});

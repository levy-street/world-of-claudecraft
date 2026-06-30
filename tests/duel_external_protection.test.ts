// A duel is a closed 1v1: once it is live, outside parties cannot pour in heals,
// shields, or buffs to prop up either combatant. Self-sustain still works, and the
// protection is duel-scoped (a non-duelist can still be healed/buffed normally).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Start an accepted, live duel between two priests, plus an external priest (Cee) and
// a bystander priest (Dee) to act as a control target.
function setup() {
  const sim = makeWorld();
  const a = sim.addPlayer('priest', 'Aleph', { autoEquip: true });
  const b = sim.addPlayer('priest', 'Bet', { autoEquip: true });
  const c = sim.addPlayer('priest', 'Cee', { autoEquip: true });
  const d = sim.addPlayer('priest', 'Dee', { autoEquip: true });
  teleport(sim, a, 0, -40);
  teleport(sim, b, 4, -40);
  teleport(sim, c, 2, -42);
  teleport(sim, d, 2, -46);
  for (const pid of [a, b, c, d]) {
    const e = sim.entities.get(pid)!;
    e.resource = e.maxResource; // full mana so instant buffs always pay
  }
  sim.duelRequest(b, a);
  sim.duelAccept(b);
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick();
    if ((sim as any).duels.get(a)?.state === 'active') break;
  }
  return { sim, a, b, c, d };
}

function cast(sim: Sim, casterPid: number, abilityId: string, targetPid: number) {
  sim.entities.get(casterPid)!.targetId = targetPid; // heals/buffs hit the friendly target
  sim.entities.get(casterPid)!.resource = sim.entities.get(casterPid)!.maxResource;
  sim.castAbility(abilityId, casterPid);
  sim.tick();
}

function hasAuraFrom(sim: Sim, pid: number, kind: string, sourceId: number): boolean {
  return sim.entities.get(pid)!.auras.some((au) => au.kind === kind && au.sourceId === sourceId);
}

describe('duel: external parties cannot heal or buff the duelists', () => {
  it('blocks an outside buff (Fortitude) and shield (Power Word: Shield) on a duelist', () => {
    const { sim, a, c } = setup();
    expect((sim as any).duels.get(a)?.state).toBe('active');

    cast(sim, c, 'power_word_fortitude', a);
    expect(hasAuraFrom(sim, a, 'buff_sta', c)).toBe(false);

    cast(sim, c, 'power_word_shield', a);
    expect(hasAuraFrom(sim, a, 'absorb', c)).toBe(false);
  });

  it('blocks an outside heal-over-time (Renew) on a duelist', () => {
    const { sim, a, c } = setup();
    cast(sim, c, 'renew', a);
    expect(hasAuraFrom(sim, a, 'hot', c)).toBe(false);
  });

  it('still lets a duelist sustain themselves (self-buff is not external)', () => {
    const { sim, a } = setup();
    cast(sim, a, 'power_word_fortitude', a);
    expect(hasAuraFrom(sim, a, 'buff_sta', a)).toBe(true);
  });

  it('is duel-scoped: the same buff lands fine on a non-duelist bystander', () => {
    const { sim, c, d } = setup();
    cast(sim, c, 'power_word_fortitude', d);
    expect(hasAuraFrom(sim, d, 'buff_sta', c)).toBe(true);
  });
});

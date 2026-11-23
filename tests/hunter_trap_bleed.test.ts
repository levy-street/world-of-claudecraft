import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { abilityScalingOf } from '../src/ui/ability_damage';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';

interface TrapFixture {
  addEntity(entity: Entity): void;
  nextId: number;
  ctx: { groundAoEs: GroundAoE[] };
}

function hunter(): Sim & TrapFixture {
  const sim = new Sim({ seed: 4501, playerClass: 'hunter' }) as Sim & TrapFixture;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  return sim;
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...sim.tick());
  return events;
}

describe('hunter trap tooltip combat accuracy', () => {
  it.each([
    [0, 85],
    [100, 105],
  ])('shows the complete rounded bleed at %i Ranged Attack Power', (rap, expected) => {
    const sim = hunter();
    sim.player.rangedPower = rap;
    const resolved = sim.resolvedAbility('bear_trap');
    if (!resolved) throw new Error('Bear Trap must be known');
    const aim = { x: sim.player.pos.x, z: sim.player.pos.z + 10 };
    sim.castAbility('bear_trap', sim.playerId, aim);
    advance(sim, 1);
    const victim = createMob(
      sim.nextId++,
      MOBS.training_dummy,
      20,
      sim.groundPos(aim.x, aim.z + 4),
    );
    victim.hostile = true;
    victim.maxHp = 1_000_000;
    victim.hp = victim.maxHp;
    sim.addEntity(victim);
    victim.prevPos = { ...victim.pos };
    victim.pos = sim.groundPos(aim.x, aim.z);
    sim.tick();
    const bleed = victim.auras.find((aura) => aura.id === 'bear_trap_bleed');
    expect(bleed?.value).toBe(expected / 5);
    expect(bleed?.tickInterval).toBe(3);
    const events = advance(sim, 15.1);
    const damage = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.targetId === victim.id && event.ability === 'Bear Trap',
    );
    expect(damage).toHaveLength(5);
    const actual = damage.reduce((sum, event) => sum + event.amount, 0);
    expect(actual).toBe(expected);
    const scaling = abilityScalingOf(sim.player);
    const displayed = abilityEffectText(resolved, scaling);
    expect(displayed).toBe(String(actual));
    expect(abilityDisplayDescription(resolved, displayed, scaling)).toContain(
      `bleeds for ${actual} Physical damage over 15 sec`,
    );
  });

  it('replaces only the previous Bear Trap and describes its independent limit', () => {
    const sim = hunter();
    const aim = (dz: number) => ({ x: sim.player.pos.x, z: sim.player.pos.z + dz });
    sim.castAbility('bear_trap', sim.playerId, aim(10));
    advance(sim, 2);
    sim.castAbility('frostjaw_trap', sim.playerId, aim(20));
    advance(sim, 2);
    sim.player.cooldowns.delete('bear_trap');
    sim.castAbility('bear_trap', sim.playerId, aim(25));
    const traps = sim.ctx.groundAoEs.filter((zone) => zone.hunterTrap);
    expect(traps.map((trap) => [trap.abilityId, trap.pos.z - sim.player.pos.z]).sort()).toEqual([
      ['bear_trap', 25],
      ['frostjaw_trap', 20],
    ]);
    const resolved = sim.resolvedAbility('bear_trap');
    if (!resolved) throw new Error('Bear Trap must be known');
    const scaling = abilityScalingOf(sim.player);
    const description = abilityDisplayDescription(
      resolved,
      abilityEffectText(resolved, scaling),
      scaling,
    );
    expect(description).toContain('Only one Bear Trap can be active at a time.');
    expect(description).toContain('Placing another replaces it.');
    expect(description).toContain('It can coexist with your Frostjaw Trap.');
  });

  it('describes Scatterbolt as a guarded displacement without damage', () => {
    const sim = hunter();
    const resolved = sim.resolvedAbility('scatterbolt');
    if (!resolved) throw new Error('Scatterbolt must be known');
    const description = abilityDisplayDescription(resolved, '');
    expect(description).toContain('8-yard cone');
    expect(description).toContain('up to 20 yards from you');
    expect(description).toContain('Knockback-immune enemies are unaffected.');
    expect(description).toContain('Deals no damage.');
  });
});

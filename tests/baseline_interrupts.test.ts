// Baseline class interrupts: every caster-pressuring class trains a short spell-kick
// (pummel/kick/counterspell/counter_shot/rebuke/skull_bash/spell_lock) as core kit at
// level 10. Each stops the target's cast and locks that spell school for a few seconds.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const INTERRUPTS: Record<string, string> = {
  warrior: 'pummel',
  rogue: 'kick',
  mage: 'counterspell',
  hunter: 'counter_shot',
  paladin: 'rebuke',
  druid: 'skull_bash',
  warlock: 'spell_lock',
};

describe('baseline class interrupts', () => {
  it('every caster-pressuring class learns its interrupt at level 10 as baseline kit', () => {
    for (const [cls, id] of Object.entries(INTERRUPTS)) {
      const known = abilitiesKnownAt(cls as never, 10).find((a) => a.def.id === id);
      expect(known, `${cls} should know ${id} at level 10`).toBeTruthy();
      expect(known?.effects.some((e) => e.type === 'interrupt')).toBe(true);
      // Learned outright (baseline), not gated behind a talent choice.
      expect(known?.def.class).toBe(cls);
    }
  });

  it('an interrupt cancels a hostile cast and locks that spell school', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    // A hostile mob mid-cast of a non-physical (interruptible) spell.
    const mob = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.ridge_stalker, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 2,
    });
    mob.hostile = true;
    mob.castingAbility = 'fireball'; // arcane/fire school -> interruptible
    mob.castRemaining = 2;
    mob.castTotal = 2;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);

    const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
    const res = (
      sim as unknown as { resolvedAbility(id: string, pid: number): unknown }
    ).resolvedAbility('pummel', sim.playerId);
    (
      sim as unknown as {
        ctx: { runEffects(p: Entity, meta: unknown, target: Entity, res: unknown): void };
      }
    ).ctx.runEffects(p, meta, mob, res);

    // The cast is cancelled and a school lockout aura is applied.
    expect(mob.castingAbility).toBeNull();
    expect(mob.auras.some((a) => a.kind === 'lockout')).toBe(true);
  });
});

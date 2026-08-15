// Baseline class interrupts: every caster-pressuring class trains a short spell-kick
// (pummel/kick/counterspell/counter_shot/skull_bash/spell_lock) as core kit at level
// 10, plus the paladin's spec-gated Hushbrand below. Each stops the target's cast and
// locks that spell school for a few seconds.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const INTERRUPTS: Record<string, string> = {
  warrior: 'pummel',
  rogue: 'kick',
  mage: 'counterspell',
  hunter: 'counter_shot',
  druid: 'skull_bash',
  warlock: 'spell_lock',
};

// The paladin is the exception: its overhauled kit retired Reproach (see
// PALADIN_LEGACY_ABILITY_IDS) and gave the kick to Hushbrand, which the two melee
// specs train at 10 while Sunmender, the healer, goes without one. Same level and
// same lockout as every other class, but earned by specializing rather than
// handed to the bare class.
const PALADIN_INTERRUPT = 'hushbrand';
const PALADIN_INTERRUPT_SPECS = ['protection', 'retribution'] as const;

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

  it('gives the paladin its interrupt at 10 on the two melee specs, not to Holy', () => {
    const def = ABILITIES[PALADIN_INTERRUPT];
    expect(def, `${PALADIN_INTERRUPT} must exist`).toBeTruthy();
    expect(def.class).toBe('paladin');
    expect(def.learnLevel).toBe(10);
    expect(def.effects.some((e) => e.type === 'interrupt')).toBe(true);
    expect([...(def.specs ?? [])].sort()).toEqual([...PALADIN_INTERRUPT_SPECS].sort());

    // Retired, so the bare class no longer trains the old one.
    expect(abilitiesKnownAt('paladin', 20).some((a) => a.def.id === 'rebuke')).toBe(false);
  });

  it.each(['affliction', 'demonology', 'destruction'])(
    'keeps the Warlock interrupt in the %s specialization',
    (spec) => {
      const mods = computeTalentModifiers('warlock', { spec, rows: {} }, 20);
      const known = abilitiesKnownAt('warlock', 20, mods).find(
        (ability) => ability.def.id === 'spell_lock',
      );

      expect(known, `${spec} should know spell_lock`).toBeTruthy();
    },
  );

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

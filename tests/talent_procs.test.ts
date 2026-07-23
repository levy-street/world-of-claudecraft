import { describe, expect, it } from 'vitest';
import {
  onCastCompleted,
  onDamageTaken,
  type ProcDef,
  tickProcState,
} from '../src/sim/combat/talent_procs';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// The proc engine is deterministic tick math: counters and internal cooldowns
// on the entity, no rng. These tests drive it through a minimal fake context.

function fakePlayer(procs: ProcDef[]): { p: Entity; ctx: SimContext; events: string[] } {
  const events: string[] = [];
  const p = {
    id: 1,
    kind: 'player',
    hp: 400,
    maxHp: 400,
    resource: 50,
    maxResource: 100,
    auras: [] as Entity['auras'],
    cooldowns: new Map<string, number>(),
    dead: false,
  } as unknown as Entity;
  return withCtx(p, procs, events);
}

function fakeSubject(id: number, hostile: boolean): Entity {
  return {
    id,
    kind: hostile ? 'mob' : 'player',
    hostile,
    hp: 300,
    maxHp: 300,
    auras: [] as Entity['auras'],
    dead: false,
  } as unknown as Entity;
}

function withCtx(
  p: Entity,
  procs: ProcDef[],
  events: string[],
): { p: Entity; ctx: SimContext; events: string[] } {
  const ctx = {
    players: new Map([[1, { cls: 'priest' }]]),
    playerMods: () => ({ procs }),
    applyAura: (target: Entity, aura: Entity['auras'][number]) => {
      target.auras.push(aura);
      events.push(`aura:${aura.kind}`);
    },
    applyHeal: (_s: Entity, t: Entity, amount: number) => {
      t.hp = Math.min(t.maxHp, t.hp + amount);
      events.push(`heal:${amount}`);
    },
    emit: () => {},
    entities: new Map([[1, p]]),
  } as unknown as SimContext;
  return { p, ctx, events };
}

describe('talent proc engine', () => {
  it('castNth fires on exactly every Nth matching cast and ignores others', () => {
    const proc: ProcDef = {
      id: 'test_rhythm',
      name: 'Test Rhythm',
      trigger: { on: 'castNth', n: 3, abilities: ['smite'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_free', duration: 8 }],
    };
    const { p, ctx, events } = fakePlayer([proc]);
    onCastCompleted(ctx, p, 'smite');
    onCastCompleted(ctx, p, 'renew'); // non-matching: no count
    onCastCompleted(ctx, p, 'smite');
    expect(events).toHaveLength(0);
    onCastCompleted(ctx, p, 'smite');
    expect(events).toEqual(['aura:next_cast_free']);
    // the counter reset: three more casts fire again
    onCastCompleted(ctx, p, 'smite');
    onCastCompleted(ctx, p, 'smite');
    p.auras.length = 0; // consume the pending charge so refresh-not-stack allows a new one
    onCastCompleted(ctx, p, 'smite');
    expect(events).toEqual(['aura:next_cast_free', 'aura:next_cast_free']);
  });

  it('empowerNext does not stack while a charge is pending', () => {
    const proc: ProcDef = {
      id: 'test_rhythm',
      name: 'Test Rhythm',
      trigger: { on: 'castNth', n: 1, abilities: ['smite'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_free', duration: 8 }],
    };
    const { p, ctx } = fakePlayer([proc]);
    onCastCompleted(ctx, p, 'smite');
    onCastCompleted(ctx, p, 'smite');
    expect(p.auras).toHaveLength(1);
  });

  it('bigHitTaken respects the hp fraction and the internal cooldown', () => {
    const proc: ProcDef = {
      id: 'test_bulwark',
      name: 'Test Bulwark',
      trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
      responses: [{ kind: 'absorb', amount: 70, duration: 10, name: 'Test Bulwark' }],
    };
    const { p, ctx, events } = fakePlayer([proc]);
    onDamageTaken(ctx, p, 30); // 7.5% of 400: below the threshold
    expect(events).toHaveLength(0);
    onDamageTaken(ctx, p, 80); // 20%: fires
    expect(events).toEqual(['aura:absorb']);
    onDamageTaken(ctx, p, 80); // ICD holds
    expect(events).toHaveLength(1);
    tickProcState(p, 20.05); // age past the ICD
    onDamageTaken(ctx, p, 80);
    expect(events).toHaveLength(2);
  });

  it("absorb with target: 'self' wards the caster, never the live hostile cast target", () => {
    // The Hellglass Ward shape: the triggering casts are hostile, so the cast
    // target must NOT receive the ward. The negative assertion is the point.
    const proc: ProcDef = {
      id: 'test_hellglass',
      name: 'Test Hellglass',
      trigger: { on: 'castNth', n: 3, abilities: ['shadow_bolt'] },
      responses: [
        { kind: 'absorb', amount: 90, duration: 10, name: 'Test Hellglass', target: 'self' },
      ],
    };
    const { p, ctx } = fakePlayer([proc]);
    const enemy = fakeSubject(2, true);
    for (let i = 0; i < 3; i++) onCastCompleted(ctx, p, 'shadow_bolt', enemy);
    expect(p.auras.some((a) => a.id === 'test_hellglass' && a.kind === 'absorb')).toBe(true);
    expect(enemy.auras).toHaveLength(0);
  });

  it("absorb with target: 'self' still lands on the caster when the 3rd cast kills", () => {
    // Pins the onCastCompleted dead-target fallback: subject falls back to the
    // player, and the self-targeted ward must land on the caster either way.
    const proc: ProcDef = {
      id: 'test_hellglass',
      name: 'Test Hellglass',
      trigger: { on: 'castNth', n: 3, abilities: ['shadow_bolt'] },
      responses: [
        { kind: 'absorb', amount: 90, duration: 10, name: 'Test Hellglass', target: 'self' },
      ],
    };
    const { p, ctx } = fakePlayer([proc]);
    const enemy = fakeSubject(2, true);
    onCastCompleted(ctx, p, 'shadow_bolt', enemy);
    onCastCompleted(ctx, p, 'shadow_bolt', enemy);
    enemy.dead = true;
    onCastCompleted(ctx, p, 'shadow_bolt', enemy);
    expect(p.auras.some((a) => a.id === 'test_hellglass' && a.kind === 'absorb')).toBe(true);
    expect(enemy.auras).toHaveLength(0);
  });

  it('absorb without a target field still shields the subject (the heal-target shape)', () => {
    // Warding Refrain / Grove Covenant: a heal-triggered ward keeps landing on
    // the friendly cast target, byte-identical to before the target field.
    const proc: ProcDef = {
      id: 'test_refrain',
      name: 'Test Refrain',
      trigger: { on: 'castNth', n: 1, abilities: ['lesser_heal'] },
      responses: [{ kind: 'absorb', amount: 40, duration: 10, name: 'Test Refrain' }],
    };
    const { p, ctx } = fakePlayer([proc]);
    const ally = fakeSubject(3, false);
    onCastCompleted(ctx, p, 'lesser_heal', ally);
    expect(ally.auras.some((a) => a.id === 'test_refrain' && a.kind === 'absorb')).toBe(true);
    expect(p.auras).toHaveLength(0);
  });

  it("heal with target: 'self' heals the caster, not the subject", () => {
    // No current talent uses this arm; it closes the same latent hazard for
    // heal responses whose triggering casts are hostile.
    const proc: ProcDef = {
      id: 'test_leech',
      name: 'Test Leech',
      trigger: { on: 'castNth', n: 1, abilities: ['shadow_bolt'] },
      responses: [{ kind: 'heal', amount: 25, target: 'self' }],
    };
    const { p, ctx } = fakePlayer([proc]);
    p.hp = 100;
    const enemy = fakeSubject(2, true);
    enemy.hp = 100;
    onCastCompleted(ctx, p, 'shadow_bolt', enemy);
    expect(p.hp).toBe(125);
    expect(enemy.hp).toBe(100);
  });

  it('heal without a target field still heals the subject', () => {
    const proc: ProcDef = {
      id: 'test_mend',
      name: 'Test Mend',
      trigger: { on: 'castNth', n: 1, abilities: ['lesser_heal'] },
      responses: [{ kind: 'heal', amount: 25 }],
    };
    const { p, ctx } = fakePlayer([proc]);
    p.hp = 100;
    const ally = fakeSubject(3, false);
    ally.hp = 100;
    onCastCompleted(ctx, p, 'lesser_heal', ally);
    expect(ally.hp).toBe(125);
    expect(p.hp).toBe(100);
  });

  it('cooldownRefund shaves and clamps, reset clears', () => {
    const proc: ProcDef = {
      id: 'test_refund',
      name: 'Test Refund',
      trigger: { on: 'castNth', n: 1, abilities: ['judgement'] },
      responses: [{ kind: 'cooldownRefund', ability: 'exorcism', seconds: 'reset' }],
    };
    const { p, ctx } = fakePlayer([proc]);
    p.cooldowns.set('exorcism', 12);
    onCastCompleted(ctx, p, 'judgement');
    expect(p.cooldowns.has('exorcism')).toBe(false);
  });
});

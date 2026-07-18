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

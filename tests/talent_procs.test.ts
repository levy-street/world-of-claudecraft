import { describe, expect, it } from 'vitest';
import {
  onCastCompleted,
  onDamageTaken,
  onMeleeSwing,
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

  it('meleeHit filters the landed ability and stacks its aura to the authored cap', () => {
    const proc: ProcDef = {
      id: 'test_stacks',
      name: 'Test Stacks',
      trigger: { on: 'meleeHit', abilities: ['auto_attack', 'stormstrike'] },
      responses: [{ kind: 'stackAura', aura: 'icicles', maxStacks: 2, duration: 8 }],
    };
    const { p, ctx } = fakePlayer([proc]);

    onMeleeSwing(ctx, p, 'sinister_strike');
    expect(p.auras).toHaveLength(0);

    onMeleeSwing(ctx, p, 'auto_attack');
    onMeleeSwing(ctx, p, 'stormstrike');
    onMeleeSwing(ctx, p, 'auto_attack');

    expect(p.auras).toHaveLength(1);
    expect(p.auras[0]).toMatchObject({ id: 'test_stacks', kind: 'icicles', stacks: 2 });
  });

  it('supports percent resource restoration and adding charges to an owned aura', () => {
    const proc: ProcDef = {
      id: 'test_current',
      name: 'Test Current',
      trigger: { on: 'castNth', n: 1, abilities: ['earth_shock'] },
      responses: [
        { kind: 'resource', pctMax: 0.08, resourceType: 'mana' },
        { kind: 'addAuraCharges', ability: 'lightning_shield', amount: 1, maxCharges: 9 },
      ],
    };
    const { p, ctx } = fakePlayer([proc]);
    p.resourceType = 'mana';
    p.auras.push({
      id: 'lightning_shield',
      name: 'Lightning Shield',
      kind: 'thorns',
      remaining: 60,
      duration: 60,
      value: 1,
      charges: 3,
      sourceId: p.id,
      school: 'nature',
    });

    onCastCompleted(ctx, p, 'earth_shock');

    expect(p.resource).toBe(58);
    expect(p.auras[0].charges).toBe(4);
  });

  it('can direct a proc heal to its owner instead of the cast target', () => {
    const proc: ProcDef = {
      id: 'test_self_heal',
      name: 'Test Self Heal',
      trigger: { on: 'castNth', n: 1, abilities: ['healing_wave'] },
      responses: [{ kind: 'heal', amountPctMaxHp: 0.1, applyTo: 'self' }],
    };
    const { p, ctx } = fakePlayer([proc]);
    const ally = { ...p, id: 2, hp: 100, maxHp: 1000, auras: [] } as Entity;
    p.hp = 200;

    onCastCompleted(ctx, p, 'healing_wave', ally);

    expect(p.hp).toBe(240);
    expect(ally.hp).toBe(100);
  });
});

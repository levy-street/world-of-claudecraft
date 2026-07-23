import { describe, expect, it } from 'vitest';
import {
  onCastCompleted,
  onDamageTaken,
  onMeleeSwing,
  onSpellCrit,
  tickProcState,
} from '../src/sim/combat/talent_procs';
import type { ProcDef } from '../src/sim/content/talents';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

function fakePlayer(procs: ProcDef[]): { player: Entity; ctx: SimContext; events: string[] } {
  const events: string[] = [];
  const player = {
    id: 1,
    kind: 'player',
    hp: 400,
    maxHp: 400,
    resource: 50,
    maxResource: 100,
    resourceType: 'mana',
    auras: [] as Entity['auras'],
    cooldowns: new Map<string, number>(),
    dead: false,
  } as unknown as Entity;
  const ctx = {
    players: new Map([[1, { cls: 'priest' }]]),
    playerMods: () => ({ procs }),
    applyAura: (target: Entity, aura: Entity['auras'][number]) => {
      const existing = target.auras.findIndex(
        (candidate) => candidate.id === aura.id && candidate.sourceId === aura.sourceId,
      );
      if (existing >= 0) target.auras.splice(existing, 1);
      target.auras.push(aura);
      events.push(`aura:${aura.kind}`);
    },
    applyHeal: (_source: Entity, target: Entity, amount: number) => {
      target.hp = Math.min(target.maxHp, target.hp + amount);
      events.push(`heal:${amount}`);
    },
    emit: () => {},
    entities: new Map([[1, player]]),
  } as unknown as SimContext;
  return { player, ctx, events };
}

describe('v0.26 deterministic talent proc engine', () => {
  it('fires castNth on exactly every matching Nth cast', () => {
    const proc: ProcDef = {
      id: 'test_rhythm',
      name: 'Test Rhythm',
      trigger: { on: 'castNth', n: 3, abilities: ['smite'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_free', duration: 8 }],
    };
    const { player, ctx, events } = fakePlayer([proc]);
    onCastCompleted(ctx, player, 'smite');
    onCastCompleted(ctx, player, 'renew');
    onCastCompleted(ctx, player, 'smite');
    expect(events).toEqual([]);
    onCastCompleted(ctx, player, 'smite');
    expect(events).toEqual(['aura:next_cast_free']);
  });

  it('refreshes one scoped empowerment instead of stacking it', () => {
    const proc: ProcDef = {
      id: 'test_rhythm',
      name: 'Test Rhythm',
      trigger: { on: 'castNth', n: 1, abilities: ['smite'] },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_cheap',
          abilities: ['smite'],
          duration: 8,
          costPct: 0.5,
        },
      ],
    };
    const { player, ctx } = fakePlayer([proc]);
    onCastCompleted(ctx, player, 'smite');
    player.auras[0].remaining = 1;
    onCastCompleted(ctx, player, 'smite');
    expect(player.auras).toHaveLength(1);
    expect(player.auras[0]).toMatchObject({
      kind: 'next_cast_cheap',
      remaining: 8,
      value: 0.5,
      empowerAbilities: ['smite'],
    });
  });

  it('uses deterministic hit thresholds and ticked internal cooldowns without RNG', () => {
    const proc: ProcDef = {
      id: 'test_bulwark',
      name: 'Test Bulwark',
      trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
      responses: [{ kind: 'absorb', amount: 70, duration: 10, name: 'Test Bulwark' }],
    };
    const { player, ctx, events } = fakePlayer([proc]);
    onDamageTaken(ctx, player, 30);
    onDamageTaken(ctx, player, 80);
    onDamageTaken(ctx, player, 80);
    expect(events).toEqual(['aura:absorb']);
    tickProcState(player, 20.05);
    onDamageTaken(ctx, player, 80);
    expect(events).toEqual(['aura:absorb', 'aura:absorb']);
  });

  it('filters spell criticals by stable ability id', () => {
    const proc: ProcDef = {
      id: 'test_crit',
      name: 'Test Crit',
      trigger: { on: 'spellCrit', abilities: ['healing_wave'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_instant', duration: 8 }],
    };
    const { player, ctx } = fakePlayer([proc]);
    onSpellCrit(ctx, player, 'Mending Waters', player);
    expect(player.auras).toEqual([]);
    onSpellCrit(ctx, player, 'healing_wave', player);
    expect(player.auras).toMatchObject([{ id: 'test_crit', kind: 'next_cast_instant' }]);
  });

  it('fires meleeSwingWhile only while its authored aura is active', () => {
    const proc: ProcDef = {
      id: 'test_swing',
      name: 'Test Swing',
      trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
      responses: [{ kind: 'resource', amount: 10 }],
    };
    const { player, ctx } = fakePlayer([proc]);
    onMeleeSwing(ctx, player);
    expect(player.resource).toBe(50);
    player.auras.push({
      id: 'seal',
      name: 'Seal',
      kind: 'imbue',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: player.id,
      school: 'holy',
    });
    onMeleeSwing(ctx, player);
    expect(player.resource).toBe(60);
  });
});

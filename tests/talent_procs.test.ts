import { describe, expect, it } from 'vitest';
import {
  onCastCompleted,
  onDamageTaken,
  onSpellCrit,
  type ProcDef,
  tickProcState,
} from '../src/sim/combat/talent_procs';
import { applyThornsReaction } from '../src/sim/combat/thorns_charge';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
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

  it('spellCrit filters on the stable ability id, never its display name', () => {
    const proc: ProcDef = {
      id: 'test_crit',
      name: 'Test Crit',
      trigger: { on: 'spellCrit', abilities: ['healing_wave'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_instant', duration: 8 }],
    };
    const { p, ctx } = fakePlayer([proc]);

    onSpellCrit(ctx, p, null, p);
    onSpellCrit(ctx, p, 'Mending Waters', p);
    expect(p.auras).toHaveLength(0);

    onSpellCrit(ctx, p, 'healing_wave', p);
    expect(p.auras).toMatchObject([{ id: 'test_crit', kind: 'next_cast_instant' }]);
  });

  it('thornsReflect filters on the aura ability id that actually reflected', () => {
    const proc: ProcDef = {
      id: 'test_thorns',
      name: 'Test Thorns',
      trigger: { on: 'thornsReflect', ability: 'lightning_shield' },
      responses: [{ kind: 'resource', amount: 10 }],
    };
    const { p, ctx } = fakePlayer([proc]);
    const attacker = { id: 2, kind: 'mob', dead: false, auras: [] } as unknown as Entity;
    const thornsAura = (id: string): Entity['auras'][number] => ({
      id,
      name: id,
      kind: 'thorns',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: p.id,
      school: 'nature',
    });
    (ctx as unknown as { dealDamage(): void }).dealDamage = () => {};

    p.auras = [thornsAura('thorns')];
    applyThornsReaction(ctx, p, attacker);
    expect(p.resource).toBe(50);
    p.auras = [thornsAura('lightning_shield')];
    applyThornsReaction(ctx, p, attacker);
    expect(p.resource).toBe(60);
  });

  it('resource responses may require the player to use the matching resource type', () => {
    const proc: ProcDef = {
      id: 'test_rage',
      name: 'Test Rage',
      trigger: { on: 'castNth', n: 1, abilities: ['bash'] },
      responses: [
        { kind: 'resource', amount: 20, resourceType: 'rage' },
        { kind: 'absorb', amount: 40, duration: 6, name: 'Test Rage' },
      ],
    };
    const { p, ctx } = fakePlayer([proc]);

    onCastCompleted(ctx, p, 'bash');
    expect(p.resource).toBe(50);
    expect(p.auras).toMatchObject([{ id: 'test_rage', kind: 'absorb' }]);

    p.resourceType = 'rage';
    onCastCompleted(ctx, p, 'bash');
    expect(p.resource).toBe(70);
  });

  it('refreshes an active heal echo instead of silently ignoring the new cast', () => {
    const proc: ProcDef = {
      id: 'test_echo',
      name: 'Test Echo',
      trigger: { on: 'castNth', n: 1, abilities: ['heal'] },
      responses: [{ kind: 'echo', belowFrac: 0.35, window: 10, heal: 60, name: 'Test Echo' }],
    };
    const { p, ctx } = fakePlayer([proc]);

    onCastCompleted(ctx, p, 'heal', p);
    const first = p.auras[0];
    first.remaining = 1;
    first.value = 5;

    onCastCompleted(ctx, p, 'heal', p);
    expect(p.auras).toHaveLength(1);
    expect(p.auras[0]).toMatchObject({
      id: 'test_echo',
      kind: 'heal_echo',
      remaining: 10,
      duration: 10,
      value: 60,
      value2: 0.35,
    });
  });
});

describe('spell-crit ability-id plumbing', () => {
  function installProc(sim: Sim, proc: ProcDef): void {
    const meta = (
      sim as unknown as { players: Map<number, { talentMods: { procs: ProcDef[] } }> }
    ).players.get(sim.playerId);
    if (!meta) throw new Error('missing test player metadata');
    meta.talentMods.procs = [proc];
  }

  it('threads a healing ability id separately from its combat-log name', () => {
    const sim = new Sim({ seed: 7, playerClass: 'shaman', autoEquip: true });
    const p = sim.player;
    installProc(sim, {
      id: 'heal_crit_proc',
      name: 'Heal Crit Proc',
      trigger: { on: 'spellCrit', abilities: ['healing_wave'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_instant', duration: 8 }],
    });
    p.stats.int = 5000; // spellCrit > 1, but the deterministic rng draw still occurs
    p.hp = Math.max(1, p.maxHp - 100);
    const applyHeal = (
      sim as unknown as {
        applyHeal(
          source: Entity,
          target: Entity,
          amount: number,
          ability: string,
          abilityId?: string | null,
        ): void;
      }
    ).applyHeal.bind(sim);

    applyHeal(p, p, 10, 'Mending Waters');
    expect(p.auras.some((a) => a.id === 'heal_crit_proc')).toBe(false);
    applyHeal(p, p, 10, 'Mending Waters', 'healing_wave');
    expect(p.auras).toContainEqual(expect.objectContaining({ id: 'heal_crit_proc' }));
  });

  it('threads a damaging ability id separately from its combat-log name', () => {
    const sim = new Sim({ seed: 7, playerClass: 'shaman', autoEquip: true });
    const p = sim.player;
    installProc(sim, {
      id: 'damage_crit_proc',
      name: 'Damage Crit Proc',
      trigger: { on: 'spellCrit', abilities: ['lightning_bolt'] },
      responses: [{ kind: 'empowerNext', aura: 'next_cast_instant', duration: 8 }],
    });
    const target = createMob(9907, MOBS.forest_wolf, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 3,
    });
    target.maxHp = target.hp = 1000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(target);

    sim.dealDamage(p, target, 10, true, 'nature', 'Arc Bolt', 'hit');
    expect(p.auras.some((a) => a.id === 'damage_crit_proc')).toBe(false);
    sim.dealDamage(
      p,
      target,
      10,
      true,
      'nature',
      'Arc Bolt',
      'hit',
      false,
      undefined,
      true,
      'lightning_bolt',
    );
    expect(p.auras).toContainEqual(expect.objectContaining({ id: 'damage_crit_proc' }));
  });
});

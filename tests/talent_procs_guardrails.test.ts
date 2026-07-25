import { describe, expect, it } from 'vitest';
import { consumeFreeCostFor } from '../src/sim/combat/empower_next';
import {
  onCastCompleted,
  onMeleeSwing,
  onSpellCrit,
  type ProcDef,
  tickProcState,
} from '../src/sim/combat/talent_procs';
import { Rng } from '../src/sim/rng';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// Balance-pass guardrails (fix/talents2-balance-pass):
// G1: a cast that consumed an empower aura (next_cast_free / next_execute_free /
//     next_cast_instant / next_cast_cheap) never advances a castNth counter, so
//     free-cast relay procs cannot feed cast-counter procs.
// G2: castNth and spellCrit triggers accept an optional internal cooldown; while
//     it runs, matching casts are ignored entirely (no counting, no firing).
// G4: triggers accept an optional chance (item-set Clearcasting shape); the rng
//     draw happens only at the moment the proc would otherwise fire.

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
    players: new Map([[1, { cls: 'hunter' }]]),
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
    rng: new Rng(11),
  } as unknown as SimContext;
  return { p, ctx, events };
}

describe('G1: empowered casts do not advance castNth counters', () => {
  it('a free-cast relay does not feed a cast-counter proc', () => {
    const relay: ProcDef = {
      id: 'test_relay',
      name: 'Test Relay',
      trigger: { on: 'castNth', n: 1, abilities: ['serpent_sting'] },
      responses: [
        { kind: 'empowerNext', aura: 'next_cast_free', abilities: ['arcane_shot'], duration: 8 },
      ],
    };
    const counter: ProcDef = {
      id: 'test_counter',
      name: 'Test Counter',
      trigger: { on: 'castNth', n: 3, abilities: ['arcane_shot'] },
      responses: [{ kind: 'resource', amount: 20 }],
    };
    const { p, ctx } = fakePlayer([relay, counter]);

    // Venom Barb arms the relay; the empowered Fell Shot consumes it.
    onCastCompleted(ctx, p, 'serpent_sting');
    expect(p.auras.some((aura) => aura.kind === 'next_cast_free')).toBe(true);
    expect(consumeFreeCostFor(ctx, p, 'arcane_shot')).toBe(true);
    onCastCompleted(ctx, p, 'arcane_shot'); // empowered: must NOT count
    expect(p.procState?.counters.test_counter ?? 0).toBe(0);

    // The skip flag is consumed with that one cast: real casts count again.
    onCastCompleted(ctx, p, 'arcane_shot');
    onCastCompleted(ctx, p, 'arcane_shot');
    expect(p.resource).toBe(50); // two real casts: not fired yet
    onCastCompleted(ctx, p, 'arcane_shot');
    expect(p.resource).toBe(70); // third real cast fires the +20
  });

  it('an empowered cast still fires non-counter hooks and clears the flag', () => {
    const counter: ProcDef = {
      id: 'test_counter',
      name: 'Test Counter',
      trigger: { on: 'castNth', n: 1, abilities: ['arcane_shot'] },
      responses: [{ kind: 'resource', amount: 20 }],
    };
    const { p, ctx } = fakePlayer([counter]);
    p.auras.push({
      id: 'test_free',
      name: 'Test Free',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: 1,
      school: 'physical',
    } as Entity['auras'][number]);
    expect(consumeFreeCostFor(ctx, p, 'arcane_shot')).toBe(true);
    onCastCompleted(ctx, p, 'arcane_shot'); // skipped
    expect(p.resource).toBe(50);
    onCastCompleted(ctx, p, 'arcane_shot'); // real: fires
    expect(p.resource).toBe(70);
  });
});

describe('G2: internal cooldowns on castNth and spellCrit triggers', () => {
  it('castNth with an icd ignores matching casts while it runs', () => {
    const proc: ProcDef = {
      id: 'test_moonspite',
      name: 'Test Moonspite',
      trigger: { on: 'castNth', n: 1, abilities: ['moonfire'], icd: 10 },
      responses: [
        { kind: 'empowerNext', aura: 'next_cast_instant', abilities: ['starfire'], duration: 8 },
      ],
    };
    const { p, ctx, events } = fakePlayer([proc]);
    onCastCompleted(ctx, p, 'moonfire');
    expect(events).toEqual(['aura:next_cast_instant']);
    p.auras.length = 0; // consume the charge so refresh-not-stack cannot mask the icd
    onCastCompleted(ctx, p, 'moonfire'); // inside the icd: ignored
    expect(events).toHaveLength(1);
    tickProcState(p, 10.05);
    onCastCompleted(ctx, p, 'moonfire');
    expect(events).toHaveLength(2);
  });

  it('castNth with an icd does not accumulate counts while it runs', () => {
    const proc: ProcDef = {
      id: 'test_paced',
      name: 'Test Paced',
      trigger: { on: 'castNth', n: 2, abilities: ['smite'], icd: 10 },
      responses: [{ kind: 'resource', amount: 10 }],
    };
    const { p, ctx } = fakePlayer([proc]);
    onCastCompleted(ctx, p, 'smite');
    onCastCompleted(ctx, p, 'smite'); // fires, arms the icd
    expect(p.resource).toBe(60);
    onCastCompleted(ctx, p, 'smite'); // ignored: no count banked
    tickProcState(p, 10.05);
    onCastCompleted(ctx, p, 'smite'); // first fresh count
    expect(p.resource).toBe(60);
    onCastCompleted(ctx, p, 'smite'); // second fresh count: fires
    expect(p.resource).toBe(70);
  });

  it('chance 1 on castNth fires every matching cast, chance 0 never fires', () => {
    const always: ProcDef = {
      id: 'test_always',
      name: 'Test Always',
      trigger: { on: 'castNth', n: 1, abilities: ['sinister_strike'], chance: 1 },
      responses: [{ kind: 'resource', amount: 5 }],
    };
    const never: ProcDef = {
      id: 'test_never',
      name: 'Test Never',
      trigger: { on: 'castNth', n: 1, abilities: ['sinister_strike'], chance: 0 },
      responses: [{ kind: 'resource', amount: 100 }],
    };
    const { p, ctx } = fakePlayer([always, never]);
    onCastCompleted(ctx, p, 'sinister_strike');
    onCastCompleted(ctx, p, 'sinister_strike');
    expect(p.resource).toBe(60); // two 5s from `always`, nothing from `never`
  });

  it('chance-gated meleeSwingWhile rolls per swing and honors its icd', () => {
    const dividend: ProcDef = {
      id: 'test_dividend',
      name: 'Test Dividend',
      trigger: { on: 'meleeSwingWhile', auraKind: 'imbue', chance: 1, icd: 2 },
      responses: [{ kind: 'resource', amount: 5 }],
    };
    const dud: ProcDef = {
      id: 'test_dud',
      name: 'Test Dud',
      trigger: { on: 'meleeSwingWhile', auraKind: 'imbue', chance: 0 },
      responses: [{ kind: 'resource', amount: 100 }],
    };
    const { p, ctx } = fakePlayer([dividend, dud]);
    p.auras.push({
      id: 'test_poison',
      name: 'Test Poison',
      kind: 'imbue',
      remaining: 60,
      duration: 60,
      value: 5,
      sourceId: 1,
      school: 'physical',
    } as Entity['auras'][number]);
    onMeleeSwing(ctx, p);
    expect(p.resource).toBe(55); // dividend fired, dud never does
    onMeleeSwing(ctx, p); // inside the 2s icd
    expect(p.resource).toBe(55);
    tickProcState(p, 2.05);
    onMeleeSwing(ctx, p);
    expect(p.resource).toBe(60);
  });

  it('spellCrit with an icd fires at most once per window', () => {
    const proc: ProcDef = {
      id: 'test_sky_echo',
      name: 'Test Sky Echo',
      trigger: { on: 'spellCrit', abilities: ['lightning_bolt'], icd: 8 },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_cast_instant',
          abilities: ['lightning_bolt'],
          duration: 8,
        },
      ],
    };
    const { p, ctx, events } = fakePlayer([proc]);
    onSpellCrit(ctx, p, 'lightning_bolt', p);
    expect(events).toHaveLength(1);
    p.auras.length = 0;
    onSpellCrit(ctx, p, 'lightning_bolt', p);
    expect(events).toHaveLength(1); // icd holds
    tickProcState(p, 8.05);
    onSpellCrit(ctx, p, 'lightning_bolt', p);
    expect(events).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { wireEntity } from '../server/game';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// wireEntity's aura serialization was rewritten from a chain of conditional
// object spreads to direct property assignment (perf: the spread form
// allocated a throwaway object literal per branch, per aura, every tick,
// regardless of which side was taken). This pins the wire shape those spreads
// used to produce, so a future edit to server/game.ts's wireAura cannot
// silently drop or always-include an optional field.
function baseAura(overrides: Partial<Aura> = {}): Aura {
  return {
    id: 'test_aura',
    name: 'Test Aura',
    kind: 'buff_ap',
    remaining: 5,
    duration: 10,
    value: 0,
    sourceId: 0,
    school: 'physical',
    ...overrides,
  };
}

function wireAuras(e: Entity): Record<string, unknown>[] {
  return (wireEntity(e) as { auras?: Record<string, unknown>[] }).auras ?? [];
}

describe('wireEntity aura serialization', () => {
  it('omits every optional field when the aura carries only defaults', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const e = sim.player;
    e.auras = [baseAura()];

    const auras = wireAuras(e);
    expect(auras).toHaveLength(1);
    const w = auras[0];
    expect(w).toEqual({
      id: 'test_aura',
      name: 'Test Aura',
      kind: 'buff_ap',
      rem: 5,
      dur: 10,
    });
    // toEqual ignores key order; direct assignment must still emit id/name/kind/rem/dur
    // in that exact order (a future reorder would still pass toEqual but change wire bytes).
    expect(Object.keys(w)).toEqual(['id', 'name', 'kind', 'rem', 'dur']);
    expect(w).not.toHaveProperty('value');
    expect(w).not.toHaveProperty('value2');
    expect(w).not.toHaveProperty('value3');
    expect(w).not.toHaveProperty('tickInterval');
    expect(w).not.toHaveProperty('school');
    expect(w).not.toHaveProperty('stacks');
    expect(w).not.toHaveProperty('charges');
    expect(w).not.toHaveProperty('src');
  });

  it('includes every optional field when the aura carries a non-default value', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const e = sim.player;
    e.auras = [
      baseAura({
        value: -3,
        value2: 10,
        value3: 20,
        tickInterval: 2,
        school: 'holy',
        stacks: 4,
        charges: 2,
        sourceId: 7,
      }),
    ];

    const w = wireAuras(e)[0];
    expect(w).toEqual({
      id: 'test_aura',
      name: 'Test Aura',
      kind: 'buff_ap',
      rem: 5,
      dur: 10,
      value: -3,
      value2: 10,
      value3: 20,
      tickInterval: 2,
      school: 'holy',
      stacks: 4,
      charges: 2,
      src: 7,
    });
    expect(Object.keys(w)).toEqual([
      'id',
      'name',
      'kind',
      'rem',
      'dur',
      'value',
      'value2',
      'value3',
      'tickInterval',
      'school',
      'stacks',
      'charges',
      'src',
    ]);
  });

  it('omits stacks when exactly 1 but includes charges even when exactly 1', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const e = sim.player;
    e.auras = [baseAura({ stacks: 1, charges: 1 })];

    const w = wireAuras(e)[0];
    expect(w).not.toHaveProperty('stacks');
    expect(w.charges).toBe(1);
  });

  it('includes value2/value3/tickInterval/charges when defined as exactly 0', () => {
    // These fields are gated on `!== undefined`, not truthiness (unlike value/sourceId,
    // which are gated on truthiness and legitimately omit 0). A defined 0 must still ride
    // the wire, or a judgement min-range of 0 or a Lightning Shield down to 0 charges would
    // silently vanish and decode back to "absent" on the client.
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const e = sim.player;
    e.auras = [baseAura({ value2: 0, value3: 0, tickInterval: 0, charges: 0 })];

    const w = wireAuras(e)[0];
    expect(w.value2).toBe(0);
    expect(w.value3).toBe(0);
    expect(w.tickInterval).toBe(0);
    expect(w.charges).toBe(0);
    expect(w).not.toHaveProperty('value');
    expect(w).not.toHaveProperty('src');
  });

  it('rides value across the wire raw, not rounded', () => {
    // w.value = a.value (not round2(a.value)) so a tiny negative survives instead of
    // collapsing to -0 -> 0, which would flip a stat-sap's isAuraDebuff classification
    // on the client. This fails if a future edit swaps in round2(a.value).
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const e = sim.player;
    e.auras = [baseAura({ value: -0.004 })];

    const w = wireAuras(e)[0];
    expect(w.value).toBe(-0.004);
  });
});

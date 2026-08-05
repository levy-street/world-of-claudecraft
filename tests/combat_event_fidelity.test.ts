// Sim event-fidelity round 1 (the parse-service plan, section 7): heal2 gains
// an overheal field at every clamped emission site, and aura events carry
// their attribution (sourceId, abilityId, stacks) plus an explicit refresh
// flag, with a same-id same-name refresh updating the aura IN PLACE (stable
// buff-bar position) instead of a silent splice-and-readd.
import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { Sim } from '../src/sim/sim';
import type { Aura, SimEvent } from '../src/sim/types';

function makeSim(seed = 5252): Sim {
  return new Sim({ seed, playerClass: 'priest', autoEquip: true });
}

type Heal2Event = Extract<SimEvent, { type: 'heal2' }>;
type AuraEvent = Extract<SimEvent, { type: 'aura' }>;

function isHeal2(ev: SimEvent): ev is Heal2Event {
  return ev.type === 'heal2';
}
function isAura(ev: SimEvent): ev is AuraEvent {
  return ev.type === 'aura';
}

function hotAura(sourceId: number, extra: Partial<Aura> = {}): Aura {
  return {
    id: 'test_renew',
    name: 'Test Renew',
    kind: 'hot',
    remaining: 10,
    duration: 10,
    value: 500,
    sourceId,
    school: 'holy',
    tickInterval: 0.25,
    tickTimer: 0.25,
    ...extra,
  } as Aura;
}

describe('heal2 overheal', () => {
  it('carries the clamped excess when a heal lands past full health', () => {
    const sim = makeSim();
    const target = sim.player;
    target.maxHp = 10000;
    target.hp = target.maxHp - 100;
    target.stats.int = -1000; // crit chance goes negative: the roll always fails
    sim.drainEvents();

    applyHeal(sim.ctx, target, target, 1000, 'Heal');

    const ev = sim.drainEvents().find(isHeal2);
    if (!ev) throw new Error('expected heal2 event');
    expect(ev.amount).toBe(100);
    expect(ev.overheal).toBe(900);
    expect(target.hp).toBe(target.maxHp);
  });

  it('omits the field entirely when nothing overheals', () => {
    const sim = makeSim();
    const target = sim.player;
    target.maxHp = 10000;
    target.hp = 1000;
    target.stats.int = -1000;
    sim.drainEvents();

    applyHeal(sim.ctx, target, target, 500, 'Heal');

    const ev = sim.drainEvents().find(isHeal2);
    if (!ev) throw new Error('expected heal2 event');
    expect(ev.amount).toBe(500);
    expect('overheal' in ev).toBe(false);
  });

  it('a HoT tick past full health carries its overheal', () => {
    const sim = makeSim();
    const target = sim.player;
    target.maxHp = 10000;
    target.hp = target.maxHp - 100;
    sim.ctx.applyAura(target, hotAura(target.id));
    sim.drainEvents();

    let hotTick: Heal2Event | undefined;
    for (let i = 0; i < 40 && hotTick === undefined; i++) {
      hotTick = sim.tick().find((ev) => isHeal2(ev) && ev.hot === true && ev.cueOnly !== true) as
        | Heal2Event
        | undefined;
    }

    if (!hotTick) throw new Error('expected a HoT tick heal2 event');
    // Natural regen may shrink the deficit before the first HoT tick fires, so
    // pin the invariant: landed + overheal always equals the intended 500, and
    // a mostly-full target must overheal.
    expect(hotTick.amount + (hotTick.overheal ?? 0)).toBe(500);
    expect(hotTick.overheal).toBeGreaterThan(0);
  });
});

describe('aura event attribution', () => {
  it('a gained aura event names its source, ability id, and stacks', () => {
    const sim = makeSim();
    const target = sim.player;
    sim.drainEvents();

    sim.ctx.applyAura(target, hotAura(target.id, { stacks: 3 }));

    const ev = sim.drainEvents().find((e) => isAura(e) && e.gained);
    if (!ev || !isAura(ev)) throw new Error('expected gained aura event');
    expect(ev.sourceId).toBe(target.id);
    expect(ev.abilityId).toBe('test_renew');
    expect(ev.stacks).toBe(3);
    expect(ev.refresh).toBeUndefined();
  });

  it('a same-id same-name refresh updates in place with a refresh flag and no fade', () => {
    const sim = makeSim();
    const target = sim.player;
    sim.ctx.applyAura(target, { ...hotAura(target.id), remaining: 2 } as Aura);
    // A marker aura AFTER it pins the array position question.
    sim.ctx.applyAura(target, {
      id: 'marker',
      name: 'Marker',
      kind: 'attackspeed',
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: target.id,
      school: 'physical',
    } as Aura);
    const indexBefore = target.auras.findIndex((a) => a.id === 'test_renew');
    sim.drainEvents();

    sim.ctx.applyAura(target, { ...hotAura(target.id), remaining: 10 } as Aura);

    const auraEvents = sim.drainEvents().filter(isAura);
    const gains = auraEvents.filter((e) => e.gained && e.name === 'Test Renew');
    const fades = auraEvents.filter((e) => !e.gained && e.name === 'Test Renew');
    expect(gains).toHaveLength(1);
    expect(fades).toHaveLength(0);
    expect(gains[0]?.refresh).toBe(true);
    const indexAfter = target.auras.findIndex((a) => a.id === 'test_renew');
    expect(indexAfter).toBe(indexBefore);
    expect(target.auras[indexAfter]?.remaining).toBe(10);
  });

  it('a same-id different-name swap fades the old brand without a refresh flag', () => {
    const sim = makeSim();
    const target = sim.player;
    sim.ctx.applyAura(target, {
      id: 'elixir_str',
      name: 'Elixir of Oxen',
      kind: 'attackspeed',
      remaining: 60,
      duration: 60,
      value: 5,
      sourceId: target.id,
      school: 'physical',
    } as Aura);
    sim.drainEvents();

    sim.ctx.applyAura(target, {
      id: 'elixir_str',
      name: 'Elixir of Bulls',
      kind: 'attackspeed',
      remaining: 60,
      duration: 60,
      value: 8,
      sourceId: target.id,
      school: 'physical',
    } as Aura);

    const auraEvents = sim.drainEvents().filter(isAura);
    expect(auraEvents.find((e) => !e.gained && e.name === 'Elixir of Oxen')).toBeTruthy();
    const gained = auraEvents.find((e) => e.gained && e.name === 'Elixir of Bulls');
    expect(gained?.refresh).toBeUndefined();
  });
});

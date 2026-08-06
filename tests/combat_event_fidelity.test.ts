// Sim event-fidelity round 1 (the parse-service plan, section 7): heal2 gains
// an overheal field at every clamped emission site, and aura events carry
// their attribution (sourceId, abilityId, stacks) plus an explicit refresh
// flag. Aura ARRAY placement is deliberately unchanged (a refresh splices
// then appends exactly like a fresh apply): array order feeds rng draw order
// and gameplay selections, so only the EVENT says refresh, never the
// position.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
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

  it('a same-id same-name refresh flags the gained event, emits no fade, and moves to the end like any application', () => {
    const sim = makeSim();
    const target = sim.player;
    sim.ctx.applyAura(target, { ...hotAura(target.id), remaining: 2 } as Aura);
    // A marker aura AFTER it pins the ordering question: a refresh must move
    // the aura to the END exactly as a fresh application always has, because
    // Entity.auras order feeds rng-drawing walks (DoT ticks, fear breaks) and
    // gameplay selections (dispel, absorb consumption). Refresh-vs-apply may
    // never produce different array orders.
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
    sim.drainEvents();

    sim.ctx.applyAura(target, { ...hotAura(target.id), remaining: 10 } as Aura);

    const auraEvents = sim.drainEvents().filter(isAura);
    const gains = auraEvents.filter((e) => e.gained && e.name === 'Test Renew');
    const fades = auraEvents.filter((e) => !e.gained && e.name === 'Test Renew');
    expect(gains).toHaveLength(1);
    expect(fades).toHaveLength(0);
    expect(gains[0]?.refresh).toBe(true);
    const renewIndex = target.auras.findIndex((a) => a.id === 'test_renew');
    const markerIndex = target.auras.findIndex((a) => a.id === 'marker');
    expect(renewIndex).toBeGreaterThan(markerIndex);
    expect(target.auras[renewIndex]?.remaining).toBe(10);
  });

  it('a multi-conflict group-buff re-application collapses to one aura with a refresh flag', () => {
    const sim = makeSim();
    const target = sim.player;
    const intellect = (sourceId: number): Aura =>
      ({
        id: 'arcane_intellect',
        name: 'Arcane Intellect',
        kind: 'attackspeed',
        remaining: 60,
        duration: 60,
        value: 0,
        sourceId,
        school: 'arcane',
      }) as Aura;
    // Two casters' copies coexist only by direct array seeding (the sim
    // itself dedupes on apply); this pins the multi-conflict splice arm.
    target.auras.push(intellect(9001), intellect(9002));
    sim.drainEvents();

    sim.ctx.applyAura(target, intellect(target.id));

    const auraEvents = sim.drainEvents().filter(isAura);
    const gains = auraEvents.filter((e) => e.gained && e.name === 'Arcane Intellect');
    expect(gains).toHaveLength(1);
    expect(gains[0]?.refresh).toBe(true);
    expect(auraEvents.filter((e) => !e.gained)).toHaveLength(0);
    expect(target.auras.filter((a) => a.id === 'arcane_intellect')).toHaveLength(1);
  });

  it('a partly absorbed, partly clamped heal reports absorbed and overheal without double-counting', () => {
    const sim = makeSim();
    const target = sim.player;
    target.maxHp = 10000;
    target.hp = target.maxHp - 100;
    target.stats.int = -1000;
    target.auras.push({
      id: 'necrotic_test',
      name: 'Necrotic Test',
      kind: 'heal_absorb',
      remaining: 30,
      duration: 30,
      value: 300,
      sourceId: 9001,
      school: 'shadow',
    } as Aura);
    sim.drainEvents();

    applyHeal(sim.ctx, target, target, 1000, 'Heal');

    const ev = sim.drainEvents().find(isHeal2);
    if (!ev) throw new Error('expected heal2 event');
    expect(ev.absorbed).toBe(300);
    expect(ev.amount).toBe(100);
    expect(ev.overheal).toBe(600);
    expect(ev.amount + (ev.absorbed ?? 0) + (ev.overheal ?? 0)).toBe(1000);
  });

  it('every heal2 emit block in the sim carries overheal or is the cue-only emit', () => {
    // The two hardest sites (applyHeal, the HoT tick) are pinned behaviorally
    // above. This source pin walks EVERY `type: 'heal2'` emit object across
    // the sim and requires each block to carry the overheal spread or the
    // cueOnly marker, so a future clamped emit site added without the field
    // fails here rather than silently undercounting.
    const files = [
      'src/sim/combat/heal.ts',
      'src/sim/combat/auras.ts',
      'src/sim/combat/casting_lifecycle.ts',
      'src/sim/combat/chronomancy.ts',
      'src/sim/combat/temporal_hourglass.ts',
      'src/sim/pet/pet_commands.ts',
      'src/sim/sim.ts',
    ];
    let blocksSeen = 0;
    for (const file of files) {
      const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
      let from = 0;
      for (;;) {
        const at = source.indexOf("type: 'heal2'", from);
        if (at === -1) break;
        from = at + 1;
        blocksSeen++;
        const end = source.indexOf('});', at);
        const block = source.slice(at, end === -1 ? at + 600 : end);
        expect(
          /overheal|cueOnly/.test(block),
          `${file} heal2 emit at offset ${at} lacks overheal (or cueOnly)`,
        ).toBe(true);
      }
    }
    // Vacuity floor: the walk must actually be finding the known emit sites.
    expect(blocksSeen).toBeGreaterThanOrEqual(7);
  });

  it('a stack bump credits the current caster and cast, not the pre-existing aura', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    // Armor Shear is Protection-only since the 2026-07-08 restructure, and a
    // settle tick populates the known-ability list (the imbue harness does
    // the same).
    expect(sim.setSpec('prot')).toBe(true);
    sim.tick();
    const p = sim.player;
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 10, {
      x: p.pos.x + 1,
      y: p.pos.y,
      z: p.pos.z,
    });
    mob.hostile = true;
    sim.addEntity(mob);
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    // A pre-existing sunder-kind aura from ANOTHER caster and cast (the rogue
    // Expose case): the warrior's bump must not inherit its identity.
    mob.auras.push({
      id: 'expose_armor',
      name: 'Armor Breach',
      kind: 'sunder',
      remaining: 30,
      duration: 30,
      value: 25,
      sourceId: 9001,
      school: 'physical',
    } as Aura);
    p.targetId = mob.id;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.drainEvents();

    sim.castAbility('sunder_armor', p.id);
    const events = sim.tick();

    const bump = events.find((ev) => isAura(ev) && ev.gained && ev.refresh === true) as
      | AuraEvent
      | undefined;
    if (!bump) throw new Error('expected the stack-bump aura event');
    expect(bump.name).toBe('Armor Shear');
    expect(bump.sourceId).toBe(p.id);
    expect(bump.abilityId).toBe('sunder_armor');
    expect(bump.stacks).toBe(2);
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
    const fade = auraEvents.find((e) => !e.gained && e.name === 'Elixir of Oxen');
    expect(fade).toMatchObject({ sourceId: target.id, abilityId: 'elixir_str' });
    const gained = auraEvents.find((e) => e.gained && e.name === 'Elixir of Bulls');
    expect(gained?.refresh).toBeUndefined();
  });
});

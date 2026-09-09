// Coldsight v0.42 class-balance pass (docs/design/class-balance-v042.md): a
// fully completed Fevered Draw (all six pulses, no cancel/interrupt/pushback
// shortening) grants one visible, non-stacking 10 sec opportunity; an
// accepted Long Draw or Fell Shot reserves it immediately (so a later
// interruption still spends it), and the reservation resolves into a
// +50%/+75% damageMult on the complete hit exactly once. This suite covers
// the exported state machine (src/sim/combat/hunter_coldsight_read.ts)
// directly; the real coordinator flow (a live Sim channeling, casting,
// interrupting) is tests/v042_coldsight_integration.test.ts.
import { describe, expect, it } from 'vitest';
import {
  cleanColdsightReadState,
  coldsightFeveredDrawChannelStart,
  coldsightFeveredDrawCompleted,
  coldsightFeveredDrawPulse,
  coldsightReadArmed,
  coldsightReserveRead,
  coldsightVoidReservationOnCancel,
  consumeColdsightReadReservation,
  FEVERED_DRAW_PULSE_COUNT,
} from '../src/sim/combat/hunter_coldsight_read';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & { ctx: SimContext; addEntity(e: Entity): void; nextId: number };

// Swaps the sim's own `emit` (ctx.emit late-binds to `sim.emit`, the documented
// swap point: see sim.ts's buildSimContext comment on the C5/mob_blind precedent)
// so a unit-level call straight into the module (no tick(), no castAbility) can
// still observe exactly what it sent to the event stream a real client reads.
function captureEmittedEvents(sim: TestSim): SimEvent[] {
  const captured: SimEvent[] = [];
  const original = sim.emit.bind(sim);
  (sim as unknown as { emit: (ev: SimEvent) => void }).emit = (ev: SimEvent) => {
    captured.push(ev);
    original(ev);
  };
  return captured;
}

function auraEvents(events: SimEvent[]): Extract<SimEvent, { type: 'aura' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'aura' }> => e.type === 'aura');
}

function hunterSim(spec: string, seed: number): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

// Tick-driven tests below only need the player's own auras to tick; an empty
// world keeps sim.tick() from also stepping camps/npcs.
function hunterSimEmptyWorld(spec: string, seed: number): TestSim {
  const sim = new Sim({
    seed,
    playerClass: 'hunter',
    autoEquip: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function liveTarget(sim: TestSim): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...sim.player.pos });
  sim.addEntity(mob);
  return mob;
}

function fullFeveredDraw(
  sim: TestSim,
  target: Entity | null,
  pulses = FEVERED_DRAW_PULSE_COUNT,
): void {
  coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
  for (let i = 0; i < pulses; i++) coldsightFeveredDrawPulse(sim.ctx, sim.player, 'rapid_fire');
  coldsightFeveredDrawCompleted(sim.ctx, sim.player, 'rapid_fire', target);
}

describe('Fevered Draw grant: only a full, valid channel qualifies', () => {
  it('grants a 10 sec visible opportunity after all six pulses land on a live target', () => {
    const sim = hunterSim('marksmanship', 201);
    const target = liveTarget(sim);
    expect(coldsightReadArmed(sim.player)).toBe(false);
    fullFeveredDraw(sim, target);
    expect(coldsightReadArmed(sim.player)).toBe(true);
    const aura = sim.player.auras.find((a) => a.kind === 'hunter_coldsight_read');
    expect(aura?.duration).toBe(10);
    expect(aura?.remaining).toBe(10);
  });

  it('refuses a pushback-shortened channel: fewer than six real pulses grants nothing', () => {
    const sim = hunterSim('marksmanship', 202);
    const target = liveTarget(sim);
    fullFeveredDraw(sim, target, FEVERED_DRAW_PULSE_COUNT - 1);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('refuses when the target is dead at completion', () => {
    const sim = hunterSim('marksmanship', 203);
    const target = liveTarget(sim);
    target.dead = true;
    fullFeveredDraw(sim, target);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('refuses when there is no target at completion', () => {
    const sim = hunterSim('marksmanship', 204);
    fullFeveredDraw(sim, null);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('ignores completion of any ability other than rapid_fire', () => {
    const sim = hunterSim('marksmanship', 205);
    const target = liveTarget(sim);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    for (let i = 0; i < FEVERED_DRAW_PULSE_COUNT; i++) {
      coldsightFeveredDrawPulse(sim.ctx, sim.player, 'rapid_fire');
    }
    coldsightFeveredDrawCompleted(sim.ctx, sim.player, 'aimed_shot', target);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('never grants for a non-marksmanship hunter spec', () => {
    const sim = hunterSim('survival', 206);
    const target = liveTarget(sim);
    fullFeveredDraw(sim, target);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('a channel that never actually started (no pulses tracked) grants nothing even if reported complete', () => {
    const sim = hunterSim('marksmanship', 207);
    const target = liveTarget(sim);
    coldsightFeveredDrawCompleted(sim.ctx, sim.player, 'rapid_fire', target);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('a repeated full completion refreshes, never stacks', () => {
    const sim = hunterSim('marksmanship', 208);
    const target = liveTarget(sim);
    fullFeveredDraw(sim, target);
    const aura = sim.player.auras.find((a) => a.kind === 'hunter_coldsight_read');
    if (aura) aura.remaining = 1; // simulate it ticking most of the way down
    fullFeveredDraw(sim, target);
    expect(sim.player.auras.filter((a) => a.kind === 'hunter_coldsight_read')).toHaveLength(1);
    expect(sim.player.auras.find((a) => a.kind === 'hunter_coldsight_read')?.remaining).toBe(10);
  });

  it('a fresh channel start resets progress: a prior short channel cannot combine with a later one', () => {
    const sim = hunterSim('marksmanship', 209);
    const target = liveTarget(sim);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    coldsightFeveredDrawPulse(sim.ctx, sim.player, 'rapid_fire'); // 1 pulse, then abandoned (no completion call)
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    for (let pulse = 0; pulse < 5; pulse++) {
      coldsightFeveredDrawPulse(sim.ctx, sim.player, 'rapid_fire');
    }
    coldsightFeveredDrawCompleted(sim.ctx, sim.player, 'rapid_fire', target);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });
});

describe('coldsightReserveRead: reserve at accepted cast, reject never consumes', () => {
  it('reserves on an accepted Long Draw and consumes the armed opportunity', () => {
    const sim = hunterSim('marksmanship', 210);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('a rejected/ineligible cast never consumes the armed opportunity', () => {
    const sim = hunterSim('marksmanship', 211);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'multi_shot'); // not a Coldsight Read ability
    expect(coldsightReadArmed(sim.player)).toBe(true);
  });

  it('reserving with nothing armed is a no-op', () => {
    const sim = hunterSim('marksmanship', 212);
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, base)).toBe(base);
  });

  it('prevents a second queued action from spending the same opportunity', () => {
    const sim = hunterSim('marksmanship', 213);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot'); // first accepted cast reserves it
    coldsightReserveRead(sim.ctx, sim.player, 'arcane_shot'); // same-tick second cast finds nothing armed
    const fell = sim.resolvedAbility('arcane_shot');
    if (!fell) throw new Error('expected arcane_shot to resolve');
    // The second (arcane_shot) cast never reserved anything, so its own resolve is untouched...
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, fell)).toBe(fell);
    // ...while the first (aimed_shot) cast's reservation is still live and tied to it.
    const aimed = sim.resolvedAbility('aimed_shot');
    if (!aimed) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, aimed)).not.toBe(aimed);
  });
});

describe('coldsightVoidReservationOnCancel: interrupted casts spend it, never leak forward', () => {
  it('an interrupted Long Draw loses its reservation for good', () => {
    const sim = hunterSim('marksmanship', 214);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    coldsightVoidReservationOnCancel(sim.ctx, sim.player, 'aimed_shot');
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, base)).toBe(base);
    expect(coldsightReadArmed(sim.player)).toBe(false); // not merely re-armed either
  });

  it('leaves an unrelated cancelled cast alone', () => {
    const sim = hunterSim('marksmanship', 215);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    coldsightVoidReservationOnCancel(sim.ctx, sim.player, 'raptor_strike');
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, base)).not.toBe(base);
  });
});

describe('consumeColdsightReadReservation: a damageMult rider on the complete hit, exactly once', () => {
  function directDamageOf(res: ResolvedAbility) {
    const eff = res.effects.find((e) => e.type === 'directDamage');
    if (eff?.type !== 'directDamage') throw new Error('expected a directDamage effect');
    return eff;
  }

  it('bakes +50% as damageMult into a reserved Long Draw, leaving min/max (and any AP scaling) untouched', () => {
    const sim = hunterSim('marksmanship', 216);
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    const baseEff = directDamageOf(base);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const boosted = consumeColdsightReadReservation(sim.ctx, sim.player, base);
    const boostedEff = directDamageOf(boosted);
    expect(boostedEff.min).toBe(baseEff.min);
    expect(boostedEff.max).toBe(baseEff.max);
    expect(boostedEff.damageMult ?? 1).toBeCloseTo(1.5);
  });

  it('bakes +75% for a reserved Fell Shot', () => {
    const sim = hunterSim('marksmanship', 217);
    const base = sim.resolvedAbility('arcane_shot');
    if (!base) throw new Error('expected arcane_shot to resolve');
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'arcane_shot');
    const boosted = consumeColdsightReadReservation(sim.ctx, sim.player, base);
    expect(directDamageOf(boosted).damageMult ?? 1).toBeCloseTo(1.75);
  });

  it('composes with an existing damageMult rather than overwriting it', () => {
    const sim = hunterSim('marksmanship', 218);
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    const withExistingMult: ResolvedAbility = {
      ...base,
      effects: base.effects.map((eff) =>
        eff.type === 'directDamage' ? { ...eff, damageMult: 1.2 } : eff,
      ),
    };
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const boosted = consumeColdsightReadReservation(sim.ctx, sim.player, withExistingMult);
    expect(directDamageOf(boosted).damageMult).toBeCloseTo(1.2 * 1.5);
  });

  it('leaves the resolved ability unchanged (same reference) when nothing is reserved', () => {
    const sim = hunterSim('marksmanship', 219);
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, base)).toBe(base);
  });

  it('leaves an ineligible ability unchanged even with a live reservation, and does not consume it', () => {
    const sim = hunterSim('marksmanship', 220);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const sting = sim.resolvedAbility('serpent_sting');
    if (!sting) throw new Error('expected serpent_sting to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, sting)).toBe(sting);
    const aimed = sim.resolvedAbility('aimed_shot');
    if (!aimed) throw new Error('expected aimed_shot to resolve');
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, aimed)).not.toBe(aimed);
  });

  it('only consumes once: a second resolve of the same ability finds nothing left', () => {
    const sim = hunterSim('marksmanship', 221);
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    consumeColdsightReadReservation(sim.ctx, sim.player, base);
    expect(consumeColdsightReadReservation(sim.ctx, sim.player, base)).toBe(base);
  });
});

// Review should-fix (PR 3917, f8b95339f0): the three internal markers must
// never put an 'aura' event on the wire (only the real 10s Read may).
describe('Internal bookkeeping markers never emit an aura event (v0.42.0 review fix)', () => {
  it('channel start emits no aura event', () => {
    const sim = hunterSim('marksmanship', 222);
    const events = captureEmittedEvents(sim);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    expect(auraEvents(events)).toHaveLength(0);
  });

  it('channel completion emits only the real Coldsight Read grant', () => {
    const sim = hunterSim('marksmanship', 223);
    const target = liveTarget(sim);
    const events = captureEmittedEvents(sim);
    fullFeveredDraw(sim, target);
    const auras = auraEvents(events);
    expect(auras.filter((e) => e.name === 'Fevered Draw')).toHaveLength(0);
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ gained: true, name: 'Coldsight Read' });
  });

  it('reserving at cast-accept emits only the real buff fade, never a marker gain', () => {
    const sim = hunterSim('marksmanship', 224);
    fullFeveredDraw(sim, liveTarget(sim));
    const events = captureEmittedEvents(sim);
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const auras = auraEvents(events);
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ gained: false, name: 'Coldsight Read' });
  });

  it('consuming the reservation on a landed hit emits no aura event', () => {
    const sim = hunterSim('marksmanship', 225);
    const base = sim.resolvedAbility('aimed_shot');
    if (!base) throw new Error('expected aimed_shot to resolve');
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    const events = captureEmittedEvents(sim);
    consumeColdsightReadReservation(sim.ctx, sim.player, base);
    expect(auraEvents(events)).toHaveLength(0);
  });

  it('cancelling an accepted cast voids the reservation marker silently', () => {
    const sim = hunterSim('marksmanship', 226);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_read_reserved_aimed_shot')).toBe(
      true,
    );
    const events = captureEmittedEvents(sim);
    coldsightVoidReservationOnCancel(sim.ctx, sim.player, 'aimed_shot');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_read_reserved_aimed_shot')).toBe(
      false,
    );
    expect(auraEvents(events)).toHaveLength(0);
  });

  it('cancelling a channel voids the progress marker silently', () => {
    const sim = hunterSim('marksmanship', 227);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_fevered_draw_progress')).toBe(
      true,
    );
    const events = captureEmittedEvents(sim);
    coldsightVoidReservationOnCancel(sim.ctx, sim.player, 'rapid_fire');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_fevered_draw_progress')).toBe(
      false,
    );
    expect(auraEvents(events)).toHaveLength(0);
  });

  it('respec sweeps the progress marker silently', () => {
    const sim = hunterSim('marksmanship', 228);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_fevered_draw_progress')).toBe(
      true,
    );
    const events = captureEmittedEvents(sim);
    cleanColdsightReadState(sim.ctx, sim.player);
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_fevered_draw_progress')).toBe(
      false,
    );
    expect(auraEvents(events).filter((e) => e.name === 'Fevered Draw')).toHaveLength(0);
  });

  it('respec sweeps a live reservation marker silently', () => {
    const sim = hunterSim('marksmanship', 232);
    fullFeveredDraw(sim, liveTarget(sim));
    coldsightReserveRead(sim.ctx, sim.player, 'aimed_shot');
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_read_reserved_aimed_shot')).toBe(
      true,
    );
    const events = captureEmittedEvents(sim);
    cleanColdsightReadState(sim.ctx, sim.player);
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_read_reserved_aimed_shot')).toBe(
      false,
    );
    // Only the marker is present here (the real buff was already reserved away).
    expect(auraEvents(events)).toHaveLength(0);
  });

  it('respec still emits one fade for a still-armed real Coldsight Read (positive control)', () => {
    const sim = hunterSim('marksmanship', 233);
    fullFeveredDraw(sim, liveTarget(sim));
    const events = captureEmittedEvents(sim);
    cleanColdsightReadState(sim.ctx, sim.player);
    const auras = auraEvents(events);
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ gained: false, name: 'Coldsight Read' });
  });

  it('a marker forced to natural expiry (generic per-tick timer) emits no aura event', () => {
    const sim = hunterSimEmptyWorld('marksmanship', 229);
    coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
    const marker = sim.player.auras.find((a) => a.id === 'hunter_coldsight_fevered_draw_progress');
    if (!marker) throw new Error('expected the progress marker to be present');
    marker.remaining = 0.001; // force imminent expiry instead of the real 86400s timeout
    const events = captureEmittedEvents(sim);
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'hunter_coldsight_fevered_draw_progress')).toBe(
      false,
    );
    expect(auraEvents(events).filter((e) => e.name === 'Fevered Draw')).toHaveLength(0);
  });
});

// Positive controls: the guard above is exact-id, not a broad internal_cd
// silence, so the real buff's own natural expiry and an unrelated internal_cd
// aura's expiry must both still emit.
describe('Natural expiry positive controls: unaffected auras still emit (no broad silence)', () => {
  it('the real Coldsight Read buff naturally expiring still emits one fade', () => {
    const sim = hunterSimEmptyWorld('marksmanship', 230);
    fullFeveredDraw(sim, liveTarget(sim));
    const real = sim.player.auras.find((a) => a.id === 'hunter_coldsight_read');
    if (!real) throw new Error('expected the real Coldsight Read buff to be armed');
    real.remaining = 0.001;
    const events = captureEmittedEvents(sim);
    sim.tick();
    const auras = auraEvents(events);
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ gained: false, name: 'Coldsight Read' });
  });

  it('an unrelated internal_cd aura naturally expiring still emits one fade', () => {
    const sim = hunterSimEmptyWorld('marksmanship', 231);
    sim.player.auras.push({
      id: 'heating_up',
      name: 'Heating Up',
      kind: 'internal_cd',
      remaining: 0.001,
      duration: 10,
      value: 0,
      sourceId: sim.player.id,
      school: 'physical',
    });
    const events = captureEmittedEvents(sim);
    sim.tick();
    const auras = auraEvents(events);
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ gained: false, name: 'Heating Up' });
  });
});

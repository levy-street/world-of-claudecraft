// Thundercall v0.44.0 rework (docs/prd/shaman-thundercall-elemental-v028.md,
// "v0.44.0 rework"): partial Thunder vents, Arc Overload, Magma Burst with
// Magma Surge, Stormbreak, and classic 5/5 Lightning Mastery.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearThundercallState,
  MAGMA_SURGE_ID,
  PRIMAL_MASTERY_VENT_ID,
  thundercallPayoffGlowActive,
} from '../src/sim/combat/shaman_thundercall';
import {
  ARC_OVERLOAD_CHANCE,
  MAGMA_SURGE_CHANCE,
  rollArcOverload,
  STORMBREAK_MANA_FRACTION,
  thundercallOnDotTick,
} from '../src/sim/combat/shaman_thundercall_kit';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentRowLevel,
} from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

const THUNDER_CHARGES_ID = 'shaman_thunder_charges';
const ECHOING_ELEMENTS = 'sha_r20_elemental_fury';

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(entity);
}

function setup(options: { spec?: string; level?: number; talents?: Record<number, string> } = {}): {
  sim: Sim;
  shaman: Entity;
  target: Entity;
} {
  const sim = new Sim({ seed: 2802, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Stormcaller');
  sim.setPlayerLevel(options.level ?? 20, pid);
  expect(sim.setSpec(options.spec ?? 'elemental', pid)).toBe(true);
  for (const [row, talent] of Object.entries(options.talents ?? {})) {
    expect(sim.selectTalentRow(Number(row) as TalentRowLevel, talent, pid)).toBe(true);
  }
  const shaman = sim.entities.get(pid);
  if (!shaman) throw new Error('missing shaman');
  shaman.resource = shaman.maxResource;
  place(sim, shaman, 700, 0);
  const target = createMob(90_101, MOBS.training_dummy, 20, sim.groundPos(700, 6));
  target.hostile = true;
  target.hp = target.maxHp = 999_999;
  sim.entities.set(target.id, target);
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(target);
  sim.targetEntity(target.id, pid);
  shaman.facing = Math.atan2(target.pos.x - shaman.pos.x, target.pos.z - shaman.pos.z);
  sim.drainEvents();
  return { sim, shaman, target };
}

function seedThunder(entity: Entity, stacks: number): void {
  entity.auras.push({
    id: THUNDER_CHARGES_ID,
    name: 'Thunder Charges',
    kind: 'internal_cd',
    remaining: 3600,
    duration: 3600,
    value: 0,
    stacks,
    sourceId: entity.id,
    school: 'nature',
  });
}

function thunder(entity: Entity): number {
  return entity.auras.find((aura) => aura.id === THUNDER_CHARGES_ID)?.stacks ?? 0;
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...sim.tick());
  return events;
}

function cast(sim: Sim, shaman: Entity, abilityId: string, ticks = 20 * 4): SimEvent[] {
  shaman.resource = shaman.maxResource;
  shaman.gcdRemaining = 0;
  // Clear the whole shared shock group, not just the pressed id.
  for (const id of [abilityId, 'earth_shock', 'flame_shock', 'frost_shock'])
    shaman.cooldowns.delete(id);
  sim.castAbility(abilityId, shaman.id);
  return run(sim, ticks);
}

function hits(
  events: readonly SimEvent[],
  ability: string,
): Extract<SimEvent, { type: 'damage' }>[] {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === ability && event.kind === 'hit',
  );
}

function cinderDot(shaman: Entity): Aura {
  return {
    id: 'flame_shock',
    name: 'Cinder Jolt',
    kind: 'dot',
    value: 12,
    remaining: 12,
    duration: 12,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: shaman.id,
    school: 'fire',
  };
}

// Lands every hit-table roll (high probabilities) while failing every crit,
// resist, and proc roll (low probabilities), so damage compares cleanly.
function landNoCrit(sim: Sim): void {
  vi.spyOn(sim.rng, 'chance').mockImplementation((p: number) => p >= 0.5);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Thundercall v0.44 partial vents', () => {
  it('vents a partial bank per Thunder and consumes it whole', () => {
    const full = setup();
    seedThunder(full.shaman, 5);
    landNoCrit(full.sim);
    const fullHit = hits(cast(full.sim, full.shaman, 'earth_shock', 20), 'Earthen Jolt')[0];

    const partial = setup();
    seedThunder(partial.shaman, 2);
    landNoCrit(partial.sim);
    const partialHit = hits(
      cast(partial.sim, partial.shaman, 'earth_shock', 20),
      'Earthen Jolt',
    )[0];

    const empty = setup();
    landNoCrit(empty.sim);
    const emptyHit = hits(cast(empty.sim, empty.shaman, 'earth_shock', 20), 'Earthen Jolt')[0];

    expect(thunder(partial.shaman)).toBe(0);
    // Same seed, same roll: 2.25x at 5, 1.5x at 2, 1x at 0 (within rounding).
    expect(partialHit.amount / emptyHit.amount).toBeCloseTo(1.5, 1);
    expect(fullHit.amount / emptyHit.amount).toBeCloseTo(2.25, 1);
  });

  it('keeps the full-bank riders (Echoing Elements, Primal Mastery) for a full vent only', () => {
    const { sim, shaman, target } = setup({ talents: { 20: ECHOING_ELEMENTS } });
    shaman.auras.push({
      id: PRIMAL_MASTERY_VENT_ID,
      name: 'Primal Mastery',
      kind: 'internal_cd',
      value: 0.25,
      remaining: 12,
      duration: 12,
      sourceId: shaman.id,
      school: 'nature',
    });
    seedThunder(shaman, 3);
    const partial = cast(sim, shaman, 'earth_shock', 60);
    expect(thunder(shaman)).toBe(0);
    expect(hits(partial, 'Echoing Elements')).toHaveLength(0);
    expect(shaman.auras.some((aura) => aura.id === PRIMAL_MASTERY_VENT_ID)).toBe(true);

    seedThunder(shaman, 5);
    const full = cast(sim, shaman, 'earth_shock', 60);
    expect(hits(full, 'Echoing Elements').every((hit) => hit.targetId === target.id)).toBe(true);
    expect(hits(full, 'Echoing Elements')).toHaveLength(1);
    expect(shaman.auras.some((aura) => aura.id === PRIMAL_MASTERY_VENT_ID)).toBe(false);
  });
});

describe('Thundercall v0.44 Arc Overload', () => {
  it('repeats a landed Arc Bolt for half its damage and banks one extra Thunder', () => {
    const { sim, shaman } = setup();
    const real = sim.rng.chance.bind(sim.rng);
    vi.spyOn(sim.rng, 'chance').mockImplementation((p: number) =>
      p === ARC_OVERLOAD_CHANCE ? true : real(p),
    );
    const events = cast(sim, shaman, 'lightning_bolt');
    const bolt = hits(events, 'Arc Bolt')[0];
    const overload = hits(events, 'Arc Overload')[0];
    expect(bolt).toBeDefined();
    expect(overload?.amount).toBe(Math.max(1, Math.round(bolt.amount * 0.5)));
    expect(thunder(shaman)).toBe(2);
  });

  it('never overloads (or draws) for another spec or below the passive level', () => {
    for (const options of [{ spec: 'enhancement' }, { level: 9 }]) {
      const { sim, shaman, target } = setup(options);
      const chance = vi.spyOn(sim.rng, 'chance');
      expect(rollArcOverload(sim.ctx, shaman, target, 'lightning_bolt', 100, 100)).toBe(false);
      expect(chance).not.toHaveBeenCalled();
    }
  });

  it('never rolls for a hit that dealt nothing (evade, immunity)', () => {
    const { sim, shaman, target } = setup();
    const chance = vi.spyOn(sim.rng, 'chance');
    expect(rollArcOverload(sim.ctx, shaman, target, 'lightning_bolt', 100, 0)).toBe(false);
    expect(chance).not.toHaveBeenCalled();
  });

  it('applies the caster’s damage-done modifiers to the copy once, so it stays half the bolt', () => {
    const { sim, shaman } = setup();
    shaman.auras.push({
      id: 'test_damage_done',
      name: 'Test Fury',
      kind: 'buff_dmg_done',
      value: 0.5,
      remaining: 60,
      duration: 60,
      sourceId: shaman.id,
      school: 'physical',
    });
    // Land every hit, fail crits, force the overload (its chance is below 0.5).
    vi.spyOn(sim.rng, 'chance').mockImplementation(
      (p: number) => p === ARC_OVERLOAD_CHANCE || p >= 0.5,
    );
    const events = cast(sim, shaman, 'lightning_bolt');
    const bolt = hits(events, 'Arc Bolt')[0];
    const overload = hits(events, 'Arc Overload')[0];
    expect(bolt).toBeDefined();
    // Within one point of rounding: a pre-fix copy skipped the 1.5x and landed near a third.
    expect(Math.abs((overload?.amount ?? 0) - bolt.amount / 2)).toBeLessThanOrEqual(1);
  });

  it('overloads Skybranch on its first target and banks the extra Thunder', () => {
    const { sim, shaman, target } = setup();
    vi.spyOn(sim.rng, 'chance').mockImplementation(
      (p: number) => p === ARC_OVERLOAD_CHANCE || p >= 0.5,
    );
    const events = cast(sim, shaman, 'chain_lightning');
    const first = hits(events, 'Skybranch').find((hit) => hit.targetId === target.id);
    const overload = hits(events, 'Arc Overload');
    expect(first).toBeDefined();
    expect(overload).toHaveLength(1);
    expect(overload[0].targetId).toBe(target.id);
    expect(Math.abs(overload[0].amount - (first?.amount ?? 0) / 2)).toBeLessThanOrEqual(1);
    // One Thunder for the landed chain plus one for the overload.
    expect(thunder(shaman)).toBe(2);
  });
});

describe('Thundercall v0.44 Magma Burst and Magma Surge', () => {
  it('always crits a target burning with the caster’s own Cinder Jolt', () => {
    const { sim, shaman, target } = setup();
    landNoCrit(sim);
    const plain = hits(cast(sim, shaman, 'lava_burst'), 'Magma Burst')[0];
    expect(plain?.crit).toBe(false);

    target.auras.push({ ...cinderDot(shaman), sourceId: 424_242 });
    const foreign = hits(cast(sim, shaman, 'lava_burst'), 'Magma Burst')[0];
    expect(foreign?.crit).toBe(false);

    target.auras.push(cinderDot(shaman));
    const burning = hits(cast(sim, shaman, 'lava_burst'), 'Magma Burst')[0];
    expect(burning?.crit).toBe(true);
  });

  it('a Cinder Jolt tick can reset Magma Burst and make it instant', () => {
    const { sim, shaman } = setup();
    shaman.cooldowns.set('lava_burst', 8);
    // Forces the surge roll and every hit-table roll; fails crits.
    vi.spyOn(sim.rng, 'chance').mockImplementation(
      (p: number) => p === MAGMA_SURGE_CHANCE || p >= 0.5,
    );
    thundercallOnDotTick(sim.ctx, shaman, cinderDot(shaman), 12);
    expect(shaman.cooldowns.has('lava_burst')).toBe(false);
    const surge = shaman.auras.find((aura) => aura.id === MAGMA_SURGE_ID);
    expect(surge?.kind).toBe('next_cast_instant');
    expect(surge?.empowerAbilities).toEqual(['lava_burst']);
    expect(thundercallPayoffGlowActive(shaman.auras, 'lava_burst')).toBe(true);
    expect(thundercallPayoffGlowActive(shaman.auras, 'lightning_bolt')).toBe(false);

    // The surged cast completes the moment it is pressed (no cast bar), then
    // the bolt travels and lands.
    shaman.gcdRemaining = 0;
    shaman.resource = shaman.maxResource;
    sim.castAbility('lava_burst', shaman.id);
    sim.tick();
    expect(shaman.auras.some((aura) => aura.id === MAGMA_SURGE_ID)).toBe(false);
    expect(shaman.cooldowns.get('lava_burst')).toBeGreaterThan(7);
    expect(hits(run(sim, 40), 'Magma Burst')).toHaveLength(1);
  });

  it('only a Thundercall’s own Cinder Jolt draws a surge roll', () => {
    const warspirit = setup({ spec: 'enhancement' });
    const chance = vi.spyOn(warspirit.sim.rng, 'chance');
    thundercallOnDotTick(warspirit.sim.ctx, warspirit.shaman, cinderDot(warspirit.shaman), 12);
    expect(chance).not.toHaveBeenCalled();

    const thundercall = setup();
    const otherDot = { ...cinderDot(thundercall.shaman), id: 'shadow_word_pain' };
    const chance2 = vi.spyOn(thundercall.sim.rng, 'chance');
    thundercallOnDotTick(thundercall.sim.ctx, thundercall.shaman, otherDot, 12);
    expect(chance2).not.toHaveBeenCalled();
  });

  it('draws no surge roll for a tick that dealt nothing or while Magma Burst is being cast', () => {
    const { sim, shaman } = setup();
    const chance = vi.spyOn(sim.rng, 'chance');
    thundercallOnDotTick(sim.ctx, shaman, cinderDot(shaman), 0);
    shaman.castingAbility = 'lava_burst';
    thundercallOnDotTick(sim.ctx, shaman, cinderDot(shaman), 12);
    expect(chance).not.toHaveBeenCalled();
  });

  it('surges from a real Cinder Jolt tick in the aura loop', () => {
    const { sim, shaman, target } = setup();
    shaman.cooldowns.set('lava_burst', 8);
    target.auras.push({ ...cinderDot(shaman), tickTimer: 0.05 });
    vi.spyOn(sim.rng, 'chance').mockImplementation(
      (p: number) => p === MAGMA_SURGE_CHANCE || p >= 0.5,
    );
    const events = run(sim, 4);
    expect(hits(events, 'Cinder Jolt').length).toBeGreaterThan(0);
    expect(shaman.auras.some((aura) => aura.id === MAGMA_SURGE_ID)).toBe(true);
    expect(shaman.cooldowns.has('lava_burst')).toBe(false);
  });

  it('clears the surge with the rest of the Thundercall state on a spec change', () => {
    const { sim, shaman } = setup();
    vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
    thundercallOnDotTick(sim.ctx, shaman, cinderDot(shaman), 12);
    expect(shaman.auras.some((aura) => aura.id === MAGMA_SURGE_ID)).toBe(true);
    clearThundercallState(sim.ctx, shaman);
    expect(shaman.auras.some((aura) => aura.id === MAGMA_SURGE_ID)).toBe(false);
  });
});

describe('Thundercall v0.44 Stormbreak and Lightning Mastery', () => {
  it('Stormbreak damages and slows nearby enemies and returns 8% maximum Mana', () => {
    const { sim, shaman, target } = setup();
    shaman.gcdRemaining = 0;
    shaman.resource = 100;
    sim.castAbility('thunderstorm', shaman.id);
    const events = sim.tick();
    expect(hits(events, 'Stormbreak').some((hit) => hit.targetId === target.id)).toBe(true);
    expect(shaman.resource).toBe(100 + Math.round(shaman.maxResource * STORMBREAK_MANA_FRACTION));
    expect(target.auras.some((aura) => aura.kind === 'slow')).toBe(true);
    expect(shaman.cooldowns.get('thunderstorm')).toBeGreaterThan(40);
  });

  it('takes the classic 1.0 sec off rank-4 Arc Bolt and the same share off Skybranch', () => {
    const known = abilitiesKnownAt(
      'shaman',
      20,
      computeTalentModifiers('shaman', { ...emptyAllocation(), spec: 'elemental' }),
    );
    expect(known.find((a) => a.def.id === 'lightning_bolt')?.castTime).toBeCloseTo(2.0, 5);
    expect(known.find((a) => a.def.id === 'chain_lightning')?.castTime).toBeCloseTo(
      2.5 * (2 / 3),
      5,
    );
    for (const id of ['lava_burst', 'lightning_overload', 'thunderstorm']) {
      expect(
        known.some((a) => a.def.id === id),
        id,
      ).toBe(true);
    }
    const warspirit = abilitiesKnownAt(
      'shaman',
      20,
      computeTalentModifiers('shaman', { ...emptyAllocation(), spec: 'enhancement' }),
    );
    for (const id of ['lava_burst', 'lightning_overload', 'thunderstorm']) {
      expect(
        warspirit.some((a) => a.def.id === id),
        id,
      ).toBe(false);
    }
  });
});

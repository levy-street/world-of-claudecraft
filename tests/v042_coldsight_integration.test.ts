// Coldsight v0.42 real coordinator integration (docs/design/class-balance-v042.md):
// drives a live Sim through castAbility/tick to prove the actual wiring in
// src/sim/combat/casting_lifecycle.ts, not just the exported helpers
// (see tests/v042_coldsight_read.test.ts for the unit-level coverage).
import { describe, expect, it } from 'vitest';
import { cancelCast, pushbackCast } from '../src/sim/combat/casting_lifecycle';
import {
  coldsightFeveredDrawChannelStart,
  coldsightFeveredDrawCompleted,
  coldsightFeveredDrawPulse,
  coldsightReadArmed,
  FEVERED_DRAW_PULSE_COUNT,
} from '../src/sim/combat/hunter_coldsight_read';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & { ctx: SimContext; addEntity(e: Entity): void; nextId: number };

function marksmanHunter(seed: number): TestSim {
  const sim = new Sim({
    seed,
    playerClass: 'hunter',
    autoEquip: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('marksmanship')).toBe(true);
  // Isolate charge timing and packet size from random misses and crits.
  sim.rng.chance = (probability) => probability > 0.5;
  return sim;
}

function addDummy(sim: TestSim, dist = 20): Entity {
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + dist,
  });
  mob.hostile = true;
  mob.moveSpeed = 0;
  mob.aiState = 'idle';
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

function ready(sim: Sim, abilityId: string): void {
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.delete(abilityId);
}

// Grants the opportunity directly through the exported grant seam (no rng
// draws), so a damage-ratio comparison against an unarmed run stays on the
// identical rng draw order. The real end-to-end channel path (Sim.tick
// driving rapid_fire to completion) is covered separately below.
function armColdsightRead(sim: TestSim, target: Entity): void {
  coldsightFeveredDrawChannelStart(sim.ctx, sim.player, 'rapid_fire');
  for (let i = 0; i < FEVERED_DRAW_PULSE_COUNT; i++) {
    coldsightFeveredDrawPulse(sim.ctx, sim.player, 'rapid_fire');
  }
  coldsightFeveredDrawCompleted(sim.ctx, sim.player, 'rapid_fire', target);
  expect(coldsightReadArmed(sim.player)).toBe(true);
}

function landedHit(events: SimEvent[], abilityName: string): number {
  const hit = events.find(
    (e) =>
      e.type === 'damage' &&
      (e as { kind?: string }).kind === 'hit' &&
      (e as { ability?: string | null }).ability === abilityName,
  ) as (SimEvent & { amount: number }) | undefined;
  if (!hit) throw new Error(`no landed hit for ${abilityName}`);
  return hit.amount;
}

describe('Fevered Draw real channel: grant only on a full, valid run', () => {
  it('six real ticks through Sim.tick grant exactly one charge', () => {
    const sim = marksmanHunter(301);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('rapid_fire');
    expect(sim.player.channeling).toBe(true);
    while (sim.player.castingAbility) sim.tick();
    expect(coldsightReadArmed(sim.player)).toBe(true);
    expect(sim.player.auras.filter((a) => a.kind === 'hunter_coldsight_read')).toHaveLength(1);
  });

  it('a fully absorbed channel still grants Read after all six shots fire', () => {
    const sim = marksmanHunter(312);
    const target = addDummy(sim);
    target.auras.push({
      id: 'test_absorb',
      name: 'Shield',
      kind: 'absorb',
      value: 1_000_000,
      duration: 30,
      remaining: 30,
      sourceId: target.id,
      school: 'holy',
    });
    sim.targetEntity(target.id);
    sim.castAbility('rapid_fire');
    advance(sim, 3);
    expect(target.hp).toBe(target.maxHp);
    expect(target.auras.find((a) => a.id === 'test_absorb')?.value).toBeLessThan(1_000_000);
    expect(coldsightReadArmed(sim.player)).toBe(true);
  });

  it('an interrupted channel (silence/stun-shaped cancel) grants nothing', () => {
    const sim = marksmanHunter(302);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('rapid_fire');
    advance(sim, 0.5);
    const progress = sim.player.auras.find(
      (a) => a.id === 'hunter_coldsight_fevered_draw_progress',
    );
    expect(progress?.value).toBeGreaterThan(0);
    expect(progress?.value).toBeLessThan(6);
    cancelCast(sim.ctx, sim.player);
    expect(sim.player.auras.some((a) => a.id.startsWith('hunter_coldsight_'))).toBe(false);
    expect(sim.player.castingAbility).toBeNull();
    advance(sim, 3);
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('the target dying mid-channel cancels the cast and grants nothing', () => {
    const sim = marksmanHunter(303);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('rapid_fire');
    sim.tick();
    // A manual `target.dead = true` auto-resurrects almost immediately (an
    // uninitialized corpse/respawn timer decays to zero on the very next mob
    // update): kill it through the real damage pipeline instead.
    // biome-ignore lint/suspicious/noExplicitAny: reaching a private Sim method, matching tests/CLAUDE.md convention
    (sim as any).dealDamage(sim.player, target, target.hp, false, 'physical', 'Test', 'hit');
    expect(target.dead).toBe(true);
    advance(sim, 3);
    expect(sim.player.castingAbility).toBeNull();
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });

  it('a pushback-shortened channel (fewer than six real pulses) grants nothing', () => {
    const sim = marksmanHunter(304);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('rapid_fire');
    pushbackCast(sim.player);
    pushbackCast(sim.player);
    pushbackCast(sim.player);
    while (sim.player.castingAbility) sim.tick();
    expect(coldsightReadArmed(sim.player)).toBe(false);
  });
});

describe('Reserve at accept: rejected never spends, an accepted-then-interrupted cast does', () => {
  it('insufficient Focus never reaches accept: the opportunity stays armed', () => {
    const sim = marksmanHunter(305);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    armColdsightRead(sim, target);
    sim.player.resource = 0;
    ready(sim, 'aimed_shot');
    sim.castAbility('aimed_shot');
    expect(sim.player.castingAbility).toBeNull();
    expect(coldsightReadArmed(sim.player)).toBe(true);
  });

  it('out of range never reaches accept: the opportunity stays armed', () => {
    const sim = marksmanHunter(306);
    const target = addDummy(sim, 200);
    sim.targetEntity(target.id);
    armColdsightRead(sim, target);
    sim.player.resource = sim.player.maxResource;
    ready(sim, 'aimed_shot');
    sim.castAbility('aimed_shot');
    expect(sim.player.castingAbility).toBeNull();
    expect(coldsightReadArmed(sim.player)).toBe(true);
  });

  it('an accepted Long Draw interrupted mid-cast has already spent it: no refund, no leak to a later cast', () => {
    const sim = marksmanHunter(307);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    armColdsightRead(sim, target);
    sim.player.resource = sim.player.maxResource;
    ready(sim, 'aimed_shot');
    sim.castAbility('aimed_shot');
    expect(sim.player.castingAbility).toBe('aimed_shot');
    expect(coldsightReadArmed(sim.player)).toBe(false); // reserved at accept, already gone
    cancelCast(sim.ctx, sim.player);
    const events = advance(sim, 4);
    expect(events.some((e) => e.type === 'damage' && (e as { kind?: string }).kind === 'hit')).toBe(
      false,
    );
    expect(coldsightReadArmed(sim.player)).toBe(false);
    // A later, otherwise-eligible cast must not inherit the voided reservation.
    sim.player.resource = sim.player.maxResource;
    ready(sim, 'aimed_shot');
    sim.castAbility('aimed_shot');
    const later = advance(sim, 4);
    const dealt = landedHit(later, 'Long Draw');
    const unarmedBaseline = (() => {
      const control = marksmanHunter(307);
      const controlTarget = addDummy(control);
      control.targetEntity(controlTarget.id);
      control.player.resource = control.player.maxResource;
      ready(control, 'aimed_shot');
      control.castAbility('aimed_shot');
      cancelCast(control.ctx, control.player);
      advance(control, 4); // mirror the same rng draw / tick history exactly
      control.player.resource = control.player.maxResource;
      ready(control, 'aimed_shot');
      control.castAbility('aimed_shot');
      return landedHit(advance(control, 4), 'Long Draw');
    })();
    expect(dealt).toBe(unarmedBaseline);
  });

  it('an ineligible spender never consumes the armed opportunity', () => {
    const sim = marksmanHunter(308);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    armColdsightRead(sim, target);
    sim.player.resource = sim.player.maxResource;
    ready(sim, 'serpent_sting');
    sim.castAbility('serpent_sting');
    expect(coldsightReadArmed(sim.player)).toBe(true);
  });
});

describe('Complete-hit damage: the promised multiplier, including AP, at identical rng draw', () => {
  it('Long Draw lands +50% and Fell Shot lands +75% versus an unarmed baseline', () => {
    const seed = 309001;

    function runAimedShot(armed: boolean): number {
      const sim = marksmanHunter(seed);
      const target = addDummy(sim);
      if (armed) armColdsightRead(sim, target);
      sim.targetEntity(target.id);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('aimed_shot');
      return landedHit(advance(sim, 4), 'Long Draw');
    }
    function runArcaneShot(armed: boolean): number {
      const sim = marksmanHunter(seed + 1);
      const target = addDummy(sim);
      if (armed) armColdsightRead(sim, target);
      sim.targetEntity(target.id);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('arcane_shot');
      return landedHit(advance(sim, 1), 'Fell Shot');
    }

    // The real pipeline applies damageMult to the unrounded hit and rounds
    // ONCE; comparing against an already-rounded baseline double-rounds, so
    // allow the resulting +/-1 slack rather than exact equality.
    const baseAimed = runAimedShot(false);
    const boostedAimed = runAimedShot(true);
    expect(Math.abs(boostedAimed - baseAimed * 1.5)).toBeLessThanOrEqual(1);
    expect(boostedAimed).toBeGreaterThan(baseAimed); // substantial: base+AP both scaled

    const baseArcane = runArcaneShot(false);
    const boostedArcane = runArcaneShot(true);
    expect(Math.abs(boostedArcane - baseArcane * 1.75)).toBeLessThanOrEqual(1);
  });

  it('keeps one empowered Long Draw after pushback extends the cast beyond ten seconds', () => {
    function run(armed: boolean): number {
      const sim = marksmanHunter(310);
      const target = addDummy(sim);
      if (armed) armColdsightRead(sim, target);
      sim.targetEntity(target.id);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('aimed_shot');
      for (let i = 0; i < 24; i++) pushbackCast(sim.player);
      expect(sim.player.castRemaining).toBeGreaterThan(10);
      const early = advance(sim, 10);
      expect(early.some((e) => e.type === 'damage' && e.ability === 'Long Draw')).toBe(false);
      expect(sim.player.castingAbility).toBe('aimed_shot');
      const late = advance(sim, 10);
      expect(
        late.filter((e) => e.type === 'damage' && e.kind === 'hit' && e.ability === 'Long Draw'),
      ).toHaveLength(1);
      expect(sim.player.auras.some((a) => a.id.startsWith('hunter_coldsight_read'))).toBe(false);
      return landedHit(late, 'Long Draw');
    }
    const ordinary = run(false);
    const empowered = run(true);
    expect(Math.abs(empowered - ordinary * 1.5)).toBeLessThanOrEqual(1);
  });
});

describe('Respec clears every marker (same-class negative control)', () => {
  it('leaving marksmanship drops the armed opportunity, so another spec never sees it', () => {
    const sim = marksmanHunter(311);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    armColdsightRead(sim, target);
    expect(sim.applyTalents({ spec: 'survival', rows: {} })).toBe(true);
    expect(coldsightReadArmed(sim.player)).toBe(false);
    sim.player.resource = sim.player.maxResource;
    ready(sim, 'arcane_shot');
    sim.castAbility('arcane_shot');
    const dealt = landedHit(advance(sim, 1), 'Fell Shot');

    const control = marksmanHunter(311);
    expect(control.applyTalents({ spec: 'survival', rows: {} })).toBe(true);
    const controlTarget = addDummy(control);
    control.targetEntity(controlTarget.id);
    control.player.resource = control.player.maxResource;
    ready(control, 'arcane_shot');
    control.castAbility('arcane_shot');
    const controlDealt = landedHit(advance(control, 1), 'Fell Shot');
    expect(dealt).toBe(controlDealt);
  });
});

// Review should-fix (PR 3917, f8b95339f0): the real castAbility/tick
// coordinator flow must carry exactly the real buff's gain and spend, no
// marker leakage (unit-level coverage: tests/v042_coldsight_read.test.ts).
describe('Aura event feed carries no internal Coldsight marker leakage (v0.42.0 review fix)', () => {
  it('one Rapid Fire channel plus one accepted Long Draw emits exactly two aura events', () => {
    const sim = marksmanHunter(320);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('rapid_fire');
    const channelEvents = advance(sim, 3); // the full six-pulse channel completes
    expect(coldsightReadArmed(sim.player)).toBe(true);

    sim.player.resource = sim.player.maxResource;
    ready(sim, 'aimed_shot');
    sim.castAbility('aimed_shot');
    const castEvents = advance(sim, 4);
    expect(landedHit(castEvents, 'Long Draw')).toBeGreaterThan(0);

    const events = [...channelEvents, ...castEvents];
    const auras = events.filter((e): e is Extract<SimEvent, { type: 'aura' }> => e.type === 'aura');
    expect(auras.filter((e) => e.name === 'Fevered Draw')).toHaveLength(0);
    expect(auras.filter((e) => e.gained && e.name === 'Coldsight Read')).toHaveLength(1);
    expect(auras.filter((e) => !e.gained && e.name === 'Coldsight Read')).toHaveLength(1);
    expect(auras).toHaveLength(2);
  });

  it('one Rapid Fire channel plus one accepted Fell Shot emits exactly two aura events', () => {
    const sim = marksmanHunter(321);
    const target = addDummy(sim);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('rapid_fire');
    const channelEvents = advance(sim, 3);
    expect(coldsightReadArmed(sim.player)).toBe(true);

    sim.player.resource = sim.player.maxResource;
    ready(sim, 'arcane_shot');
    sim.castAbility('arcane_shot');
    const castEvents = advance(sim, 1);
    expect(landedHit(castEvents, 'Fell Shot')).toBeGreaterThan(0);

    const events = [...channelEvents, ...castEvents];
    const auras = events.filter((e): e is Extract<SimEvent, { type: 'aura' }> => e.type === 'aura');
    expect(auras.filter((e) => e.name === 'Fevered Draw')).toHaveLength(0);
    expect(auras.filter((e) => e.gained && e.name === 'Coldsight Read')).toHaveLength(1);
    expect(auras.filter((e) => !e.gained && e.name === 'Coldsight Read')).toHaveLength(1);
    expect(auras).toHaveLength(2);
  });
});

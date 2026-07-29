// Underwater breath (sim/breath.ts): WoW mirror-timer rules. Sixty seconds of
// lungful, 10x refill on surfacing, and 10% max-hp drowning pulses once the
// lungful is empty — a full-health player has ten seconds to reach air.

import { afterEach, describe, expect, it } from 'vitest';
import {
  BREATH_REFILL_MULT,
  BREATH_SECONDS,
  BREATH_TICKS,
  breathFraction,
  DROWN_PULSE_PCT,
  stepBreathUsedSeconds,
} from '../src/sim/breath';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { isSubmerged, swimSurfaceY } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { HeightStamp, MoveInput, WorldContent } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';

const SEED = 42;
const TPS = 20;
const LAKE = { x: -92, z: 88 };
const DEEP_EDITS: HeightStamp[] = [
  { x: LAKE.x, z: LAKE.z, radius: 14, delta: WATER_LEVEL - 6, falloff: 'flat', mode: 'level' },
];

function deepWorld(): WorldContent {
  return { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [], terrainEdits: DEEP_EDITS };
}

function makeSim(): Sim {
  const world = deepWorld();
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = LAKE.x;
  p.pos.z = LAKE.z;
  p.pos.y = swimSurfaceY(LAKE.x, LAKE.z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = p.vy = p.vz = 0;
  return sim;
}

afterEach(() => setActiveWorldContent(null));

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

function hold(sim: Sim, input: MoveInput, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing player meta');
  Object.assign(meta.moveInput, input);
  for (let i = 0; i < ticks; i++) sim.tick();
  Object.assign(meta.moveInput, mi());
}

describe('underwater breath', () => {
  it('spends the lungful only while submerged, and not at the surface', () => {
    const sim = makeSim();
    hold(sim, mi(), TPS * 3);
    expect(sim.player.breathUsedTicks).toBe(0);
    hold(sim, mi({ dive: true }), TPS * 3);
    expect(isSubmerged(sim.player, SEED)).toBe(true);
    expect(sim.player.breathUsedTicks).toBeGreaterThan(TPS * 1.5);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('drowns for 10% max hp per second once the lungful is empty', () => {
    const sim = makeSim();
    const p = sim.player;
    hold(sim, mi({ dive: true }), TPS * 2);
    expect(isSubmerged(p, SEED)).toBe(true);
    // Fast-forward the lungful to empty rather than simulating a real minute.
    p.breathUsedTicks = BREATH_TICKS;
    const fullHp = p.maxHp;
    hold(sim, mi({ dive: true }), TPS * 3 + 2);
    // Net of out-of-combat regen (which keeps ticking while you drown, like
    // WoW's spirit regen): three gross pulses land in three seconds.
    const expectedPulse = Math.round(fullHp * DROWN_PULSE_PCT);
    expect(fullHp - p.hp).toBeGreaterThanOrEqual(expectedPulse * 2.5);
    expect(fullHp - p.hp).toBeLessThanOrEqual(expectedPulse * 4);
  });

  it('kills a full-health player after roughly ten seconds of drowning', () => {
    // 10%/s gross gives ten seconds on paper; passive regen stretches it by a
    // breath or two, exactly like WoW's out-of-combat spirit regen does.
    const sim = makeSim();
    const p = sim.player;
    hold(sim, mi({ dive: true }), TPS * 2);
    p.breathUsedTicks = BREATH_TICKS;
    p.hp = p.maxHp;
    hold(sim, mi({ dive: true }), TPS * 10);
    expect(p.dead).toBe(false); // not before the ten seconds are up
    hold(sim, mi({ dive: true }), TPS * 4);
    expect(p.dead).toBe(true);
  });

  // updateBreath's reset branch has to actually RUN on a dead player. It was
  // called from inside the tick's `if (!p.dead)` arm, so the branch was
  // unreachable and both counters survived death: the corpse of a drowned
  // player kept a spent lungful and a live drown clock, and resurrecting at an
  // underwater corpse resumed the damage on the spot, with a 1-in-20 chance of
  // a pulse landing on the very first tick back.
  it('resets the lungful and the drown clock on death, so the corpse run starts fresh', () => {
    const sim = makeSim();
    const p = sim.player;
    hold(sim, mi({ dive: true }), TPS * 2);
    p.breathUsedTicks = BREATH_TICKS;
    p.hp = p.maxHp;

    // Stop ON the killing tick: both counters have to still be loaded there, or
    // the reset assertion below would pass against a player who never drowned.
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');
    Object.assign(meta.moveInput, mi({ dive: true }));
    for (let i = 0; i < TPS * 14 && !p.dead; i++) sim.tick();
    Object.assign(meta.moveInput, mi());
    expect(p.dead).toBe(true);
    expect(p.drownTicks).toBeGreaterThan(0);
    expect(p.breathUsedTicks).toBe(BREATH_TICKS);

    // One more tick as a corpse is all it takes: the reset runs for the dead.
    sim.tick();
    expect(p.breathUsedTicks).toBe(0);
    expect(p.drownTicks).toBe(0);
  });

  it('does not resume drowning damage the instant a corpse is resurrected underwater', () => {
    const sim = makeSim();
    const p = sim.player;
    hold(sim, mi({ dive: true }), TPS * 2);
    p.breathUsedTicks = BREATH_TICKS;
    p.hp = p.maxHp;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');
    Object.assign(meta.moveInput, mi({ dive: true }));
    for (let i = 0; i < TPS * 14 && !p.dead; i++) sim.tick();
    Object.assign(meta.moveInput, mi());
    expect(p.dead).toBe(true);
    sim.tick(); // the corpse tick that clears the lungs

    // Rez in place, still under the surface. The first live tick must spend a
    // fresh lungful, not pick the drown clock back up where it left off.
    p.dead = false;
    p.ghost = false;
    p.hp = p.maxHp;
    expect(isSubmerged(p, SEED)).toBe(true);
    hold(sim, mi({ dive: true }), 1);
    expect(p.hp).toBe(p.maxHp);
    expect(p.drownTicks).toBe(0);
    expect(p.breathUsedTicks).toBe(1);
  });

  it('refills ten times as fast at the surface and stops the drown clock', () => {
    const sim = makeSim();
    const p = sim.player;
    hold(sim, mi({ dive: true }), TPS * 4);
    const spent = p.breathUsedTicks;
    expect(spent).toBeGreaterThan(TPS * 2);
    // Space rises and hops; hold the surface long enough to refill.
    hold(sim, mi({ jump: true }), TPS * 2);
    hold(sim, mi(), Math.ceil(spent / BREATH_REFILL_MULT) + TPS);
    expect(p.breathUsedTicks).toBe(0);
    expect(p.drownTicks).toBe(0);
    expect(p.hp).toBe(p.maxHp);
  });

  it('display mirror: fraction drains over BREATH_SECONDS and refills at 10x', () => {
    let used = 0;
    for (let i = 0; i < 100; i++) used = stepBreathUsedSeconds(used, true, 0.1);
    expect(breathFraction(used)).toBeCloseTo(1 - 10 / BREATH_SECONDS, 3);
    for (let i = 0; i < 11; i++) used = stepBreathUsedSeconds(used, false, 0.1);
    expect(breathFraction(used)).toBeCloseTo(1, 2);
  });
});

// Vaulting Charge on a rift's raised deck (player report, Warlord Grask in an
// S-rank rift: "leap doesn't work on the black platform"). A rift's raised tier
// is a Y lift the sim strips before every movement step and re-applies after it
// (player_movement_modes.ts / rift/runs.ts riftPlayerLift), so a flight armed in
// the LIFTED frame read the strip on its first tick as an outside relocation and
// cancelled itself: the cooldown was spent and the warrior never left the deck.
import { describe, expect, it } from 'vitest';
import { riftInstanceOrigin } from '../src/sim/data';
import { devHoardDestination, enterDevHoard } from '../src/sim/dev/hoard_travel';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import type { RiftFloorPlan, RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';

function raisedRoom(): { sim: Sim; inst: RiftInstance; floor: RiftFloorPlan } {
  const destination = devHoardDestination(
    'mushroom',
    'rare',
    (seed) => generateRiftFloor(seed, RIFT_RANK_BASE_LEVEL.B, 0).platform !== null,
  );
  if (!destination) throw new Error('no raised room in the search');
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  enterDevHoard(sim.ctx, sim.player.id, destination);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing room');
  // The boss is not under test: keep the room quiet.
  for (const id of inst.mobIds) {
    const mob = sim.entities.get(id);
    if (mob) sim.ctx.handleDeath(mob, sim.player);
  }
  if (inst.bossId !== null) {
    const boss = sim.entities.get(inst.bossId);
    if (boss) sim.ctx.handleDeath(boss, sim.player);
  }
  const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex);
  return { sim, inst, floor };
}

/** Stand the player at instance-local (x, z) and let one tick seat the lift. */
function standAt(sim: Sim, inst: RiftInstance, localX: number, localZ: number): void {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const p = sim.player;
  p.pos = sim.ctx.groundPos(origin.x + localX, origin.z + localZ);
  p.prevPos = { ...p.pos };
  p.leap = null;
  sim.tick();
}

function leap(sim: Sim, inst: RiftInstance, localX: number, localZ: number) {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const p = sim.player;
  p.gcdRemaining = 0;
  p.cooldowns.delete('heroic_leap');
  const from = { ...p.pos };
  sim.castAbility('heroic_leap', p.id, { x: origin.x + localX, z: origin.z + localZ });
  const armed = p.leap !== null;
  let airborne = false;
  for (let t = 0; t < 30; t++) {
    sim.tick();
    if (p.leap) airborne = true;
  }
  return { from, armed, airborne, to: { ...p.pos } };
}

describe('Vaulting Charge on a rift raised deck', () => {
  it('leaps ACROSS the deck and lands on it, never cancelling in the air', () => {
    const { sim, inst, floor } = raisedRoom();
    const platform = floor.platform;
    if (!platform) throw new Error('no platform');
    const deckZ = platform.rampZ1 + 6;
    standAt(sim, inst, 0, deckZ);
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const lift = riftLiftAt(floor, 0, deckZ);
    // The case is live: the player really stands on a raised tier.
    expect(lift).toBeGreaterThan(0.3);
    expect(sim.player.pos.y).toBeCloseTo(sim.ctx.groundPos(origin.x, origin.z + deckZ).y + lift, 3);

    const result = leap(sim, inst, 8, deckZ + 4);
    expect(result.armed).toBe(true);
    expect(result.airborne).toBe(true);
    const travelled = Math.hypot(result.to.x - result.from.x, result.to.z - result.from.z);
    expect(travelled).toBeGreaterThan(6);
    // Landed on the deck, at the deck's height.
    const landLift = riftLiftAt(floor, result.to.x - origin.x, result.to.z - origin.z);
    expect(landLift).toBeCloseTo(lift, 3);
    expect(result.to.y).toBeCloseTo(sim.ctx.groundPos(result.to.x, result.to.z).y + landLift, 2);
  });

  it('leaps from the floor up onto the deck and stands on it', () => {
    const { sim, inst, floor } = raisedRoom();
    const platform = floor.platform;
    if (!platform) throw new Error('no platform');
    const floorZ = platform.rampZ0 - 4;
    standAt(sim, inst, 0, floorZ);
    expect(riftLiftAt(floor, 0, floorZ)).toBe(0);
    const deckZ = Math.min(platform.rampZ1 + 4, floorZ + 28);
    const result = leap(sim, inst, 0, deckZ);
    expect(result.airborne).toBe(true);
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const landLift = riftLiftAt(floor, result.to.x - origin.x, result.to.z - origin.z);
    expect(Math.hypot(result.to.x - result.from.x, result.to.z - result.from.z)).toBeGreaterThan(
      10,
    );
    expect(result.to.y).toBeCloseTo(sim.ctx.groundPos(result.to.x, result.to.z).y + landLift, 2);
  });

  it('leaps from the deck down to the floor', () => {
    const { sim, inst, floor } = raisedRoom();
    const platform = floor.platform;
    if (!platform) throw new Error('no platform');
    const deckZ = platform.rampZ1 + 3;
    standAt(sim, inst, 0, deckZ);
    const floorZ = Math.max(platform.rampZ0 - 4, deckZ - 28);
    const result = leap(sim, inst, 0, floorZ);
    expect(result.airborne).toBe(true);
    expect(Math.hypot(result.to.x - result.from.x, result.to.z - result.from.z)).toBeGreaterThan(
      10,
    );
  });
});

describe('Vaulting Charge that never leaves the ground', () => {
  it('costs no cooldown when stopped before takeoff, and keeps it once airborne', () => {
    const { sim, inst, floor } = raisedRoom();
    const platform = floor.platform;
    if (!platform) throw new Error('no platform');
    const floorZ = platform.rampZ0 - 4;
    standAt(sim, inst, 0, floorZ);
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const p = sim.player;
    const aim = { x: origin.x + 8, z: origin.z + floorZ };

    p.gcdRemaining = 0;
    p.cooldowns.delete('heroic_leap');
    sim.castAbility('heroic_leap', p.id, aim);
    expect(p.leap).not.toBeNull();
    expect(p.cooldowns.get('heroic_leap') ?? 0).toBeGreaterThan(0);
    // Moved by something else before the first flight step: no leap happened.
    p.pos = { ...p.pos, x: p.pos.x - 3 };
    p.prevPos = { ...p.pos };
    sim.tick();
    expect(p.leap).toBeNull();
    expect(p.cooldowns.has('heroic_leap')).toBe(false);

    // Airborne, then stopped: a real leap, the cooldown stands.
    standAt(sim, inst, 0, floorZ);
    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, aim);
    sim.tick();
    expect(p.leap).not.toBeNull();
    p.pos = { ...p.pos, x: p.pos.x - 3 };
    p.prevPos = { ...p.pos };
    sim.tick();
    expect(p.leap).toBeNull();
    expect(p.cooldowns.get('heroic_leap') ?? 0).toBeGreaterThan(0);
  });
});

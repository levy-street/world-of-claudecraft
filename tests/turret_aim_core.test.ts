import { describe, expect, it, vi } from 'vitest';
import { TURRET_TANK_MOUNT, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { Sim } from '../src/sim/sim';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { TurretAimCore, vehicleOwnsAim } from '../src/ui/hud/vehicle/turret_aim_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const CENTER = { x: 10, z: 20 };
const START = 100;

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: CENTER.x, y: 0, z: CENTER.z },
    defense: createTurretDefense(resolveTurretPlan(), CENTER, 7, START),
    lentMountKey: TURRET_TANK_MOUNT,
    priorMountKey: '',
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

function rig(session: TurretSession | null = seat()) {
  const world = {
    turretSession: (session ? turretSessionView(session) : null) as TurretSessionView | null,
    turretClock: session ? START : (null as number | null),
    useVehicleAction: vi.fn(),
  };
  return { world, aim: new TurretAimCore(world), session };
}

describe('the turret aim core', () => {
  it('is active exactly while seated, with no bar slot or ability id', () => {
    const { world, aim } = rig();
    expect(aim.isActive()).toBe(true);
    expect(aim.activeSlot()).toBeNull();
    expect(aim.activeAbilityId()).toBeNull();
    world.turretSession = null;
    expect(aim.isActive()).toBe(false);
    expect(aim.abilityRange()).toBeNull();
    aim.updatePoint({ x: 1, z: 1 });
    expect(aim.rawAimPoint()).toBeNull();
  });

  it('reads the range and the blast radius from the weapon content', () => {
    const { aim } = rig();
    expect(aim.abilityRange()).toBe(TURRET_WEAPON.maxRange);
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.reticle()?.radius).toBe(TURRET_WEAPON.blastRadius);
  });

  it('fires on commit without dropping the aim, and consumes a click the sim refuses', () => {
    const { world, aim } = rig();
    aim.updatePoint({ x: CENTER.x, z: CENTER.z + 20 });
    expect(aim.commitAt({ x: CENTER.x + 20, z: CENTER.z })).toBe(true);
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_fire', {
      x: CENTER.x + 20,
      z: CENTER.z,
    });
    expect(aim.rawAimPoint()).toEqual({ x: CENTER.x, z: CENTER.z + 20 });
    expect(aim.reticle()?.point).toEqual({ x: CENTER.x, z: CENTER.z + 20 });
    expect(aim.commitAt()).toBe(true);
    expect(world.useVehicleAction).toHaveBeenCalledTimes(2);
    expect(aim.commitAt(null)).toBe(true);
    expect(world.useVehicleAction).toHaveBeenCalledTimes(2);
  });

  it('keeps the reticle on cancel, so Escape falls through to the seat exit', () => {
    const { aim } = rig();
    aim.updatePoint({ x: CENTER.x + 10, z: CENTER.z });
    expect(aim.cancel()).toBe(false);
    expect(aim.reticle()).not.toBeNull();
  });

  it('fires a point-blank click at the minimum range along its bearing, never blocked', () => {
    const { world, aim } = rig();
    const inside = { x: CENTER.x + TURRET_WEAPON.minRange * 0.5, z: CENTER.z };
    aim.updatePoint(inside);
    expect(aim.reticle()?.blocked).toBe(false);
    expect(aim.reticle()?.point.x).toBeCloseTo(CENTER.x + TURRET_WEAPON.minRange);
    expect(aim.commitAt(inside)).toBe(true);
    expect(world.useVehicleAction).toHaveBeenCalledTimes(1);
    const sent = world.useVehicleAction.mock.calls[0][1];
    expect(sent.x).toBeCloseTo(CENTER.x + TURRET_WEAPON.minRange);
    expect(sent.z).toBeCloseTo(CENTER.z);
  });

  it('neither blocks nor refuses a point exactly at the minimum range', () => {
    const { world, aim } = rig();
    const edge = { x: CENTER.x + TURRET_WEAPON.minRange, z: CENTER.z };
    aim.updatePoint(edge);
    expect(aim.reticle()?.blocked).toBe(false);
    expect(aim.commitAt(edge)).toBe(true);
    expect(world.useVehicleAction).toHaveBeenCalledWith('turret_fire', edge);
  });

  it('pulls a far point in to the weapon reach, for the ring and the shot alike', () => {
    const { world, aim } = rig();
    aim.updatePoint({ x: CENTER.x, z: CENTER.z + TURRET_WEAPON.maxRange * 3 });
    expect(aim.reticle()?.point.x).toBeCloseTo(CENTER.x);
    expect(aim.reticle()?.point.z).toBeCloseTo(CENTER.z + TURRET_WEAPON.maxRange);
    aim.commitAt();
    const sent = world.useVehicleAction.mock.calls[0][1];
    expect(Math.hypot(sent.x - CENTER.x, sent.z - CENTER.z)).toBeCloseTo(TURRET_WEAPON.maxRange);
  });

  it('dims the ring while the cannon cools down, from the clock and the ready tick', () => {
    const session = seat();
    session.defense.readyTick = START + TURRET_WEAPON.cooldownTicks;
    session.defense.rev++;
    const { world, aim } = rig(session);
    aim.updatePoint({ x: CENTER.x + 10, z: CENTER.z });
    expect(aim.reticle()?.dimmed).toBe(true);
    world.turretClock = START + TURRET_WEAPON.cooldownTicks;
    expect(aim.reticle()?.dimmed).toBe(false);
  });

  it('never dims the ring without a clock to read the cooldown from', () => {
    const session = seat();
    session.defense.readyTick = START + TURRET_WEAPON.cooldownTicks;
    session.defense.rev++;
    const { world, aim } = rig(session);
    world.turretClock = null;
    aim.updatePoint({ x: CENTER.x + 10, z: CENTER.z });
    expect(aim.reticle()?.dimmed).toBe(false);
  });

  it('hides the ring once the defense ended', () => {
    const session = seat();
    session.defense.phase = 'won';
    session.defense.rev++;
    const { aim } = rig(session);
    aim.updatePoint({ x: CENTER.x + 10, z: CENTER.z });
    expect(aim.reticle()).toBeNull();
  });

  it('seeds a stick-steered aim ahead of the last shot and keeps it within reach', () => {
    const { aim } = rig();
    aim.nudge(1, 0);
    expect(aim.rawAimPoint()).toEqual({ x: CENTER.x + 1, z: CENTER.z + 20 });
    aim.nudge(0, 1000);
    const point = aim.rawAimPoint()!;
    expect(Math.hypot(point.x - CENTER.x, point.z - CENTER.z)).toBeCloseTo(TURRET_WEAPON.maxRange);
  });

  it('owns the HUD aim for either seat, statically', () => {
    expect(vehicleOwnsAim({})).toBe(false);
    expect(vehicleOwnsAim({ vehicleSession: null, turretSession: null })).toBe(false);
    expect(vehicleOwnsAim({ turretSession: rig().world.turretSession })).toBe(true);
  });

  it('drives a real seat: the first click fires, a click in the cooldown is refused but consumed', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev turret -340 1945');
    const aim = new TurretAimCore(sim);
    const target = { x: -340 + 20, z: 1945 };
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(1);
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(1);
    for (let i = 0; i < TURRET_WEAPON.cooldownTicks; i++) sim.tick();
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(2);
  });
});

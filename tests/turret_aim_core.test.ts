import { describe, expect, it, vi } from 'vitest';
import { TURRET_WEAPON } from '../src/sim/content/turret_defense';
import type { ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  clampTurretAimInto,
  createTurretDefense,
  fireTurret,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { Sim } from '../src/sim/sim';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { TurretAimCore, vehicleOwnsAim } from '../src/ui/hud/vehicle/turret_aim_core';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const CENTER = { x: 10, z: 20 };
const START = 100;

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: CENTER.x, y: 0, z: CENTER.z },
    defense: createTurretDefense(resolveTurretPlan(), CENTER, 7, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
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
  const shots = new TurretOwnShotLedger();
  return { world, aim: new TurretAimCore(world, shots), session, shots };
}

const flat: ThrowProbe = { ground: () => 0, water: () => null };

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
    sim.chat('/dev turret');
    const aim = new TurretAimCore(sim, new TurretOwnShotLedger());
    const center = sim.turretSession!.origin;
    const target = { x: center.x + 20, z: center.z };
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(1);
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(1);
    for (let i = 0; i < TURRET_WEAPON.cooldownTicks; i++) sim.tick();
    expect(aim.commitAt(target)).toBe(true);
    expect(sim.turretSession?.defense.stats.shots).toBe(2);
  });

  it('clamps with the engine: the reticle, the sent point and the fired point agree bit for bit', () => {
    const distances = [
      0,
      1e-7,
      1e-6,
      0.5,
      TURRET_WEAPON.minRange,
      7.3,
      33,
      TURRET_WEAPON.maxRange,
      61,
      400,
    ];
    for (let a = 0; a < 24; a++) {
      const angle = (a / 24) * Math.PI * 2 + 0.013;
      for (const d of distances) {
        const point = { x: CENTER.x + Math.sin(angle) * d, z: CENTER.z + Math.cos(angle) * d };
        const { world, aim } = rig();
        aim.updatePoint(point);
        const shown = { ...aim.reticle()!.point };
        aim.commitAt(point);
        const sent = world.useVehicleAction.mock.calls[0][1];
        const state = createTurretDefense(resolveTurretPlan(), CENTER, 7, START);
        const out = fireTurret(state, START, point.x, point.z, flat);
        expect(out.ok).toBe(true);
        const ev = out.events[0];
        if (ev.type !== 'fired') throw new Error('fired expected');
        expect(sent).toEqual({ x: ev.x, z: ev.z });
        expect(shown).toEqual({ x: ev.x, z: ev.z });
        const again = clampTurretAimInto(CENTER.x, CENTER.z, 0, 1, point.x, point.z, {
          x: 0,
          z: 0,
          dirX: 0,
          dirZ: 0,
          range: 0,
        });
        expect({ x: again.x, z: again.z }).toEqual(sent);
      }
    }
  });

  it('marks a click every mirror says the server accepts, before sending it', () => {
    const { world, aim, shots } = rig();
    world.useVehicleAction.mockImplementation(() => {
      // Offline the shot fires inside the send: its mark must already be there.
      expect(shots.launchAfter(world.turretSession!, 0)).not.toBeNull();
    });
    aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    const mark = shots.launchAfter(world.turretSession!, 0)!;
    expect(mark).toMatchObject({ clock: START, x: CENTER.x + 20, z: CENTER.z, range: 20 });
    expect(mark.status).toBe('pending');
    // A second click inside the round trip still goes to the server, but plays nothing.
    aim.commitAt({ x: CENTER.x - 20, z: CENTER.z });
    expect(world.useVehicleAction).toHaveBeenCalledTimes(2);
    expect(shots.launchAfter(world.turretSession!, mark.serial)).toBeNull();
  });

  it('plays nothing while the cannon cools down or once the defense ended, and marks no clockless click', () => {
    const cooling = seat();
    cooling.defense.readyTick = START + 1;
    const one = rig(cooling);
    one.aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(one.shots.launchAfter(one.world.turretSession!, 0)).toBeNull();
    // Still recorded: the server may fire it all the same, and its entry must find it.
    expect(one.shots.newestSerial).toBe(1);
    expect(one.shots.status(1)).toBe('pending');
    const won = seat();
    won.defense.phase = 'won';
    const two = rig(won);
    two.aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(two.shots.launchAfter(two.world.turretSession!, 0)).toBeNull();
    const three = rig();
    three.world.turretClock = null;
    three.aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(three.shots.newestSerial).toBe(0);
    expect(three.world.useVehicleAction).toHaveBeenCalledTimes(1);
  });

  it('dims the ring while its own shot waits for the server, so a second click plays nothing', () => {
    const { world, aim } = rig();
    aim.updatePoint({ x: CENTER.x + 10, z: CENTER.z });
    expect(aim.reticle()?.dimmed).toBe(false);
    aim.commitAt();
    // The mirror has not moved yet (online, one round trip): the pending mark dims the ring.
    expect(world.turretSession!.defense.readyTick).toBe(START);
    expect(aim.reticle()?.dimmed).toBe(true);
  });

  it('dims nothing more offline: the shot fires in the click and its entry confirms the mark', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev turret');
    const shots = new TurretOwnShotLedger();
    const aim = new TurretAimCore(sim, shots);
    const center = sim.turretSession!.origin;
    aim.commitAt({ x: center.x + 20, z: center.z });
    const mark = shots.launchAfter(sim.turretSession!, 0)!;
    expect(shots.ownShotOf(sim.turretSession!, sim.turretSession!.feedback.at(-1)!)).toBe(
      mark.serial,
    );
    expect(shots.status(mark.serial)).toBe('confirmed');
    for (let i = 0; i < TURRET_WEAPON.cooldownTicks; i++) sim.tick();
    aim.updatePoint({ x: center.x + 10, z: center.z });
    expect(aim.reticle()?.dimmed).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  TURRET_FRAGMENTATION,
  TURRET_SHOCKWAVE,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
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
import {
  TURRET_FRAG_FOOTPRINT,
  TurretAimCore,
  vehicleOwnsAim,
} from '../src/ui/hud/vehicle/turret_aim_core';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { resolveArmedTurretPlan } from './helpers/turret_armed_plan';

const CENTER = { x: 10, z: 20 };
const REARM_TICKS = TURRET_SHOCKWAVE.rearmTicks;
const START = 100;

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: CENTER.x, y: 0, z: CENTER.z },
    defense: createTurretDefense(resolveArmedTurretPlan(), CENTER, 7, START),
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

  it('keeps the reticle on cancel with nothing armed, so Escape falls through to the seat exit', () => {
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

/** A seat in its first wave, with the trial's 2 Shockwaves and 3 fragmentation shells. */
function waveSeat(): TurretSession {
  const session = seat();
  session.defense.phase = 'wave';
  session.defense.rev++;
  return session;
}

describe('the turret aim core with the limited weapons', () => {
  it('arms the fragmentation shell: an orange reticle the size of its footprint', () => {
    const { aim } = rig(waveSeat());
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.reticle()).toMatchObject({ school: 'physical', radius: TURRET_WEAPON.blastRadius });
    expect(aim.toggleFrag()).toBe(true);
    expect(aim.fragArmed).toBe(true);
    expect(aim.reticle()).toMatchObject({ school: 'fire', radius: TURRET_FRAG_FOOTPRINT });
    expect(TURRET_FRAG_FOOTPRINT).toBe(
      TURRET_FRAGMENTATION.outerRadius + TURRET_FRAGMENTATION.blastRadius,
    );
  });

  it('fires the armed shell on the next click, then goes back to the shell', () => {
    const { world, aim, shots } = rig(waveSeat());
    aim.toggleFrag();
    aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_frag', {
      x: CENTER.x + 20,
      z: CENTER.z,
    });
    expect(aim.fragArmed).toBe(false);
    expect(shots.launchAfter(world.turretSession!, 0)).toMatchObject({ weapon: 'frag' });
    expect(shots.chargesLeft(world.turretSession!, START, 'frag')).toBe(2);
    world.turretClock = START + TURRET_WEAPON.cooldownTicks + 20;
    aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_fire', {
      x: CENTER.x + 20,
      z: CENTER.z,
    });
  });

  it('disarms with no charge spent: key 2 again, or cancel (right click, Escape, pad B)', () => {
    const { world, aim, shots } = rig(waveSeat());
    aim.toggleFrag();
    expect(aim.toggleFrag()).toBe(false);
    expect(aim.fragArmed).toBe(false);
    aim.toggleFrag();
    // Cancel reports the disarm, so Escape stops there instead of leaving the tower.
    expect(aim.cancel()).toBe(true);
    expect(aim.fragArmed).toBe(false);
    // With nothing armed it reports nothing: the next Escape leaves.
    expect(aim.cancel()).toBe(false);
    expect(world.useVehicleAction).not.toHaveBeenCalled();
    expect(shots.chargesLeft(world.turretSession!, START, 'frag')).toBe(3);
  });

  it('keeps the shell armed and sends nothing for a click the server surely refuses', () => {
    // Reloading past even the widest trip the ledger allows before it measured one.
    const session = waveSeat();
    session.defense.readyTick = START + 100;
    session.defense.rev++;
    const { world, aim } = rig(session);
    aim.toggleFrag();
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.reticle()?.dimmed).toBe(true);
    expect(aim.commitAt()).toBe(true);
    expect(world.useVehicleAction).not.toHaveBeenCalled();
    expect(aim.fragArmed).toBe(true);
  });

  it('dims the armed reticle by the fragmentation rules, not the shell ones', () => {
    // Between waves a shell still fires, a fragmentation shell does not.
    const session = waveSeat();
    const { world, aim } = rig(session);
    aim.toggleFrag();
    session.defense.phase = 'between';
    session.defense.phaseEndTick = START + 200;
    session.defense.rev++;
    world.turretSession = turretSessionView(session);
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.fragArmed).toBe(true);
    expect(aim.reticle()?.dimmed).toBe(true);
    aim.cancel();
    expect(aim.reticle()?.dimmed).toBe(false);
  });

  it('sends a weapon click the server may take, playing it from its entry, not the click', () => {
    // Reloading and rearming for a few ticks: inside the widest trip, outside the fastest.
    const session = waveSeat();
    session.defense.readyTick = START + 5;
    session.defense.shockReadyTick = START + 5;
    session.defense.rev++;
    const { world, aim, shots } = rig(session);
    expect(shots.classify(world.turretSession!, START, 'frag')).toBe('held');
    expect(shots.classify(world.turretSession!, START, 'shock')).toBe('held');
    aim.toggleFrag();
    aim.commitAt({ x: CENTER.x + 20, z: CENTER.z });
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_frag', {
      x: CENTER.x + 20,
      z: CENTER.z,
    });
    expect(aim.fragArmed).toBe(false);
    expect(aim.fireShockwave()).toBe(true);
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_shockwave', CENTER);
    // Neither plays on the click, and neither charge drops before the server's word.
    expect(shots.launchAfter(world.turretSession!, 0)).toBeNull();
    expect(shots.chargesLeft(world.turretSession!, START, 'frag')).toBe(3);
    expect(shots.chargesLeft(world.turretSession!, START, 'shock')).toBe(2);
  });

  it('arms nothing with no charge left, and drops an armed shell when the run ends', () => {
    const empty = waveSeat();
    empty.defense.stats.frags = empty.defense.plan.arsenal.fragmentation;
    empty.defense.rev++;
    expect(rig(empty).aim.toggleFrag()).toBe(false);
    const session = waveSeat();
    const { world, aim } = rig(session);
    aim.toggleFrag();
    aim.sync();
    expect(aim.fragArmed).toBe(true);
    session.defense.phase = 'won';
    session.defense.rev++;
    world.turretSession = turretSessionView(session);
    aim.sync();
    expect(aim.fragArmed).toBe(false);
    aim.toggleFrag();
    expect(aim.fragArmed).toBe(false);
    const leaving = rig(waveSeat());
    leaving.aim.toggleFrag();
    leaving.world.turretSession = null;
    leaving.aim.sync();
    expect(leaving.aim.fragArmed).toBe(false);
  });

  it('shows where the bomblets land: the engine star on the aimed bearing', () => {
    const { aim } = rig(waveSeat());
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.fragLandingPoints()).toBeNull();
    aim.toggleFrag();
    const star = aim.fragLandingPoints()!;
    expect(star).toHaveLength(1 + TURRET_FRAGMENTATION.outerCount);
    expect(star[0]).toEqual({
      x: CENTER.x + 20,
      z: CENTER.z,
      blast: TURRET_FRAGMENTATION.blastRadius,
    });
    // The first outer bomblet lands straight ahead along the bearing, the rest on the ring.
    expect(star[1].x).toBeCloseTo(CENTER.x + 20 + TURRET_FRAGMENTATION.outerRadius);
    expect(star[1].z).toBeCloseTo(CENTER.z);
    for (const p of star.slice(1)) {
      expect(Math.hypot(p.x - star[0].x, p.z - star[0].z)).toBeCloseTo(
        TURRET_FRAGMENTATION.outerRadius,
      );
    }
  });

  it('slams at once with no aim, marking the Shockwave before the send', () => {
    const { world, aim, shots } = rig(waveSeat());
    world.useVehicleAction.mockImplementation(() => {
      expect(shots.launchAfter(world.turretSession!, 0)).toMatchObject({ weapon: 'shock' });
    });
    expect(aim.fireShockwave()).toBe(true);
    expect(world.useVehicleAction).toHaveBeenCalledWith('turret_shockwave', CENTER);
    expect(shots.chargesLeft(world.turretSession!, START, 'shock')).toBe(1);
  });

  it('sends no Shockwave the server surely refuses: in the intro, rearming or empty', () => {
    const intro = rig(seat());
    expect(intro.aim.fireShockwave()).toBe(false);
    const rearming = waveSeat();
    rearming.defense.shockReadyTick = START + 100;
    rearming.defense.rev++;
    expect(rig(rearming).aim.fireShockwave()).toBe(false);
    const empty = waveSeat();
    empty.defense.stats.shockwaves = 2;
    empty.defense.rev++;
    const r = rig(empty);
    expect(r.aim.fireShockwave()).toBe(false);
    expect(r.world.useVehicleAction).not.toHaveBeenCalled();
  });

  it('drives a real seat: both weapons spend a charge each, and refuse between waves', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    // The Veterans' Test gives both weapons.
    sim.chat('/dev turret hard');
    const aim = new TurretAimCore(sim, new TurretOwnShotLedger());
    const center = sim.turretSession!.origin;
    // The intro: nothing is sent, nothing is spent.
    expect(aim.fireShockwave()).toBe(false);
    while (sim.turretSession!.defense.phase !== 'wave') sim.tick();
    expect(aim.fireShockwave()).toBe(true);
    expect(sim.turretSession!.defense.stats.shockwaves).toBe(1);
    expect(aim.toggleFrag()).toBe(true);
    for (let i = 0; i < TURRET_WEAPON.cooldownTicks; i++) sim.tick();
    expect(aim.commitAt({ x: center.x + 20, z: center.z })).toBe(true);
    expect(sim.turretSession!.defense.stats.frags).toBe(1);
    expect(sim.turretSession!.feedback.at(-1)?.event).toMatchObject({
      type: 'fired',
      weapon: 'frag',
    });
    expect(aim.fragArmed).toBe(false);
    // The pause between waves: neither weapon is sent, nothing is spent.
    const live = (sim.meta(sim.playerId)!.vehicle as TurretSession).defense;
    live.phase = 'between';
    live.phaseEndTick = sim.tickCount + 200;
    live.rev++;
    for (let i = 0; i < REARM_TICKS + TURRET_WEAPON.cooldownTicks; i++) sim.tick();
    expect(sim.turretSession!.defense.phase).toBe('between');
    const seen = sim.turretSession!.feedback.length;
    expect(aim.fireShockwave()).toBe(false);
    expect(aim.toggleFrag()).toBe(true);
    aim.commitAt({ x: center.x + 20, z: center.z });
    const after = sim.turretSession!.defense.stats;
    expect([after.shockwaves, after.frags]).toEqual([1, 1]);
    expect(sim.turretSession!.feedback).toHaveLength(seen);
  });
});

// The Highwatch show-jumping race (src/sim/mount_race.ts): course geometry
// contract, the command-started lifecycle (Start Race at the arch, a 3..2..1
// countdown, then a timed lap whose seven jumps clear in ANY order, finishing on
// the next arch crossing), timeout/void, the IWorld view, per-player isolation
// online (two concurrent racers), and determinism. Races are driven with REAL
// movement input through the shared kernel (facing + forward + jump), never by
// teleporting across a gate (teleports reset prevPos, so they can never fake a
// crossing).

import { describe, expect, it } from 'vitest';
import { resolveMovement, resolvePosition } from '../src/sim/colliders';
import {
  isOnMountRaceStartPlatform,
  MOUNT_RACE_COURSE,
  MOUNT_RACE_JUMP_FIXTURES,
  MOUNT_RACE_START_PLATFORM,
  raceGateSegment,
  STABLE_PADDOCK,
  STABLE_PASTURE,
} from '../src/sim/content/mounts';
import { ZONE3_PROPS } from '../src/sim/content/zone3';
import { PROPS } from '../src/sim/data';
import { MOUNT_RACE_COUNTDOWN_TICKS, MOUNT_RACE_TIME_LIMIT_TICKS } from '../src/sim/mount_race';
import { MOUNT_TRAIN_FEE_COPPER } from '../src/sim/mounts_training';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const makeSim = (seed = 1) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

type RaceEvent<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
function findEv<T extends SimEvent['type']>(events: SimEvent[], type: T): RaceEvent<T> | undefined {
  return events.find((e): e is RaceEvent<T> => e.type === type);
}

function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

/** Level the player, grant the riding skill and horse reins, and run the summon channel. */
function mountUp(sim: Sim, pid: number): void {
  sim.setPlayerLevel(20, pid);
  // ridingTrained is now required to summon any owned mount.
  const meta = sim.players.get(pid)!;
  meta.ridingTrained = true;
  sim.addItem('reins_valorsteed', 1, pid);
  // Summon in the north pasture so the summon lock never overlaps a ride.
  teleport(sim, pid, STABLE_PASTURE.xMin + 2, STABLE_PASTURE.zMin + 2);
  // Reins are usable items: summoning is a use, not a keybind toggle.
  sim.useItem('reins_valorsteed', pid);
  const e = sim.entities.get(pid)!;
  for (let i = 0; i < 80 && e.mountKey === ''; i++) sim.tick();
  expect(e.mountKey).toBe('valorsteed');
}

/** Ride through a gate with real movement: teleport a few yards before it, face
 *  the riding direction, hold forward (and jump for a jump gate), and tick until
 *  well past the line. Returns every event of those ticks. */
function rideThrough(
  sim: Sim,
  pid: number,
  gate: { x: number; z: number; dir: number },
  opts: { jump?: boolean; back?: number } = {},
): SimEvent[] {
  const dir = gate.dir;
  const back = opts.back ?? 4;
  const e = sim.entities.get(pid)!;
  const meta = sim.players.get(pid)!;
  // Land first: airborne velocity is locked at takeoff (no air steering), so a
  // rider still in flight from the previous gate cannot turn toward this one.
  meta.moveInput.forward = false;
  meta.moveInput.jump = false;
  for (let i = 0; i < 40 && !e.onGround; i++) sim.tick();
  teleport(sim, pid, gate.x - Math.sin(dir) * back, gate.z - Math.cos(dir) * back);
  e.facing = dir;
  meta.moveInput.forward = true;
  if (opts.jump) meta.moveInput.jump = true;
  const events: SimEvent[] = [];
  for (let i = 0; i < 60; i++) {
    events.push(...sim.tick());
    const along = (e.pos.x - gate.x) * Math.sin(dir) + (e.pos.z - gate.z) * Math.cos(dir);
    if (along > 3) break;
  }
  meta.moveInput.forward = false;
  meta.moveInput.jump = false;
  return events;
}

function raceOf(sim: Sim, pid: number) {
  return sim.players.get(pid)!.mountRace ?? null;
}

function standOnStartPlatform(sim: Sim, pid: number): void {
  teleport(sim, pid, MOUNT_RACE_START_PLATFORM.x, MOUNT_RACE_START_PLATFORM.z);
}

/** Fire the start command at the arch and run the countdown to GO. Returns the
 *  mountRaceStart event so callers can assert the armed budget. */
function startRace(sim: Sim, pid: number): SimEvent[] {
  standOnStartPlatform(sim, pid);
  sim.mountRaceStartFor(pid);
  const armed = sim.tick();
  expect(armed.some((e) => e.type === 'mountRaceCountdown' && e.pid === pid)).toBe(true);
  const goEvents: SimEvent[] = [];
  for (let i = 0; i < MOUNT_RACE_COUNTDOWN_TICKS + 2; i++) goEvents.push(...sim.tick());
  expect(goEvents.some((e) => e.type === 'mountRaceStart' && e.pid === pid)).toBe(true);
  return goEvents;
}

describe('MOUNT_RACE_COURSE geometry contract', () => {
  it('lays the whole course inside the paddock south yard with fence clearance', () => {
    const gates = [MOUNT_RACE_COURSE.arch, ...MOUNT_RACE_COURSE.jumps];
    for (const g of gates) {
      expect(g.x).toBeGreaterThan(STABLE_PADDOCK.x1 + 4);
      expect(g.x).toBeLessThan(STABLE_PADDOCK.x2 - 4);
      expect(g.z).toBeGreaterThan(STABLE_PADDOCK.z1 + 4);
      // South of the divider rail (the north side is the horses' pasture).
      expect(g.z).toBeLessThan(STABLE_PADDOCK.divider.z - 4);
    }
    expect(MOUNT_RACE_COURSE.jumps.length).toBe(7);
    expect(MOUNT_RACE_COURSE.arch.x).toBe(390);
    expect(isOnMountRaceStartPlatform(MOUNT_RACE_START_PLATFORM)).toBe(true);
    expect(MOUNT_RACE_START_PLATFORM.x).toBeLessThan(MOUNT_RACE_COURSE.arch.x);
    expect(MOUNT_RACE_START_PLATFORM.size).toBe(8);
    expect(MOUNT_RACE_COURSE.timeLimitSeconds).toBe(20);
  });

  it('uses arena-scale jump fixtures and matching jumpable colliders', () => {
    expect(MOUNT_RACE_JUMP_FIXTURES.vertical.width).toBeGreaterThanOrEqual(7.5);
    expect(MOUNT_RACE_JUMP_FIXTURES.oxer.width).toBeGreaterThanOrEqual(8);
    expect(MOUNT_RACE_COURSE.jumpHalfWidth).toBeGreaterThanOrEqual(
      MOUNT_RACE_JUMP_FIXTURES.oxer.width / 2,
    );

    for (const jump of MOUNT_RACE_COURSE.jumps) {
      const fixture = MOUNT_RACE_JUMP_FIXTURES[jump.kind];
      const headingX = Math.sin(jump.dir);
      const headingZ = Math.cos(jump.dir);
      const fromX = jump.x - headingX * (fixture.depth + 2);
      const fromZ = jump.z - headingZ * (fixture.depth + 2);
      const toX = jump.x + headingX * (fixture.depth + 2);
      const toZ = jump.z + headingZ * (fixture.depth + 2);

      expect(resolvePosition(1, jump.x, jump.z, 0.6)).not.toEqual({ x: jump.x, z: jump.z });
      const grounded = resolveMovement(1, fromX, fromZ, toX, toZ, 0.6, false);
      const airborne = resolveMovement(1, fromX, fromZ, toX, toZ, 0.6, true);
      const groundedAlong = (grounded.x - jump.x) * headingX + (grounded.z - jump.z) * headingZ;
      const airborneAlong = (airborne.x - jump.x) * headingX + (airborne.z - jump.z) * headingZ;
      expect(groundedAlong).toBeLessThan(0);
      expect(airborneAlong).toBeGreaterThan(0);
    }
  });

  it('alternates vertical and oxer jumps', () => {
    const kinds = MOUNT_RACE_COURSE.jumps.map((j) => j.kind);
    expect(kinds).toEqual(['vertical', 'oxer', 'vertical', 'oxer', 'vertical', 'oxer', 'vertical']);
  });

  it('gate segments run perpendicular to the riding heading', () => {
    for (const g of [MOUNT_RACE_COURSE.arch, ...MOUNT_RACE_COURSE.jumps]) {
      const s = raceGateSegment(g, 2);
      const segX = s.bx - s.ax;
      const segZ = s.bz - s.az;
      const dot = segX * Math.sin(g.dir) + segZ * Math.cos(g.dir);
      expect(Math.abs(dot)).toBeLessThan(1e-9);
    }
  });

  it('zone3 places the visible fixtures straight from the course data', () => {
    const rc = ZONE3_PROPS.raceCourse;
    expect(rc).toBeDefined();
    expect(rc!.arch).toEqual(MOUNT_RACE_COURSE.arch);
    expect(rc!.jumps).toHaveLength(MOUNT_RACE_COURSE.jumps.length);
    MOUNT_RACE_COURSE.jumps.forEach((j, i) => {
      expect(rc!.jumps[i]).toEqual({ x: j.x, z: j.z, dir: j.dir, kind: j.kind });
    });
  });

  // The merged PROPS the renderer actually reads (getActiveWorldContent().props):
  // mergeProps enumerates ZonePropsDef fields explicitly, so an optional field it
  // forgets is silently dropped and its fixtures never render (the historical
  // delveMarkers bug). This asserts raceCourse survives the merge intact.
  it('the merged PROPS carry the race course through mergeProps (delveMarkers-style drop guard)', () => {
    expect(PROPS.raceCourse).toBeDefined();
    expect(PROPS.raceCourse!.arch).toEqual(MOUNT_RACE_COURSE.arch);
    expect(PROPS.raceCourse!.jumps).toHaveLength(MOUNT_RACE_COURSE.jumps.length);
    MOUNT_RACE_COURSE.jumps.forEach((j, i) => {
      expect(PROPS.raceCourse!.jumps[i]).toEqual({ x: j.x, z: j.z, dir: j.dir, kind: j.kind });
    });
  });
});

describe('starting a race', () => {
  it('pressing Start on the platform mounted arms a countdown, then GO with the full budget', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    const armed = sim.tick();
    const cd = findEv(armed, 'mountRaceCountdown');
    expect(cd).toBeDefined();
    expect(cd!.countdownTicks).toBe(MOUNT_RACE_COUNTDOWN_TICKS);
    expect(raceOf(sim, sim.playerId)?.phase).toBe('countdown');
    // The view counts the countdown down before GO.
    expect(sim.mountRaceView()?.phase).toBe('countdown');
    expect(sim.mountRaceView()!.goTicksLeft).toBeGreaterThan(0);
    // Run to GO.
    const goEvents: SimEvent[] = [];
    for (let i = 0; i < MOUNT_RACE_COUNTDOWN_TICKS + 2; i++) goEvents.push(...sim.tick());
    const start = findEv(goEvents, 'mountRaceStart');
    expect(start).toBeDefined();
    expect(start!.timeLimitTicks).toBe(MOUNT_RACE_TIME_LIMIT_TICKS);
    expect(start!.jumpsTotal).toBe(MOUNT_RACE_COURSE.jumps.length);
    expect(raceOf(sim, sim.playerId)?.phase).toBe('racing');
    expect(sim.mountRaceView()?.phase).toBe('racing');
  });

  it('refuses to start away from the platform with a Too far away notice', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    teleport(sim, sim.playerId, MOUNT_RACE_START_PLATFORM.x + 10, MOUNT_RACE_START_PLATFORM.z);
    sim.mountRaceStartFor(sim.playerId);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(raceOf(sim, sim.playerId)).toBeNull();
  });

  it('refuses to start UNMOUNTED (silently, no session)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    sim.tick();
    expect(raceOf(sim, sim.playerId)).toBeNull();
  });

  it('starts an accepted riding lesson from the platform without Begin Lesson', () => {
    // The lesson is free: no copper required to start from the platform.
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = sim.players.get(sim.playerId)!;
    meta.ridingTrained = true;
    meta.questLog.set('q_riding_lessons', {
      questId: 'q_riding_lessons',
      counts: [0],
      state: 'active',
    });
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'mountTrainSession' && e.phase === 'ride')).toBe(true);
    expect(events.some((e) => e.type === 'mountRaceCountdown')).toBe(true);
    expect(meta.mountTraining?.phase).toBe('ride');
    // mountTrainingFeePaid is no longer written by the lesson; the lesson is free.
    expect(meta.mountTrainingFeePaid ?? false).toBe(false);
    expect(sim.player.mountKey).toBe('valorsteed');
    expect(raceOf(sim, sim.playerId)?.phase).toBe('countdown');
  });

  it('a second start while a race is live is a no-op (same race id)', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    const s = raceOf(sim, sim.playerId)!;
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    sim.tick();
    expect(raceOf(sim, sim.playerId)?.raceId).toBe(s.raceId);
  });
});

describe('the countdown', () => {
  it('locks authoritative movement until GO', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    standOnStartPlatform(sim, sim.playerId);
    sim.player.facing = MOUNT_RACE_COURSE.arch.dir;
    sim.players.get(sim.playerId)!.moveInput.forward = true;
    const start = { ...sim.player.pos };
    sim.mountRaceStartFor(sim.playerId);
    for (let i = 0; i < MOUNT_RACE_COUNTDOWN_TICKS - 1; i++) sim.tick();
    expect(sim.player.pos.x).toBe(start.x);
    expect(sim.player.pos.z).toBe(start.z);
    expect(raceOf(sim, sim.playerId)?.phase).toBe('countdown');
    sim.tick();
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(start.x);
  });

  it('Cancel Race exits the countdown and keeps the rider mounted for a retry', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    sim.tick();
    sim.mountRaceCancelFor(sim.playerId);
    const events = sim.tick();
    expect(findEv(events, 'mountRaceEnd')?.outcome).toBe('abandoned');
    expect(raceOf(sim, sim.playerId)).toBeNull();
    expect(sim.player.mountKey).toBe('valorsteed');
  });

  it('gates are inert during the countdown (a jump before GO marks nothing)', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    sim.tick();
    expect(raceOf(sim, sim.playerId)?.phase).toBe('countdown');
    // Jump the first gate while still counting down: no credit.
    const events = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.jumps[0], { jump: true });
    expect(events.some((e) => e.type === 'mountRaceJump')).toBe(false);
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe(0);
  });

  it('dismounting during the countdown cancels the run', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    standOnStartPlatform(sim, sim.playerId);
    sim.mountRaceStartFor(sim.playerId);
    sim.tick();
    sim.toggleMounted();
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && !events.some((e) => e.type === 'mountRaceEnd'); i++)
      events.push(...sim.tick());
    expect(findEv(events, 'mountRaceEnd')?.outcome).toBe('abandoned');
    expect(raceOf(sim, sim.playerId)).toBeNull();
  });
});

describe('jumping the course (any order)', () => {
  it('an airborne crossing marks a jump; a grounded ride-through does not', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    const first = MOUNT_RACE_COURSE.jumps[0];
    const grounded = rideThrough(sim, sim.playerId, first);
    expect(grounded.some((e) => e.type === 'mountRaceJump')).toBe(false);
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe(0);
    const airborne = rideThrough(sim, sim.playerId, first, { jump: true });
    const jumpEv = findEv(airborne, 'mountRaceJump');
    expect(jumpEv).toBeDefined();
    expect(jumpEv!.jump).toBe(0);
    expect(jumpEv!.cleared).toBe(1);
    expect(jumpEv!.mask).toBe(1);
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe(1);
  });

  it('jumps may be cleared out of order, and a missed one taken by riding back', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    // Take the THIRD jump first (skip 0 and 1): it marks bit 2.
    const third = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.jumps[2], { jump: true });
    expect(findEv(third, 'mountRaceJump')?.jump).toBe(2);
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe(1 << 2);
    // Ride BACK for the first jump: it marks bit 0.
    const first = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.jumps[0], { jump: true });
    expect(findEv(first, 'mountRaceJump')?.jump).toBe(0);
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe((1 << 2) | 1);
    // Re-clearing an already-marked jump emits nothing.
    const again = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.jumps[0], { jump: true });
    expect(again.some((e) => e.type === 'mountRaceJump')).toBe(false);
  });

  it('crossing the arch with jumps remaining neither finishes nor restarts', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    const s = raceOf(sim, sim.playerId)!;
    const events = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.arch);
    expect(events.some((e) => e.type === 'mountRaceEnd')).toBe(false);
    expect(raceOf(sim, sim.playerId)?.raceId).toBe(s.raceId);
  });

  it('clearing every jump then riding through the arch finishes with a time', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    for (const jump of MOUNT_RACE_COURSE.jumps) {
      const events = rideThrough(sim, sim.playerId, jump, { jump: true });
      expect(events.some((e) => e.type === 'mountRaceJump')).toBe(true);
    }
    const allMask = (1 << MOUNT_RACE_COURSE.jumps.length) - 1;
    expect(raceOf(sim, sim.playerId)?.clearedMask).toBe(allMask);
    const finish = rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.arch);
    const end = findEv(finish, 'mountRaceEnd');
    expect(end).toBeDefined();
    expect(end!.outcome).toBe('finished');
    expect(end!.timeTicks).toBeGreaterThan(0);
    expect(end!.timeTicks).toBeLessThan(MOUNT_RACE_TIME_LIMIT_TICKS);
    expect(raceOf(sim, sim.playerId)).toBeNull();
    expect(sim.mountRaceView()).toBeNull();
  }, 20000);
});

describe('losing a race', () => {
  it('running out of time fails immediately and dismounts the rider', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    const events: SimEvent[] = [];
    for (let i = 0; i <= MOUNT_RACE_TIME_LIMIT_TICKS + 2; i++) events.push(...sim.tick());
    expect(findEv(events, 'mountRaceEnd')?.outcome).toBe('timeout');
    expect(raceOf(sim, sim.playerId)).toBeNull();
    expect(sim.player.mountKey).toBe('');
  }, 20000);

  it('leaving the paddock voids the run', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    teleport(sim, sim.playerId, STABLE_PADDOCK.x1 - 10, STABLE_PADDOCK.z1 - 10);
    const events = sim.tick();
    expect(findEv(events, 'mountRaceEnd')?.outcome).toBe('abandoned');
    expect(raceOf(sim, sim.playerId)).toBeNull();
  });

  it('dismounting mid-race voids the run; a fresh start arms a new race id', () => {
    const sim = makeSim();
    mountUp(sim, sim.playerId);
    startRace(sim, sim.playerId);
    sim.toggleMounted();
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && !events.some((e) => e.type === 'mountRaceEnd'); i++)
      events.push(...sim.tick());
    expect(findEv(events, 'mountRaceEnd')?.outcome).toBe('abandoned');
    expect(raceOf(sim, sim.playerId)).toBeNull();
    // Remount and start again: a brand-new race id.
    const e = sim.entities.get(sim.playerId)!;
    sim.useItem('reins_valorsteed');
    for (let i = 0; i < 80 && e.mountKey === ''; i++) sim.tick();
    const armed = startRace(sim, sim.playerId);
    expect(armed.some((ev) => ev.type === 'mountRaceStart')).toBe(true);
  });

  it('leaving the game mid-race discards the session with the player', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    mountUp(sim, pid);
    startRace(sim, pid);
    expect(sim.players.get(pid)!.mountRace).not.toBeNull();
    sim.removePlayer(pid);
    expect(sim.players.has(pid)).toBe(false);
    const pid2 = sim.addPlayer('warrior', 'RiderTwo');
    expect(sim.players.get(pid2)!.mountRace ?? null).toBeNull();
  });
});

describe('per-player isolation (the online concurrency requirement)', () => {
  it('two riders race the same course at once with independent timers and progress', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const a = sim.addPlayer('warrior', 'RiderA');
    const b = sim.addPlayer('mage', 'RiderB');
    mountUp(sim, a);
    mountUp(sim, b);
    // A starts and reaches GO; B is parked in the pasture, not racing yet.
    teleport(sim, b, STABLE_PASTURE.xMin + 2, STABLE_PASTURE.zMin + 2);
    startRace(sim, a);
    expect(raceOf(sim, a)?.phase).toBe('racing');
    expect(raceOf(sim, b)).toBeNull();
    const sa = raceOf(sim, a)!;

    startRace(sim, b);
    const sb = raceOf(sim, b)!;
    expect(sb.raceId).not.toBe(sa.raceId);

    // A clears the first jump; B's progress is untouched (events are pid-scoped).
    const aJump = rideThrough(sim, a, MOUNT_RACE_COURSE.jumps[0], { jump: true });
    expect(findEv(aJump, 'mountRaceJump')?.pid).toBe(a);
    expect(raceOf(sim, a)?.clearedMask).toBe(1);
    expect(raceOf(sim, b)?.clearedMask).toBe(0);

    // A finishes; B's race is still live and untouched.
    for (let j = 1; j < MOUNT_RACE_COURSE.jumps.length; j++)
      rideThrough(sim, a, MOUNT_RACE_COURSE.jumps[j], { jump: true });
    const aFinish = rideThrough(sim, a, MOUNT_RACE_COURSE.arch);
    expect(findEv(aFinish, 'mountRaceEnd')?.outcome).toBe('finished');
    expect(raceOf(sim, a)).toBeNull();
    expect(raceOf(sim, b)).not.toBeNull();
    expect(raceOf(sim, b)?.clearedMask).toBe(0);

    // B can still finish their own race afterward.
    for (const jump of MOUNT_RACE_COURSE.jumps) rideThrough(sim, b, jump, { jump: true });
    const bFinish = rideThrough(sim, b, MOUNT_RACE_COURSE.arch);
    expect(findEv(bFinish, 'mountRaceEnd')?.outcome).toBe('finished');
    expect(findEv(bFinish, 'mountRaceEnd')?.pid).toBe(b);
  }, 40000);
});

describe('determinism', () => {
  it('the same seed and the same ride produce the same race events (no rng drawn)', () => {
    const run = () => {
      const sim = makeSim(77);
      mountUp(sim, sim.playerId);
      const trace: string[] = [];
      const record = (events: SimEvent[]) => {
        for (const e of events) if (e.type.startsWith('mountRace')) trace.push(JSON.stringify(e));
      };
      record(startRace(sim, sim.playerId));
      record(rideThrough(sim, sim.playerId, MOUNT_RACE_COURSE.jumps[0], { jump: true }));
      for (let i = 0; i <= MOUNT_RACE_TIME_LIMIT_TICKS; i++) record(sim.tick());
      return trace.join('\n');
    };
    const first = run();
    expect(first).toContain('mountRaceStart');
    expect(first).toContain('mountRaceJump');
    expect(first).toContain('timeout');
    expect(run()).toBe(first);
  }, 30000);
});

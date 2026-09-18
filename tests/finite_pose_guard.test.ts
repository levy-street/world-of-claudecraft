// The last-finite-pose guard (src/sim/finite_pose_guard.ts) is the backstop for
// the v0.43.0 freeze class: a NaN player position matches nothing in the
// interest scope (the world stops for that player while chat still flows) and
// NaNs the mirrored camera, whose maze camera-lift then threw every frame and
// killed the render loop. PR 4079 removes the one known source (opposed movement
// keys); this guard makes the NEXT source degrade to a held pose plus a
// throttled dev-channel warning instead of a frozen screen. Pinned per pose
// component on the module, through the integrator (a NaN that arises mid-step,
// so the end-of-step placement is what catches it), and through the live Sim
// tick: a NaN left behind between steps (the prologue arm), a persistent
// source (the throttle), a non-finite fall start (no NaN damage), the
// players-only scope, and same-seed determinism of the recovery.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  guardFinitePose,
  isPoseFinite,
  NON_FINITE_WARN_EVERY,
  warnNonFinitePose,
} from '../src/sim/finite_pose_guard';
import { sanitizeMoveInput } from '../src/sim/move_input';
import { type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function rig(seed = 7) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('mage', 'Guarded') as number;
  sim.setPlayerLevel(20, pid);
  // Let the spawn settle onto the ground before anything is injected.
  for (let i = 0; i < 10; i++) sim.tick();
  const me = sim.entities.get(pid) as Entity;
  const meta = sim.meta(pid);
  if (!meta) throw new Error('player meta missing');
  return { sim, pid, me, meta };
}

/** The live deps are private on Sim; the tests poison one callback in place. */
const liveDeps = (sim: Sim): PlayerMotionDeps =>
  (sim as unknown as { playerMotionDeps: PlayerMotionDeps }).playerMotionDeps;

const pose = (p: Entity) => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z, facing: p.facing });

const silentDeps = (seed: number): PlayerMotionDeps => ({
  seed,
  moveSpeedMult: () => 1,
  resolveMove: (_fx, _fz, nx, nz) => ({ x: nx, z: nz }),
  resolvedAbility: () => null,
  cancelCast: () => {},
  standUp: () => {},
  dealDamage: () => {},
});

const poseWarnings = (calls: unknown[][]) =>
  calls.filter((c) => String(c[0]).includes('non-finite pose')).map((c) => String(c[0]));

/** Stamp a landing the way a teleport does: pos and prevPos together. */
function land(p: Entity, x: number, y: number, z: number): void {
  p.pos.x = x;
  p.pos.y = y;
  p.pos.z = z;
  p.prevPos.x = x;
  p.prevPos.y = y;
  p.prevPos.z = z;
}

afterEach(() => vi.restoreAllMocks());

describe('finite pose guard: module', () => {
  it('leaves a finite pose, its momentum and its fall start untouched', () => {
    const { me } = rig();
    me.vx = 2;
    me.vz = -1;
    me.fallStartY = 50;
    const before = pose(me);
    expect(guardFinitePose(me)).toBe(false);
    expect(pose(me)).toEqual(before);
    expect(me.vx).toBe(2);
    expect(me.vz).toBe(-1);
    expect(me.fallStartY).toBe(50);
  });

  it.each([
    ['pos.x', (p: Entity) => (p.pos.x = Number.NaN)],
    ['pos.y', (p: Entity) => (p.pos.y = Number.POSITIVE_INFINITY)],
    ['pos.z', (p: Entity) => (p.pos.z = Number.NaN)],
    ['facing', (p: Entity) => (p.facing = Number.NaN)],
    ['vx', (p: Entity) => (p.vx = Number.NaN)],
    ['vz', (p: Entity) => (p.vz = Number.NEGATIVE_INFINITY)],
    ['vy', (p: Entity) => (p.vy = Number.NaN)],
    ['fallStartY', (p: Entity) => (p.fallStartY = Number.NaN)],
  ])('restores when only %s is non-finite', (field, breakIt) => {
    const { me } = rig();
    land(me, 12, 3, -40);
    me.prevFacing = 0.75;
    me.facing = 0.5;
    me.vx = 2;
    me.vz = -1;
    me.fallStartY = 50;
    breakIt(me);
    expect(isPoseFinite(me)).toBe(false);
    expect(guardFinitePose(me)).toBe(true);
    expect(isPoseFinite(me)).toBe(true);
    const posField = field.startsWith('pos.');
    const velField = field === 'vx' || field === 'vz' || field === 'vy';
    // Position comes back as the prevPos point when it broke, else stays.
    expect({ x: me.pos.x, y: me.pos.y, z: me.pos.z }).toEqual({ x: 12, y: 3, z: -40 });
    expect(me.facing).toBe(field === 'facing' ? 0.75 : 0.5);
    if (posField || velField) {
      expect([me.vx, me.vz, me.vy]).toEqual([0, 0, 0]);
    } else {
      expect(me.vx).toBe(2);
      expect(me.vz).toBe(-1);
    }
    expect(me.fallStartY).toBe(posField || field === 'fallStartY' ? 3 : 50);
  });

  it('restores to the landing after a teleport, never an older pose', () => {
    const { me } = rig();
    const spawn = pose(me);
    guardFinitePose(me);
    land(me, 300, 9, 300);
    me.pos.x = Number.NaN;
    expect(guardFinitePose(me)).toBe(true);
    expect({ x: me.pos.x, y: me.pos.y, z: me.pos.z }).toEqual({ x: 300, y: 9, z: 300 });
    expect(me.pos.x).not.toBe(spawn.x);
  });

  it('zeroes only the broken axes when prevPos is not finite either', () => {
    const { me } = rig();
    me.pos.x = Number.NaN;
    me.pos.y = 4;
    me.pos.z = Number.POSITIVE_INFINITY;
    me.prevPos.x = Number.NaN;
    me.facing = Number.NaN;
    me.prevFacing = Number.NaN;
    expect(guardFinitePose(me)).toBe(true);
    expect({ x: me.pos.x, y: me.pos.y, z: me.pos.z }).toEqual({ x: 0, y: 4, z: 0 });
    expect(me.facing).toBe(0);
    expect(me.fallStartY).toBe(4);
    expect(isPoseFinite(me)).toBe(true);
  });

  it('the warning names the entity and the held input, or says there was none', () => {
    const { me } = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inp = sanitizeMoveInput({});
    inp.strafeLeft = true;
    inp.strafeRight = true;
    warnNonFinitePose({}, me, inp);
    const lines = poseWarnings(warn.mock.calls);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`player ${me.id} Guarded`);
    expect(lines[0]).toContain('"strafeLeft":true');
    expect(lines[0]).toContain('"strafeRight":true');
    warnNonFinitePose({}, me, undefined);
    expect(poseWarnings(warn.mock.calls)[1]).toContain('between steps');
  });

  it('the label degrades to the id for a bare prediction state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bare = { id: 42, pos: { x: 0, y: 0, z: 0 } } as unknown as Entity;
    warnNonFinitePose({}, bare, undefined);
    const line = poseWarnings(warn.mock.calls)[0];
    expect(line).toContain('restored for 42 (');
    expect(line).not.toContain('undefined');
  });

  it('the warning is throttled per entity within a host, and hosts do not share counters', () => {
    const { me, sim } = rig();
    const other = sim.entities.get(sim.addPlayer('druid', 'Other') as number) as Entity;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inp = sanitizeMoveInput({});
    const host = {};
    for (let n = 0; n < NON_FINITE_WARN_EVERY * 2; n++) warnNonFinitePose(host, me, inp);
    expect(poseWarnings(warn.mock.calls)).toHaveLength(3);
    warnNonFinitePose(host, other, inp);
    expect(poseWarnings(warn.mock.calls)).toHaveLength(4);
    expect(poseWarnings(warn.mock.calls)[3]).toContain(`player ${other.id} Other`);
    // A second Sim in the same process (tests, multi-realm) starts its own count.
    warnNonFinitePose({}, me, inp);
    expect(poseWarnings(warn.mock.calls)).toHaveLength(5);
  });
});

describe('finite pose guard: integrator', () => {
  it('a NaN that arises mid-step is caught at the end of the step, once, with the input', () => {
    const { me } = rig();
    const hook = vi.fn();
    const deps: PlayerMotionDeps = { ...silentDeps(7), onNonFinitePose: hook };
    const idle = sanitizeMoveInput({});
    stepPlayerMotion(deps, me, idle);
    expect(hook).not.toHaveBeenCalled();
    const before = pose(me);
    // A NaN speed multiplier poisons the wish vector inside the step; the
    // pose is finite on entry, so only an end-of-step guard can catch it.
    const poisoned: PlayerMotionDeps = { ...deps, moveSpeedMult: () => Number.NaN };
    const forward = sanitizeMoveInput({});
    forward.forward = true;
    stepPlayerMotion(poisoned, me, forward);
    expect(isPoseFinite(me)).toBe(true);
    expect(pose(me)).toEqual(before);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(me, forward);
    // The body keeps working afterwards: a plain step stays finite and quiet.
    stepPlayerMotion(deps, me, idle);
    expect(isPoseFinite(me)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe('finite pose guard: live Sim', () => {
  it('a NaN left behind between steps is restored by the next prologue, with one warning', () => {
    const { sim, me, meta } = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Walk first so the held pose is not the spawn point.
    meta.moveInput.forward = true;
    for (let i = 0; i < 5; i++) sim.tick();
    meta.moveInput.forward = false;
    sim.tick();
    const before = pose(me);
    // Something outside the integrator (a knockback, a script) NaNs the pose
    // after the movement phase: the prologue must keep prevPos finite and
    // restore before the pose spreads.
    me.pos.x = Number.NaN;
    me.pos.y = Number.NaN;
    sim.tick();
    expect(isPoseFinite(me)).toBe(true);
    expect(me.pos.x).toBeCloseTo(before.x, 6);
    expect(me.pos.y).toBeCloseTo(before.y, 6);
    expect(me.pos.z).toBeCloseTo(before.z, 6);
    expect(Number.isFinite(me.prevPos.x)).toBe(true);
    const lines = poseWarnings(warn.mock.calls);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('between steps');
    for (let i = 0; i < 20; i++) sim.tick();
    expect(isPoseFinite(me)).toBe(true);
    expect(poseWarnings(warn.mock.calls)).toHaveLength(1);
  });

  it('a persistent source holds the body in place and is throttled to the first and every Nth line', () => {
    const { sim, me, meta } = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = pose(me);
    liveDeps(sim).moveSpeedMult = () => Number.NaN;
    meta.moveInput.forward = true;
    for (let i = 0; i < NON_FINITE_WARN_EVERY * 2; i++) {
      sim.tick();
      expect(isPoseFinite(me), `tick ${i + 1}`).toBe(true);
    }
    expect(me.pos.x).toBeCloseTo(start.x, 6);
    expect(me.pos.z).toBeCloseTo(start.z, 6);
    const lines = poseWarnings(warn.mock.calls);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"forward":true');
  });

  it('a non-finite fall start never turns into non-finite damage', () => {
    const { sim, me } = rig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    me.onGround = false;
    me.pos.y += 30;
    me.fallStartY = Number.NaN;
    for (let i = 0; i < 60; i++) sim.tick();
    expect(Number.isFinite(me.hp)).toBe(true);
    expect(isPoseFinite(me)).toBe(true);
  });

  it('guards players only: a NaN mob keeps a finite prevPos but is not restored', () => {
    const { sim } = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead) as Entity;
    expect(mob).toBeDefined();
    const prevX = mob.prevPos.x;
    mob.pos.x = Number.NaN;
    sim.tick();
    expect(Number.isNaN(mob.pos.x)).toBe(true);
    expect(Number.isFinite(mob.prevPos.x)).toBe(true);
    expect(mob.prevPos.x).toBe(prevX);
    expect(poseWarnings(warn.mock.calls)).toHaveLength(0);
  });

  it('the recovery is deterministic for the same seed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = () => {
      const { sim, me, meta } = rig(11);
      meta.moveInput.forward = true;
      for (let i = 0; i < 4; i++) sim.tick();
      me.vy = Number.NaN;
      me.onGround = false;
      for (let i = 0; i < 30; i++) sim.tick();
      return pose(me);
    };
    expect(run()).toEqual(run());
  });
});

import { describe, expect, it } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  FOLLOWER_HOP_RISE,
  type GestureOwnerView,
  type GestureRig,
  type GestureView,
  newFollowerHopTrack,
  stepFollowerHop,
  tickEntityGestures,
} from '../src/render/entity_gesture_core';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { DT, type Entity } from '../src/sim/types';

const STANDING: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

function rig(): GestureRig & { emotes: string[]; hops: boolean[] } {
  const emotes: string[] = [];
  const hops: boolean[] = [];
  return {
    emotes,
    hops,
    playEmote: (id) => emotes.push(id),
    playHop: (moving) => hops.push(moving),
  };
}

function ownerView(airborne: boolean, y: number): GestureOwnerView {
  return { wasAirborne: airborne, prevRenderY: y };
}

describe('stepFollowerHop', () => {
  it('hops once when the owner leaves the ground and RISES', () => {
    const t = newFollowerHopTrack(false, 10);
    expect(stepFollowerHop(t, false, 10)).toBe(false);
    // The airborne edge alone only arms it.
    expect(stepFollowerHop(t, true, 10)).toBe(false);
    expect(stepFollowerHop(t, true, 10 + FOLLOWER_HOP_RISE / 2)).toBe(false);
    // The rise commits it, exactly once for the whole jump.
    expect(stepFollowerHop(t, true, 10 + FOLLOWER_HOP_RISE * 1.5)).toBe(true);
    expect(stepFollowerHop(t, true, 10.9)).toBe(false);
    expect(stepFollowerHop(t, true, 10.2)).toBe(false);
    expect(stepFollowerHop(t, false, 10)).toBe(false);
  });

  it('does not hop when the owner walks off a ledge (airborne, but only ever falling)', () => {
    const t = newFollowerHopTrack(false, 10);
    expect(stepFollowerHop(t, true, 10)).toBe(false);
    // A sag short of the threshold leaves it armed...
    expect(stepFollowerHop(t, true, 10 - FOLLOWER_HOP_RISE / 2)).toBe(false);
    // ...and a real drop disarms it for the rest of this fall: bouncing back
    // above the lip afterwards is not a jump.
    expect(stepFollowerHop(t, true, 10 - FOLLOWER_HOP_RISE * 1.5)).toBe(false);
    expect(stepFollowerHop(t, true, 10 + 1)).toBe(false);
    expect(stepFollowerHop(t, false, 4)).toBe(false);
  });

  it('measures the rise from the first AIRBORNE frame, not from the last grounded one', () => {
    // Grounded frames never set the reference, whatever the ground does.
    const t = newFollowerHopTrack(false, 10);
    for (let y = 10; y <= 12; y += 0.25) expect(stepFollowerHop(t, false, y)).toBe(false);
    // First airborne frame at 12.4: the 0.4 the owner gained since its last
    // grounded frame is slope travel, and is not counted as rise.
    expect(stepFollowerHop(t, true, 12.4)).toBe(false);
    expect(stepFollowerHop(t, true, 12.4 + FOLLOWER_HOP_RISE / 2)).toBe(false);
    expect(stepFollowerHop(t, true, 12.4 + FOLLOWER_HOP_RISE * 1.5)).toBe(true);
  });

  it('hops again on the next jump, and never for a jump already in the air when first seen', () => {
    const seenMidAir = newFollowerHopTrack(true, 11);
    expect(stepFollowerHop(seenMidAir, true, 11.6)).toBe(false);
    expect(stepFollowerHop(seenMidAir, false, 10)).toBe(false);
    expect(stepFollowerHop(seenMidAir, true, 10)).toBe(false);
    expect(stepFollowerHop(seenMidAir, true, 10.3)).toBe(true);
    expect(stepFollowerHop(seenMidAir, false, 10)).toBe(false);
    expect(stepFollowerHop(seenMidAir, true, 10)).toBe(false);
    expect(stepFollowerHop(seenMidAir, true, 10.3)).toBe(true);
  });
});

// The reference-frame bug this module shipped with once: on a slope, the
// ground the owner covered between its last grounded render frame and its
// first airborne one is itself a rise or a drop. Measured from the grounded
// frame, an uphill run off a ledge read as a jump and a jump taken running
// downhill read as a fall. These drive the detector with the heights a render
// loop really samples: the sim's own 20 Hz ballistics (player_motion.ts: a
// jump starts at JUMP_VELOCITY, a walk-off at vy = 0 from the height it had),
// drawn one tick behind and interpolated, at three frame rates and a spread of
// frame phases.
describe('stepFollowerHop on a slope, as a render loop samples it', () => {
  /** Hops counted over one flight. `slopeRate` is how fast the ground under the
   *  running owner was rising (yd/s, negative downhill) before the event. */
  function hopsOver(
    event: 'jump' | 'ledge',
    slopeRate: number,
    fps: number,
    phase: number,
  ): number {
    const LEAD = 12; // grounded ticks before the event
    const ys: number[] = [];
    const air: boolean[] = [];
    let y = 0;
    for (let k = 0; k < LEAD; k++) {
      y = slopeRate * DT * k;
      ys.push(y);
      air.push(false);
    }
    let vy = event === 'jump' ? JUMP_VELOCITY : 0;
    for (let k = 0; k < 14; k++) {
      // The walk-off tick leaves the body at the height it had and only then
      // lets gravity at it; the jump tick integrates its first step at once.
      if (event === 'jump' || k > 0) {
        vy -= GRAVITY * DT;
        y += vy * DT;
      }
      ys.push(y);
      air.push(true);
    }
    const track = newFollowerHopTrack(false, 0);
    let hops = 0;
    const end = (ys.length - 1) * DT;
    for (let time = DT + phase / fps; time < end; time += 1 / fps) {
      const tick = Math.floor(time / DT);
      const alpha = time / DT - tick;
      // Drawn one tick behind, interpolated; the airborne bit is the live one.
      const shown = ys[tick - 1] + (ys[tick] - ys[tick - 1]) * alpha;
      if (stepFollowerHop(track, air[tick], shown)) hops++;
    }
    return hops;
  }

  const RATES = [-6, -4.5, -3.5, -2.5, -1.5, 0, 0.75, 1, 1.5, 2.5, 3.5, 4.5, 6];
  const PHASES = [0, 0.13, 0.29, 0.41, 0.5, 0.67, 0.83, 0.97];

  for (const fps of [30, 60, 144]) {
    it(`hops exactly once for a jump on any slope at ${fps} fps`, () => {
      for (const rate of RATES) {
        for (const phase of PHASES) {
          expect(hopsOver('jump', rate, fps, phase), `rate ${rate} phase ${phase}`).toBe(1);
        }
      }
    });

    it(`never hops for a walk off a ledge on any slope at ${fps} fps`, () => {
      for (const rate of RATES) {
        for (const phase of PHASES) {
          expect(hopsOver('ledge', rate, fps, phase), `rate ${rate} phase ${phase}`).toBe(0);
        }
      }
    });
  }
});

describe('tickEntityGestures', () => {
  function buddyOf(ownerId: number): Entity {
    const buddy = createMob(900, MOBS[buddyTemplateId('horse')], 1, { x: 0, y: 0, z: 0 });
    buddy.ownerId = ownerId;
    return buddy;
  }

  it('hops a buddy when its owner jumps, telling the rig whether the buddy is on the move', () => {
    const buddy = buddyOf(7);
    const v: GestureView = { lastOverheadEmoteKey: null };
    const r = rig();
    const owner = ownerView(false, 5);
    const views = new Map([[7, owner]]);
    tickEntityGestures(v, buddy, STANDING, false, r, views, true);
    owner.wasAirborne = true;
    tickEntityGestures(v, buddy, STANDING, false, r, views, true);
    expect(r.hops).toEqual([]);
    owner.prevRenderY = 5.3;
    tickEntityGestures(v, buddy, STANDING, true, r, views, true);
    expect(r.hops).toEqual([true]);
    owner.prevRenderY = 5.9;
    tickEntityGestures(v, buddy, STANDING, true, r, views, true);
    expect(r.hops).toEqual([true]);
  });

  it("keeps the follower's read of its owner on the follower's own view", () => {
    const buddy = buddyOf(7);
    const v: GestureView = { lastOverheadEmoteKey: null };
    const owner = ownerView(false, 5);
    tickEntityGestures(v, buddy, STANDING, false, rig(), new Map([[7, owner]]), true);
    expect(v.hopTrack).toEqual({ airborne: false, takeoffY: 5, pending: false });
    // A second buddy view is a second, independent read.
    const other: GestureView = { lastOverheadEmoteKey: null };
    owner.wasAirborne = true;
    tickEntityGestures(other, buddyOf(7), STANDING, false, rig(), new Map([[7, owner]]), true);
    expect(other.hopTrack).toEqual({ airborne: true, takeoffY: 5, pending: false });
    expect(v.hopTrack?.airborne).toBe(false);
  });

  it('sits a jump out while searching, swimming, dead or out of view, and does not replay it', () => {
    const busies: { st: Partial<AnimState>; presenting: boolean }[] = [
      { st: { casting: true }, presenting: true },
      { st: { swimming: true }, presenting: true },
      { st: { dead: true }, presenting: true },
      // Out of the camera's view: the rig runs no state machine, so a hop
      // started there would sit latched and play when the camera found it.
      { st: {}, presenting: false },
    ];
    for (const busy of busies) {
      const buddy = buddyOf(7);
      const v: GestureView = { lastOverheadEmoteKey: null };
      const r = rig();
      const owner = ownerView(false, 5);
      const views = new Map([[7, owner]]);
      const st = { ...STANDING, ...busy.st };
      tickEntityGestures(v, buddy, st, false, r, views, busy.presenting);
      owner.wasAirborne = true;
      tickEntityGestures(v, buddy, st, false, r, views, busy.presenting);
      owner.prevRenderY = 5.4;
      tickEntityGestures(v, buddy, st, false, r, views, busy.presenting);
      // Free again while the owner is still in the same jump: that jump is spent.
      owner.prevRenderY = 5.8;
      tickEntityGestures(v, buddy, STANDING, false, r, views, true);
      expect(r.hops, JSON.stringify(busy)).toEqual([]);
      // The next jump is a fresh one.
      owner.wasAirborne = false;
      owner.prevRenderY = 5;
      tickEntityGestures(v, buddy, STANDING, false, r, views, true);
      owner.wasAirborne = true;
      tickEntityGestures(v, buddy, STANDING, false, r, views, true);
      owner.prevRenderY = 5.4;
      tickEntityGestures(v, buddy, STANDING, false, r, views, true);
      expect(r.hops, JSON.stringify(busy)).toEqual([false]);
    }
  });

  it('never hops anything that is not a buddy, or a buddy whose owner is out of view', () => {
    const r = rig();
    const owner = ownerView(false, 5);
    const views = new Map([[7, owner]]);
    // A hunter-style owned mob (not a buddy template) and an unowned mob.
    const pet = createMob(901, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    pet.ownerId = 7;
    const wolf = createMob(902, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    const stray = buddyOf(99);
    const all = [pet, wolf, stray];
    const vs = all.map(() => ({ lastOverheadEmoteKey: null }) as GestureView);
    for (const [i, e] of all.entries()) {
      tickEntityGestures(vs[i], e, STANDING, false, r, views, true);
    }
    owner.wasAirborne = true;
    for (const [i, e] of all.entries()) {
      tickEntityGestures(vs[i], e, STANDING, false, r, views, true);
    }
    owner.prevRenderY = 5.5;
    for (const [i, e] of all.entries()) {
      tickEntityGestures(vs[i], e, STANDING, false, r, views, true);
    }
    expect(r.hops).toEqual([]);
    expect(vs.map((v) => v.hopTrack)).toEqual([undefined, undefined, undefined]);
  });

  it('plays a player emote once per id+sequence edge, only while standing free', () => {
    const p = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Emoter');
    const v: GestureView = { lastOverheadEmoteKey: null };
    const r = rig();
    const views = new Map<number, GestureOwnerView>();
    p.overheadEmoteId = 'wave';
    p.overheadEmoteSeq = 1;
    // Moving: not yet, and the edge is NOT consumed.
    tickEntityGestures(v, p, { ...STANDING, moving: true }, true, r, views, true);
    expect(r.emotes).toEqual([]);
    expect(v.lastOverheadEmoteKey).toBeNull();
    tickEntityGestures(v, p, STANDING, false, r, views, true);
    expect(r.emotes).toEqual(['wave']);
    // Held state: no replay on the next frame.
    tickEntityGestures(v, p, STANDING, false, r, views, true);
    expect(r.emotes).toEqual(['wave']);
    // The same emote fired again is a new sequence number, so a new edge.
    p.overheadEmoteSeq = 2;
    tickEntityGestures(v, p, STANDING, false, r, views, true);
    expect(r.emotes).toEqual(['wave', 'wave']);
    // The emote keeps the behaviour it had in the renderer: it does not read
    // `presenting`, so an off-screen player's emote edge is consumed as before.
    p.overheadEmoteSeq = 3;
    tickEntityGestures(v, p, STANDING, false, r, views, false);
    expect(r.emotes).toEqual(['wave', 'wave', 'wave']);
    // Clearing the emote clears the latch, so the next one always plays.
    p.overheadEmoteId = null;
    tickEntityGestures(v, p, STANDING, false, r, views, true);
    expect(v.lastOverheadEmoteKey).toBeNull();
    for (const blocked of [
      { airborne: true },
      { swimming: true },
      { casting: true },
      { sitting: true },
    ]) {
      p.overheadEmoteId = 'cheer';
      p.overheadEmoteSeq += 1;
      tickEntityGestures(v, p, { ...STANDING, ...blocked }, false, r, views, true);
    }
    expect(r.emotes).toEqual(['wave', 'wave', 'wave']);
    p.dead = true;
    tickEntityGestures(v, p, STANDING, false, r, views, true);
    expect(r.emotes).toEqual(['wave', 'wave', 'wave']);
    // A player never grows a hop track.
    expect(v.hopTrack).toBeUndefined();
  });
});

// The drawn half of sitting (src/render/seated_pose_core.ts, seat_pick_core.ts,
// characters/seat_clips.ts and the pointer's src/game/seat_interact.ts): a seated body is
// drawn at its seat's anchor lifted onto the seat, walks in and out along its path, gets
// up with the stand-up clip, a first sight skips the sit-down; the pointer's ray picks the
// seat box it enters and a click on a held place falls to a free one on the same bench;
// each pose and idle plays its own authored clip.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  chooseSeatForClick,
  createSeatInteraction,
  SEAT_SIT_SETTLE_MS,
} from '../src/game/seat_interact';
import type { AnimState } from '../src/render/characters/anim_state';
import { SEAT_CLIPS } from '../src/render/characters/manifest';
import { seatClip, seatClipNames } from '../src/render/characters/seat_clips';
import { pickSeatOnRay } from '../src/render/seat_pick_core';
import { applySeatAnim, applySeatedPose } from '../src/render/seated_pose';
import {
  createSeatViewState,
  heldSeatForDraw,
  preSitSpot,
  SEAT_APPROACH_DWELL,
  SEAT_APPROACH_SPEED,
  SEAT_CLIP_PRESIT,
  SEAT_RISE_SECONDS,
  type SeatLiveInput,
  stepSeatView,
} from '../src/render/seated_pose_core';
import { MIREFEN_TAVERN_SEATS } from '../src/sim/content/mirefen_tavern_seats';
import { type SeatAnchor, seatRootY } from '../src/sim/seat_anchor';
import type { Entity } from '../src/sim/types';

const byId = (id: string): SeatAnchor => {
  const s = MIREFEN_TAVERN_SEATS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const standing = (s: SeatAnchor, held: SeatAnchor | null): SeatLiveInput => ({
  held,
  x: s.standX,
  y: s.floorY,
  z: s.standZ,
  facing: 0,
  idle: 'rest',
});
const DT = 1 / 60;

describe('the drawn seated body', () => {
  it('draws a body first seen seated straight in its seat, lifted onto it', () => {
    const s = byId('tavern_chair_2');
    const v = createSeatViewState();
    stepSeatView(v, standing(s, s), DT);
    expect(v.phase).toBe('seated');
    expect(v.x).toBe(s.x);
    expect(v.z).toBe(s.z);
    expect(v.y).toBe(s.floorY);
    expect(v.facing).toBe(s.facing);
    expect(v.lift).toBeCloseTo(seatRootY(s) - s.floorY, 12);
    expect(v.anim).toEqual({
      pose: 'relaxed',
      idle: 'rest',
      rising: false,
      skipDown: true,
      rate: 1,
    });
  });

  it('walks a body in through its via point, turns to the seat, then sits down', () => {
    const s = byId('tavern_settle_2_0'); // a booth's inner place: slides in along the gap
    expect(s.via).toBeDefined();
    const v = createSeatViewState();
    stepSeatView(v, standing(s, null), DT); // seen standing first
    expect(v.phase).toBe('none');
    const via = s.via as { x: number; z: number };
    let passedVia = false;
    let frames = 0;
    stepSeatView(v, standing(s, s), DT);
    while (v.phase === 'approach' && frames < 600) {
      // walking, then standing still on the pre-sit spot for the dwell
      if (v.moving) expect(v.speed).toBe(SEAT_APPROACH_SPEED);
      else expect(Math.hypot(v.x - preSitSpot(s).x, v.z - preSitSpot(s).z)).toBeLessThan(1e-9);
      expect(v.lift).toBe(0);
      expect(v.anim).toBeNull();
      if (Math.hypot(v.x - via.x, v.z - via.z) < 0.05) passedVia = true;
      stepSeatView(v, standing(s, s), DT);
      frames++;
    }
    expect(passedVia).toBe(true);
    expect(v.phase).toBe('seated');
    expect(v.anim).toEqual({
      pose: 'relaxed',
      idle: 'rest',
      rising: false,
      skipDown: false,
      rate: 1,
    });
    // the walk's length at the walking pace
    const pre = preSitSpot(s);
    const len =
      Math.hypot(via.x - s.standX, via.z - s.standZ) + Math.hypot(pre.x - via.x, pre.z - via.z);
    expect(frames * DT).toBeCloseTo(len / SEAT_APPROACH_SPEED + SEAT_APPROACH_DWELL, 1);
  });

  it('gets up at the seat with the stand-up clip, then walks back to the live body', () => {
    const s = byId('tavern_barstool_0');
    const v = createSeatViewState();
    stepSeatView(v, standing(s, s), DT);
    stepSeatView(v, standing(s, null), DT);
    expect(v.phase).toBe('rising');
    expect(v.anim?.rising).toBe(true);
    expect(v.anim?.pose).toBe('high');
    expect(v.x).toBe(s.x);
    let t = DT;
    while (v.phase === 'rising') {
      stepSeatView(v, standing(s, null), DT);
      t += DT;
    }
    // in place, the clip plays at its own speed
    expect(t).toBeGreaterThanOrEqual(SEAT_RISE_SECONDS.high - 1e-9);
    expect(v.phase).toBe('leaving');
    for (let i = 0; i < 200 && v.phase !== 'none'; i++) stepSeatView(v, standing(s, null), DT);
    expect(v.phase).toBe('none');
    expect(v.x).toBe(s.standX);
    expect(v.z).toBe(s.standZ);
    expect(v.lift).toBe(0);
    expect(v.anim).toBeNull();
  });

  it('slides the root so the standing frames start and end on the pre-sit spot', () => {
    // a bar stool: the counter keeps the pre-sit spot nearer than the clips stand the body
    const s = byId('tavern_barstool_2');
    expect(s.presit).toBeLessThan(SEAT_CLIP_PRESIT);
    const v = createSeatViewState();
    stepSeatView(v, standing(s, null), DT);
    stepSeatView(v, standing(s, s), DT);
    while (v.phase === 'approach') stepSeatView(v, standing(s, s), DT);
    // the first seated frame: the clip's standing body (SEAT_CLIP_PRESIT in front of the
    // root) lands exactly on the pre-sit spot the walk ended on
    const f = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
    const pre = preSitSpot(s);
    const body = { x: v.x + f.x * SEAT_CLIP_PRESIT, z: v.z + f.z * SEAT_CLIP_PRESIT };
    expect(Math.hypot(body.x - pre.x, body.z - pre.z)).toBeLessThan(0.02);
    // and once seated the root is on the anchor
    for (let i = 0; i < 120; i++) stepSeatView(v, standing(s, s), DT);
    expect(v.x).toBeCloseTo(s.x, 9);
    expect(v.z).toBeCloseTo(s.z, 9);
  });

  it('hurries the stand-up when the body is already walking off', () => {
    const s = byId('tavern_chair_0');
    const v = createSeatViewState();
    stepSeatView(v, standing(s, s), DT);
    const away = { ...standing(s, null), x: s.standX + 2 };
    let t = 0;
    stepSeatView(v, away, DT);
    while (v.phase === 'rising') {
      stepSeatView(v, away, DT);
      t += DT;
    }
    expect(t).toBeLessThan(SEAT_RISE_SECONDS.relaxed / 2);
  });

  it('draws only the living, and only on their own stand spot', () => {
    const s = byId('tavern_hearth_0_0');
    const seats = MIREFEN_TAVERN_SEATS;
    expect(heldSeatForDraw(seats, true, false, s.standX, s.floorY, s.standZ)).toBe(s);
    expect(heldSeatForDraw(seats, true, true, s.standX, s.floorY, s.standZ)).toBeNull();
    expect(heldSeatForDraw(seats, false, false, s.standX, s.floorY, s.standZ)).toBeNull();
    expect(heldSeatForDraw(seats, true, false, s.standX + 0.5, s.floorY, s.standZ)).toBeNull();
  });
});

describe('the pointer on a seat', () => {
  it('picks the seat box a ray enters, the nearest first', () => {
    const s = byId('tavern_chair_3');
    // straight down onto the seat from above
    const hit = pickSeatOnRay(MIREFEN_TAVERN_SEATS, s.x, s.seatY + 5, s.z, 0, -1, 0);
    expect(hit?.seat).toBe(s);
    expect(hit?.y).toBeCloseTo(s.pick.y1, 9);
    // a ray over every seat misses
    expect(pickSeatOnRay(MIREFEN_TAVERN_SEATS, s.x, 40, s.z, 1, 0, 0)).toBeNull();
    // along a bench, the nearer place wins
    const a = byId('tavern_longbench_1_0');
    const b = byId('tavern_longbench_1_2');
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    const from = { x: a.x - (dx / l) * 3, z: a.z - (dz / l) * 3 };
    const along = pickSeatOnRay(
      MIREFEN_TAVERN_SEATS,
      from.x,
      a.seatY - 0.1,
      from.z,
      dx / l,
      0,
      dz / l,
    );
    expect(along?.seat).toBe(a);
  });

  it('falls to a free place on the same bench when the clicked one is held', () => {
    const [left, right] = MIREFEN_TAVERN_SEATS.filter((s) => s.group === 'tavern_hearth_1');
    const sitter = {
      id: 7,
      pos: { x: left.standX, y: left.floorY, z: left.standZ },
      dead: false,
      sitting: true,
    };
    const hit = { seat: left, x: left.x, z: left.z };
    expect(chooseSeatForClick(MIREFEN_TAVERN_SEATS, hit, [sitter], 1)).toBe(right);
    // the sitter clicking their own seat keeps it
    expect(chooseSeatForClick(MIREFEN_TAVERN_SEATS, hit, [sitter], 7)).toBe(left);
    const other = { ...sitter, id: 8, pos: { x: right.standX, y: right.floorY, z: right.standZ } };
    expect(chooseSeatForClick(MIREFEN_TAVERN_SEATS, hit, [sitter, other], 1)).toBeNull();
  });
});

describe('the pointer walk to a seat', () => {
  it('walks there, settles, then sits; a step away while settling drops it', () => {
    const s = byId('tavern_chair_0');
    let now = 0;
    let goal: object | null = null;
    const sat: string[] = [];
    const player = { id: 1, dead: false, pos: { x: s.standX + 3, y: s.floorY, z: s.standZ } };
    const seatHit = {
      hit: { seat: s, t: 1, x: s.x, y: s.seatY, z: s.z },
      eye: { x: s.x, y: s.seatY + 8, z: s.z },
    };
    const ui = createSeatInteraction({
      world: {
        player: player as unknown as Entity,
        playerId: 1,
        entities: new Map(),
        cfg: { seed: 1 },
        riftCollisionToken: 0,
        sitOnSeat: (id) => sat.push(id),
      },
      pick: () => seatHit,
      walkTo: (t) => {
        goal = { ...t };
        return goal;
      },
      clickMoveGoal: () => goal,
      showError: () => {},
      errorText: () => '',
      now: () => now,
    });
    expect(ui.click(10, 10)).toBe(true);
    expect(goal).not.toBeNull();
    ui.tick();
    expect(sat).toEqual([]); // still walking
    // arrived: click-to-move lets go at the stand spot
    player.pos.x = s.standX;
    goal = null;
    ui.tick();
    now += SEAT_SIT_SETTLE_MS - 1;
    ui.tick();
    expect(sat).toEqual([]); // settling: the last walk frames still play out on the server
    now += 2;
    ui.tick();
    expect(sat).toEqual([s.id]);
    // on the spot already: settles, but a step away drops it
    ui.click(10, 10);
    now += 100;
    player.pos.x += 0.5;
    ui.tick();
    now += SEAT_SIT_SETTLE_MS;
    ui.tick();
    expect(sat).toEqual([s.id]);
  });
});

describe('the seated clips', () => {
  it('plays each pose and idle on its own authored clip', () => {
    const c = SEAT_CLIPS;
    const info = (pose: 'upright' | 'relaxed' | 'high', idle: 'rest' | 'talk' | 'drink') => ({
      pose,
      idle,
      rising: false,
      skipDown: false,
      rate: 1,
    });
    expect(seatClip(c, info('upright', 'rest'), 'down')).toBe('Sit_Chair_Down');
    expect(seatClip(c, info('upright', 'rest'), 'idle')).toBe('Sit_Chair_Idle');
    expect(seatClip(c, info('upright', 'rest'), 'up')).toBe('Sit_Chair_StandUp');
    expect(seatClip(c, info('relaxed', 'rest'), 'idle')).toBe('Sit_Chair_Relaxed_Idle');
    expect(seatClip(c, info('relaxed', 'talk'), 'idle')).toBe('Sit_Chair_Talk');
    expect(seatClip(c, info('upright', 'drink'), 'idle')).toBe('Sit_Chair_Drink');
    expect(seatClip(c, info('high', 'rest'), 'down')).toBe('Sit_High_Down');
    expect(seatClip(c, info('high', 'rest'), 'idle')).toBe('Sit_High_Idle');
    expect(seatClip(c, info('high', 'rest'), 'up')).toBe('Sit_High_StandUp');
    expect(new Set(seatClipNames(c)).size).toBe(9);
  });
});

describe('the seated rig', () => {
  it('lifts the root onto the seat and hides the capes only while the body sits', () => {
    const s = byId('tavern_chair_1');
    const view = {};
    const rig = new THREE.Group();
    const cape = new THREE.Object3D();
    cape.name = 'Armor_knight_Back';
    const helm = new THREE.Object3D();
    helm.name = 'Armor_knight_Head';
    rig.add(cape, helm);
    const e = {
      kind: 'player',
      templateId: 'player',
      dead: false,
      sitting: true,
      eating: null,
      drinking: null,
      pos: { x: s.standX, y: s.floorY, z: s.standZ },
    } as unknown as Entity;
    const out = { x: s.standX, y: s.floorY, z: s.standZ, facing: 0 };
    const st = { sitting: false, moving: false, running: false, speed: 0 } as unknown as AnimState;
    applySeatedPose(view, e, out, 0); // first sight: straight into the seat
    applySeatAnim(st, view, e, false, rig);
    expect(st.sitting).toBe(true);
    expect(st.seat?.pose).toBe('relaxed');
    expect(rig.position.y).toBeCloseTo(seatRootY(s) - s.floorY, 9);
    expect(cape.visible).toBe(false);
    expect(helm.visible).toBe(true);
    // up and walking away: the capes come back once the body is out of the seat
    (e as { sitting: boolean }).sitting = false;
    e.pos.x += 3;
    for (let ms = 16; ms < 4000; ms += 16) {
      const o = { x: e.pos.x, y: s.floorY, z: e.pos.z, facing: 0 };
      applySeatedPose(view, e, o, ms);
      applySeatAnim(st, view, e, false, rig);
    }
    expect(st.sitting).toBe(false);
    expect(st.seat).toBeNull();
    expect(rig.position.y).toBe(0);
    expect(cape.visible).toBe(true);
  });
});

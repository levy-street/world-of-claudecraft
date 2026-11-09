// The Hammer Council's provisional bodies (src/render/smith_heart_fx/
// council_bodies_core.ts and council_bodies.ts): the Seam Singer's plan stands
// about 2 to 2.5 times a player, tall and slender, every piece is a real node
// of its kit, the arms reach every pose's target and every
// pose and fall is finite, the casts map to their motions; and CouncilBodies
// over a fake world finds the bodies, never claims an event, falls with a dead
// body, and disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { CouncilBodies } from '../src/render/smith_heart_fx/council_bodies';
import {
  COUNCIL_BODY_HEIGHTS,
  COUNCIL_BODY_PLANS,
  COUNCIL_FALL,
  COUNCIL_KIT_NODES,
  COUNCIL_THREAD_PAIRS,
  type CouncilBodyAction,
  type CouncilBodyKind,
  councilArm,
  councilBodyKindOf,
  councilCastAction,
  councilFallProgress,
  councilFallRest,
  councilGlowLevel,
  councilPlanTop,
  councilPlanWidth,
  councilWristTarget,
} from '../src/render/smith_heart_fx/council_bodies_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const PLAYER = 1.9;
const KINDS: CouncilBodyKind[] = ['singer'];
const ACTIONS: CouncilBodyAction[] = ['idle', 'swing', 'raise', 'sing', 'point', 'wrath'];
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

describe('council_bodies_core: the plans', () => {
  it('stand 2 to 2.5 times a player, matching the manifest and the template', () => {
    expect(COUNCIL_BODY_HEIGHTS.singer).toBeCloseTo(
      (VISUALS.smith_heart_seam_singer?.height ?? 0) *
        (SMITH_HEART_MOBS.heart_seam_singer?.scale ?? 0),
    );
    for (const kind of KINDS) {
      const plan = COUNCIL_BODY_PLANS[kind];
      expect(plan.height / PLAYER, kind).toBeGreaterThanOrEqual(2);
      expect(plan.height / PLAYER, kind).toBeLessThanOrEqual(2.75);
      // Its crown is its height (never a toy, never a giant).
      expect(Math.abs(councilPlanTop(plan) - plan.height), kind).toBeLessThan(0.25);
    }
  });

  it('the Singer reads slender', () => {
    const singer = COUNCIL_BODY_PLANS.singer;
    const singerWidth = councilPlanWidth(singer);
    expect(singerWidth / singer.height).toBeLessThan(0.6);
    // The Singer's crystals glow: its shoulders, back, crown and heart.
    const crystals = singer.pieces.filter((p) => p.light === 'crystal').map((p) => p.id);
    for (const id of ['shoulderL', 'shoulderR', 'back', 'crown', 'heart'])
      expect(crystals).toContain(id);
  });

  it('every piece is a real node of its kit, sided pieces in pairs', () => {
    for (const kind of KINDS) {
      const plan = COUNCIL_BODY_PLANS[kind];
      const ids = new Set<string>();
      for (const p of plan.pieces) {
        expect(COUNCIL_KIT_NODES[p.kit], `${kind} ${p.id}`).toContain(p.node);
        expect(ids.has(p.id), p.id).toBe(false);
        ids.add(p.id);
        expect(p.size.x * p.size.y * p.size.z).toBeGreaterThan(0);
      }
      for (const j of ['shoulder', 'upper', 'fore', 'hand'] as const) {
        const sided = plan.pieces.filter((p) => p.joint === j);
        expect(sided.map((p) => p.side).sort(), `${kind} ${j}`).toEqual([-1, 1]);
      }
    }
    for (const [a, b] of COUNCIL_THREAD_PAIRS) expect(a).not.toBe(b);
  });
});

describe('council_bodies_core: the poses', () => {
  it('every action keeps the wrists in reach and every point finite', () => {
    for (const kind of KINDS) {
      const plan = COUNCIL_BODY_PLANS[kind];
      for (const action of ACTIONS) {
        for (const k of [0, 0.25, 0.5, 0.78, 0.9, 1]) {
          for (const side of [1, -1] as const) {
            const target = councilWristTarget(plan, action, side, k, 1);
            expect(finite(target.wrist), `${kind} ${action}`).toBe(true);
            expect(Math.abs(target.lean)).toBeLessThan(0.6);
            const arm = councilArm(plan, side, target.wrist);
            const upper = Math.hypot(
              arm.elbow.x - arm.root.x,
              arm.elbow.y - arm.root.y,
              arm.elbow.z - arm.root.z,
            );
            expect(upper).toBeCloseTo(plan.arm.upper, 3);
            // The target lies within the arm's reach (or the arm stretches to it).
            const d = Math.hypot(
              target.wrist.x - arm.root.x,
              target.wrist.y - arm.root.y,
              target.wrist.z - arm.root.z,
            );
            expect(d, `${kind} ${action} ${k}`).toBeLessThanOrEqual(
              (plan.arm.upper + plan.arm.fore) * 1.02,
            );
            // A wrist never goes below the floor.
            expect(target.wrist.y + plan.hover).toBeGreaterThan(0);
          }
        }
        expect(Number.isFinite(councilGlowLevel(action, 0.5, 3))).toBe(true);
      }
    }
  });

  it('maps each council cast to its motion', () => {
    // The Singer took up the pillars and the rock: it raises and slams.
    expect(councilCastAction('singer', 'heart_wake_the_stone')).toBe('raise');
    expect(councilCastAction('singer', 'heart_falling_rock')).toBe('raise');
    expect(councilCastAction('singer', 'heart_song_of_the_seam')).toBe('sing');
    expect(councilCastAction('singer', 'heart_seam_bolt')).toBe('point');
    expect(councilCastAction('singer', 'heart_mountains_wrath')).toBe('wrath');
    expect(councilCastAction('singer', 'heart_mountains_rush')).toBeNull();
    expect(councilCastAction('singer', null)).toBeNull();
    expect(councilBodyKindOf('heart_slabwright')).toBeNull();
    expect(councilBodyKindOf('heart_seam_singer')).toBe('singer');
    expect(councilBodyKindOf('heart_hammer_guardian')).toBeNull();
  });

  it('the fall: each piece drops onto the floor near where it stood, within the timeline', () => {
    for (const kind of KINDS) {
      const plan = COUNCIL_BODY_PLANS[kind];
      plan.pieces.forEach((p, i) => {
        const from = { x: 0.5, y: 3, z: 0.2 };
        const rest = councilFallRest(plan, i, from);
        expect(finite(rest.at)).toBe(true);
        expect(rest.at.y).toBeGreaterThan(0);
        expect(rest.at.y).toBeLessThan(p.size.y);
        expect(Math.hypot(rest.at.x, rest.at.z)).toBeLessThan(3);
        expect(rest.delay + COUNCIL_FALL.drop).toBeLessThanOrEqual(COUNCIL_FALL.end + 1e-9);
        expect(councilFallProgress(rest.delay - 0.01, rest.delay).k).toBe(0);
        expect(councilFallProgress(COUNCIL_FALL.end, rest.delay)).toEqual({ k: 1, landed: true });
      });
    }
  });
});

describe('CouncilBodies', () => {
  // The Quarry's claim (the painter dresses bodies only inside the raid).
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function body(id: number, templateId: string, x: number): Entity {
    return {
      id,
      kind: 'mob',
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z },
      prevPos: { x: o.x + x, y: 0, z: o.z },
      facing: 0.4,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      inCombat: true,
      auras: [],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it('finds the bodies, plays their casts and deaths, dresses nobody outside, frees, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = { ...body(1, 'warrior', -10), kind: 'player' } as Entity;
    // Two Singers (two rigs of the one kind): one raises, one sings.
    const slab = body(2, 'heart_seam_singer', 0);
    const singer = body(3, 'heart_seam_singer', 6);
    for (const e of [me, slab, singer]) entities.set(e.id, e);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new CouncilBodies(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-council-bodies');
    expect(root).toBeDefined();
    fx.update(0.2);
    const shown = () =>
      root?.children.filter((c) => c.name.startsWith('smithHeartCouncilBody:') && c.visible)
        .length ?? 0;
    // The Singer wears its model (COUNCIL_MODELLED): no provisional piece ever shows. What the
    // module still plays is the dust, rings and shakes of its casts and death, so each step
    // below proves through the shake that a body was found (or was not).
    expect(shown()).toBe(0);
    /** Runs `ability` to the end of its bar on each caster; the shake it caused. */
    const castThrough = (casters: Entity[], ability: string, bar: number): number => {
      const before = shaken;
      for (const c of casters) {
        c.castingAbility = ability;
        c.castTotal = bar;
        c.castRemaining = bar;
      }
      for (let i = 0; i < Math.ceil(bar * 30) + 4; i++) {
        for (const c of casters) c.castRemaining = Math.max(0, c.castRemaining - 1 / 30);
        fx.update(1 / 30);
      }
      for (const c of casters) c.castingAbility = null;
      fx.update(1 / 30);
      return shaken - before;
    };
    const swing = {
      type: 'damage',
      sourceId: slab.id,
      targetId: me.id,
      amount: 10,
      crit: false,
      school: 'physical',
      ability: null,
    } as SimEvent;
    expect(fx.handleEvent(swing)).toBe(false);
    // A raise ending in the slam shakes the ground; the other Singer's song plays beside it.
    const slam = castThrough([slab], 'heart_wake_the_stone', 1.2);
    expect(slam).toBeGreaterThan(0);
    castThrough([singer], 'heart_song_of_the_seam', 3);
    // Outside the raid nobody new is dressed (no walk of the open world): a Singer raising
    // its stone beside the player out there shakes nothing.
    const away = { ...body(9, 'heart_seam_singer', 0) } as Entity;
    away.pos = { x: 10, y: 0, z: 0 };
    away.prevPos = { x: 10, y: 0, z: 0 };
    entities.set(away.id, away);
    me.pos = { x: 0, y: 0, z: 0 };
    expect(castThrough([away], 'heart_wake_the_stone', 1.2)).toBe(0);
    entities.delete(away.id);
    me.pos = { x: o.x - 10, y: 0, z: o.z };
    // A Singer dies: its model's own Death clip lays it down, and its threads snap here with a
    // flash and a shake.
    const alive = shaken;
    singer.dead = true;
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    expect(shaken).toBeGreaterThan(alive);
    expect(shown()).toBe(0);
    // A body leaving the world frees its rig: two new Singers both find one (two a kind), so
    // their slams shake twice as hard as the first.
    entities.delete(slab.id);
    entities.delete(singer.id);
    fx.update(0.2);
    const next = [body(20, 'heart_seam_singer', 0), body(21, 'heart_seam_singer', 0)];
    for (const e of next) entities.set(e.id, e);
    fx.update(0.2);
    expect(castThrough(next, 'heart_wake_the_stone', 1.2)).toBeCloseTo(2 * slam, 5);
    expect(shown()).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-council-bodies')).toBeUndefined();
  });
});

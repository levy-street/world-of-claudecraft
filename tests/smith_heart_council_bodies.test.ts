// The Hammer Council's provisional bodies (src/render/smith_heart_fx/
// council_bodies_core.ts and council_bodies.ts): both plans stand about 2 to
// 2.5 times a player, with distinct silhouettes (the Slabwright broad, its slab
// shoulders the widest thing on it; the Seam Singer tall and slender), every
// piece is a real node of its kit, the arms reach every pose's target and every
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
const KINDS: CouncilBodyKind[] = ['slabwright', 'singer'];
const ACTIONS: CouncilBodyAction[] = ['idle', 'swing', 'raise', 'sing', 'point', 'wrath'];
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

describe('council_bodies_core: the plans', () => {
  it('stand 2 to 2.5 times a player, matching the manifest and the template', () => {
    expect(COUNCIL_BODY_HEIGHTS.slabwright).toBeCloseTo(
      (VISUALS.smith_heart_slabwright?.height ?? 0) *
        (SMITH_HEART_MOBS.heart_slabwright?.scale ?? 0),
    );
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

  it('read apart: the Slabwright broad as it is tall, the Singer slender', () => {
    const slab = COUNCIL_BODY_PLANS.slabwright;
    const singer = COUNCIL_BODY_PLANS.singer;
    const slabWidth = councilPlanWidth(slab);
    const singerWidth = councilPlanWidth(singer);
    expect(slabWidth / slab.height).toBeGreaterThan(1);
    expect(singerWidth / singer.height).toBeLessThan(0.6);
    expect(singerWidth).toBeLessThan(slabWidth * 0.5);
    expect(singer.height).toBeGreaterThan(slab.height);
    // The slab shoulders are the widest thing on the Slabwright.
    const shoulders = slab.pieces.filter((p) => p.joint === 'shoulder');
    expect(shoulders.map((p) => p.node)).toEqual(['Kit_CutBlockB', 'Kit_CutBlockB']);
    const reach = Math.max(...shoulders.map((p) => slab.slots.shoulder.x + p.at.x + p.size.x / 2));
    expect(reach * 2).toBeCloseTo(slabWidth, 5);
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
    expect(councilCastAction('slabwright', 'heart_wake_the_stone')).toBe('raise');
    expect(councilCastAction('slabwright', 'heart_falling_rock')).toBe('raise');
    expect(councilCastAction('singer', 'heart_song_of_the_seam')).toBe('sing');
    expect(councilCastAction('singer', 'heart_song_of_the_seam_unbroken')).toBe('sing');
    expect(councilCastAction('slabwright', 'heart_song_of_the_seam_unbroken')).toBe('sing');
    expect(councilCastAction('singer', 'heart_seam_bolt')).toBe('point');
    expect(councilCastAction('singer', 'heart_mountains_wrath')).toBe('wrath');
    expect(councilCastAction('slabwright', 'heart_mountains_wrath')).toBe('wrath');
    expect(councilCastAction('singer', null)).toBeNull();
    expect(councilCastAction('singer', 'heart_wake_the_stone')).toBeNull();
    expect(councilBodyKindOf('heart_slabwright')).toBe('slabwright');
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

  it('finds both bodies, poses them through their casts, never claims, falls, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = { ...body(1, 'warrior', -10), kind: 'player' } as Entity;
    const slab = body(2, 'heart_slabwright', 0);
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
    expect(shown()).toBe(2);
    // Outside the raid nobody new is dressed (no walk of the open world).
    const away = body(9, 'heart_slabwright', 30);
    entities.set(away.id, away);
    me.pos = { x: 0, y: 0, z: 0 };
    fx.update(0.2);
    expect(shown()).toBe(2);
    entities.delete(away.id);
    me.pos = { x: o.x - 10, y: 0, z: o.z };
    // A swing, a raise ending in the slam, a song.
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
    slab.castingAbility = 'heart_wake_the_stone';
    slab.castTotal = 1.2;
    slab.castRemaining = 1.2;
    singer.castingAbility = 'heart_song_of_the_seam';
    singer.castTotal = 3;
    singer.castRemaining = 3;
    for (let i = 0; i < 40; i++) {
      slab.castRemaining = Math.max(0, slab.castRemaining - 1 / 30);
      singer.castRemaining = Math.max(0, singer.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    slab.castingAbility = null;
    fx.update(1 / 30);
    expect(shaken).toBeGreaterThan(0);
    // The Singer dies: it stays drawn (as rubble) while its corpse lies.
    singer.dead = true;
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    expect(shown()).toBe(2);
    // A body leaving the world frees its rig.
    entities.delete(slab.id);
    fx.update(0.2);
    expect(shown()).toBe(1);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-council-bodies')).toBeUndefined();
  });
});

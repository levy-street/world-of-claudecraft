// The Guardian of the Heat's provisional body (the pure plan
// src/render/smith_heart_fx/heat_body_core.ts and its painter heat_body.ts):
// it stands imposing (matching the manifest and the template), every piece is
// a real node of its kit, the bars and one-shots map to their motions (the
// overheat's Hearthburst over every bar, the wind-up's strain under every
// one-shot), the fire whitens with the heat and flashes from 90, every pose
// and the fall are finite; the painter draws it over the bodyless guardian,
// lets its wind-up glow show, never claims an event, and disposes.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { HeatBody } from '../src/render/smith_heart_fx';
import {
  HEAT_BODY_HEIGHT,
  HEAT_BODY_KITS,
  HEAT_BODY_PIECES,
  HEAT_BURST_SECONDS,
  HEAT_FALL,
  HEAT_RIG_JOINTS,
  HEAT_THREAD_PAIRS,
  type HeatBodyAction,
  type HeatBodyInput,
  HJ,
  heatArm,
  heatBodyAction,
  heatBodyLook,
  heatBodyTop,
  heatFallProgress,
  heatFallRest,
  heatWhiteness,
  heatWristTarget,
  overheatingOn,
  restJoint,
} from '../src/render/smith_heart_fx/heat_body_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_GUARDIAN,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const PLAYER = 1.9;
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

function glbNodeNames(url: string): string[] {
  const buf = readFileSync(`public${url}`);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((n) => n.name ?? '');
}

const IDLE: HeatBodyInput = {
  castId: null,
  castFill: 0,
  sinceShed: Number.POSITIVE_INFINITY,
  sinceToll: Number.POSITIVE_INFINITY,
  sinceBurst: Number.POSITIVE_INFINITY,
  sinceStoke: Number.POSITIVE_INFINITY,
  sinceSwing: Number.POSITIVE_INFINITY,
  overheating: false,
};

const ACTIONS: HeatBodyAction[] = [
  'idle',
  'swing',
  'shed',
  'rise',
  'pour',
  'knell',
  'toll',
  'strain',
  'burst',
  'stoke',
];

describe('heat_body_core: the provisional body', () => {
  it('stands imposing, matching the manifest and the template', () => {
    const look = SMITH_HEART_PLACEHOLDER_LOOKS[HEAT_GUARDIAN];
    expect(look).toBe('smith_heart_heat_guardian');
    const visual = VISUALS[look];
    expect(visual?.bodyless).toBe(true);
    expect(HEAT_BODY_HEIGHT).toBeCloseTo(
      (visual?.height ?? 0) * (SMITH_HEART_MOBS[HEAT_GUARDIAN]?.scale ?? 0),
    );
    expect(HEAT_BODY_HEIGHT / PLAYER).toBeGreaterThanOrEqual(2.5);
    expect(Math.abs(heatBodyTop() - HEAT_BODY_HEIGHT)).toBeLessThan(1);
  });

  it('is built of real kit nodes, nothing of a forge, each piece unique on a real joint', () => {
    const nodes = {
      heat: new Set(glbNodeNames(HEAT_BODY_KITS.heat)),
      heart: new Set(glbNodeNames(HEAT_BODY_KITS.heart)),
    };
    const ids = new Set<string>();
    expect(HEAT_BODY_PIECES.length).toBeGreaterThan(10);
    for (const p of HEAT_BODY_PIECES) {
      expect(nodes[p.kit].has(p.node), `${p.id}: ${p.kit} ${p.node}`).toBe(true);
      expect(/anvil|bellows|hammer|crucible|chain|forge/i.test(p.node), p.node).toBe(false);
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(p.joint).toBeLessThan(HEAT_RIG_JOINTS);
      if (p.to !== undefined) expect(p.to).toBeLessThan(HEAT_RIG_JOINTS);
      expect(p.size.x * p.size.y * p.size.z).toBeGreaterThan(0);
    }
    // Both kits: the colossus basalt and the Hearth's crystal and columns;
    // a white-gold heart of crystal in its chest.
    expect(HEAT_BODY_PIECES.some((p) => p.kit === 'heart')).toBe(true);
    expect(HEAT_BODY_PIECES.some((p) => p.kit === 'heat')).toBe(true);
    expect(HEAT_BODY_PIECES.find((p) => p.id === 'core')?.light).toBe('crystal');
    for (const [a, b] of HEAT_THREAD_PAIRS) {
      expect(a).toBeLessThan(HEAT_RIG_JOINTS);
      expect(b).toBeLessThan(HEAT_RIG_JOINTS);
    }
  });

  it('rests symmetric, feet on the floor and head over the chest', () => {
    for (let i = 0; i < HEAT_RIG_JOINTS; i++) expect(finite(restJoint(i)), `${i}`).toBe(true);
    expect(restJoint(HJ.shoulderL).x).toBeCloseTo(-restJoint(HJ.shoulderR).x);
    expect(restJoint(HJ.footL).y).toBeLessThan(0.5);
    expect(restJoint(HJ.head).y).toBeGreaterThan(restJoint(HJ.chest).y);
  });

  it('maps Hearthburst first, then the bars, then the one-shots, then the strain', () => {
    expect(heatBodyAction(IDLE).action).toBe('idle');
    expect(heatBodyAction({ ...IDLE, overheating: true }).action).toBe('strain');
    expect(
      heatBodyAction({ ...IDLE, castId: HEAT_CASTS.shed, castFill: 0.4, sinceSwing: 0 }),
    ).toEqual({ action: 'shed', k: 0.4 });
    expect(heatBodyAction({ ...IDLE, castId: HEAT_CASTS.pour, castFill: 2 })).toEqual({
      action: 'pour',
      k: 1,
    });
    expect(heatBodyAction({ ...IDLE, castId: HEAT_CASTS.knell, castFill: 0.5 }).action).toBe(
      'knell',
    );
    expect(
      heatBodyAction({ ...IDLE, castId: HEAT_CASTS.shed, castFill: 0.4, sinceBurst: 0.2 }).action,
    ).toBe('burst');
    expect(heatBodyAction({ ...IDLE, sinceShed: 0.1, sinceToll: 0.1 }).action).toBe('rise');
    expect(heatBodyAction({ ...IDLE, sinceToll: 0.1, sinceStoke: 0.1 }).action).toBe('toll');
    expect(heatBodyAction({ ...IDLE, sinceStoke: 0.1, sinceSwing: 0.1 }).action).toBe('stoke');
    expect(heatBodyAction({ ...IDLE, sinceSwing: 0.1, overheating: true }).action).toBe('swing');
    expect(heatBodyAction({ ...IDLE, sinceBurst: HEAT_BURST_SECONDS + 0.01 }).action).toBe('idle');
  });

  it('burns whiter with the heat and flashes through the wind-up', () => {
    expect(heatWhiteness(0)).toBe(0);
    expect(heatWhiteness(1)).toBe(1);
    expect(heatWhiteness(0.8)).toBeGreaterThan(heatWhiteness(0.5));
    const cool = heatBodyLook('idle', 0, 1, 0.1, false);
    const hot = heatBodyLook('idle', 0, 1, 0.9, false);
    expect(hot.glow).toBeGreaterThan(cool.glow);
    expect(hot.white).toBeGreaterThan(cool.white);
    expect(hot.haze).toBeGreaterThan(cool.haze);
    expect(cool.flash).toBe(0);
    let flashed = 0;
    for (let t = 0; t < 1; t += 0.05)
      flashed = Math.max(flashed, heatBodyLook('strain', 0, t, 0.92, true).flash);
    expect(flashed).toBeGreaterThan(0.8);
    expect(heatBodyLook('burst', 0.05, 0, 0, false).white).toBeGreaterThan(0.9);
  });

  it('keeps every pose finite, its arms within reach; the shed reaches the floor', () => {
    for (const a of ACTIONS)
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        const look = heatBodyLook(a, k, 3.7, k, k > 0.5);
        for (const v of Object.values(look)) expect(Number.isFinite(v), `${a} ${k}`).toBe(true);
        for (const side of [1, -1] as const) {
          const w = heatWristTarget(a, side, k);
          expect(finite(w), `${a} ${k} ${side}`).toBe(true);
          const arm = heatArm(side, w);
          expect(finite(arm.elbow) && finite(arm.wrist), `${a} ${k}`).toBe(true);
        }
      }
    expect(heatArm(1, heatWristTarget('shed', 1, 1)).wrist.y).toBeLessThan(2.5);
    expect(heatWristTarget('rise', 1, 0.45).y).toBeGreaterThan(restJoint(HJ.head).y);
    // The pour is the right arm's, out over the lane.
    expect(heatWristTarget('pour', -1, 1).z).toBeGreaterThan(2.5);
  });

  it('falls to the floor and reads the overheating marker', () => {
    for (let i = 0; i < HEAT_BODY_PIECES.length; i++) {
      const rest = heatFallRest(i, restJoint(HEAT_BODY_PIECES[i].joint));
      expect(finite(rest.at) && finite(rest.tilt)).toBe(true);
      expect(rest.delay + 0.75).toBeLessThanOrEqual(HEAT_FALL.end);
      expect(heatFallProgress(HEAT_FALL.end, rest.delay).landed).toBe(true);
    }
    expect(overheatingOn([{ id: 'x' }, { id: HEAT_AURAS.overheating }])).toBe(true);
    expect(overheatingOn([{ id: HEAT_AURAS.stoked }])).toBe(false);
  });
});

describe('HeatBody over a fake world', () => {
  it('draws the body over the guardian, flashes through the wind-up, claims nothing, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: 0,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as { id: string }[],
        castingAbility: null as string | null,
        castTargetId: null,
        castRemaining: 0,
        castTotal: 0,
        resource: 0,
        maxResource: 100,
        inCombat: true,
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -200, 0);
    const boss = entity(2, 'mob', HEAT_GUARDIAN, -210, 0);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const body = new HeatBody(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    for (let i = 0; i < 6; i++) body.update(1 / 20);
    const group = scene.getObjectByName('smithHeartHeatBody');
    expect(group?.visible).toBe(true);
    const aura = scene.getObjectByName('smithHeartHeatAura') as THREE.Sprite;
    expect((aura.material as THREE.SpriteMaterial).opacity).toBeLessThan(0.2);
    boss.resource = 95;
    boss.auras.push({ id: HEAT_AURAS.overheating } as Entity['auras'][number]);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      body.update(1 / 20);
      peak = Math.max(peak, (aura.material as THREE.SpriteMaterial).opacity);
    }
    expect(peak).toBeGreaterThan(0.4);
    const ev = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'nova',
      ability: HEAT_CUES.overheat,
    } as SimEvent;
    expect(body.handleEvent(ev)).toBe(false);
    body.update(1 / 20);
    expect(shaken).toBeGreaterThan(0);
    (boss as { dead: boolean }).dead = true;
    for (let i = 0; i < 80; i++) body.update(1 / 20);
    body.dispose();
    expect(scene.getObjectByName('smith-heart-heat-body')).toBeUndefined();
  });
});

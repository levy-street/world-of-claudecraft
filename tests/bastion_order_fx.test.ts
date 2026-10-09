// The Drowned Sergeant's Loose on My Mark, drawn (src/render/sunken_bastion/
// bastion_order_fx_core.ts plus its painter bastion_order_fx.ts): the
// crosshair's timing, the aiming lines' selection by the shout's reach (pack
// ids never reach the client), the blocked bolt's stop point against an
// injected sight probe, and a smoke run of the painter over a fake world.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BastionOrderFx } from '../src/render/sunken_bastion/bastion_order_fx';
import {
  aimLineLook,
  MARK_SHOOTER,
  markedBoltEnd,
  markedTrailLength,
  ORDER_FX_SLOTS,
  orderAimers,
  orderFill,
  orderReach,
  RETICLE_LOCKED,
  RETICLE_OPEN,
  reticleLook,
  reticleRate,
  SERGEANT,
  WALL_STANDOFF,
} from '../src/render/sunken_bastion/bastion_order_fx_core';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  BASTION_LOOSE_ON_MY_MARK,
  BASTION_MARKED_BOLT,
  BASTION_MARKED_BOLT_BLOCKED,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the shout reads its numbers off the sergeant', () => {
  it('the shooters and the reach are the template order record', () => {
    const order = MOBS[SERGEANT]?.trashKit?.bastion?.order;
    expect(order).toBeDefined();
    expect(MARK_SHOOTER).toBe(order?.shooters);
    expect(orderReach()).toBe(order?.shooterRange);
  });

  it('the fill runs 0 to 1 over the bar and clamps', () => {
    expect(orderFill(2, 2)).toBe(0);
    expect(orderFill(1, 2)).toBe(0.5);
    expect(orderFill(0, 2)).toBe(1);
    expect(orderFill(3, 2)).toBe(0);
    expect(orderFill(0, 0)).toBe(1);
  });
});

describe('the crosshair', () => {
  it('pulses faster as the bar runs out', () => {
    expect(reticleRate(0)).toBeLessThan(reticleRate(0.5));
    expect(reticleRate(0.5)).toBeLessThan(reticleRate(1));
    expect(reticleRate(1)).toBeGreaterThanOrEqual(4 * reticleRate(0));
  });

  it('closes from open to locked and never fades below readable', () => {
    // At the beat's trough (phase 0.75) the size is the bare open or locked size.
    expect(reticleLook(0.75, 0).size).toBeCloseTo(RETICLE_OPEN, 5);
    expect(reticleLook(0.75, 1).size).toBeCloseTo(RETICLE_LOCKED, 5);
    expect(reticleLook(0.75, 0).close).toBe(0);
    expect(reticleLook(0.75, 1).close).toBe(1);
    for (const fill of [0, 0.3, 0.7, 1]) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        const look = reticleLook(phase, fill);
        expect(look.alpha).toBeGreaterThanOrEqual(0.6);
        expect(look.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the aiming lines brighten, widen and race as the bar fills', () => {
    const open = aimLineLook(0);
    const lock = aimLineLook(1);
    expect(lock.alpha).toBeGreaterThan(open.alpha);
    expect(lock.width).toBeGreaterThan(open.width);
    expect(lock.flow).toBeGreaterThan(open.flow);
    expect(open.alpha).toBeGreaterThan(0.3);
  });
});

describe('the aiming lines: every arbalest within the shout reach of the sergeant and the mark', () => {
  const body = (id: number, templateId: string, x: number, z: number, dead = false) => ({
    id,
    templateId,
    kind: 'mob',
    dead,
    pos: { x, z },
  });
  const sergeant = { pos: { x: 0, z: 0 } };
  const mark = { pos: { x: 0, z: -8 } };

  it('picks the living arbalests in reach, in id order, and nothing else', () => {
    const r = orderReach();
    const bodies = [
      body(9, MARK_SHOOTER, 5, 10),
      body(4, MARK_SHOOTER, -10, 14),
      body(5, MARK_SHOOTER, 0, r + 1), // beyond the sergeant's reach
      body(6, MARK_SHOOTER, 3, 4, true), // dead
      body(7, 'drowned_watchman', 1, 1), // not a shooter
      { ...body(8, MARK_SHOOTER, 2, 2), kind: 'object' },
      body(10, MARK_SHOOTER, 0, r - 0.5), // in the sergeant's reach, past the mark's
    ];
    const markFar = { pos: { x: 0, z: -12 } };
    const ids = orderAimers(sergeant, markFar, bodies, r);
    // 10 is within r of the sergeant but r + 11.5 from the mark.
    expect(ids).toEqual([4, 9]);
    expect(orderAimers(sergeant, mark, [], r)).toEqual([]);
  });

  it('caps at the line pool', () => {
    const many = Array.from({ length: 20 }, (_, i) => body(i + 1, MARK_SHOOTER, i * 0.5, 2));
    const ids = orderAimers(sergeant, mark, many);
    expect(ids).toHaveLength(ORDER_FX_SLOTS.lines);
    expect(ids[0]).toBe(1);
  });
});

describe('the marked bolt', () => {
  const from = { x: 0, y: 3, z: 0 };
  const to = { x: 0, y: 1.25, z: 20 };

  it('a clear shot ends in the mark', () => {
    const end = markedBoltEnd(from, to, false, () => false);
    expect(end).toEqual({ x: 0, y: 1.25, z: 20, t: 1 });
  });

  it('a blocked shot stops at the first blocked spot, stood off the wall', () => {
    // A wall 12 yd out along the line: clear only short of it.
    const wall = 12;
    const end = markedBoltEnd(from, to, true, (d) => d < wall);
    const stop = end.t * 20;
    expect(stop).toBeLessThan(wall);
    expect(stop).toBeGreaterThan(wall - WALL_STANDOFF - 20 / 2 ** 7 - 1e-6);
    expect(end.z).toBeCloseTo(stop, 6);
    // The height runs along the shot's own slope.
    expect(end.y).toBeCloseTo(3 + (1.25 - 3) * end.t, 6);
  });

  it('a blocked shot the probe finds clear still never reaches the mark', () => {
    const end = markedBoltEnd(from, to, true, () => true);
    expect(end.t).toBeLessThan(0.9);
    expect(end.z).toBeLessThan(20);
  });

  it('the tracer grows with the flight up to its cap', () => {
    expect(markedTrailLength(0)).toBe(0);
    expect(markedTrailLength(2)).toBe(2);
    expect(markedTrailLength(100)).toBeLessThanOrEqual(6);
  });
});

describe('the painter: a smoke run over a fake world inside a Bastion claim', () => {
  function entity(id: number, kind: string, templateId: string, x: number, z: number): Entity {
    return {
      id,
      kind,
      templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it('hangs the crosshair and the lines, flies the volley, then clears', () => {
    const o = instanceOrigin(DUNGEONS.sunken_bastion.index, 0);
    const entities = new Map<number, Entity>();
    const mark = entity(1, 'player', 'mage', o.x, o.z - 200);
    const sergeant = entity(2, 'mob', SERGEANT, o.x, o.z - 194);
    const arbs = [
      entity(3, 'mob', MARK_SHOOTER, o.x - 10, o.z - 186),
      entity(4, 'mob', MARK_SHOOTER, o.x + 10, o.z - 186),
      entity(5, 'mob', MARK_SHOOTER, o.x, o.z + 100),
    ];
    for (const e of [mark, sergeant, ...arbs]) entities.set(e.id, e);
    sergeant.castingAbility = BASTION_LOOSE_ON_MY_MARK;
    sergeant.castTargetId = mark.id;
    sergeant.castTotal = 2;
    sergeant.castRemaining = 2;
    const world = {
      entities,
      player: mark,
      playerId: mark.id,
      cfg: { seed: 20260101, playerClass: 'mage' },
    } as unknown as IWorld;
    const root = new THREE.Group();
    const emitted = { glow: 0, mist: 0 };
    const fx = new BastionOrderFx(
      root,
      world,
      { emit: () => emitted.glow++ },
      { emit: () => emitted.mist++ },
      1,
    );
    let now = 0;
    const step = (dt: number) => {
      now += dt;
      fx.update(now, dt);
    };
    step(0.2);
    // One crosshair over the mark, a line from each arbalest in reach (not 5).
    expect(fx.liveCounts()).toEqual({ reticles: 1, lines: 2, bolts: 0 });
    const reticle = root.getObjectByName('bastion-mark-reticle');
    expect(reticle?.visible).toBe(true);
    expect(reticle?.position.y).toBeGreaterThan(mark.pos.y + 2);
    // The bar runs down; the shout lands: the volley flies (one blocked).
    sergeant.castRemaining = 0.5;
    step(0.1);
    sergeant.castingAbility = null;
    const bolt = (sourceId: number, ability: string): SimEvent =>
      ({
        type: 'spellfx',
        sourceId,
        targetId: mark.id,
        school: 'physical',
        fx: 'heavyBolt',
        ability,
      }) as SimEvent;
    expect(fx.handleEvent(bolt(3, BASTION_MARKED_BOLT), now)).toBe(true);
    expect(fx.handleEvent(bolt(4, BASTION_MARKED_BOLT_BLOCKED), now)).toBe(true);
    // Not its event: left to the arbalest's own bolts.
    expect(fx.handleEvent(bolt(3, 'bastion_piercing_bolt'), now)).toBe(false);
    expect(fx.liveCounts().bolts).toBe(2);
    expect(emitted.glow).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) step(1 / 30);
    // Everything has landed, flared out and freed its slot.
    expect(fx.liveCounts()).toEqual({ reticles: 0, lines: 0, bolts: 0 });
    expect(emitted.mist).toBeGreaterThan(0);
    fx.dispose();
  });
});

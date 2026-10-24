// The Wildheart Basin's way out (playtest 03/10): the exit portal Zulgar's
// death opens stands IN the stone jaguar's maw behind the shrine, not off to
// the side of the terrace. The portal spawns inside the maw's footprint, on a
// walkway that climbs gently from the terrace over the lower incisors onto
// the jaw (no step a player cannot take, no collider across it), and a real
// player WALKS from the terrace round the altar, up into the jaws and out
// through the portal on the live sim's movement and door trigger.

import { describe, expect, it } from 'vitest';
import {
  isBasinMawPortal,
  MAW_GLOW_RISE,
  mawGlowStrength,
  planMawGlow,
  stepMawGlow,
} from '../src/render/wildheart_basin/maw_glow_core';
import { isBlocked } from '../src/sim/colliders';
import {
  JAGUAR_MAW,
  SHRINE_TERRACE,
  WILDHEART_BASIN_FIELD,
  WILDHEART_HEIGHTS,
  ZULGAR_SPOT,
} from '../src/sim/content/wildheart_basin_layout';
import { BUILTIN_WORLD, DUNGEON_X_THRESHOLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type WorldContent } from '../src/sim/types';

const FIELD = WILDHEART_BASIN_FIELD;
const floor = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

describe('the Wildheart exit portal in the jaguar maw', () => {
  it('opens inside the maw footprint, on the jaw behind the front teeth', () => {
    const portal = DUNGEONS.wildheart_basin.bossExitPortal;
    if (!portal) throw new Error('no boss exit portal');
    expect(portal).toEqual(JAGUAR_MAW.portal);
    expect(Math.abs(portal.x - JAGUAR_MAW.x)).toBeLessThan(JAGUAR_MAW.halfWidth);
    expect(portal.z).toBeGreaterThan(JAGUAR_MAW.minZ);
    expect(portal.z).toBeLessThan(JAGUAR_MAW.maxZ);
    // Past the terrace's north edge: in the jaws, not on the shrine floor.
    const terraceNorth = Math.max(...SHRINE_TERRACE.points.map((p) => p[1]));
    expect(portal.z).toBeGreaterThan(terraceNorth + 4);
    // Standing on the lower jaw, under the roof of the mouth with room above.
    const y = floor(portal.x, portal.z);
    expect(y).toBeGreaterThan(FIELD.voidHeight + 1);
    expect(Math.abs(y - JAGUAR_MAW.jawY)).toBeLessThan(1.5);
    expect(JAGUAR_MAW.roofY - y).toBeGreaterThan(8);
    // Inside the slot half the claim counts (instanceSlotForZ rounds at 250).
    expect(JAGUAR_MAW.floor[JAGUAR_MAW.floor.length - 1][0]).toBeLessThan(249);
    expect(FIELD.bounds.maxZ).toBeGreaterThanOrEqual(JAGUAR_MAW.floor.at(-1)?.[0] ?? 0);
  });

  it('climbs from the terrace without a step or a wall in the way', () => {
    const o = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    let prev = floor(JAGUAR_MAW.x, 234.5);
    expect(prev).toBe(WILDHEART_HEIGHTS.shrineTerrace);
    for (let z = 234.5; z <= JAGUAR_MAW.portal.z + 0.5; z += 0.25) {
      for (const dx of [-2.5, 0, 2.5]) {
        const x = JAGUAR_MAW.x + dx;
        const y = floor(x, z);
        expect(y, `walkway at ${x},${z}`).toBeGreaterThan(FIELD.voidHeight + 1);
        expect(isBlocked(1, o.x + x, o.z + z, 0.5), `blocked at ${x},${z}`).toBe(false);
      }
      const y = floor(JAGUAR_MAW.x, z);
      // A walkable ramp: no rise steeper than about 25 degrees, never a cliff step.
      expect(Math.abs(y - prev), `step at z ${z}`).toBeLessThan(0.25 * 0.5);
      expect(Math.abs(y - prev)).toBeLessThan(FIELD.cliffStep);
      prev = y;
    }
    // Sealed at the sides and the back: the jaws are not a way into the void.
    for (const x of [
      JAGUAR_MAW.x - JAGUAR_MAW.walkHalfWidth,
      JAGUAR_MAW.x + JAGUAR_MAW.walkHalfWidth,
    ])
      expect(isBlocked(1, o.x + x, o.z + 243, 0.5), `side at ${x}`).toBe(true);
    expect(isBlocked(1, o.x + JAGUAR_MAW.x, o.z + (JAGUAR_MAW.floor.at(-1)?.[0] ?? 0), 0.5)).toBe(
      true,
    );
  });

  it('a player walks from Zulgar round the altar into the jaws and out', () => {
    const sim = new Sim({ seed: 41, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const pid = sim.addPlayer('warrior', 'Mawwalker');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', pid)).toBe(true);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, p.pos);
    if (!inst) throw new Error('no claim');
    const zulgar = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'wildheart_high_priest');
    if (!zulgar) throw new Error('no Zulgar');
    // Everything else in the basin falls first (no chain pull on the walk).
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id);
      if (e && !e.dead && e !== zulgar) sim.ctx.handleDeath(e, p);
    }
    sim.ctx.handleDeath(zulgar, p);
    expect(inst.bossExitId).not.toBeNull();
    const o = instanceOrigin(DUNGEONS.wildheart_basin.index, inst.slot);
    const exit = sim.entities.get(inst.bossExitId as number) as Entity;
    expect(exit.pos.x - o.x).toBeCloseTo(JAGUAR_MAW.portal.x, 5);
    expect(exit.pos.z - o.z).toBeCloseTo(JAGUAR_MAW.portal.z, 5);
    // Start where Zulgar stood, then walk: beside the altar, behind it onto
    // the walkway's lip, and straight up into the jaws.
    p.pos = sim.ctx.groundPos(o.x + ZULGAR_SPOT.x, o.z + ZULGAR_SPOT.z);
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    const route: [number, number][] = [
      [6.5, 228],
      [6.5, 234.9],
      [JAGUAR_MAW.x, 235.2],
      [JAGUAR_MAW.portal.x, JAGUAR_MAW.portal.z],
    ];
    let leg = 0;
    let highest = -Infinity;
    let deepest = -Infinity;
    let left = false;
    for (let t = 0; t < 30 / DT && !left; t++) {
      const [lx, lz] = route[Math.min(leg, route.length - 1)];
      const dx = o.x + lx - p.pos.x;
      const dz = o.z + lz - p.pos.z;
      if (Math.hypot(dx, dz) < 0.6 && leg < route.length - 1) leg++;
      p.facing = Math.atan2(dx, dz);
      meta.moveInput.forward = true;
      sim.tick();
      if (p.pos.x < DUNGEON_X_THRESHOLD) left = true;
      else {
        highest = Math.max(highest, p.pos.y);
        deepest = Math.max(deepest, p.pos.z - o.z);
      }
    }
    expect(leg, 'reached the last leg of the walk').toBe(route.length - 1);
    // The feet climbed over the incisor row and walked into the jaws before
    // the portal took them.
    expect(highest).toBeGreaterThan(WILDHEART_HEIGHTS.shrineTerrace + 0.5);
    expect(deepest).toBeGreaterThan(JAGUAR_MAW.portal.z - 2.5);
    expect(deepest).toBeGreaterThan(Math.max(...SHRINE_TERRACE.points.map((q) => q[1])) + 3);
    expect(left, 'the portal in the maw sent the walker out').toBe(true);
  });
});

describe('the glow in the jaguar maw (maw_glow_core)', () => {
  const def = DUNGEONS.wildheart_basin;
  const o = instanceOrigin(def.index, 3);
  const exitAt = (lx: number, lz: number) => ({
    kind: 'object',
    templateId: 'dungeon_exit',
    dungeonId: 'wildheart_basin',
    pos: { x: o.x + lx, z: o.z + lz },
  });

  it('knows the maw portal from the entrance exit and from other objects', () => {
    expect(isBasinMawPortal(exitAt(JAGUAR_MAW.portal.x, JAGUAR_MAW.portal.z))).toBe(true);
    expect(isBasinMawPortal(exitAt(def.exitOffset.x, def.exitOffset.z))).toBe(false);
    expect(
      isBasinMawPortal({ ...exitAt(JAGUAR_MAW.portal.x, JAGUAR_MAW.portal.z), dungeonId: 'x' }),
    ).toBe(false);
    expect(
      isBasinMawPortal({
        ...exitAt(JAGUAR_MAW.portal.x, JAGUAR_MAW.portal.z),
        templateId: 'dungeon_door',
      }),
    ).toBe(false);
  });

  it('wells up over its rise once open, sinks when shut, dark at rest', () => {
    let level = 0;
    for (let t = 0; t < MAW_GLOW_RISE - 0.5; t += 0.05) level = stepMawGlow(level, true, 0.05);
    expect(level).toBeGreaterThan(0.5);
    expect(level).toBeLessThan(1);
    for (let t = 0; t < 1; t += 0.05) level = stepMawGlow(level, true, 0.05);
    expect(level).toBe(1);
    expect(mawGlowStrength(1, 3)).toBeGreaterThan(0.6);
    expect(mawGlowStrength(0, 3)).toBe(0);
    for (let t = 0; t < MAW_GLOW_RISE + 0.1; t += 0.05) level = stepMawGlow(level, false, 0.05);
    expect(level).toBe(0);
  });

  it('lights the mouth: every card stands in the maw or on its lip', () => {
    const cards = planMawGlow();
    expect(cards.some((c) => c.kind === 'halo' && c.tone === 'jade')).toBe(true);
    expect(cards.some((c) => c.kind === 'pool')).toBe(true);
    for (const c of cards) {
      expect(Math.abs(c.x - JAGUAR_MAW.x)).toBeLessThan(JAGUAR_MAW.halfWidth);
      expect(c.z).toBeGreaterThanOrEqual(JAGUAR_MAW.floor[1][0]);
      expect(c.z).toBeLessThan(JAGUAR_MAW.maxZ);
      expect(c.y).toBeLessThan(JAGUAR_MAW.roofY);
      expect(c.y).toBeGreaterThan(JAGUAR_MAW.jawY - 2);
    }
  });
});

// The Heat guardian's Basalt Fist and its Molten Swells (presentation only:
// smith_heart_fx/heat_fx_core.ts, heat_fx.ts):
//   - the sim's numbers read, never tuned: the fist falls through its bar's
//     last part and lands at the bar's end, the crater flashes and cools; a
//     swell's wall stands where the sim's wave strikes (the wave's speed), it
//     rises out of the spot and dies at its lane's end, its wake crusts;
//   - HeatFx over a fake world draws the spot and the three lanes (the shared
//     floor telegraph, every tier), the falling fist, the walls once the
//     lanes roll (never past the Hearth's floor), the crater and a shake on
//     the fist's cue, never claims an event, disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFx } from '../src/render/smith_heart_fx';
import {
  BASALT_FIST,
  CRATER_SECONDS,
  craterLook,
  FIST_DROP_FROM,
  FIST_DROP_HEIGHT,
  fistLook,
  HEAT_FX_COLORS,
  SWELL_HEIGHT,
  swellFront,
  swellHeight,
  wakeHeat,
} from '../src/render/smith_heart_fx/heat_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { floorReach } from '../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_OBJECTS,
  heatTimed,
  swellLaneTemplate,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Heat guardian's fist and swells: the plan", () => {
  it('reads the fist off the sim: its bar, its fall, its landing', () => {
    expect(BASALT_FIST).toBe(HEAT_CASTS.fist);
    expect(fistLook(0, T.fistCast).shown).toBe(false);
    expect(fistLook(0, T.fistCast).height).toBeCloseTo(FIST_DROP_HEIGHT + 1.2, 6);
    // Still hanging high until the drop begins, then plunging.
    const drop = fistLook(T.fistCast * FIST_DROP_FROM, T.fistCast);
    expect(drop.height).toBeCloseTo(FIST_DROP_HEIGHT + 1.2, 6);
    expect(drop.shown).toBe(true);
    let last = Number.POSITIVE_INFINITY;
    for (let k = FIST_DROP_FROM; k <= 1; k += 0.02) {
      const l = fistLook(T.fistCast * k, T.fistCast);
      expect(l.height).toBeLessThanOrEqual(last + 1e-9);
      expect(l.fill).toBeCloseTo(k, 6);
      last = l.height;
    }
    expect(fistLook(T.fistCast, T.fistCast).height).toBeCloseTo(1.2, 6);
    expect(fistLook(T.fistCast * 2, T.fistCast).fill).toBe(1);
    expect(craterLook(0).flash).toBe(1);
    expect(craterLook(0).glow).toBe(1);
    expect(craterLook(CRATER_SECONDS).glow).toBe(0);
    expect(craterLook(1).flash).toBe(0);
  });

  it('stands the wall where the sim strikes, rising out of the spot, dying at the end', () => {
    expect(swellFront(1)).toBeCloseTo(T.waveSpeed, 9);
    expect(swellFront(-1)).toBe(0);
    expect(swellHeight(0)).toBe(0);
    expect(swellHeight(T.laneLength / 2)).toBeCloseTo(SWELL_HEIGHT, 6);
    expect(swellHeight(T.laneLength + T.waveDepth)).toBe(0);
    // A lane clipped at the floor's edge sinks its wall there.
    expect(swellHeight(12, 12 - T.waveDepth)).toBe(0);
    for (let f = 0; f < T.laneLength + 6; f += 0.5)
      expect(swellHeight(f)).toBeLessThanOrEqual(SWELL_HEIGHT + 1e-9);
    expect(wakeHeat(0)).toBe(1);
    expect(wakeHeat(-1)).toBe(0);
    expect(wakeHeat(T.waveSpeed * 2.5)).toBe(0);
    // White-gold, never a threat colour or a volcano's red.
    const [r, g, b] = HEAT_FX_COLORS.fire;
    expect(g / r).toBeGreaterThan(0.6);
    expect(b).toBeLessThan(g);
  });
});

describe('HeatFx over a fake world', () => {
  const O = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  /** The fist's spot on the shore (instance-local). */
  const SPOT = { x: -206, z: 0 };
  let nextId = 1;
  function entity(kind: Entity['kind'], templateId: string, lx: number, lz: number) {
    const x = O.x + lx;
    const z = O.z + lz;
    return {
      id: nextId++,
      kind,
      templateId,
      name: templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  /** The telegraph groups shown (a pooled fan or lane holds a mesh). */
  function telegraphsShown(root: THREE.Object3D | undefined): number {
    let n = 0;
    root?.traverse((o) => {
      if (
        o instanceof THREE.Group &&
        o !== root &&
        o.visible &&
        o.name !== 'smithHeartHeatFist' &&
        o.name !== 'smithHeartKitWarmers' &&
        o.children.some((c) => c instanceof THREE.Mesh)
      )
        n++;
    });
    return n;
  }
  const shown = (root: THREE.Object3D | undefined, name: string) => {
    const out: THREE.Object3D[] = [];
    root?.traverse((o) => {
      if (o.name === name && o.visible) out.push(o);
    });
    return out;
  };

  it('draws the spot and its lanes, drops the fist, rolls the walls, cracks the crater', () => {
    const entities = new Map<number, Entity>();
    const me = entity('player', 'warrior', SPOT.x, 4);
    const boss = entity('mob', 'heart_heat_guardian', -224, 0);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new HeatFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-heat-fx');
    expect(root).toBeDefined();
    fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    // The fist's spot on the shore and its three lanes.
    const spot = entity('object', heatTimed(HEAT_OBJECTS.fistPrefix, T.fistCast), SPOT.x, SPOT.z);
    spot.scale = T.fistR;
    entities.set(spot.id, spot);
    const facings = [Math.PI / 2, 0, Math.PI];
    const lanes = facings.map((facing) => {
      const l = entity(
        'object',
        swellLaneTemplate('warn', T.fistCast + T.waveDelay),
        SPOT.x,
        SPOT.z,
      );
      l.facing = facing;
      l.scale = T.laneHalf;
      entities.set(l.id, l);
      return l;
    });
    world.entityRosterVersion++;
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(4);
    expect(shown(root, 'smithHeartHeatFist')).toHaveLength(0);
    for (let i = 0; i < 70; i++) fx.update(1 / 30);
    expect(shown(root, 'smithHeartHeatFist')).toHaveLength(1);
    // The fist lands: the crater, a shake; the cue is the host's to claim.
    const land = {
      type: 'spellfxAt',
      x: spot.pos.x,
      z: spot.pos.z,
      radius: T.fistR,
      school: 'fire',
      fx: 'burst',
      ability: HEAT_CUES.fist,
    } as unknown as SimEvent;
    expect(fx.handleEvent(land)).toBeUndefined();
    entities.delete(spot.id);
    for (const l of lanes) l.templateId = swellLaneTemplate('roll', 4);
    world.entityRosterVersion++;
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    expect(shaken).toBeGreaterThan(0);
    expect(shown(root, 'smithHeartHeatCrater')).toHaveLength(1);
    expect(shown(root, 'smithHeartHeatFist')).toHaveLength(0);
    expect(telegraphsShown(root)).toBe(3);
    // Every wall stands on its lane, never past the Hearth's floor.
    for (let i = 0; i < 30 * 3; i++) {
      fx.update(1 / 30);
      for (const w of shown(root, 'smithHeartHeatSwellWall')) {
        const lx = w.position.x - O.x - SPOT.x;
        const lz = w.position.z - O.z - SPOT.z;
        const d = Math.hypot(lx, lz);
        const facing = w.rotation.y;
        const reach = floorReach(SPOT.x, SPOT.z, facing, T.laneLength);
        expect(d).toBeLessThanOrEqual(reach + 1e-6);
      }
    }
    // The swells pass, the lanes go: nothing is left but a cooling crater.
    for (const l of lanes) entities.delete(l.id);
    world.entityRosterVersion++;
    for (let i = 0; i < 30 * 8; i++) fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    expect(shown(root, 'smithHeartHeatSwellWall')).toHaveLength(0);
    expect(shown(root, 'smithHeartHeatCrater')).toHaveLength(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-heat-fx')).toBeUndefined();
  });
});

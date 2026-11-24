// The Guardian of the Heat on screen after Jose's Heroic playtest of
// 2026-11-24:
//  - the lip wall drawn where the sim's colliders stand (two rows of basalt
//    stumps filling HEAT_LIP_WALL's band, under the eye line), the melee's
//    terrace grown past their whole reach;
//  - every floor mark clipped at the wall's outer face (the spread circles,
//    the seeds' field, the Wheel, Wakefire, the patches, the craters, the lava
//    waves' foot and fire), never a yard a player can stand on;
//  - every floor shader's noise on the precise frame round the well, never
//    raw world yards a hundred thousand out (the floor's flicker);
//  - no invisible damage: each ground effect reads as danger for as long as
//    the sim can strike in it (the Wheel's and Wakefire's last ticks, the
//    patches', a lava wave reaching the wall's foot, a swell's last stretch).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFightFx } from '../src/render/smith_heart_fx/heat_fight_fx';
import { HeatFx } from '../src/render/smith_heart_fx/heat_fx';
import { swellDrawnFront } from '../src/render/smith_heart_fx/heat_fx_core';
import { wallLook } from '../src/render/smith_heart_fx/heat_lava_wall_core';
import {
  HEAT_LIP_CLIP_R,
  heatLipClipped,
  heatLipClipUniform,
} from '../src/render/smith_heart_fx/heat_lip_clip_core';
import { HEAT_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/heat_telegraph_glsl';
import { wellLipStumps } from '../src/render/smith_heart_fx/heat_well_core';
import { HEAT_SHORE } from '../src/render/smith_heart_fx/heat_well_shore';
import {
  WHEEL_FX,
  type WheelLook,
  wheelEruptLook,
  wheelFireLook,
} from '../src/render/smith_heart_fx/heat_wheel_fx_core';
import { BODY_EDGE_MELEE_REACH } from '../src/sim/combat/player_attack_reach';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { inWave } from '../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_BODY_R,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_LIP_WALL,
  HEAT_TUNING as T,
  wellTemplate,
} from '../src/sim/encounters/smith_heart/heat_ids';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the lip wall on screen', () => {
  it('fills the sim wall band with stumps under the eye line', () => {
    const stumps = wellLipStumps();
    expect(stumps.length).toBeGreaterThan(100);
    for (const s of stumps) {
      const d = Math.hypot(s.x, s.z);
      expect(d - s.r).toBeGreaterThanOrEqual(HEAT_LIP_WALL.inner - 1e-6);
      expect(d + s.r).toBeLessThanOrEqual(HEAT_LIP_WALL.outer + 1e-6);
      expect(s.h).toBeLessThanOrEqual(HEAT_LIP_WALL.height + 1e-9);
      expect(s.h).toBeGreaterThan(0.8);
    }
    // The outer row stands shoulder to shoulder on the outer face (no gap a
    // body could seem to walk through).
    const outer = stumps.filter((s) => Math.hypot(s.x, s.z) > HEAT_LIP_WALL.outer - 1);
    const step = (Math.PI * 2 * (HEAT_LIP_WALL.outer - outer[0].r)) / outer.length;
    expect(step).toBeLessThan(2 * outer[0].r);
  });

  it("lays the melee's terrace from under the wall past their whole reach", () => {
    expect(HEAT_SHORE.inner).toBeLessThan(HEAT_LIP_WALL.outer);
    expect(HEAT_SHORE.inner).toBeGreaterThan(HEAT_LIP_WALL.inner);
    expect(HEAT_SHORE.outer).toBeGreaterThanOrEqual(HEAT_BODY_R + BODY_EDGE_MELEE_REACH + 2);
  });
});

describe('the lip clip', () => {
  it('hides only what lies inside the wall, never where a body stands', () => {
    expect(HEAT_LIP_CLIP_R).toBeGreaterThan(HEAT_LIP_WALL.inner);
    expect(HEAT_LIP_CLIP_R).toBeLessThan(HEAT_LIP_WALL.outer);
    const c = { x: 1000, y: -40, z: HEAT_LIP_CLIP_R };
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const at = (d: number) => [1000 + Math.sin(a) * d, -40 + Math.cos(a) * d] as const;
      expect(heatLipClipped(...at(0), c)).toBe(true);
      expect(heatLipClipped(...at(HEAT_LIP_WALL.inner + 0.5), c)).toBe(true);
      expect(heatLipClipped(...at(HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS), c)).toBe(false);
    }
    expect(heatLipClipped(1000, -40, { x: 1000, y: -40, z: 0 })).toBe(false);
  });

  it('every Heat floor material clips at the wall and samples the precise frame', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const add = (id: number, kind: string, templateId: string, x: number, z: number) =>
      entities.set(id, {
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
        auras: [],
        castingAbility: null,
        castTargetId: null,
        castRemaining: 0,
        castTotal: 0,
      } as unknown as Entity);
    add(1, 'player', 'warrior', -200, 0);
    add(2, 'mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z);
    add(3, 'object', wellTemplate('calm'), HEARTH_WELL.x, HEARTH_WELL.z);
    const world = {
      entities,
      player: entities.get(1),
      playerId: 1,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fight = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const fist = new HeatFx(scene, () => 0, world);
    for (let i = 0; i < 4; i++) {
      fight.update(1 / 20);
      fist.update(1 / 20);
    }
    // The pool laid the clip round the well.
    expect(heatLipClipUniform.value).toEqual({
      x: o.x + HEARTH_WELL.x,
      y: o.z + HEARTH_WELL.z,
      z: HEAT_LIP_CLIP_R,
    });
    const mats = new Map<string, THREE.ShaderMaterial>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial) mats.set(m.name, m);
    });
    const clipped = [
      'smithHeartHeatTelegraphChar',
      'smithHeartHeatTelegraphGlow',
      'smithHeartHeatWheelChar',
      'smithHeartHeatWheelGlow',
      'smithHeartHeatWakefireChar',
      'smithHeartHeatWakefireGlow',
      'smithHeartHeatPatches',
      'smithHeartHeatCraterChar',
      'smithHeartHeatMeteorCraterChar',
    ];
    for (const name of clipped) {
      const m = mats.get(name);
      expect(m, name).toBeDefined();
      if (!m) continue;
      expect(m.fragmentShader, name).toContain('heatLipClipped()');
      expect(m.uniforms.uLipClip?.value, name).toBe(heatLipClipUniform.value);
    }
    // The terrace samples the precise frame too (it lies outside the clip).
    const shore = mats.get('smithHeartHeatWellShore');
    expect(shore?.uniforms.uLipClip?.value).toBe(heatLipClipUniform.value);
    // No Heat floor fragment shader samples its noise on raw world yards.
    for (const [name, m] of mats) {
      if (!/Telegraph|Wheel$|WheelChar|WheelGlow|Wakefire|Patches|Shore|SwellWake/.test(name))
        continue;
      expect(m.fragmentShader, name).not.toMatch(/\(vW\.xz\s*[*/+)]/);
    }
    fight.dispose?.();
  });

  it('the telegraph shader discards over the disc before anything else', () => {
    const main = HEAT_TELEGRAPH_FRAG.slice(HEAT_TELEGRAPH_FRAG.indexOf('void main()'));
    expect(main.indexOf('heatLipClipped()')).toBeLessThan(main.indexOf('uShape > 0.5'));
  });
});

describe('no invisible damage', () => {
  const look: WheelLook = { build: 0, throb: 0, burn: 0, erupt: 0, scorch: 0 };
  const fire = { floor: 0, geysers: 0, low: 0, scorch: 0 };

  it('a Wheel slice reads as fire through its last tick, and goes fast once the sim drops it', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      expect(HEAT_DIFFICULTY[tier].wheel.rounds).toBeGreaterThan(0);
      // The sim's burn: eruption hit, then ticks every wheelTick until the
      // object drops at wheelBurn (heat_wheel.ts).
      for (let t = 0; t <= T.wheelBurn + 1e-9; t += 0.05) {
        wheelEruptLook(t, T.wheelBurn, look);
        for (const quench of [0, 1]) {
          wheelFireLook(look, true, 0, quench, fire);
          expect(fire.floor).toBeGreaterThanOrEqual(WHEEL_FX.danger);
          expect(fire.floor).toBeGreaterThanOrEqual(0.75);
          expect(fire.low).toBe(1);
        }
      }
    }
    wheelEruptLook(T.wheelBurn + WHEEL_FX.out, T.wheelBurn, look);
    wheelFireLook(look, false, WHEEL_FX.out, 0, fire);
    expect(fire.floor).toBeLessThan(0.01);
    expect(fire.low).toBeLessThan(0.01);
  });

  it("a lava wave stands fully risen before its front can reach anyone at the wall's foot", () => {
    const first = HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS;
    // Even first seen the instant it leaves the lip (age 0).
    expect(wallLook(0, first).rise).toBeCloseTo(1, 6);
    expect(wallLook(0, first - 0.3).rise).toBeGreaterThan(0.9);
    // Off the lip it has not risen yet (the clip hides it there anyway).
    expect(wallLook(0, T.ringStart).rise).toBeCloseTo(0, 6);
  });

  it("a Molten Swell's drawn wall stands in the sim's box through its last stretch", () => {
    const facing = 0.7;
    const o = { x: -200, z: 10 };
    for (let front = 0; front < T.laneLength + T.waveDepth; front += 0.25) {
      const drawn = swellDrawnFront(front);
      for (let along = -0.875; along <= T.laneLength + T.waveDepth + 1; along += 0.25) {
        const x = o.x + Math.sin(facing) * along;
        const z = o.z + Math.cos(facing) * along;
        const struck = inWave(o.x, o.z, facing, Math.min(front, T.laneLength), x, z);
        const shown = along >= drawn - T.waveDepth && along <= drawn && along >= 0;
        expect(shown, `front ${front}, along ${along}`).toBe(struck);
      }
    }
  });
});

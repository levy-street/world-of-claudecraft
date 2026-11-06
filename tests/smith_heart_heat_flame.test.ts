// The Guardian of the Heat's living fire (src/render/smith_heart_fx/
// heat_flame_core.ts, painted by heat_flame_tongues.ts) and its stone
// (heat_body_rocks.ts), after Jose's review of 2026-11-06: the flames are
// persistent tongues on real sockets that lick behind the bones' motion and
// breathe on their own clocks; the fire burns red to orange with yellow only
// at the core and never stacks to white; the blows' flash and shockwave sit
// under fixed caps so a slam never washes out the frame; the circling rocks
// and the flung basalt are dark stone with glowing cracks.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gateObjectPlan } from '../src/render/gate_objects';
import { HEARTH_FIRE_COLORS as HF } from '../src/render/smith_heart/heat_air_core';
import {
  HEARTH_CRYSTAL_PIECES,
  warmHearthGlow,
} from '../src/render/smith_heart/heat_kit_plan_core';
import { HEAT_MODEL_COLORS, HEAT_SOCKETS } from '../src/render/smith_heart_fx/heat_body_core';
import { HeatBodyRocks } from '../src/render/smith_heart_fx/heat_body_rocks';
import {
  fireRamp,
  fireRampGlsl,
  HEAT_BURST,
  HEAT_FIRE_RAMP,
  HEAT_TONGUE_LOW,
  HEAT_TONGUES,
  TONGUE_MAX_LEAN,
  tongueFlicker,
  tongueLean,
} from '../src/render/smith_heart_fx/heat_flame_core';
import { HeatFlameTongues } from '../src/render/smith_heart_fx/heat_flame_tongues';

const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

describe('heat_flame_core: the tongues', () => {
  it('stands every tongue on a real socket, the shoulders and back burning biggest', () => {
    const ids = new Set(HEAT_SOCKETS.map((s) => s.id));
    for (const t of HEAT_TONGUES) {
      expect(ids.has(t.socket), t.socket).toBe(true);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(t.w * 0.5);
      expect(t.heat).toBeGreaterThan(0);
      expect(t.heat).toBeLessThanOrEqual(1);
    }
    const tallest = (id: string) =>
      Math.max(...HEAT_TONGUES.filter((t) => t.socket === id).map((t) => t.h));
    expect(tallest('shoulderL')).toBeGreaterThan(tallest('hornL'));
    expect(tallest('back')).toBeGreaterThan(tallest('crown'));
    // No two tongues share a seed (none pulse in step).
    expect(new Set(HEAT_TONGUES.map((t) => t.seed)).size).toBe(HEAT_TONGUES.length);
  });

  it('keeps at least one tongue per burning socket on the low tier, and sheds the rest', () => {
    expect(HEAT_TONGUE_LOW.length).toBe(HEAT_TONGUES.length);
    const kept = HEAT_TONGUE_LOW.filter(Boolean).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(HEAT_TONGUES.length);
    for (const id of new Set(HEAT_TONGUES.map((t) => t.socket)))
      expect(
        HEAT_TONGUES.some((t, i) => t.socket === id && HEAT_TONGUE_LOW[i]),
        id,
      ).toBe(true);
  });

  it('licks behind the motion, capped, and stretches on a fist coming down', () => {
    const o = { x: 0, z: 0, stretch: 1 };
    tongueLean(0, 0, 0, o);
    expect(o).toEqual({ x: -0, z: -0, stretch: 1 });
    tongueLean(5, 0, 0, o);
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeCloseTo(0, 9);
    tongueLean(0, 0, -5, o);
    expect(o.z).toBeGreaterThan(0);
    // A whipped fist never lays its fire flat.
    tongueLean(400, 0, 300, o);
    expect(Math.hypot(o.x, o.z)).toBeCloseTo(TONGUE_MAX_LEAN, 9);
    tongueLean(0, -20, 0, o);
    expect(o.stretch).toBeGreaterThan(1);
    tongueLean(0, 20, 0, o);
    expect(o.stretch).toBeLessThan(1);
    tongueLean(0, -1e4, 0, o);
    expect(o.stretch).toBeLessThanOrEqual(1.5);
  });

  it('breathes in bounds and out of step', () => {
    let lo = 9;
    let hi = -9;
    for (let t = 0; t < 30; t += 0.05) {
      const f = tongueFlicker(t, 0.37);
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThan(0.7);
    expect(hi).toBeLessThan(1.25);
    expect(hi - lo).toBeGreaterThan(0.2);
    expect(tongueFlicker(1.3, 0.1)).not.toBeCloseTo(tongueFlicker(1.3, 0.6), 3);
  });
});

describe('heat_flame_core: the palette', () => {
  const c: [number, number, number] = [0, 0, 0];
  it('burns red at the edges, orange through the body, yellow only at the core', () => {
    fireRamp(0.25, c);
    expect(c[0]).toBeGreaterThan(c[1] * 3);
    fireRamp(0.5, c);
    expect(c[0]).toBeGreaterThan(0.9);
    expect(c[1] / c[0]).toBeLessThan(0.4);
    fireRamp(1, c);
    expect(c[1] / c[0]).toBeGreaterThan(0.85);
    // Never white: the top stop's blue stays well under its red.
    for (const [, r, , b] of HEAT_FIRE_RAMP) expect(b).toBeLessThan(r * 0.7 + 1e-9);
    // Monotone heat: each stop at least as bright as the one under it.
    for (let i = 1; i < HEAT_FIRE_RAMP.length; i++) {
      const lum = (s: readonly number[]) => s[1] + s[2] + s[3];
      expect(lum(HEAT_FIRE_RAMP[i])).toBeGreaterThanOrEqual(lum(HEAT_FIRE_RAMP[i - 1]));
    }
    const glsl = fireRampGlsl('fireRamp');
    expect(glsl).toContain('vec3 fireRamp(float h)');
    expect(glsl.match(/smoothstep/g)?.length).toBe(HEAT_FIRE_RAMP.length - 1);
  });

  it("moves the body's glows, flash and ring off the pale yellow to orange", () => {
    for (const hex of [
      HEAT_MODEL_COLORS.glow,
      HEAT_MODEL_COLORS.core,
      HEAT_MODEL_COLORS.flash,
      HEAT_MODEL_COLORS.ring,
    ]) {
      const [r, g, b] = rgb(hex);
      expect(r).toBe(255);
      expect(g / r).toBeLessThan(0.7);
      expect(b).toBeLessThan(g);
    }
    // The flames' heat stays in the pyre ramp's orange, never its white top.
    expect(HEAT_MODEL_COLORS.flameHot[0]).toBeLessThan(0.72);
    expect(HEAT_MODEL_COLORS.flameHeat[0]).toBeLessThan(HEAT_MODEL_COLORS.flameHot[0]);
  });

  it('caps every burst: a short flash on its point and a faint-waked ring', () => {
    expect(HEAT_BURST.flashLife).toBeLessThanOrEqual(0.2);
    expect(HEAT_BURST.flashPeak).toBeLessThanOrEqual(0.6);
    expect(HEAT_BURST.flashSize * 1.6).toBeLessThan(8);
    expect(HEAT_BURST.ring.wake).toBeLessThanOrEqual(0.25);
    expect(HEAT_BURST.ring.strength).toBeLessThanOrEqual(0.7);
    expect(HEAT_BURST.debris).toBeGreaterThan(0);
  });
});

describe('HeatFlameTongues and HeatBodyRocks', () => {
  const sockets = () => HEAT_SOCKETS.map((s) => new THREE.Vector3(s.at[0], s.at[1] + 10, s.at[2]));
  const ones = new Float32Array(HEAT_SOCKETS.length).fill(1);

  it('stands the fire on the sockets, trails it behind a moving fist, goes out under the lava', () => {
    const root = new THREE.Group();
    const mats: THREE.Material[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const tongues = new HeatFlameTongues(root, { value: 0 }, false, mats, geos);
    const fire = root.getObjectByName('smithHeartHeatTongues') as THREE.Mesh;
    const dark = root.getObjectByName('smithHeartHeatTongueSmoke') as THREE.Mesh;
    expect(fire && dark).toBeTruthy();
    expect((fire.material as THREE.ShaderMaterial).blending).toBe(THREE.AdditiveBlending);
    expect((dark.material as THREE.ShaderMaterial).blending).toBe(THREE.NormalBlending);
    // Off the floor ladder (no bare renderOrder); the dark layer is built, and
    // so sorted, first at the same origin.
    expect(dark.renderOrder).toBe(fire.renderOrder);
    expect(root.children.indexOf(dark)).toBeLessThan(root.children.indexOf(fire));
    const geo = fire.geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(HEAT_TONGUES.length);
    const s = sockets();
    for (let i = 0; i < 40; i++) tongues.update(s, 0, 0, i / 20, 1 / 20, 1, 1, ones);
    expect(fire.visible).toBe(true);
    const base = geo.getAttribute('aBase') as THREE.InstancedBufferAttribute;
    const axis = geo.getAttribute('aAxis') as THREE.InstancedBufferAttribute;
    const shape = geo.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    const fistR = HEAT_SOCKETS.findIndex((x) => x.id === 'fistR');
    const t = HEAT_TONGUES.findIndex((x) => x.socket === 'fistR');
    expect(Math.hypot(base.getX(t) - s[fistR].x, base.getZ(t) - s[fistR].z)).toBeLessThan(2);
    expect(axis.getY(t)).toBeGreaterThan(1);
    expect(shape.getW(t)).toBeGreaterThan(0.9);
    // At rest each tongue fans out from its socket (never a row of candles).
    const tx = HEAT_TONGUES[t].off[0];
    expect(Math.sign(axis.getX(t))).toBe(Math.sign(tx));
    // The fist swings toward +x: its fire licks back toward -x.
    const atRest = axis.getX(t);
    for (let i = 0; i < 10; i++) {
      s[fistR].x += 0.5;
      tongues.update(s, 0, 0, 2 + i / 20, 1 / 20, 1, 1, ones);
    }
    expect(axis.getX(t)).toBeLessThan(atRest - 0.3);
    // Sunk under the lava, its fire goes out; the rest burns on.
    s[fistR].y = -5;
    for (let i = 0; i < 40; i++) tongues.update(s, 0, 0, 3 + i / 20, 1 / 20, 1, 1, ones);
    expect(shape.getW(t)).toBeLessThan(0.02);
    const crown = HEAT_TONGUES.findIndex((x) => x.socket === 'crown');
    expect(shape.getW(crown)).toBeGreaterThan(0.9);
    tongues.update(s, 0, 0, 5, 1 / 20, 0, 1, ones);
    expect(fire.visible).toBe(false);
    // Both programs are this module's own materials (registered with the owner).
    expect(mats.length).toBe(2);
  });

  it('flings dark basalt that lands and sinks away', () => {
    const root = new THREE.Group();
    const rocks = new HeatBodyRocks(root, { value: 0 }, 7, 12, [], []);
    const debris = root.getObjectByName('smithHeartHeatDebris') as THREE.InstancedMesh;
    let r = 0.3;
    const rand = () => {
      r = (r * 9301 + 49297) % 233280;
      return r / 233280;
    };
    rocks.fling(0, 1, 0, 6, 8, 0.6, rand);
    rocks.update(0, 1 / 20, () => 0);
    expect(debris.visible).toBe(true);
    for (let i = 1; i < 30; i++) rocks.update(i / 20, 1 / 20, () => 0);
    // Landed on the floor, never under it.
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      debris.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.y).toBeGreaterThan(-0.01);
    }
    for (let i = 30; i < 100; i++) rocks.update(i / 20, 1 / 20, () => 0);
    expect(debris.visible).toBe(false);
    // The shader burns its cracks (uGlow) and is unlit.
    expect(rocks.material.uniforms.uGlow.value).toBe(1);
    expect(rocks.material.fragmentShader).toContain('crack');
    rocks.dispose();
  });
});

describe("the Heat fight's objects", () => {
  it('draw as empty anchors, never the generic prop and its loot sparkle', () => {
    for (const templateId of [
      'sh_heat_fist_80',
      'sh_heat_lane_warn_40',
      'sh_heat_wave',
      'sh_heat_seed_30',
      'sh_heat_fall_20',
    ]) {
      const plan = gateObjectPlan({ templateId, dungeonId: 'smith_heart', pos: { x: 0, z: 0 } });
      expect(plan && 'encounterAnchor' in plan, templateId).toBe(true);
    }
    expect(gateObjectPlan({ templateId: 'mailbox', dungeonId: null, pos: { x: 0, z: 0 } })).toBe(
      null,
    );
  });
});

describe("the Hearth's own fire and crystals (Hearth only)", () => {
  it('burns the Hearth flames orange-red with a yellow core, the Quench bowls untouched', () => {
    for (const hex of [HF.warm, HF.deep, HF.ember, HF.halo]) {
      const [r, g, b] = rgb(hex);
      expect(g / r).toBeLessThan(0.55);
      expect(b).toBeLessThan(g);
    }
    // Only the core keeps its yellow.
    const [hr, hg] = rgb(HF.hot);
    expect(hg / hr).toBeGreaterThan(0.7);
    // The Heat's material reads the Hearth palette; the Quench room's fire
    // bowls keep their own uniforms on the shared shader, byte for byte.
    const heat = readFileSync('src/render/smith_heart/heat_air.ts', 'utf8');
    expect(heat).toContain('uHot: col(HF.hot), uWarm: col(HF.warm), uDeep: col(HF.deep)');
    const quench = readFileSync('src/render/smith_heart/quench_air.ts', 'utf8');
    expect(quench).toContain('{ uHot: col(0xfff0c8), uWarm: col(0xffa040), uDeep: col(0xb03a10) }');
    expect(quench).not.toContain('HEARTH_FIRE_COLORS');
  });

  it("warms the Hearth's great mouth crystal and its clusters to amber", () => {
    expect(HEARTH_CRYSTAL_PIECES).toContain('Kit_HearthMouth');
    expect(HEARTH_CRYSTAL_PIECES).toContain('Kit_FireCrystalA');
    const c: [number, number, number] = [1, 0.9, 0.62];
    warmHearthGlow(c);
    expect(c[1] / c[0]).toBeLessThan(0.6);
    expect(c[2]).toBeLessThan(c[1]);
  });

  it('keeps the shoulders and crown in short licks under a few taller tongues', () => {
    for (const id of ['shoulderL', 'shoulderR', 'crown', 'hornL']) {
      const hs = HEAT_TONGUES.filter((t) => t.socket === id).map((t) => t.h);
      expect(Math.max(...hs), id).toBeLessThan(6);
      if (hs.length > 2) expect(Math.max(...hs) / Math.min(...hs), id).toBeGreaterThan(1.2);
    }
  });
});

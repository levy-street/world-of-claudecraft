// The Buried Hoard reward chest on screen: the pure ceremony plans
// (src/render/hoard_reward_chest_core.ts), the body the renderer hangs in the
// world (src/render/hoard_reward_chest.ts), and the shipped Blender asset.
import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIALS, NODES, SOURCE, TARGET } from '../scripts/assets/reward_chest/build.mjs';
import { HOARD_BODY_IDS, hoardEntrance } from '../src/render/hoard_entrance';
import { buildHoardRewardChest } from '../src/render/hoard_reward_chest';
import {
  CHEST_RARITY,
  CHEST_TUNING,
  chestIdle,
  chestMote,
  chestMoteCount,
  chestOpen,
  chestPulse,
  chestRarity,
  chestRay,
  chestSpawn,
} from '../src/render/hoard_reward_chest_core';
import type { Entity } from '../src/sim/types';

describe('reward chest rarity', () => {
  it('is one parametric system: same chest, louder light as the rarity climbs', () => {
    const order = ['common', 'rare', 'epic', 'legendary'] as const;
    for (let i = 1; i < order.length; i++) {
      const lower = CHEST_RARITY[order[i - 1]];
      const higher = CHEST_RARITY[order[i]];
      expect(higher.intensity).toBeGreaterThan(lower.intensity);
      expect(higher.particles).toBeGreaterThan(lower.particles);
      expect(higher.pulse).toBeGreaterThan(lower.pulse);
      expect(higher.rays).toBeGreaterThanOrEqual(lower.rays);
      expect(higher.color).not.toBe(lower.color);
    }
    // Blue, violet, gold: the owner's colours, read straight from the channels.
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const [rr, , rb] = rgb(CHEST_RARITY.rare.color);
    expect(rb).toBeGreaterThan(rr * 2);
    const [er, eg, eb] = rgb(CHEST_RARITY.epic.color);
    expect(Math.min(er, eb)).toBeGreaterThan(eg);
    const [lr, lg, lb] = rgb(CHEST_RARITY.legendary.color);
    expect(lr).toBeGreaterThan(lg);
    expect(lg).toBeGreaterThan(lb * 2);
    expect(chestRarity(undefined)).toBe('rare');
    expect(chestRarity('legendary')).toBe('legendary');
    // Rich, never a particle storm.
    expect(chestMoteCount(CHEST_RARITY.legendary)).toBeLessThanOrEqual(CHEST_TUNING.PARTICLE_MAX);
    expect(chestMoteCount(CHEST_RARITY.legendary)).toBeGreaterThan(
      chestMoteCount(CHEST_RARITY.common),
    );
  });
});

describe('reward chest arrival', () => {
  it('runs about a second: gather, pool, burst, reveal, drop, settle', () => {
    const total = CHEST_TUNING.SPAWN_DURATION;
    expect(total).toBeGreaterThanOrEqual(0.8);
    expect(total).toBeLessThanOrEqual(1.2);
    const start = chestSpawn(0);
    expect(start).toMatchObject({ reveal: 0, flash: 0, ring: 0, done: false });
    // It never pops in: nothing of the chest exists while the energy gathers.
    expect(chestSpawn(total * 0.2).reveal).toBe(0);
    expect(chestSpawn(total * 0.2).gather).toBeGreaterThan(0.5);
    expect(chestSpawn(total * 0.35).column).toBeGreaterThan(0.5);
    // The flash is at the moment it becomes solid, and is brief.
    expect(chestSpawn(total * 0.52).flash).toBeCloseTo(CHEST_TUNING.SPAWN_FLASH_INTENSITY);
    expect(chestSpawn(total * 0.7).flash).toBe(0);
    // It appears ABOVE its place and lands: the ring only after the landing.
    expect(chestSpawn(total * 0.62).lift).toBeGreaterThan(0.4);
    expect(chestSpawn(total * 0.7).ring).toBe(0);
    expect(chestSpawn(total * 0.76).lift).toBe(0);
    expect(chestSpawn(total * 0.76).ring).toBeGreaterThan(0.5);
    const end = chestSpawn(total);
    expect(end).toMatchObject({ reveal: 1, lift: 0, done: true });
    expect(end.squash).toBeCloseTo(1);
  });

  it('has weight, not bounce: one small compression and it never leaves the ground again', () => {
    let lowest = 1;
    for (let t = 0; t <= CHEST_TUNING.SPAWN_DURATION; t += 0.01) {
      const plan = chestSpawn(t);
      lowest = Math.min(lowest, plan.squash);
      expect(plan.squash).toBeLessThanOrEqual(1.0001);
      if (t > CHEST_TUNING.SPAWN_DURATION * 0.76) expect(plan.lift).toBe(0);
    }
    expect(lowest).toBeGreaterThan(0.9);
    expect(lowest).toBeLessThan(0.98);
  });

  it('is simply there under reduced motion', () => {
    const calm = chestSpawn(0.05, true);
    expect(calm).toMatchObject({ reveal: 1, lift: 0, flash: 0, ring: 0, squash: 1 });
  });
});

describe('reward chest waiting', () => {
  const profile = CHEST_RARITY.epic;

  it('keeps the lid at a small gap: closed and waiting, never half open', () => {
    expect(CHEST_TUNING.LID_IDLE_ANGLE).toBeGreaterThanOrEqual(3);
    expect(CHEST_TUNING.LID_IDLE_ANGLE).toBeLessThanOrEqual(7);
    for (let t = 0; t < 40; t += 0.037) {
      const plan = chestIdle(t, CHEST_RARITY.legendary);
      expect(plan.lidAngle).toBeGreaterThan(2);
      expect(plan.lidAngle).toBeLessThan(9);
    }
  });

  it('trembles like contained pressure: tiny, irregular, stronger on a surge', () => {
    let peak = 0;
    const xs = new Set<string>();
    for (let t = 0; t < 30; t += 0.05) {
      const plan = chestIdle(t, CHEST_RARITY.legendary);
      peak = Math.max(peak, Math.hypot(plan.shakeX, plan.shakeZ));
      xs.add(plan.shakeX.toFixed(4));
    }
    // Centimetres, never a hop.
    expect(peak).toBeLessThan(0.04);
    expect(peak).toBeGreaterThan(0.004);
    expect(xs.size).toBeGreaterThan(100);
    // Find a surge and a lull: the surge shakes and glows harder.
    let surge = 0;
    let lull = 0;
    for (let t = 0; t < 30; t += 0.02) {
      if (chestPulse(t) > 0.95) surge = t;
      if (chestPulse(t) === 0) lull = t;
    }
    expect(chestIdle(surge, profile).glow).toBeGreaterThan(chestIdle(lull, profile).glow * 1.3);
    expect(chestIdle(surge, profile).lidAngle).toBeGreaterThan(CHEST_TUNING.LID_IDLE_ANGLE + 0.8);
  });

  it('surges every few seconds on an uneven rhythm, and eases in and out of each', () => {
    const starts: number[] = [];
    let previous = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const value = chestPulse(t);
      if (previous === 0 && value > 0) starts.push(t);
      // No pop at either end of a surge.
      expect(Math.abs(value - previous)).toBeLessThan(0.08);
      previous = value;
    }
    expect(starts.length).toBeGreaterThan(12);
    const gaps = starts.slice(1).map((value, i) => value - starts[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.3);
    expect(Math.min(...gaps)).toBeGreaterThan(1.5);
  });

  it('holds still under reduced motion', () => {
    const a = chestIdle(1.23, profile, true);
    const b = chestIdle(7.77, profile, true);
    expect(a).toEqual(b);
    expect(Math.abs(a.shakeX)).toBe(0);
    expect(a.lidAngle).toBe(CHEST_TUNING.LID_IDLE_ANGLE);
  });

  it('sends motes up and out of the chest, each on its own clock, a few as sparkles', () => {
    const out = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };
    const sizes = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const early = { ...chestMote(i, 0.01 * i, profile, 0, out) };
      expect(early.y).toBeGreaterThan(0.6);
      sizes.add(early.size.toFixed(3));
      expect(early.alpha).toBeGreaterThanOrEqual(0);
    }
    expect(sizes.size).toBeGreaterThan(8);
    // Gathered (the arrival): pulled toward the spot from a wide ring, low down.
    const gathered = { ...chestMote(3, 0.2, profile, 1, out) };
    expect(gathered.y).toBeLessThan(1.4);
  });

  it('fans the light rays out of the gap, each one swaying on its own', () => {
    const out = { yaw: 0, lean: 0, length: 0, width: 0, alpha: 0 };
    const a = { ...chestRay(1, 5, 0.5, 1, out) };
    const b = { ...chestRay(1, 5, 2.9, 1, out) };
    expect(a.yaw).not.toBe(b.yaw);
    expect(a.length).not.toBe(b.length);
    expect({ ...chestRay(0, 5, 1, 1, out) }.yaw).toBeLessThan({ ...chestRay(4, 5, 1, 1, out) }.yaw);
    expect(chestRay(2, 5, 1, 0, out).alpha).toBe(0);
  });
});

describe('reward chest opening', () => {
  it('throws the lid back from its idle gap and lets the light loose', () => {
    const profile = CHEST_RARITY.rare;
    const start = chestOpen(0, profile);
    expect(start.lidAngle).toBeCloseTo(CHEST_TUNING.LID_IDLE_ANGLE);
    expect(start.burst).toBe(1);
    const end = chestOpen(CHEST_TUNING.OPEN_DURATION, profile);
    expect(end.lidAngle).toBeCloseTo(CHEST_TUNING.LID_OPEN_ANGLE);
    expect(end).toMatchObject({ burst: 0, done: true });
    expect(start.glow).toBeGreaterThan(end.glow);
    expect(chestOpen(0.01, profile, true).lidAngle).toBeCloseTo(CHEST_TUNING.LID_OPEN_ANGLE);
  });
});

describe('reward chest body', () => {
  const entity = (templateId: string, vaultRarity?: string) =>
    ({ templateId, vaultRarity, pos: { x: 0, y: 0, z: 0 }, facing: 0 }) as unknown as Entity;

  it('rides the hoard body override for both of its templates, and only those', () => {
    expect(HOARD_BODY_IDS).toEqual(
      expect.arrayContaining(['hoard_entrance', 'hoard_reward_chest', 'hoard_reward_chest_open']),
    );
    const calm = () => false;
    expect(hoardEntrance(entity('hoard_reward_chest', 'epic'), () => 0, calm)?.body.name).toBe(
      'hoardRewardChest',
    );
    expect(hoardEntrance(entity('dungeon_door'), () => 0, calm)).toBeNull();
  });

  it('hangs the lid on its own hinge, adds no light, and knows its rarity and state', () => {
    const closed = buildHoardRewardChest(entity('hoard_reward_chest', 'legendary'), () => false);
    expect(closed.body.userData).toMatchObject({
      hoardChestRarity: 'legendary',
      hoardChestOpened: false,
    });
    const hinge = closed.body.getObjectByName('Chest_LidHinge');
    expect(hinge?.position.y).toBe(CHEST_TUNING.HINGE_Y);
    expect(hinge?.position.z).toBe(CHEST_TUNING.HINGE_Z);
    expect(hinge?.getObjectByName('Chest_Lid')).toBeDefined();
    closed.body.traverse((node) => expect(node).not.toBeInstanceOf(THREE.Light));
    const open = buildHoardRewardChest(entity('hoard_reward_chest_open', 'rare'), () => false);
    expect(open.body.userData.hoardChestOpened).toBe(true);
  });
});

describe('reward chest asset', () => {
  it('ships the Blender chest as separate named parts, texture free and light', async () => {
    expect(existsSync(SOURCE)).toBe(true);
    expect(existsSync(TARGET)).toBe(true);
    expect(readFileSync(TARGET).length).toBeLessThan(80_000);
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.read(TARGET)).getRoot();
    expect(
      root
        .listNodes()
        .map((node) => node.getName())
        .sort(),
    ).toEqual(NODES);
    expect(
      root
        .listMaterials()
        .map((material) => material.getName())
        .sort(),
    ).toEqual(MATERIALS);
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    let triangles = 0;
    for (const mesh of root.listMeshes())
      for (const primitive of mesh.listPrimitives())
        triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
    // A readable stylized prop, not a hero sculpt.
    expect(triangles).toBeGreaterThan(1000);
    expect(triangles).toBeLessThan(4000);
    expect((root.getExtras() as { authoring?: string }).authoring).toBe('Blender');
  });
});

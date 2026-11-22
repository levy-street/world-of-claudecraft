import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { TollingHammer } from '../src/render/ability_vfx/tolling_hammer';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import {
  TOLLING_CAPACITY,
  TOLLING_DROP,
  TOLLING_SPEED,
  tollingHeight,
} from '../src/render/tolling_hammer_core';
import { PROJECTILE_SPEED } from '../src/sim/projectile_travel';

async function fixture() {
  const land = vi.fn();
  const position = new THREE.Vector3(8, 1.2, 0);
  const groundY = (x: number, z: number) => x * 0.1 + z * 0.2;
  // The target's feet stand on the terrain; its body anchors ride far above.
  const anchor = vi.fn((id: number, fraction: number, out?: THREE.Vector3) => {
    if (id < 0 || !out) return null;
    if (id === 1) return out.set(0, 1.2, 0);
    return fraction === 0
      ? out.set(position.x, groundY(position.x, position.z), position.z)
      : out.copy(position);
  });
  const effect = new TollingHammer(new THREE.Scene(), anchor, land, groundY);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  return {
    effect,
    land,
    position,
    groundY,
    prepare: async () => {
      for (const unit of effect.preparation.units(host)) await unit.run();
    },
  };
}

// Node runs at the Medium preset: pin the authored composition.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Tolling Hammer', () => {
  it('requires preparation and a confirmed outcome before the overhead strike', async () => {
    const f = await fixture();
    expect(f.effect.launch(1, 2)).toBe(false);
    await f.prepare();
    expect(f.effect.launch(1, 2)).toBe(true);
    f.effect.update(0.4, false);
    expect(f.land).not.toHaveBeenCalled();
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.effect.contact(1, 2, 'damage')).toBe(true);
    f.effect.update(TOLLING_DROP - 0.01, false);
    expect(f.land).not.toHaveBeenCalled();
    f.position.set(10, 9, 3);
    f.effect.update(0.02, false);
    expect(f.land).toHaveBeenCalledOnce();
    expect(f.land.mock.calls[0][0]).toBe(10);
    expect(f.land.mock.calls[0][2]).toBe(3);
    // The striking face reaches terrain even when the tracked body anchor is far above it.
    const g = f.effect.mesh.geometry;
    const p = g.getAttribute('position');
    const shape = g.getAttribute('aShape');
    let bottom = Infinity;
    for (let i = 0; i < g.drawRange.count; i++)
      if (shape.getX(i) === 0) bottom = Math.min(bottom, p.getY(i));
    expect(bottom).toBeCloseTo(f.groundY(10, 3) + 0.015, 5);
    f.effect.update(1, false);
    expect(f.land).toHaveBeenCalledOnce();
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it('cancels avoided, dead and stale projectiles without inventing impacts', async () => {
    const f = await fixture();
    await f.prepare();
    f.effect.launch(1, 2);
    f.effect.contact(1, 2, 'none');
    f.effect.update(0.5, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.launch(1, 2);
    f.effect.cancelEntity(2);
    f.effect.update(0.1, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.launch(1, 2);
    f.effect.update(3.3, false);
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.land).not.toHaveBeenCalled();
    expect(f.effect.launch(1, -1)).toBe(false);
    f.effect.dispose();
  });
  it('bounds the pool and uploads only finite active prefixes; reduced motion retains the hammer', async () => {
    const f = await fixture();
    await f.prepare();
    for (let i = 0; i < TOLLING_CAPACITY; i++) expect(f.effect.launch(1, i + 2)).toBe(true);
    expect(f.effect.launch(1, 80)).toBe(false);
    f.effect.update(0.1, false);
    const g = f.effect.mesh.geometry;
    // Nothing flies from the Paladin: the throw is unseen until the hit lands.
    expect(g.drawRange.count).toBe(0);
    for (let i = 0; i < TOLLING_CAPACITY; i++)
      expect(f.effect.contact(1, i + 2, 'damage')).toBe(true);
    f.effect.update(0.1, false);
    const n = g.drawRange.count;
    expect(n).toBeGreaterThan(0);
    for (const attribute of Object.values(g.attributes)) {
      expect(
        Array.from(attribute.array.slice(0, n * attribute.itemSize)).every(Number.isFinite),
      ).toBe(true);
      expect((attribute as THREE.BufferAttribute).updateRanges).toEqual([
        { start: 0, count: n * attribute.itemSize },
      ]);
    }
    f.effect.update(0.1, true);
    expect(g.drawRange.count).toBeLessThan(n);
    expect(g.drawRange.count).toBeGreaterThan(0);
    f.effect.clear();
    expect(g.drawRange.count).toBe(0);
    const disposed = vi.spyOn(g, 'dispose');
    f.effect.dispose();
    f.effect.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(tollingHeight(0, true)).toBeLessThan(tollingHeight(0, false));
    expect(tollingHeight(TOLLING_DROP, false)).toBe(0);
    expect(TOLLING_SPEED).toBe(PROJECTILE_SPEED);
  });
  it('claims primary, companions and name-only echoes without duplicating the strike', () => {
    const fx = { tollingHammerThrow: vi.fn(), tollingHammerContact: vi.fn() };
    const receiveHit = vi.fn(),
      releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx, receiveHit },
      releaseGesture,
    }) as AbilityVfx;
    const base = { sourceId: 1, targetId: 2, ability: 'hammer_of_wrath', school: 'holy' };
    expect(p.handleSpellfx({ ...base, fx: 'projectile' })).toBe(true);
    expect(p.handleSpellfx({ ...base, fx: 'paladinAscensionImpact' })).toBe(true);
    expect(fx.tollingHammerThrow).toHaveBeenCalledOnce();
    expect(releaseGesture).toHaveBeenCalledOnce();
    const hit = { ...base, ability: 'Hammer of Wrath', amount: 170, kind: 'hit', crit: false };
    p.onDamage({ ...hit, abilityId: 'hammer_of_wrath' });
    p.onDamage(hit);
    p.onDamage({ ...hit, abilityId: 'hammer_of_wrath', amount: 0, absorbed: 170 });
    p.onDamage({ ...hit, amount: 0, kind: 'resist' });
    expect(fx.tollingHammerContact.mock.calls).toEqual([
      [1, 2, 'damage'],
      [1, 2, 'absorb'],
      [1, 2, 'none'],
    ]);
    expect(receiveHit).toHaveBeenCalledOnce();
  });
});

describe('headFirstTurn', () => {
  it('turns a thrown hammer so its head leads along the flight, never by its age', async () => {
    const { headFirstTurn } = await import('../src/render/tolling_hammer_core');
    // Camera right +x, up +y: the length axis runs up*cos + right*sin, head at
    // the far (negative) end, so flying +x puts the head toward +x.
    const cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const turn = headFirstTurn(cam, 1, 0);
    expect(-Math.sin(turn)).toBeCloseTo(1);
    expect(-Math.cos(turn)).toBeCloseTo(0);
    // Straight at the camera: head down.
    expect(headFirstTurn([1, 0, 0, 0, 0, 1, 0, 0, -1], 0, 0)).toBe(0);
  });

  it('falls gilded with a second, wider toll when Ascension empowers it', async () => {
    const tolls = async (gilded: boolean) => {
      const f = await fixture();
      await f.prepare();
      f.effect.launch(1, 2);
      f.effect.contact(1, 2, 'damage');
      // The charge is spent as the hurled hammer strikes: its cue follows the contact.
      if (gilded) expect(f.effect.gild(1)).toBe(true);
      f.effect.update(TOLLING_DROP + 0.15, false);
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      let grounds = 0;
      for (let i = 0; i < g.drawRange.count; i += 6) if (shape.getX(i) === 5) grounds++;
      f.effect.dispose();
      return grounds;
    };
    expect(await tolls(false)).toBe(1);
    expect(await tolls(true)).toBe(2);
  });
});

describe('Tolling Hammer detail', () => {
  /** Quads per shape of one gilded strike at `detail`, sampled while the
   * hammer falls and just after it strikes. */
  const strike = async (detail: PaladinVfxDetail) => {
    const f = await fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    f.effect.launch(1, 2);
    f.effect.contact(1, 2, 'damage');
    // A later detail change never reshapes a running strike.
    setPaladinVfxDetailForTest('full');
    f.effect.gild(1);
    const count = () => {
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const out = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < g.drawRange.count; i += 6) out[shape.getX(i)]++;
      return out;
    };
    f.effect.update(0.1, false);
    const falling = count();
    f.effect.update(TOLLING_DROP - 0.1 + 0.12, false);
    const struck = count();
    const total = struck.reduce((a, b) => a + b, 0);
    // The strike's tail: how long until nothing draws.
    let tail = 0;
    while (f.effect.mesh.visible && tail < 2) {
      f.effect.update(0.02, false);
      tail += 0.02;
    }
    f.effect.dispose();
    return { falling, struck, total, tail };
  };

  it('draws the same hammer and toll lighter at light and minimal', async () => {
    const full = await strike('full');
    const light = await strike('light');
    const minimal = await strike('minimal');
    // Core: the hammer and the ground (reticle, then the toll) on every tier.
    for (const d of [full, light, minimal]) {
      expect(d.falling[0]).toBe(1);
      expect(d.falling[5]).toBe(1);
      expect(d.struck[0]).toBe(1);
      expect(d.struck[5]).toBeGreaterThan(0);
      expect(d.struck[4]).toBeGreaterThan(0);
    }
    // Full: the sky flare and streak as it falls; the gilded second toll,
    // pillar and strike flare at the strike.
    expect(full.falling[3]).toBe(1);
    expect(full.falling[2]).toBe(1);
    expect(full.struck[5]).toBe(2);
    expect(full.struck[2]).toBe(1);
    expect(full.struck[3]).toBe(1);
    // Light keeps the secondary layers, drops the sky flare and thins the sparks.
    expect(light.falling[3]).toBe(0);
    expect(light.falling[2]).toBe(1);
    expect(light.struck[5]).toBe(2);
    expect(light.struck[2]).toBe(1);
    expect(light.struck[4]).toBeLessThan(full.struck[4]);
    // Minimal keeps only the core and a third of the sparks.
    expect(minimal.falling[3] + minimal.falling[2]).toBe(0);
    expect(minimal.struck[5]).toBe(1);
    expect(minimal.struck[2] + minimal.struck[3]).toBe(0);
    expect(minimal.struck[4]).toBeLessThan(light.struck[4]);
    expect(light.total).toBeLessThan(full.total);
    expect(minimal.total).toBeLessThan(light.total);
    // Shorter lingers.
    expect(light.tail).toBeLessThan(full.tail);
    expect(minimal.tail).toBeLessThan(light.tail);
  });
});

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dawnfall } from '../src/render/ability_vfx/dawnfall';
import { AbilityVfx, type AbilityVfxDamageEvent } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import {
  DAWNFALL_BEAM_LANDING,
  DAWNFALL_CAST_CAPACITY,
  DAWNFALL_CONTACT_CAPACITY,
  DAWNFALL_DURATION,
  DAWNFALL_FLOOR_LAYERS,
  DAWNFALL_VERTICES,
  DAWNFALL_WAVE_CRESTS,
  dawnfallRadius,
  sampleDawnfallBeam,
  sampleDawnfallWave,
} from '../src/render/dawnfall_core';

/** The caster stands at (2, 3); its feet are on the terrain unless `feet` says
 * it stands on something higher (a dock or raised tier). */
function fixture(groundY: (x: number, z: number) => number = () => 0, feet?: number) {
  const scene = new THREE.Scene();
  const anchor = vi.fn((id: number, frac: number, out?: THREE.Vector3) =>
    id < 0 ? null : (out?.set(2, frac === 0 ? (feet ?? groundY(2, 3)) : 1, 3) ?? null),
  );
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(8, 9, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const effect = new Dawnfall(scene, anchor, camera, groundY);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const prepare = async () => {
    for (const unit of effect.preparation.units(host)) await unit.run();
  };
  return { scene, effect, prepare, host };
}
// The authored composition; the detail tiers have their own block below.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Dawnfall authoritative routing', () => {
  function painterFixture() {
    const fx = { dawnfallCast: vi.fn(), dawnfallContact: vi.fn() };
    const triggerAttack = vi.fn(),
      receiveHit = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx, triggerAttack, receiveHit },
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
    }) as AbilityVfx;
    return { painter, fx, triggerAttack, receiveHit };
  }
  it.each([6, 10])(
    'casts once without a victim at radius %s and suppresses Ascension duplicate',
    (radius) => {
      const f = painterFixture();
      expect(
        f.painter.handleSpellfx({
          sourceId: 1,
          targetId: 1,
          school: 'holy',
          fx: 'paladinDawnfall',
          ability: 'dawnfall',
          range: radius,
        }),
      ).toBe(true);
      expect(f.fx.dawnfallCast).toHaveBeenCalledExactlyOnceWith(1, radius);
      expect(f.triggerAttack).toHaveBeenCalledExactlyOnceWith(1, 'dawnfall');
      expect(
        f.painter.handleSpellfx({
          sourceId: 1,
          targetId: 1,
          school: 'holy',
          fx: 'paladinAscensionImpact',
          ability: 'dawnfall',
        }),
      ).toBe(true);
      expect(f.fx.dawnfallCast).toHaveBeenCalledTimes(1);
    },
  );
  it('emits per-victim damage/absorb contacts without companion duplicates, false hits or label-only echoes', () => {
    const f = painterFixture();
    const base: AbilityVfxDamageEvent = {
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      abilityId: 'dawnfall',
      ability: 'Dawnfall',
      amount: 50,
      crit: false,
      kind: 'hit',
    };
    f.painter.onDamage(base);
    f.painter.handleSpellfx({
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      fx: 'paladinDawnfallImpact',
    });
    f.painter.onDamage({ ...base, targetId: 3, amount: 0, absorbed: 40 });
    f.painter.onDamage({ ...base, targetId: 4, amount: 0, kind: 'evade' });
    f.painter.onDamage({ ...base, targetId: 5, amount: 0 });
    f.painter.onDamage({ ...base, targetId: 6, abilityId: undefined });
    expect(f.fx.dawnfallContact.mock.calls).toEqual([
      [2, 'damage'],
      [3, 'absorb'],
    ]);
    expect(f.receiveHit).toHaveBeenCalledExactlyOnceWith(2);
    expect(f.fx.dawnfallCast).not.toHaveBeenCalled();
  });
});
describe('Dawnfall prepared bounded geometry', () => {
  it('requires real preparation, retires all live geometry, and disposes once', async () => {
    const f = fixture();
    expect(f.effect.spawn(1, 6)).toBe(false);
    await f.prepare();
    expect(f.host.draw).toHaveBeenCalledOnce();
    expect(f.effect.spawn(-1, 6)).toBe(false);
    expect(f.effect.spawn(1, 6)).toBe(true);
    f.effect.update(0.22, false);
    expect(f.effect.mesh.visible).toBe(true);
    expect(f.effect.mesh.geometry.drawRange.count).toBe(DAWNFALL_VERTICES);
    f.effect.update(DAWNFALL_DURATION, false);
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.effect.mesh.geometry.drawRange.count).toBe(0);
    const geometryDispose = vi.spyOn(f.effect.mesh.geometry, 'dispose'),
      materialDispose = vi.spyOn(f.effect.mesh.material, 'dispose');
    f.effect.dispose();
    f.effect.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(f.effect.mesh.parent).toBeNull();
    expect(f.effect.spawn(1, 6)).toBe(false);
  });
  it('bounds repeated casts and contacts, writes finite prefix data and preserves cast pool', async () => {
    const f = fixture();
    await f.prepare();
    for (let i = 0; i < 100; i++) {
      f.effect.spawn(1, 10);
      f.effect.contact(2, 'damage');
    }
    f.effect.update(0.22, false);
    const geometry = f.effect.mesh.geometry,
      count = geometry.drawRange.count;
    expect(count).toBe(DAWNFALL_CAST_CAPACITY * DAWNFALL_VERTICES + DAWNFALL_CONTACT_CAPACITY * 18);
    for (const attr of Object.values(geometry.attributes)) {
      expect(Array.from(attr.array.slice(0, count * attr.itemSize)).every(Number.isFinite)).toBe(
        true,
      );
      expect((attr as THREE.BufferAttribute).updateRanges).toEqual([
        { start: 0, count: count * attr.itemSize },
      ]);
    }
    f.effect.clear();
    expect(geometry.drawRange.count).toBe(0);
    f.effect.spawn(1, 6);
    f.effect.update(0.1, true);
    expect(geometry.drawRange.count).toBeLessThan(DAWNFALL_VERTICES);
    f.effect.dispose();
  });
  it('drapes every floor vertex to sloped terrain without per-frame terrain queries', async () => {
    const ground = vi.fn((x: number, z: number) => x * 0.2 + z * 0.1);
    const f = fixture(ground);
    await f.prepare();
    f.effect.spawn(1, 10);
    ground.mockClear();
    f.effect.update(0.22, false);
    const positions = f.effect.mesh.geometry.getAttribute('position');
    for (let i = 0; i < DAWNFALL_FLOOR_LAYERS * 8 * 8 * 6; i++) {
      const clearance = positions.getY(i) - (positions.getX(i) * 0.2 + positions.getZ(i) * 0.1);
      expect(clearance).toBeGreaterThan(0.12);
      expect(clearance).toBeLessThan(0.25);
    }
    // Each spark fades against the slope at its own center, including downhill.
    const distances = f.effect.mesh.geometry.getAttribute('aGround');
    const shapes = f.effect.mesh.geometry.getAttribute('aShape');
    let waveVertices = 0;
    for (let i = 0; i < f.effect.mesh.geometry.drawRange.count; i++) {
      if (shapes.getX(i) !== 8) continue;
      waveVertices++;
      const terrain = positions.getX(i) * 0.2 + positions.getZ(i) * 0.1;
      expect(positions.getY(i) - distances.getX(i)).toBeCloseTo(terrain, 5);
      expect(distances.getX(i)).toBeGreaterThanOrEqual(0.139);
      expect(distances.getX(i)).toBeLessThan(1);
      expect(Math.hypot(positions.getX(i) - 2, positions.getZ(i) - 3)).toBeLessThan(10);
    }
    expect(waveVertices).toBeGreaterThan(0);
    const firstMote = f.effect.mesh.geometry.drawRange.count - 16 * 6;
    for (let mote = 0; mote < 16; mote++) {
      const first = firstMote + mote * 6;
      let centerX = 0,
        centerZ = 0;
      for (let j = 0; j < 6; j++) {
        centerX += positions.getX(first + j) / 6;
        centerZ += positions.getZ(first + j) / 6;
      }
      const centerGround = centerX * 0.2 + centerZ * 0.1;
      for (let j = 0; j < 6; j++)
        expect(positions.getY(first + j) - distances.getX(first + j)).toBeCloseTo(centerGround, 5);
    }
    expect(ground.mock.calls.length).toBe(0);
    f.effect.dispose();
  });
  it('lays the sigil on a raised floor (dock, bridge, tier) rather than the terrain beneath it', async () => {
    // Terrain dips to a gully under a 1.5-yard deck; a hill rises past its east end.
    const terrain = (x: number) => (x > 8 ? (x - 8) * 1.2 : -0.5);
    const f = fixture(terrain, 1.5);
    await f.prepare();
    f.effect.spawn(1, 10);
    f.effect.update(0.22, false);
    const positions = f.effect.mesh.geometry.getAttribute('position');
    for (let i = 0; i < DAWNFALL_FLOOR_LAYERS * 8 * 8 * 6; i++) {
      const floor = Math.max(1.5, terrain(positions.getX(i)));
      expect(positions.getY(i) - floor).toBeGreaterThan(0.12);
    }
    f.effect.dispose();
  });
  it('pulls ground-lying layers toward the camera in depth only', async () => {
    const f = fixture();
    await f.prepare();
    const shader = f.effect.mesh.material.vertexShader;
    expect(shader).toContain('groundPulledView');
    expect(shader).toMatch(/grounded\?0\.40:0\.0/);
    f.effect.dispose();
  });
  it('withdraws only a just-spawned cast when its Dawnfall pronounces a Verdict', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(1, 6);
    f.effect.update(0.3, false);
    // An older cast from the same caster is already showing and stays.
    f.effect.withdraw(1);
    f.effect.update(0.01, false);
    expect(f.effect.mesh.geometry.drawRange.count).toBe(DAWNFALL_VERTICES);
    f.effect.clear();
    f.effect.spawn(1, 6);
    f.effect.withdraw(2);
    f.effect.withdraw(1);
    f.effect.update(0.05, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it('brings a vertical beam down to the grounded impact as the hammer reaches its raise', () => {
    const beam = { top: 0, bottom: 0, alpha: 0 };
    sampleDawnfallBeam(0.02, false, beam);
    const high = beam.bottom;
    sampleDawnfallBeam(0.08, false, beam);
    expect(beam.bottom).toBeLessThan(high);
    sampleDawnfallBeam(DAWNFALL_BEAM_LANDING, false, beam);
    expect(beam.bottom).toBeCloseTo(0.12);
    expect(beam.top).toBe(8.5);
    expect(beam.alpha).toBeGreaterThan(0);
    sampleDawnfallBeam(0.6, false, beam);
    expect(beam.alpha).toBe(0);
    sampleDawnfallBeam(0.02, true, beam);
    expect(beam.bottom).toBe(0.12);
  });
  it('staggers three distinct crests inside the footprint and retires them within the cast', () => {
    const point = { radius: 0, height: 0, alpha: 0 };
    let previousRadius = Infinity;
    for (let crest = 0; crest < DAWNFALL_WAVE_CRESTS; crest++) {
      sampleDawnfallWave(0.18, 10, false, point, crest);
      expect(point.alpha).toBeGreaterThan(0);
      expect(point.radius).toBeLessThan(previousRadius);
      expect(point.radius * 1.03).toBeLessThan(10);
      previousRadius = point.radius;
      sampleDawnfallWave(crest * 0.055 - 0.001, 10, false, point, crest);
      expect(point.alpha).toBe(0);
      sampleDawnfallWave(DAWNFALL_DURATION - DAWNFALL_BEAM_LANDING, 10, false, point, crest);
      expect(point.alpha).toBe(0);
      sampleDawnfallWave(0.18, 10, true, point, crest);
      const heldRadius = point.radius;
      sampleDawnfallWave(0.4, 10, true, point, crest);
      expect(point.radius).toBe(heldRadius);
    }
  });
  it('sweeps a raised crest within the footprint then collapses, with a stationary reduced-motion form', () => {
    const point = { radius: 0, height: 0, alpha: 0 };
    for (const radius of [6, 10]) {
      sampleDawnfallWave(-0.01, radius, false, point);
      expect(point.alpha).toBe(0);
      let previous = 0;
      for (const age of [0, 0.06, 0.15, 0.3, 0.5]) {
        sampleDawnfallWave(age, radius, false, point);
        expect(point.radius).toBeGreaterThanOrEqual(previous);
        expect(point.radius * 1.03).toBeLessThan(radius);
        expect(Number.isFinite(point.height)).toBe(true);
        previous = point.radius;
      }
      expect(point.alpha).toBe(0);
      sampleDawnfallWave(0.15, radius, false, point);
      const peak = point.height;
      sampleDawnfallWave(0.3, radius, false, point);
      expect(point.height).toBeLessThan(peak);
      sampleDawnfallWave(0.06, radius, true, point);
      const heldHeight = point.height,
        heldRadius = point.radius;
      expect(point.alpha).toBeGreaterThan(0);
      sampleDawnfallWave(0.3, radius, true, point);
      expect(point.height).toBe(heldHeight);
      expect(point.radius).toBe(heldRadius);
    }
    expect(dawnfallRadius(Number.NaN)).toBe(6);
    expect(dawnfallRadius(Infinity)).toBe(6);
    expect(dawnfallRadius(-2)).toBe(0.1);
  });
});

describe('Dawnfall detail tiers', () => {
  // Shader shapes (dawnfall.ts SHAPE).
  const EMBLEM_CORE = 6,
    RING = 3,
    BEAM = 2,
    FLARE = 4,
    POOL = 9,
    EMBLEM_GLOW = 5,
    FLASH = 10,
    EMBER = 7,
    WAVE = 8,
    STREAK = 0;
  async function cast(detail: PaladinVfxDetail) {
    setPaladinVfxDetailForTest(detail);
    const f = fixture();
    await f.prepare();
    expect(f.effect.spawn(1, 6)).toBe(true);
    expect(f.effect.contact(2, 'damage')).toBe(true);
    // A running cast keeps the shape it spawned with.
    setPaladinVfxDetailForTest('full');
    // Early in the fall, while the victim's contact still plays.
    f.effect.update(0.05, false);
    const geometry = f.effect.mesh.geometry;
    const shapes = geometry.getAttribute('aShape');
    const quads = new Map<number, number>();
    for (let i = 0; i < geometry.drawRange.count; i += 6)
      quads.set(shapes.getX(i), (quads.get(shapes.getX(i)) ?? 0) + 1);
    const vertices = geometry.drawRange.count;
    let frames = 0;
    while (f.effect.mesh.visible && frames < 100) {
      f.effect.update(0.02, false);
      frames++;
    }
    f.effect.dispose();
    return { quads, frames, vertices };
  }

  it('keeps the rune circle and the pillar core on every tier and thins the rest', async () => {
    const full = await cast('full');
    const light = await cast('light');
    const minimal = await cast('minimal');
    const floor = 8 * 8;
    for (const tier of [full, light, minimal]) {
      expect(tier.quads.get(EMBLEM_CORE)).toBe(floor);
      expect(tier.quads.get(RING)).toBe(floor);
      expect(tier.quads.get(BEAM) ?? 0).toBeGreaterThanOrEqual(1);
      expect(tier.quads.get(FLARE) ?? 0).toBeGreaterThanOrEqual(1);
    }
    expect(full.quads.get(BEAM)).toBe(2);
    expect(full.quads.get(FLASH)).toBe(floor);
    expect(full.quads.get(FLARE)).toBe(2);
    // Light: the pool, the emblem glow, the wide pillar and the crests stay;
    // the flash, the landing flare and half the embers go.
    expect(light.quads.get(POOL)).toBe(floor);
    expect(light.quads.get(EMBLEM_GLOW)).toBe(floor);
    expect(light.quads.get(BEAM)).toBe(2);
    expect(light.quads.get(WAVE)).toBe(full.quads.get(WAVE));
    expect(light.quads.has(FLASH)).toBe(false);
    expect(light.quads.get(FLARE)).toBe(1);
    expect(light.quads.get(EMBER) ?? 0).toBeLessThan(full.quads.get(EMBER) ?? 0);
    expect(light.quads.get(STREAK)).toBe(1);
    expect(full.quads.get(STREAK)).toBe(2);
    // Minimal: only the core and a few embers.
    for (const shape of [POOL, EMBLEM_GLOW, FLASH, WAVE])
      expect(minimal.quads.has(shape)).toBe(false);
    expect(minimal.quads.get(BEAM)).toBe(1);
    expect(minimal.quads.get(EMBER) ?? 0).toBeGreaterThan(0);
    expect(minimal.quads.get(EMBER) ?? 0).toBeLessThan(light.quads.get(EMBER) ?? 0);
    expect(light.vertices).toBeLessThan(full.vertices);
    expect(minimal.vertices).toBeLessThan(light.vertices);
    // Shorter fade tails end the lighter casts sooner.
    expect(light.frames).toBeLessThan(full.frames);
    expect(minimal.frames).toBeLessThan(light.frames);
  });
});

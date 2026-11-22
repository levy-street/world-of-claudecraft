import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  SUN_VERDICT_LANCE_DISSOLVE,
  SUN_VERDICT_LANCE_HOVER,
  SUN_VERDICT_LANCE_WAIT,
  SunVerdictLance,
} from '../src/render/ability_vfx/sun_verdict_lance';
import {
  SUN_VERDICT_LANCE_CAPACITY,
  SUN_VERDICT_LANCE_DURATION,
  SUN_VERDICT_LANCE_EMBED,
  SUN_VERDICT_LANCE_LANDING,
  sunVerdictLanceTip,
} from '../src/render/paladin_sun_verdict_core';

function fixture() {
  const scene = new THREE.Scene();
  // Feet (height 0) stand on the terrain; body anchors sit far above it.
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) =>
    id < 0 ? null : (out?.set(id, height === 0 ? 3 : 90, 4) ?? null),
  );
  const impact = vi.fn();
  const effect = new SunVerdictLance(scene, anchor, () => 3, undefined, impact);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  /** The lowest point drawn this frame, and whether the sword itself shows. */
  const drawn = () => {
    const g = effect.mesh.geometry;
    const positions = g.getAttribute('position');
    const shapes = g.getAttribute('aShape');
    const alphas = g.getAttribute('aAlpha');
    let swordMinY = Infinity;
    const shapeSet = new Set<number>();
    for (let i = 0; i < g.drawRange.count; i++) {
      if (alphas.getX(i) <= 0) continue;
      shapeSet.add(shapes.getX(i));
      if (shapes.getX(i) === 0) swordMinY = Math.min(swordMinY, positions.getY(i));
    }
    return { swordMinY, shapes: shapeSet };
  };
  return {
    effect,
    scene,
    anchor,
    impact,
    drawn,
    prepare: async () => {
      for (const u of effect.preparation.units(host)) await u.run();
    },
  };
}
describe('Solar Lance sentence', () => {
  it('releases all resources even when preparation cleanup throws', () => {
    const f = fixture();
    vi.spyOn(f.effect.preparation, 'dispose').mockImplementation(() => {
      throw new Error('detach');
    });
    const geometry = vi.spyOn(f.effect.mesh.geometry, 'dispose');
    const material = vi.spyOn(f.effect.mesh.material, 'dispose');
    expect(() => f.effect.dispose()).toThrow(AggregateError);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(f.effect.mesh.parent).toBeNull();
    expect(f.effect.spawn(1)).toBe(false);
    expect(() => f.effect.dispose()).not.toThrow();
  });
  it('descends monotonically and drives its point into the ground, a fixed reduced-motion sentence', () => {
    let last = Infinity;
    for (let i = 0; i <= Math.round(SUN_VERDICT_LANCE_LANDING * 100); i++) {
      const tip = sunVerdictLanceTip(i * 0.01, false);
      expect(tip).toBeLessThanOrEqual(last);
      last = tip;
    }
    expect(last).toBeCloseTo(-SUN_VERDICT_LANCE_EMBED);
    expect(sunVerdictLanceTip(SUN_VERDICT_LANCE_LANDING, false)).toBeCloseTo(
      -SUN_VERDICT_LANCE_EMBED,
    );
    expect(sunVerdictLanceTip(0, true)).toBe(sunVerdictLanceTip(0.6, true));
  });
  it('requires preparation, respects terrain, caps its pool and uploads only used prefixes', async () => {
    const f = fixture();
    expect(f.effect.spawn(2)).toBe(false);
    await f.prepare();
    expect(f.effect.spawn(-1)).toBe(false);
    for (let i = 0; i < SUN_VERDICT_LANCE_CAPACITY + 5; i++) {
      expect(f.effect.spawn(i + 1)).toBe(true);
      expect(f.effect.contact(i + 1, 'damage')).toBe(true);
    }
    f.effect.update(SUN_VERDICT_LANCE_LANDING + 0.05);
    const geometry = f.effect.mesh.geometry,
      count = geometry.drawRange.count;
    expect(count).toBeGreaterThan(0);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(count).toBeLessThanOrEqual(positions.count);
    let minY = Infinity;
    for (let i = 0; i < count; i++) {
      minY = Math.min(minY, positions.getY(i));
      expect(Number.isFinite(positions.getX(i))).toBe(true);
    }
    // The point is buried below the terrain.
    expect(minY).toBeCloseTo(3 - SUN_VERDICT_LANCE_EMBED);
    expect(positions.updateRanges[0].count).toBe(count * 3);
    expect(f.anchor.mock.calls.every((call) => call[2] instanceof THREE.Vector3)).toBe(true);
    f.effect.update(SUN_VERDICT_LANCE_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    f.effect.clear();
    f.effect.dispose();
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
    expect(f.effect.spawn(2)).toBe(false);
  });
  it('sizes the sentence seal to an area sentence and lands on a raised floor', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(2, 8);
    f.effect.contact(2, 'damage');
    f.effect.update(SUN_VERDICT_LANCE_LANDING + 0.1);
    const geometry = f.effect.mesh.geometry;
    const positions = geometry.getAttribute('position');
    const shapes = geometry.getAttribute('aShape');
    let sealX = 0;
    for (let i = 0; i < geometry.drawRange.count; i++)
      if (shapes.getX(i) === 3) sealX = Math.max(sealX, Math.abs(positions.getX(i) - 2));
    expect(sealX).toBeCloseTo(8);
    f.effect.clear();
    // Standing on a dock 1.5 yards above the terrain, the lance lands on the dock.
    f.anchor.mockImplementation((id: number, height: number, out?: THREE.Vector3) =>
      id < 0 ? null : (out?.set(id, height === 0 ? 4.5 : 90, 4) ?? null),
    );
    f.effect.spawn(2);
    f.effect.contact(2, 'absorb');
    f.effect.update(SUN_VERDICT_LANCE_LANDING + 0.1);
    let minY = Infinity;
    for (let i = 0; i < geometry.drawRange.count; i++) minY = Math.min(minY, positions.getY(i));
    expect(minY).toBeCloseTo(4.5 - SUN_VERDICT_LANCE_EMBED);
    f.effect.dispose();
  });
  it('holds its strike until the damage is confirmed, and strikes once on it', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(2);
    // Waiting: it falls only as far as its hover, clear of the target.
    for (let i = 0; i < 5; i++) f.effect.update(0.05);
    expect(f.drawn().swordMinY).toBeGreaterThanOrEqual(3 + SUN_VERDICT_LANCE_HOVER - 1e-6);
    expect(f.impact).not.toHaveBeenCalled();
    // Confirmed late: the fall resumes from the hover and drives home.
    expect(f.effect.contact(2, 'damage')).toBe(true);
    expect(f.effect.contact(2, 'damage')).toBe(false);
    for (let i = 0; i < 8; i++) f.effect.update(0.05);
    expect(f.impact).toHaveBeenCalledOnce();
    expect(f.drawn().swordMinY).toBeCloseTo(3 - SUN_VERDICT_LANCE_EMBED);
    f.effect.dispose();
  });
  it('dissolves in the air when the target dies first and no damage comes', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(2);
    let lowest = Infinity;
    for (let t = 0; t < SUN_VERDICT_LANCE_WAIT + SUN_VERDICT_LANCE_DISSOLVE + 0.1; t += 0.05) {
      f.effect.update(0.05);
      const d = f.drawn();
      lowest = Math.min(lowest, d.swordMinY);
      // No pillar, flare, seal or sparks: nothing of the strike.
      for (const shape of [2, 3, 4, 6]) expect(d.shapes.has(shape)).toBe(false);
    }
    expect(lowest).toBeGreaterThanOrEqual(3 + SUN_VERDICT_LANCE_HOVER - 1e-6);
    expect(f.impact).not.toHaveBeenCalled();
    expect(f.effect.mesh.visible).toBe(false);
    // A damage arriving after it has gone strikes nothing.
    expect(f.effect.contact(2, 'damage')).toBe(false);
    f.effect.dispose();
  });
  it('dissolves at once on a sentence that dealt no damage, shards rising', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(2);
    expect(f.effect.contact(2, 'none')).toBe(true);
    f.effect.update(0.05);
    expect(f.drawn().shapes.has(7)).toBe(true);
    for (let i = 0; i < 10; i++) f.effect.update(0.05, true);
    expect(f.impact).not.toHaveBeenCalled();
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it('clears an active sentence without leaving geometry or replay state', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(2);
    f.effect.update(0.1, true);
    expect(f.effect.mesh.visible).toBe(true);
    f.effect.clear();
    f.effect.update(0);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
});
describe('Verdict authoritative VFX routing', () => {
  function fixture() {
    const fx = {
      sunVerdictLanceAt: vi.fn(),
      sunVerdictLanceContact: vi.fn(),
      dawnfallCast: vi.fn(),
      dawnfallSentenced: vi.fn(),
    };
    const receiveHit = vi.fn(),
      triggerAttack = vi.fn();
    const spawnAoeRing = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx, receiveHit, triggerAttack, spawnAoeRing },
      quality: 1,
      spawned: 0,
    }) as AbilityVfx;
    return { painter, fx, receiveHit, triggerAttack, spawnAoeRing };
  }
  const event = {
    sourceId: 1,
    targetId: 2,
    school: 'holy',
    ability: 'sun_gods_verdict',
    fx: 'paladinAscensionImpact',
  };
  it('drops only the Solar Sword for the single target sentence', () => {
    const f = fixture();
    expect(f.painter.handleSpellfx(event)).toBe(true);
    expect(f.fx.sunVerdictLanceAt).toHaveBeenCalledExactlyOnceWith(2);
    expect(f.fx.dawnfallCast).not.toHaveBeenCalled();
    expect(f.fx.dawnfallSentenced).not.toHaveBeenCalled();
  });
  it('plays only the larger Dawnfall at the target for an area sentence, with no lance', () => {
    const f = fixture();
    expect(f.painter.handleSpellfx({ ...event, range: 8 })).toBe(true);
    expect(f.fx.dawnfallSentenced).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.fx.dawnfallCast).toHaveBeenCalledExactlyOnceWith(2, 8);
    expect(f.fx.sunVerdictLanceAt).not.toHaveBeenCalled();
    expect(f.triggerAttack).not.toHaveBeenCalled();
    expect(
      f.painter.handleSpellfxAt({
        x: 2,
        z: 4,
        school: 'holy',
        fx: 'nova',
        ability: 'sun_gods_verdict',
        sourceId: 1,
        radius: 8,
      }),
    ).toBe(true);
    expect(f.fx.dawnfallCast).toHaveBeenCalledTimes(1);
    expect(f.fx.sunVerdictLanceAt).not.toHaveBeenCalled();
    // The area detonation keeps its draped ring at the true radius.
    expect(f.spawnAoeRing).toHaveBeenCalledOnce();
    expect(f.spawnAoeRing.mock.calls[0].slice(0, 3)).toEqual([2, 4, 8]);
  });
  it('keeps application and damage companions from adding generic explosions', () => {
    const f = fixture();
    expect(f.painter.handleSpellfx({ ...event, fx: 'wardBloom' })).toBe(true);
    expect(f.fx.sunVerdictLanceAt).not.toHaveBeenCalled();
    const damage = {
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      ability: 'Verdict of the Sun God',
      abilityId: 'sun_gods_verdict',
      kind: 'hit',
      crit: false,
      amount: 400,
    };
    expect(f.painter.onDamage(damage)).toBe(true);
    expect(f.receiveHit).toHaveBeenCalledExactlyOnceWith(2);
    expect(f.fx.sunVerdictLanceContact).toHaveBeenLastCalledWith(2, 'damage');
    f.painter.onDamage({ ...damage, kind: 'miss', amount: 0 });
    expect(f.receiveHit).toHaveBeenCalledTimes(1);
    expect(f.fx.sunVerdictLanceContact).toHaveBeenLastCalledWith(2, 'none');
    f.painter.onDamage({ ...damage, amount: 0, absorbed: 400 });
    expect(f.fx.sunVerdictLanceContact).toHaveBeenLastCalledWith(2, 'absorb');
    expect(f.receiveHit).toHaveBeenCalledTimes(1);
  });
});

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import {
  RECALL_ARRIVAL_DURATION,
  RECALL_CIRCLE_RADIUS,
  RECALL_PENDING_SECONDS,
  RECALL_RELEASE_DURATION,
  RecallTheFallen,
} from '../src/render/ability_vfx/recall_the_fallen';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';

function fixture() {
  const scene = new THREE.Scene();
  // Caster 1 stands at the origin, the fallen 2 lies 8 yards away; feet on y 3.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [8, 0]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], 3 + height * 2, at[1]) : null;
  });
  const effect = new RecallTheFallen(scene, anchor, () => 3);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  return {
    effect,
    scene,
    where,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
    shapes: () => {
      const g = effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const seen = new Set<number>();
      for (let i = 0; i < g.drawRange.count; i++) seen.add(Math.round(shape.getX(i)));
      return seen;
    },
  };
}

function step(effect: RecallTheFallen, seconds: number): void {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) effect.update(0.05);
}

// Node runs at the Medium preset: pin the authored composition.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Recall the Fallen rite', () => {
  it('writes the rite around the body while cast and lets it go when the cast stops', async () => {
    const f = fixture();
    f.effect.channel(1, 2, 0.5);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    await f.prepare();
    f.effect.channel(1, 2, 0.5);
    f.effect.update(0.05);
    // Circle, light shaft, motes and hand glow, and the thread to the fallen.
    expect(f.shapes()).toEqual(new Set([0, 1, 2, 5]));
    const g = f.effect.mesh.geometry;
    const position = g.getAttribute('position');
    const shape = g.getAttribute('aShape');
    let reach = 0;
    for (let i = 0; i < g.drawRange.count; i++)
      if (Math.round(shape.getX(i)) === 0) reach = Math.max(reach, Math.abs(position.getX(i) - 8));
    expect(reach).toBeCloseTo(RECALL_CIRCLE_RADIUS);
    for (let i = 0; i < g.drawRange.count * 3; i++)
      expect(Number.isFinite(position.array[i])).toBe(true);
    // No refresh: the rite fades out on its own.
    step(f.effect, 0.5);
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.effect.listening()).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('blazes at completion and sends the soul to the caster, then greets the return', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.channel(1, 2, 0.99);
    f.effect.update(0.05);
    expect(f.effect.release(1, 2)).toBe(true);
    // The group rite may report the same body again: still one soul.
    expect(f.effect.releaseAt(1, 8, 0)).toBe(true);
    f.effect.update(0.05);
    expect(f.effect.listening()).toBe(true);
    expect(f.shapes().has(3)).toBe(true);
    step(f.effect, RECALL_RELEASE_DURATION);
    // The fallen accepts and stands at the caster's side; their view may lag a frame.
    f.effect.watch(2, true);
    f.effect.watch(2, false);
    f.effect.update(0.05);
    f.where.set(2, [0.6, 0]);
    f.effect.update(0.05);
    step(f.effect, 0.2);
    // Pillar, ring, halo, motes and feathers over the returned.
    expect(f.shapes()).toEqual(new Set([0, 1, 2, 4]));
    expect(f.effect.listening()).toBe(false);
    step(f.effect, RECALL_ARRIVAL_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('ignores returns far from the caster and forgets an unanswered offer', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.release(1, 2);
    step(f.effect, 1.5);
    f.where.set(2, [40, 0]);
    f.effect.watch(2, true);
    f.effect.watch(2, false);
    step(f.effect, 0.6);
    expect(f.shapes().has(4)).toBe(false);
    expect(f.effect.listening()).toBe(true);
    step(f.effect, RECALL_PENDING_SECONDS);
    expect(f.effect.listening()).toBe(false);
    f.effect.dispose();
  });
});

describe('Recall the Fallen routing', () => {
  it('claims the cast and both completion cues for the rite', () => {
    const fx = { recallTheFallenRelease: vi.fn(), recallTheFallenReleaseAt: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx },
      releaseGesture,
    }) as AbilityVfx;
    const base = { sourceId: 1, targetId: 2, school: 'holy', ability: 'recall_the_fallen' };
    expect(p.handleSpellfx({ ...base, fx: 'selfCast' })).toBe(true);
    expect(releaseGesture).toHaveBeenCalledOnce();
    expect(p.handleSpellfx({ ...base, fx: 'temporalGlyph' })).toBe(true);
    expect(fx.recallTheFallenRelease).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(
      p.handleSpellfxAt({
        x: 5,
        z: 6,
        school: 'holy',
        fx: 'nova',
        sourceId: 1,
        radius: 2,
        ability: 'recall_the_fallen',
      }),
    ).toBe(true);
    expect(fx.recallTheFallenReleaseAt).toHaveBeenCalledExactlyOnceWith(1, 5, 6);
  });
});

describe('Recall the Fallen detail', () => {
  /** Quads drawn this frame, by shape (0 ground, 1 beam, 2 flare, 3 spark,
   * 4 feather, 5 thread). */
  const counts = (effect: RecallTheFallen) => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const out = new Map<number, number>();
    for (let i = 0; i < g.drawRange.count; i += 6) {
      const s = Math.round(shape.getX(i));
      out.set(s, (out.get(s) ?? 0) + 1);
    }
    return out;
  };
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  /** The whole rite at `detail`: the cast, the release, and the return. */
  const rite = async (detail: PaladinVfxDetail) => {
    const f = fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    f.effect.channel(1, 2, 0.6);
    // A later detail change never reshapes a running rite.
    setPaladinVfxDetailForTest('full');
    f.effect.update(0.05);
    const cast = counts(f.effect);
    f.effect.channel(1, 2, 0.99);
    setPaladinVfxDetailForTest(detail);
    f.effect.release(1, 2);
    setPaladinVfxDetailForTest('full');
    f.effect.update(0.05);
    const release = counts(f.effect);
    step(f.effect, RECALL_RELEASE_DURATION);
    // The return is greeted from the frame loop: it reads the ambient detail.
    setPaladinVfxDetailForTest(detail);
    f.effect.watch(2, true);
    f.effect.watch(2, false);
    f.where.set(2, [0.6, 0]);
    f.effect.update(0.05);
    setPaladinVfxDetailForTest('full');
    step(f.effect, 0.2);
    const arrival = counts(f.effect);
    let tail = 0;
    while (f.effect.mesh.visible && tail < 3) {
      f.effect.update(0.02);
      tail += 0.02;
    }
    f.effect.dispose();
    return { cast, release, arrival, tail };
  };

  it('writes, releases and greets with the same rite thinner at light and minimal', async () => {
    const full = await rite('full');
    const light = await rite('light');
    const minimal = await rite('minimal');
    // Core on every tier: the rune circle, the thread from the hands, the
    // soul's flight, and on the return the rune ring and the halo.
    for (const d of [full, light, minimal]) {
      expect(d.cast.get(0)).toBe(1);
      expect(d.cast.get(5) ?? 0).toBeGreaterThan(0);
      expect(d.release.get(0)).toBe(1);
      expect(d.release.get(2) ?? 0).toBeGreaterThanOrEqual(1);
      expect(d.arrival.get(0)).toBe(2);
    }
    // Full: the light on the body, the release flare and sparks, the soul's
    // trail, and the pillar, flare and feathers of the return.
    expect(full.cast.get(1)).toBe(1);
    expect(full.release.get(3)).toBe(13);
    expect(full.arrival.get(1)).toBe(1);
    expect(full.arrival.get(4) ?? 0).toBeGreaterThan(0);
    // Light keeps the shaft, the soul's trail, the pillar and the feathers,
    // drops the release sparks and thins the motes.
    expect(light.cast.get(1)).toBe(1);
    expect(light.release.get(3)).toBe(1);
    expect(light.arrival.get(1)).toBe(1);
    expect(light.arrival.get(4)).toBe(full.arrival.get(4));
    expect(light.cast.get(2) ?? 0).toBeLessThan(full.cast.get(2) ?? 0);
    expect(light.arrival.get(2) ?? 0).toBeLessThan(full.arrival.get(2) ?? 0);
    // Minimal: the core alone.
    expect(minimal.cast.get(1)).toBeUndefined();
    expect(minimal.release.get(1)).toBeUndefined();
    expect(minimal.release.get(3)).toBeUndefined();
    expect(minimal.arrival.get(1)).toBeUndefined();
    expect(minimal.arrival.get(4)).toBeUndefined();
    expect(minimal.cast.get(2) ?? 0).toBeLessThan(light.cast.get(2) ?? 0);
    for (const k of ['cast', 'release', 'arrival'] as const) {
      expect(total(light[k])).toBeLessThan(total(full[k]));
      expect(total(minimal[k])).toBeLessThan(total(light[k]));
    }
    // The return fades sooner.
    expect(light.tail).toBeLessThan(full.tail);
    expect(minimal.tail).toBeLessThan(light.tail);
  });
});

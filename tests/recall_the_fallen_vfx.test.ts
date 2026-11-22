import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  RECALL_ARRIVAL_DURATION,
  RECALL_CIRCLE_RADIUS,
  RECALL_PENDING_SECONDS,
  RECALL_RELEASE_DURATION,
  RecallTheFallen,
} from '../src/render/ability_vfx/recall_the_fallen';

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

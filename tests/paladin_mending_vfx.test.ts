import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  LAST_RITE_DURATION,
  LAST_RITE_WINDUP,
  MENDING_CROWN_LIFT,
  MENDING_DURATION,
  MENDING_GATHER_DONE,
  MENDING_GATHER_PLUSES,
  MENDING_TRAVEL,
  PaladinMending,
} from '../src/render/ability_vfx/paladin_mending';

function fixture() {
  const scene = new THREE.Scene();
  // The Paladin (1) at the origin, the ally (2) 8 yards away.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [0, 8]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], height * 1.8, at[1]) : null;
  });
  const effect = new PaladinMending(scene, anchor, () => 0);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const shapes = () => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const seen = new Set<number>();
    for (let i = 0; i < g.drawRange.count; i += 6) seen.add(shape.getX(i));
    return seen;
  };
  return {
    effect,
    scene,
    shapes,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

function step(effect: PaladinMending, seconds: number): void {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) effect.update(0.05);
}

describe('Mending Light', () => {
  it('charges light and pluses over the head through the cast, and lets go when it stops', async () => {
    const f = fixture();
    f.effect.channel(1, 0.5);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    await f.prepare();
    f.effect.channel(1, 0.5);
    f.effect.update(0.05);
    // A flare and pluses (the sigil and those spiralling in).
    expect(f.shapes()).toEqual(new Set([0, 1]));
    // The charge hangs over the Paladin's head (top 1.8), not in a hand.
    const g = f.effect.mesh.geometry;
    const position = g.getAttribute('position');
    const shape = g.getAttribute('aShape');
    let flare = 0;
    while (shape.getX(flare) !== 0) flare += 6;
    let y = 0;
    for (let i = flare; i < flare + 6; i++) y += position.getY(i) / 6;
    expect(y).toBeCloseTo(1.8 + MENDING_CROWN_LIFT);
    step(f.effect, 0.5);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('grows the big plus smoothly at 60 fps though the cast only updates each sim tick', async () => {
    const f = fixture();
    await f.prepare();
    // The big plus is the last plus drawn; its half-size from two corners.
    const bigPlus = () => {
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const pos = g.getAttribute('position');
      let at = -1;
      for (let i = 0; i < g.drawRange.count; i += 6) if (shape.getX(i) === 1) at = i;
      return (
        Math.hypot(
          pos.getX(at + 1) - pos.getX(at),
          pos.getY(at + 1) - pos.getY(at),
          pos.getZ(at + 1) - pos.getZ(at),
        ) / 2
      );
    };
    let last = 0,
      progress = 0;
    for (let frame = 0; frame < 80; frame++) {
      // 20 Hz ticks: the cast's progress moves every third frame.
      if (frame % 3 === 0) progress = Math.min(1, progress + 0.05 / 1.5);
      f.effect.channel(1, progress);
      f.effect.update(1 / 60);
      const size = bigPlus();
      if (frame > 10) {
        expect(size - last).toBeGreaterThan(-0.002);
        expect(size - last).toBeLessThan(0.012);
      }
      last = size;
    }
    f.effect.dispose();
  });

  it('absorbs every smaller plus into the growing one before the cast completes', async () => {
    const f = fixture();
    await f.prepare();
    const pluses = () => {
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      let n = 0;
      for (let i = 0; i < g.drawRange.count; i += 6) if (shape.getX(i) === 1) n++;
      return n;
    };
    // A 1.5 s cast, frame by frame: a swarm spirals in, and from just past
    // MENDING_GATHER_DONE only the big plus is left to fire.
    let most = 0;
    for (let t = 0.05; t <= 1.5 + 1e-6; t += 0.05) {
      f.effect.channel(1, Math.min(1, t / 1.5));
      f.effect.update(0.05);
      most = Math.max(most, pluses() - 1);
      if (t / 1.5 >= MENDING_GATHER_DONE + 0.05) expect(pluses()).toBe(1);
    }
    expect(most).toBeGreaterThanOrEqual(6);
    expect(most).toBeLessThanOrEqual(MENDING_GATHER_PLUSES);
    f.effect.dispose();
  });

  it('streams to the ally, then blooms a plus sigil with threads spiralling up around them', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.effect.mend(1, 2)).toBe(true);
    f.effect.update(0.05);
    // The stream (ribbon) with pluses riding it.
    expect(f.shapes().has(3)).toBe(true);
    expect(f.shapes().has(1)).toBe(true);
    step(f.effect, MENDING_TRAVEL + 0.3);
    // The bloom on the ally: ring, plus sigil and mending threads.
    const bloom = f.shapes();
    expect(bloom.has(2)).toBe(true);
    expect(bloom.has(1)).toBe(true);
    expect(bloom.has(3)).toBe(true);
    step(f.effect, MENDING_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('on the Paladin themself, blooms without a stream', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.mend(1, 1);
    f.effect.update(0.05);
    expect(f.shapes().has(2)).toBe(true);
    f.effect.dispose();
  });
});

describe('Last Rite', () => {
  it('gathers in the off-hand, beams to the ally, crowns them with a halo of pluses over the rune sigil', async () => {
    const f = fixture();
    expect(f.effect.rite(1, 2)).toBe(false);
    await f.prepare();
    expect(f.effect.rite(1, -1)).toBe(false);
    expect(f.effect.rite(1, 2)).toBe(true);
    f.effect.update(0.1);
    // First only the light gathering in the raised off-hand.
    expect(f.shapes()).toEqual(new Set([0, 1]));
    step(f.effect, LAST_RITE_WINDUP);
    const opening = f.shapes();
    // Beam and pillar, the halo, the ground sigil (Faithwarden's while the
    // caster's spec is unknown).
    for (const shape of [4, 5, 7]) expect(opening.has(shape)).toBe(true);
    step(f.effect, 0.5);
    expect(f.shapes().has(1)).toBe(true);
    step(f.effect, LAST_RITE_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it("writes the caster's own spec emblem in the sigil at the ally's feet", async () => {
    const sigil = async (spec?: string) => {
      const f = fixture();
      await f.prepare();
      f.effect.rite(1, 2, spec);
      step(f.effect, LAST_RITE_WINDUP + 0.1);
      const found = [...f.shapes()].filter((s) => s >= 6);
      f.effect.dispose();
      return found;
    };
    expect(await sigil('holy')).toEqual([6]);
    expect(await sigil('protection')).toEqual([7]);
    expect(await sigil('retribution')).toEqual([8]);
    expect(await sigil()).toEqual([7]);
  });

  it('claims both casts so only the authored art plays', () => {
    const fx = { mendingLight: vi.fn(), lastRite: vi.fn(), castPaladinShieldSigil: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx },
      releaseGesture,
    }) as AbilityVfx;
    const base = { sourceId: 1, targetId: 2, school: 'holy', fx: 'selfCast' };
    expect(p.handleSpellfx({ ...base, ability: 'holy_light' })).toBe(true);
    expect(p.handleSpellfx({ ...base, ability: 'lay_on_hands' })).toBe(true);
    expect(fx.mendingLight).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(fx.lastRite).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(releaseGesture).toHaveBeenCalledTimes(2);
    // Both cast with the off-hand sigil.
    expect(fx.castPaladinShieldSigil).toHaveBeenCalledTimes(2);
  });
});

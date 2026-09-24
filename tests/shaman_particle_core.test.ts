import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isShamanParticleKind,
  type ShamanParticleKind,
  type ShamanParticleSample,
  writeShamanParticleSample,
} from '../src/render/shaman_particle_core';
import { Vfx } from '../src/render/vfx';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));
const kinds: ShamanParticleKind[] = [
  'shaman_sparks',
  'shaman_embers',
  'shaman_grit',
  'shaman_mist',
  'shaman_droplets',
  'shaman_runoff',
];
const sample = (): ShamanParticleSample => ({
  vx: 0,
  vy: 0,
  vz: 0,
  size: 0,
  lifetime: 0,
  gravity: 0,
  rotation: 0,
  brightness: 0,
  sprite: 'trace',
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function rig(quality = 1) {
  const context = {
    fillRect() {},
    drawImage() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const vfx = new Vfx(new THREE.Scene(), () => null);
  const state = vfx as unknown as {
    quality: number;
    size: Float32Array;
    life: Float32Array;
    vel: Float32Array;
    col: Float32Array;
    spriteAttr: Float32Array;
    rotAttr: Float32Array;
    activeCount: number;
  };
  state.quality = quality;
  return { vfx, state };
}
describe('Shaman particle punctuation', () => {
  it.each(kinds)(
    '%s keeps size independent from impact force while varying deterministic scatter',
    (kind) => {
      const a = sample(),
        b = sample(),
        again = sample();
      for (let i = 0; i < 100; i++) {
        expect(writeShamanParticleSample(a, kind, 13, i, 1)).toBe(true);
        expect(writeShamanParticleSample(b, kind, 13, i, 5)).toBe(true);
        expect(writeShamanParticleSample(again, kind, 13, i, 1)).toBe(true);
        expect(again).toEqual(a);
        expect(b.size).toBe(a.size);
        expect(b.lifetime).toBe(a.lifetime);
        expect(b.vx).toBeCloseTo(a.vx * 5);
        expect(b.vz).toBeCloseTo(a.vz * 5);
        const bounds =
          kind === 'shaman_mist'
            ? [0.25, 0.45]
            : kind === 'shaman_droplets' || kind === 'shaman_runoff'
              ? [0.07, 0.12]
              : kind === 'shaman_grit'
                ? i % 7 === 0
                  ? [0.23, 0.29]
                  : i % 7 < 3
                    ? [0.16, 0.22]
                    : [0.075, 0.14]
                : i % 5 === 0
                  ? [0.18, 0.24]
                  : [0.07, 0.14];
        expect(a.size).toBeGreaterThanOrEqual(bounds[0] ?? 0);
        expect(a.size).toBeLessThanOrEqual(bounds[1] ?? 1);
        expect(a.lifetime).toBeGreaterThanOrEqual(0.45);
        expect(a.lifetime).toBeLessThanOrEqual(0.8);
        if (kind === 'shaman_runoff') {
          expect(a.vy).toBeLessThan(0);
          expect(a.sprite).toBe('trace');
          expect(a.gravity).toBe(6.5);
        }
        if (kind === 'shaman_mist') {
          expect(a.sprite).toBe('smoke');
          expect(a.brightness).toBeGreaterThanOrEqual(0.1);
          expect(a.brightness).toBeLessThanOrEqual(0.2);
        }
        if (kind === 'shaman_grit') {
          expect(a.sprite).toBe('debris');
          expect(a.brightness).toBeGreaterThanOrEqual(0.65);
          expect(a.brightness).toBeLessThanOrEqual(1.05);
        }
      }
    },
  );
  it('rejects invalid inputs without changing the caller-owned scratch and honors authored lifetime', () => {
    const out = sample(),
      before = { ...out };
    for (const bad of [NaN, Infinity, -Infinity, -1])
      expect(writeShamanParticleSample(out, 'shaman_sparks', 1, 1, bad)).toBe(false);
    expect(out).toEqual(before);
    writeShamanParticleSample(out, 'shaman_droplets', 1, 1, 2, 0.17);
    expect(out.lifetime).toBe(0.17);
    writeShamanParticleSample(out, 'shaman_droplets', 1, 1, 2, 0);
    expect(out.lifetime).toBe(0.05);
    for (const generic of ['physical', 'fire', 'smoke', 'debris', 'sparks'])
      expect(isShamanParticleKind(generic)).toBe(false);
  });
  it.each(kinds)(
    '%s uses existing cloud with correct scaled counts, authored size bands and no ambient random calls',
    (kind) => {
      const { vfx, state } = rig(0.5);
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('Random Shaman burst');
      });
      try {
        vfx.burst(new THREE.Vector3(2, 3, 4), kind, 40, 4, 0xffffff, 0.37);
      } finally {
        random.mockRestore();
      }
      expect(state.activeCount).toBe(29);
      const expected = sample();
      for (let i = 0; i < 29; i++) {
        writeShamanParticleSample(expected, kind, 1, i, 4, 0.37);
        expect(state.size[i]).toBeCloseTo(expected.size);
        expect(state.life[i]).toBeCloseTo(0.37);
        expect(state.col[i * 3]).toBeCloseTo(expected.brightness);
        expect(state.spriteAttr[i]).toBe(
          { trace: 12, sparkle: 3, debris: 14, smoke: 11 }[expected.sprite],
        );
      }
      vfx.dispose();
    },
  );
  it('preserves the generic fire path and its established full-quality count', () => {
    const { vfx, state } = rig();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vfx.burst(new THREE.Vector3(), 'fire', 12, 2, 0xffffff, 0.6);
    expect(state.activeCount).toBe(12);
    expect(state.size[0]).toBeCloseTo(0.64);
    expect(state.spriteAttr[0]).toBe(10);
    expect(state.spriteAttr[1]).toBe(9);
    expect(state.life[0]).toBeCloseTo(0.6);
    vfx.dispose();
  });
});

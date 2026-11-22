import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Dawnfall } from '../src/render/ability_vfx/dawnfall';
import {
  PALADIN_FLASH_ONSET,
  PALADIN_FLASH_OTHERS,
  PALADIN_FLASH_PEAK,
  paladinFlash,
} from '../src/render/ability_vfx/paladin_flash';
import { TollingHammer } from '../src/render/ability_vfx/tolling_hammer';
import { ValkyrsCalling } from '../src/render/ability_vfx/valkyrs_calling';
import { DAWNFALL_BEAM_LANDING } from '../src/render/dawnfall_core';
import {
  ASCENSION_PILLAR_FADE,
  PaladinAscensionVisual,
} from '../src/render/paladin_ascension_visual';
import { TOLLING_DROP } from '../src/render/tolling_hammer_core';

const FRAME = 1 / 60;
const LOCAL = 1;
const OTHER = 2;
const isLocal = (id: number) => id === LOCAL;

type Pooled = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> };

/** The brightest vertex alpha of `shape` in the live draw range. */
function peakAlpha(effect: Pooled, shape: number): number {
  const geometry = effect.mesh.geometry;
  const shapes = geometry.getAttribute('aShape');
  const alphas = geometry.getAttribute('aAlpha');
  let peak = 0;
  for (let i = 0; i < geometry.drawRange.count; i++)
    if (shapes.getX(i) === shape) peak = Math.max(peak, alphas.getX(i));
  return peak;
}

function prepareHost() {
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  return {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
}

async function prepare(effect: {
  preparation: { units(host: ReturnType<typeof prepareHost>): { run(): unknown }[] };
}) {
  for (const unit of effect.preparation.units(prepareHost())) await unit.run();
}

describe('the shared Paladin flash limit', () => {
  it('builds over about three frames instead of opening at full, and peaks lower', () => {
    expect(paladinFlash(0)).toBe(0);
    expect(paladinFlash(Number.NaN)).toBe(0);
    // Frame 1 is a glimmer, frame 2 most of the way, frame 3 at the peak.
    expect(paladinFlash(FRAME)).toBeLessThan(PALADIN_FLASH_PEAK * 0.35);
    expect(paladinFlash(2 * FRAME)).toBeGreaterThan(paladinFlash(FRAME));
    expect(paladinFlash(2 * FRAME)).toBeLessThan(PALADIN_FLASH_PEAK);
    expect(PALADIN_FLASH_ONSET).toBeGreaterThanOrEqual(0.04);
    expect(PALADIN_FLASH_ONSET).toBeLessThanOrEqual(0.05);
    expect(paladinFlash(3 * FRAME)).toBeCloseTo(PALADIN_FLASH_PEAK, 6);
    expect(paladinFlash(5)).toBeCloseTo(PALADIN_FLASH_PEAK, 6);
    // 20 to 25% below the authored peak.
    expect(PALADIN_FLASH_PEAK).toBeGreaterThanOrEqual(0.75);
    expect(PALADIN_FLASH_PEAK).toBeLessThanOrEqual(0.8);
  });

  it("dims another player's flash further, and reads as local without a probe", () => {
    for (const age of [FRAME, 2 * FRAME, 0.3])
      expect(paladinFlash(age, false)).toBeCloseTo(paladinFlash(age, true) * 0.6, 6);
    expect(PALADIN_FLASH_OTHERS).toBe(0.6);
    expect(paladinFlash(0.3)).toBe(paladinFlash(0.3, true));
  });

  it("limits Dawnfall's landing flash and flare, dimmer for another player's cast", async () => {
    const anchor = (id: number, _frac: number, out?: THREE.Vector3) =>
      id < 0 ? null : (out?.set(id * 30, 0, 0) ?? null);
    const flashAt = async (owner: number, sinceLanding: number) => {
      const effect = new Dawnfall(new THREE.Scene(), anchor, undefined, () => 0, isLocal);
      await prepare(effect);
      effect.spawn(owner, 6);
      effect.update(DAWNFALL_BEAM_LANDING + sinceLanding, false);
      const out = { flash: peakAlpha(effect, 10), flare: peakAlpha(effect, 4) };
      effect.dispose();
      return out;
    };
    const first = await flashAt(LOCAL, 0.004);
    const settled = await flashAt(LOCAL, 0.05);
    expect(first.flare).toBeLessThan(settled.flare * 0.2);
    expect(first.flash).toBeLessThan(settled.flash * 0.2);
    const other = await flashAt(OTHER, 0.05);
    expect(other.flare / settled.flare).toBeCloseTo(PALADIN_FLASH_OTHERS, 4);
    expect(other.flash / settled.flash).toBeCloseTo(PALADIN_FLASH_OTHERS, 4);
  });

  it("limits Hammer of Wrath's strike flare and pillar, dimmer for another player's hammer", async () => {
    const anchor = (id: number, _frac: number, out?: THREE.Vector3) => {
      if (!out || id < 0) return null;
      return id === 9 ? out.set(6, 0, 0) : out.set(0, 0, id * 30);
    };
    const strike = async (source: number, sinceLanding: number) => {
      const effect = new TollingHammer(
        new THREE.Scene(),
        anchor,
        () => {},
        () => 0,
        undefined,
        undefined,
        isLocal,
      );
      await prepare(effect);
      expect(effect.contact(source, 9, 'damage')).toBe(true);
      effect.update(TOLLING_DROP + sinceLanding, false);
      const out = { flare: peakAlpha(effect, 3), pillar: peakAlpha(effect, 2) };
      effect.dispose();
      return out;
    };
    const first = await strike(LOCAL, 0.004);
    const settled = await strike(LOCAL, 0.05);
    expect(first.flare).toBeLessThan(settled.flare * 0.2);
    const other = await strike(OTHER, 0.05);
    expect(other.flare / settled.flare).toBeCloseTo(PALADIN_FLASH_OTHERS, 4);
    expect(other.pillar / settled.pillar).toBeCloseTo(PALADIN_FLASH_OTHERS, 4);
  });

  it("limits Valkyr's Calling's landing flare, dimmer for another player's slam", async () => {
    const anchor = (id: number, height: number, out?: THREE.Vector3) =>
      id < 0 ? null : (out?.set(id * 30, height * 2, 0) ?? null);
    const slam = async (source: number, sinceLanding: number) => {
      const effect = new ValkyrsCalling(
        new THREE.Scene(),
        anchor,
        () => 0,
        undefined,
        undefined,
        isLocal,
      );
      await prepare(effect);
      expect(effect.land(source, source * 30, 0, 8)).toBe(true);
      effect.update(sinceLanding, false);
      const flare = peakAlpha(effect, 4);
      effect.dispose();
      return flare;
    };
    const first = await slam(LOCAL, 0.004);
    const settled = await slam(LOCAL, 0.05);
    expect(first).toBeLessThan(settled * 0.2);
    expect((await slam(OTHER, 0.05)) / settled).toBeCloseTo(PALADIN_FLASH_OTHERS, 4);
  });

  it("limits Divine Ascension's column and bloom, and shortens the column's blaze", () => {
    const run = (local: boolean | undefined, steps: number[]) => {
      const visual = new PaladinAscensionVisual(1.8);
      const plan = { active: true, charges: 5, lastCharge: false, local };
      const pillar = visual.group.getObjectByName('paladin-ascension-pillar') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.ShaderMaterial
      >;
      // The halo rides the rider anchor (visual.crown); the column stays on the ground group.
      const halo = visual.crown.getObjectByName('paladin-ascension-halo') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.ShaderMaterial
      >;
      const seen: { pillar: number; bloom: number }[] = [];
      for (const dt of steps) {
        visual.update(plan, dt, false);
        seen.push({
          pillar: pillar.material.uniforms.uAlpha.value,
          bloom: halo.material.uniforms.uFlash.value,
        });
      }
      visual.dispose();
      return seen;
    };
    // Frame 0 opens dark, then the column builds over the next frames.
    const own = run(undefined, [0, FRAME, FRAME, FRAME, 0.2]);
    expect(own[0].pillar).toBe(0);
    expect(own[0].bloom).toBe(0);
    expect(own[1].pillar).toBeLessThan(own[3].pillar * 0.35);
    expect(own[3].pillar).toBeCloseTo(0.6 * PALADIN_FLASH_PEAK, 6);
    expect(own[3].bloom).toBeCloseTo(PALADIN_FLASH_PEAK, 6);
    const other = run(false, [0, FRAME, FRAME, FRAME]);
    expect(other[3].pillar / own[3].pillar).toBeCloseTo(PALADIN_FLASH_OTHERS, 6);
    // Its blaze is short: well under half by 0.4 s, gone by ASCENSION_PILLAR_FADE.
    const blaze = run(true, [0, 0.4, ASCENSION_PILLAR_FADE - 0.4]);
    expect(blaze[1].pillar).toBeLessThan(0.6 * PALADIN_FLASH_PEAK * 0.5);
    expect(blaze[2].pillar).toBe(0);
  });
});

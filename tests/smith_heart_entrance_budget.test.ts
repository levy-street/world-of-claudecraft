// The Smith's Heart entrances' shared per-tier budget
// (src/render/smith_heart_fx/entrance_budget_core.ts): the numbers pinned,
// the tier read off the static preset, and every entrance painter built on
// both tiers held to it: its particle pools under the ceiling, no light, no
// shadow caster, and every cosmetic double it names really one of its meshes.
// The per-painter "never drawn on low" plays live beside each scene's own
// tests (smith_heart_breath_entrance, _council_entrance, _heat_entrance,
// _final_arrival).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { BREATH_ENTRANCE_LOW_SHARE } from '../src/render/smith_heart_fx/breath_entrance_core';
import { BreathEntranceFx } from '../src/render/smith_heart_fx/breath_entrance_fx';
import { COUNCIL_ENTRANCE_LOW_SHARE } from '../src/render/smith_heart_fx/council_entrance_core';
import { CouncilEntranceFx } from '../src/render/smith_heart_fx/council_entrance_fx';
import { entranceBudgetNow } from '../src/render/smith_heart_fx/entrance_budget';
import {
  ENTRANCE_SECONDARY_LAYERS,
  entranceBudget,
  entranceParticleCeiling,
  SMITH_HEART_ENTRANCE_LOW_SHARE,
  SMITH_HEART_ENTRANCES,
  type SmithHeartEntrance,
} from '../src/render/smith_heart_fx/entrance_budget_core';
import { FinalFx } from '../src/render/smith_heart_fx/final_fx';
import { ENTRANCE_LOW_SHARE as HEAT_LOW_SHARE } from '../src/render/smith_heart_fx/heat_entrance_core';
import { HeatEntranceFx } from '../src/render/smith_heart_fx/heat_entrance_fx';
import { QUENCH_ENTRANCE_LOW_SHARE } from '../src/render/smith_heart_fx/quench_entrance_core';
import { QuenchEntranceFx } from '../src/render/smith_heart_fx/quench_entrance_fx';
import {
  ENGINE_POOL_RINGS,
  ENGINE_POOL_SLACK,
} from '../src/render/trash_engine_fx/engine_particles';

describe('the entrances budget table', () => {
  it('pins the low tier and the full tiers', () => {
    expect(SMITH_HEART_ENTRANCE_LOW_SHARE).toBe(0.4);
    for (const e of SMITH_HEART_ENTRANCES) {
      expect(entranceBudget(e, 'low')).toEqual({
        detail: false,
        share: 0.4,
        secondary: false,
        particleCeiling: 1736,
        addedLights: 0,
        shadowCasters: 0,
      });
      for (const tier of ['medium', 'high', 'ultra'] as const)
        expect(entranceBudget(e, tier)).toEqual({
          detail: true,
          share: 1,
          secondary: true,
          particleCeiling: 3956,
          addedLights: 0,
          shadowCasters: 0,
        });
    }
  });

  it('the ceiling is the engine pools summed at the share', () => {
    // One source: the rings EngineParticles really builds.
    const rings = Object.values(ENGINE_POOL_RINGS);
    expect(rings).toHaveLength(4);
    for (const share of [1, 0.4])
      expect(entranceParticleCeiling(share)).toBe(
        rings.reduce((n, r) => n + Math.round(r * share) + ENGINE_POOL_SLACK, 0),
      );
    // smoke 1200, glow 1200, soulfire 700, pyre 600, each with 64 of slack.
    expect(entranceParticleCeiling(1)).toBe(3700 + 4 * 64);
    expect(entranceParticleCeiling(0.4)).toBe(480 + 480 + 280 + 240 + 4 * 64);
    expect(entranceParticleCeiling(0.4)).toBeLessThan(entranceParticleCeiling(1) / 2);
  });

  it('every scene core thins by the one shared low share', () => {
    for (const share of [
      BREATH_ENTRANCE_LOW_SHARE,
      COUNCIL_ENTRANCE_LOW_SHARE,
      HEAT_LOW_SHARE,
      QUENCH_ENTRANCE_LOW_SHARE,
    ])
      expect(share).toBe(SMITH_HEART_ENTRANCE_LOW_SHARE);
  });

  it('names a cosmetic double for every scene that sheds one, never a beat', () => {
    expect(Object.keys(ENTRANCE_SECONDARY_LAYERS).sort()).toEqual(
      [...SMITH_HEART_ENTRANCES].sort(),
    );
    const all = Object.values(ENTRANCE_SECONDARY_LAYERS).flat();
    expect(new Set(all).size).toBe(all.length);
    // The beats every tier keeps: the flashes, the funnel's shell and heart,
    // the column, the beam, the bodies' set pieces, the embers' fire.
    for (const beat of [
      'smithHeartBreathEntranceFunnel',
      'smithHeartBreathEntranceFunnelHeart',
      'smithHeartBreathEntranceEye',
      'smithHeartBreathEntranceFlash',
      'smithHeartCouncilEntranceFlash',
      'smithHeartCouncilEntranceSlabs',
      'smithHeartHeatEntranceColumn',
      'smithHeartHeatEntranceEmbers',
      'smithHeartHeatEntranceEmbersGlow',
      'smithHeartHeatEntranceFlash',
      'smithHeartQuenchEntranceBurst',
      'smithHeartArrivalCore',
      'smithHeartArrivalSwirl',
    ])
      expect(all).not.toContain(beat);
  });
});

describe('the entrance painters hold to it', () => {
  const ROOTS: Record<SmithHeartEntrance, string> = {
    council: 'smith-heart-council-entrance',
    breath: 'smith-heart-breath-entrance',
    quench: 'smith-heart-quench-entrance',
    heat: 'smith-heart-heat-entrance',
    final: 'smith-heart-final-fx',
  };
  function build(entrance: SmithHeartEntrance): {
    root: THREE.Object3D;
    dispose: () => void;
  } {
    const scene = new THREE.Scene();
    const ground = () => 0;
    const fx =
      entrance === 'council'
        ? new CouncilEntranceFx(scene, ground)
        : entrance === 'breath'
          ? new BreathEntranceFx(scene, ground)
          : entrance === 'quench'
            ? new QuenchEntranceFx(scene, ground)
            : entrance === 'heat'
              ? new HeatEntranceFx(scene, ground)
              : new FinalFx(scene, ground);
    const root = scene.getObjectByName(ROOTS[entrance]);
    if (!root) throw new Error(`no root for ${entrance}`);
    return { root, dispose: () => fx.dispose() };
  }
  /** The particle slots a painter's pools hold (each pool one instanced quad). */
  function poolSlots(root: THREE.Object3D): number {
    let n = 0;
    root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.InstancedBufferGeometry | undefined;
      if (g?.isInstancedBufferGeometry && g.getAttribute('aLife')) n += g.instanceCount;
    });
    return n;
  }

  for (const tier of ['low', 'ultra'] as const) {
    it(`on the ${tier} tier: pools under the ceiling, no light, no shadow caster, the doubles real`, () => {
      const restore = gfxInternalsForTest.overrideSettings({ tier });
      try {
        for (const entrance of SMITH_HEART_ENTRANCES) {
          const budget = entranceBudgetNow(entrance);
          expect(budget).toEqual(entranceBudget(entrance, tier));
          const { root, dispose } = build(entrance);
          const slots = poolSlots(root);
          expect(slots, entrance).toBeGreaterThan(0);
          expect(slots, entrance).toBeLessThanOrEqual(budget.particleCeiling);
          let lights = 0;
          let casters = 0;
          const names = new Set<string>();
          root.traverse((o) => {
            if ((o as THREE.Light).isLight) lights++;
            if ((o as THREE.Mesh).isMesh && o.castShadow) casters++;
            names.add(o.name);
          });
          expect(lights, entrance).toBe(budget.addedLights);
          expect(casters, entrance).toBe(budget.shadowCasters);
          for (const layer of ENTRANCE_SECONDARY_LAYERS[entrance])
            expect(names.has(layer), `${entrance}: ${layer}`).toBe(true);
          dispose();
        }
      } finally {
        restore();
      }
    });
  }

  it('the low tier holds a scene to less than half the particles', () => {
    const slots: Record<string, number[]> = {};
    for (const tier of ['ultra', 'low'] as const) {
      const restore = gfxInternalsForTest.overrideSettings({ tier });
      try {
        for (const entrance of SMITH_HEART_ENTRANCES) {
          const { root, dispose } = build(entrance);
          slots[entrance] = [...(slots[entrance] ?? []), poolSlots(root)];
          dispose();
        }
      } finally {
        restore();
      }
    }
    for (const [entrance, [full, low]] of Object.entries(slots))
      expect(low, entrance).toBeLessThan(full / 2);
  });
});

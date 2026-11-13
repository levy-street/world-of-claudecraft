// The Guardian of the Quench's floor warnings wear its own frost paint
// (Jose's playtest of 2026-11-04: "generic red circles and red cones"):
// painted_telegraph_core.ts QUENCH_TELEGRAPH_LOOKS, quench_telegraph_glsl.ts,
// painted_telegraphs.ts QuenchTelegraphs. The kit keeps the exact shape and
// timing; the threat colour holds the edge on every tier; the cosmetic
// layers (mist, crazing, glints) are the only ones the low tier sheds; and
// both owners (QuenchFx's cone, QuenchFightFx's cracks, shatter rings and
// lanes) dress every pooled footprint.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer_core';
import {
  QUENCH_TELEGRAPH_GLOW_STEP,
  QUENCH_TELEGRAPH_LOOKS,
  type QuenchTelegraphKind,
} from '../src/render/smith_heart_fx/painted_telegraph_core';
import { QuenchTelegraphs } from '../src/render/smith_heart_fx/painted_telegraphs';
import { QuenchFightFx } from '../src/render/smith_heart_fx/quench_fight_fx';
import { QuenchFx } from '../src/render/smith_heart_fx/quench_fx';
import { QUENCH_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/quench_telegraph_glsl';

const KINDS: QuenchTelegraphKind[] = ['breath', 'crack', 'splash', 'slash'];

describe('the Quench frost paint', () => {
  it('every Quench footprint wears frost with a full edge and shards along it', () => {
    for (const k of KINDS) {
      const L = QUENCH_TELEGRAPH_LOOKS[k];
      expect(L.paint).toBe('frost');
      expect(L.rim).toBe(1);
      expect(L.char).toBeGreaterThan(0.5);
      // The shards (uSpin) stand on every edge.
      expect(L.spin).toBeGreaterThan(0.5);
    }
    // Only a crack opens to water.
    expect(QUENCH_TELEGRAPH_LOOKS.crack.flow).toBe(1);
    for (const k of ['breath', 'splash', 'slash'] as const)
      expect(QUENCH_TELEGRAPH_LOOKS[k].flow).toBe(0);
  });

  it('the edge holds the threat colour on every tier; only cosmetics hide behind uDetail', () => {
    const glow = QUENCH_TELEGRAPH_FRAG.split('#ifdef PT_CHAR')[1]?.split('#else')[1] ?? '';
    const tiered = glow.split('if (uDetail > 0.0)')[0];
    // The rim, the threat band and the shards draw outside the detail gate.
    expect(tiered).toContain('rimCore');
    expect(tiered).toMatch(/uColor \* rimCore/);
    expect(tiered).toMatch(/uColor \* threatBand/);
    expect(tiered).toContain('shard');
    expect(tiered).toContain('frac');
    // The detail gate holds the mist, the crazing and the glints only.
    const detail = glow.split('if (uDetail > 0.0)')[1] ?? '';
    expect(detail).toContain('mist');
    expect(detail).toContain('glint');
    expect(detail).not.toContain('rimCore');
    // The fill is the cast: the front rides the kit's own fill.
    expect(QUENCH_TELEGRAPH_FRAG).toContain('fillYards');
  });

  it('dresses a fan and a lane off the kit uniforms, its glow over every Quench char rung', () => {
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const materials: THREE.Material[] = [];
    const paints = new QuenchTelegraphs(QUENCH_TELEGRAPH_GLOW_STEP, materials);
    const fan = kit.fan(10);
    const d = paints.dress(fan, 'breath');
    const char = fan.floor.material as THREE.ShaderMaterial;
    expect(char.defines).toMatchObject({ QT_FROST: '', PT_CHAR: '' });
    expect((d.glow.material as THREE.ShaderMaterial).defines).toMatchObject({ QT_FROST: '' });
    expect(d.glow.renderOrder).toBe(floorVfxRenderOrder('encounter', QUENCH_TELEGRAPH_GLOW_STEP));
    kit.paintFan(fan, { fill: 0.6, clock: 2, range: 20 });
    expect((d.glow.material as THREE.ShaderMaterial).uniforms.uFill).toBe(char.uniforms.uFill);
    expect(char.uniforms.uFill.value).toBe(0.6);
    const lane = kit.lane(11);
    const dl = paints.dress(lane, 'slash');
    expect(dl.glow.parent).toBe(lane.floor);
    // Over the cone (10), the cracks (8), the shatter rings (10) and the lanes (11).
    expect(QUENCH_TELEGRAPH_GLOW_STEP).toBeGreaterThan(11);
    expect(materials).toHaveLength(4);
  });
});

describe('both Quench owners dress every footprint', () => {
  const frostMats = (root: THREE.Object3D) => {
    const names = new Set<string>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && /TelegraphChar_frost|TelegraphGlow_frost/.test(m.name)) names.add(m.uuid);
    });
    return names.size;
  };

  it('QuenchFx paints the cone in frost', () => {
    const scene = new THREE.Scene();
    const fx = new QuenchFx(scene, () => 0);
    expect(frostMats(scene)).toBeGreaterThan(0);
    let plain = 0;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (o.name === 'telegraphFloor' && m && !/frost/.test(m.name)) plain++;
    });
    expect(plain).toBe(0);
    fx.dispose();
  });

  it('QuenchFightFx paints its cracks, shatter rings and lanes in frost', () => {
    const scene = new THREE.Scene();
    const fx = new QuenchFightFx(scene, () => 0);
    expect(frostMats(scene)).toBeGreaterThan(0);
    fx.dispose();
  });
});

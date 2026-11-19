// The Smith's Heart's light-rivers as veins of light (the taste pass, design doc
// section 5.27; presentation only: river_vein_look.ts, heart_rivers.ts,
// heart_fx_materials.ts): the Hammer's, the Breath's and the Quench's dim
// ribbons drawn as a groove with a thread of the vein's own light, on the same
// line, width and rung as the flat band they replace, their pulses running
// toward the guardian and never out; the bright twin's light pooled in the
// channel with feathered lips.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import {
  heartRiverSurgeMaterial,
  RIVER_LIT_POOL,
  riverLitAcross,
} from '../src/render/smith_heart/heart_fx_materials';
import { buildHeartRivers } from '../src/render/smith_heart/heart_rivers';
import {
  RIVER_VEIN_FLOOR,
  RIVER_VEIN_GROOVE,
  RIVER_VEIN_LIGHT,
  RIVER_VEIN_LOOKS,
  RIVER_VEINS,
  riverVeinAcross,
  riverVeinMaterial,
  riverVeinPulse,
} from '../src/render/smith_heart/river_vein_look';
import { SMITH_HEART_VEIN_COLORS, SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';

describe('the light-rivers as veins of light', () => {
  it('draws every dim ribbon on its old line and rung, none as a flat band', () => {
    const rivers = buildHeartRivers();
    for (const vein of SMITH_HEART_VEINS) {
      const dim = rivers.group.getObjectByName(`river:${vein}:dim`) as THREE.Mesh;
      const lit = rivers.group.getObjectByName(`river:${vein}:lit`) as THREE.Mesh;
      const mat = dim.material as THREE.ShaderMaterial;
      // A shader of its own, never the flat additive band.
      expect(mat.isShaderMaterial).toBe(true);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      // The ground rung, under every telegraph; the bright twin over it.
      expect(dim.renderOrder).toBe(floorVfxRenderOrder('ground', 3));
      expect(lit.renderOrder).toBe(floorVfxRenderOrder('ground', 4));
      // The same strip as the bright twin: one line, one width.
      expect(Array.from(dim.geometry.getAttribute('position').array)).toEqual(
        Array.from(lit.geometry.getAttribute('position').array),
      );
      // The yards along and the side across, one per vertex.
      for (const name of ['aArc', 'aSide'])
        expect(dim.geometry.getAttribute(name).count).toBe(
          dim.geometry.getAttribute('position').count,
        );
    }
    // The Heat keeps the Hearth's seam; the other three share one program.
    const name = (vein: string) =>
      ((rivers.group.getObjectByName(`river:${vein}:dim`) as THREE.Mesh).material as THREE.Material)
        .name;
    expect(name('heat')).toBe('smithHeartRiver:heat:seam');
    for (const vein of RIVER_VEINS) {
      expect(name(vein)).toBe(`smithHeartRiver:${vein}:dim`);
      expect(riverVeinMaterial(vein).fragmentShader).toBe(
        riverVeinMaterial('hammer').fragmentShader,
      );
      expect(riverVeinMaterial(vein).vertexShader).toContain('projectionMatrix * modelViewMatrix');
      // One shared material per vein: a second slot draws the same object.
      expect(riverVeinMaterial(vein)).toBe(riverVeinMaterial(vein));
    }
    expect([...RIVER_VEINS].sort()).toEqual(SMITH_HEART_VEINS.filter((v) => v !== 'heat').sort());
  });

  it("lights each thread in its vein's own colour, inside its groove", () => {
    for (const vein of RIVER_VEINS) {
      const L = RIVER_VEIN_LOOKS[vein];
      const u = riverVeinMaterial(vein).uniforms;
      expect((u.uColor.value as THREE.Color).getHex()).toBe(SMITH_HEART_VEIN_COLORS[vein]);
      // The groove's stone is dark: the thread is what reads.
      for (const c of L.groove) expect(c).toBeLessThan(0.1);
      // The thread at its furthest wander (the noise's reach, the static's kink)
      // still lies inside the groove's lips at their most ragged.
      const G = RIVER_VEIN_GROOVE;
      expect(L.wander * G.reach + L.crackle * G.kink + L.thread).toBeLessThan(G.lip - G.rag);
      expect(u.uLook.value.x).toBe(L.thread);
      expect(u.uLook.value.z).toBeCloseTo((Math.PI * 2) / L.wavelength, 9);
      expect(u.uLook.value.w).toBe(L.speed);
      // One touch of its own each, and only one.
      expect(L.fleck + L.crackle + L.rime).toBe(1);
    }
    expect(RIVER_VEIN_LOOKS.hammer.fleck).toBe(1);
    expect(RIVER_VEIN_LOOKS.breath.crackle).toBe(1);
    expect(RIVER_VEIN_LOOKS.quench.rime).toBe(1);
  });

  it('runs its pulses toward the guardian and never lets the route go out', () => {
    for (const vein of RIVER_VEINS) {
      const L = RIVER_VEIN_LOOKS[vein];
      // Follow one crest: a beat later it sits closer to arc 0 (the arena).
      const crestNear = (t: number, from: number) => {
        let best = from;
        let bv = -1;
        for (let a = from - L.wavelength / 2; a <= from + L.wavelength / 2; a += 0.01) {
          const v = riverVeinPulse(vein, a, t);
          if (v > bv) {
            bv = v;
            best = a;
          }
        }
        return best;
      };
      const c0 = crestNear(0, 60);
      const c1 = crestNear(0.5, c0);
      expect(c1).toBeLessThan(c0);
      expect(c0 - c1).toBeCloseTo(L.speed * 0.5, 1);
      let low = 1;
      let high = 0;
      for (let a = 0; a < 3 * L.wavelength; a += 0.05) {
        const v = riverVeinPulse(vein, a, 3);
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      // Between two crests the thread dims to its floor, never out.
      expect(low).toBeGreaterThanOrEqual(RIVER_VEIN_FLOOR - 1e-9);
      expect(low).toBeLessThan(RIVER_VEIN_FLOOR + 0.01);
      expect(high).toBeGreaterThan(0.99);
    }
    expect(RIVER_VEIN_FLOOR).toBeGreaterThanOrEqual(0.4);
    // The shader runs the same arithmetic as the pure twin.
    const frag = riverVeinMaterial('hammer').fragmentShader;
    expect(frag).toContain('sin(uLook.z * (vArc + uLook.w * uTime))');
    expect(frag).toContain(
      `${RIVER_VEIN_FLOOR.toFixed(3)} + ${(1 - RIVER_VEIN_FLOOR).toFixed(3)} * beat * beat`,
    );
  });

  it('keeps a dim ribbon dim beside its bright twin: which veins are lit is the progress', () => {
    // Linear luma of a vein's colour, and of a light `gain` times it plus `white`.
    const luma = (hex: number) => {
      const c = new THREE.Color(hex);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    const N = 400;
    for (const vein of RIVER_VEINS) {
      const Lc = luma(SMITH_HEART_VEIN_COLORS[vein]);
      // The light each carries, averaged across the ribbon: the dim one at a pulse's
      // crest (its brightest), the bright one at its mean flow.
      let dim = 0;
      let lit = 0;
      for (let i = 0; i < N; i++) {
        const a = (i + 0.5) / N;
        const d = riverVeinAcross(vein, a, 1);
        dim += d.alpha * (d.gain * Lc + d.white);
        const b = riverLitAcross(a);
        lit += b.gain * Lc + b.white;
      }
      // The flat bands this pass replaced stood 2.9 to 1 (0.68 of the colour under a
      // soft core, over a 0.2 wash): the veins keep at least that, with room.
      expect(lit / dim).toBeGreaterThan(3);
      // The thread's own crest stays well under the bright ribbon's middle, and the
      // bright ribbon is drawn OVER the dim one: even with the flow's bands and the
      // streaks both at their lowest it adds most of that crest again on top.
      const crest = riverVeinAcross(vein, 0, 1);
      const mean = riverLitAcross(0);
      const low = riverLitAcross(
        0,
        RIVER_LIT_POOL.flow - RIVER_LIT_POOL.swing,
        RIVER_LIT_POOL.streak,
      );
      const peak = crest.gain * Lc + crest.white;
      expect(peak).toBeLessThan((mean.gain * Lc + mean.white) * 0.8);
      expect(low.gain * Lc + low.white).toBeGreaterThan(peak * 0.8);
      // The dim ribbon is still found from afar: a wash of the vein's colour across
      // the whole groove (what the flat band was), under the thread.
      const wash = riverVeinAcross(vein, RIVER_VEIN_GROOVE.lip * 0.9, RIVER_VEIN_FLOOR);
      expect(wash.gain).toBeGreaterThanOrEqual(RIVER_VEIN_LIGHT.tint - 1e-9);
      expect(wash.alpha).toBeCloseTo(RIVER_VEIN_GROOVE.cover, 6);
    }
    expect(RIVER_VEIN_LIGHT.tint).toBeGreaterThan(0.05);
    // The shader draws the thread at least a pixel and a half wide (a far ribbon
    // keeps its line), and reads the same light numbers as the twin.
    const frag = riverVeinMaterial('breath').fragmentShader;
    expect(frag).toContain('max(uLook.x, fwidth(vAcross) * 1.5)');
    expect(frag).toContain(`* light * ${RIVER_VEIN_LIGHT.thread.toFixed(3)}`);
    expect(frag).toContain(`${RIVER_VEIN_LIGHT.tint.toFixed(3)} * groove`);
  });

  it('pools the bright ribbon in its channel: full across its middle, no hard edge, no pow', () => {
    const m = heartRiverSurgeMaterial('t', SMITH_HEART_VEIN_COLORS.breath);
    // As bright as the band it replaces across the ribbon's middle half, the
    // lips feathered from there to nothing at the strip's edge.
    expect(RIVER_LIT_POOL.full).toBeGreaterThanOrEqual(0.4);
    expect(RIVER_LIT_POOL.full).toBeLessThan(0.8);
    expect(m.fragmentShader).toContain(`smoothstep(${RIVER_LIT_POOL.full.toFixed(2)}, 1.0, a)`);
    expect(RIVER_LIT_POOL.line).toBeLessThan(RIVER_LIT_POOL.full);
    // The twin's numbers are the shader's: the flow's level and swing, the streaks.
    expect(m.fragmentShader).toContain(
      `float flow = ${RIVER_LIT_POOL.flow.toFixed(2)} + ${RIVER_LIT_POOL.swing.toFixed(2)} * sin(`,
    );
    expect(m.fragmentShader).toContain(`float streak = ${RIVER_LIT_POOL.streak.toFixed(2)} + `);
    expect(m.uniforms.uK.value).toBe(RIVER_LIT_POOL.k);
    // Feathered to nothing at the strip's edge, full at its middle.
    expect(riverLitAcross(1).gain).toBe(0);
    expect(riverLitAcross(0).gain).toBeGreaterThan(riverLitAcross(0.75).gain);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    for (const src of [m.fragmentShader, riverVeinMaterial('hammer').fragmentShader])
      expect(src).not.toMatch(/\bpow\s*\(/);
  });
});

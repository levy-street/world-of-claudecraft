// The Smith's Heart's light-rivers as veins of light (the taste pass, design doc
// section 5.27; presentation only: river_vein_look.ts, heart_rivers.ts,
// heart_fx_materials.ts): the Hammer's, the Breath's and the Quench's dim
// ribbons drawn as a groove with a thread of the vein's own light, on the same
// line, width and rung as the flat band they replace, lying still until the
// vein's guardian falls (the owner's call of 2026-11-20) and never out; the
// bright twin's light, the one that flows, pooled in the channel with
// feathered lips.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { sharedUniforms } from '../src/render/gfx';
import {
  heartRiverSurgeMaterial,
  RIVER_LIT_POOL,
  riverLitAcross,
} from '../src/render/smith_heart/heart_fx_materials';
import { buildHeartRivers } from '../src/render/smith_heart/heart_rivers';
import {
  RIVER_VEIN_GROOVE,
  RIVER_VEIN_LIGHT,
  RIVER_VEIN_LOOKS,
  RIVER_VEIN_REST,
  RIVER_VEIN_RIME,
  RIVER_VEINS,
  riverVeinAcross,
  riverVeinMaterial,
  riverVeinRest,
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
      expect(u.uLook.value.y).toBe(L.wander);
      // Its glow's grain: one stretch of the noise a wavelength long.
      expect(u.uLook.value.z).toBeCloseTo(1 / L.wavelength, 9);
      expect(L.wavelength).toBeGreaterThanOrEqual(8);
      expect(u.uGroove.value.toArray()).toEqual([...L.groove]);
      expect(u.uKind.value.toArray()).toEqual([L.fleck, L.crackle, L.rime]);
      // One touch of its own each, and only one.
      expect(L.fleck + L.crackle + L.rime).toBe(1);
    }
    expect(RIVER_VEIN_LOOKS.hammer.fleck).toBe(1);
    expect(RIVER_VEIN_LOOKS.breath.crackle).toBe(1);
    expect(RIVER_VEIN_LOOKS.quench.rime).toBe(1);
    // The shader's groove and wander are these numbers: its two rag noises span
    // `rag` either way between them, its two wander noises `reach`, its kink `kink`.
    const G = RIVER_VEIN_GROOVE;
    const f3 = (v: number) => v.toFixed(3);
    const frag = riverVeinMaterial('quench').fragmentShader;
    for (const line of [
      `float rag = (vns(vec2(vArc * 0.7, 3.1)) - 0.5) * ${f3(G.rag * (4 / 3))} + (vns(vec2(vArc * 2.3, 7.7)) - 0.5) * ${f3(G.rag * (2 / 3))};`,
      `float groove = 1.0 - smoothstep(${f3(G.lip)} + rag, ${f3(G.edge)}, a);`,
      `float wob = (vns(vec2(vArc * 0.12, 1.3)) - 0.5) * ${f3(G.reach * (14 / 9))} + (vns(vec2(vArc * 0.5, 9.1)) - 0.5) * ${f3(G.reach * (4 / 9))};`,
      `wob = wob * uLook.y + (vns(vec2(vArc * 3.1, 1.7)) - 0.5) * ${f3(G.kink * 2)} * uKind.y;`,
      'float t = abs(vAcross - wob);',
    ])
      expect(frag).toContain(line);
  });

  it('lies still until its guardian falls: no clock in a dim ribbon, the bright twin is what flows', () => {
    const rivers = buildHeartRivers();
    for (const vein of RIVER_VEINS) {
      // Nothing in the sleeping vein can move: its program reads no clock at all
      // (no uniform to drive, no `uTime` in either shader).
      const m = riverVeinMaterial(vein);
      expect(Object.keys(m.uniforms).sort()).toEqual(['uColor', 'uGroove', 'uKind', 'uLook']);
      for (const u of Object.values(m.uniforms)) expect(u).not.toBe(sharedUniforms.uTime);
      for (const src of [m.fragmentShader, m.vertexShader]) expect(src).not.toContain('uTime');
      // Until the vein lights, the still ribbon is all there is of it: the bright
      // twin over it draws nothing.
      const lit = rivers.group.getObjectByName(`river:${vein}:lit`) as THREE.Mesh;
      expect(lit.geometry.drawRange.count).toBe(0);
      // And the twin is the one that flows once it runs: on the shared clock.
      const twin = lit.material as THREE.ShaderMaterial;
      expect(twin.uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(twin.fragmentShader).toContain('uTime');
    }
    // Asleep, never out: the thread's glow lies uneven between two shares of its
    // full light, under the one `riverVeinAcross` is measured at.
    const R = RIVER_VEIN_REST;
    expect(R.low).toBeGreaterThanOrEqual(0.4);
    expect(R.high).toBeGreaterThan(R.low);
    expect(R.high).toBeLessThan(1);
    expect(riverVeinRest(0)).toBe(R.low);
    expect(riverVeinRest(1)).toBeCloseTo(R.high, 12);
    expect(riverVeinRest(0.5)).toBeCloseTo((R.low + R.high) / 2, 12);
    expect(riverVeinRest(-3)).toBe(R.low);
    expect(riverVeinRest(7)).toBeCloseTo(R.high, 12);
    // The shader runs the same arithmetic as the pure twin, on the ribbon's own
    // yards alone; the flicker, the Breath's beads and the Hammer's glints are
    // held where they lie.
    const frag = riverVeinMaterial('hammer').fragmentShader;
    for (const line of [
      `float glow = ${R.low.toFixed(3)} + ${(R.high - R.low).toFixed(3)} * vns(vec2(vArc * uLook.z, 5.3));`,
      'float flick = 0.86 + 0.14 * vns(vec2(vArc * 1.7, 0.5));',
      'float bead = smoothstep(0.58, 0.9, vns(vec2(vArc * 1.3, 2.0))) * uKind.y;',
      'float glint = 0.5 + 0.5 * sin(fn * 40.0);',
    ])
      expect(frag).toContain(line);
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
      // The light each carries, averaged across the ribbon: the dim one at a full
      // glow (brighter than it ever lies), the bright one at its mean flow.
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
      // (Sampled between the thread's halo and the Quench's rime.)
      const wash = riverVeinAcross(vein, RIVER_VEIN_RIME.from - 0.02, RIVER_VEIN_REST.low);
      expect(wash.gain).toBeGreaterThanOrEqual(RIVER_VEIN_LIGHT.tint - 1e-9);
      expect(wash.alpha).toBeCloseTo(RIVER_VEIN_GROOVE.cover, 6);
    }
    expect(RIVER_VEIN_LIGHT.tint).toBeGreaterThan(0.05);
    // The twin above is the shader's own arithmetic, line for line: the thread never
    // thinner than a pixel and a half (a far ribbon keeps its line), the halo, the light
    // with the Breath's bead, the wash, the core, the Quench's frost, the alpha.
    const f3 = (v: number) => v.toFixed(3);
    const G = RIVER_VEIN_GROOVE;
    const K = RIVER_VEIN_LIGHT;
    const R = RIVER_VEIN_RIME;
    const frag = riverVeinMaterial('breath').fragmentShader;
    for (const line of [
      'float th = min(max(uLook.x, fwidth(vAcross) * 1.5), 0.9);',
      'float thread = 1.0 - smoothstep(th * 0.4, th, t);',
      'float halo = 1.0 - smoothstep(0.05, 0.55, t);',
      `float light = thread * glow * flick * (1.0 + ${f3(K.bead)} * bead);`,
      `vec3 core = mix(uColor, vec3(1.0), ${f3(K.white)});`,
      `vec3 col = stone + uColor * (${f3(K.tint)} * groove + halo * halo * (${f3(K.halo)} + ${f3(K.haloGlow)} * glow));`,
      `col += mix(uColor, core, ${f3(K.core)}) * light * ${f3(K.thread)};`,
      `float rime = smoothstep(${f3(R.from)}, ${f3(R.full)}, a) * (1.0 - smoothstep(${f3(R.fade)}, 1.0, a));`,
      `col = mix(col, vec3(${R.frost.map(f3).join(', ')}), rime * ${f3(R.mix)});`,
      `float alpha = clamp(max(groove * ${f3(G.cover)}, max(halo * 0.65, max(thread, rime * ${f3(R.alpha)}))), 0.0, 1.0);`,
    ])
      expect(frag).toContain(line);
    // The flicker and the bead only ever dim or hold the twin's worst case: both are
    // noises in 0..1 the twin takes at one, and the glow never reaches the one the
    // twin is measured at.
    expect(frag).toContain('float flick = 0.86 + 0.14 * vns(');
    expect(frag).toContain('float bead = smoothstep(0.58, 0.9, vns(');
    expect(RIVER_VEIN_REST.high).toBeLessThan(1);
    // The frost is a cold grey, never a light: under the vein colours' own luma.
    for (const c of R.frost) expect(c).toBeLessThanOrEqual(0.7);
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
    expect(m.fragmentShader).toContain(
      `float streak = ${RIVER_LIT_POOL.streak.toFixed(2)} + ${RIVER_LIT_POOL.streakA.toFixed(2)} * s1 * s1 + ${RIVER_LIT_POOL.streakB.toFixed(2)} * s2 * s2;`,
    );
    expect(m.uniforms.uK.value).toBe(RIVER_LIT_POOL.k);
    // The hot line and the whole of the colour: the pool multiplies the ribbon AND the
    // surge (drop it from either and the lips stop feathering).
    expect(m.fragmentShader).toContain(
      `float line = 1.0 - smoothstep(0.0, ${RIVER_LIT_POOL.line.toFixed(2)}, a);`,
    );
    expect(m.fragmentShader).toContain(
      `vec3 hot = mix(uColor, vec3(1.0, 0.97, 0.9), ${RIVER_LIT_POOL.white.toFixed(2)});`,
    );
    expect(m.fragmentShader).toContain(
      `vec3 col = uColor * flow * streak * pool * uK + hot * line * ${RIVER_LIT_POOL.hot.toFixed(2)} * flow + hot * head * pool;`,
    );
    // Feathered to nothing at the strip's edge, full at its middle.
    expect(riverLitAcross(1).gain).toBe(0);
    expect(riverLitAcross(0).gain).toBeGreaterThan(riverLitAcross(0.75).gain);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    for (const src of [m.fragmentShader, riverVeinMaterial('hammer').fragmentShader])
      expect(src).not.toMatch(/\bpow\s*\(/);
  });
});

// The Guardian of the Quench's floor marks without a flicker (Jose's heroic
// run of 2026-11-17: the lake flickered as the camera turned): one ladder with
// a unique rung per layer (quench_floor_ladder_core.ts), the pools whose
// pieces can cross drawn as a commuting char and glow (quench_floor_decal.ts),
// every fight module taking its floor steps from the ladder, and the
// instanced floor discs projected camera-relative (their instances sit at
// world x ~ 119000).

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR_VFX_LAYER_BASE } from '../src/render/floor_vfx_layer_core';
import { QUENCH_TELEGRAPH_GLOW_STEP } from '../src/render/smith_heart_fx/painted_telegraph_core';
import {
  splitQuenchDecal,
  withQuenchCharTail,
} from '../src/render/smith_heart_fx/quench_floor_decal';
import {
  QUENCH_FLOOR,
  type QuenchFloorRung,
  quenchFloorFaults,
  quenchParticleSteps,
} from '../src/render/smith_heart_fx/quench_floor_ladder_core';

const FX = 'src/render/smith_heart_fx/';
/** Every module that paints the fight's floor. */
const MODULES = [
  'quench_fight_fx',
  'quench_fx',
  'quench_frost_fx',
  'quench_blades_fx',
  'quench_wake_fx',
  'quench_wake_throw',
  'quench_strike_cracks',
  'quench_strike_windup_fx',
  'quench_rime_steps',
  'quench_body',
];
const src = (m: string) => readFileSync(`${FX}${m}.ts`, 'utf8');

describe('quench_floor_ladder_core: one untied rung per Quench floor layer', () => {
  it('is sound: no two layers tie, every step on the band, no pooled normal blend', () => {
    expect(quenchFloorFaults()).toEqual([]);
  });

  it('catches a tie, a step off the band and a pooled normal blend', () => {
    const bad: Record<string, QuenchFloorRung> = {
      a: { step: 3, owner: 'quench_fx', blend: 'multiply', pooled: true },
      b: { step: 3, owner: 'quench_fight_fx', blend: 'additive', pooled: true },
      c: { step: 40, owner: 'quench_fx', blend: 'normal', pooled: false },
      d: { step: 5, owner: 'quench_fx', blend: 'normal', pooled: true },
    };
    const faults = quenchFloorFaults(bad);
    expect(faults.some((f) => f.includes('ties'))).toBe(true);
    expect(faults.some((f) => f.includes('off the band'))).toBe(true);
    expect(faults.some((f) => f.includes('pools a normal blend'))).toBe(true);
  });

  it('lays every char under its glow, and the telegraphs over every mark on the ice', () => {
    expect(QUENCH_FLOOR.frostChar.step).toBeLessThan(QUENCH_FLOOR.frostGlow.step);
    expect(QUENCH_FLOOR.throwChar.step).toBeLessThan(QUENCH_FLOOR.throwGlow.step);
    expect(QUENCH_FLOOR.strikeCrackChar.step).toBeLessThan(QUENCH_FLOOR.strikeCrackGlow.step);
    expect(QUENCH_TELEGRAPH_GLOW_STEP).toBe(QUENCH_FLOOR.telegraphGlow.step);
    for (const [name, r] of Object.entries(QUENCH_FLOOR)) {
      if (name.startsWith('telegraph') || name.endsWith('Smoke') || name === 'sparks') continue;
      expect(r.step, name).toBeLessThan(QUENCH_FLOOR.telegraphChar.step);
    }
  });

  it('gives each particle owner its own smoke rung, the sparks one shared additive rung', () => {
    const owners = ['quench_fight_fx', 'quench_fx', 'quench_body', 'quench_blades_fx'] as const;
    const smokes = owners.map((o) => quenchParticleSteps(o).smoke);
    expect(new Set(smokes).size).toBe(owners.length);
    for (const o of owners) {
      const s = quenchParticleSteps(o);
      expect(s.glow).toBe(QUENCH_FLOOR.sparks.step);
      expect(s.fire).toBe(QUENCH_FLOOR.sparks.step);
      expect(s.ring).toBe(QUENCH_FLOOR.sparks.step);
    }
  });
});

describe('the Quench modules take every floor step from the ladder', () => {
  it('names no literal encounter step', () => {
    for (const m of MODULES) {
      expect(src(m), m).not.toMatch(/floorVfxRenderOrder\('encounter',\s*\d/);
      expect(src(m), m).not.toMatch(/kit\.(fan|lane)\(\d/);
    }
  });

  it('hands every particle owner its ladder steps', () => {
    for (const m of ['quench_fight_fx', 'quench_fx', 'quench_body', 'quench_blades_fx'])
      expect(src(m), m).toContain(`quenchParticleSteps('${m}')`);
  });

  it('projects the instanced floor discs camera-relative', () => {
    for (const m of ['quench_fight_fx', 'quench_frost_fx', 'quench_rime_steps']) {
      const s = src(m);
      expect(s, m).toContain('wocCamRelView');
      expect(s, m).not.toMatch(/modelViewMatrix \* instanceMatrix/);
    }
  });

  it('splits the crossing pools (the frost, the throw, the strike) into char and glow', () => {
    expect(src('quench_fx')).toContain('splitQuenchDecal');
    expect(src('quench_wake_throw')).toContain('splitQuenchDecal');
    expect(src('quench_strike_cracks')).toContain('splitQuenchDecal');
  });
});

describe('quench_floor_decal: a normal blend split so crossings commute', () => {
  it('turns the mesh into a multiply char and adds an additive glow on the ladder rungs', () => {
    const mat = new THREE.ShaderMaterial({
      name: 'probe',
      uniforms: { uAlpha: { value: 0.5 } },
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'void main() {\n  gl_FragColor = vec4(1.0, 1.0, 1.0, 0.5);\n}\n',
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), mat);
    mesh.name = 'probeMesh';
    const materials: THREE.Material[] = [];
    const glow = splitQuenchDecal(mesh, 3, 11, materials);
    expect(mesh.renderOrder).toBe(FLOOR_VFX_LAYER_BASE.encounter + 3);
    expect(glow.renderOrder).toBe(FLOOR_VFX_LAYER_BASE.encounter + 11);
    expect(glow.parent).toBe(mesh);
    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(mat.blendSrc).toBe(THREE.DstColorFactor);
    expect(mat.blendDst).toBe(THREE.ZeroFactor);
    expect(mat.defines?.QUENCH_CHAR).toBe('');
    expect(mat.fragmentShader).toContain('QUENCH_CHAR');
    const gm = glow.material as THREE.ShaderMaterial;
    expect(gm.blending).toBe(THREE.AdditiveBlending);
    expect(gm.depthWrite).toBe(false);
    // One uniforms object: the painter's writes reach both passes.
    expect(gm.uniforms).toBe(mat.uniforms);
    expect(gm.fragmentShader).not.toContain('QUENCH_CHAR');
    expect(materials).toEqual([gm]);
  });

  it('splices the char tail inside the main body', () => {
    const out = withQuenchCharTail('void main() {\n  gl_FragColor = vec4(1.0);\n}\n');
    expect(out.indexOf('QUENCH_CHAR')).toBeLessThan(out.lastIndexOf('}'));
    expect(() => withQuenchCharTail('no body')).toThrow();
  });
});

// The Forgefather raid-door mist gate: one fog wall per placed
// dungeon_entrance facade, seated over the facade's red membrane (the
// authored mist target measured from the shipped GLB), pulsing off the
// shared uTime clock.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sharedUniforms } from '../src/render/gfx';
import {
  appendIgnivarMistGates,
  ignivarMistGateInternalsForTest,
  MIST_GATE_PROGRAM_CACHE_KEY,
  mistGateFramesFor,
  resetIgnivarMistGateCaches,
} from '../src/render/ignivar_mist_gate';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';
import { IGNIVAR_LIFT_LAYOUT } from '../src/sim/dungeon_layout';
import { type IgnivarPropPlacement, ignivarLiftPropPlacements } from '../src/sim/ignivar_props';

const at = (
  key: IgnivarPropPlacement['key'],
  x: number,
  z: number,
  ry: number,
  scale: number,
  y = 0,
): IgnivarPropPlacement => ({ key, x, y, z, ry, scale });

describe('ignivar mist gate', () => {
  it('derives one frame per dungeon_entrance placement, nothing else', () => {
    const frames = mistGateFramesFor([
      at('stone_floor', 500, 2240, 0, 20),
      at('dungeon_entrance', 503.05, 2243.7, Math.PI, 4.2, 18.9),
      at('staircase', 503, 2241, 0, 8),
    ]);
    expect(frames).toEqual([{ x: 503.05, y: 18.9, z: 2243.7, ry: Math.PI, scale: 4.2 }]);
  });

  it('appends a two-sheet gate per facade, transformed by the placement', () => {
    resetIgnivarMistGateCaches();
    const group = new THREE.Group();
    const count = appendIgnivarMistGates(group, [
      at('dungeon_entrance', 503.05, 2243.7, Math.PI, 4.2, 18.9),
      at('stone_floor', 500, 2240, 0, 20),
    ]);
    expect(count).toBe(1);
    expect(group.children.length).toBe(1);
    const gate = group.children[0] as THREE.Group;
    expect(gate.name).toBe('ignivarMistGate');
    expect(gate.position.x).toBeCloseTo(503.05);
    expect(gate.position.y).toBeCloseTo(18.9);
    expect(gate.position.z).toBeCloseTo(2243.7);
    expect(gate.rotation.y).toBeCloseTo(Math.PI);
    expect(gate.scale.x).toBeCloseTo(4.2);
    const sheets = gate.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(sheets.length).toBe(2);
    const { mistBounds } = ignivarMistGateInternalsForTest;
    for (const sheet of sheets) {
      expect(sheet.scale.x).toBeCloseTo(mistBounds.width);
      expect(sheet.scale.y).toBeCloseTo(mistBounds.height);
      expect(sheet.position.y).toBeCloseTo(mistBounds.centerY);
      // proud of the facade's front face (z 0.1377 canonical) so depth
      // testing never clips the sheet against the membrane it covers
      expect(sheet.position.z).toBeGreaterThan(0.1377);
      const material = sheet.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
    }
    // the smoky backdrop occludes (normal blending); the glow adds
    const blendings = sheets.map((s) => (s.material as THREE.Material).blending).sort();
    expect(blendings).toEqual([THREE.NormalBlending, THREE.AdditiveBlending].sort());
  });

  it('shares geometry and materials across gates (disposal-guard contract)', () => {
    resetIgnivarMistGateCaches();
    const group = new THREE.Group();
    appendIgnivarMistGates(group, [
      at('dungeon_entrance', 0, 0, 0, 1),
      at('dungeon_entrance', 10, 0, 0, 1),
    ]);
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes.length).toBe(4);
    expect(meshes[0].geometry).toBe(meshes[2].geometry);
    expect(meshes[0].material).toBe(meshes[2].material);
    for (const mesh of meshes) {
      expect(isSharedGeometry(mesh.geometry)).toBe(true);
      expect(isSharedMaterial(mesh.material as THREE.Material)).toBe(true);
    }
  });

  it('binds the shared uTime clock and a per-sheet pulse depth on compile', () => {
    resetIgnivarMistGateCaches();
    const { mistHazeMaterial, mistGlowMaterial } = ignivarMistGateInternalsForTest;
    const depths: number[] = [];
    for (const material of [mistHazeMaterial(), mistGlowMaterial()]) {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: '#include <common>',
        fragmentShader: '#include <common>\n#include <map_fragment>',
      };
      material.onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        null as unknown as THREE.WebGLRenderer,
      );
      expect(shader.uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(shader.fragmentShader).toContain('mistPulse');
      expect(shader.fragmentShader).toContain('uMistPulseDepth');
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
      depths.push((shader.uniforms.uMistPulseDepth as { value: number }).value);
      expect(material.customProgramCacheKey()).toBe(MIST_GATE_PROGRAM_CACHE_KEY);
    }
    // the glow sheet breathes far deeper than the smoky backdrop, and the
    // two depths are genuinely distinct values (the cache-key equality two
    // lines up is what lets them share one linked program regardless)
    expect(depths[1]).toBeGreaterThan(depths[0]);
    expect(new Set(depths).size).toBe(2);
  });

  it('the baked lift pass implies one mist frame per portal facade', () => {
    const frames = mistGateFramesFor(ignivarLiftPropPlacements(IGNIVAR_LIFT_LAYOUT));
    expect(frames).toEqual([
      { x: -0.2, y: 0, z: -5.85, ry: 0, scale: 6 },
      { x: 0.4, y: 0, z: 6.15, ry: Math.PI, scale: 6 },
    ]);
    // and the lift dressing actually appends them
    const dressingSource = readFileSync(
      new URL('../src/render/ignivar_raid_dressing.ts', import.meta.url),
      'utf8',
    );
    expect(dressingSource).toContain('appendIgnivarMistGates(group, placements)');
  });

  it('a raidless placement set appends nothing', () => {
    const group = new THREE.Group();
    expect(appendIgnivarMistGates(group, [at('stone_floor', 0, 0, 0, 1)])).toBe(0);
    expect(group.children.length).toBe(0);
  });
});

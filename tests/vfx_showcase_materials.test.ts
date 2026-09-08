import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setAbilityVfxDraft } from '../src/render/ability_vfx_registry';
import { buildIgnivarFrontalTelegraph } from '../src/render/ignivar_frontal_telegraph';
import { buildIgnivarSoakTelegraph } from '../src/render/ignivar_soak_telegraph';
import { drawRestorativeStream } from '../src/render/restorative_water';

afterEach(() => setAbilityVfxDraft('chain_heal', null));
describe('shared showcase effect materials', () => {
  it('keeps stream endpoints on the actual healed actors and applies the same draft colours', () => {
    setAbilityVfxDraft('chain_heal', { tint: '#123456', accent: '#abcdef', power: 1, sparks: 7 });
    const from = { x: 1, y: 2, z: 3 },
      to = { x: 11, y: 4, z: 8 };
    const paths: { color: number; points: THREE.Vector3[] }[] = [];
    drawRestorativeStream(
      {
        pathRibbon(color, _width, _life, fill) {
          const points = Array.from({ length: 12 }, () => new THREE.Vector3());
          expect(fill(points)).toBe(12);
          paths.push({ color, points });
        },
      },
      from,
      to,
    );
    expect(paths.map((path) => path.color)).toEqual([0x123456, 0xabcdef, 0xabcdef]);
    for (const path of paths) {
      expect(path.points[0].toArray()).toEqual([1, 2, 3]);
      expect(path.points[11].distanceTo(new THREE.Vector3(11, 4, 8))).toBeLessThan(1e-6);
      expect(path.points[5].y).toBeGreaterThan(4);
    }
  });
  it('gives both raid footprints a contrast bed with exactly the existing horizontal boundary', () => {
    for (const [root, fillName, borderName] of [
      [buildIgnivarFrontalTelegraph(), 'ignivarFrontalFill', 'ignivarFrontalBorder'],
      [buildIgnivarSoakTelegraph(), 'ignivarSoakFill', 'ignivarSoakRim'],
    ] as const) {
      const fill = root.getObjectByName(fillName) as THREE.Mesh;
      const bed = root.getObjectByName(`${fillName}Contrast`) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      const border = root.getObjectByName(borderName) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      expect(bed.geometry.getAttribute('position').array).toEqual(
        fill.geometry.getAttribute('position').array,
      );
      expect(bed.material.blending).toBe(THREE.NormalBlending);
      expect(border.material.blending).toBe(THREE.NormalBlending);
      expect(bed.material.depthTest).toBe(true);
      expect(bed.material.depthWrite).toBe(false);
      expect(bed.renderOrder).toBeLessThan(fill.renderOrder);
    }
  });
});

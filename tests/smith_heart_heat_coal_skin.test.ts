// The Guardian of the Heat's skin (src/render/smith_heart_fx/heat_coal_skin.ts),
// written by the entrance and the death, one at a time: whichever order they
// take it in, giving it back restores the authored values exactly (the
// baseline is stamped once per material, never re-read off a dimmed one).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachHeatBodySockets,
  clearHeatBodySockets,
} from '../src/render/smith_heart_fx/heat_body_sockets';
import { HeatCoalSkin } from '../src/render/smith_heart_fx/heat_coal_skin';

function rig(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x884422, emissiveIntensity: 1.5 });
  mat.name = 'tripo_heat_guardian';
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const bone = new THREE.Bone();
  bone.name = 'head';
  mesh.add(bone);
  root.add(mesh);
  new THREE.Group().add(root);
  attachHeatBodySockets(root);
  return mat;
}

describe('the coal skin', () => {
  afterEach(() => clearHeatBodySockets());

  it('gives the authored look back, whichever skin took it first', () => {
    const mat = rig();
    const r = mat.color.r;
    const em = mat.emissiveIntensity;
    const death = new HeatCoalSkin();
    const entrance = new HeatCoalSkin();
    death.apply(0.03, 0.24);
    expect(mat.emissiveIntensity).toBeCloseTo(em * 0.03, 6);
    // The entrance meets the material already dimmed by the death's skin.
    entrance.apply(0.5, 0.5);
    death.restore();
    entrance.restore();
    expect(mat.color.r).toBeCloseTo(r, 6);
    expect(mat.emissiveIntensity).toBeCloseTo(em, 6);
  });

  it('whitens past white-hot and darkens to coal', () => {
    const mat = rig();
    const r = mat.color.r;
    const skin = new HeatCoalSkin();
    skin.apply(3.6, 1.6);
    expect(mat.color.r).toBeGreaterThan(r);
    skin.apply(0.03, 0.24);
    expect(mat.color.r).toBeLessThan(r * 0.3);
    skin.restore();
    expect(mat.color.r).toBeCloseTo(r, 6);
  });
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildIgnivarRotatingRaysTelegraph,
  disposeIgnivarEncounterVisuals,
  IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
} from '../src/render/ignivar_encounter';
import { IGNIVAR_FIRE_BEAM_FLAMES_NAME } from '../src/render/ignivar_fire_beams';

describe('Ignivar encounter visual disposal', () => {
  it('releases an owned InstancedMesh buffer when its encounter overlay leaves', () => {
    const group = new THREE.Group();
    const rays = buildIgnivarRotatingRaysTelegraph();
    group.add(rays);
    const flames = rays.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
    const dispose = vi.spyOn(flames, 'dispose');

    disposeIgnivarEncounterVisuals(group);

    expect(group.getObjectByName(IGNIVAR_ROTATING_RAYS_VISUAL_NAME)).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

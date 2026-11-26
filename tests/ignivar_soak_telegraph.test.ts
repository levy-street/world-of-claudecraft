import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BURDEN_SOAK_STYLE } from '../src/render/balgath_ranged_fx';
import { SOAK_MARKER, SOAK_PALETTES } from '../src/render/floor_telegraph/soak_marker_core';
import { floorVfxLayerOf } from '../src/render/floor_vfx_layer';
import {
  buildIgnivarSoakTelegraph,
  IGNIVAR_SOAK_DISC_NAME,
  IGNIVAR_SOAK_VISUAL_NAME,
  IGNIVAR_SOAK_WISPS_NAME,
  soakMarkerOf,
  syncIgnivarSoakTelegraph,
} from '../src/render/ignivar_soak_telegraph';
import {
  VARKHUL_SHARED_PYRE_RADIUS,
  VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
} from '../src/sim/varkhul_shared_pyre';

function discOf(soak: THREE.Object3D): THREE.Mesh {
  return soak.getObjectByName(IGNIVAR_SOAK_DISC_NAME) as THREE.Mesh;
}

function uniformsOf(soak: THREE.Object3D): Record<string, THREE.IUniform> {
  return (discOf(soak).material as THREE.ShaderMaterial).uniforms;
}

/** The disc's widest drawn point in the root's space (its geometry is the
 *  unit circle, scaled to the sim's radius). */
function drawnRadius(soak: THREE.Object3D): number {
  soak.updateMatrixWorld(true);
  const disc = discOf(soak);
  const pos = disc.geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let most = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(disc.matrixWorld);
    most = Math.max(most, Math.hypot(v.x, v.z));
  }
  return most;
}

describe('the soak telegraph on a marked player (the shared soak marker)', () => {
  it('builds the Shared Pyre as the fire marker: a floor disc and its wisps, yard-true', () => {
    const soak = buildIgnivarSoakTelegraph();
    expect(soak.name).toBe(IGNIVAR_SOAK_VISUAL_NAME);
    expect(soak.visible).toBe(false);
    expect(discOf(soak)).toBeInstanceOf(THREE.Mesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_WISPS_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.userData.requiredPlayers).toBe(VARKHUL_SHARED_PYRE_REQUIRED_NORMAL);
    // The rim (the shader's unit radius) is the sim's own radius; past it
    // the disc carries only the rim's own soft halo.
    expect(discOf(soak).scale.x).toBeCloseTo(VARKHUL_SHARED_PYRE_RADIUS, 6);
    expect(drawnRadius(soak)).toBeCloseTo(VARKHUL_SHARED_PYRE_RADIUS * SOAK_MARKER.outer, 4);
    const fire = new THREE.Color(SOAK_PALETTES.fire.body);
    expect((uniformsOf(soak).uBody.value as THREE.Color).equals(fire)).toBe(true);
    expect(floorVfxLayerOf(discOf(soak).renderOrder)).toBe('encounter');
  });

  it('dresses the Barrow Burden in shadow at its own radius', () => {
    const soak = buildIgnivarSoakTelegraph(4, BURDEN_SOAK_STYLE);
    expect(BURDEN_SOAK_STYLE.element).toBe('shadow');
    expect(discOf(soak).scale.x).toBeCloseTo(BURDEN_SOAK_STYLE.radius, 6);
    const shadow = new THREE.Color(SOAK_PALETTES.shadow.body);
    expect((uniformsOf(soak).uBody.value as THREE.Color).equals(shadow)).toBe(true);
  });

  it('lights a pip per player inside, never past the need, and runs the countdown arc', () => {
    const soak = buildIgnivarSoakTelegraph();
    syncIgnivarSoakTelegraph(soak, true, 1, 4, 0.25, 1, 0.1);
    const u = uniformsOf(soak);
    expect(soak.visible).toBe(true);
    expect(soak.userData.ready).toBe(false);
    expect(u.uNeed.value).toBe(4);
    expect(u.uLit.value).toBe(1);
    expect(u.uTimer.value).toBeCloseTo(0.75, 6);
    expect(u.uFlare.value).toBe(0);
    syncIgnivarSoakTelegraph(soak, true, 6, 4, 0.75, 1, 0.1);
    expect(soak.userData.ready).toBe(true);
    expect(u.uLit.value).toBe(4);
    expect(u.uTimer.value).toBeCloseTo(0.25, 6);
    expect(u.uFlare.value).toBe(1);
  });

  it('blooms in, then decays back into the middle once the mark is gone', () => {
    const soak = buildIgnivarSoakTelegraph();
    const u = uniformsOf(soak);
    syncIgnivarSoakTelegraph(soak, true, 1, 4, 0.1, 1, 0.05);
    expect(u.uBloom.value as number).toBeLessThan(1);
    syncIgnivarSoakTelegraph(soak, true, 1, 4, 0.2, 1, SOAK_MARKER.birth);
    expect(u.uBloom.value).toBeCloseTo(1, 6);
    // Released: still drawn (shrinking, fading), then gone.
    syncIgnivarSoakTelegraph(soak, false, 0, 4, 0, 1, SOAK_MARKER.decay * 0.5);
    expect(soak.visible).toBe(true);
    expect(soakMarkerOf(soak)?.decaying).toBe(true);
    expect(u.uBloom.value).toBeLessThan(1);
    syncIgnivarSoakTelegraph(soak, false, 0, 4, 0, 1, SOAK_MARKER.decay);
    expect(soak.visible).toBe(false);
  });

  it('holds every motion still under reduced motion, the pips and countdown kept', () => {
    const soak = buildIgnivarSoakTelegraph();
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.5, 1, 0.5, true);
    const u = uniformsOf(soak);
    const first = { spin: u.uSpin.value, time: u.uTime.value, bloom: u.uBloom.value };
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.5, 1, 0.5, true);
    expect({ spin: u.uSpin.value, time: u.uTime.value, bloom: u.uBloom.value }).toEqual(first);
    expect(first.bloom).toBe(1);
    expect(u.uLit.value).toBe(2);
    expect(u.uTimer.value).toBeCloseTo(0.5, 6);
    // No decay under reduced motion: gone at once.
    syncIgnivarSoakTelegraph(soak, false, 0, 4, 0, 1, 0.01, true);
    expect(soak.visible).toBe(false);
  });
});

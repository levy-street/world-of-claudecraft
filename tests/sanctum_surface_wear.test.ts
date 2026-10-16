import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addSanctumSurfaceWear } from '../src/render/gravewyrm_sanctum/sanctum_surface_wear';
import { planSanctumSurfaceWear } from '../src/render/gravewyrm_sanctum/sanctum_surface_wear_core';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

describe('Sanctum terrace frost wear', () => {
  it('shares the prepared terrain material and draw instead of creating a new GPU producer', () => {
    const terrain = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(9).fill(1), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'fieldTop:snow';
    terrain.add(mesh);
    addSanctumSurfaceWear(terrain);
    expect(terrain.children).toEqual([mesh]);
    expect(mesh.material).toBe(material);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(1000);
    expect(Array.from(mesh.geometry.getAttribute('position').array).slice(0, 9)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 0, 0,
    ]);
    mesh.geometry.dispose();
    material.dispose();
  });

  it('plans once per session: a second slot gets the same plan without recomputing', () => {
    // The plan has no input, so every claimed slot shares one. Identity (not
    // equality) is the pin: an equal but freshly walked plan would pass a
    // deep comparison while paying the whole field walk again.
    const first = planSanctumSurfaceWear();
    const second = planSanctumSurfaceWear();
    expect(second).toBe(first);
    for (let i = 0; i < first.length; i++) {
      expect(second[i].positions).toBe(first[i].positions);
      expect(second[i].colors).toBe(first[i].colors);
      expect(second[i].uvs).toBe(first[i].uvs);
    }
    // Two terrains built off it leave the shared plan untouched.
    const before = first.map((wear) => wear.positions.length);
    for (let slot = 0; slot < 2; slot++) {
      const terrain = new THREE.Group();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3),
      );
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(9).fill(1), 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      mesh.name = 'fieldTop:ice';
      terrain.add(mesh);
      addSanctumSurfaceWear(terrain);
      expect(mesh.geometry.getAttribute('position').count).toBe(3 + before[1] / 3);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    expect(planSanctumSurfaceWear().map((wear) => wear.positions.length)).toEqual(before);
  });

  it('places deterministic shallow fractures on snow and ice, never over a gap or boss lake', () => {
    const plan = planSanctumSurfaceWear();
    expect(plan).toEqual(planSanctumSurfaceWear());
    expect(plan[0].positions.length).toBeGreaterThan(1000);
    expect(plan.reduce((n, b) => n + b.positions.length / 9, 0)).toBeLessThan(12000);
    for (const batch of plan) {
      expect(batch.colors.length).toBe(batch.positions.length);
      expect(batch.uvs.length).toBe((batch.positions.length * 2) / 3);
      for (let i = 0; i < batch.positions.length; i += 3) {
        const [x, y, z] = batch.positions.slice(i, i + 3);
        const surface = authoredFieldSurfaceAt(GRAVEWYRM_SANCTUM_FIELD, x, z);
        expect(surface).not.toBeNull();
        expect(surface?.hidden).not.toBe(true);
        expect(surface?.ground).toBe(batch.family);
        expect(z).toBeLessThan(150);
        expect(y - authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z)).toBeCloseTo(0.018, 8);
      }
      for (let i = 0; i < batch.positions.length; i += 9) {
        const [ax, , az, bx, , bz, cx, , cz] = batch.positions.slice(i, i + 9);
        expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
      }
    }
  });
});

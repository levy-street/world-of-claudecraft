import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerAuraRings } from '../src/render/player_aura_rings';
import { playerAuraOrnamentSpec } from '../src/render/player_aura_rings_core';

const input = (id: string) => ({
  id,
  visible: true,
  color: '#33ccff',
  opacity: 0.7,
  scale: 1,
});

const instancePosition = (mesh: THREE.InstancedMesh, index = 0): THREE.Vector3 => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
};

describe('PlayerAuraRings procedural ornaments', () => {
  it('batches each ring ornament set into one instanced draw', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([input('raised_guard'), input('iron_resolve')]);

    const ornaments = rings.group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    expect(ornaments).toHaveLength(2);
    expect(ornaments[0].count).toBe(playerAuraOrnamentSpec('raised_guard').count);
    expect(ornaments[1].count).toBe(playerAuraOrnamentSpec('iron_resolve').count);
    expect(rings.group.children).toHaveLength(6);
  });

  it('applies the real Ultra profile and its full ornament density', () => {
    const rings = new PlayerAuraRings('ultra', true);
    rings.setRings([input('sudden_death')]);
    const ring = rings.group.children.find(
      (child): child is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> =>
        child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
    );
    const ornaments = rings.group.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );

    expect(ring?.geometry.parameters.thetaSegments).toBe(64);
    expect(ornaments?.count).toBe(10);
  });

  it('reports whether any ground ring exists so hidden frames can skip terrain work', () => {
    const rings = new PlayerAuraRings('high', true);
    expect(rings.hasVisibleRings()).toBe(false);
    rings.setRings([input('raised_guard')]);
    expect(rings.hasVisibleRings()).toBe(true);
    rings.setRings([{ ...input('raised_guard'), visible: false }]);
    expect(rings.hasVisibleRings()).toBe(false);
  });

  it('reuses ring resources when combat only changes visibility, color, or opacity', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([{ ...input('raised_guard'), visible: false }]);
    const initialChildren = [...rings.group.children];
    const initialGeometries = initialChildren
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((child) => child.geometry);
    const initialMaterials = initialChildren
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((child) => child.material);

    rings.setRings([{ ...input('raised_guard'), color: '#ff6633', opacity: 0.4 }]);

    expect(rings.group.children).toEqual(initialChildren);
    expect(
      rings.group.children
        .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
        .map((child) => child.geometry),
    ).toEqual(initialGeometries);
    expect(
      rings.group.children
        .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
        .map((child) => child.material),
    ).toEqual(initialMaterials);
    const updatedColor = new THREE.Color('#ff6633');
    expect(
      (
        initialChildren[0] as THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>
      ).material.color.toArray(),
    ).toEqual(updatedColor.clone().multiplyScalar(2).toArray());
    expect(
      (
        initialChildren[1] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
      ).material.color.toArray(),
    ).toEqual(updatedColor.clone().multiplyScalar(1.35).toArray());
    expect(
      (
        initialChildren[2] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
      ).material.color.toArray(),
    ).toEqual(updatedColor.clone().multiplyScalar(1.8).toArray());
    expect(rings.hasVisibleRings()).toBe(true);
  });

  it('refreshes opacity after a reduced-motion ring has settled', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([input('raised_guard')]);
    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0, true);

    rings.setRings([{ ...input('raised_guard'), opacity: 0.4 }]);
    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0, true);

    const ringOpacities = rings.group.children
      .filter(
        (child): child is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> =>
          child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
      )
      .map((child) => child.material.opacity);
    expect(Math.max(...ringOpacities)).toBeCloseTo(0.4);
  });

  it('builds the spell-specific number and kind of ornaments on every visible ring', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([input('raised_guard'), input('iron_resolve')]);

    const raised = rings.group.children.filter((child) =>
      child.name.startsWith('player_aura_ornament_raised_guard_'),
    );
    const resolve = rings.group.children.filter((child) =>
      child.name.startsWith('player_aura_ornament_iron_resolve_'),
    );

    expect(raised).toHaveLength(1);
    expect(resolve).toHaveLength(1);
    expect((raised[0] as THREE.InstancedMesh).count).toBe(6);
    expect((resolve[0] as THREE.InstancedMesh).count).toBe(8);
    expect(raised.every((child) => child.name.endsWith('_shield'))).toBe(true);
    expect(resolve.every((child) => child.name.endsWith('_diamond'))).toBe(true);
  });

  it('orbits ornaments around their own ring while keeping them terrain-grounded', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([input('revenge_free')]);
    const ornament = rings.group.children.find((child) =>
      child.name.startsWith('player_aura_ornament_revenge_free_'),
    );
    expect(ornament).toBeDefined();

    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0);
    const first = instancePosition(ornament as THREE.InstancedMesh);
    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 1);

    const second = instancePosition(ornament as THREE.InstancedMesh);
    expect(second.x).not.toBeCloseTo(first.x);
    expect(second.y).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });

  it('reduces low-tier ornament density without disabling orbit animation', () => {
    const rings = new PlayerAuraRings('low', false);
    rings.setRings([input('sudden_death')]);
    const ornaments = rings.group.children.filter((child) =>
      child.name.startsWith('player_aura_ornament_sudden_death_'),
    );
    expect(ornaments).toHaveLength(1);
    expect((ornaments[0] as THREE.InstancedMesh).count).toBe(5);

    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0);
    const first = instancePosition(ornaments[0] as THREE.InstancedMesh);
    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 1);

    expect(instancePosition(ornaments[0] as THREE.InstancedMesh).x).not.toBeCloseTo(first.x);
  });

  it('applies progressively richer low, medium, and high ring presentation', () => {
    const build = (tier: 'low' | 'medium' | 'high', bloom: boolean) => {
      const rings = new PlayerAuraRings(tier, bloom);
      rings.setRings([input('sudden_death')]);
      rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0);
      const meshes = rings.group.children.filter(
        (child): child is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> =>
          child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
      );
      const ornaments = rings.group.children.find(
        (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
      );
      if (!ornaments) throw new Error('expected one batched ornament mesh');
      return {
        ringSegments: meshes[0].geometry.parameters.thetaSegments,
        glowOpacity: meshes[0].material.opacity,
        glowBlue: meshes[0].material.color.b,
        coreRed: meshes[1].material.color.r,
        ornamentBlue: (ornaments.material as THREE.MeshBasicMaterial).color.b,
        ornamentCount: ornaments.count,
      };
    };

    const low = build('low', false);
    const medium = build('medium', false);
    const high = build('high', true);
    const highWithoutBloom = build('high', false);

    expect(low.ringSegments).toBe(32);
    expect(medium.ringSegments).toBe(48);
    expect(high.ringSegments).toBe(64);
    expect(low.ornamentCount).toBe(5);
    expect(medium.ornamentCount).toBe(8);
    expect(high.ornamentCount).toBe(10);
    expect(low.glowOpacity).toBeLessThan(medium.glowOpacity);
    expect(medium.glowOpacity).toBeLessThan(high.glowOpacity);
    expect(low.coreRed).toBeCloseTo(medium.coreRed);
    expect(high.coreRed).toBeGreaterThan(medium.coreRed);
    expect(high.glowBlue).toBeGreaterThan(medium.glowBlue);
    expect(high.ornamentBlue).toBeGreaterThan(medium.ornamentBlue);
    expect(high.coreRed).toBeGreaterThan(highWithoutBloom.coreRed);
    expect(high.glowBlue).toBeGreaterThan(highWithoutBloom.glowBlue);
    expect(high.ornamentBlue).toBeGreaterThan(highWithoutBloom.ornamentBlue);
  });

  it('stops cosmetic orbit and pulse motion and hides the group when requested', () => {
    const rings = new PlayerAuraRings('high', true);
    rings.setRings([input('hot_streak')]);
    const ornament = rings.group.children.find((child) =>
      child.name.startsWith('player_aura_ornament_hot_streak_'),
    );
    const materials = rings.group.children
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((child) => child.material)
      .filter(
        (material): material is THREE.MeshBasicMaterial =>
          material instanceof THREE.MeshBasicMaterial,
      );

    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 0, true);
    expect(rings.group.visible).toBe(true);
    const instanceVersion = (ornament as THREE.InstancedMesh).instanceMatrix.version;
    const first = instancePosition(ornament as THREE.InstancedMesh);
    const firstOpacities = materials.map((material) => material.opacity);
    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 10, true);

    expect(instancePosition(ornament as THREE.InstancedMesh)).toEqual(first);
    expect((ornament as THREE.InstancedMesh).instanceMatrix.version).toBe(instanceVersion);
    expect(materials.map((material) => material.opacity)).toEqual(firstOpacities);

    rings.update(true, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 10, false);
    expect(materials.map((material) => material.opacity)).not.toEqual(firstOpacities);

    rings.update(false, 0, -40, 0, 1234, Number.NEGATIVE_INFINITY, 10, true);
    expect(rings.group.visible).toBe(false);
  });

  it('wires production graphics quality, bloom, and reduced motion into the ring renderer', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

    expect(renderer).toContain('new PlayerAuraRings(GFX.effectsTier, GFX.composer)');
    const activeGuard = renderer.indexOf('this.playerAuraRings.hasVisibleRings()');
    const supportSample = renderer.indexOf('supportHeightAt(seed, px', activeGuard);
    const auraSync = renderer.slice(
      renderer.lastIndexOf('const playerView = this.views.get(p.id)', activeGuard),
      renderer.indexOf('this.updateClickMarkers(dt)', activeGuard),
    );
    expect(activeGuard).toBeGreaterThan(-1);
    expect(supportSample).toBeGreaterThan(activeGuard);
    expect(renderer.match(/supportHeightAt\(seed, px/g)).toHaveLength(1);
    expect(auraSync.match(/groundHeight\(px, pz, seed\)/g)).toHaveLength(1);
    expect(auraSync).toMatch(
      /if \(playerView && !p\.dead && this\.playerAuraRings\.hasVisibleRings\(\)\) \{[\s\S]*?supportHeightAt\(seed, px[\s\S]*?groundHeight\(px, pz, seed\)[\s\S]*?this\.playerAuraRings\.update\([\s\S]*?\n\s*\} else \{\n\s*this\.playerAuraRings\.update\(false/,
    );
    expect(renderer).toMatch(
      /this\.playerAuraRings\.update\([\s\S]*?this\.reducedMotion\(\),[\s\S]*?\);/,
    );
  });
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NecromancyArmyPortalFx } from '../src/render/necromancy_army_portal_fx';

function portalParts(scene: THREE.Scene) {
  const group = scene.getObjectByName('necromancy-army-portal') as THREE.Group;
  return {
    group,
    membrane: group.getObjectByName('necromancy-army-portal-membrane') as THREE.Mesh,
    outerRing: group.getObjectByName('necromancy-army-portal-outer-ring') as THREE.Mesh,
    innerRing: group.getObjectByName('necromancy-army-portal-inner-ring') as THREE.Mesh,
    chains: group.getObjectByName('necromancy-army-portal-chains') as THREE.LineSegments,
    runes: group.getObjectByName('necromancy-army-portal-runes') as THREE.LineSegments,
    floorSeal: group.getObjectByName('necromancy-army-portal-floor-seal') as THREE.Mesh,
    streams: group.getObjectByName('necromancy-army-portal-soul-streams') as THREE.Points,
    shadows: group.getObjectByName('necromancy-army-portal-emergence-shadows') as THREE.Group,
  };
}

describe('Necromancy Army portal VFX', () => {
  it('builds a towering portal with three distinct emergence lanes over the real terrain', () => {
    const scene = new THREE.Scene();
    const groundY = (x: number, z: number): number => x * 0.03 + z * 0.02;
    const fx = new NecromancyArmyPortalFx(scene, groundY);

    fx.spawn({ x: 6, z: 10, facing: Math.PI / 3, duration: 2.8 });
    const parts = portalParts(scene);

    expect(parts.group).toBeInstanceOf(THREE.Group);
    expect(parts.membrane).toBeInstanceOf(THREE.Mesh);
    expect(parts.outerRing).toBeInstanceOf(THREE.Mesh);
    expect(parts.innerRing).toBeInstanceOf(THREE.Mesh);
    expect(parts.chains).toBeInstanceOf(THREE.LineSegments);
    expect(parts.runes).toBeInstanceOf(THREE.LineSegments);
    expect(parts.floorSeal).toBeInstanceOf(THREE.Mesh);
    expect(parts.streams).toBeInstanceOf(THREE.Points);
    expect(parts.shadows.children).toHaveLength(3);
    expect(parts.shadows.children.map((shadow) => shadow.name)).toEqual([
      'necromancy-army-portal-warrior-shadow',
      'necromancy-army-portal-bone-mage-shadow',
      'necromancy-army-portal-gravewing-shadow',
    ]);
    expect(parts.shadows.children.map((shadow) => shadow.position.x)).toEqual([-1.05, 0, 1.05]);
    expect(parts.group.position.toArray()).toEqual([6, groundY(6, 10) + 0.08, 10]);
    expect(parts.group.rotation.y).toBeCloseTo(Math.PI / 3);

    const sealPositions = parts.floorSeal.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    for (let index = 0; index < sealPositions.count; index++) {
      const localX = sealPositions.getX(index);
      const localZ = sealPositions.getZ(index);
      const worldX = 6 + localX * Math.cos(Math.PI / 3) + localZ * Math.sin(Math.PI / 3);
      const worldZ = 10 - localX * Math.sin(Math.PI / 3) + localZ * Math.cos(Math.PI / 3);
      expect(sealPositions.getY(index) + groundY(6, 10) + 0.08).toBeCloseTo(
        groundY(worldX, worldZ) + 0.09,
        4,
      );
    }

    const before = parts.shadows.children.map((shadow) => shadow.position.z);
    fx.update(0.35);
    expect(parts.shadows.children.map((shadow) => shadow.position.z)).not.toEqual(before);
    expect(parts.outerRing.rotation.z).not.toBe(0);
  });

  it('freezes motion for reduced motion and sheds ornaments at low VFX quality', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn(() => 0);
    const fx = new NecromancyArmyPortalFx(scene, groundY);
    fx.spawn({ x: 0, z: 0, facing: 0, duration: 2.8 });
    const parts = portalParts(scene);
    const beforeRing = parts.outerRing.rotation.clone();
    const beforeInnerRing = parts.innerRing.rotation.clone();
    const beforeRunes = parts.runes.rotation.clone();
    const beforeChains = parts.chains.scale.clone();
    const beforeMembrane = parts.membrane.scale.clone();
    const beforeShadows = parts.shadows.children.map((shadow) => shadow.position.clone());
    const beforeStreams = (
      parts.streams.geometry.getAttribute('position') as THREE.BufferAttribute
    ).array.slice();

    fx.update(0.4, true);
    expect(parts.outerRing.rotation.toArray()).toEqual(beforeRing.toArray());
    expect(parts.innerRing.rotation.toArray()).toEqual(beforeInnerRing.toArray());
    expect(parts.runes.rotation.toArray()).toEqual(beforeRunes.toArray());
    expect(parts.chains.scale.toArray()).toEqual(beforeChains.toArray());
    expect(parts.membrane.scale.toArray()).toEqual(beforeMembrane.toArray());
    expect(parts.shadows.children.map((shadow) => shadow.position)).toEqual(beforeShadows);
    expect(
      Array.from((parts.streams.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(Array.from(beforeStreams));

    expect(parts.innerRing.visible).toBe(true);
    expect(parts.runes.visible).toBe(true);
    expect(parts.streams.visible).toBe(true);
    expect(parts.chains.visible).toBe(true);
    expect(parts.shadows.visible).toBe(true);
    expect(parts.streams.geometry.drawRange.count).toBe(72);

    fx.setQuality(0.2);
    expect(parts.membrane.visible).toBe(false);
    expect(parts.innerRing.visible).toBe(true);
    expect(parts.runes.visible).toBe(true);
    expect(parts.streams.visible).toBe(false);
    expect(parts.chains.visible).toBe(false);
    expect(parts.shadows.visible).toBe(false);

    fx.setQuality(0.4);
    expect(parts.membrane.visible).toBe(true);
    expect(parts.streams.visible).toBe(true);
    expect(parts.chains.visible).toBe(true);
    expect(parts.shadows.visible).toBe(false);
    expect(parts.streams.geometry.drawRange.count).toBeGreaterThan(18);

    fx.setQuality(0);
    expect(parts.membrane.visible).toBe(false);
    expect(parts.outerRing.visible).toBe(true);
    expect(parts.floorSeal.visible).toBe(true);
    expect(parts.streams.visible).toBe(false);
    expect(parts.chains.visible).toBe(false);
    expect(parts.shadows.visible).toBe(false);

    fx.setQuality(1);
    expect(parts.innerRing.visible).toBe(true);
    expect(parts.runes.visible).toBe(true);
    expect(parts.streams.visible).toBe(true);
    expect(parts.chains.visible).toBe(true);
    expect(parts.shadows.visible).toBe(true);
    expect(parts.streams.geometry.drawRange.count).toBe(72);
  });

  it('caps simultaneous portals and disposes every owned GPU resource', () => {
    const scene = new THREE.Scene();
    const fx = new NecromancyArmyPortalFx(scene, () => 0);
    fx.spawn({ x: 0, z: 0, facing: 0, duration: 3 });
    const oldest = portalParts(scene).group;
    const disposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    oldest.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      disposeSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        disposeSpies.push(vi.spyOn(material, 'dispose'));
      }
    });

    for (let index = 1; index <= 4; index++) {
      fx.spawn({ x: index * 2, z: 0, facing: 0, duration: 3 });
    }

    expect(scene.children.filter((child) => child.name === 'necromancy-army-portal')).toHaveLength(
      4,
    );
    expect(oldest.parent).toBeNull();
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledOnce();

    const remainingDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    for (const portal of scene.children.filter(
      (child) => child.name === 'necromancy-army-portal',
    )) {
      portal.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
        if (!renderable.geometry || !renderable.material) return;
        remainingDisposeSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
        for (const material of Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material]) {
          remainingDisposeSpies.push(vi.spyOn(material, 'dispose'));
        }
      });
    }
    const particleTexture = (
      fx as unknown as {
        particleTexture: THREE.DataTexture;
      }
    ).particleTexture;
    const textureDispose = vi.spyOn(particleTexture, 'dispose');

    fx.dispose();
    expect(scene.getObjectByName('necromancy-army-portal')).toBeUndefined();
    for (const spy of remainingDisposeSpies) expect(spy).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it('removes and disposes a portal when its duration expires', () => {
    const scene = new THREE.Scene();
    const fx = new NecromancyArmyPortalFx(scene, () => 0);
    fx.spawn({ x: 0, z: 0, facing: 0, duration: 0.5 });
    const portal = portalParts(scene).group;
    const disposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    portal.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      disposeSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        disposeSpies.push(vi.spyOn(material, 'dispose'));
      }
    });

    fx.update(0.5);

    expect(portal.parent).toBeNull();
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledOnce();
    fx.dispose();
  });
});

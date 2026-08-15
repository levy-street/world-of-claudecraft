import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NecromancyGroundFx } from '../src/render/necromancy_ground_fx';

describe('Necromancy ground effects', () => {
  it('holds Death Echo state at its authoritative world point and removes stale echoes', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.08 + z * 0.03;
    const fx = new NecromancyGroundFx(scene, heightAt);

    fx.syncDeathEcho(7, 'necromancy_death_echo_0', 5, 9);
    fx.update(0.25);

    const echo = scene.getObjectByName('necromancy-death-echo') as THREE.Group;
    expect(echo).toBeInstanceOf(THREE.Group);
    expect(echo.position.toArray()).toEqual([5, heightAt(5, 9) + 0.07, 9]);
    expect(echo.getObjectByName('necromancy-death-echo-seal')).toBeInstanceOf(THREE.Mesh);
    expect(echo.getObjectByName('necromancy-death-echo-runes')).toBeInstanceOf(THREE.LineSegments);
    expect(echo.getObjectByName('necromancy-death-echo-soul')).toBeInstanceOf(THREE.Mesh);

    fx.syncDeathEcho(7, 'necromancy_death_echo_0', 6, 10);
    fx.update(0.25);
    expect(echo.position.toArray()).toEqual([6, heightAt(6, 10) + 0.07, 10]);

    const resourceSpies: ReturnType<typeof vi.spyOn>[] = [];
    echo.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      resourceSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        resourceSpies.push(vi.spyOn(material, 'dispose'));
      }
    });
    fx.update(0.25);
    expect(scene.getObjectByName('necromancy-death-echo')).toBeUndefined();
    for (const spy of resourceSpies) expect(spy).toHaveBeenCalledOnce();
  });

  it('caps visible Death Echoes without leaking scene objects', () => {
    const scene = new THREE.Scene();
    const fx = new NecromancyGroundFx(scene, () => 0);

    for (let i = 0; i < 30; i++) {
      fx.syncDeathEcho(i, 'necromancy_death_echo_0', i, i);
    }
    fx.update(0.1);

    expect(scene.children.filter((child) => child.name === 'necromancy-death-echo')).toHaveLength(
      24,
    );
    fx.dispose();
    expect(scene.getObjectByName('necromancy-death-echo')).toBeUndefined();
  });

  it('drapes a bounded desecration over terrain and expires cleanly', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.06 + Math.sin(z * 0.3) * 0.4;
    const fx = new NecromancyGroundFx(scene, heightAt);

    fx.spawnDesecration({ x: 8, z: 12, radius: 6, duration: 4 });

    const zone = scene.getObjectByName('necromancy-desecration') as THREE.Group;
    const ring = zone.getObjectByName('necromancy-desecration-ring') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const runes = zone.getObjectByName('necromancy-desecration-runes') as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const wisps = zone.getObjectByName('necromancy-desecration-wisps') as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    expect(zone).toBeInstanceOf(THREE.Group);
    expect(ring).toBeInstanceOf(THREE.Mesh);
    expect(runes).toBeInstanceOf(THREE.LineSegments);

    const positions = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.07, 4);
    }
    const wispPositions = wisps.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wispPositions.count; i++) {
      const x = wispPositions.getX(i);
      const y = wispPositions.getY(i);
      const z = wispPositions.getZ(i);
      expect(y).toBeCloseTo(heightAt(x, z) + ((i * 0.37) % 1.8), 4);
    }

    const opacity = ring.material.opacity;
    fx.update(0.5);
    expect(ring.material.opacity).not.toBe(opacity);
    expect(runes.rotation.y).not.toBe(0);

    const resourceSpies: ReturnType<typeof vi.spyOn>[] = [];
    zone.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      resourceSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of materials) resourceSpies.push(vi.spyOn(material, 'dispose'));
    });
    fx.update(3.5);
    expect(scene.getObjectByName('necromancy-desecration')).toBeUndefined();
    for (const spy of resourceSpies) expect(spy).toHaveBeenCalledOnce();
  });

  it('caps simultaneous zones and disposes all remaining resources', () => {
    const scene = new THREE.Scene();
    const fx = new NecromancyGroundFx(scene, () => 0);

    fx.spawnDesecration({ x: 0, z: 0, radius: 8, duration: 6 });
    const oldest = scene.getObjectByName('necromancy-desecration') as THREE.Group;
    const evictionSpies: ReturnType<typeof vi.spyOn>[] = [];
    oldest.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      evictionSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of materials) evictionSpies.push(vi.spyOn(material, 'dispose'));
    });
    for (let i = 1; i < 12; i++) {
      fx.spawnDesecration({ x: i, z: i, radius: 8, duration: 6 });
    }
    expect(scene.children.filter((child) => child.name === 'necromancy-desecration')).toHaveLength(
      8,
    );
    expect(oldest.parent).toBeNull();
    for (const spy of evictionSpies) expect(spy).toHaveBeenCalledOnce();

    const remainingSpies: ReturnType<typeof vi.spyOn>[] = [];
    for (const zone of scene.children.filter((child) => child.name === 'necromancy-desecration')) {
      zone.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
        if (!renderable.geometry || !renderable.material) return;
        remainingSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const material of materials) remainingSpies.push(vi.spyOn(material, 'dispose'));
      });
    }
    fx.dispose();
    expect(scene.getObjectByName('necromancy-desecration')).toBeUndefined();
    for (const spy of remainingSpies) expect(spy).toHaveBeenCalledOnce();
  });

  it('keeps the zone static while reduced motion is active', () => {
    const scene = new THREE.Scene();
    const fx = new NecromancyGroundFx(scene, () => 0);
    fx.spawnDesecration({ x: 2, z: 3, radius: 8, duration: 6 });
    const zone = scene.getObjectByName('necromancy-desecration') as THREE.Group;
    const runes = zone.getObjectByName('necromancy-desecration-runes') as THREE.LineSegments;
    const wisps = zone.getObjectByName('necromancy-desecration-wisps') as THREE.Points;
    const before = (wisps.geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();

    fx.update(0.5, true);

    expect(runes.rotation.y).toBe(0);
    expect(
      Array.from((wisps.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(Array.from(before));
  });
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// physical/holy use the REAL src/render/vfx.ts values on purpose: they are
// the near-white schools the wash-out regression test below exercises, so
// the test only means something if they match what spawnRune sees in
// production. fire/frost/arcane keep their pre-existing arbitrary mock
// values (this suite's long-standing convention of asserting plumbing, not
// real-world hue) so no other test in this file needs updating.
vi.mock('../src/render/vfx', () => ({
  SCHOOL_COLORS: {
    fire: 0xff5a16,
    frost: 0x72cfff,
    arcane: 0xa86cff,
    physical: 0xffd28a,
    holy: 0xffe9a0,
  },
}));

import {
  capRingLightness,
  MageGroundFx,
  METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS,
} from '../src/render/mage_ground_fx';

describe('Mage meteor visual', () => {
  it('keeps an ambient falling meteor but hides its ground danger telegraph', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());

    fx.spawnMeteor({ x: 4, z: 7, radius: 2.4, duration: 3, showTelegraph: false });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    expect(root.getObjectByName('mage-meteor-body')?.visible).toBe(true);
    expect(root.getObjectByName('mage-meteor-telegraph')?.visible).toBe(false);
    expect(scene.getObjectByName('ground_fire_aoe')).toBeUndefined();
  });

  it('shows the danger circle before revealing a delayed falling meteor', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);

    fx.spawnMeteor({ x: 4, z: 7, radius: 2.4, duration: 2.5, warningLead: 0.75 });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const body = root.getObjectByName('mage-meteor-body') as THREE.Group;
    const trail = root.getObjectByName('mage-meteor-trail') as THREE.Group;
    expect(root.getObjectByName('mage-meteor-telegraph')?.visible).toBe(true);
    expect(body.visible).toBe(false);
    expect(trail.visible).toBe(false);

    fx.update(0.74);
    expect(body.visible).toBe(false);
    expect(landed).not.toHaveBeenCalled();

    fx.update(0.02);
    expect(body.visible).toBe(true);
    expect(trail.visible).toBe(true);
    expect(body.position.y).toBeGreaterThan(44);

    fx.update(1.74);
    expect(landed).toHaveBeenCalledWith(
      4,
      7,
      expect.objectContaining({ x: 4, z: 7, radius: 2.4, warningLead: 0.75 }),
    );
  });

  it('reconstructs a meteor mid-warning once and keeps its authoritative fall timing', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    const warning = {
      id: '77:912:0',
      x: 4,
      z: 7,
      radius: 2.4,
      duration: 2.5,
      remaining: 2,
      warningLead: 0.75,
    };

    fx.syncMeteorWarnings([warning]);
    fx.syncMeteorWarnings([warning]);

    const roots = scene.children.filter((child) => child.name === 'mage-meteor-fx');
    expect(roots).toHaveLength(1);
    const root = roots[0] as THREE.Group;
    expect(root.userData.persistentMeteorId).toBe(warning.id);
    expect(root.getObjectByName('mage-meteor-body')?.visible).toBe(false);

    fx.update(0.26);
    expect(root.getObjectByName('mage-meteor-body')?.visible).toBe(true);
    fx.update(1.74);
    expect(landed).toHaveBeenCalledOnce();
  });

  it('reconciles three encounter meteor streams without pruning any owner', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    const first = {
      id: 'ignivar:1',
      x: 1,
      z: 2,
      radius: 2.4,
      duration: 2.5,
      remaining: 2,
      warningLead: 0.75,
    };
    const second = {
      id: 'varkhul:1',
      x: 4,
      z: 5,
      radius: 3.5,
      duration: 1.8,
      remaining: 1.2,
      warningLead: 0,
    };
    const third = {
      id: 'varkhul-forgestorm:90:2:1:0',
      sourceId: 90,
      x: 7,
      z: 8,
      radius: 4,
      duration: 2.5,
      remaining: 1.5,
      warningLead: 0,
    };

    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [first],
      activeVarkhulAnvilMeteors: [second],
      activeVarkhulForgestormWarnings: [third],
    });
    expect(scene.children.filter((child) => child.name === 'mage-meteor-fx')).toHaveLength(3);
    fx.syncMeteorWarnings([], [second], [third]);
    expect(
      scene.children.find((child) => child.userData.persistentMeteorId === first.id),
    ).toBeUndefined();
    expect(
      scene.children.find((child) => child.userData.persistentMeteorId === second.id),
    ).toBeDefined();
    expect(
      scene.children.find((child) => child.userData.persistentMeteorId === third.id),
    ).toBeDefined();
    const forgestormMeteor = scene.children.find(
      (child) => child.userData.persistentMeteorId === third.id,
    ) as THREE.Group;
    expect(forgestormMeteor.getObjectByName('mage-meteor-body')?.visible).toBe(true);
    expect(forgestormMeteor.getObjectByName('mage-meteor-trail')?.visible).toBe(true);
  });

  it('lets the contributor fire disc own Ignivar ground detail without hiding countdown', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());

    fx.syncMeteorWarnings([
      {
        id: '77:912:0',
        x: 4,
        z: 7,
        radius: 2.4,
        duration: 2.5,
        remaining: 2,
        warningLead: 0.75,
      },
    ]);

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const contributorAoe = scene.getObjectByName('ground_fire_aoe') as THREE.Group;
    const contributorDisc = contributorAoe.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.CircleGeometry,
      THREE.ShaderMaterial
    >;
    expect(contributorAoe.visible).toBe(true);
    expect(contributorDisc.material.uniforms.uHeat.value).toBeCloseTo(1 - 0.89 ** 10, 6);
    expect(root.getObjectByName('mage-meteor-telegraph-footprint')?.visible).toBe(false);
    expect(root.getObjectByName('mage-meteor-telegraph-veins')?.visible).toBe(false);
    expect(root.getObjectByName('mage-meteor-telegraph-flames')?.visible).toBe(false);
    expect(root.getObjectByName('mage-meteor-telegraph-beacon-embers')?.visible).toBe(false);
    expect(root.getObjectByName('mage-meteor-telegraph-boundary')?.visible).toBe(true);
    expect(root.getObjectByName('mage-meteor-telegraph-countdown-ring')?.visible).toBe(true);

    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const countdown = root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const countdownPositions = countdown.geometry.getAttribute('position') as THREE.BufferAttribute;
    const countdownXBefore = countdownPositions.getX(0);
    const boundaryOpacityBefore = boundary.material.opacity;
    const countdownOpacityBefore = countdown.material.opacity;
    fx.update(METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS);
    expect(countdownPositions.getX(0)).not.toBe(countdownXBefore);
    expect(boundary.material.opacity).not.toBe(boundaryOpacityBefore);
    expect(countdown.material.opacity).not.toBe(countdownOpacityBefore);
    for (const name of [
      'mage-meteor-telegraph-footprint',
      'mage-meteor-telegraph-veins',
      'mage-meteor-telegraph-flames',
      'mage-meteor-telegraph-beacon-embers',
    ]) {
      expect(root.getObjectByName(name)?.visible).toBe(false);
    }

    fx.syncMeteorWarnings([
      {
        id: '77:912:0',
        x: 4,
        z: 7,
        radius: 2.4,
        duration: 2.5,
        remaining: 1,
        warningLead: 0.75,
      },
    ]);
    expect(contributorDisc.material.uniforms.uHeat.value).toBeCloseTo(1 - 0.89 ** 30, 6);

    const genericScene = new THREE.Scene();
    const genericFx = new MageGroundFx(genericScene, () => 0, vi.fn());
    genericFx.spawnMeteor({ x: 4, z: 7, radius: 2.4, duration: 2.5 });
    const genericRoot = genericScene.getObjectByName('mage-meteor-fx') as THREE.Group;
    expect(genericScene.getObjectByName('ground_fire_aoe')).toBeUndefined();
    for (const name of [
      'mage-meteor-telegraph-footprint',
      'mage-meteor-telegraph-veins',
      'mage-meteor-telegraph-flames',
      'mage-meteor-telegraph-beacon-embers',
    ]) {
      expect(genericRoot.getObjectByName(name)?.visible).toBe(true);
    }
  });

  it('hides the contributor fire disc with an explicitly hidden warning', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());

    fx.spawnMeteor({
      x: 4,
      z: 7,
      radius: 2.4,
      duration: 2.5,
      persistentId: '77:912:0',
      showTelegraph: false,
    });

    expect(scene.getObjectByName('ground_fire_aoe')?.visible).toBe(false);
  });

  it('deduplicates the live meteor event against its snapshot warning', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    const warning = {
      id: '77:912:0',
      x: 4,
      z: 7,
      radius: 2.4,
      duration: 2.5,
      remaining: 2.5,
      warningLead: 0.75,
    };

    fx.spawnMeteor({
      ...warning,
      persistentId: warning.id,
    });
    fx.syncMeteorWarnings([warning]);

    expect(scene.children.filter((child) => child.name === 'mage-meteor-fx')).toHaveLength(1);
  });

  it('advances an existing meteor to the latest authoritative remaining time', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    const warning = {
      id: '77:912:0',
      x: 4,
      z: 7,
      radius: 2.4,
      duration: 2.5,
      remaining: 2.5,
      warningLead: 0.75,
    };

    fx.syncMeteorWarnings([warning]);
    fx.update(0.25);
    fx.syncMeteorWarnings([{ ...warning, remaining: 1 }]);
    fx.update(0.99);
    expect(landed).not.toHaveBeenCalled();
    fx.update(0.01);
    expect(landed).toHaveBeenCalledOnce();
  });

  it('removes a persistent warning cancelled by authoritative state without landing it', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);

    fx.syncMeteorWarnings([
      {
        id: '77:912:0',
        x: 4,
        z: 7,
        radius: 2.4,
        duration: 2.5,
        remaining: 2,
        warningLead: 0.75,
      },
    ]);
    fx.syncMeteorWarnings([]);
    fx.update(3);

    expect(scene.children.filter((child) => child.name === 'mage-meteor-fx')).toHaveLength(0);
    expect(landed).not.toHaveBeenCalled();
  });

  it('resolves an authoritative impact once and removes its pending warning', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    const id = '77:912:0';

    fx.syncMeteorWarnings([
      {
        id,
        x: 4,
        z: 7,
        radius: 2.4,
        duration: 2.5,
        remaining: 0.1,
        warningLead: 0.75,
      },
    ]);
    fx.impactMeteor(id, 4, 7);
    fx.syncMeteorWarnings([
      {
        id,
        x: 4,
        z: 7,
        radius: 2.4,
        duration: 2.5,
        remaining: 0.1,
        warningLead: 0.75,
      },
    ]);
    fx.update(1);
    fx.syncMeteorWarnings([]);

    expect(scene.children.filter((child) => child.name === 'mage-meteor-fx')).toHaveLength(0);
    expect(landed).toHaveBeenCalledOnce();
    expect(landed).toHaveBeenCalledWith(4, 7);
  });

  it('builds an exact terrain-draped danger mark beneath the irregular molten rock', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number =>
      Math.sin(x * 0.31) * 0.8 + Math.cos(z * 0.27) * 0.55;
    const fx = new MageGroundFx(scene, heightAt, vi.fn());

    fx.spawnMeteor({ x: 10, z: 20, radius: 8, duration: 2 });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const rock = root.getObjectByName('mage-meteor-rock') as THREE.Mesh;
    const cracks = root.getObjectByName('mage-meteor-cracks') as THREE.Group;
    const trail = root.getObjectByName('mage-meteor-trail') as THREE.Group;
    const telegraph = root.getObjectByName('mage-meteor-telegraph') as THREE.Group;
    const footprint = root.getObjectByName('mage-meteor-telegraph-footprint') as THREE.Mesh;
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const countdown = root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh;
    const veins = root.getObjectByName('mage-meteor-telegraph-veins') as THREE.LineSegments;
    const flames = root.getObjectByName('mage-meteor-telegraph-flames') as THREE.InstancedMesh;
    const beaconEmbers = root.getObjectByName(
      'mage-meteor-telegraph-beacon-embers',
    ) as THREE.Points;

    expect(rock).toBeInstanceOf(THREE.Mesh);
    expect(rock.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect(cracks.children.length).toBeGreaterThanOrEqual(3);
    expect(trail.children.length).toBeGreaterThanOrEqual(2);
    expect(flames.count).toBeGreaterThanOrEqual(12);
    expect(footprint).toBeInstanceOf(THREE.Mesh);
    expect(countdown).toBeInstanceOf(THREE.Mesh);
    expect(beaconEmbers).toBeInstanceOf(THREE.Points);
    expect((footprint.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);
    expect((footprint.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.22);
    for (const material of [
      boundary.material as THREE.LineBasicMaterial,
      countdown.material as THREE.MeshBasicMaterial,
      veins.material as THREE.LineBasicMaterial,
      flames.material as THREE.MeshBasicMaterial,
    ]) {
      expect(material.color.r).toBeGreaterThan(material.color.g * 2.5);
      expect(material.color.r).toBeGreaterThan(material.color.b * 1.5);
    }

    const footprintPositions = footprint.geometry.getAttribute('position') as THREE.BufferAttribute;
    let footprintOuterRadius = 0;
    for (let i = 0; i < footprintPositions.count; i++) {
      const x = footprintPositions.getX(i);
      const y = footprintPositions.getY(i);
      const z = footprintPositions.getZ(i);
      const radius = Math.hypot(x - 10, z - 20);
      footprintOuterRadius = Math.max(footprintOuterRadius, radius);
      expect(radius).toBeLessThanOrEqual(8.0001);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.045, 4);
    }
    expect(footprintOuterRadius).toBeCloseTo(8, 4);

    const positions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(8, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.09, 4);
    }

    const countdownPositions = countdown.geometry.getAttribute('position') as THREE.BufferAttribute;
    let countdownOuterRadius = 0;
    for (let i = 0; i < countdownPositions.count; i++) {
      const x = countdownPositions.getX(i);
      const y = countdownPositions.getY(i);
      const z = countdownPositions.getZ(i);
      countdownOuterRadius = Math.max(countdownOuterRadius, Math.hypot(x - 10, z - 20));
      expect(y).toBeCloseTo(heightAt(x, z) + 0.085, 4);
    }
    expect(countdownOuterRadius).toBeCloseTo(8 * 0.84, 4);

    const veinPositions = veins.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(veinPositions.count).toBeGreaterThan(200);
    expect((veins.material as THREE.LineBasicMaterial).opacity).toBeGreaterThanOrEqual(0.3);
    for (let i = 0; i < veinPositions.count; i++) {
      const x = veinPositions.getX(i);
      const y = veinPositions.getY(i);
      const z = veinPositions.getZ(i);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.075, 4);
    }

    const beaconPositions = beaconEmbers.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(beaconPositions.count).toBeGreaterThanOrEqual(12);
    expect(beaconEmbers.position.x).toBe(10);
    expect(beaconEmbers.position.y).toBeCloseTo(heightAt(10, 20) + 0.1, 4);
    expect(beaconEmbers.position.z).toBe(20);
    expect((beaconEmbers.material as THREE.PointsMaterial).opacity).toBeLessThanOrEqual(0.22);
    for (let i = 0; i < beaconPositions.count; i++) {
      expect(beaconPositions.getY(i)).toBeGreaterThan(0);
      expect(beaconPositions.getY(i)).toBeLessThanOrEqual(4.8);
    }
    const flameMatrix = new THREE.Matrix4();
    const flamePosition = new THREE.Vector3();
    for (let i = 0; i < flames.count; i++) {
      flames.getMatrixAt(i, flameMatrix);
      flamePosition.setFromMatrixPosition(flameMatrix);
      expect(flamePosition.y).toBeCloseTo(heightAt(flamePosition.x, flamePosition.z) + 0.46, 4);
    }
    const rockPositions = rock.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minRadius = Number.POSITIVE_INFINITY;
    let maxRadius = 0;
    for (let i = 0; i < rockPositions.count; i++) {
      const radius = Math.hypot(
        rockPositions.getX(i),
        rockPositions.getY(i),
        rockPositions.getZ(i),
      );
      minRadius = Math.min(minRadius, radius);
      maxRadius = Math.max(maxRadius, radius);
    }
    expect(maxRadius - minRadius).toBeGreaterThan(0.12);
    expect(telegraph.parent).toBe(root);
  });

  it('collapses and intensifies the countdown ring without moving the exact boundary', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.035 - z * 0.018;
    const fx = new MageGroundFx(scene, heightAt, vi.fn());
    fx.spawnMeteor({ x: -6, z: 11, radius: 9, duration: 4 });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const countdown = root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const veins = root.getObjectByName('mage-meteor-telegraph-veins') as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    const initialCountdownOpacity = countdown.material.opacity;
    const initialVeinOpacity = veins.material.opacity;
    const initialPositions = countdown.geometry.getAttribute('position') as THREE.BufferAttribute;
    let initialRadius = 0;
    for (let i = 0; i < initialPositions.count; i++) {
      initialRadius = Math.max(
        initialRadius,
        Math.hypot(initialPositions.getX(i) + 6, initialPositions.getZ(i) - 11),
      );
    }

    fx.update(3.2);

    const latePositions = countdown.geometry.getAttribute('position') as THREE.BufferAttribute;
    let lateRadius = 0;
    for (let i = 0; i < latePositions.count; i++) {
      const x = latePositions.getX(i);
      const y = latePositions.getY(i);
      const z = latePositions.getZ(i);
      lateRadius = Math.max(lateRadius, Math.hypot(x + 6, z - 11));
      expect(y).toBeCloseTo(heightAt(x, z) + 0.085, 4);
    }
    expect(lateRadius).toBeLessThan(initialRadius * 0.45);
    expect(countdown.material.opacity).toBeGreaterThan(initialCountdownOpacity);
    expect(veins.material.opacity).toBeGreaterThan(initialVeinOpacity);

    const boundaryPositions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < boundaryPositions.count; i++) {
      expect(Math.hypot(boundaryPositions.getX(i) + 6, boundaryPositions.getZ(i) - 11)).toBeCloseTo(
        9,
        4,
      );
    }
  });

  it('lands on schedule, leaves a fading central fire, then removes every transient mesh', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 3, landed);
    fx.spawnMeteor({
      x: 4,
      z: 7,
      radius: 8,
      duration: 2,
      sourceId: 42,
      ability: 'summon_infernal',
    });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const material = boundary.material as THREE.LineBasicMaterial;
    const initialOpacity = material.opacity;
    const disposedMaterials = new Set<THREE.Material>();
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    root.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Line | THREE.Points;
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const ownedMaterial of materials) {
          ownedMaterial.addEventListener('dispose', () => disposedMaterials.add(ownedMaterial));
        }
      }
      if (
        object.name === 'mage-meteor-telegraph-footprint' ||
        object.name === 'mage-meteor-telegraph-boundary' ||
        object.name === 'mage-meteor-telegraph-countdown-ring' ||
        object.name === 'mage-meteor-telegraph-veins' ||
        object.name === 'mage-meteor-telegraph-beacon-embers' ||
        object.name === 'mage-meteor-trail-embers'
      ) {
        const ownedGeometry = renderable.geometry;
        ownedGeometry.addEventListener('dispose', () => disposedGeometries.add(ownedGeometry));
      }
    });

    fx.update(1.6);
    expect(material.opacity).toBeGreaterThan(initialOpacity);
    expect(landed).not.toHaveBeenCalled();

    fx.update(0.4);
    expect(landed).toHaveBeenCalledWith(
      4,
      7,
      expect.objectContaining({
        x: 4,
        z: 7,
        radius: 8,
        duration: 2,
        sourceId: 42,
        ability: 'summon_infernal',
      }),
    );
    expect(scene.getObjectByName('mage-meteor-fx')).toBe(root);
    expect(material.opacity).toBe(0);
    const impactFireOpacity = (
      root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >
    ).material.opacity;
    expect(impactFireOpacity).toBeGreaterThan(0);

    fx.update(1);
    expect(scene.getObjectByName('mage-meteor-fx')).toBe(root);
    expect(
      (
        root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial
        >
      ).material.opacity,
    ).toBeLessThan(impactFireOpacity);

    fx.update(1.3);
    expect(scene.getObjectByName('mage-meteor-fx')).toBeUndefined();
    // Materials are pooled by kind instead of disposed on expiry: a burst of
    // casts (raid boss Meteor Shower) reuses the retired batch rather than
    // paying dispose + fresh-allocate every cast. Per-instance geometry
    // (baked from the spawn's own position) still can't be shared, so it
    // still disposes as before.
    expect(disposedMaterials.size).toBe(0);
    expect(disposedGeometries.size).toBe(6);
  });

  it('recycles retired meteor materials into a later cast instead of allocating fresh ones', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnMeteor({ x: 4, z: 7, radius: 8, duration: 2 });
    const firstRoot = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const firstRock = firstRoot.getObjectByName('mage-meteor-rock') as THREE.Mesh;
    const firstBoundary = firstRoot.getObjectByName(
      'mage-meteor-telegraph-boundary',
    ) as THREE.LineLoop;
    const firstFootprint = firstRoot.getObjectByName(
      'mage-meteor-telegraph-footprint',
    ) as THREE.Mesh;
    const firstCountdown = firstRoot.getObjectByName(
      'mage-meteor-telegraph-countdown-ring',
    ) as THREE.Mesh;
    const firstBeacon = firstRoot.getObjectByName(
      'mage-meteor-telegraph-beacon-embers',
    ) as THREE.Points;
    const firstRockMat = firstRock.material as THREE.MeshStandardMaterial;
    const firstBoundaryMat = firstBoundary.material as THREE.LineBasicMaterial;
    const firstFootprintMat = firstFootprint.material as THREE.MeshBasicMaterial;
    const firstCountdownMat = firstCountdown.material as THREE.MeshBasicMaterial;
    const firstBeaconMat = firstBeacon.material as THREE.PointsMaterial;

    // Run the first meteor all the way through fall, scorch, and cleanup.
    fx.update(2); // fall completes, lands
    fx.update(2.2); // scorch linger (METEOR_SCORCH_LINGER = 2.2) elapses, retires
    expect(scene.getObjectByName('mage-meteor-fx')).toBeUndefined();

    fx.spawnMeteor({ x: 40, z: -12, radius: 8, duration: 2 });
    const secondRoot = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const secondRock = secondRoot.getObjectByName('mage-meteor-rock') as THREE.Mesh;
    const secondBoundary = secondRoot.getObjectByName(
      'mage-meteor-telegraph-boundary',
    ) as THREE.LineLoop;
    const secondFootprint = secondRoot.getObjectByName(
      'mage-meteor-telegraph-footprint',
    ) as THREE.Mesh;
    const secondCountdown = secondRoot.getObjectByName(
      'mage-meteor-telegraph-countdown-ring',
    ) as THREE.Mesh;
    const secondBeacon = secondRoot.getObjectByName(
      'mage-meteor-telegraph-beacon-embers',
    ) as THREE.Points;

    // Same Material instances come back out of the free list...
    expect(secondRock.material).toBe(firstRockMat);
    expect(secondBoundary.material).toBe(firstBoundaryMat);
    expect(secondFootprint.material).toBe(firstFootprintMat);
    expect(secondCountdown.material).toBe(firstCountdownMat);
    expect(secondBeacon.material).toBe(firstBeaconMat);
    // ...reset to their config baseline opacity, not whatever the retired
    // instance last animated to (boundary opacity was driven to 0 at landing).
    expect((secondFootprint.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.2, 5);
    expect((secondBoundary.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(0.58, 5);
    expect((secondCountdown.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.34, 5);
    expect((secondBeacon.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.18, 5);
  });

  it('returns repeated cast and expiry cycles to a stable scene and pool baseline', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    const baselineChildren = scene.children.length;
    const pool = (fx as unknown as { materialPool: Map<string, THREE.Material[]> }).materialPool;
    const pooledCounts: number[] = [];

    for (let cast = 0; cast < 8; cast++) {
      fx.spawnMeteor({ x: cast * 3, z: -cast, radius: 5, duration: 0.2 });
      fx.spawnRune({ x: cast * 3, z: -cast, radius: 4, duration: 0.2, school: 'fire' });
      fx.spawnSnow({ x: cast * 3, z: -cast, radius: 4, duration: 0.2 });
      fx.update(0.25);
      fx.update(2.25); // beyond the meteor's scorch linger

      expect(scene.children).toHaveLength(baselineChildren);
      pooledCounts.push(
        [...pool.values()].reduce((total, materials) => total + materials.length, 0),
      );
    }

    expect(pooledCounts[0]).toBeGreaterThan(0);
    expect(pooledCounts.slice(1).every((count) => count === pooledCounts[0])).toBe(true);
  });

  it('never hands a live meteor material to a second concurrent cast', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnMeteor({ x: 4, z: 7, radius: 8, duration: 5 });
    fx.spawnMeteor({ x: -9, z: 15, radius: 8, duration: 5 });
    const roots = scene.children.filter((child) => child.name === 'mage-meteor-fx');
    expect(roots.length).toBe(2);
    const [firstRoot, secondRoot] = roots as THREE.Group[];
    const firstRock = (firstRoot.getObjectByName('mage-meteor-rock') as THREE.Mesh)
      .material as THREE.Material;
    const secondRock = (secondRoot.getObjectByName('mage-meteor-rock') as THREE.Mesh)
      .material as THREE.Material;
    expect(secondRock).not.toBe(firstRock);
  });

  it('bounds terrain sampling and countdown uploads for five concurrent raid warnings', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn(() => 0);
    const fx = new MageGroundFx(scene, groundY, vi.fn());
    for (let i = 0; i < 5; i++) {
      fx.spawnMeteor({ x: i * 3, z: i * -2, radius: 8, duration: 5 });
    }
    const countdowns = scene.children.map(
      (root) => root.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh,
    );
    const countdownPositions = countdowns.map(
      (countdown) => countdown.geometry.attributes.position as THREE.BufferAttribute,
    );
    const initialUploadVersions = countdownPositions.map((positions) => positions.version);
    groundY.mockClear();

    fx.update(METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS * 0.4);

    expect(groundY).not.toHaveBeenCalled();
    expect(countdownPositions.map((positions) => positions.version)).toEqual(initialUploadVersions);

    fx.update(METEOR_COUNTDOWN_GEOMETRY_UPDATE_SECONDS * 0.6);

    expect(groundY).toHaveBeenCalledTimes(5 * 72 * 2);
    expect(
      countdownPositions.every(
        (positions, index) => positions.version > initialUploadVersions[index],
      ),
    ).toBe(true);
  });

  it('keeps the Blizzard boundary visible until the zone expires', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnSnow({ x: 4, z: 7, radius: 7, duration: 6.5 });

    const ring = scene.getObjectByName('mage-blizzard-boundary') as THREE.Mesh<
      THREE.RingGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(ring).toBeInstanceOf(THREE.Mesh);
    const initialOpacity = ring.material.opacity;

    fx.update(5.95);
    expect(ring.material.opacity).toBeGreaterThan(0);
    expect(ring.material.opacity).not.toBe(initialOpacity);

    fx.update(0.54);
    expect(scene.getObjectByName('mage-blizzard-boundary')).toBe(ring);
    expect(ring.material.opacity).toBeGreaterThan(0);

    fx.update(0.01);
    expect(scene.getObjectByName('mage-blizzard-boundary')).toBeUndefined();
  });

  it('recycles retired Blizzard snow/boundary materials into a later cast', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnSnow({ x: 4, z: 7, radius: 7, duration: 1 });
    const firstSnow = scene.getObjectByName('mage-blizzard-snow') as THREE.Points;
    const firstRing = scene.getObjectByName('mage-blizzard-boundary') as THREE.Mesh;
    const firstSnowMat = firstSnow.material as THREE.PointsMaterial;
    const firstRingMat = firstRing.material as THREE.MeshBasicMaterial;

    fx.update(1.1); // past duration, retires
    expect(scene.getObjectByName('mage-blizzard-snow')).toBeUndefined();

    fx.spawnSnow({ x: -20, z: 30, radius: 5, duration: 1 });
    const secondSnow = scene.getObjectByName('mage-blizzard-snow') as THREE.Points;
    const secondRing = scene.getObjectByName('mage-blizzard-boundary') as THREE.Mesh;
    expect(secondSnow.material).toBe(firstSnowMat);
    expect(secondRing.material).toBe(firstRingMat);
    expect((secondSnow.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.9, 5);
    expect((secondRing.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.55, 5);
  });

  it('drapes Rune of Power over uneven terrain instead of clipping through it', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.08 + Math.sin(z * 0.4) * 0.7;
    const fx = new MageGroundFx(scene, heightAt, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12 });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    expect(rune).toBeInstanceOf(THREE.Group);
    const surfaces = [
      'mage-rune-power-outer-ring',
      'mage-rune-power-inner-ring',
      'mage-rune-power-glow',
      ...Array.from({ length: 4 }, (_, index) => `mage-rune-power-spoke-${index}`),
    ];
    for (const name of surfaces) {
      const surface = rune.getObjectByName(name) as THREE.Mesh;
      expect(surface).toBeInstanceOf(THREE.Mesh);
      const positions = surface.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(y).toBeCloseTo(heightAt(x, z) + 0.08, 4);
      }
    }

    fx.update(12);
    expect(scene.getObjectByName('mage-rune-power')).toBeUndefined();
  });

  it('recycles retired Rune of Power materials into a later cast', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12 });
    const firstRune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const firstGlow = firstRune.getObjectByName('mage-rune-power-glow') as THREE.Mesh;
    const firstOuterRing = firstRune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const firstGlowMat = firstGlow.material as THREE.MeshBasicMaterial;
    const firstOuterRingMat = firstOuterRing.material as THREE.MeshBasicMaterial;

    fx.update(12); // past duration, retires
    expect(scene.getObjectByName('mage-rune-power')).toBeUndefined();

    fx.spawnRune({ x: -30, z: 5, radius: 6, duration: 12 });
    const secondRune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const secondGlow = secondRune.getObjectByName('mage-rune-power-glow') as THREE.Mesh;
    const secondOuterRing = secondRune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    expect(secondGlow.material).toBe(firstGlowMat);
    expect(secondOuterRing.material).toBe(firstOuterRingMat);
    expect((secondGlow.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.18, 5);
    expect((secondOuterRing.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.75, 5);
  });

  it('keeps the mage-cast Rune of Power arcane when no mechanic school is given', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12 });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outerRing = rune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const expected = capRingLightness(new THREE.Color(0xa86cff)).multiplyScalar(1.6);
    expect((outerRing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(expected.getHex());
  });

  it('falls back to arcane for an unrecognized school string instead of an undefined color', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12, school: 'chaos' });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outerRing = rune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const expected = capRingLightness(new THREE.Color(0xa86cff)).multiplyScalar(1.6);
    expect((outerRing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(expected.getHex());
  });

  it('tints a rift boss windup telegraph by its emitted mechanic school, not a hardcoded arcane', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12, school: 'fire' });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outerRing = rune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const innerRing = rune.getObjectByName('mage-rune-power-inner-ring') as THREE.Mesh;
    const spoke = rune.getObjectByName('mage-rune-power-spoke-0') as THREE.Mesh;
    const glow = rune.getObjectByName('mage-rune-power-glow') as THREE.Mesh;

    const fire = capRingLightness(new THREE.Color(0xff5a16));
    expect((outerRing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      fire.clone().multiplyScalar(1.6).getHex(),
    );
    expect((innerRing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      fire.clone().multiplyScalar(1.6).getHex(),
    );
    expect((spoke.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      fire.clone().multiplyScalar(1.3).getHex(),
    );
    expect((glow.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      fire.clone().multiplyScalar(0.9).getHex(),
    );
  });

  it('never lets a pooled material carry a stale school tint into a differently-schooled cast', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 1, school: 'fire' });
    fx.update(1.1); // past duration, retires into the material pool

    fx.spawnRune({ x: -30, z: 5, radius: 6, duration: 12, school: 'frost' });
    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outerRing = rune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const frost = capRingLightness(new THREE.Color(0x72cfff));
    expect((outerRing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      frost.clone().multiplyScalar(1.6).getHex(),
    );
  });

  it('keeps a near-white school distinguishable instead of clipping the ring to white (Warlord Grask stomp windup, issue #2917)', () => {
    // rift_boss_brute (Warlord Grask)'s stomp authors no school and falls
    // back to physical (src/sim/mob/locomotion.ts fireWarStomp), the exact
    // real case this regresses without the lightness cap: physical
    // (0xffd28a) is already near-white, and the ring's *1.6 multiplier used
    // to clip every channel to white, so the "danger" ring stopped reading
    // as a distinct color against bright terrain.
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12, school: 'physical' });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outerRing = rune.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const color = (outerRing.material as THREE.MeshBasicMaterial).color;
    const uncapped = new THREE.Color(0xffd28a).multiplyScalar(1.6);
    expect(color.getHex()).not.toBe(uncapped.getHex());
    // Not washed to white: at least one channel stays well below full.
    expect(Math.min(color.r, color.g, color.b)).toBeLessThan(0.85);
  });

  it('disposes active roots, owned resources, and the retired material pool exactly once', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());

    // Retire one school first so terminal disposal also has to drain a pooled
    // material that is no longer reachable from the scene graph.
    fx.spawnRune({ x: 2, z: 3, radius: 4, duration: 0.1, school: 'fire' });
    fx.update(0.2);
    const pool = (fx as unknown as { materialPool: Map<string, THREE.Material[]> }).materialPool;
    expect(pool.size).toBeGreaterThan(0);
    const pooledMaterial = [...pool.values()][0][0];
    const pooledDispose = vi.spyOn(pooledMaterial, 'dispose');

    fx.spawnMeteor({ x: 10, z: 20, radius: 6, duration: 5 });
    fx.spawnRune({ x: -4, z: 8, radius: 4, duration: 5, school: 'frost' });
    fx.spawnSnow({ x: 14, z: -6, radius: 5, duration: 5 });

    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    scene.traverse((object) => {
      const drawable = object as THREE.Mesh | THREE.Line | THREE.Points;
      const material = drawable.material;
      if (material) {
        for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry);
      }
      if (drawable.geometry) geometries.add(drawable.geometry);
    });
    const materialDisposals = [...materials].map((material) => vi.spyOn(material, 'dispose'));
    const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));

    fx.dispose();

    expect(scene.children).toHaveLength(0);
    expect((fx as unknown as { meteors: unknown[] }).meteors).toHaveLength(0);
    expect((fx as unknown as { runes: unknown[] }).runes).toHaveLength(0);
    expect((fx as unknown as { snows: unknown[] }).snows).toHaveLength(0);
    expect(pool.size).toBe(0);
    expect(pooledDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();

    fx.dispose();
    expect(pooledDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('continues terminal cleanup after an owned root and geometry failure', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnMeteor({ x: 10, z: 20, radius: 6, duration: 5 });
    fx.spawnSnow({ x: -4, z: 8, radius: 5, duration: 5 });

    const firstRoot = scene.children[0];
    const rootDetach = vi.spyOn(firstRoot, 'removeFromParent').mockImplementationOnce(() => {
      throw new Error('root detach');
    });
    const geometries = new Set<THREE.BufferGeometry>();
    scene.traverse((object) => {
      const drawable = object as THREE.Mesh | THREE.Line | THREE.Points;
      if (drawable.geometry) geometries.add(drawable.geometry);
    });
    const [firstGeometry, laterGeometry] = [...geometries];
    expect(firstGeometry).toBeDefined();
    expect(laterGeometry).toBeDefined();
    const firstDispose = vi.spyOn(firstGeometry, 'dispose').mockImplementationOnce(() => {
      throw new Error('geometry dispose');
    });
    const laterDispose = vi.spyOn(laterGeometry, 'dispose');

    expect(() => fx.dispose()).toThrow(AggregateError);
    expect(rootDetach).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(laterDispose).toHaveBeenCalledOnce();
    // removeFromParent threw but the parent.remove fallback landed, so the
    // node really is off the scene and its entry is NOT retained: retention is
    // judged on where the node ended up, never on whether an attempt threw.
    expect(scene.children).toHaveLength(0);
    expect((fx as unknown as { meteors: unknown[] }).meteors).toHaveLength(0);
    expect((fx as unknown as { snows: unknown[] }).snows).toHaveLength(0);

    // The geometry whose dispose threw IS retained, so the second pass
    // re-attempts exactly it and nothing else. Nulling it on the first pass
    // would have dropped the last reference to live GPU memory.
    fx.dispose();
    expect(firstDispose).toHaveBeenCalledTimes(2);
    expect(laterDispose).toHaveBeenCalledOnce();
  });

  it('retains a root it could not detach, so a later dispose can try again', () => {
    // The failure that matters: a root still attached to the scene is still
    // DRAWING. Clearing its entry would strand it with nothing holding a
    // reference and no route to a second attempt.
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnMeteor({ x: 10, z: 20, radius: 6, duration: 5 });

    const root = scene.children[0];
    // Both detach arms fail, so the node genuinely stays in the scene.
    const removeFromParent = vi.spyOn(root, 'removeFromParent').mockImplementationOnce(() => {
      throw new Error('root detach');
    });
    const sceneRemove = vi.spyOn(scene, 'remove').mockImplementationOnce(() => {
      throw new Error('scene remove');
    });

    expect(() => fx.dispose()).toThrow(AggregateError);
    expect(removeFromParent).toHaveBeenCalledOnce();
    expect(sceneRemove).toHaveBeenCalledOnce();
    expect(scene.children).toContain(root);
    const meteors = (fx as unknown as { meteors: unknown[] }).meteors;
    expect(meteors).toHaveLength(1);

    // The retry detaches it for real and drops the entry.
    fx.dispose();
    expect(scene.children).not.toContain(root);
    expect(meteors).toHaveLength(0);
  });

  it('retains failed pooled material occupancy for a retry', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnRune({ x: 2, z: 3, radius: 4, duration: 0.1, school: 'fire' });
    fx.update(0.2);

    const pool = (fx as unknown as { materialPool: Map<string, THREE.Material[]> }).materialPool;
    const pooledMaterial = [...pool.values()][0][0];
    const disposal = vi.spyOn(pooledMaterial, 'dispose').mockImplementationOnce(() => {
      throw new Error('pooled material dispose');
    });
    expect(() => fx.dispose()).toThrow(AggregateError);
    expect(pool.size).toBeGreaterThan(0);
    expect([...pool.values()].flat()).toContain(pooledMaterial);

    // The retry the retention exists for: a second dispose really re-attempts
    // the retained material and, on success, drops it from the pool.
    fx.dispose();
    expect(disposal).toHaveBeenCalledTimes(2);
    expect([...pool.values()].flat()).not.toContain(pooledMaterial);
  });

  it('keeps releasing the rest after one owned resource fails to dispose', () => {
    // Unlike the pooled materials above, owned geometries are NOT retained:
    // dispose() clears `meteors`, so the reference is gone either way. What
    // this pins is that the failure is aggregated rather than fatal, and that
    // the resources after it in the sweep are still released.
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnMeteor({ x: 10, z: 20, radius: 6, duration: 5 });
    const meteor = (
      fx as unknown as {
        meteors: { ownedGeometries: THREE.BufferGeometry[]; rockMat: THREE.Material }[];
      }
    ).meteors[0];
    const ownedGeometry = meteor.ownedGeometries[0];
    const laterGeometry = meteor.ownedGeometries[meteor.ownedGeometries.length - 1];
    expect(laterGeometry).not.toBe(ownedGeometry);
    vi.spyOn(ownedGeometry, 'dispose').mockImplementationOnce(() => {
      throw new Error('owned geometry dispose');
    });
    const laterDispose = vi.spyOn(laterGeometry, 'dispose');
    const materialDispose = vi.spyOn(meteor.rockMat, 'dispose');

    expect(() => fx.dispose()).toThrow(AggregateError);
    expect(laterDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect((fx as unknown as { meteors: unknown[] }).meteors).toHaveLength(0);
  });

  it('ignores late spawns and frame updates after terminal disposal', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 3, landed);
    const sceneAdd = vi.spyOn(scene, 'add');
    const ensureMeteorGeometry = vi.spyOn(
      fx as unknown as { ensureMeteorGeometry: () => unknown },
      'ensureMeteorGeometry',
    );

    fx.dispose();
    fx.spawnMeteor({ x: 10, z: 20, radius: 6, duration: 0.1 });
    fx.spawnRune({ x: -4, z: 8, radius: 4, duration: 0.1 });
    fx.spawnSnow({ x: 14, z: -6, radius: 5, duration: 0.1 });
    fx.update(10);

    expect(scene.children).toHaveLength(0);
    expect(sceneAdd).not.toHaveBeenCalled();
    expect(ensureMeteorGeometry).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
    expect((fx as unknown as { meteors: unknown[] }).meteors).toHaveLength(0);
    expect((fx as unknown as { runes: unknown[] }).runes).toHaveLength(0);
    expect((fx as unknown as { snows: unknown[] }).snows).toHaveLength(0);
  });
});

describe('capRingLightness', () => {
  it('caps a near-white color to a distinguishable lightness while preserving hue', () => {
    const paleGold = new THREE.Color(0xffe9a0); // real SCHOOL_COLORS.holy
    const hslBefore = { h: 0, s: 0, l: 0 };
    paleGold.getHSL(hslBefore);
    expect(hslBefore.l).toBeGreaterThan(0.5);

    const capped = capRingLightness(paleGold);
    const hslAfter = { h: 0, s: 0, l: 0 };
    capped.getHSL(hslAfter);
    expect(hslAfter.l).toBeCloseTo(0.5, 5);
    expect(hslAfter.h).toBeCloseTo(hslBefore.h, 5);
  });

  it('leaves an already-dark color unchanged', () => {
    const dark = new THREE.Color().setHSL(0.3, 0.8, 0.3);
    const capped = capRingLightness(dark);
    expect(capped.getHex()).toBe(dark.getHex());
    expect(capped).not.toBe(dark); // clone, never mutates the input
  });

  it('never mutates its input', () => {
    const original = new THREE.Color(0xffe9a0);
    const originalHex = original.getHex();
    capRingLightness(original);
    expect(original.getHex()).toBe(originalHex);
  });
});

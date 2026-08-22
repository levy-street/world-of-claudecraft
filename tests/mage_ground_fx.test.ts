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

import { capRingLightness, MageGroundFx } from '../src/render/mage_ground_fx';

describe('Mage meteor visual', () => {
  it('builds an irregular molten rock with a terrain-draped flame telegraph', () => {
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
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const innerRing = root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop;
    const veins = root.getObjectByName('mage-meteor-telegraph-veins') as THREE.LineSegments;
    const flames = root.getObjectByName('mage-meteor-telegraph-flames') as THREE.InstancedMesh;

    expect(rock).toBeInstanceOf(THREE.Mesh);
    expect(rock.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect(cracks.children.length).toBeGreaterThanOrEqual(3);
    expect(trail.children.length).toBeGreaterThanOrEqual(2);
    expect(flames.count).toBeGreaterThanOrEqual(12);

    const positions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(8, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.08, 4);
    }
    const innerPositions = innerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < innerPositions.count; i++) {
      const x = innerPositions.getX(i);
      const y = innerPositions.getY(i);
      const z = innerPositions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(8 * 0.62, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.075, 4);
    }
    const veinPositions = veins.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(veinPositions.count).toBeGreaterThan(20);
    for (let i = 0; i < veinPositions.count; i++) {
      const x = veinPositions.getX(i);
      const y = veinPositions.getY(i);
      const z = veinPositions.getZ(i);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.07, 4);
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
        object.name === 'mage-meteor-telegraph-boundary' ||
        object.name === 'mage-meteor-telegraph-inner-ring' ||
        object.name === 'mage-meteor-telegraph-veins' ||
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
      root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop<
        THREE.BufferGeometry,
        THREE.LineBasicMaterial
      >
    ).material.opacity;
    expect(impactFireOpacity).toBeGreaterThan(0);

    fx.update(1);
    expect(scene.getObjectByName('mage-meteor-fx')).toBe(root);
    expect(
      (
        root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop<
          THREE.BufferGeometry,
          THREE.LineBasicMaterial
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
    expect(disposedGeometries.size).toBe(4);
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
    const firstRockMat = firstRock.material as THREE.MeshStandardMaterial;
    const firstBoundaryMat = firstBoundary.material as THREE.LineBasicMaterial;

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

    // Same Material instances come back out of the free list...
    expect(secondRock.material).toBe(firstRockMat);
    expect(secondBoundary.material).toBe(firstBoundaryMat);
    // ...reset to their config baseline opacity, not whatever the retired
    // instance last animated to (boundary opacity was driven to 0 at landing).
    expect((secondBoundary.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(0.42, 5);
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

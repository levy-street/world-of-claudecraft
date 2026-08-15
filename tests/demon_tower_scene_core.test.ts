// Low-tier keeps the floor readable even when hero-prop density is reduced.
// This pure render plan is the contract that guarantees the key silhouettes,
// hazards and palette survive every quality tier.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDemonTowerEnvironment } from '../src/render/demon_tower_scene';
import { demonTowerScenePlan, demonTowerSceneProfiles } from '../src/render/demon_tower_scene_core';
import { DungeonInteriors } from '../src/render/dungeon';
import { buildDemonTowerFloor, DEMON_TOWER_SEED } from '../src/sim/content/rift/demon_tower';

describe('demon tower scene core', () => {
  it('covers all and only the three authored scene profiles', () => {
    expect(demonTowerSceneProfiles()).toEqual(['bloodforge', 'ossuary', 'void_crown']);
  });

  it('builds the real floor and backdrop on low tier while retaining hazards', () => {
    for (const [index, profile] of demonTowerSceneProfiles().entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, index);
      const group = new THREE.Group();
      let lights = 0;
      buildDemonTowerEnvironment(group, floor.layout, profile, true, () => lights++);
      const essentials = new Set<string>();
      group.traverse((object) => {
        const essential = object.userData.towerEssential;
        if (typeof essential === 'string') essentials.add(essential);
      });
      expect([...essentials].sort()).toEqual(['backdrop', 'floor']);
      expect(floor.hazards.length).toBeGreaterThan(0);
      expect(lights).toBe(0);
    }
  });

  it('adds only budgeted cosmetic lights on the high tier', () => {
    for (const [index, profile] of demonTowerSceneProfiles().entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, index);
      let lights = 0;
      buildDemonTowerEnvironment(new THREE.Group(), floor.layout, profile, false, () => lights++);
      expect(lights).toBe(demonTowerScenePlan(profile).lightAnchors.length);
    }
  });

  it('uses a restrained, textured floor instead of a flat additive color sheet', () => {
    for (const [index, profile] of demonTowerSceneProfiles().entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, index);
      const group = new THREE.Group();
      buildDemonTowerEnvironment(group, floor.layout, profile, true, () => undefined);
      const grounds: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
      const accents: THREE.Mesh[] = [];
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.userData.towerEssential === 'floor') {
          grounds.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>);
        }
        if (object.userData.towerFloorAccent === true) accents.push(object);
      });
      expect(grounds, `${profile} floor`).toHaveLength(1);
      expect(grounds[0]?.position.y, `${profile} floor seated on the collision plane`).toBeLessThan(
        0.01,
      );
      const material = grounds[0]?.material;
      expect(material?.polygonOffset, `${profile} floor depth bias`).toBe(true);
      const uvs = grounds[0]?.geometry.getAttribute('uv');
      const uValues = uvs ? Array.from({ length: uvs.count }, (_, i) => uvs.getX(i)) : [];
      const vValues = uvs ? Array.from({ length: uvs.count }, (_, i) => uvs.getY(i)) : [];
      expect(uValues.length, `${profile} UV samples`).toBeGreaterThan(0);
      expect(Math.min(...uValues), `${profile} normalized U minimum`).toBeCloseTo(0, 5);
      expect(Math.max(...uValues), `${profile} normalized U maximum`).toBeCloseTo(1, 5);
      expect(Math.min(...vValues), `${profile} normalized V minimum`).toBeCloseTo(0, 5);
      expect(Math.max(...vValues), `${profile} normalized V maximum`).toBeCloseTo(1, 5);
      const map = material?.map;
      expect(map, `${profile} albedo detail`).not.toBeNull();
      expect(map?.wrapS, `${profile} horizontal tiling`).toBe(THREE.RepeatWrapping);
      expect(map?.wrapT, `${profile} vertical tiling`).toBe(THREE.RepeatWrapping);
      expect(map?.repeat.x, `${profile} horizontal detail scale`).toBeGreaterThan(1);
      expect(map?.repeat.y, `${profile} vertical detail scale`).toBeGreaterThan(1);
      const pixels = (map?.image as { data?: ArrayLike<number> } | undefined)?.data;
      const luminanceSamples = pixels
        ? new Set(Array.from(pixels).filter((_, sampleIndex) => sampleIndex % 4 === 0))
        : new Set<number>();
      expect(luminanceSamples.size, `${profile} terrain luminance variation`).toBeGreaterThan(16);
      expect(material?.bumpMap, `${profile} relief detail`).not.toBeNull();
      expect(material?.bumpScale, `${profile} relief strength`).toBeGreaterThanOrEqual(0.08);
      expect(material?.roughness, `${profile} rough ground`).toBeGreaterThanOrEqual(0.76);
      expect(material?.color.getHSL({ h: 0, s: 0, l: 0 }).s, `${profile} saturation`).toBeLessThan(
        0.32,
      );
      expect(accents.length, `${profile} authored floor accents`).toBeGreaterThan(0);
      expect(accents, `${profile} keeps only linear floor accents`).toHaveLength([8, 4, 5][index]);
      expect(
        accents.every((accent) => accent.geometry instanceof THREE.PlaneGeometry),
        `${profile} has no concentric floor rings`,
      ).toBe(true);
      const expectedOpacity = [0.1, 0.2, 0.22][index];
      expect(demonTowerScenePlan(profile).floorAccentOpacity, `${profile} planned opacity`).toBe(
        expectedOpacity,
      );
      for (const accent of accents) {
        const accentMaterial = accent.material as THREE.MeshBasicMaterial;
        expect(accentMaterial.blending, `${profile} accent blending`).toBe(THREE.NormalBlending);
        expect(accentMaterial.opacity, `${profile} accent opacity`).toBe(expectedOpacity);
        expect(accent.position.y, `${profile} accent seated on the floor`).toBeLessThanOrEqual(
          0.01,
        );
      }
    }
  });

  it('builds the production hazard pools and bright rims on low tier', () => {
    const styles = ['tower_lava', 'soul', 'void'] as const;
    for (const [index, style] of styles.entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, index);
      const group = new THREE.Group();
      const interiors = new DungeonInteriors(new THREE.Scene(), true, [], []);
      const placeHazards = (
        interiors as unknown as {
          placeBlackwaterPools(
            target: THREE.Group,
            hazards: typeof floor.hazards,
            hazardStyle: (typeof styles)[number],
          ): void;
        }
      ).placeBlackwaterPools.bind(interiors);
      placeHazards(group, floor.hazards, style);
      const meshes = group.children.filter((child) => child instanceof THREE.Mesh);
      expect(meshes).toHaveLength(floor.hazards.length * 2);
      expect(meshes.every((mesh) => mesh.visible)).toBe(true);
      if (style === 'tower_lava') {
        const pool = meshes.find((mesh) => mesh.userData.riftHazard === 'pool');
        const rim = meshes.find((mesh) => mesh.userData.riftHazard === 'rim');
        const poolMaterial = pool?.material as THREE.MeshBasicMaterial;
        const rimMaterial = rim?.material as THREE.MeshBasicMaterial;
        expect(poolMaterial.color.getHex()).toBe(0x1b1917);
        expect(poolMaterial.opacity).toBe(0.7);
        expect(poolMaterial.polygonOffset).toBe(true);
        expect(rimMaterial.color.getHex()).toBe(0x8f6a46);
        expect(rimMaterial.opacity).toBe(0.28);
        expect(rimMaterial.blending).toBe(THREE.NormalBlending);
        pool?.geometry.computeBoundingBox();
        rim?.geometry.computeBoundingBox();
        expect(pool?.geometry.boundingBox?.max.y).toBeLessThanOrEqual(0.0121);
        expect(rim?.geometry.boundingBox?.max.y).toBeLessThanOrEqual(0.0141);
        expect(rimMaterial.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
          poolMaterial.color.getHSL({ h: 0, s: 0, l: 0 }).l * 2,
        );
      }
    }
  });

  it('uses the restrained Bloodforge glow on high tier', () => {
    const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, 0);
    const group = new THREE.Group();
    const interiors = new DungeonInteriors(new THREE.Scene(), false, [], []);
    (interiors as unknown as { glowDecalTex: THREE.Texture }).glowDecalTex = new THREE.Texture();
    const placeHazards = (
      interiors as unknown as {
        placeBlackwaterPools(
          target: THREE.Group,
          hazards: typeof floor.hazards,
          hazardStyle: 'tower_lava',
        ): void;
      }
    ).placeBlackwaterPools.bind(interiors);
    placeHazards(group, [floor.hazards[0]], 'tower_lava');
    const glow = group.children.find((child) => {
      if (!(child instanceof THREE.Mesh)) return false;
      const material = child.material as THREE.MeshBasicMaterial;
      return material.map instanceof THREE.Texture;
    }) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
    expect(glow, 'high-tier lava glow').toBeDefined();
    expect(glow?.material.color.getHex()).toBe(0x5f3425);
    expect(glow?.position.y).toBeLessThanOrEqual(0.016);
    glow?.geometry.computeBoundingBox();
    const bounds = glow?.geometry.boundingBox;
    const glowRadiusX = bounds ? ((bounds.max.x - bounds.min.x) * (glow?.scale.x ?? 0)) / 2 : 0;
    const glowRadiusZ = bounds ? ((bounds.max.z - bounds.min.z) * (glow?.scale.z ?? 0)) / 2 : 0;
    expect(glowRadiusX, 'lava glow follows the narrow hazard axis').toBeCloseTo(
      (floor.hazards[0].rx ?? floor.hazards[0].r) * 1.15,
      2,
    );
    expect(glowRadiusZ, 'lava glow follows the long hazard axis').toBeCloseTo(
      (floor.hazards[0].rz ?? floor.hazards[0].r) * 1.15,
      2,
    );
  });

  it('gives each floor a unique backdrop and palette', () => {
    const plans = demonTowerSceneProfiles().map(demonTowerScenePlan);
    expect(plans.map((plan) => plan.backdropKind)).toEqual([
      'forge_vault',
      'ossuary_vault',
      'void_storm',
    ]);
    expect(new Set(plans.map((plan) => plan.floorColor)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.accentColor)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.secondaryAccent)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.backdropColor)).size).toBe(3);
  });

  it('keeps lights finite and plans deterministic', () => {
    expect(
      demonTowerSceneProfiles().map((profile) => demonTowerScenePlan(profile).floorTextureScale),
    ).toEqual([13, 11, 14]);
    expect(
      demonTowerSceneProfiles().map((profile) => demonTowerScenePlan(profile).lightAnchors),
    ).toEqual([
      [
        { x: -42, z: 18, y: 3.4, scale: 1.4 },
        { x: 42, z: 18, y: 3.4, scale: 1.4 },
        { x: 0, z: 40, y: 2.2, scale: 1.1 },
      ],
      [
        { x: -34, z: 0, y: 4.8, scale: 1.1 },
        { x: 34, z: 0, y: 4.8, scale: 1.1 },
        { x: 0, z: 36, y: 4.8, scale: 1.2 },
      ],
      [
        { x: -28, z: 20, y: 3, scale: 1.2 },
        { x: 28, z: 20, y: 3, scale: 1.2 },
        { x: 0, z: -32, y: 3, scale: 1.1 },
      ],
    ]);
    for (const profile of demonTowerSceneProfiles()) {
      const plan = demonTowerScenePlan(profile);
      expect(plan.profile).toBe(profile);
      expect(plan.lightAnchors).toHaveLength(3);
      for (const light of plan.lightAnchors) {
        expect([light.x, light.z, light.y, light.scale].every(Number.isFinite)).toBe(true);
        expect(light.y).toBeGreaterThan(0);
        expect(light.scale).toBeGreaterThan(0);
      }
      expect(demonTowerScenePlan(profile)).toEqual(plan);
    }
  });
});

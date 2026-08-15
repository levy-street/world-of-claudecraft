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

  it('builds the real floor, backdrop and landmarks on low tier while retaining hazards', () => {
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
      expect([...essentials].sort()).toEqual(['backdrop', 'floor', 'landmark']);
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

  it('builds the production hazard pools and bright rims on low tier', () => {
    const styles = ['lava', 'soul', 'void'] as const;
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
    }
  });

  it('gives each floor a unique backdrop, palette and ring grammar', () => {
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
    expect(new Set(plans.map((plan) => plan.ringRadii.join(','))).size).toBe(3);
  });

  it('keeps rings ordered, lights finite and plans deterministic', () => {
    for (const profile of demonTowerSceneProfiles()) {
      const plan = demonTowerScenePlan(profile);
      expect(plan.profile).toBe(profile);
      expect(plan.ringRadii).toHaveLength(3);
      expect(plan.ringRadii[0]).toBeLessThan(plan.ringRadii[1]);
      expect(plan.ringRadii[1]).toBeLessThan(plan.ringRadii[2]);
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

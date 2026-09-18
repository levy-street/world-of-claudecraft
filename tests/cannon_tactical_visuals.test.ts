import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CannonTacticalVisuals, cannonBarrelTemplate } from '../src/render/cannon_tactical_visuals';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import type { VehicleSession } from '../src/sim/types';

it('normalizes existing barrels, shows authoritative bursts and restores recoil on exit', () => {
  const source = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial());
  const template = cannonBarrelTemplate(source);
  expect(new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3()).y).toBeCloseTo(1.8);
  const scene = new THREE.Scene();
  const cannon = new THREE.Group(),
    model = new THREE.Group();
  cannon.userData.questObjectVisualItemId = 'north_watch_cannon';
  cannon.add(model);
  scene.add(cannon);
  const secondCannon = new THREE.Group(),
    secondModel = new THREE.Group();
  secondCannon.userData.questObjectVisualItemId = 'last_keep_cannon';
  secondCannon.add(secondModel);
  scene.add(secondCannon);
  const visual = new CannonTacticalVisuals(template, scene);
  const s: VehicleSession = {
    kind: 'cannon',
    stationId: 'north_watch_cannon',
    cycle: 'wq3_8',
    origin: { x: 0, y: 0, z: 0 },
    encounter: createCannonEncounter(),
  };
  s.encounter.tick = 4;
  s.encounter.barrels = [{ id: 1, active: true, x: 10, z: 20 }];
  s.encounter.feedback = [
    { id: 2, kind: 'shot', tick: 0, x: 10, z: 20 },
    { id: 3, kind: 'barrel', tick: 1, x: 10, z: 20 },
  ];
  const before = JSON.stringify(s);
  visual.update(s, () => 3, false);
  expect(visual.root.children[0].position.toArray()).toEqual([10, 3, 20]);
  expect(model.position.z).toBeCloseTo(0.45);
  expect(secondModel.position.z).toBe(0);
  expect(JSON.stringify(s)).toBe(before);
  s.stationId = 'last_keep_cannon';
  visual.update(s, () => 3, false);
  expect(model.position.z).toBe(0);
  expect(secondModel.position.z).toBeCloseTo(0.45);
  s.stationId = 'north_watch_cannon';
  visual.update(s, () => 3, true);
  expect(model.position.z).toBe(0);
  expect(secondModel.position.z).toBe(0);
  s.encounter.barrels[0].active = false;
  visual.update(s, () => 3, false);
  expect(visual.root.children[0].visible).toBe(false);
  visual.update(null, () => 3, false);
  expect(model.position.z).toBe(0);
  visual.dispose();
  source.geometry.dispose();
  source.material.dispose();
});

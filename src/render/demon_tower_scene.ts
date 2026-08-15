// Thin Three.js builder for the three Demon Tower environments. Collision and
// outer silhouette still come from the sim's shellPolygon; this layer paints
// that exact footprint and adds tier-safe backdrop/accent geometry.

import * as THREE from 'three';
import type { DemonTowerSceneProfile, DungeonLayout } from '../sim/dungeon_layout';
import { demonTowerScenePlan } from './demon_tower_scene_core';

type LightSink = (x: number, z: number, color: number, y?: number, scale?: number) => void;

const ENVIRONMENT_TEMPLATES = new Map<string, THREE.Group>();

function polygonGeometry(points: ReadonlyArray<{ x: number; z: number }>): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.z);
    else shape.lineTo(point.x, -point.z);
  });
  shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

function addAccentRing(group: THREE.Group, radius: number, color: number, opacity: number): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.16, radius + 0.16, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  ring.position.y = 0.1;
  ring.renderOrder = 2;
  ring.userData.towerEssential = 'landmark';
  group.add(ring);
}

function addRadialAccents(
  group: THREE.Group,
  count: number,
  length: number,
  width: number,
  color: number,
  phase = 0,
): void {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const geometry = new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const strip = new THREE.Mesh(geometry, material);
    strip.position.set(Math.sin(angle) * (length / 2), 0.11, Math.cos(angle) * (length / 2));
    strip.rotation.y = angle;
    strip.renderOrder = 2;
    group.add(strip);
  }
}

function addBackdrop(
  group: THREE.Group,
  profile: DemonTowerSceneProfile,
  color: number,
  lowGfx: boolean,
): void {
  if (profile === 'void_crown') {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(
        58,
        lowGfx ? 16 : 28,
        lowGfx ? 10 : 16,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false }),
    );
    dome.position.y = -2;
    dome.userData.towerEssential = 'backdrop';
    group.add(dome);
    if (!lowGfx) {
      const shardGeometry = new THREE.OctahedronGeometry(0.55, 0);
      const shardMaterial = new THREE.MeshStandardMaterial({ color: 0x39235f, roughness: 0.7 });
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const shard = new THREE.Mesh(shardGeometry, shardMaterial);
        shard.scale.setScalar((0.35 + (i % 3) * 0.16) / 0.55);
        shard.position.set(
          Math.sin(angle) * (33 + (i % 4) * 3),
          8 + (i % 5) * 2,
          Math.cos(angle) * (33 + (i % 4) * 3),
        );
        shard.rotation.set(angle * 0.4, angle, angle * 0.2);
        group.add(shard);
      }
    }
    return;
  }
  const vault = new THREE.Mesh(
    new THREE.CylinderGeometry(46, 46, 24, lowGfx ? 16 : 32, 1, true),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      metalness: profile === 'bloodforge' ? 0.25 : 0,
      side: THREE.BackSide,
    }),
  );
  vault.position.y = 10;
  vault.userData.towerEssential = 'backdrop';
  group.add(vault);
  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(46, lowGfx ? 16 : 32).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  ceiling.position.y = 22;
  ceiling.userData.towerEssential = 'backdrop';
  group.add(ceiling);
}

function buildDemonTowerGeometry(
  group: THREE.Group,
  layout: DungeonLayout,
  profile: DemonTowerSceneProfile,
  lowGfx: boolean,
): void {
  const points = layout.shellPolygon;
  if (!points?.length) return;
  const plan = demonTowerScenePlan(profile);
  const floor = new THREE.Mesh(
    polygonGeometry(points),
    new THREE.MeshStandardMaterial({
      color: plan.floorColor,
      roughness: plan.floorRoughness,
      metalness: profile === 'bloodforge' ? 0.22 : 0.05,
    }),
  );
  floor.position.y = 0.055;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  floor.userData.towerEssential = 'floor';
  group.add(floor);

  for (const radius of plan.ringRadii) addAccentRing(group, radius, plan.accentColor, 0.5);
  if (profile === 'bloodforge')
    addRadialAccents(group, 8, 27, 0.22, plan.secondaryAccent, Math.PI / 8);
  else if (profile === 'ossuary') addRadialAccents(group, 4, 25, 0.32, plan.secondaryAccent, 0);
  else addRadialAccents(group, 5, 24, 0.26, plan.accentColor, Math.PI / 5);
  addBackdrop(group, profile, plan.backdropColor, lowGfx);
}

export function buildDemonTowerEnvironment(
  group: THREE.Group,
  layout: DungeonLayout,
  profile: DemonTowerSceneProfile,
  lowGfx: boolean,
  addLight: LightSink,
): void {
  const cacheKey = `${profile}:${lowGfx ? 'low' : 'high'}`;
  let template = ENVIRONMENT_TEMPLATES.get(cacheKey);
  if (!template) {
    template = new THREE.Group();
    buildDemonTowerGeometry(template, layout, profile, lowGfx);
    ENVIRONMENT_TEMPLATES.set(cacheKey, template);
  }
  group.add(template.clone(true));
  if (!lowGfx) {
    const plan = demonTowerScenePlan(profile);
    for (const light of plan.lightAnchors) {
      addLight(light.x, light.z, plan.accentColor, light.y, light.scale);
    }
  }
}

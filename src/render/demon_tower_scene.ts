// Thin Three.js builder for the three Demon Tower environments. Collision and
// outer silhouette still come from the sim's shellPolygon; this layer paints
// that exact footprint and adds tier-safe backdrop/accent geometry.

import * as THREE from 'three';
import type { DemonTowerSceneProfile, DungeonLayout } from '../sim/dungeon_layout';
import { demonTowerScenePlan } from './demon_tower_scene_core';

type LightSink = (x: number, z: number, color: number, y?: number, scale?: number) => void;

const ENVIRONMENT_TEMPLATES = new Map<string, THREE.Group>();
const FLOOR_TEXTURES = new Map<DemonTowerSceneProfile, THREE.DataTexture>();

function textureNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed * 17, 0x45d9f3b) ^ Math.imul(y + seed * 31, 0x119de1f3);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return value >>> 0;
}

/** Deterministic stone relief shared by every clone of one floor profile. The
 * grayscale map multiplies the restrained base color and doubles as a subtle
 * bump map, so low tier keeps the same readable terrain grain without another
 * texture allocation or a cosmetic-only geometry layer. */
function floorTexture(profile: DemonTowerSceneProfile, repeat: number): THREE.DataTexture {
  const cached = FLOOR_TEXTURES.get(profile);
  if (cached) return cached;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const seed = profile === 'bloodforge' ? 11 : profile === 'ossuary' ? 29 : 47;
  const tile = profile === 'void_crown' ? 19 : profile === 'ossuary' ? 22 : 16;
  for (let y = 0; y < size; y++) {
    const rowOffset = (Math.floor(y / tile) & 1) * Math.floor(tile / 2);
    for (let x = 0; x < size; x++) {
      const localX = (x + rowOffset) % tile;
      const localY = y % tile;
      const hash = textureNoise(x, y, seed);
      const seam = localX <= 1 || localY <= 1;
      const fissure =
        ((x * 7 + y * 13 + seed * 5) % 113 === 0 && (hash & 3) !== 0) ||
        ((x * 19 - y * 5 + seed) % 181 === 0 && (hash & 7) === 0);
      const grain = ((hash >>> 8) & 31) - 15;
      const chip = (hash & 127) === 0 ? -42 : 0;
      const value = Math.max(38, Math.min(210, (seam ? 88 : fissure ? 58 : 166) + grain + chip));
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  FLOOR_TEXTURES.set(profile, texture);
  return texture;
}

function polygonGeometry(points: ReadonlyArray<{ x: number; z: number }>): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.z);
    else shape.lineTo(point.x, -point.z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  if (bounds && positions && uvs) {
    const width = Math.max(1e-6, bounds.max.x - bounds.min.x);
    const depth = Math.max(1e-6, bounds.max.z - bounds.min.z);
    for (let i = 0; i < positions.count; i++) {
      uvs.setXY(
        i,
        (positions.getX(i) - bounds.min.x) / width,
        (positions.getZ(i) - bounds.min.z) / depth,
      );
    }
    uvs.needsUpdate = true;
  }
  return geometry;
}

function addAccentRing(group: THREE.Group, radius: number, color: number, opacity: number): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.16, radius + 0.16, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    }),
  );
  ring.position.y = 0.1;
  ring.renderOrder = 2;
  ring.userData.towerEssential = 'landmark';
  ring.userData.towerFloorAccent = true;
  group.add(ring);
}

function addRadialAccents(
  group: THREE.Group,
  count: number,
  length: number,
  width: number,
  color: number,
  opacity: number,
  phase = 0,
): void {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const geometry = new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const strip = new THREE.Mesh(geometry, material);
    strip.position.set(Math.sin(angle) * (length / 2), 0.11, Math.cos(angle) * (length / 2));
    strip.rotation.y = angle;
    strip.renderOrder = 2;
    strip.userData.towerFloorAccent = true;
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
      map: floorTexture(profile, plan.floorTextureScale),
      bumpMap: floorTexture(profile, plan.floorTextureScale),
      bumpScale: profile === 'void_crown' ? 0.1 : 0.14,
      roughness: plan.floorRoughness,
      metalness: profile === 'bloodforge' ? 0.22 : 0.05,
    }),
  );
  floor.position.y = 0.055;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  floor.userData.towerEssential = 'floor';
  group.add(floor);

  for (const radius of plan.ringRadii)
    addAccentRing(group, radius, plan.accentColor, plan.floorAccentOpacity);
  if (profile === 'bloodforge')
    addRadialAccents(
      group,
      8,
      27,
      0.22,
      plan.secondaryAccent,
      plan.floorAccentOpacity,
      Math.PI / 8,
    );
  else if (profile === 'ossuary')
    addRadialAccents(group, 4, 25, 0.32, plan.secondaryAccent, plan.floorAccentOpacity, 0);
  else addRadialAccents(group, 5, 24, 0.26, plan.accentColor, plan.floorAccentOpacity, Math.PI / 5);
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

// A boss room's modular kit, drawn: instances of the room theme's Blender kit
// standing where hoard_room_kit_core.ts says, the floor marks under them, and the
// little that moves. Composed by hoard_valley.ts, which owns the room; this never
// touches its outline, its floor or its collision. Which kit, which colours and
// which motion is the theme's (hoard_room_themes_core.ts): this file knows no boss.
//
// Performance contract (the valley's own): a theme's kit GLB is fetched the first
// time ITS room is built (never at boot: a player who digs up no hoard pays for no
// kit), baked once into shared geometry, and its source released. The view's
// `ready` resolves once the props stand in the group, and the valley waits on it
// before its gated attach, so the room compiles whole and never mid-fight. A kit
// that fails to load costs the room its props, never the player the room. One InstancedMesh per piece per material (the
// painted solid and the glow), three floor meshes, one particle cloud: nothing is
// allocated per frame, and there are no lights. It is ALL cosmetic: a player reads
// nothing here, so tiers may shed it freely.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import type { RoomKitFloorMark, RoomKitPlan, RoomKitTier } from './hoard_room_kit_core';
import { BOSS_ROOM_THEMES } from './hoard_room_themes_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

interface BakedPiece {
  solid: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

/** Baked kits by URL, then by piece. */
const kits = new Map<string, Map<string, BakedPiece>>();
let solidMaterial: THREE.MeshBasicMaterial | null = null;
let floorMaterial: THREE.MeshBasicMaterial | null = null;
const tint = new THREE.Color(1, 1, 1);

function sharedMaterials(): { solid: THREE.MeshBasicMaterial; floor: THREE.MeshBasicMaterial } {
  // DoubleSide: a mirrored instance flips its winding, and one shared material
  // cannot know which instances are mirrored.
  solidMaterial ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }),
  );
  floorMaterial ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  solidMaterial.name = 'HoardRoomKitSolid';
  floorMaterial.name = 'HoardRoomKitFloor';
  solidMaterial.color.copy(tint);
  floorMaterial.color.copy(tint);
  return { solid: solidMaterial, floor: floorMaterial };
}

/** Follow the valley's readable day/night grade; what glows keeps its own light. */
export function updateHoardRoomKitTint(grade: readonly [number, number, number]): void {
  tint.setRGB(grade[0], grade[1], grade[2]);
  solidMaterial?.color.copy(tint);
  floorMaterial?.color.copy(tint);
}

/** Decode (the shipped kits are quantized) and bake one node, split by material. */
function bakeNode(node: THREE.Object3D): BakedPiece {
  // The node's own matrix is NOT a placement to undo: the shipped kit is quantized,
  // and that matrix is what restores its real size. The Blender nodes sit at the
  // origin, so the whole world matrix is baked in.
  node.updateWorldMatrix(true, true);
  const out: BakedPiece = { solid: null, glow: null };
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'color']) {
      const attr = child.geometry.getAttribute(name);
      if (!attr) continue;
      // getComponent denormalizes a quantized stream; colour ships RGBA, keep RGB.
      const size = name === 'color' ? 3 : attr.itemSize;
      const values = new Float32Array(attr.count * size);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < size; j++) values[i * size + j] = attr.getComponent(i, j);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    if (child.geometry.index) geometry.setIndex(child.geometry.index.clone());
    geometry.applyMatrix4(child.matrixWorld);
    geometry.computeBoundingSphere();
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const slot = /molten|glow/i.test(material?.name ?? '') ? 'glow' : 'solid';
    out[slot] = markSharedGeometry(geometry);
  });
  return out;
}

function bakeKit(url: string, scene: THREE.Object3D): void {
  // Every theme drawing on this kit names the pieces it wants baked.
  const pieces = new Set(
    BOSS_ROOM_THEMES.filter((theme) => theme.kitUrl === url).flatMap((theme) => theme.pieces),
  );
  const baked = new Map<string, BakedPiece>();
  for (const piece of pieces) {
    const node = scene.getObjectByName(`Kit_${piece}`);
    if (node) baked.set(piece, bakeNode(node));
  }
  kits.set(url, baked);
}

/** A room never waits longer than this on its kit: it opens bare instead. */
const KIT_WAIT_MS = 6000;
const loading = new Map<string, Promise<void>>();

/** Fetch and bake one kit, once. Never rejects: a lost kit is a bare room. */
function ensureKit(url: string): Promise<void> {
  if (kits.has(url) || typeof window === 'undefined') return Promise.resolve();
  let pending = loading.get(url);
  if (!pending) {
    pending = loadGltf(url)
      .then((gltf) => {
        if (!kits.has(url)) bakeKit(url, gltf.scene);
        // Every attribute was copied out: the parsed source can go.
        releaseGltf(url);
      })
      .catch(() => undefined)
      .then(() => {
        loading.delete(url);
      });
    loading.set(url, pending);
  }
  return Promise.race([
    pending,
    new Promise<void>((resolve) => {
      setTimeout(resolve, KIT_WAIT_MS);
    }),
  ]);
}

// ------------------------------------------------------------------ the floor
function blotRadius(seed: number, spoke: number): number {
  const x = Math.sin((seed + 1) * 12.9898 + spoke * 78.233) * 43758.5453;
  return 0.72 + 0.28 * (x - Math.floor(x));
}

function pushMark(
  positions: number[],
  colors: number[],
  mark: RoomKitFloorMark,
  y: number,
  c: THREE.Color,
): void {
  const tri = (a: number[], b: number[], d: number[]): void => {
    positions.push(a[0], y, a[1], b[0], y, b[1], d[0], y, d[1]);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  };
  if (mark.shape === 'ring') {
    const radius = mark.radius ?? 1;
    const segments = 48;
    for (let s = 0; s < segments; s++) {
      // A broken ring: every sixth segment is left out, like an old inlay.
      if (s % 6 === 5) continue;
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const p = (angle: number, r: number): number[] => [
        mark.x + Math.sin(angle) * r,
        mark.z + Math.cos(angle) * r,
      ];
      const inner = radius - mark.halfWidth;
      const outer = radius + mark.halfWidth;
      tri(p(a0, inner), p(a0, outer), p(a1, outer));
      tri(p(a0, inner), p(a1, outer), p(a1, inner));
    }
    return;
  }
  if (mark.shape === 'blot') {
    const spokes = 11;
    for (let i = 0; i < spokes; i++) {
      const a0 = mark.yaw + (i / spokes) * Math.PI * 2;
      const a1 = mark.yaw + ((i + 1) / spokes) * Math.PI * 2;
      const r0 = blotRadius(mark.seed ?? 0, i);
      const r1 = blotRadius(mark.seed ?? 0, (i + 1) % spokes);
      tri(
        [mark.x, mark.z],
        [mark.x + Math.sin(a0) * mark.halfLength * r0, mark.z + Math.cos(a0) * mark.halfWidth * r0],
        [mark.x + Math.sin(a1) * mark.halfLength * r1, mark.z + Math.cos(a1) * mark.halfWidth * r1],
      );
    }
    return;
  }
  const cos = Math.cos(mark.yaw);
  const sin = Math.sin(mark.yaw);
  // Its length runs along its own +Z, turned by yaw like everything else here.
  const corner = (along: number, across: number): number[] => [
    mark.x + sin * along + cos * across,
    mark.z + cos * along - sin * across,
  ];
  const a = corner(-mark.halfLength, -mark.halfWidth);
  const b = corner(-mark.halfLength, mark.halfWidth);
  const d = corner(mark.halfLength, mark.halfWidth);
  const e = corner(mark.halfLength, -mark.halfWidth);
  tri(a, b, d);
  tri(a, d, e);
}

function floorMesh(plan: RoomKitPlan, lit: boolean, material: THREE.Material): THREE.Mesh | null {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const mark of plan.floor) {
    if (mark.shape === 'fan') continue;
    const tone = plan.theme.tones[mark.tone];
    if (!tone || Boolean(tone.lit) !== lit) continue;
    pushMark(positions, colors, mark, tone.lift, color.setHex(tone.color));
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = lit ? 'HoardRoomKitLitMarks' : 'HoardRoomKitFloorMarks';
  mesh.receiveShadow = false;
  return mesh;
}

/** Light on the floor: a soft additive fan under whatever glows. A fan's halfWidth
 *  carries its strength. No light is ever added to the scene. */
function fanMesh(plan: RoomKitPlan): THREE.Mesh | null {
  const positions: number[] = [];
  const colors: number[] = [];
  const glow = new THREE.Color();
  const spokes = 20;
  for (const mark of plan.floor) {
    if (mark.shape !== 'fan') continue;
    const tone = plan.theme.tones[mark.tone];
    if (!tone) continue;
    glow.setHex(tone.color);
    const radius = mark.radius ?? 1;
    const strength = mark.halfWidth;
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * Math.PI * 2;
      const a1 = ((i + 1) / spokes) * Math.PI * 2;
      positions.push(mark.x, tone.lift, mark.z);
      positions.push(mark.x + Math.sin(a0) * radius, tone.lift, mark.z + Math.cos(a0) * radius);
      positions.push(mark.x + Math.sin(a1) * radius, tone.lift, mark.z + Math.cos(a1) * radius);
      // Additive: the colour IS the light, bright at its heart and nothing at the rim.
      colors.push(glow.r * strength, glow.g * strength, glow.b * strength, 0, 0, 0, 0, 0, 0);
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: true,
    }),
  );
  mesh.name = 'HoardRoomKitFloorLight';
  mesh.renderOrder = 2;
  return mesh;
}

// ------------------------------------------------------------------- the view
interface Moving {
  meshes: THREE.InstancedMesh[];
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  mirror: boolean;
  phase: number;
  hover: boolean;
}

export interface HoardRoomKitView {
  readonly group: THREE.Group;
  /** Null when the props already stand in the group; else resolves once they do
   *  (or the kit was given up on). */
  ready: Promise<void> | null;
  /** Per frame: what sways, what floats, the glow's breath, the particles. */
  update(timeSec: number): void;
  dispose(): void;
}

export function buildHoardRoomKit(
  plan: RoomKitPlan,
  tier: RoomKitTier,
  shadows: boolean,
): HoardRoomKitView {
  const theme = plan.theme;
  const group = new THREE.Group();
  group.name = `HoardRoomKit:${theme.id}`;
  const shared = sharedMaterials();
  // The glow breathes per room, so it is this room's own material.
  const glowMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  glowMaterial.name = 'HoardRoomKitGlow';
  const ownedGeometry: THREE.BufferGeometry[] = [];
  const ownedMaterial: THREE.Material[] = [glowMaterial];
  const moving: Moving[] = [];
  const movingMeshes = new Set<THREE.InstancedMesh>();
  const instanced: THREE.InstancedMesh[] = [];
  const transform = new THREE.Object3D();
  transform.rotation.order = 'YXZ';
  let disposed = false;

  for (const mesh of [floorMesh(plan, false, shared.floor), floorMesh(plan, true, glowMaterial)]) {
    if (!mesh) continue;
    ownedGeometry.push(mesh.geometry);
    group.add(mesh);
  }
  const light = fanMesh(plan);
  if (light) {
    ownedGeometry.push(light.geometry);
    ownedMaterial.push(light.material as THREE.Material);
    group.add(light);
  }

  const emitters: { x: number; y: number; z: number; spread: number }[] = [];
  let cloud: { position: THREE.BufferAttribute; seeds: Float32Array; count: number } | undefined;
  const spec = theme.ambient.particles;
  // The props and what rises off them: run once the kit is baked (at once, when it
  // already is). Without a kit it still gives the room its drifting particles.
  const dress = (): void => {
    const baked = kits.get(theme.kitUrl);
    const sways = new Set(tier === 'low' ? [] : (theme.ambient.sway ?? []));
    const hovers = new Set(tier === 'low' ? [] : (theme.ambient.hover ?? []));
    for (const piece of theme.pieces) {
      const geometry = baked?.get(piece);
      const placements = plan.placements.filter((placement) => placement.piece === piece);
      if (!geometry || placements.length === 0) continue;
      const meshes: THREE.InstancedMesh[] = [];
      for (const [part, material] of [
        [geometry.solid, shared.solid],
        [geometry.glow, glowMaterial],
      ] as const) {
        if (!part) continue;
        const mesh = new THREE.InstancedMesh(part, material, placements.length);
        mesh.name = `HoardRoomKit:${piece}`;
        mesh.castShadow = shadows && material === shared.solid;
        mesh.receiveShadow = false;
        meshes.push(mesh);
        instanced.push(mesh);
        group.add(mesh);
      }
      const emit = theme.ambient.particles?.emitters?.[piece];
      placements.forEach((placement, index) => {
        transform.position.set(placement.x, placement.y, placement.z);
        transform.rotation.set(0, placement.yaw, 0);
        transform.scale.set(
          placement.mirror ? -placement.scale : placement.scale,
          placement.scale,
          placement.scale,
        );
        transform.updateMatrix();
        for (const mesh of meshes) mesh.setMatrixAt(index, transform.matrix);
        if (sways.has(piece) || hovers.has(piece)) {
          for (const mesh of meshes) movingMeshes.add(mesh);
          moving.push({
            meshes,
            index,
            x: placement.x,
            y: placement.y,
            z: placement.z,
            yaw: placement.yaw,
            scale: placement.scale,
            mirror: placement.mirror,
            phase: (placement.x * 0.37 + placement.z * 0.61) % (Math.PI * 2),
            hover: hovers.has(piece),
          });
        }
        if (emit) {
          // A piece's mouth is a little in front of it (its front is +Z, turned by yaw).
          emitters.push({
            x: placement.x + Math.sin(placement.yaw) * emit[1] * 0.4,
            y: placement.y + emit[0] * placement.scale,
            z: placement.z + Math.cos(placement.yaw) * emit[1] * 0.4,
            spread: emit[1],
          });
        }
      });
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }

    // The room's particles: high tier only, one small cloud, positions rewritten in place.
    if (tier === 'high' && spec && (spec.mode !== 'rise' || emitters.length > 0)) {
      const geometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(new Float32Array(spec.count * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', position);
      ownedGeometry.push(geometry);
      const material = new THREE.PointsMaterial({
        color: spec.color,
        size: spec.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: true,
      });
      ownedMaterial.push(material);
      const points = new THREE.Points(geometry, material);
      points.name = 'HoardRoomKitParticles';
      points.frustumCulled = false;
      const seeds = new Float32Array(spec.count * 4);
      for (let i = 0; i < spec.count; i++) {
        seeds[i * 4] = (i * 0.6180339887) % 1;
        seeds[i * 4 + 1] = (i * 0.7548776662) % 1;
        seeds[i * 4 + 2] = (i * 0.5698402909) % 1;
        seeds[i * 4 + 3] = (i * 0.4142135623) % 1;
      }
      cloud = { position, seeds, count: spec.count };
      group.add(points);
    }
  };
  let ready: Promise<void> | null = null;
  if (kits.has(theme.kitUrl) || typeof window === 'undefined') {
    dress();
  } else {
    ready = ensureKit(theme.kitUrl).then(() => {
      if (!disposed) dress();
    });
  }

  const [pulseMin, pulseMax, pulseSpeed] = theme.ambient.pulse;
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  return {
    group,
    ready,
    update(timeSec: number): void {
      if (disposed) return;
      // What glows breathes together, slowly: a room, not an alarm.
      const breath = 0.5 + 0.5 * Math.sin(timeSec * pulseSpeed);
      glowMaterial.color.setScalar(pulseMin + (pulseMax - pulseMin) * breath);
      for (let i = 0; i < moving.length; i++) {
        const item = moving[i];
        if (item.hover) {
          transform.position.set(
            item.x,
            item.y + 0.22 * Math.sin(timeSec * 0.8 + item.phase),
            item.z,
          );
          transform.rotation.set(
            0,
            item.yaw + 0.12 * Math.sin(timeSec * 0.31 + item.phase),
            0,
            'YXZ',
          );
        } else {
          transform.position.set(item.x, item.y, item.z);
          transform.rotation.set(
            0.055 * Math.sin(timeSec * 0.9 + item.phase),
            item.yaw,
            0.04 * Math.sin(timeSec * 0.7 + item.phase * 1.7),
            'YXZ',
          );
        }
        transform.scale.set(item.mirror ? -item.scale : item.scale, item.scale, item.scale);
        transform.updateMatrix();
        for (const mesh of item.meshes) mesh.setMatrixAt(item.index, transform.matrix);
      }
      for (const mesh of movingMeshes) mesh.instanceMatrix.needsUpdate = true;
      if (cloud && spec) {
        for (let i = 0; i < cloud.count; i++) {
          const a = cloud.seeds[i * 4];
          const b = cloud.seeds[i * 4 + 1];
          const c = cloud.seeds[i * 4 + 2];
          const d = cloud.seeds[i * 4 + 3];
          if (spec.mode === 'rise') {
            const emitter = emitters[Math.floor(a * emitters.length) % emitters.length];
            const t = (timeSec / (2.5 + b * 6) + c) % 1;
            const bearing = d * Math.PI * 2 + t * 1.7;
            const drift = emitter.spread * (0.35 + 0.65 * t);
            cloud.position.setXYZ(
              i,
              emitter.x + Math.sin(bearing) * drift,
              emitter.y + t * t * 9 + t * 2,
              emitter.z + Math.cos(bearing) * drift * 0.6,
            );
          } else {
            const fall = spec.mode === 'fall';
            const t = (timeSec / (fall ? 7 + b * 6 : 18 + b * 14) + c) % 1;
            const sway = Math.sin(timeSec * 0.4 + d * 6.283) * (fall ? 1.2 : 2.4);
            cloud.position.setXYZ(
              i,
              minX + a * (maxX - minX) + sway,
              fall ? 16 * (1 - t) : 1 + d * 7 + Math.sin(timeSec * 0.3 + a * 6.283) * 0.8,
              minZ + b * (maxZ - minZ) + (fall ? 0 : t * 6),
            );
          }
        }
        cloud.position.needsUpdate = true;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // The instance buffers are this view's; the baked geometry under them is shared.
      for (const mesh of instanced) mesh.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      for (const material of ownedMaterial) material.dispose();
    },
  };
}

export const hoardRoomKitInternalsForTest = {
  seedScene(url: string, scene: THREE.Object3D): void {
    bakeKit(url, scene);
  },
  clear(): void {
    kits.clear();
  },
  pieces(url: string): string[] {
    return [...(kits.get(url)?.keys() ?? [])];
  },
};

// Static stone hall. Built before the town's reveal roots are registered, so
// the existing town GPU gate prepares every mesh and its occluder-fade twin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EASTBROOK_LAYOUT, localToWorld } from '../sim/eastbrook_layout';
import { surfaceMat } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { type OccluderFadeMat, occluderFadeRecordFor } from './occluder_fade';

// Pinned against the generated geometry by weekly_vault_building.test.ts.
export const WEEKLY_VAULT_TRIANGLES = 4572;

/** Door assembly reused by the independent stone hall. */
function buildVaultDoor(frontZ: number, mats: OccluderFadeMat[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'eastbrookWeeklyVault';
  const stone: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  const box = (
    parts: THREE.BufferGeometry[],
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => {
    parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  };
  // The hall's shared solid footprint owns collision; the door is facade trim.
  box(stone, 5.8, 5.6, 0.22, 0, 2.8, -0.1);
  box(steel, 4.8, 4.9, 0.12, 0, 2.6, -0.01);
  const ring = (radius: number, tube: number, y: number, z: number) =>
    new THREE.TorusGeometry(radius, tube, 6, 48).translate(0, y, z);
  brass.push(ring(2.12, 0.1, 2.6, 0.06));
  steel.push(
    new THREE.CylinderGeometry(1.98, 1.98, 0.1, 48).rotateX(Math.PI / 2).translate(0, 2.6, 0.07),
  );
  brass.push(ring(1.78, 0.035, 2.6, 0.13));
  brass.push(ring(0.55, 0.065, 2.6, 0.15));
  steel.push(
    new THREE.CylinderGeometry(0.25, 0.25, 0.11, 16).rotateX(Math.PI / 2).translate(0, 2.6, 0.16),
  );
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const spoke = new THREE.BoxGeometry(0.075, 1.1, 0.07).rotateZ(angle).translate(0, 2.6, 0.15);
    brass.push(spoke);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    brass.push(
      new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6)
        .rotateX(Math.PI / 2)
        .translate(Math.cos(a) * 1.92, 2.6 + Math.sin(a) * 1.92, 0.14),
    );
  }
  for (const x of [-2.65, 2.65]) {
    box(brass, 0.18, 5.2, 0.1, x, 2.7, 0.05);
    for (const y of [1.35, 3.8]) box(steel, 0.55, 0.35, 0.16, x * 0.78, y, 0.08);
  }
  box(brass, 5.6, 0.2, 0.1, 0, 5.4, 0.04);
  const groups = [
    { parts: stone, color: 0x77736c, metalness: 0, roughness: 0.95 },
    { parts: steel, color: 0x28353b, metalness: 0.7, roughness: 0.5 },
    { parts: brass, color: 0xc4a15b, metalness: 0.75, roughness: 0.35 },
  ];
  for (const { parts, color, metalness, roughness } of groups) {
    const geometry = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    const material = cloneMaterialWithHooks(surfaceMat({ color, metalness, roughness }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    occluderFadeRecordFor(mats, material, mesh);
  }
  root.position.z = frontZ;
  return root;
}

/** Ashlar hall with buttressed towers, stepped cornices and a temple pediment.
 * Geometry is merged by material before joining the town reveal/fade service. */
export function buildEastbrookWeeklyVault(groundAt: (x: number, z: number) => number) {
  const layout = EASTBROOK_LAYOUT.weeklyVault;
  const group = new THREE.Group();
  group.name = 'eastbrookBuilding:eastbrook_weekly_vault';
  group.userData.eastbrookBuildingId = layout.id;
  group.userData.position = { x: layout.x, z: layout.z };
  group.userData.rotation = layout.rot;
  group.userData.target = { width: layout.w, depth: layout.d, height: layout.height };
  group.userData.front = layout.keeper;
  const mats: OccluderFadeMat[] = [];
  const colors = [0x626b74, 0x969b9c, 0xb8b9b2, 0x29465c, 0xc5a263];
  const parts: THREE.BufferGeometry[][] = colors.map(() => []);
  const box = (m: number, w: number, h: number, d: number, x: number, y: number, z: number) =>
    parts[m].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const entrance = localToWorld(layout, layout.rot, 0, layout.d / 2);
  const y = groundAt(entrance.x, entrance.z);
  // Substantial buried footing covers the site's shallow grade without floating edges.
  box(0, 14, 1.8, 12, 0, -0.55, 0);
  box(0, 13.5, 7.8, 11.4, 0, 4, 0);
  // Surface-only ashlar keeps mortar joints crisp without spending triangles on
  // five buried faces per block. Subtle variation avoids a checkerboard facade.
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 8; col++) {
      const x = -5.94 + col * 1.69;
      for (const side of [-1, 1])
        parts[(row * 3 + col * 7) % 11 === 0 ? 2 : 1].push(
          new THREE.PlaneGeometry(1.64, 0.73)
            .rotateY(side === 1 ? 0 : Math.PI)
            .translate(x, 0.7 + row * 0.77, side * 5.82),
        );
    }
    for (let col = 0; col < 7; col++) {
      const z = -4.8 + col * 1.6;
      for (const side of [-1, 1])
        parts[(row * 3 + col * 7) % 11 === 0 ? 2 : 1].push(
          new THREE.PlaneGeometry(1.55, 0.73)
            .rotateY((side * Math.PI) / 2)
            .translate(side * 6.78, 0.7 + row * 0.77, z),
        );
    }
  }
  // Corner pavilions: pale quoins, deep blue inset panels and slate crown roofs.
  for (const x of [-5.85, 5.85])
    for (const z of [-4.85, 4.85]) {
      box(1, 2.2, 10.2, 2.2, x, 5.1, z);
      for (const h of [0.7, 3.1, 7.9, 10]) box(2, 2.3, 0.3, 2.3, x, h, z);
      box(2, 2.3, 0.25, 2.3, x, 10.4, z);
      parts[3].push(
        new THREE.ConeGeometry(1.6, 1.7, 4).rotateY(Math.PI / 4).translate(x, 11.35, z),
      );
      box(4, 0.16, 0.65, 0.16, x, 12.35, z);
      for (const side of [-1, 1]) {
        box(4, 1.1, 2.55, 0.08, x, 6.05, z + side * 1.12);
        box(3, 0.94, 2.39, 0.08, x, 6.05, z + side * 1.17);
        box(4, 0.08, 2.2, 0.06, x, 6.05, z + side * 1.22);
      }
    }
  // A copper-edged slate gable gives the hall a readable silhouette from above.
  box(2, 13.9, 0.4, 11.9, 0, 8.2, 0);
  box(1, 13.4, 0.65, 11.4, 0, 8.7, 0);
  box(2, 13.8, 0.25, 11.8, 0, 9.1, 0);
  const pediment = new THREE.Shape();
  pediment.moveTo(-4.7, 0);
  pediment.lineTo(4.7, 0);
  pediment.lineTo(0, 2.8);
  pediment.closePath();
  parts[3].push(
    new THREE.ExtrudeGeometry(pediment, { depth: 10.8, bevelEnabled: false }).translate(
      0,
      9.2,
      -5.4,
    ),
  );
  for (const z of [-5.65, 5.65]) {
    parts[2].push(
      new THREE.ExtrudeGeometry(pediment, { depth: 0.18, bevelEnabled: false }).translate(
        0,
        9.2,
        z,
      ),
    );
    for (const side of [-1, 1])
      parts[4].push(
        new THREE.BoxGeometry(5.55, 0.16, 0.16)
          .rotateZ(-side * Math.atan2(2.8, 4.7))
          .translate(side * 2.35, 10.6, z + 0.22),
      );
  }
  box(4, 0.18, 0.18, 11.5, 0, 12.07, 0);
  // Monumental portal: paired stone columns, stepped capitals and a carved arch.
  for (const x of [-4.2, 4.2]) {
    box(2, 1.0, 0.5, 0.7, x, 0.6, 5.77);
    box(1, 0.66, 6.7, 0.55, x, 4.0, 5.8);
    box(2, 0.22, 6.3, 0.13, x, 4.0, 6.12);
    box(2, 1.0, 0.4, 0.7, x, 7.5, 5.77);
    box(4, 1.02, 0.12, 0.72, x, 7.75, 5.77);
  }
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI;
    parts[2].push(
      new THREE.BoxGeometry(0.86, 0.55, 0.3)
        .rotateZ(a - Math.PI / 2)
        .translate(Math.cos(a) * 3.65, 4.55 + Math.sin(a) * 3.65, 6.0),
    );
  }
  // Raised lock crest and ornamental lintel studs, visible above the great door.
  parts[4].push(new THREE.TorusGeometry(0.42, 0.1, 6, 20).translate(0, 10.35, 5.95));
  box(4, 0.8, 0.58, 0.15, 0, 9.91, 5.95);
  for (const x of [-3, -2, -1, 1, 2, 3]) box(4, 0.25, 0.25, 0.13, x, 8.7, 5.83);
  for (const [index, geometries] of parts.entries()) {
    const soups = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
    const geometry = mergeGeometries(soups, false)!;
    for (const part of new Set([...geometries, ...soups])) part.dispose();
    const material = cloneMaterialWithHooks(
      surfaceMat({
        color: colors[index],
        roughness: index === 4 ? 0.4 : 0.92,
        metalness: index === 4 ? 0.65 : 0,
      }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    occluderFadeRecordFor(mats, material, mesh);
  }
  const door = buildVaultDoor(0, mats);
  door.scale.setScalar(1.28);
  door.position.set(0, 0.35, 5.95);
  group.add(door);
  group.position.set(layout.x, y, layout.z);
  group.rotation.y = layout.rot;
  return {
    group,
    hideTarget: {
      group,
      mats,
      hidden: false,
      alpha: 1,
      x: layout.x,
      z: layout.z,
      halfWidth: layout.w / 2,
      halfDepth: layout.d / 2,
      cosine: Math.cos(layout.rot),
      sine: Math.sin(layout.rot),
      topY: y + layout.height,
      cullRadius: Math.hypot(layout.w / 2, layout.d / 2),
    },
  };
}

// The Nightbloom's dressing, render-only: fields of emissive lumen blossoms
// that carry the realm's name, and glow lights at the two stone rings and the
// Moonwell. Same contract as the sibling realm modules: build once,
// update(time) animates gently, glowLights join the renderer's rank-culled
// fireLights budget. (The dreambeam shafts were removed at the user's request.)
import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { GFX } from './gfx';

export interface NightFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

const NIGHT_ZMIN = 1260;
const NIGHT_ZMAX = 1820;

// Lumen blossom clusters: patches of tall glowing flowers, thickest around
// the pools and the flower downs (deterministic hash placement like the
// foliage grid, but emissive so they bloom on composer tiers).
const BLOSSOM_FIELDS = [
  { x: -444, z: 1496, r: 34 }, // Gloamfield
  { x: -298, z: 1388, r: 26 }, // the Moonwell's shore
  { x: -380, z: 1340, r: 24 }, // the Nightgate meadows
  { x: -330, z: 1520, r: 28 }, // the midrealm saddle
  { x: -354, z: 1666, r: 22 }, // the barrow downs
] as const;

const BLOSSOM_TINTS = [0x9fdcff, 0xe8f4ff, 0xc8a8ff, 0xa0ffd8];

export function buildNightFeatures(seed: number): NightFeaturesView {
  const group = new THREE.Group();
  group.name = 'night-features';
  const glowLights: THREE.PointLight[] = [];
  const pulsing: { mat: THREE.MeshStandardMaterial | null; phase: number }[] = [];

  // --- lumen blossoms: stem + emissive head, instanced per tint ---
  {
    const stemGeo = new THREE.CylinderGeometry(0.035, 0.055, 1.0, 4);
    stemGeo.translate(0, 0.5, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.16, 0);
    headGeo.translate(0, 1.05, 0);
    const stemMat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ color: 0x3c5048, roughness: 0.9, flatShading: true })
      : new THREE.MeshLambertMaterial({ color: 0x3c5048, flatShading: true });
    const spots: { x: number; z: number; y: number; s: number; tint: number }[] = [];
    for (const f of BLOSSOM_FIELDS) {
      const count = 26 + Math.floor(hash2(f.x, f.z, seed + 3101) * 14);
      for (let k = 0; k < count; k++) {
        const ang = hash2(k, f.x + f.z, seed + 3111) * Math.PI * 2;
        const dist = Math.sqrt(hash2(f.z, k * 3, seed + 3121)) * f.r;
        const x = f.x + Math.sin(ang) * dist;
        const z = f.z + Math.cos(ang) * dist;
        if (z < NIGHT_ZMIN + 8 || z > NIGHT_ZMAX - 8) continue;
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 0.6) continue;
        spots.push({
          x,
          z,
          y,
          s: 0.7 + hash2(k, f.z, seed + 3131) * 0.9,
          tint: BLOSSOM_TINTS[Math.floor(hash2(x, z, seed + 3141) * BLOSSOM_TINTS.length)],
        });
      }
    }
    const place = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      tinted: boolean,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, hash2(sp.x, sp.z, seed + 3151) * Math.PI * 2);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
        if (tinted) mesh.setColorAt(i, new THREE.Color(sp.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      return mesh;
    };
    place(stemGeo.toNonIndexed(), stemMat, false);
    const headMat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.9,
          roughness: 0.6,
          flatShading: true,
        })
      : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    place(headGeo.toNonIndexed(), headMat, true); // instanceColor tints emission
    pulsing.push({
      mat: GFX.standardMaterials ? (headMat as THREE.MeshStandardMaterial) : null,
      phase: 0,
    });
  }

  // --- glow at the stone rings and the tarn: soft dream-fire ---
  const GLOWS = [
    { x: -272, z: 1538, c: 0xc8b4ff, i: 1.6 }, // the Standing Vigil
    { x: -360, z: 1650, c: 0xb0a0e8, i: 1.4 }, // the Sleepless Barrow
    { x: -290, z: 1380, c: 0xffc8ec, i: 1.2 }, // the Moonwell's water glow
  ];
  for (const g of GLOWS) {
    const y = Math.max(terrainHeight(g.x, g.z, seed), WATER_LEVEL) + 3;
    const light = new THREE.PointLight(g.c, g.i, 34, 2);
    light.position.set(g.x, y, g.z);
    group.add(light);
    glowLights.push(light);
  }

  return {
    group,
    glowLights,
    update(time: number): void {
      // the blossom field pulses almost imperceptibly
      for (const p of pulsing) {
        if (p.mat) p.mat.emissiveIntensity = 0.8 + 0.25 * Math.sin(time * 0.6 + p.phase);
      }
    },
  };
}

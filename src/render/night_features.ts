// The Nightbloom's dressing, render-only: fields of softly glowing lumen blossoms
// that carry the realm's name, and glow lights at the two stone rings and the
// Moonspring. Same contract as the sibling realm modules: build once,
// update(time) animates gently, glowLights join the renderer's rank-culled
// fireLights budget. (The dreambeam shafts were removed at the user's request.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  { x: -298, z: 1388, r: 26 }, // the Moonspring's shore
  { x: -380, z: 1340, r: 24 }, // the Nightgate meadows
  { x: -330, z: 1520, r: 28 }, // the midrealm saddle
  { x: -354, z: 1666, r: 22 }, // the barrow downs
] as const;

const BLOSSOM_TINTS = [0x9fdcff, 0xe8f4ff, 0xc8a8ff, 0xa0ffd8];
/** How brightly a bloom glows in its own colour: enough to carry at night, low enough that
 *  the petals keep their colour by day. */
const LUMEN_GLOW = 0.45;

/** The stem and its two blade leaves, a yard tall at unit scale. */
export function lumenStemGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.022, 0.04, 1.0, 5);
  stem.translate(0, 0.5, 0);
  const parts: THREE.BufferGeometry[] = [stem];
  for (const side of [0, 1]) {
    const leaf = new THREE.ConeGeometry(0.11, 0.62, 4);
    leaf.scale(1, 1, 0.22); // a blade, not a spike
    leaf.translate(0, 0.31, 0);
    leaf.rotateZ(side ? -0.7 : 0.7);
    leaf.rotateY(side ? 0.5 : 2.3);
    leaf.translate(0, 0.04, 0);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}

/** The bloom: six pointed petals opened round a small heart, at the head of the stem. */
export function lumenBloomGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const petals = 6;
  for (let k = 0; k < petals; k++) {
    const petal = new THREE.SphereGeometry(0.5, 5, 4);
    petal.scale(0.17, 0.42, 0.06); // a pointed oval blade
    petal.translate(0, 0.2, 0);
    petal.rotateX(0.95); // opened outward from the heart
    petal.rotateY((k / petals) * Math.PI * 2);
    petal.translate(0, 1.0, 0);
    parts.push(petal);
  }
  const heart = new THREE.SphereGeometry(0.07, 5, 4);
  heart.translate(0, 1.04, 0);
  parts.push(heart);
  return mergeGeometries(parts);
}

export function buildNightFeatures(seed: number): NightFeaturesView {
  const group = new THREE.Group();
  group.name = 'night-features';
  const glowLights: THREE.PointLight[] = [];
  const pulsing: { mat: THREE.MeshStandardMaterial | null; phase: number }[] = [];

  // --- lumen blossoms: a slender stem, two blade leaves and an open six-petal bloom ---
  // (They were a white ball on a stick: an icosahedron lit white on a four-sided post, the
  // tint riding the albedo while the emission stayed white. By day that read as a lamp
  // standing in the meadow. A bloom in its own colour, glowing softly in that colour, is a
  // flower by day and still the realm's light by night.)
  {
    const stemMat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ color: 0x4f7a5c, roughness: 0.9, flatShading: true })
      : new THREE.MeshLambertMaterial({ color: 0x4f7a5c, flatShading: true });
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
          tint: Math.floor(hash2(x, z, seed + 3141) * BLOSSOM_TINTS.length),
        });
      }
    }
    const place = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof spots): void => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      list.forEach((sp, i) => {
        q.setFromAxisAngle(up, hash2(sp.x, sp.z, seed + 3151) * Math.PI * 2);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    place(lumenStemGeometry(), stemMat, spots);
    const bloomGeo = lumenBloomGeometry();
    BLOSSOM_TINTS.forEach((tint, index) => {
      // one material a tint, so the bloom glows in its own colour (an instance colour
      // tints the albedo only and would leave every bloom glowing white)
      const bloomMat = GFX.standardMaterials
        ? new THREE.MeshStandardMaterial({
            color: tint,
            emissive: tint,
            emissiveIntensity: LUMEN_GLOW,
            roughness: 0.6,
            flatShading: true,
          })
        : new THREE.MeshLambertMaterial({ color: tint, flatShading: true });
      place(
        bloomGeo,
        bloomMat,
        spots.filter((sp) => sp.tint === index),
      );
      pulsing.push({
        mat: GFX.standardMaterials ? (bloomMat as THREE.MeshStandardMaterial) : null,
        phase: index * 1.7,
      });
    });
  }

  // --- glow at the stone rings and the tarn: soft dream-fire ---
  const GLOWS = [
    { x: -272, z: 1538, c: 0xc8b4ff, i: 1.6 }, // the Standing Vigil
    { x: -360, z: 1650, c: 0xb0a0e8, i: 1.4 }, // the Sleepless Barrow
    { x: -290, z: 1380, c: 0xffc8ec, i: 1.2 }, // the Moonspring's water glow
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
        if (p.mat)
          p.mat.emissiveIntensity = LUMEN_GLOW * (1 + 0.3 * Math.sin(time * 0.6 + p.phase));
      }
    },
  };
}

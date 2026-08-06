// The Frostveil's aurora: long translucent ribbons hung high over the Reach,
// drawn with soft canvas gradients and additive blending so they bloom gently
// on composer tiers. Render-only; update(time) drives a slow shimmer (drift,
// waving opacity) with no per-frame allocation.
import * as THREE from 'three';
import { FROSTVEIL_ROADS } from '../sim/content/frostveil';
import { hash2 } from '../sim/rng';
import { terrainHeight } from '../sim/world';
import { auroraFadeBand } from './frost_sky_fade_core';

export interface FrostSkyView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number, camX: number, camZ: number): void;
}

const ICEMANTLE = { x: -30, z: 1560 };
const LANTERN_REACH = 95; // posts line the roads this far out of town
const LANTERN_SPACING = 13;

// Ice shards: glassy blue spires scattered over the benches, with monolith
// rings at the landmarks (the Reach's answer to the Hollow's crystals).
const ICE_FIELDS = [
  { x: 30, z: 1745, r: 26, n: 12 }, // the Aurora Steps
  { x: 52, z: 1638, r: 20, n: 8 }, // Glacier Tarn's shore
  { x: 96, z: 1816, r: 22, n: 9 }, // the Howling Terraces
  { x: -84, z: 1738, r: 18, n: 6 }, // the Shiverfen's edge
  { x: -10, z: 1660, r: 40, n: 8 }, // the inner valley, scattered wide
] as const;
const ICE_TINTS = [0xbfe8ff, 0x9fd4f2, 0xd8f2ff];

const RIBBONS = [
  { x: -60, z: 1660, y: 130, len: 420, h: 46, rot: 0.5, tint: 0x62f2b2, phase: 0 },
  { x: 40, z: 1740, y: 150, len: 470, h: 56, rot: -0.35, tint: 0x52e8d8, phase: 2.1 },
  { x: -10, z: 1580, y: 118, len: 360, h: 36, rot: 0.15, tint: 0x96f2da, phase: 4.2 },
  { x: 90, z: 1830, y: 142, len: 340, h: 42, rot: -0.7, tint: 0x72e8a2, phase: 1.3 },
  { x: -90, z: 1800, y: 158, len: 380, h: 40, rot: 0.9, tint: 0x58e8c0, phase: 3.2 },
  { x: 30, z: 1900, y: 136, len: 320, h: 34, rot: -0.15, tint: 0x7af2c8, phase: 5.1 },
] as const;

// Real aurora anatomy: a sharp bright LOWER border that fades upward into
// long ray columns of varying width and strength (the canvas y axis maps to
// curtain height; y=64 is the bottom edge).
function auroraTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // body: brightest just above the lower border, long fade to the top
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.93, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);
  // ray columns: tall streaks rising from the bright border, uneven
  for (let i = 0; i < 46; i++) {
    const sx = (i * 89 + ((i * i * 31) % 40)) % 512;
    const w = 2 + ((i * 13) % 12);
    const a = 0.08 + ((i * 29) % 12) / 34;
    const top = ((i * 41) % 50) / 100; // rays reach different heights
    const ray = ctx.createLinearGradient(0, 0, 0, 128);
    ray.addColorStop(Math.max(0, top), 'rgba(255,255,255,0)');
    ray.addColorStop(0.88, `rgba(255,255,255,${a})`);
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(sx, 0, w, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function buildFrostSky(seed = 0): FrostSkyView {
  const group = new THREE.Group();
  group.name = 'frost-sky';
  const glowLights: THREE.PointLight[] = [];
  const lanternMats: THREE.MeshStandardMaterial[] = [];

  // --- lantern posts along the roads into Icemantle: small warm flames in
  // the blue cold, the thing that makes the village read as shelter ---
  {
    const spots: { x: number; z: number; y: number }[] = [];
    for (const road of FROSTVEIL_ROADS) {
      for (let i = 0; i + 1 < road.length; i++) {
        const a = road[i];
        const b = road[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (let d = LANTERN_SPACING / 2; d < len; d += LANTERN_SPACING) {
          const t = d / len;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          if (Math.hypot(x - ICEMANTLE.x, z - ICEMANTLE.z) > LANTERN_REACH) continue;
          // offset to alternate roadsides
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          const side = spots.length % 2 === 0 ? 2.2 : -2.2;
          const lx = x + nx * side;
          const lz = z + nz * side;
          const y = terrainHeight(lx, lz, seed);
          if (y < -3) continue;
          spots.push({ x: lx, z: lz, y });
        }
      }
    }
    if (spots.length > 0) {
      const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 2.4, 5);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
      const posts = new THREE.InstancedMesh(postGeo, postMat, spots.length);
      const headGeo = new THREE.OctahedronGeometry(0.34, 0);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xffdf9a,
        emissive: 0xffa848,
        emissiveIntensity: 1.4,
        roughness: 0.6,
      });
      lanternMats.push(headMat);
      const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3(1, 1, 1);
      spots.forEach((sp, i) => {
        v.set(sp.x, sp.y + 1.2, sp.z);
        posts.setMatrixAt(i, m.compose(v, q, sc));
        v.set(sp.x, sp.y + 2.55, sp.z);
        heads.setMatrixAt(i, m.compose(v, q, sc));
      });
      posts.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      posts.castShadow = true;
      posts.computeBoundingSphere();
      heads.computeBoundingSphere();
      group.add(posts);
      group.add(heads);
      // a warm pool of light at every third post (the fireLights budget
      // rank-culls, so the town approach stays lit without a light per post)
      spots.forEach((sp, i) => {
        if (i % 3 !== 0) return;
        const light = new THREE.PointLight(0xffa848, 4, 12, 2);
        light.position.set(sp.x, sp.y + 2.7, sp.z);
        light.userData.baseIntensity = 4;
        glowLights.push(light);
        group.add(light);
      });
    }
  }

  // --- ice shards on the benches ---
  {
    const shardGeo = new THREE.OctahedronGeometry(1, 0);
    shardGeo.scale(0.34, 1.9, 0.34);
    const geo = shardGeo.toNonIndexed();
    const spots: { x: number; z: number; y: number; s: number; rot: number; tint: number }[] = [];
    ICE_FIELDS.forEach((f, fi) => {
      for (let k = 0; k < f.n; k++) {
        const ang = hash2(k + fi * 17, 5, 4021) * Math.PI * 2;
        const dist = Math.sqrt(hash2(k, fi + 9, 4031)) * f.r;
        const x = f.x + Math.sin(ang) * dist;
        const z = f.z + Math.cos(ang) * dist;
        const y = terrainHeight(x, z, seed);
        if (y < -3) continue;
        spots.push({
          x,
          z,
          y: y + 0.4,
          s: 0.8 + hash2(k, fi, 4041) * 2.6,
          rot: hash2(fi, k, 4051) * Math.PI * 2,
          tint: ICE_TINTS[Math.floor(hash2(k + fi, 3, 4061) * ICE_TINTS.length)],
        });
      }
    });
    if (spots.length > 0) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcfeaf8,
        emissive: 0x2a5a78,
        emissiveIntensity: 0.35,
        roughness: 0.15,
        metalness: 0.1,
        flatShading: true,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const qT = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        axis.set(Math.sin(sp.rot * 2.3), 0, Math.cos(sp.rot * 2.3)).normalize();
        qT.setFromAxisAngle(axis, (hash2(i, 7, 4071) - 0.5) * 0.5);
        q.premultiply(qT);
        v.set(sp.x, sp.y + sp.s * 0.7, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
        mesh.setColorAt(i, new THREE.Color(sp.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  const tex = auroraTexture();
  const ribbons: {
    mat: THREE.MeshBasicMaterial;
    mesh: THREE.Mesh;
    base: number;
    phase: number;
    drift: number;
  }[] = [];

  if (tex) {
    const curtain = (
      r: (typeof RIBBONS)[number],
      tint: number,
      base: number,
      lift: number,
      drift: number,
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: tint,
        transparent: true,
        opacity: base,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      // gentle S-curve: a few segments with a sine offset baked into the verts
      const geo = new THREE.PlaneGeometry(r.len, r.h * (1 + lift * 0.5), 24, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        pos.setZ(i, Math.sin((px / r.len) * Math.PI * 2 + r.phase + lift * 0.8) * 16);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(r.x, r.y + lift * r.h * 0.55, r.z - lift * 6);
      mesh.rotation.y = r.rot;
      mesh.rotation.x = 0.18; // lean the curtain slightly overhead
      mesh.renderOrder = 2;
      group.add(mesh);
      ribbons.push({ mat, mesh, base, phase: r.phase + lift * 2.4, drift });
    };
    for (const r of RIBBONS) {
      // the main green curtain, and a taller fainter violet veil behind it
      // (real displays crown red-violet above the green border)
      curtain(r, r.tint, 0.8, 0, 0.008);
      curtain(r, 0xa06ae8, 0.3, 1, -0.005);
    }
  }

  return {
    group,
    glowLights,
    update(time: number, camX: number, camZ: number): void {
      // lantern flames flicker together, gently
      for (const mat of lanternMats) {
        mat.emissiveIntensity = 1.4 + Math.sin(time * 6.2) * 0.12 + Math.sin(time * 1.7) * 0.1;
      }
      // The aurora belongs to the Reach: the curtains hang far above the
      // fog (fog: false, additive), so without this gate every neighboring
      // realm sees them over its horizon. Fade with the CAMERA across the
      // frost rect's edges: its z band, and (now that the Reach is the
      // center strip with realms on both sides) both x borders, so the
      // aurora never shows over the Drakelands east of x 180 nor the
      // Amberfall west of x -180. The boundary math is the pure core
      // frost_sky_fade_core.ts, so its zone-edge value stays testable
      // without a canvas/document.
      const band = auroraFadeBand(camX, camZ);
      for (const r of ribbons) {
        r.mesh.visible = band > 0.001;
        if (!r.mesh.visible) continue;
        // slow curtain shimmer: opacity waves and the ray columns drift
        // (layers drift in opposite directions, which is what sells the
        // depth of a real display)
        r.mat.opacity = r.base * (0.75 + 0.25 * Math.sin(time * 0.21 + r.phase)) * band;
        if (r.mat.map) r.mat.map.offset.x = (time * r.drift + r.phase) % 1;
      }
    },
  };
}

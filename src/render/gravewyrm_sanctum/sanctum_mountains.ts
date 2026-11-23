// The cirque round the Gravewyrm Sanctum: the eroded heightfield built by
// docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_mountains.py and
// shipped by scripts/assets/gravewyrm_sanctum_mountains/build.mjs as ONE mesh
// (the ring of Thornpeak's summits closing the bowl on every side, the pass
// behind the Gate Landing, the crevasse floor under the field at -62 to -74,
// and the Quench rising behind the Calving Face) with a painted albedo and an
// OBJECT-SPACE normal map in the GLB's occlusion slot. Loaded when a Sanctum interior is first built and
// awaited (capped), so its program and buffers reach the GPU behind the
// interior's compile gate. If it fails to load, a procedural ring of slate
// massifs and a glacier tongue stands in.
//
// Cosmetic only: no light. The aurora's glow reaches the snow of the peaks as
// a faint emissive wash (a colour write, driven with the shard's beat).

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import { markSharedGeometry, markSharedMaterial, markSharedTexture } from '../shared_resource';
import { SANCTUM_SHARD_UNIFORMS } from './sanctum_face';
import { FACE_HALF, FACE_ORIGIN, FACE_TOP } from './sanctum_face_core';
import { sanctumHash, sanctumNoise } from './sanctum_plan_core';

export const GRAVEWYRM_SANCTUM_MOUNTAINS_URL = '/models/props/gravewyrm_sanctum_mountains.glb';

interface MountainParts {
  matrix: THREE.Matrix4;
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  objectNormals: THREE.Texture | null;
}

let parts: MountainParts | null = null;
let loading: Promise<void> | null = null;
const WAIT_MS = 9000;
const materials = new Map<boolean, THREE.MeshLambertMaterial>();

/** Fetch the mountains once. Never rejects (a failed load keeps the stand-in). */
export function ensureSanctumMountains(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  loading ??= loadGltf(GRAVEWYRM_SANCTUM_MOUNTAINS_URL)
    .then((gltf) => {
      gltf.scene.updateWorldMatrix(true, true);
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || parts) return;
        const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
          | THREE.MeshStandardMaterial
          | undefined;
        const matrix = mesh.matrixWorld.clone();
        if (m?.map) markSharedTexture(m.map);
        if (m?.aoMap) markSharedTexture(m.aoMap);
        parts = {
          matrix,
          geometry: markSharedGeometry(carveFaceBlock(mesh.geometry, matrix)),
          map: m?.map ?? null,
          objectNormals: m?.aoMap ?? null,
        };
      });
      releaseGltf(GRAVEWYRM_SANCTUM_MOUNTAINS_URL);
    })
    .catch(() => undefined);
  return Promise.race([loading, new Promise<void>((r) => setTimeout(r, WAIT_MS))]);
}

/**
 * The Calving Face is a block of glacier ice standing IN the Quench's snout
 * (the kit's face frame: its front, its crest running back 60 yd, its flanks,
 * the hollow behind the shell). The heightfield's own steep snout is carved
 * out inside that block ONCE, here at load (every triangle whose three
 * corners lie inside it is dropped from the index; the face's own geometry
 * covers the ragged rim), so the face, the hollow and the wyrm in it are
 * never buried in the slope behind, and no fragment discard ever costs the
 * mountain its early depth.
 */
function carveFaceBlock(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const box = faceBlock();
  const v = new THREE.Vector3();
  const inside = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const fx = v.x / box.half;
    if (Math.abs(fx) > 1) continue;
    const frontZ = box.front - box.wing * fx * fx;
    const top = box.top - box.fall * fx * fx * Math.abs(fx);
    if (v.z >= frontZ && v.z <= box.back && v.y <= top) inside[i] = 1;
  }
  const src = geometry.index;
  const triCount = src ? src.count / 3 : pos.count / 3;
  const corner = (t: number, k: number) => (src ? src.getX(t * 3 + k) : t * 3 + k);
  const kept: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    if (inside[a] && inside[b] && inside[c]) continue;
    kept.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) out.setAttribute(name, attr);
  out.setIndex(
    pos.count > 65535
      ? new THREE.Uint32BufferAttribute(kept, 1)
      : new THREE.Uint16BufferAttribute(kept, 1),
  );
  out.boundingSphere = geometry.boundingSphere;
  if (!out.boundingSphere) out.computeBoundingSphere();
  return out;
}

/** Has the heightfield landed? */
export function sanctumMountainsLoaded(): boolean {
  return parts !== null;
}

function mountainMaterial(lowGfx: boolean, p: MountainParts): THREE.MeshLambertMaterial {
  let m = materials.get(lowGfx);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      map: p.map,
      // The aurora's faint wash on the rock's own paint (never a flat tint).
      emissiveMap: p.map,
      emissive: 0x000000,
      name: 'gravewyrmSanctumMountainRock',
    });
    if (!lowGfx && p.objectNormals) {
      m.normalMap = p.objectNormals;
      m.normalMapType = THREE.ObjectSpaceNormalMap;
    }
    const local = { value: p.matrix.clone() };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uMtnLocal = local;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform mat4 uMtnLocal;\nvarying vec3 vInField;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvInField = (uMtnLocal * vec4(position, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vInField;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            // The Quench behind the face: the baked albedo's blotches smoothed
            // into a glacier's own look (old snow over blue ice, transverse
            // crevasses as dark blue lines across the flow, wind-scoured
            // bands), so the showpiece's backdrop reads as one great tongue.
            float q = smoothstep(240.0, 300.0, vInField.z) * smoothstep(150.0, 90.0, abs(vInField.x));
            if (q > 0.0) {
              float flow = vInField.z * 0.11 + sin(vInField.x * 0.035) * 2.2;
              float crev = smoothstep(0.93, 1.0, abs(sin(flow)));
              float band = 0.5 + 0.5 * sin(vInField.x * 0.06 + vInField.z * 0.012);
              vec3 snow = vec3(0.62, 0.7, 0.8);
              vec3 blue = vec3(0.16, 0.36, 0.56);
              vec3 g = mix(snow, blue, 0.18 + 0.25 * band);
              g = mix(g, vec3(0.03, 0.09, 0.2), crev * 0.85);
              diffuseColor.rgb = mix(diffuseColor.rgb, g, q * 0.82);
            }
          }`,
        );
    };
    m.customProgramCacheKey = () => 'gravewyrmSanctumMountainQuench';
    markSharedMaterial(m);
    materials.set(lowGfx, m);
  }
  return m;
}

/** The face block carved out of the snout (instance frame): the face's
 *  half width, its front at the middle and how far the wings come forward,
 *  its back (the crest's run back), its top over the middle and the fall to
 *  its wings. */
function faceBlock(): {
  half: number;
  front: number;
  wing: number;
  back: number;
  top: number;
  fall: number;
} {
  return {
    half: FACE_HALF + 3,
    front: FACE_ORIGIN.z - 8,
    wing: 22,
    back: FACE_ORIGIN.z + 58,
    top: FACE_TOP - 36,
    fall: 30,
  };
}

/** Wash the peaks in the aurora's light (a colour write). */
export function setSanctumMountainAurora(level: number): void {
  const k = Math.max(0, Math.min(2, level)) * 0.05;
  for (const m of materials.values()) m.emissive.setRGB(0.42 * k, 0.75 * k, 0.62 * k);
}

// ---- the procedural stand-in --------------------------------------------------------

/** A ring of slate massifs round the bowl and the Quench's tongue in the north
 *  (one merged, vertex-painted, smooth-shaded mesh). */
function standInMountains(): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cx = 0;
  const cz = 40;
  const rings = 26;
  const segs = 128;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const rx = 170 + t * 420;
      const rz = 300 + t * 420;
      const x = cx + Math.sin(a) * rx;
      const z = cz + Math.cos(a) * rz;
      const ridge = sanctumNoise(Math.cos(a) * 4 + 10, Math.sin(a) * 4 + 10, 3, 4);
      const crest = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
      let y = -70 + crest * (200 + ridge * 160) * (1 - Math.max(0, t - 0.75) * 1.6);
      // The Quench: a broad tongue of ice rising behind the face.
      const north = Math.max(0, Math.cos(a)) ** 6;
      y = y * (1 - north * 0.5) + north * (60 + t * 170);
      positions.push(x, y, z);
      const snow = Math.max(0, Math.min(1, (y - 60) / 80 + north * 0.8));
      const r = 0.07 + sanctumHash(i, j) * 0.02;
      colors.push(r + snow * 0.6, r + snow * 0.68, r + 0.02 + snow * 0.76);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = a + segs + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      name: 'gravewyrmSanctumPeaksStandIn',
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'gravewyrmSanctumPeaksStandIn';
  mesh.frustumCulled = false;
  return mesh;
}

/** The mountains' mesh (instance-local frame): the heightfield, else the
 *  stand-in ring. */
export function buildSanctumMountains(lowGfx: boolean): THREE.Mesh {
  if (!parts) return standInMountains();
  const mesh = new THREE.Mesh(parts.geometry, mountainMaterial(lowGfx, parts));
  mesh.name = 'gravewyrmSanctumPeaks';
  mesh.applyMatrix4(parts.matrix);
  // The camera stands inside it: never culled.
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** The peaks' aurora wash, from the shard's light this frame. */
export function syncSanctumMountains(): void {
  setSanctumMountainAurora(SANCTUM_SHARD_UNIFORMS.uAurora.value);
}

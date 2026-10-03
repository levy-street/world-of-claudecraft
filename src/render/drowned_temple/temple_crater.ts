// The Drowned Temple's crater: the ring of dark basalt that walls the lagoon
// (a steep inner face dropping from the rim into the water, the rim rising to
// the moonlit crags), the waterfalls pouring off it (three great falls under
// the moon on the north rim, one off the west, and the curtain the Waterfall
// Walk passes behind, spilling off a rock overhang high above the walk), their
// plunge foam, spray and mist.
//
// Render only and entirely outside the walkable field (the inner face's foot
// stops short of every walkway; tests/drowned_temple_render_core.test.ts).
// Motion is shader-side on the shared clock; spray counts shed with the tier.

import * as THREE from 'three';
import { DROWNED_TEMPLE_WATER_LEVEL } from '../../sim/content/drowned_temple_layout';
import { rockDetail } from '../authored_field/field_textures';
import { sharedUniforms } from '../gfx';
import { DROWNED_TEMPLE_MOON_DIRECTION } from '../interior_light_rig';
import {
  CRATER_ROWS,
  craterCrest,
  craterInward,
  TEMPLE_WATERFALLS,
  type TempleWaterfall,
  templeHash,
  WALK_OVERHANG,
} from './temple_plan_core';

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

/** Smooth 2D value noise for the rock's relief (deterministic). */
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number) => templeHash(a * 7.13 + b * 1.7, a * 3.1 - b * 9.7);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function relief(x: number, z: number): number {
  return (
    vnoise(x * 0.05, z * 0.05) * 0.6 +
    vnoise(x * 0.17, z * 0.17) * 0.3 +
    vnoise(x * 0.5, z * 0.5) * 0.1
  );
}

/** The crater ring: one closed band of rock round the lagoon. */
function buildCraterRing(lowGfx: boolean): THREE.Mesh {
  const crest = craterCrest(lowGfx ? 9 : 4.5);
  const rows = CRATER_ROWS;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const moon = DROWNED_TEMPLE_MOON_DIRECTION;
  const water = DROWNED_TEMPLE_WATER_LEVEL;
  for (let i = 0; i < crest.length; i++) {
    const [cx, cz, ch] = crest[i];
    const [nx, nz] = craterInward(cx, cz);
    for (let r = 0; r < rows.length; r++) {
      const [inset, share] = rows[r];
      const n = relief(cx + r * 13.1, cz - r * 7.7);
      // The inner face is jagged in and out; the rim plateau rolls.
      const n2 = relief(cx * 2.3 + r * 5.1, cz * 2.3 - r * 3.3);
      const jag = r <= 4 ? (n - 0.5) * 7 + (n2 - 0.5) * 4 : (n - 0.5) * 16 + (n2 - 0.5) * 6;
      const x = cx + nx * (inset + (r <= 3 ? jag * 0.5 : 0));
      const z = cz + nz * (inset + (r <= 3 ? jag * 0.5 : 0));
      let y = share >= 0 ? ch * share + (r >= 3 ? jag : jag * 0.4) : share * 40;
      if (r === rows.length - 1) y = ch * share - 6;
      positions.push(x, y, z);
      uvs.push((cx + cz) * 0.06 + r * 0.7, y * 0.08);
      // Near-black wet basalt at the water, cold moonlit grey up the face,
      // a rim lit silver where it turns toward the moon, algae at the tideline.
      const depth = Math.max(0, water + 1 - y);
      const facing = Math.max(0, -(nx * moon.x + nz * moon.z));
      const strata = 0.5 + 0.5 * Math.sin(y * 0.55 + n2 * 5);
      const shade =
        0.085 + Math.min(1, Math.max(0, y) / Math.max(1, ch)) * 0.07 + n * 0.05 + strata * 0.025;
      const wet = Math.max(0, 1 - Math.max(0, y - water) / 3);
      const algae = Math.max(0, 1 - Math.abs(y - water - 1.2) / 1.6);
      const lit = facing * 0.08 * (r >= 3 ? 1 : 0.4);
      const k = Math.max(0.2, 1 - depth / 25);
      colors.push(
        (shade * (1 - wet * 0.45) + algae * 0.03 + lit * 0.9) * k,
        (shade * (1 - wet * 0.4) + algae * 0.08 + lit * 0.95) * k,
        (shade * 1.12 * (1 - wet * 0.3) + algae * 0.07 + lit * 1.15) * k,
      );
    }
  }
  const R = rows.length;
  const N = crest.length;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (let r = 0; r < R - 1; r++) {
      const a = i * R + r;
      const b = j * R + r;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Faceted basalt (the KayKit read): flat-shaded facets from the jagged
  // relief carry the rock, no tiled texture that would read as masonry.
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const mesh = new THREE.Mesh(
    flat,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      flatShading: true,
      side: THREE.DoubleSide,
      name: 'drownedTempleCrater',
    }),
  );
  void lowGfx;
  mesh.name = 'drownedTempleCrater';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

/** The rock overhang the Walk's curtain pours off, high over the walkway. */
function buildOverhang(lowGfx: boolean): THREE.Mesh {
  const o = WALK_OVERHANG;
  const geo = new THREE.BoxGeometry(o.depth, 9, o.length, lowGfx ? 6 : 12, 3, lowGfx ? 10 : 20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = relief(x + 300, z + 200);
    // A ragged underside: stalactite teeth hang where the water drips.
    const under = y < 0 ? -n * 5 - (templeHash(Math.round(x), Math.round(z)) > 0.8 ? 3 : 0) : n * 3;
    // A wedge, not a slab: toward the crater face (local +x) the shelf swells
    // up and down into the wall, so it reads as rock jutting out of the cliff.
    const t = Math.max(0, Math.min(1, (x + o.depth / 2) / o.depth));
    const swell = y < 0 ? -t * t * 34 : t * t * 12;
    pos.setY(i, y + under + swell);
    pos.setX(i, x + (n - 0.5) * 3);
    const s = 0.1 + n * 0.08;
    col.set([s, s * 1.05, s * 1.25], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const rock = rockDetail();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: rock.map,
      roughness: 0.92,
      name: 'drownedTempleOverhang',
    }),
  );
  // Spans from the crater's east face out to the curtain's lip, along the walk.
  const walkYaw = Math.atan2(0.52, 0.85);
  mesh.position.set(o.x, o.height + 3, o.z);
  mesh.rotation.y = walkYaw;
  mesh.name = 'drownedTempleOverhang';
  return mesh;
}

// ---- waterfalls ---------------------------------------------------------------------------

const FALL_VERT = /* glsl */ `
attribute vec2 aFall; // u across, t down
varying vec2 vFall;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vFall = aFall;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSeed;
uniform float uLength;
varying vec2 vFall;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float u = vFall.x;
  float t = vFall.y;
  // Several ropes of water side by side (never one flat sheet), each wavering,
  // fraying and thinning as it falls, white where it breaks.
  float wav = noise(vec2(u * 3.0 + uSeed, t * 1.5 - uTime * 0.3)) * 0.18;
  float ropes = smoothstep(0.25, 0.62, noise(vec2((u + wav) * 7.0 + uSeed * 3.1, t * 0.35)));
  float speed = 0.9 + t * 1.6;
  vec2 q = vec2((u + wav) * 30.0 + uSeed * 9.0, t * uLength * 0.35 - uTime * speed * 6.0);
  float streak = noise(vec2(q.x, q.y * 0.08)) * 0.6 + noise(vec2(q.x * 2.3, q.y * 0.2)) * 0.4;
  float sheet = smoothstep(0.2, 0.75, streak);
  // Ragged sides that narrow at the lip and spread into spray at the foot.
  float halfW = 0.36 + 0.14 * t + (noise(vec2(t * 6.0 + uSeed, uTime * 0.5)) - 0.5) * 0.12;
  float edge = 1.0 - smoothstep(halfW - 0.12, halfW, abs(u - 0.5));
  float white = smoothstep(0.6, 0.95, streak) + smoothstep(0.1, 0.0, t) * 0.5 + smoothstep(0.82, 1.0, t) * 0.7;
  vec3 deep = vec3(0.3, 0.42, 0.58);
  vec3 foam = vec3(0.86, 0.92, 1.0);
  vec3 col = mix(deep, foam, clamp(white, 0.0, 1.0));
  col += vec3(0.2, 0.26, 0.4) * smoothstep(0.7, 1.0, streak);
  float body = mix(0.35, 1.0, ropes) * (0.45 + 0.45 * sheet);
  float mist = smoothstep(0.75, 1.0, t) * 0.35;
  float a = edge * body + mist * edge;
  gl_FragColor = vec4(col * 0.9, clamp(a, 0.0, 0.88));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function fallGeometry(f: TempleWaterfall, lowGfx: boolean): THREE.BufferGeometry {
  const across = lowGfx ? 6 : 14;
  const down = lowGfx ? 10 : 26;
  const positions: number[] = [];
  const falls: number[] = [];
  const indices: number[] = [];
  const bottom = DROWNED_TEMPLE_WATER_LEVEL - 0.3;
  for (let j = 0; j <= down; j++) {
    const t = j / down;
    for (let i = 0; i <= across; i++) {
      const u = i / across;
      const lx = f.ax + (f.bx - f.ax) * u;
      const lz = f.az + (f.bz - f.az) * u;
      // The water leaves the lip in an arc: out fast, then straight down.
      const out = f.throwOut * (1 - (1 - t) ** 2.2);
      const sway = Math.sin(u * 9 + t * 4) * 0.4 * t;
      positions.push(
        lx + f.nx * (out + sway),
        f.top + (bottom - f.top) * t ** 1.15,
        lz + f.nz * (out + sway),
      );
      falls.push(u, t);
    }
  }
  const row = across + 1;
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFall', new THREE.Float32BufferAttribute(falls, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// Plunge foam: a churning ring where the fall meets the lagoon.
const PLUNGE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x);
  float churn = noise(vec2(a * 3.0 + uSeed, r * 6.0 - uTime * 1.8)) * 0.6 + noise(vec2(a * 7.0, r * 14.0 - uTime * 3.0)) * 0.4;
  float ring = smoothstep(1.0, 0.55, r) * smoothstep(0.35, 0.75, churn);
  vec3 col = mix(vec3(0.55, 0.64, 0.78), vec3(0.9, 0.94, 1.0), churn);
  gl_FragColor = vec4(col, ring * 0.75);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const PLUNGE_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// Spray: soft puffs flung up and out from the plunge, falling back and fading.
const SPRAY_VERT = /* glsl */ `
attribute vec4 aSpray; // x, z along the plunge, phase, speed
attribute vec2 aDir;   // outward direction
uniform float uTime;
uniform float uBase;
varying float vLife;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float life = fract(uTime * aSpray.w + aSpray.z);
  vLife = life;
  vec3 c = vec3(aSpray.x, uBase, aSpray.y);
  c.xz += aDir * life * 9.0;
  c.y += sin(life * 3.14159) * (4.0 + aSpray.w * 10.0);
  float size = 2.0 + life * 5.0;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(c, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SPRAY_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * (1.0 - vLife) * smoothstep(0.0, 0.15, vLife) * 0.35;
  gl_FragColor = vec4(vec3(0.78, 0.84, 0.95), a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildFall(
  f: TempleWaterfall,
  index: number,
  lowGfx: boolean,
  density: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `drownedTempleFall:${f.id}`;
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleWaterfall',
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    uniforms: {
      ...fogUniforms(),
      uTime: sharedUniforms.uTime,
      uSeed: { value: index * 3.7 },
      uLength: { value: f.top },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const sheet = new THREE.Mesh(fallGeometry(f, lowGfx), material);
  sheet.renderOrder = 7;
  sheet.frustumCulled = false;
  group.add(sheet);
  // Where it lands.
  const mx = (f.ax + f.bx) / 2 + f.nx * f.throwOut;
  const mz = (f.az + f.bz) / 2 + f.nz * f.throwOut;
  const width = Math.hypot(f.bx - f.ax, f.bz - f.az);
  const plunge = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 10, 16, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      name: 'drownedTemplePlunge',
      vertexShader: PLUNGE_VERT,
      fragmentShader: PLUNGE_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime, uSeed: { value: index } },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  plunge.position.set(mx, DROWNED_TEMPLE_WATER_LEVEL + 0.08, mz);
  plunge.rotation.y = Math.atan2(f.bx - f.ax, f.bz - f.az) + Math.PI / 2;
  plunge.renderOrder = 5;
  group.add(plunge);
  // Spray puffs.
  const n = Math.round((lowGfx ? 10 : 36) * Math.max(0.4, density) * Math.max(1, width / 18));
  const base = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const spray = new Float32Array(n * 4);
  const dir = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const u = templeHash(i + index * 100, 3);
    spray.set(
      [
        f.ax + (f.bx - f.ax) * u + f.nx * f.throwOut,
        f.az + (f.bz - f.az) * u + f.nz * f.throwOut,
        templeHash(i + index * 100, 5),
        0.18 + templeHash(i + index * 100, 7) * 0.25,
      ],
      i * 4,
    );
    const spread = (templeHash(i + index * 100, 11) - 0.5) * 1.6;
    dir.set(
      [
        f.nx * Math.cos(spread) - f.nz * Math.sin(spread),
        f.nz * Math.cos(spread) + f.nx * Math.sin(spread),
      ],
      i * 2,
    );
  }
  geo.setAttribute('aSpray', new THREE.InstancedBufferAttribute(spray, 4));
  geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 2));
  geo.instanceCount = n;
  const sprayMesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'drownedTempleSpray',
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uBase: { value: DROWNED_TEMPLE_WATER_LEVEL },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  sprayMesh.frustumCulled = false;
  sprayMesh.renderOrder = 8;
  group.add(sprayMesh);
  return group;
}

export interface TempleCraterOptions {
  lowGfx: boolean;
  density: number;
}

/** The crater ring, the Walk's overhang and every waterfall, instance-local. */
export function buildTempleCrater(opts: TempleCraterOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleCraterGroup';
  group.add(buildCraterRing(opts.lowGfx));
  group.add(buildOverhang(opts.lowGfx));
  TEMPLE_WATERFALLS.forEach((f, i) => {
    group.add(buildFall(f, i, opts.lowGfx, opts.density));
  });
  return group;
}

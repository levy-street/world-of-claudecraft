// The Smith's Heart weapon-skin VFX families (Seamcaller, Squallcrest, the Rimelight Staff,
// Hearthbrand and the Heartmeld Staff), built for src/render/weapon_vfx.ts's createWeaponVfx.
//
// Four component kinds the original catalog had no way to draw:
//   orbiters  solid shards (quarry stone, ice) circling a point and tumbling as they go, lit by a
//             fixed painted key and fresnel rim, with glowing seams. ONE instanced draw.
//   runeRing  a ring of procedurally drawn rune glyphs turning about an axis, a light running
//             round it glyph by glyph.
//   flames    tongues of fire licking off a line (a blade's edges), each an axial billboard whose
//             shape is a scrolling value noise, born and dying on its own clock.
//   vortex    a spinning spiral disc (a storm eye, a gathering of the elements).
//
// The contract every other weapon-VFX family keeps, kept here too:
// - All geometry and materials are built ONCE, up front, by the factory. Motion is the vertex or
//   fragment shader reading `uTime`; the per-frame cost is one uniform write per material (the
//   rig's update loop), nothing allocated.
// - Every authored number arrives as a uniform or an attribute, never shader source, so each kind
//   links exactly one program however many skins use it, and the boot prewarm
//   (buildWeaponVfxPrewarmSkinGroup builds every catalog spec through this same path) links it
//   behind the loading screen.
// - No lights. Additive transparent parts never write depth; the orbiters are opaque and do.
// - Every pow() base is provably non-negative (tests/shader_pow_domain.test.ts): the additive
//   output is bloomed, and one NaN texel becomes a black rectangle.
// - `uOpacity` is the tuning channel each part answers to (createWeaponVfx's applyTuning and the
//   shed lever write it); `uCalm` is the reduced-motion lever (WeaponVfxHandle.setCalm): every
//   kind reads it and slows or steadies its flicker under it (pinned in
//   tests/weapon_vfx_raid_parts.test.ts).
// - Time inside a noise hash is wrapped (`mod(uTime, NOISE_PERIOD)`): a raw clock grows without
//   bound and sin-based hashes go blocky once their argument is large (makeArcs wraps its strike
//   counter for the same reason). The wrap is a single unnoticed reseed every ~8.5 minutes.
// - The orbiting shards are solid: the shed lever dims their glow, not their bodies (an opaque
//   body cannot fade without going transparent); the far-LOD swap removes them with the rig.
//
// Weapon-local space: the GLB's canonical frame, blade or shaft along +Y, the blade's flat in XY.

import * as THREE from 'three';
import type { WeaponVfxAnchor } from './weapon_vfx';

export interface WeaponVfxOrbiters {
  kind: 'orbiters';
  at: WeaponVfxAnchor;
  /** The orbit plane's normal, weapon-local (default +Y: circling the shaft). */
  axis?: [number, number, number];
  count: number;
  radius: [number, number];
  /** Shard length (native units). */
  size: [number, number];
  /** Orbit rate, radians a second (negative turns the other way). */
  speed: [number, number];
  /** Tumble rate about each shard's own axis, radians a second. */
  spin: [number, number];
  tilt: number;
  bob?: number;
  /** 'rock' a hewn quarry chunk with glowing seams, 'ice' a long faceted crystal. */
  shape: 'rock' | 'ice';
  /** The orbit's reach along the plane's first axis as a fraction of `radius` (default 1, a
   *  circle). Under the default +Y axis that axis is weapon Z, so a value below 1 draws an oval
   *  that hugs a head longer than it is deep (the Seamcaller's) instead of standing off its
   *  flanks by the head's full length. */
  depth?: number;
  color: number;
  dark: number;
  glow: number;
  /** How much of the shard's surface carries the glowing seams (0..1). */
  seams?: number;
  /** Glow strength (the tuning channel scales it). */
  opacity?: number;
}

export interface WeaponVfxRuneRing {
  kind: 'runeRing';
  at: WeaponVfxAnchor;
  /** The ring's normal, weapon-local. */
  axis: [number, number, number];
  radius: number;
  /** Band width (native units); the glyphs fill it. */
  width: number;
  /** Turns a second (negative turns the other way). */
  speed: number;
  color: number;
  core: number;
  opacity?: number;
}

export interface WeaponVfxFlames {
  kind: 'flames';
  /** The edge the flames rise from, bottom to top. */
  line: [WeaponVfxAnchor, WeaponVfxAnchor];
  count: number;
  /** Flames sit this far either side of the line along X (a blade's two edges), 0 for one row. */
  spread: number;
  /** Lean of the flame away from the line, as a fraction of its rise. */
  lean: number;
  height: [number, number];
  width: [number, number];
  /** Lives a second. */
  rate: [number, number];
  hot: number;
  mid: number;
  tip: number;
  opacity?: number;
}

export interface WeaponVfxVortex {
  kind: 'vortex';
  at: WeaponVfxAnchor;
  axis: [number, number, number];
  radius: number;
  arms: number;
  /** Turns a second. */
  speed: number;
  /** How tightly the arms wind toward the eye. */
  twist: number;
  outer: number;
  inner: number;
  opacity?: number;
}

export type WeaponVfxRaidComponent =
  | WeaponVfxOrbiters
  | WeaponVfxRuneRing
  | WeaponVfxFlames
  | WeaponVfxVortex;

export interface WeaponVfxRaidPart {
  node: THREE.Object3D;
  mats: THREE.ShaderMaterial[];
}

/** A small deterministic generator for build-time scatter (render-side; never the sim). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r();

/** An orthonormal basis whose Y is `axis` (column vectors), as a mat3 uniform. */
function basisFor(axis: [number, number, number] | undefined): THREE.Matrix3 {
  const y = new THREE.Vector3(...(axis ?? [0, 1, 0])).normalize();
  const ref = Math.abs(y.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(ref, y).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}

/** Seconds after which a shader's noise clock wraps (see the header). */
const NOISE_PERIOD = 512;

const HASH_GLSL = `
  float h11(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
               mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

// ---------------------------------------------------------------------------------------------
// orbiters
// ---------------------------------------------------------------------------------------------

/** The shard every instance draws: flat-shaded, non-indexed, unit length along Y. */
function shardGeometry(shape: 'rock' | 'ice'): THREE.BufferGeometry {
  let base: THREE.BufferGeometry;
  if (shape === 'ice') {
    // a hexagonal bipyramid, long and slim
    const pts: number[] = [];
    const ring = (y: number, r: number) =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      });
    const lo = ring(-0.12, 0.13);
    const hi = ring(0.12, 0.13);
    const top = new THREE.Vector3(0, 0.5, 0);
    const bot = new THREE.Vector3(0, -0.5, 0);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      for (const tri of [
        [hi[i], top, hi[j]],
        [lo[j], bot, lo[i]],
        [lo[i], hi[i], hi[j]],
        [lo[i], hi[j], lo[j]],
      ])
        for (const v of tri) pts.push(v.x, v.y, v.z);
    }
    base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  } else {
    // a hewn chunk: an icosahedron knocked about, a little long
    const ico = new THREE.IcosahedronGeometry(0.42, 0);
    const pos = ico.getAttribute('position') as THREE.BufferAttribute;
    const r = lcg(7);
    const moved = new Map<string, [number, number, number]>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      let k = moved.get(key);
      if (!k) {
        k = [0.75 + r() * 0.5, 1.05 + r() * 0.45, 0.75 + r() * 0.5];
        moved.set(key, k);
      }
      pos.setXYZ(i, pos.getX(i) * k[0], pos.getY(i) * k[1], pos.getZ(i) * k[2]);
    }
    base = ico.toNonIndexed();
    ico.dispose();
  }
  base.computeVertexNormals();
  return base;
}

function makeOrbiters(center: THREE.Vector3, c: WeaponVfxOrbiters): WeaponVfxRaidPart {
  const shard = shardGeometry(c.shape);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', shard.getAttribute('position'));
  geo.setAttribute('normal', shard.getAttribute('normal'));
  const n = c.count;
  const aOrbit = new Float32Array(n * 4);
  const aTilt = new Float32Array(n * 4);
  const aSpin = new Float32Array(n * 4);
  const r = lcg(n * 97 + Math.round(c.radius[1] * 1000));
  for (let i = 0; i < n; i++) {
    aOrbit[i * 4] = between(r, c.radius);
    // evenly spaced round the orbit with a little scatter, so no two shards clump
    aOrbit[i * 4 + 1] = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const sp = between(r, [Math.abs(c.speed[0]), Math.abs(c.speed[1])]);
    aOrbit[i * 4 + 2] = c.speed[0] < 0 ? -sp : sp;
    aOrbit[i * 4 + 3] = between(r, c.size);
    aTilt[i * 4] = (r() * 2 - 1) * c.tilt;
    aTilt[i * 4 + 1] = (r() * 2 - 1) * c.tilt;
    aTilt[i * 4 + 2] = (c.bob ?? 0.03) * (0.5 + r());
    aTilt[i * 4 + 3] = r();
    const ax = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    aSpin.set([ax.x, ax.y, ax.z, between(r, c.spin) * (r() < 0.5 ? -1 : 1)], i * 4);
  }
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(aOrbit, 4));
  geo.setAttribute('aTilt', new THREE.InstancedBufferAttribute(aTilt, 4));
  geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(aSpin, 4));
  geo.instanceCount = n;
  shard.dispose();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: center.clone() },
      uBasis: { value: basisFor(c.axis) },
      uColor: { value: new THREE.Color(c.color) },
      uDark: { value: new THREE.Color(c.dark) },
      uGlow: { value: new THREE.Color(c.glow) },
      uSeams: { value: c.seams ?? 0.5 },
      uIce: { value: c.shape === 'ice' ? 1 : 0 },
      uDepth: { value: c.depth ?? 1 },
      uOpacity: { value: c.opacity ?? 1 },
      uCalm: { value: 0 },
    },
    vertexShader: `
      attribute vec4 aOrbit; attribute vec4 aTilt; attribute vec4 aSpin;
      uniform float uTime; uniform vec3 uCenter; uniform mat3 uBasis; uniform float uDepth;
      varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSeed;
      mat3 rotAxis(vec3 a, float t) {
        float c = cos(t); float s = sin(t); float k = 1.0 - c;
        return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
                    a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
                    a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
      }
      void main() {
        float ang = aOrbit.y + uTime * aOrbit.z;
        vec3 p = vec3(cos(ang) * aOrbit.x * uDepth, 0.0, sin(ang) * aOrbit.x);
        float cx = cos(aTilt.x); float sx = sin(aTilt.x);
        p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
        float cz = cos(aTilt.y); float sz = sin(aTilt.y);
        p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
        p.y += sin(uTime * 0.9 + aTilt.w * 6.2831) * aTilt.z;
        mat3 R = rotAxis(normalize(aSpin.xyz + vec3(1e-4, 0.0, 0.0)), uTime * aSpin.w + aTilt.w * 6.2831);
        vec3 local = uCenter + uBasis * (p + R * (position * aOrbit.w));
        vLocal = position;
        vSeed = aTilt.w;
        vec4 mv = modelViewMatrix * vec4(local, 1.0);
        vN = normalize(normalMatrix * (uBasis * (R * normal)));
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uDark; uniform vec3 uGlow; uniform float uSeams;
      uniform float uIce; uniform float uOpacity; uniform float uTime; uniform float uCalm;
      varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSeed;
      void main() {
        vec3 n = normalize(vN);
        float key = clamp(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0, 1.0);
        float fill = clamp(dot(n, normalize(vec3(-0.6, -0.2, 0.4))), 0.0, 1.0);
        vec3 c = mix(uDark, uColor, 0.25 + 0.6 * key + 0.15 * fill);
        float rim = pow(clamp(1.0 - abs(dot(n, normalize(vV))), 0.0, 1.0), 2.4);
        // glowing seams: thin bands through the shard, each shard its own phase
        float band = abs(sin(vLocal.y * 17.0 + vLocal.x * 9.0 + vSeed * 31.0));
        float seam = smoothstep(1.0 - 0.12 * uSeams, 1.0, band) * uSeams;
        float pulse = mix(0.75 + 0.25 * sin(uTime * 2.2 + vSeed * 6.2831), 0.85, uCalm);
        float glow = (seam * (1.0 - uIce) + rim * (0.35 + 0.65 * uIce)) * pulse * uOpacity;
        gl_FragColor = vec4(c + uGlow * glow, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

// ---------------------------------------------------------------------------------------------
// runeRing
// ---------------------------------------------------------------------------------------------

const RING_SEGMENTS = 72;

function makeRuneRing(center: THREE.Vector3, c: WeaponVfxRuneRing): WeaponVfxRaidPart {
  const basis = new THREE.Matrix4().setFromMatrix3(basisFor(c.axis));
  const verts: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const r0 = c.radius - c.width / 2;
  const r1 = c.radius + c.width / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const t = i / RING_SEGMENTS;
    const a = t * Math.PI * 2;
    for (const [rr, side] of [
      [r0, 0],
      [r1, 1],
    ] as const) {
      v.set(Math.cos(a) * rr, 0, Math.sin(a) * rr)
        .applyMatrix4(basis)
        .add(center);
      verts.push(v.x, v.y, v.z);
      uvs.push(t, side);
    }
    if (i < RING_SEGMENTS) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  // glyph cells about as wide as the band is tall
  const glyphs = Math.max(6, Math.round((Math.PI * 2 * c.radius) / (c.width * 0.62)));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: c.speed },
      uGlyphs: { value: glyphs },
      uColor: { value: new THREE.Color(c.color) },
      uCore: { value: new THREE.Color(c.core) },
      uOpacity: { value: c.opacity ?? 0.8 },
      uCalm: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uSpeed; uniform float uGlyphs;
      uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uCalm;
      varying vec2 vUv;
      ${HASH_GLSL}
      float seg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a; vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
        return length(pa - ba * h);
      }
      vec2 node(float k) { return vec2(mod(k, 3.0), floor(k / 3.0)) * 0.5 - 0.5; }
      void main() {
        float a = fract(vUv.x - uTime * uSpeed);
        float cell = floor(a * uGlyphs);
        vec2 p = vec2(fract(a * uGlyphs) - 0.5, (vUv.y - 0.5) * 1.5);
        // a stem plus up to four strokes between lattice nodes, picked by the cell's hash
        float d = seg(p, vec2(0.0, -0.32), vec2(0.0, 0.32));
        for (int k = 0; k < 4; k++) {
          float fk = float(k);
          float on = step(0.35, h11(cell * 7.0 + fk * 1.3));
          vec2 na = node(floor(h11(cell * 3.1 + fk * 5.7) * 8.99)) * 0.64;
          vec2 nb = node(floor(h11(cell * 9.3 + fk * 2.9) * 8.99)) * 0.64;
          d = min(d, mix(9.0, seg(p, na, nb), on));
        }
        float ink = 1.0 - smoothstep(0.045, 0.085, d);
        float halo = 1.0 - smoothstep(0.05, 0.2, d);
        // the band's two rails
        float rails = 1.0 - smoothstep(0.0, 0.07, min(abs(vUv.y - 0.06), abs(vUv.y - 0.94)));
        // a light running round the ring, glyph by glyph (steady under reduced motion)
        float run = fract(uTime * 0.35 - cell / uGlyphs);
        float lit = mix(0.45 + 0.55 * smoothstep(0.75, 1.0, run), 0.7, uCalm);
        float fade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
        vec3 col = mix(uColor, uCore, ink * lit);
        float al = (ink * lit + halo * 0.35 * lit + rails * 0.45) * mix(0.6, 1.0, fade) * uOpacity;
        gl_FragColor = vec4(col * al, al);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

// ---------------------------------------------------------------------------------------------
// flames
// ---------------------------------------------------------------------------------------------

function makeFlames(a0: THREE.Vector3, a1: THREE.Vector3, c: WeaponVfxFlames): WeaponVfxRaidPart {
  const n = c.count;
  const corners: [number, number][] = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 1],
  ];
  const aCorner = new Float32Array(n * 4 * 2);
  const aBase = new Float32Array(n * 4 * 3);
  const aDir = new Float32Array(n * 4 * 3);
  const aP = new Float32Array(n * 4 * 4);
  const index: number[] = [];
  const r = lcg(n * 31 + 5);
  const along = new THREE.Vector3().subVectors(a1, a0).normalize();
  const base = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const side = c.spread > 0 ? (i % 2 === 0 ? 1 : -1) : 0;
    // evenly spaced up the line, a little scatter, sides interleaved
    const t = (i + 0.5 + (r() - 0.5) * 0.8) / n;
    base.lerpVectors(a0, a1, Math.min(1, Math.max(0, t)));
    base.x += side * c.spread;
    dir
      .copy(along)
      .addScaledVector(new THREE.Vector3(side || 1, 0, 0), c.lean)
      .normalize();
    const h = between(r, c.height);
    const w = between(r, c.width);
    const rate = between(r, c.rate);
    const seed = r();
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      aCorner.set(corners[k], vi * 2);
      aBase.set([base.x, base.y, base.z], vi * 3);
      aDir.set([dir.x, dir.y, dir.z], vi * 3);
      aP.set([h, w, rate, seed], vi * 4);
    }
    const q = i * 4;
    index.push(q, q + 1, q + 2, q, q + 2, q + 3);
  }
  const geo = new THREE.BufferGeometry();
  // the position attribute only carries the vertex count; the shader places every corner
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 2));
  geo.setAttribute('aBase', new THREE.BufferAttribute(aBase, 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(aDir, 3));
  geo.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(c.hot) },
      uMid: { value: new THREE.Color(c.mid) },
      uTip: { value: new THREE.Color(c.tip) },
      uOpacity: { value: c.opacity ?? 0.9 },
      uCalm: { value: 0 },
    },
    vertexShader: `
      attribute vec2 aCorner; attribute vec3 aBase; attribute vec3 aDir; attribute vec4 aP;
      uniform float uTime;
      varying vec2 vUv; varying float vLife; varying float vSeed;
      void main() {
        float life = fract(uTime * aP.z + aP.w);
        float h = aP.x * (0.35 + 0.65 * sin(3.14159 * life));
        vec4 b = modelViewMatrix * vec4(aBase, 1.0);
        vec3 up = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz + vec3(0.0, 1e-4, 0.0));
        vec3 right = normalize(cross(up, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
        float scale = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 p = b.xyz + (up * (aCorner.y * h) + right * (aCorner.x * aP.y * 0.5)) * scale;
        vUv = vec2(aCorner.x * 0.5 + 0.5, aCorner.y);
        vLife = life;
        vSeed = aP.w;
        gl_Position = projectionMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uTip;
      uniform float uOpacity; uniform float uCalm;
      varying vec2 vUv; varying float vLife; varying float vSeed;
      ${HASH_GLSL}
      void main() {
        float y = vUv.y;
        // wrapped clock (see the header), slowed to a lazy lick under reduced motion
        float t = mod(uTime, ${NOISE_PERIOD.toFixed(1)}) * (1.0 - 0.7 * uCalm);
        float n = vnoise(vec2(vUv.x * 2.5 + vSeed * 13.0, y * 3.5 - t * 2.6 - vSeed * 7.0));
        float n2 = vnoise(vec2(vUv.x * 6.0 - vSeed * 5.0, y * 7.0 - t * 4.1));
        float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 0.9 * y;
        float halfW = clamp((1.0 - y) * 0.95 + 0.05, 0.05, 1.0) * (0.75 + 0.25 * n2);
        float body = 1.0 - smoothstep(0.35, 1.0, abs(x) / halfW);
        float top = 1.0 - smoothstep(0.55, 1.0, y + (n2 - 0.5) * 0.35);
        float bottom = smoothstep(0.0, 0.1, y);
        float life = smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
        float a = body * top * bottom * life * uOpacity;
        float heat = clamp(y * 1.3 + abs(x) * 0.5, 0.0, 1.0);
        vec3 col = heat < 0.5 ? mix(uHot, uMid, heat * 2.0) : mix(uMid, uTip, heat * 2.0 - 1.0);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

// ---------------------------------------------------------------------------------------------
// vortex
// ---------------------------------------------------------------------------------------------

function makeVortex(center: THREE.Vector3, c: WeaponVfxVortex): WeaponVfxRaidPart {
  const basis = new THREE.Matrix4().setFromMatrix3(basisFor(c.axis));
  const seg = 48;
  const verts: number[] = [center.x, center.y, center.z];
  const uvs: number[] = [0, 0];
  const index: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    v.set(Math.cos(a) * c.radius, 0, Math.sin(a) * c.radius)
      .applyMatrix4(basis)
      .add(center);
    verts.push(v.x, v.y, v.z);
    uvs.push(Math.cos(a), Math.sin(a));
    if (i < seg) index.push(0, i + 1, i + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uArms: { value: c.arms },
      uSpeed: { value: c.speed },
      uTwist: { value: c.twist },
      uOuter: { value: new THREE.Color(c.outer) },
      uInner: { value: new THREE.Color(c.inner) },
      uOpacity: { value: c.opacity ?? 0.7 },
      uCalm: { value: 0 },
    },
    vertexShader: `
      varying vec2 vP;
      void main() {
        vP = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uArms; uniform float uSpeed; uniform float uTwist;
      uniform vec3 uOuter; uniform vec3 uInner; uniform float uOpacity; uniform float uCalm;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        // atan(0, 0) is undefined: keep the eye's exact centre off the origin
        float ang = atan(vP.y, vP.x + 1e-4);
        // the spin slows to a drift under reduced motion; the phase wraps with the clock
        float turn = fract(mod(uTime, ${NOISE_PERIOD.toFixed(1)}) * uSpeed * (1.0 - 0.75 * uCalm));
        float sp = sin(uArms * ang + uTwist * log(r + 0.06) * 6.0 - turn * 6.2831);
        float arms = smoothstep(0.1, 0.95, sp * 0.5 + 0.5);
        float ring = 1.0 - smoothstep(0.62, 1.0, r);
        float eye = 1.0 - smoothstep(0.0, 0.3, r);
        float a = (arms * ring * smoothstep(0.08, 0.35, r) * 0.85 + eye * 0.8) * uOpacity;
        vec3 col = mix(uInner, uOuter, smoothstep(0.05, 0.7, r));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

/**
 * Build one raid component. `at` is the component's resolved anchor (for flames, the line's
 * start) and `to` the line's end (flames only), both weapon-local.
 */
export function makeRaidPart(
  c: WeaponVfxRaidComponent,
  at: THREE.Vector3,
  to: THREE.Vector3 | null,
): WeaponVfxRaidPart {
  switch (c.kind) {
    case 'orbiters':
      return makeOrbiters(at, c);
    case 'runeRing':
      return makeRuneRing(at, c);
    case 'flames':
      return makeFlames(at, to ?? at, c);
    case 'vortex':
      return makeVortex(at, c);
  }
}

/** The tuning channel each raid kind answers to (createWeaponVfx's TUNE_KEY_BY_KIND). */
export const RAID_TUNE_KEY_BY_KIND = {
  orbiters: 'motes',
  runeRing: 'aurora',
  flames: 'mist',
  vortex: 'core',
} as const;

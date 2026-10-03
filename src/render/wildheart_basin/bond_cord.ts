// The Pack Bond's jade spirit cord (plan: bond_cord_core.ts): three strands of
// jade light braided round a soft glowing core, tied from the master's chest to
// the Great Jaguar's collar ring (JAGUAR_MODEL.bondAnchor), sagging a little,
// spirit flowing both ways along it, wisps shed off it and a jade glow pooled
// on the ground under each body. It burns brighter, thicker and tauter as the
// two close (the sim's bondStrength): the read the fight asks for, pull them
// apart.
//
// One draw for the braid (every strand and the core in one geometry, laid out
// in the vertex shader on the cord's ends, so nothing is rebuilt per frame),
// one per ground pool. Built under the boss layer's root before its gated
// attach; no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import type { BasinFxHost } from './basin_fx_host';
import { BOND_CORD, braidRadius, cordPoint, cordSag } from './bond_cord_core';

const CORD_VERT = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uSag;
uniform float uBraid;
uniform float uTime;
uniform float uStrength;
uniform float uTwists;
uniform float uStrandR;
uniform float uCoreR;
varying float vU;
varying float vSid;
varying float vRim;
void main() {
  float u = position.x;
  float ang = position.y;
  float sid = position.z;
  vec3 p = mix(uFrom, uTo, u);
  p.y -= uSag * 4.0 * u * (1.0 - u);
  vec3 dir = normalize(uTo - uFrom + vec3(0.0, 1e-4, 0.0));
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 up = normalize(cross(side, dir));
  float pinch = pow(max(sin(3.14159265 * u), 0.0), 0.6);
  vec3 c = p;
  float r;
  if (sid < 2.5) {
    float ph = sid * 2.0944 + u * uTwists * 6.2832 - uTime * 1.3;
    c += (side * cos(ph) + up * sin(ph)) * uBraid * pinch;
    r = uStrandR * (0.55 + 0.45 * pinch) * (0.7 + 0.3 * uStrength);
  } else {
    r = uCoreR * (0.3 + 0.7 * pinch) * (0.6 + 0.4 * uStrength);
  }
  vec3 n = side * cos(ang) + up * sin(ang);
  vU = u;
  vSid = sid;
  // Facing the camera: the rim fades, the middle burns.
  vec3 w = c + n * r;
  vec4 view = modelViewMatrix * vec4(w, 1.0);
  vec3 nView = normalize(mat3(modelViewMatrix) * n);
  vRim = abs(nView.z);
  gl_Position = projectionMatrix * view;
}
`;

const CORD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying float vU;
varying float vSid;
varying float vRim;
void main() {
  float a1 = fract(vU * 6.0 - uTime * 1.4 + vSid * 0.33);
  float a2 = fract(vU * 4.0 + uTime * 0.9 + vSid * 0.21);
  float p1 = smoothstep(0.0, 0.18, a1) * (1.0 - smoothstep(0.26, 0.55, a1));
  float p2 = smoothstep(0.0, 0.15, a2) * (1.0 - smoothstep(0.22, 0.45, a2));
  float ends = smoothstep(0.0, 0.05, vU) * smoothstep(1.0, 0.95, vU);
  float strand = step(vSid, 2.5);
  vec3 jade = vec3(0.22, 0.95, 0.58);
  vec3 hot = vec3(0.86, 1.0, 0.92);
  vec3 col = mix(jade, hot, max(p1, p2) * (0.45 + 0.55 * strand));
  float body = mix(0.16 + 0.22 * p1, 0.5 + 0.7 * p1 + 0.45 * p2, strand);
  float rim = mix(pow(max(vRim, 0.0), 1.6), 0.55 + 0.45 * vRim, strand);
  float a = body * rim * ends * (0.3 + 0.7 * uStrength);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

const POOL_SLOTS = 2;

export class BondCord {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pools: THREE.Mesh[] = [];
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly pt = { x: 0, y: 0, z: 0 };
  private wisps = 0;

  constructor(private readonly host: BasinFxHost) {
    const geo = braidGeometry();
    this.geometries.push(geo);
    this.mat = new THREE.ShaderMaterial({
      name: 'wildheartPackBondCord',
      uniforms: {
        uTime: host.uTime,
        uStrength: { value: 0 },
        uFrom: { value: this.from },
        uTo: { value: this.to },
        uSag: { value: 0 },
        uBraid: { value: BOND_CORD.braid },
        uTwists: { value: BOND_CORD.twists },
        uStrandR: { value: BOND_CORD.strand },
        uCoreR: { value: BOND_CORD.core },
      },
      vertexShader: CORD_VERT,
      fragmentShader: CORD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    host.root.add(this.mesh);
    const poolGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.geometries.push(poolGeo);
    this.poolMat = new THREE.MeshBasicMaterial({
      name: 'wildheartPackBondPool',
      map: radialGlowTexture(),
      color: 0x3cff9a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < POOL_SLOTS; i++) {
      const pool = new THREE.Mesh(poolGeo, this.poolMat);
      pool.frustumCulled = false;
      pool.visible = false;
      // A cosmetic floor glow under the bodies: the lowest encounter rung, so
      // every telegraph of the pit paints over it.
      pool.renderOrder = floorVfxRenderOrder('encounter', 0);
      host.root.add(pool);
      this.pools.push(pool);
    }
  }

  /** Lay the cord from the master's chest to the jaguar's collar ring, burning
   *  at `strength` (0..1). */
  show(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    feet: readonly [number, number, number, number],
    strength: number,
    dt: number,
  ): void {
    this.from.set(from.x, from.y, from.z);
    this.to.set(to.x, to.y, to.z);
    const span = this.from.distanceTo(this.to);
    const sag = cordSag(span, strength);
    this.mat.uniforms.uSag.value = sag;
    this.mat.uniforms.uStrength.value = strength;
    this.mat.uniforms.uBraid.value = braidRadius(0.5, strength);
    this.mesh.visible = true;
    const pulse = 0.85 + 0.15 * Math.sin(this.host.uTime.value * 2.4);
    this.poolMat.opacity = (0.12 + 0.28 * strength) * pulse;
    for (let i = 0; i < POOL_SLOTS; i++) {
      const pool = this.pools[i];
      const x = feet[i * 2];
      const z = feet[i * 2 + 1];
      pool.position.set(x, this.host.groundY(x, z) + 0.08, z);
      pool.scale.setScalar(BOND_CORD.pool * (0.75 + 0.35 * strength));
      pool.visible = true;
    }
    // Spirit wisps shed along it, drifting up; more as they close.
    this.wisps += dt * (6 + 22 * strength) * this.host.density;
    while (this.wisps >= 1) {
      this.wisps -= 1;
      const u = 0.08 + 0.84 * this.host.rand();
      const p = cordPoint(from, to, u, sag, this.pt);
      this.host.puff(p.x, p.y, p.z, 1, {
        speed: 0.35,
        up: 0.7,
        life: 1.1,
        size: [0.42, 0.08],
        color: [0.45, 1, 0.7],
        alpha: 0.75 + 0.25 * strength,
        glow: true,
      });
    }
  }

  hide(): void {
    this.mesh.visible = false;
    for (const p of this.pools) p.visible = false;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.mat.dispose();
    this.poolMat.dispose();
  }
}

/** Every strand and the core as one tube set: position = (u, angle, strand). */
function braidGeometry(): THREE.BufferGeometry {
  const segs = BOND_CORD.segments;
  const radial = 6;
  const pos: number[] = [];
  const index: number[] = [];
  for (let s = 0; s <= BOND_CORD.strands; s++) {
    const sid = s < BOND_CORD.strands ? s : 3;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      for (let j = 0; j <= radial; j++) pos.push(i / segs, (j / radial) * Math.PI * 2, sid);
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

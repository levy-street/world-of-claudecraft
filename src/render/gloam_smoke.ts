// Gloamveil's shadow smoke: the DARK half of the Shadow priest's form look.
//
// The shared particle cloud (vfx.ts) blends additively, so it can only ever add
// light: a "dark" particle there is simply an invisible one. Smoke that reads as
// shadow has to darken what is behind it, which takes its own alpha-blended
// cloud. This is that cloud: one draw of soft dark puffs that swell as they
// rise and thin out. The violet glints that ride over it stay on the additive
// side (gloam_field.ts hands them to vfx.ts).
//
// The puff shape is procedural (no texture): a soft disc broken by three lobes
// turned by a per-particle angle, so no two puffs match. The pool of puffs and
// its eviction are the pure gloam_smoke_core.ts; this file wraps its arrays in
// one Points and uploads what is alive.

import * as THREE from 'three';
import { type GloamPuff, GloamSmokePool } from './gloam_smoke_core';
import { setRenderCategory } from './renderer_diagnostics';

/** Puffs alive at once, across every wearer in view. */
export const GLOAM_SMOKE_CAPACITY = 320;

const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRot;
  attribute float aTint;
  varying float vAlpha;
  varying float vRot;
  varying float vTint;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vRot = aRot;
    vTint = aTint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 220.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying float vRot;
  varying float vTint;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float r = length(pc) * 2.0;
    float ang = atan(pc.y, pc.x + 1e-6) + vRot; // guarded: atan(0,0) is undefined
    // three soft lobes pull the edge in and out so the puff is not a disc
    float edge = 0.78 + 0.16 * sin(ang * 3.0) + 0.06 * sin(ang * 7.0 + vRot * 2.0);
    float body = 1.0 - smoothstep(0.0, edge, r);
    float alpha = body * body * vAlpha;
    if (alpha < 0.01) discard;
    // near-black violet at the core, a touch of violet where it thins
    vec3 deep = vec3(0.008, 0.005, 0.016);
    vec3 thin = vec3(0.04, 0.025, 0.085);
    vec3 col = mix(thin, deep, body) + vec3(0.03, 0.012, 0.07) * vTint;
    gl_FragColor = vec4(col, alpha);
  }
`;

const ATTRIBUTES = ['position', 'aSize', 'aAlpha', 'aRot', 'aTint'] as const;

/** One alpha-blended cloud of dark smoke puffs. */
export class GloamSmoke {
  readonly points: THREE.Points;
  private readonly pool = new GloamSmokePool(GLOAM_SMOKE_CAPACITY);
  private readonly material: THREE.ShaderMaterial;
  private readonly attributes: THREE.BufferAttribute[] = [];

  constructor() {
    const geometry = new THREE.BufferGeometry();
    const arrays = [
      this.pool.position,
      this.pool.size,
      this.pool.alpha,
      this.pool.rot,
      this.pool.tint,
    ];
    ATTRIBUTES.forEach((name, index) => {
      const attribute = new THREE.BufferAttribute(arrays[index], name === 'position' ? 3 : 1);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
      this.attributes.push(attribute);
    });
    geometry.setDrawRange(0, 0);
    // A fixed bound, like the additive cloud's: the puffs move every frame,
    // and the bound only feeds the transparent sort among renderOrder peers.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(450, 0, 0), 2400);
    this.material = new THREE.ShaderMaterial({
      name: 'gloam_smoke',
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'gloam_smoke';
    this.points.frustumCulled = false;
    // A bare order, off the floor ladder: the puffs rise through the air and
    // are depth-tested, they are not a floor mark. 4 puts them under the
    // additive cloud (5), so its glints ride over the smoke, and under every
    // floor piece a player has to read: the whole player and encounter bands
    // and the Shadow priest's own pool draw after the smoke, so a puff can
    // never darken a Consecration or a telegraph it drifts in front of. Only
    // the world's lowest ground marks (blob shadows, torch pools) draw first.
    this.points.renderOrder = 4;
    setRenderCategory(this.points, 'vfx');
  }

  /** Same projection scale the additive cloud uses, so sizes agree. */
  setViewportScale(scale: number): void {
    this.material.uniforms.uScale.value = scale;
  }

  /** One puff, read out of the caller's own (reused) description. */
  puff(puff: GloamPuff): void {
    this.pool.add(puff);
  }

  get count(): number {
    return this.pool.count;
  }

  update(dt: number): void {
    const geometry = this.points.geometry;
    if (this.pool.count === 0) {
      geometry.setDrawRange(0, 0);
      return;
    }
    this.pool.step(dt);
    const count = this.pool.count;
    if (count === 0) {
      geometry.setDrawRange(0, 0);
      return;
    }
    for (const attribute of this.attributes) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, count);
  }

  clear(): void {
    this.pool.clear();
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

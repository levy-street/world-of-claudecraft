// QuenchStrikeWindup, a part of QuenchBody (quench_body.ts): Tempering
// Strike's wind-up tell, read from every angle (plan and timing:
// quench_strike_windup_core.ts). Over the ice round her a ring of frost closes
// in, deep blue at its edge and cyan in its crest, while the cleave's own arc
// in front of her frosts over with a bright rim; up both raised forearms two
// strands of cold light spiral into her fists, which flare over her crown.
// Telegraph-class: drawn whole on every tier (meshes and sprites only).
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the owner's gated root; fixed meshes; no per-frame allocation; no
// light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  newWindupLook,
  type QuenchWindupEnd,
  quenchWindupLook,
  QUENCH_WINDUP as W,
  QUENCH_WINDUP_COLORS as WC,
} from './quench_strike_windup_core';

const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

const RING_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The frost ring closing on her and the cleave's arc frosting over (vLocal
 *  in -1..1 of the ring's reach; +z her facing). */
const RING_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uRing;
uniform float uArc;
uniform float uHalf;
uniform float uArcR;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uHot;
varying vec2 vLocal;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float ang = atan(vLocal.x, vLocal.y);
  // The crest: a jagged frost front closing in, the frost it left behind it.
  float jag = (vnoise(vec2(ang * 7.0, uTime * 0.7)) - 0.5) * 0.06;
  float d = r - (uRing + jag);
  float crest = exp(-d * d / 0.0035);
  float rim = smoothstep(0.03, 0.05, d) * (1.0 - smoothstep(0.1, 0.17, d));
  float trail = d > 0.0 ? exp(-d / 0.2) * 0.6 : 0.0;
  float crystals = step(0.62, vnoise(vec2(ang * 22.0, r * 30.0)));
  // The cleave's arc, frosting over from her outward, its rim bright.
  float inArc = (1.0 - smoothstep(uHalf - 0.02, uHalf, abs(ang)))
    * (1.0 - smoothstep(uArcR - 0.01, uArcR, r));
  float arcFill = inArc * smoothstep(0.0, 0.2, uArc * uArcR - r + 0.2) * uArc;
  float edgeA = abs(abs(ang) - uHalf) * r;
  float edge = (1.0 - smoothstep(0.006, 0.016, edgeA)) * step(r, uArcR);
  edge = max(edge, (1.0 - smoothstep(0.006, 0.016, abs(r - uArcR))) * step(abs(ang), uHalf));
  edge *= uArc;
  float a = crest * 0.95 + rim * 0.75 + trail * (0.5 + 0.5 * crystals)
    + arcFill * (0.32 + 0.3 * crystals) + edge * 0.9;
  vec3 col = uDeep;
  col = mix(col, uCrest, clamp(crest + edge + arcFill * crystals * 0.8 + trail * crystals, 0.0, 1.0));
  col = mix(col, uHot, crest * 0.5);
  gl_FragColor = vec4(col, clamp(a * uAlpha, 0.0, 0.92));
}
`;

const SPIRAL_VERT = /* glsl */ `
varying float vS;
void main() {
  vS = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** Cold light flowing up the strand into the fist: travelling streaks over a
 *  faint trace (round 4: an even glow along the whole helix read as a coiled
 *  spring round her arm). */
const SPIRAL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uCrest;
uniform vec3 uHot;
varying float vS;
void main() {
  float f = fract(vS * 4.0 - uTime * 2.4);
  float pulse = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.1, 0.45, f));
  float a = uAlpha * (0.1 + 0.9 * pulse) * smoothstep(0.0, 0.2, vS);
  vec3 col = mix(uCrest, uHot, vS * vS * 0.8 + pulse * 0.3);
  gl_FragColor = vec4(col * a, a);
}
`;

/** The strand's path: a helix climbing 0..1 up y, narrowing into the fist. */
function helixCurve(phase: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const r = (1 - s) ** 0.7 * 0.92 + 0.08;
    const a = s * W.spiralTurns * Math.PI * 2 + phase;
    pts.push(new THREE.Vector3(Math.cos(a) * r, s, Math.sin(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts);
}

const _look = newWindupLook();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class QuenchStrikeWindup {
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly spirals: THREE.Mesh[] = [];
  private readonly spiralMat: THREE.ShaderMaterial;
  private readonly flares: THREE.Sprite[] = [];
  private readonly halos: THREE.Sprite[] = [];
  private readonly flareMat: THREE.SpriteMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private startAt = -99;
  private endKind: QuenchWindupEnd = 'pending';
  private endAt = -99;
  private fallAt = -1;
  private live = false;

  constructor(
    parent: THREE.Object3D,
    glowTex: THREE.Texture | null,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const disc = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    geometries.push(disc);
    this.ringMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWindupRing',
      uniforms: {
        uAlpha: { value: 0 },
        uRing: { value: 1 },
        uArc: { value: 0 },
        uHalf: { value: 0.8 },
        uArcR: { value: 0.8 },
        uTime: { value: 0 },
        uDeep: { value: color(WC.deep) },
        uCrest: { value: color(WC.crest) },
        uHot: { value: color(WC.hot) },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    this.ring = new THREE.Mesh(disc, this.ringMat);
    this.ring.name = 'smithHeartQuenchWindupRing';
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    this.ring.renderOrder = floorVfxRenderOrder('encounter', 5);
    parent.add(this.ring);
    this.spiralMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWindupSpiral',
      uniforms: {
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uCrest: { value: color(WC.crest) },
        uHot: { value: color(WC.hot) },
      },
      vertexShader: SPIRAL_VERT,
      fragmentShader: SPIRAL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    materials.push(this.ringMat, this.spiralMat);
    for (const phase of [0, Math.PI]) {
      const tube = new THREE.TubeGeometry(helixCurve(phase), 120, 0.022, 5, false);
      geometries.push(tube);
      for (let side = 0; side < 2; side++) {
        const m = new THREE.Mesh(tube, this.spiralMat);
        m.name = 'smithHeartQuenchWindupSpiral';
        m.frustumCulled = false;
        m.visible = false;
        parent.add(m);
        this.spirals.push(m);
      }
    }
    const sprite = (c: readonly [number, number, number], name: string) =>
      new THREE.SpriteMaterial({
        map: glowTex,
        color: color(c),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
    this.flareMat = sprite(WC.hot, 'smithHeartQuenchWindupFist');
    this.haloMat = sprite(WC.crest, 'smithHeartQuenchWindupHalo');
    materials.push(this.flareMat, this.haloMat);
    for (let i = 0; i < 2; i++) {
      const h = new THREE.Sprite(this.haloMat);
      h.name = 'smithHeartQuenchWindupHalo';
      h.visible = false;
      parent.add(h);
      this.halos.push(h);
      const f = new THREE.Sprite(this.flareMat);
      f.name = 'smithHeartQuenchWindupFist';
      f.visible = false;
      parent.add(f);
      this.flares.push(f);
    }
  }

  /** The wind-up cue, at render time `clock`. */
  begin(clock: number): void {
    this.startAt = clock;
    this.endKind = 'pending';
    this.endAt = -99;
    this.fallAt = -1;
    this.live = true;
  }

  /** The downswing began (round 4): the spirals let go, the flare shrinks. */
  fall(clock: number): void {
    if (this.live && this.endKind === 'pending' && this.fallAt < 0) this.fallAt = clock;
  }

  /** The swing's outcome: the slam, or a spent (avoided) swing. */
  end(kind: 'slam' | 'spent', clock: number): void {
    if (!this.live || this.endKind !== 'pending') return;
    this.endKind = kind;
    this.endAt = clock;
  }

  /** Lay the tell this frame: her feet (x, y, z) and facing, the fists and
   *  bracers (world), the cleave's half arc (radians) and reach (yards),
   *  `scale` yards a model unit. */
  update(
    clock: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    hands: readonly THREE.Vector3[],
    bracers: readonly THREE.Vector3[],
    halfArc: number,
    arcRange: number,
    scale: number,
  ): void {
    if (!this.live) return;
    const t = clock - this.startAt;
    const look = quenchWindupLook(
      t,
      this.endKind,
      clock - this.endAt,
      _look,
      this.fallAt < 0 ? -1 : clock - this.fallAt,
    );
    if (look.alpha <= 0 && t > W.rise) {
      this.hide();
      return;
    }
    const u = this.ringMat.uniforms;
    u.uAlpha.value = look.alpha;
    u.uRing.value = look.ring;
    u.uArc.value = look.arc;
    u.uHalf.value = halfArc;
    u.uArcR.value = Math.min(1, arcRange / W.ringRadius);
    u.uTime.value = clock;
    this.ring.position.set(x, y + 0.08, z);
    this.ring.rotation.set(0, yaw, 0);
    this.ring.scale.setScalar(W.ringRadius);
    this.ring.visible = true;
    this.spiralMat.uniforms.uAlpha.value = look.alpha * look.spiral;
    this.spiralMat.uniforms.uTime.value = clock;
    const len = W.spiralLength * scale;
    for (let i = 0; i < this.spirals.length; i++) {
      const side = i % 2;
      const m = this.spirals[i];
      const hand = hands[side];
      _dir.subVectors(hand, bracers[side]);
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
      _dir.normalize();
      m.position.copy(hand).addScaledVector(_dir, -len);
      m.quaternion.setFromUnitVectors(_up, _dir);
      m.scale.set(W.spiralRadius * scale, len, W.spiralRadius * scale);
      m.visible = look.spiral > 0.01;
    }
    const flare = W.fistFlare * scale * look.fist;
    for (let i = 0; i < 2; i++) {
      this.flares[i].position.copy(hands[i]);
      this.flares[i].scale.setScalar(flare * 0.5);
      this.flares[i].visible = true;
      this.halos[i].position.copy(hands[i]);
      this.halos[i].scale.setScalar(flare);
      this.halos[i].visible = true;
    }
    this.flareMat.opacity = Math.min(1, look.alpha * (0.6 + 0.4 * look.fist));
    this.haloMat.opacity = Math.min(0.75, look.alpha * 0.6 * look.fist);
  }

  hide(): void {
    this.live = false;
    this.ring.visible = false;
    for (const m of this.spirals) m.visible = false;
    for (const s of this.flares) s.visible = false;
    for (const s of this.halos) s.visible = false;
  }
}

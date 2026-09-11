// The rush: what a body at speed does to the water around it.
//
// Two effects, both driven purely by how fast you are actually going, so like
// the wake they ARE the speedometer rather than a decoration bolted next to it:
//
//  1. AURA, a teardrop shell of compressed water sheathing the body, stretched
//     along the line of travel. It is the pressure wave you are pushing.
//  2. SPEED LINES, the Dragon Ball Z streaks: short bright dashes that spawn
//     in a ring around you, aligned with your flight, streaming past and
//     dying. Nothing sells "fast" in animation the way these do, and unlike a
//     motion blur they cost one draw call and read at any frame rate.
//
// Local player only. These are a first-person read on your own speed, drawn on
// every fighter in the bell they would be a light show rather than information,
// and the aura would sit between the camera and everyone else's body.

import * as THREE from 'three';

/** Below this the rush is off entirely; a cruising body is not "fast". */
const RUSH_MIN_SPEED = 13;
/** Speed at which the rush is at full strength. */
const RUSH_FULL_SPEED = 26;

/** Streaks in the ring buffer. */
const LINE_POOL = 96;
const LINE_LIFE = 0.42;
/** How far out from the body they spawn, and how far that band spreads. */
const LINE_RADIUS = 1.5;
const LINE_RADIUS_SPREAD = 2.2;

const AURA_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURA_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uStrength;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vLocal;
  void main() {
    // The shell is built as a unit sphere and squashed by the mesh scale, so
    // local z runs nose (-1) to tail (+1) after the group is aimed.
    float tail = clamp(vLocal.z * 0.5 + 0.5, 0.0, 1.0);
    // Brightest at the shoulders, gone at the nose, streaming off the tail.
    // The band is deliberately NARROW: this sheath sits between the chase
    // camera and the player's own body, and the first pass at half alpha
    // across a wide band simply whited the screen out at speed.
    float band = smoothstep(0.18, 0.5, tail) * (1.0 - smoothstep(0.62, 0.92, tail));
    // Fine ripples running backwards so the sheath is never a static blob.
    float ripple = 0.72 + 0.28 * sin(vLocal.y * 9.0 + vLocal.x * 7.0 - uTime * 14.0);
    float a = uStrength * band * ripple * 0.1;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const LINE_VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aDir;   // unit direction the streak points along
  attribute vec2 aBirth; // x = spawn time, y = length in yards
  attribute float aEnd;  // 0 = head, 1 = tail
  uniform float uTime;
  uniform float uLife;
  varying float vFade;
  void main() {
    float age = uTime - aBirth.x;
    if (age < 0.0 || age > uLife) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float t = age / uLife;
    vec3 p = position + aVel * age;
    // The tail vertex trails the head by the streak's length, and the streak
    // stretches as it flies: a dash that grows reads as acceleration past you.
    p -= aDir * (aBirth.y * (0.6 + t * 0.8)) * aEnd;
    vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.45, 1.0, t));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vFade;
  void main() {
    float a = vFade * uStrength * 0.55;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export interface RushSample {
  /** Chest-height world position of the body. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const DIR = new THREE.Vector3();

export class DeepglassRush {
  readonly group = new THREE.Group();
  private readonly aura: THREE.Mesh;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly lineMat: THREE.ShaderMaterial;
  private readonly pos: THREE.BufferAttribute;
  private readonly vel: THREE.BufferAttribute;
  private readonly dir: THREE.BufferAttribute;
  private readonly birth: THREE.BufferAttribute;
  private cursor = 0;
  private debt = 0;
  private time = 0;
  /** Smoothed 0..1 so the whole effect fades rather than snapping on. */
  private strength = 0;

  constructor() {
    this.group.name = 'deepglass-rush';
    this.group.frustumCulled = false;

    this.auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xbfeaff) },
      },
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide, // seen from outside it would hide the body
      blending: THREE.AdditiveBlending,
    });
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.auraMat);
    this.aura.frustumCulled = false;
    this.aura.renderOrder = 14;
    this.group.add(this.aura);

    const geo = new THREE.BufferGeometry();
    const verts = LINE_POOL * 2;
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.vel = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.dir = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    const birthData = new Float32Array(verts * 2);
    for (let i = 0; i < verts; i++) birthData[i * 2] = -1000;
    this.birth = new THREE.BufferAttribute(birthData, 2);
    const endData = new Float32Array(verts);
    for (let i = 0; i < LINE_POOL; i++) endData[i * 2 + 1] = 1; // second vertex is the tail
    for (const attr of [this.pos, this.vel, this.dir, this.birth]) {
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aVel', this.vel);
    geo.setAttribute('aDir', this.dir);
    geo.setAttribute('aBirth', this.birth);
    geo.setAttribute('aEnd', new THREE.BufferAttribute(endData, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.lineMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: LINE_LIFE },
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(0xeaf9ff) },
      },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(geo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 15;
    this.group.add(this.lines);
  }

  /** Deterministic-enough scatter; ambience, never gameplay. */
  private static jitter(seed: number): number {
    const h = Math.sin(seed * 12.9898) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  /** `sample` is the local player, or null when they are not in the bell. */
  update(dt: number, sample: RushSample | null): void {
    this.time += dt;
    this.auraMat.uniforms.uTime.value = this.time;
    this.lineMat.uniforms.uTime.value = this.time;

    const speed = sample ? Math.hypot(sample.vx, sample.vy, sample.vz) : 0;
    const target = Math.max(
      0,
      Math.min(1, (speed - RUSH_MIN_SPEED) / (RUSH_FULL_SPEED - RUSH_MIN_SPEED)),
    );
    // Fade in fast, out slow: hitting speed should feel like a snap, losing it
    // like a glide.
    this.strength +=
      (target - this.strength) * (1 - Math.exp(-dt * (target > this.strength ? 9 : 3.5)));
    this.auraMat.uniforms.uStrength.value = this.strength;
    this.lineMat.uniforms.uStrength.value = this.strength;
    this.group.visible = this.strength > 0.01;
    if (!sample || !this.group.visible) {
      this.debt = 0;
      return;
    }

    // Aim: the shell and the streaks both live along the line of travel.
    DIR.set(sample.vx, sample.vy, sample.vz);
    if (DIR.lengthSq() < 1e-6) DIR.set(0, 0, 1);
    DIR.normalize();
    this.aura.position.set(sample.x, sample.y, sample.z);
    this.aura.quaternion.setFromUnitVectors(FORWARD, DIR);
    // Hugging the body, and pushed FORWARD along the line of travel rather than
    // trailing back along it. The chase camera sits directly behind you, so a
    // sheath stretched backwards is a sheath you are always looking down the
    // length of, which is how it kept turning into a white wall over the
    // player. The streaming half of the effect is the speed lines' job, and
    // the exhaust trail's; this is just the pressure wave on the nose.
    this.aura.scale.set(1.05, 1.05, 1.35 + this.strength * 0.4);
    this.aura.position.x += DIR.x * 0.5;
    this.aura.position.y += DIR.y * 0.5;
    this.aura.position.z += DIR.z * 0.5;

    this.stampLines(dt, sample, speed);
  }

  private stampLines(dt: number, s: RushSample, speed: number): void {
    this.debt += 70 * this.strength * dt;
    const n = Math.floor(this.debt);
    this.debt -= n;
    if (n <= 0) return;

    // A basis across the direction of travel, so streaks spawn in a RING around
    // the body rather than a box around the world axes.
    const up = Math.abs(DIR.y) > 0.9 ? UP_ALT : UP;
    RIGHT.crossVectors(DIR, up).normalize();
    UP_OUT.crossVectors(RIGHT, DIR).normalize();

    for (let k = 0; k < n && k < 8; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % LINE_POOL;
      const seed = this.time * 97 + i * 5.31 + k;
      const a = (DeepglassRush.jitter(seed) + 1) * Math.PI;
      const r = LINE_RADIUS + Math.abs(DeepglassRush.jitter(seed + 19)) * LINE_RADIUS_SPREAD;
      // Spawn AHEAD of the body so the streak sweeps past the camera.
      const lead = 2 + Math.abs(DeepglassRush.jitter(seed + 37)) * 5;
      const px = s.x + RIGHT.x * Math.cos(a) * r + UP_OUT.x * Math.sin(a) * r + DIR.x * lead;
      const py = s.y + RIGHT.y * Math.cos(a) * r + UP_OUT.y * Math.sin(a) * r + DIR.y * lead;
      const pz = s.z + RIGHT.z * Math.cos(a) * r + UP_OUT.z * Math.sin(a) * r + DIR.z * lead;
      // Streaming BACKWARDS past the body at a good fraction of the real pace.
      const back = speed * 0.85;
      const len = 1.4 + Math.abs(DeepglassRush.jitter(seed + 53)) * 2.6;
      for (const end of [0, 1]) {
        const v = i * 2 + end;
        this.pos.setXYZ(v, px, py, pz);
        this.vel.setXYZ(v, -DIR.x * back, -DIR.y * back, -DIR.z * back);
        // The dash points along travel; the tail vertex is pushed back along it.
        this.dir.setXYZ(v, DIR.x, DIR.y, DIR.z);
        this.birth.setXY(v, this.time, len);
      }
    }
    this.pos.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.birth.needsUpdate = true;
  }

  dispose(): void {
    this.aura.geometry.dispose();
    this.auraMat.dispose();
    this.lines.geometry.dispose();
    this.lineMat.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const UP_ALT = new THREE.Vector3(1, 0, 0);
const RIGHT = new THREE.Vector3();
const UP_OUT = new THREE.Vector3();

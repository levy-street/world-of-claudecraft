// Nythraxis soft fire: the emitter. One instanced draw of camera-facing flame
// sprites on the game's shared flipbook atlas (ignivar_fire_vfx.ts), each
// sprite looping on its own clock from a fixed spot: it rises, grows, tears
// away, and is reborn at its foot. Colour comes from a three-stop ramp per
// mechanic so the same program burns green, red, or violet. Everything moves
// on the GPU from one time uniform; the CPU touches the instance buffers only
// when a spot is placed (a new line yard lit), never per frame.
//
// A "window" (tail, head) is the lit stretch of a Gravefire line: sprites
// outside it collapse to nothing in the vertex shader, so a sliding window is
// two uniform writes. Patches leave the window open. Reduced motion holds the
// clock, so the cloud stands still but the footprint below it stays legible.

import * as THREE from 'three';
import { FLAME_ATLAS_FRAMES, FLAME_ATLAS_GLSL, getFlameTex } from './ignivar_fire_vfx';
import {
  NYTHRAXIS_SOFT_FIRE_RAMPS,
  NYTHRAXIS_SOFT_FIRE_SHAPES,
  type NythraxisSoftFireKind,
  nythraxisSoftFireSeed,
} from './nythraxis_soft_fire_core';

const LAST_FRAME = (FLAME_ATLAS_FRAMES - 1).toFixed(1);

const SOFT_FIRE_VERT = `
uniform float uTime;
uniform float uTail;
uniform float uHead;
uniform float uHeadCapTail;
uniform float uHeadBoost;
uniform float uSpriteScale;
uniform float uRise;
uniform float uDuration;
attribute float iSeed;
attribute vec3 iSpot;
attribute float iAlong;
varying float vLife;
varying float vSeed;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying float vFade;
${FLAME_ATLAS_GLSL}
void main() {
  vSeed = iSeed;
  // each sprite loops on its own clock; the stagger keeps the cloud solid
  float dur = uDuration * (0.75 + 0.5 * h11(iSeed + 2.3));
  float life = fract(uTime / dur + iSeed * 7.13);
  vLife = life;
  // outside the lit window a sprite collapses to nothing
  float lit = step(uTail, iAlong) * step(iAlong, uHead);
  // the advancing head of a line burns taller and brighter: it is the fire's face
  float boost = mix(1.0, uHeadBoost, step(uHeadCapTail, iAlong));
  vec3 pos = iSpot;
  pos.y += life * uRise * (0.7 + 0.6 * h11(iSeed + 8.1)) * boost;
  pos.x += sin(uTime * 1.6 + iSeed * 43.0 + life * 4.0) * 0.14 * life;
  pos.z += cos(uTime * 1.3 + iSeed * 29.0 + life * 3.0) * 0.14 * life;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  float size = uSpriteScale * boost * (0.55 + 0.75 * pow(life, 0.6))
             * (0.75 + 0.5 * h11(iSeed + 9.7)) * lit;
  float rot = h11(iSeed + 4.4) * 6.2831853 + uTime * (h11(iSeed + 6.1) - 0.5) * 1.6;
  vec2 rc = vec2(position.x * cos(rot) - position.y * sin(rot),
                 position.x * sin(rot) + position.y * cos(rot));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  world.xyz += (camRight * rc.x + camUp * rc.y) * size;
  gl_Position = projectionMatrix * viewMatrix * world;
  float ff = min(life * ${FLAME_ATLAS_FRAMES.toFixed(1)}, ${LAST_FRAME});
  float fA = floor(ff);
  vBlend = ff - fA;
  vec2 corner = position.xy + 0.5;
  vUvA = cellUv(corner, fA);
  vUvB = cellUv(corner, min(fA + 1.0, ${LAST_FRAME}));
  vFade = smoothstep(0.02, 0.16, life) * (1.0 - smoothstep(0.55, 1.0, life)) * lit;
}
`;

const SOFT_FIRE_FRAG = `
uniform sampler2D uTex;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uCore;
uniform vec3 uBody;
uniform vec3 uTip;
varying float vLife;
varying float vSeed;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying float vFade;
void main() {
  // frame-blended flipbook sample; the atlas stores intensity, not colour
  float I = mix(texture2D(uTex, vUvA).r, texture2D(uTex, vUvB).r, vBlend);
  // a soft edge that erodes as the sprite ages, so tongues tear away
  float er = 0.08 + 0.5 * smoothstep(0.45, 1.0, vLife);
  float m = smoothstep(er, er + 0.18, I);
  float flick = 0.94 + 0.06 * sin(uTime * 21.0 + vSeed * 61.0);
  float heat = mix(1.15, 0.55, smoothstep(0.05, 0.9, vLife)) * flick;
  float t = clamp(I * heat, 0.0, 1.0);
  vec3 col = mix(uTip, uBody, smoothstep(0.15, 0.5, t));
  col = mix(col, uCore, smoothstep(0.6, 0.95, t));
  gl_FragColor = vec4(col, m * vFade * uOpacity);
}
`;

const OPEN_WINDOW = 1e9;
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

export class NythraxisSoftFire {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly count: number;
  readonly kind: NythraxisSoftFireKind;
  private readonly spots: THREE.InstancedBufferAttribute;
  private readonly alongs: THREE.InstancedBufferAttribute;
  private time = 0;

  constructor(kind: NythraxisSoftFireKind, count: number, name: string, renderOrder: number) {
    this.kind = kind;
    this.count = count;
    const ramp = NYTHRAXIS_SOFT_FIRE_RAMPS[kind];
    const shape = NYTHRAXIS_SOFT_FIRE_SHAPES[kind];

    const geometry = new THREE.InstancedBufferGeometry();
    // Own copies of the tiny unit quad: disposing this geometry must never
    // pull a buffer out from under another emitter.
    geometry.index = UNIT_PLANE.index;
    geometry.setAttribute('position', UNIT_PLANE.getAttribute('position').clone());
    geometry.setAttribute('uv', UNIT_PLANE.getAttribute('uv').clone());
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index++) seeds[index] = nythraxisSoftFireSeed(index);
    geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.spots = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.spots.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iSpot', this.spots);
    this.alongs = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geometry.setAttribute('iAlong', this.alongs);
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, shape.rise * 0.5, 0), 1);
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTail: { value: -OPEN_WINDOW },
        uHead: { value: OPEN_WINDOW },
        uHeadCapTail: { value: OPEN_WINDOW },
        uHeadBoost: { value: 1 },
        uSpriteScale: { value: shape.spriteScale },
        uRise: { value: shape.rise },
        uDuration: { value: shape.duration },
        uOpacity: { value: 1 },
        uTex: { value: getFlameTex() },
        uCore: { value: new THREE.Color(ramp.core) },
        uBody: { value: new THREE.Color(ramp.body) },
        uTip: { value: new THREE.Color(ramp.tip) },
      },
      vertexShader: SOFT_FIRE_VERT,
      fragmentShader: SOFT_FIRE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = name;
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = true;
    this.mesh.userData.renderCategory = 'ui3d';
    this.mesh.userData.nythraxisSoftFire = kind;
  }

  /** Where sprite `index` rises from, in the mesh's own space, and its yard along a line. */
  setSpot(index: number, x: number, y: number, z: number, along = 0): void {
    this.spots.setXYZ(index, x, y, z);
    this.alongs.setX(index, along);
  }

  /** Upload spots written since the last commit. */
  commitSpots(): void {
    this.spots.needsUpdate = true;
    this.alongs.needsUpdate = true;
  }

  spotY(index: number): number {
    return this.spots.getY(index);
  }

  spotAlong(index: number): number {
    return this.alongs.getX(index);
  }

  /** The lit stretch of a line; sprites outside it draw nothing. Patches never call this. */
  setWindow(tail: number, head: number, headCapTail: number, headBoost: number): void {
    this.material.uniforms.uTail.value = tail;
    this.material.uniforms.uHead.value = head;
    this.material.uniforms.uHeadCapTail.value = headCapTail;
    this.material.uniforms.uHeadBoost.value = headBoost;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  setBoundingSphere(center: THREE.Vector3, radius: number): void {
    const sphere = this.geometry.boundingSphere;
    if (!sphere) return;
    sphere.center.copy(center);
    sphere.radius = radius;
  }

  /** Advance the fire's clock; reduced motion holds it. */
  update(dt: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    this.time = (this.time + Math.max(0, dt)) % 1000;
    this.material.uniforms.uTime.value = this.time;
  }

  get clock(): number {
    return this.time;
  }

  /** The geometry and material are this emitter's own; the atlas is module-shared and stays. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

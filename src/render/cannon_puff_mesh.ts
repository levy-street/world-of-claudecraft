// The cannon's billboard puffs, drawn: one instanced quad per live puff on ONE
// shader material, so the whole muzzle, wake and blast is a single draw. The
// blend is premultiplied: a puff writes (rgb * a, a * (1 - add)), so an
// additive share of 1 adds light (fire, sparks, the flash), 0 lays alpha over
// what is behind it (dust, smoke, dirt), and a fireball crosses from one to the
// other as it cools. Billboards face the camera in view space; smoke and dust
// carry a top-lit gradient so they read as volumes in the dusk light, and fog
// thins the additive share instead of adding fog colour to it. A puff takes the
// scene's light by its unlit share (setLight), so smoke darkens with the night
// while a hot fireball glows on its own.
//
// Built once (the cannon's prepare) and attached behind its compile gate with
// the rest of the weapon; per frame it only refills the instance attributes in
// place, queues one reused upload range per buffer, and sets how many are
// drawn. Each billboard is an octagon around its sprite, not a square: every
// sprite is clear past CANNON_PUFF_SPRITE_RADIUS, so the corners a square adds
// are a fifth more blended pixels that draw nothing. The pure half is
// cannon_puff_core.ts.
import * as THREE from 'three';
import { BufferUpdateRange } from './buffer_update_range';
import { CANNON_PUFF_SPRITE_RADIUS, type CannonPuffFrame } from './cannon_puff_core';

/** Texels per sprite cell of the atlas (cannonPuffAtlasTexels), and the atlas's bytes. */
export const CANNON_PUFF_ATLAS_CELL = 64;
const ATLAS_SIZE = CANNON_PUFF_ATLAS_CELL * 2;
export const CANNON_PUFF_ATLAS_BYTES = ATLAS_SIZE * ATLAS_SIZE * 4;
const OCTAGON = 8;

const VERTEX = /* glsl */ `
attribute vec4 aCenter;
attribute vec4 aTint;
attribute vec4 aLook;
varying vec2 vUv;
varying vec4 vTint;
varying float vAdd;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec2 corner = position.xy;
  float c = cos(aLook.x);
  float s = sin(aLook.x);
  vec2 turned = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * aCenter.w;
  vec4 mvPosition = modelViewMatrix * vec4(aCenter.xyz, 1.0);
  mvPosition.xy += turned;
  gl_Position = projectionMatrix * mvPosition;
  float cell = floor(aLook.z + 0.5);
  vUv = (uv + vec2(mod(cell, 2.0), floor(cell * 0.5))) * 0.5;
  vTint = aTint;
  vAdd = aLook.y;
  vShade = 1.0 + aLook.w * (corner.y * 0.9 - 0.12);
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vTint;
varying float vAdd;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float a = tex.a * vTint.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tex.rgb * vTint.rgb * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    vec3 fogged = mix(gl_FragColor.rgb, fogColor, fogFactor);
    gl_FragColor.rgb = mix(fogged, gl_FragColor.rgb * (1.0 - fogFactor), vAdd);
  #endif
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
}
`;

/** A unit billboard (the old square's -0.5 to 0.5 span) cut to the octagon around its sprite. */
function spriteOctagon(): THREE.BufferGeometry {
  const radius = (0.5 * CANNON_PUFF_SPRITE_RADIUS) / Math.cos(Math.PI / OCTAGON);
  const position = new Float32Array(OCTAGON * 3);
  const uv = new Float32Array(OCTAGON * 2);
  for (let k = 0; k < OCTAGON; k++) {
    const angle = ((k + 0.5) / OCTAGON) * Math.PI * 2;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    position[k * 3] = x;
    position[k * 3 + 1] = y;
    uv[k * 2] = x + 0.5;
    uv[k * 2 + 1] = y + 0.5;
  }
  const index: number[] = [];
  for (let k = 1; k < OCTAGON - 1; k++) index.push(0, k, k + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

export class CannonPuffMesh {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly atlas: THREE.DataTexture;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly uploads: BufferUpdateRange[];
  private count = 0;
  private lightR = 1;
  private lightG = 1;
  private lightB = 1;

  /** `atlas` is the atlas's bytes (cannonPuffAtlasTexels), or null for a clear one filled later (setAtlas). */
  constructor(
    readonly capacity: number,
    name: string,
    atlas: Uint8Array | null,
  ) {
    this.atlas = new THREE.DataTexture(
      atlas ?? new Uint8Array(CANNON_PUFF_ATLAS_BYTES),
      ATLAS_SIZE,
      ATLAS_SIZE,
    );
    this.atlas.name = `${name}Atlas`;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.needsUpdate = true;
    const octagon = spriteOctagon();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(octagon.getIndex());
    geometry.setAttribute('position', octagon.getAttribute('position'));
    geometry.setAttribute('uv', octagon.getAttribute('uv'));
    const attribute = (): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.center = attribute();
    this.tint = attribute();
    this.look = attribute();
    geometry.setAttribute('aCenter', this.center);
    geometry.setAttribute('aTint', this.tint);
    geometry.setAttribute('aLook', this.look);
    this.uploads = [this.center, this.tint, this.look].map((a) => new BufferUpdateRange(a));
    geometry.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uAtlas = { value: this.atlas };
    const material = new THREE.ShaderMaterial({
      name,
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** Fills the atlas a clear one was built with; its next draw uploads it. */
  setAtlas(bytes: Uint8Array): void {
    this.atlas.image.data = bytes;
    this.atlas.needsUpdate = true;
  }

  /** How many puffs the last frame drew. */
  get drawn(): number {
    return this.count;
  }

  /** The scene light a puff takes by its unlit share (linear RGB); self-lit fire ignores it. */
  setLight(r: number, g: number, b: number): void {
    this.lightR = r;
    this.lightG = g;
    this.lightB = b;
  }

  begin(): void {
    this.count = 0;
  }

  push(f: CannonPuffFrame): void {
    if (this.count >= this.capacity || !(f.a > 0.002) || !(f.size > 0)) return;
    const at = this.count++ * 4;
    const center = this.center.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const look = this.look.array as Float32Array;
    center[at] = f.x;
    center[at + 1] = f.y;
    center[at + 2] = f.z;
    center[at + 3] = f.size;
    const glow = f.glow;
    tint[at] = f.r * (this.lightR + (1 - this.lightR) * glow);
    tint[at + 1] = f.g * (this.lightG + (1 - this.lightG) * glow);
    tint[at + 2] = f.b * (this.lightB + (1 - this.lightB) * glow);
    tint[at + 3] = f.a;
    look[at] = f.rot;
    look[at + 1] = f.add;
    look[at + 2] = f.sprite;
    look[at + 3] = f.shade;
  }

  end(): void {
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const range of this.uploads) range.mark(0, n * 4);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.atlas.dispose();
  }
}

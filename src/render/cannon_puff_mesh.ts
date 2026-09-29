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
// place and sets how many are drawn. The pure half is cannon_puff_core.ts.
import * as THREE from 'three';
import { type CannonPuffFrame, cannonPuffAtlasTexels } from './cannon_puff_core';

const ATLAS_CELL = 64;

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

function upload(attribute: THREE.InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * 4);
  attribute.needsUpdate = true;
}

export class CannonPuffMesh {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly atlas: THREE.DataTexture;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private count = 0;
  private lightR = 1;
  private lightG = 1;
  private lightB = 1;

  constructor(
    readonly capacity: number,
    name: string,
  ) {
    const size = ATLAS_CELL * 2;
    this.atlas = new THREE.DataTexture(cannonPuffAtlasTexels(ATLAS_CELL), size, size);
    this.atlas.name = `${name}Atlas`;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.needsUpdate = true;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
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
    upload(this.center, n);
    upload(this.tint, n);
    upload(this.look, n);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.atlas.dispose();
  }
}

// Stealth Rework shimmer band: the rim glint drawn where an enemy stealther
// stands just past the detection cone, read from IWorld.stealthShimmers
// (already filtered to what this player may get: rounded positions, a fade, no
// id). One generic body shape for every class, turned to face the viewer, so
// the glint says "someone is there" and nothing about who or which way they
// face. It is one transparent material on that body (a cool shadow along the
// edge plus white sparkle bands moving up it, so it reads on bright and dark
// ground alike), with no scene copy and no post pass, so every graphics
// preset draws exactly the same thing: it is information a player acts on.
// The material is built at construction and the root attached through the
// compile gate, so nothing links in a live frame. Plan math lives in
// stealth_shimmer_core.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHIMMER_VIEW_CAP } from '../sim/stealth_shimmer';
import type { StealthShimmer } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  type DrawnShimmer,
  SHIMMER_STRENGTH,
  shimmerShaderTime,
  stepShimmers,
} from './stealth_shimmer_core';

/** The sparkles: a cool white that reads on dark ground (grass, stone, night). */
const GLINT_COLOR = 0xe2eeff;
/** The rim's edge: a cool shadow that reads on bright ground, where white alone
 *  vanishes (sunlit sand at 25% strength measured invisible). */
const EDGE_COLOR = 0x1a2a4a;
/** Lift so the feet never sink into a slope between whole-yard samples. */
const SHIMMER_LIFT = 0.02;
const NO_SHIMMERS: readonly StealthShimmer[] = Object.freeze([]);

const VERTEX = /* glsl */ `
attribute float aFade;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
varying float vFade;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 mv = viewMatrix * (m * vec4(position, 1.0));
  vNormalV = normalize(mat3(viewMatrix) * mat3(m) * normal);
  vViewV = normalize(-mv.xyz);
  vLocal = position;
  vFade = aFade;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uColor;
uniform vec3 uEdge;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
varying float vFade;
float shimmerHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 1.1);
  float around = atan(vLocal.x, vLocal.z);
  float band = pow(clamp(0.5 + 0.5 * sin(vLocal.y * 7.0 - uTime * 4.2 + around * 2.0), 0.0, 1.0), 6.0);
  float spark = step(0.93, shimmerHash(floor(vLocal * 14.0) + floor(uTime * 9.0)));
  // Two tones so the glint reads on any ground: a cool shadow along the edge
  // (bright ground) and white sparkle bands moving up it (dark ground).
  // Full design strength (uStrength 1): a few-pixel edge, bright bands, a
  // faint body fill; the shipped strength scales all of it.
  float edgeA = rim * 0.6;
  float glintA = rim * (band * 1.2 + spark * 1.0) + 0.12;
  float total = edgeA + glintA;
  vec3 tone = (uEdge * edgeA + uColor * glintA) / max(total, 1e-4);
  // The band fade dims toward the outer edge but never to nothing.
  gl_FragColor = vec4(tone, clamp(total * mix(0.4, 1.0, vFade) * uStrength, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A generic standing body about 1.85 yd tall, feet at the origin. */
function genericBody(): THREE.BufferGeometry {
  const at = (g: THREE.BufferGeometry, x: number, y: number, rz = 0) =>
    g.rotateZ(rz).translate(x, y, 0);
  const parts = [
    at(new THREE.SphereGeometry(0.15, 14, 10), 0, 1.69),
    at(new THREE.CapsuleGeometry(0.21, 0.5, 4, 12), 0, 1.13),
    at(new THREE.CapsuleGeometry(0.085, 0.6, 4, 8), -0.11, 0.39),
    at(new THREE.CapsuleGeometry(0.085, 0.6, 4, 8), 0.11, 0.39),
    at(new THREE.CapsuleGeometry(0.065, 0.52, 4, 8), -0.31, 1.12, -0.12),
    at(new THREE.CapsuleGeometry(0.065, 0.52, 4, 8), 0.31, 1.12, 0.12),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('stealth shimmer: body parts no longer share one attribute set');
  return merged;
}

export class StealthShimmerVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private readonly geometry = genericBody();
  private readonly fade = new THREE.InstancedBufferAttribute(new Float32Array(SHIMMER_VIEW_CAP), 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly drawn: DrawnShimmer[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private disposed = false;

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.group.name = 'stealth-shimmers';
    this.geometry.setAttribute('aFade', this.fade);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    this.material = new THREE.ShaderMaterial({
      name: 'stealth-shimmers:rim-glint',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: SHIMMER_STRENGTH },
        uColor: { value: new THREE.Color(GLINT_COLOR) },
        uEdge: { value: new THREE.Color(EDGE_COLOR) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, SHIMMER_VIEW_CAP);
    this.mesh.name = 'stealth-shimmers-body';
    this.mesh.count = 0;
    this.mesh.visible = false; // the gate still links it: compile walks hidden nodes
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.group,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  /** Per frame: ease the drawn shimmers toward the world's list and repaint.
   *  `viewer` is where this player's body is drawn (null: keep the last yaw). */
  update(
    shimmers: readonly StealthShimmer[] = NO_SHIMMERS,
    time: number,
    dt: number,
    reducedMotion: boolean,
    viewer: { x: number; z: number } | null,
  ): void {
    if (this.disposed) return;
    if (shimmers.length === 0 && this.drawn.length === 0) {
      if (this.mesh.count !== 0) {
        this.mesh.count = 0;
        this.mesh.visible = false; // no bind or empty draw while nothing shimmers
      }
      return;
    }
    stepShimmers(this.drawn, shimmers, dt, viewer?.x ?? null, viewer?.z ?? null);
    this.material.uniforms.uTime.value = shimmerShaderTime(time, reducedMotion);
    const count = Math.min(this.drawn.length, SHIMMER_VIEW_CAP);
    for (let i = 0; i < count; i++) {
      const d = this.drawn[i];
      this.position.set(d.x, Math.max(d.y, this.groundAt(d.x, d.z)) + SHIMMER_LIFT, d.z);
      this.rotation.setFromAxisAngle(this.up, d.yaw);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
      this.fade.setX(i, d.alpha);
    }
    this.mesh.count = count;
    // The mesh, never the group: the group's visibility is the gate's reveal.
    this.mesh.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
    // three computes an instanced mesh's sphere once and keeps it; the
    // transparent sort reads it, so it must follow the shimmers.
    if (count > 0) this.mesh.computeBoundingSphere();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

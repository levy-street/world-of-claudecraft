// The streaks of wind in the air over the Storm Cornice (a part of
// BreathFightFx, docs/design/raid/smith_heart.md section 7.2): long thin
// ribbons racing downwind at every height from the floor to a few yards up,
// white at their heads, slate at their tails, wavering as they run, over the
// whole Cornice (never only round the player), behind the gather's rolling
// front, drawn inward to the guardian while it draws breath. With the dust
// streaming over the floor they are how the wind reads its direction (Jose's
// playtest: no arrows on the floor). Every tier draws them; the low tier
// fewer (WIND_STREAKS), the floor's dust carrying the direction alone.
//
// One instanced draw, positions computed in the vertex shader from the
// shared clock and the field's own flow (no per-frame allocation, no CPU
// walk); built in the constructor under the fight's local group, so the
// compile gate links it with the rest before the first blow. No light, no
// texture.

import * as THREE from 'three';
import { BREATH } from '../../sim/content/smith_heart_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { BREATH_FIGHT_COLORS as C, WIND_STREAKS, windStreakSeed } from './breath_fight_fx_core';

/** Segments along a streak (its waver bends it). */
const SEGMENTS = 8;

const STREAK_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
uniform float uTime;
uniform float uFlowT;
uniform float uSpan;
uniform float uRate;
uniform vec2 uDir;
uniform vec2 uCentre;
uniform vec2 uFocus;
uniform vec2 uRadii;
uniform float uInward;
uniform float uFront;
attribute vec4 aSeed;
varying float vT;
varying float vSide;
varying float vFade;
void main() {
  float len = mix(4.0, 11.0, aSeed.w);
  float t = position.x;
  vec2 p;
  vec2 fwd;
  if (uInward > 0.5) {
    // Drawn in down a radius to the guardian, fading at its mouth.
    float ang = aSeed.x * 3.14159265;
    vec2 rad = vec2(sin(ang), cos(ang));
    float r = mod(aSeed.z * 50.0 - uFlowT * uRate, 50.0) + 4.0;
    p = uFocus + rad * (r + (1.0 - t) * len);
    fwd = -rad;
    vFade = smoothstep(4.0, 9.0, r);
  } else {
    vec2 side = vec2(uDir.y, -uDir.x);
    float head = mod(aSeed.z * uSpan + uFlowT * uRate, uSpan) - uSpan * 0.5;
    float al = head - (1.0 - t) * len;
    p = uCentre + uDir * al + side * (aSeed.x * uSpan * 0.5);
    p += side * sin(al * 0.16 + aSeed.z * 40.0 + uTime * 1.1) * 0.7;
    fwd = uDir;
    // Full where the gather's front has passed (the wind arriving), faint
    // ahead of it.
    float frontPos = mix(-55.0, 55.0, uFront);
    vFade = uFront < 0.0 ? 1.0 : mix(0.3, 1.0, 1.0 - smoothstep(frontPos - 6.0, frontPos + 2.0, al));
    // Born and spent softly at the two ends of its wrap.
    vFade *= smoothstep(-uSpan * 0.5, -uSpan * 0.5 + 10.0, al);
    vFade *= 1.0 - smoothstep(uSpan * 0.5 - 10.0, uSpan * 0.5, head);
  }
  // Over the Cornice, and a little past its rim where the wind spills off.
  vFade *= 1.0 - smoothstep(0.92, 1.12, length((p - uCentre) / uRadii));
  float y = mix(0.4, 6.5, aSeed.y * aSeed.y);
  y += sin(p.x * 0.21 + p.y * 0.17 + aSeed.z * 20.0 + uTime) * 0.3;
  vec4 wp = modelMatrix * vec4(p.x, y, p.y, 1.0);
  vec3 f3 = normalize((modelMatrix * vec4(fwd.x, 0.0, fwd.y, 0.0)).xyz);
  vec3 sideW = cross(f3, normalize(cameraPosition - wp.xyz));
  float sl = length(sideW);
  sideW = sl > 0.0001 ? sideW / sl : vec3(0.0, 1.0, 0.0);
  float w = mix(0.015, 0.07, t) * (0.7 + 0.6 * aSeed.w);
  wp.xyz += sideW * position.y * w;
  vT = t;
  vSide = position.y;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const STREAK_FRAG = /* glsl */ `
uniform float uStrength;
uniform vec3 uHead;
uniform vec3 uTail;
varying float vT;
varying float vSide;
varying float vFade;
void main() {
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
  float body = smoothstep(0.0, 0.85, vT) * (1.0 - smoothstep(0.94, 1.0, vT));
  float a = uStrength * vFade * edge * body * 0.45;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uTail, uHead, smoothstep(0.4, 1.0, vT)), a);
  #include <colorspace_fragment>
}
`;

export class BreathWindStreaks {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;

  /** Under `parent` (instance-local coordinates, its floor at `floorY`). */
  constructor(parent: THREE.Object3D, uTime: { value: number }, detail: boolean, floorY: number) {
    const count = detail ? WIND_STREAKS.detail : WIND_STREAKS.low;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      pos.push(t, -1, 0, t, 1, 0);
      if (i < SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const s = windStreakSeed(i);
      seeds.set([s.across, s.lift, s.phase, s.length], i * 4);
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.setIndex(idx);
    this.geo.instanceCount = count;
    const C0 = BREATH.cornice;
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindStreaks',
      uniforms: {
        uTime,
        uFlowT: { value: 0 },
        uSpan: { value: WIND_STREAKS.span },
        uRate: { value: WIND_STREAKS.rate },
        uDir: { value: new THREE.Vector2(0, 1) },
        uCentre: { value: new THREE.Vector2(C0.x, C0.z) },
        uFocus: { value: new THREE.Vector2(C0.x, C0.z) },
        uRadii: { value: new THREE.Vector2(C0.rx, C0.rz) },
        uInward: { value: 0 },
        uFront: { value: -1 },
        uStrength: { value: 0 },
        uHead: { value: new THREE.Color(C.streak) },
        uTail: { value: new THREE.Color(C.streakTail) },
      },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'smithHeartBreathWindStreaks';
    this.mesh.position.y = floorY;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** One frame: the streaks' strength (0 hides them), the wind's direction
   *  (unit x, z), drawn inward to `focus` or not, the field's flow (yards)
   *  and the gather's front (-1 none). */
  paint(
    strength: number,
    dir: { x: number; z: number },
    inward: boolean,
    focus: THREE.Vector2,
    flowT: number,
    front: number,
  ): void {
    const u = this.mat.uniforms;
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    u.uStrength.value = strength;
    (u.uDir.value as THREE.Vector2).set(dir.x, dir.z);
    (u.uFocus.value as THREE.Vector2).copy(focus);
    u.uInward.value = inward ? 1 : 0;
    u.uFlowT.value = flowT;
    u.uFront.value = front;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

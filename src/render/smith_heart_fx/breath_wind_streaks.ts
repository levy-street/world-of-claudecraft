// The gusts of wind in the air over the Storm Cornice (a part of
// BreathFightFx, docs/design/raid/smith_heart.md section 7.2): since the
// wind-cue redesign of 2026-11-25 a FEW big ribbons (WIND_STREAKS.count, the
// same on every tier: the wind's way is what a player acts on), each long and
// wispy, racing downwind low over the floor, white at their heads, slate at
// their tails, wavering as they run, over the whole Cornice (never only round
// the player), behind the gather's rolling front, drawn inward to the guardian
// while it draws breath. With the dust over the floor and the storm wall on
// the upwind edge (breath_wind_cue.ts) they read the wind's way; the HUD's
// wind badge names it.
//
// One instanced draw, positions computed in the vertex shader from the
// shared clock and the field's own flow (no per-frame allocation, no CPU
// walk); built in the constructor under the fight's local group, so the
// compile gate links it with the rest before the first blow. No light, no
// texture.

import * as THREE from 'three';
import { BREATH } from '../../sim/content/smith_heart_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  BREATH_FIGHT_COLORS as C,
  INHALE_SWIRL,
  WIND_STREAKS,
  windStreakSeed,
} from './breath_fight_fx_core';

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
uniform float uSwirl;
uniform float uFront;
uniform vec2 uLen;
uniform float uWidth;
attribute vec4 aSeed;
varying float vT;
varying float vSide;
varying float vFade;
void main() {
  float len = mix(uLen.x, uLen.y, aSeed.w);
  float t = position.x;
  vec2 p;
  vec2 fwd;
  if (uInward > 0.5) {
    // Drawn in to the guardian on the whirl's log spiral (INHALE_SWIRL:
    // every streak curling the same way round it, tighter as it closes in),
    // fading at its mouth.
    float r = mod(aSeed.z * 50.0 - uFlowT * uRate, 50.0) + 4.0;
    float rr = r + (1.0 - t) * len;
    float ang = aSeed.x * 3.14159265 - uSwirl * log(max(rr, 1.0));
    vec2 rad = vec2(sin(ang), cos(ang));
    p = uFocus + rad * rr;
    // Its heading: inward along the spiral (minus d p / d r).
    fwd = normalize(-rad + uSwirl * vec2(cos(ang), -sin(ang)));
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
  float y = mix(0.6, 4.5, aSeed.y * aSeed.y);
  y += sin(p.x * 0.21 + p.y * 0.17 + aSeed.z * 20.0 + uTime) * 0.3;
  vec4 wp = modelMatrix * vec4(p.x, y, p.y, 1.0);
  vec3 f3 = normalize((modelMatrix * vec4(fwd.x, 0.0, fwd.y, 0.0)).xyz);
  vec3 sideW = cross(f3, normalize(cameraPosition - wp.xyz));
  float sl = length(sideW);
  sideW = sl > 0.0001 ? sideW / sl : vec3(0.0, 1.0, 0.0);
  float w = mix(0.12, 1.0, sin(t * 3.14159265)) * uWidth * (0.7 + 0.6 * aSeed.w);
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
  // A soft wisp: feathered across, frayed along (a few thin strands).
  float edge = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
  float strands = 0.6 + 0.4 * sin(vSide * 7.0 + vT * 5.0);
  float body = smoothstep(0.0, 0.7, vT) * (1.0 - smoothstep(0.9, 1.0, vT));
  float a = uStrength * vFade * edge * strands * body * 0.5;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uTail, uHead, smoothstep(0.4, 1.0, vT)), a);
  #include <colorspace_fragment>
}
`;

export class BreathWindStreaks {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;

  /** Under `parent` (instance-local coordinates, its floor at `floorY`),
   *  over `field` (an ellipse: the Storm Cornice by default; the Masterless
   *  Strength's Bellows Wind lays them over the Anvil of the World). */
  constructor(
    parent: THREE.Object3D,
    uTime: { value: number },
    floorY: number,
    field: { x: number; z: number; rx: number; rz: number } = BREATH.cornice,
    name = 'smithHeartBreathWindStreaks',
  ) {
    // The same count on every tier (no preset thins the wind's way).
    const count = WIND_STREAKS.count;
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
    const C0 = field;
    this.mat = new THREE.ShaderMaterial({
      name,
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
        uSwirl: { value: INHALE_SWIRL.twist },
        uFront: { value: -1 },
        uLen: { value: new THREE.Vector2(WIND_STREAKS.minLen, WIND_STREAKS.maxLen) },
        uWidth: { value: WIND_STREAKS.width },
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
    this.mesh.name = name;
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

// The Sledge Tusker's Trample readability pass (plan: tusker_aim_fx_core.ts),
// composed by SanctumFx (sanctum_fx.ts) beside the bait rework's painter:
//  - every ice outcrop's floor circle: an ice-blue ring with turning rune
//    ticks under each intact outcrop for the whole fight, pulsing through a
//    Trample's aim (the one the lane runs into hardest), white-blue while it
//    holds the beast, and once it has burst a dark dead disc, cracked, inside
//    a cold grey ring broken in five, so a player counts the baits left at a
//    glance;
//  - the lane's end cap: an ice-shard burst on the outcrop's face while the
//    lane would end in the ice, a plain arrowhead with chevrons running down
//    the lane while it would not (the lane's own colour is the coordinator's,
//    sanctum_fx.ts paintLanes, off the same plan);
//  - the marker over the Trample's target, readable from across the road: a
//    bouncing down arrow while the lane follows them (lead it), two arrows
//    out to either side once it locks (step aside), and a reticle at their
//    feet, both in the marker's own gold (TARGET_MARKER_COLOR) inside a white
//    and a dark rim, so the marker never melts into the ice-blue lane.
//
// Every look is a mesh built once under the host's root (it rides the gated
// attach) whose state is a uniform: it draws on every tier, so no preset ever
// sheds it. No light, no pow(), no per-frame allocation. Cosmetic: the plan it
// reads is the sim's own (planTrampleLaneWorld off the mirrored Tusker).

import * as THREE from 'three';
import { TUSKER_TRAMPLE } from '../../sim/encounters/gravewyrm_sanctum/ids';
import type { OutcropSpot } from '../../sim/encounters/gravewyrm_sanctum/tusker_road';
import { planTrampleLaneWorld } from '../../sim/encounters/gravewyrm_sanctum/tusker_road_world';
import type { Entity, TuskerLane } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { SanctumFxHost } from './sanctum_fx_host';
import {
  MARKER_FAR_YARDS,
  MARKER_MAX_SCALE,
  OUTCROP_CIRCLE_RADIUS,
  type OutcropCircleLook,
  outcropCircleLook,
  TARGET_MARKER_COLOR,
  TARGET_MARKER_HEIGHT,
  TARGET_MARKER_SIZE,
  TRAMPLE_CAP_SIZE,
  type TrampleAimLook,
  targetMarkerBob,
  targetMarkerMode,
  trampleAimLook,
  trampleCapAlong,
} from './tusker_aim_fx_core';
import { BAIT_POOLS, type OutcropPhase } from './tusker_bait_fx_core';

/** An outcrop as the bait painter holds it (TuskerBaitFx.outcropViews). */
export interface OutcropView {
  readonly objectId: number;
  readonly phase: OutcropPhase;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A hand over the snow, under the lane's own paint. */
const LIFT = 0.07;
/** The cap's grid (draped on the road each frame it shows). */
const CAP_STEPS = 10;
/** The feet reticle's radius (yards). */
const RETICLE_RADIUS = 2.1;

const FLAT_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** An outcrop's circle: the ring, rune ticks turning inside it, a frost glow
 *  in its middle and a halo round it, with a dark rim either side so it reads
 *  on white snow. Spent: no glow; a dark dead disc with pale cracks inside a
 *  cold grey ring broken in five, every piece in its own dark rim. */
const CIRCLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uSpent;
uniform float uTime;
uniform float uSeed;
varying vec2 vP;
const float TAU = 6.2831853;
void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float band = smoothstep(0.84, 0.89, r) * (1.0 - smoothstep(0.99, 1.03, r));
  float rim = smoothstep(0.77, 0.84, r) * (1.0 - smoothstep(1.03, 1.1, r)) * (1.0 - band);
  float seg = fract(a / TAU * 12.0 + uTime * 0.04 + uSeed);
  float tick = (1.0 - smoothstep(0.0, 0.07, abs(seg - 0.5))) *
    smoothstep(0.66, 0.7, r) * (1.0 - smoothstep(0.77, 0.81, r));
  float inner = (1.0 - smoothstep(0.0, 0.86, r)) * 0.22;
  float halo = smoothstep(1.0, 1.06, r) * (1.0 - smoothstep(1.06, 1.4, r)) * 0.55;
  float g = clamp(uGlow, 0.0, 1.0);
  float hot = 0.55 + 0.6 * uGlow;
  vec3 live = uColor * hot * (band * 1.6 + tick * 1.3 + halo + inner * 1.2);
  float liveA = clamp(band + tick * 0.85 + halo * 0.6 + inner, 0.0, 1.0) * g;
  vec3 navy = vec3(0.015, 0.05, 0.11);
  vec3 col = mix(live, navy, rim);
  float alpha = max(liveA, rim * 0.75 * g);
  // A spent outcrop: no glow, no halo, no pulse. A dark dead disc, the ring
  // broken in five frost-grey pieces each inside its own dark rim, and pale
  // cracks across the disc: light on dark, so it reads on white snow and on
  // the dark road alike, and plainly "out" beside a lit one.
  float gap = step(0.2, fract(a / TAU * 5.0 + uSeed));
  float sBand = smoothstep(0.81, 0.86, r) * (1.0 - smoothstep(0.99, 1.04, r)) * gap;
  float sRim = smoothstep(0.72, 0.8, r) * (1.0 - smoothstep(1.05, 1.13, r)) * gap * (1.0 - sBand);
  float disc = 1.0 - smoothstep(0.72, 0.8, r);
  float ang = (fract(a / TAU * 7.0 + uSeed * 3.0) - 0.5) * TAU / 7.0;
  float crack = (1.0 - smoothstep(0.02, 0.05, abs(r * sin(ang)))) *
    smoothstep(0.12, 0.26, r) * (1.0 - smoothstep(0.66, 0.74, r));
  vec3 dead = vec3(0.02, 0.03, 0.05);
  vec3 spentCol = mix(dead, uColor, max(sBand, crack * 0.8));
  float spentA = clamp(max(max(sBand * 0.96, sRim * 0.86), disc * (0.5 + crack * 0.4)), 0.0, 0.96);
  gl_FragColor = vec4(mix(col, spentCol, uSpent), mix(alpha, spentA, uSpent));
}
`;

const CAP_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The lane's end: a plain arrowhead (and chevrons running toward it) where
 *  the charge runs out, or an ice-shard burst where it runs into the ice.
 *  uv: x across (-1..1), y along the lane (0 behind, 1 ahead). */
const CAP_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uShard;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
const float TAU = 6.2831853;
float hash1(float n) { return fract(sin(n) * 43758.5453); }
// A filled triangle: tip at (0, tip), base across at y = base, half width hw
// at the base (soft edged).
float tri(vec2 p, float tip, float base, float hw) {
  float k = clamp((tip - p.y) / (tip - base), 0.0, 1.0);
  float side = smoothstep(-0.02, 0.02, hw * k - abs(p.x));
  float ends = smoothstep(base - 0.02, base + 0.02, p.y) * (1.0 - smoothstep(tip - 0.01, tip + 0.02, p.y));
  return side * ends;
}
float chevron(vec2 p, float tip, float base, float hw, float thick) {
  return clamp(tri(p, tip, base, hw) - tri(p, tip - thick, base - thick, hw), 0.0, 1.0);
}
void main() {
  vec2 p = vUv;
  vec3 navy = vec3(0.02, 0.04, 0.09);
  // ---- the plain arrowhead (a miss) ----
  float head = chevron(p, 0.96, 0.4, 0.92, 0.3);
  float headRim = clamp(chevron(p, 1.0, 0.36, 1.02, 0.38) - head, 0.0, 1.0);
  float run = fract(uTime * 1.6);
  float chev = 0.0;
  for (int i = 0; i < 2; i++) {
    float o = (float(i) + run) * 0.22;
    chev += chevron(p, 0.36 - o + 0.22, 0.06 - o + 0.22, 0.6, 0.1) *
      (1.0 - float(i) * 0.4) * smoothstep(0.0, 0.2, 1.0 - run * 0.9);
  }
  vec3 arrowCol = uColor * (1.1 * head + 0.7 * chev);
  float arrowA = clamp(head + chev * 0.7, 0.0, 1.0);
  arrowCol = mix(arrowCol, navy, headRim);
  arrowA = max(arrowA, headRim * 0.8);
  // ---- the ice-shard burst (a bait) ----
  // In cap lengths both ways (x runs two half-widths across one length).
  vec2 c = vec2(p.x * 0.5, p.y - 0.56);
  float r = length(c);
  float a = atan(c.x, c.y);
  float lobe = floor((a / TAU + 0.5) * 7.0);
  float s = 0.5 + 0.5 * cos(a * 7.0 + 0.6);
  float s2 = s * s;
  float spike = 0.08 + (0.22 + 0.12 * hash1(lobe + 3.0)) * s2 * s2;
  float burst = 1.0 - smoothstep(spike - 0.03, spike + 0.005, r);
  float burstRim = clamp((1.0 - smoothstep(spike + 0.005, spike + 0.06, r)) - burst, 0.0, 1.0);
  float ang = (fract(a / TAU * 11.0 + 0.3) - 0.5) * TAU / 11.0;
  float crack = (1.0 - smoothstep(0.008, 0.025, abs(r * sin(ang)))) *
    smoothstep(0.04, 0.09, r) * (1.0 - smoothstep(0.34, 0.42, r));
  float core = 1.0 - smoothstep(0.03, 0.07, r);
  float beat = 0.78 + 0.22 * sin(uTime * 9.0);
  float lead = chevron(p, 0.36, 0.06, 0.5, 0.12);
  vec3 shardCol = uColor * (1.25 * burst * beat + 0.9 * crack + 0.9 * lead);
  shardCol = mix(shardCol, vec3(0.92, 0.99, 1.0), core * 0.85 + burst * 0.18);
  float shardA = clamp(burst + crack * 0.8 + lead, 0.0, 1.0);
  shardCol = mix(shardCol, navy, burstRim);
  shardA = max(shardA, burstRim * 0.75);
  vec3 col = mix(arrowCol, shardCol, uShard);
  float alpha = mix(arrowA, shardA, uShard) * uFade;
  gl_FragColor = vec4(col, alpha);
}
`;

/** The marker's shapes span -1..1 with their outlines; the quad spans a
 *  little more, so no rim is clipped at a tip. */
const MARKER_SPAN = 1.3;

const MARKER_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy * ${(2 * MARKER_SPAN).toFixed(2)};
  // A billboard: square to the camera, kept a readable size from afar
  // (tusker_aim_fx_core.ts targetMarkerScale).
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = uSize * clamp(-c.z / ${MARKER_FAR_YARDS.toFixed(1)}, 1.0, ${MARKER_MAX_SCALE.toFixed(1)});
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}
`;

/** The marker over the target: a down arrow (lead it) or two arrows out to
 *  either side (step aside), gold lit from above inside a white rim, a thick
 *  dark rim and a soft dark halo, so it stands off bright ice, dark road and
 *  either lane colour alike. */
const MARKER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uMode;
uniform float uTime;
varying vec2 vUv;
float box(vec2 p, vec2 h, float soft) {
  vec2 d = abs(p) - h;
  float o = max(d.x, d.y);
  return 1.0 - smoothstep(-soft, soft, o);
}
// Triangle pointing down (-y): tip at y = tip, base at y = base, half width hw.
float triDown(vec2 p, float tip, float base, float hw) {
  float k = clamp((p.y - tip) / (base - tip), 0.0, 1.0);
  float side = smoothstep(-0.03, 0.03, hw * k - abs(p.x));
  float ends = smoothstep(tip - 0.03, tip + 0.03, p.y) * (1.0 - smoothstep(base - 0.03, base + 0.03, p.y));
  return side * ends;
}
float downArrow(vec2 p, float grow) {
  float head = triDown(p, -0.88 - grow, 0.08 + grow * 0.5, 0.74 + grow);
  float shaft = box(p - vec2(0.0, 0.45), vec2(0.21 + grow, 0.42 + grow), 0.03);
  return max(head, shaft);
}
float sideArrows(vec2 p, float grow) {
  // Right arrow: rotate so it points +x; the left one mirrors it.
  vec2 q = vec2(abs(p.x), p.y);
  vec2 r = vec2(q.y, -q.x);
  float head = triDown(r, -0.94 - grow, -0.42 + grow * 0.5, 0.5 + grow);
  float shaft = box(q - vec2(0.27, 0.0), vec2(0.17 + grow, 0.15 + grow), 0.03);
  return max(head, shaft);
}
void main() {
  vec2 p = vUv;
  float down = step(uMode, 0.5);
  float fill = mix(sideArrows(p, 0.0), downArrow(p, 0.0), down);
  float white = mix(sideArrows(p, 0.08), downArrow(p, 0.08), down);
  float dark = mix(sideArrows(p, 0.19), downArrow(p, 0.19), down);
  float halo = mix(sideArrows(p, 0.3), downArrow(p, 0.3), down);
  float flash = mix(0.72 + 0.28 * step(0.5, fract(uTime * 5.0)), 1.0, down);
  // Lit from above: a brighter crown and a deeper foot, so it reads as a
  // solid token rather than a flat decal.
  vec3 gold = uColor * mix(0.78, 1.18, clamp(p.y * 0.5 + 0.5, 0.0, 1.0)) * flash;
  vec3 col = mix(vec3(0.03, 0.02, 0.01), vec3(1.0), white);
  col = mix(col, gold, fill);
  float alpha = max(halo * 0.32, max(dark * 0.92, max(white, fill)));
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

/** The reticle at the target's feet: four brackets turning round them. */
const RETICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vP;
const float TAU = 6.2831853;
void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x) + uTime * 1.4;
  float seg = fract(a / TAU * 4.0);
  float on = smoothstep(0.08, 0.12, seg) * (1.0 - smoothstep(0.58, 0.62, seg));
  float band = smoothstep(0.78, 0.83, r) * (1.0 - smoothstep(0.95, 1.0, r)) * on;
  float rim = smoothstep(0.72, 0.78, r) * (1.0 - smoothstep(1.0, 1.06, r)) * on * (1.0 - band);
  float pip = 1.0 - smoothstep(0.1, 0.16, r);
  vec3 col = mix(uColor * 1.3, vec3(0.02, 0.04, 0.09), rim);
  col = mix(col, vec3(0.95, 1.0, 1.0), pip * 0.6);
  gl_FragColor = vec4(col, clamp(band + rim * 0.75 + pip * 0.8, 0.0, 1.0));
}
`;

interface CircleSlot {
  objectId: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class TuskerAimFx {
  private readonly circles: CircleSlot[] = [];
  private readonly cap: THREE.Mesh;
  private readonly capMat: THREE.ShaderMaterial;
  private readonly marker: THREE.Mesh;
  private readonly markerMat: THREE.ShaderMaterial;
  private readonly reticle: THREE.Mesh;
  private readonly reticleMat: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly look: TrampleAimLook = trampleAimLook(null, 0);
  private readonly circleLook: OutcropCircleLook = outcropCircleLook('whole', false, false, 0);
  private readonly standingSpots: OutcropSpot[] = [];
  private readonly spotPool: OutcropSpot[] = [];
  private readonly lane: TuskerLane = { x: 0, z: 0, yaw: 0, length: 0, reach: 0, outcropId: null };
  private aiming = false;
  private shown = { cap: false, marker: false };
  private disposed = false;

  constructor(
    private readonly host: SanctumFxHost,
    private readonly world: IWorld,
  ) {
    const flat = (size: number): THREE.BufferGeometry => {
      const g = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
      this.geometries.push(g);
      return g;
    };
    // The circles: the plane spans the halo (1.4 radii), drawn in radii.
    const span = 1.45;
    const circleGeo = flat(2 * span);
    for (let i = 0; i < BAIT_POOLS.outcrops; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sanctumOutcropCircle',
        uniforms: {
          uColor: { value: new THREE.Color(0x6ad8ff) },
          uGlow: { value: 0 },
          uSpent: { value: 0 },
          uTime: host.uTime,
          uSeed: { value: i * 0.173 },
        },
        vertexShader: FLAT_VERT,
        fragmentShader: CIRCLE_FRAG,
        transparent: true,
        depthWrite: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(circleGeo, mat);
      mesh.name = 'sanctum-outcrop-circle';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 12);
      host.root.add(mesh);
      this.circles.push({ objectId: -1, mesh, mat });
    }
    // The lane's end cap: a grid draped on the road where it shows.
    const capGeo = new THREE.BufferGeometry();
    const n = (CAP_STEPS + 1) * (CAP_STEPS + 1);
    capGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let j = 0; j <= CAP_STEPS; j++)
      for (let i = 0; i <= CAP_STEPS; i++) {
        const k = j * (CAP_STEPS + 1) + i;
        uv[k * 2] = (i / CAP_STEPS) * 2 - 1;
        uv[k * 2 + 1] = j / CAP_STEPS;
        if (i < CAP_STEPS && j < CAP_STEPS)
          idx.push(k, k + CAP_STEPS + 1, k + 1, k + 1, k + CAP_STEPS + 1, k + CAP_STEPS + 2);
      }
    capGeo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    capGeo.setIndex(idx);
    this.geometries.push(capGeo);
    this.capMat = new THREE.ShaderMaterial({
      name: 'sanctumTrampleCap',
      uniforms: {
        uColor: { value: new THREE.Color(this.look.color) },
        uShard: { value: 0 },
        uTime: host.uTime,
        uFade: { value: 1 },
      },
      vertexShader: CAP_VERT,
      fragmentShader: CAP_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.capMat);
    this.cap = new THREE.Mesh(capGeo, this.capMat);
    this.cap.name = 'sanctum-trample-cap';
    this.cap.frustumCulled = false;
    this.cap.visible = false;
    this.cap.renderOrder = floorVfxRenderOrder('encounter', 20);
    host.root.add(this.cap);
    // The marker over the target, and the reticle at their feet.
    const markerGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(markerGeo);
    this.markerMat = new THREE.ShaderMaterial({
      name: 'sanctumTrampleTargetMarker',
      uniforms: {
        uColor: { value: new THREE.Color(TARGET_MARKER_COLOR) },
        uMode: { value: 0 },
        uTime: host.uTime,
        uSize: { value: TARGET_MARKER_SIZE * MARKER_SPAN },
      },
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.materials.push(this.markerMat);
    this.marker = new THREE.Mesh(markerGeo, this.markerMat);
    this.marker.name = 'sanctum-trample-target-marker';
    this.marker.frustumCulled = false;
    this.marker.visible = false;
    this.marker.renderOrder = floorVfxRenderOrder('encounter', 29);
    host.root.add(this.marker);
    this.reticleMat = new THREE.ShaderMaterial({
      name: 'sanctumTrampleTargetReticle',
      uniforms: { uColor: { value: new THREE.Color(TARGET_MARKER_COLOR) }, uTime: host.uTime },
      vertexShader: FLAT_VERT,
      fragmentShader: RETICLE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(this.reticleMat);
    this.reticle = new THREE.Mesh(flat(2), this.reticleMat);
    this.reticle.name = 'sanctum-trample-target-reticle';
    this.reticle.frustumCulled = false;
    this.reticle.visible = false;
    this.reticle.renderOrder = floorVfxRenderOrder('encounter', 21);
    host.root.add(this.reticle);
  }

  // ------------------------------------------------------------------- frame

  /** `tusker`: the Tusker the scan found; `outcrops`: the bait painter's
   *  outcrop slots (a negative objectId is a free slot). */
  update(clock: number, tusker: Entity | null, outcrops: readonly OutcropView[]): void {
    if (this.disposed) return;
    // The lane the sim would charge now (its own plan, off the mirror).
    const casting = !!tusker && !tusker.dead && tusker.castingAbility === TUSKER_TRAMPLE;
    let aimedId = -1;
    if (casting && tusker) {
      const standing = this.standingSpots;
      standing.length = 0;
      for (const o of outcrops) {
        if (o.objectId < 0 || o.phase !== 'whole') continue;
        let spot = this.spotPool[standing.length];
        if (!spot) {
          spot = { id: 0, x: 0, z: 0 };
          this.spotPool[standing.length] = spot;
        }
        spot.id = o.objectId;
        spot.x = o.x;
        spot.z = o.z;
        standing.push(spot);
      }
      const lane = planTrampleLaneWorld(
        tusker.pos.x,
        tusker.pos.z,
        tusker.facing,
        standing,
        this.lane,
      );
      const look = trampleAimLook(lane.outcropId, tusker.castRemaining, this.look);
      aimedId = lane.outcropId ?? -1;
      this.paintCap(tusker, lane, look);
      this.paintTarget(clock, tusker);
    } else {
      this.hideAim();
    }
    this.aiming = casting;
    this.paintCircles(clock, outcrops, aimedId);
  }

  private paintCircles(clock: number, outcrops: readonly OutcropView[], aimedId: number): void {
    for (let i = 0; i < this.circles.length; i++) {
      const slot = this.circles[i];
      const o = i < outcrops.length ? outcrops[i] : null;
      if (!o || o.objectId < 0) {
        if (slot.objectId >= 0) {
          slot.objectId = -1;
          slot.mesh.visible = false;
        }
        continue;
      }
      if (slot.objectId !== o.objectId) {
        slot.objectId = o.objectId;
        const r = OUTCROP_CIRCLE_RADIUS;
        slot.mesh.scale.set(r, 1, r);
        slot.mesh.position.set(o.x, this.host.groundY(o.x, o.z) + LIFT, o.z);
        slot.mesh.visible = true;
      }
      const look = outcropCircleLook(
        o.phase,
        this.aiming,
        o.objectId === aimedId,
        clock,
        this.circleLook,
      );
      const u = slot.mat.uniforms;
      (u.uColor.value as THREE.Color).setHex(look.color);
      u.uGlow.value = look.glow;
      u.uSpent.value = look.spent;
    }
  }

  private paintCap(
    tusker: Entity,
    lane: { yaw: number; length: number; reach: number; outcropId: number | null },
    look: TrampleAimLook,
  ): void {
    const along = trampleCapAlong(lane);
    const ax = Math.sin(lane.yaw);
    const az = Math.cos(lane.yaw);
    const cx = tusker.pos.x + ax * along;
    const cz = tusker.pos.z + az * along;
    const host = this.host;
    const cy = host.groundY(cx, cz);
    this.cap.position.set(cx, cy, cz);
    // Drape the grid on the road: across is (az, -ax), along is (ax, az).
    const pos = this.cap.geometry.getAttribute('position') as THREE.BufferAttribute;
    const half = TRAMPLE_CAP_SIZE / 2;
    for (let j = 0; j <= CAP_STEPS; j++)
      for (let i = 0; i <= CAP_STEPS; i++) {
        const u = ((i / CAP_STEPS) * 2 - 1) * half;
        const v = (j / CAP_STEPS - 0.5) * TRAMPLE_CAP_SIZE;
        const wx = cx + az * u + ax * v;
        const wz = cz - ax * u + az * v;
        pos.setXYZ(j * (CAP_STEPS + 1) + i, wx - cx, host.groundY(wx, wz) - cy + LIFT, wz - cz);
      }
    pos.needsUpdate = true;
    const cu = this.capMat.uniforms;
    (cu.uColor.value as THREE.Color).setHex(look.color);
    const want = look.cap === 'shard' ? 1 : 0;
    cu.uShard.value = want;
    cu.uFade.value = look.locked ? 1 : 0.92;
    if (!this.shown.cap) {
      this.shown.cap = true;
      this.cap.visible = true;
    }
  }

  private paintTarget(clock: number, tusker: Entity): void {
    const target =
      tusker.castTargetId !== null ? (this.world.entities.get(tusker.castTargetId) ?? null) : null;
    if (!target || target.dead) {
      if (this.shown.marker) {
        this.shown.marker = false;
        this.marker.visible = false;
        this.reticle.visible = false;
      }
      return;
    }
    const mode = targetMarkerMode(tusker.castRemaining);
    const gy = this.host.groundY(target.pos.x, target.pos.z);
    this.marker.position.set(
      target.pos.x,
      gy + TARGET_MARKER_HEIGHT + targetMarkerBob(mode, clock),
      target.pos.z,
    );
    this.reticle.position.set(target.pos.x, gy + LIFT, target.pos.z);
    this.reticle.scale.set(RETICLE_RADIUS, 1, RETICLE_RADIUS);
    this.markerMat.uniforms.uMode.value = mode;
    if (!this.shown.marker) {
      this.shown.marker = true;
      this.marker.visible = true;
      this.reticle.visible = true;
    }
  }

  private hideAim(): void {
    if (this.shown.cap) {
      this.shown.cap = false;
      this.cap.visible = false;
    }
    if (this.shown.marker) {
      this.shown.marker = false;
      this.marker.visible = false;
      this.reticle.visible = false;
    }
  }

  hideAll(): void {
    this.hideAim();
    this.aiming = false;
    for (const c of this.circles) {
      c.objectId = -1;
      c.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// The hourly skill events on the ground: the arena circle (the King of the
// Hill ring builder, fed by skill_event_ground_core.ts skillEventRingInput) and,
// for Footprints in Ash, the marks on the ash: footprints and the breath plumes
// that rise over a fighter standing still. Everything here is actionable (the
// marks are the only trace of an unseen fighter), so nothing is gated by a
// graphics tier.
//
// The footprints are the Stealth Rework prints (PR 4659): a flat foot-shaped
// decal whose normals carry a shallow cup and a raised lip, shaded by the
// scene's live key light against flat ground and MULTIPLIED onto the ground
// already drawn, so a print wears the colours of whatever it is on. One
// instanced mesh per fade step. The plumes are camera-facing puffs with an
// alpha per instance. Every material is built at construction and the whole
// root attaches through the compile gate, so nothing links in a live frame.

import * as THREE from 'three';
import type {
  HillInfo,
  SkillEventInfo,
  SkillEventMark,
  SkillEventMarkBook,
} from '../world_api/world_pvp';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { SUN_DIR } from './gfx';
import { type HillRingCompileGate, HillRingVisuals } from './hill_ring';
import { sceneKeyLightUniform } from './scene_sampling';
import { BankshotVisuals } from './skill_event_bankshot_visuals';
import {
  SKILL_EVENT_STEP_FADE_BUCKETS,
  SKILL_EVENT_STEP_FADE_OPACITY,
  SKILL_EVENT_STEP_HALF_LENGTH,
  SKILL_EVENT_STEP_HALF_WIDTH,
  type SkillEventMarkPose,
  skillEventMarkPose,
  skillEventRingInput,
  skillEventStepBucket,
  skillEventStepNormalInto,
} from './skill_event_ground_core';

/** Live marks drawn at most per mesh: far above a full arena's 3 seconds. */
const MAX_MARKS = 512;
const BREATH_SIZE = 0.9;
const BREATH_COLOR = 0xe9edf2;
/** Lift above the surface so a print never z-fights it. */
const STEP_LIFT = 0.05;
/** How strongly the dent's shading departs from flat ground. */
const SHADE_GAIN = 1.6;
const LIGHT_GAIN = 0.7;
const RINGS = 10;
const SEGMENTS = 24;

const STEP_VERTEX = /* glsl */ `
varying vec3 vNormalW;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vNormalW = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * (m * vec4(position, 1.0));
}`;
// Light on the dent over light on flat ground is the factor the ground's own
// colour is multiplied by (1 leaves it untouched), written as half colour plus
// half alpha because the blend computes ground * (colour + alpha).
const STEP_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOpacity;
varying vec3 vNormalW;
void main() {
  float flatLight = max(uSunDir.y, 0.15);
  float light = max(dot(normalize(vNormalW), uSunDir), 0.0) / flatLight;
  float d = light - 1.0;
  float k = d < 0.0 ? d * ${SHADE_GAIN.toFixed(2)} : d * ${LIGHT_GAIN.toFixed(2)};
  float f = mix(1.0, clamp(1.0 + k, 0.15, 1.85), uOpacity);
  gl_FragColor = vec4(vec3(f * 0.5), f * 0.5);
}`;

const BREATH_VERTEX = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BREATH_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** The print's flat grid at its real size, long axis +Z, the dent's normals
 *  baked per vertex. */
function stepGeometry(): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const n = { x: 0, y: 1, z: 0 };
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = ring / RINGS;
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const t = (seg / SEGMENTS) * Math.PI * 2;
      const u = Math.cos(t) * r;
      const v = Math.sin(t) * r;
      positions.push(u * SKILL_EVENT_STEP_HALF_WIDTH, 0, v * SKILL_EVENT_STEP_HALF_LENGTH);
      skillEventStepNormalInto(n, u, v);
      normals.push(n.x, n.y, n.z);
    }
  }
  const index: number[] = [];
  const at = (ring: number, seg: number) => 1 + (ring - 1) * SEGMENTS + (seg % SEGMENTS);
  for (let seg = 0; seg < SEGMENTS; seg++) index.push(0, at(1, seg + 1), at(1, seg));
  for (let ring = 1; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = at(ring, seg);
      const b = at(ring, seg + 1);
      const c = at(ring + 1, seg);
      const d = at(ring + 1, seg + 1);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A soft round puff for a breath plume. */
function puffTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** The Footprints in Ash marks: footprint dents and breath plumes. */
class SkillEventMarkVisuals {
  private readonly group = new THREE.Group();
  private readonly steps: THREE.InstancedMesh[] = [];
  private readonly stepCounts = new Array<number>(SKILL_EVENT_STEP_FADE_BUCKETS).fill(0);
  private readonly breaths: THREE.InstancedMesh;
  private readonly breathAlpha: THREE.InstancedBufferAttribute;
  private readonly groundYBySeq = new Map<number, number>();
  private readonly pose: SkillEventMarkPose = { alpha: 0, lift: 0, scale: 1 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private drawn = false;

  constructor(
    scene: THREE.Scene,
    compileGate: HillRingCompileGate | undefined,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.group.name = 'skill-event-marks';
    const keyLight =
      scene instanceof THREE.Scene ? sceneKeyLightUniform(scene) : { value: SUN_DIR.clone() };
    const geo = stepGeometry();
    for (let bucket = 0; bucket < SKILL_EVENT_STEP_FADE_BUCKETS; bucket++) {
      const material = new THREE.ShaderMaterial({
        vertexShader: STEP_VERTEX,
        fragmentShader: STEP_FRAGMENT,
        uniforms: {
          uSunDir: keyLight,
          uOpacity: { value: SKILL_EVENT_STEP_FADE_OPACITY[bucket] },
        },
        transparent: true,
        depthWrite: false,
        // A multiply onto what is already drawn: ground * (src.rgb + src.a).
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.SrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      // The four differ only in opacity (a uniform), so they share one program.
      material.name = `skill-event-marks:step-${bucket}`;
      const mesh = new THREE.InstancedMesh(geo, material, MAX_MARKS);
      mesh.name = `skill-event-marks-step-${bucket}`;
      mesh.count = 0;
      mesh.frustumCulled = false; // instances span the arena
      mesh.renderOrder = floorVfxRenderOrder('player', 8);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.steps.push(mesh);
      this.group.add(mesh);
    }
    const breathGeo = new THREE.PlaneGeometry(BREATH_SIZE, BREATH_SIZE);
    this.breathAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS), 1);
    this.breathAlpha.setUsage(THREE.DynamicDrawUsage);
    breathGeo.setAttribute('aAlpha', this.breathAlpha);
    const breathMat = new THREE.ShaderMaterial({
      name: 'skill-event-marks:breath',
      uniforms: {
        uMap: { value: puffTexture() },
        uColor: { value: new THREE.Color(BREATH_COLOR) },
      },
      vertexShader: BREATH_VERTEX,
      fragmentShader: BREATH_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.breaths = new THREE.InstancedMesh(breathGeo, breathMat, MAX_MARKS);
    this.breaths.name = 'skill-event-marks-breath';
    this.breaths.count = 0;
    this.breaths.frustumCulled = false;
    this.breaths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.breaths);
    attachSceneGroupGated(scene, this.group, compileGate).catch(() => {});
  }

  sync(book: SkillEventMarkBook, camera: THREE.Camera): void {
    if (book.marks.length === 0) {
      if (!this.drawn) return;
      this.drawn = false;
      for (const mesh of this.steps) mesh.count = 0;
      this.breaths.count = 0;
      this.groundYBySeq.clear();
      return;
    }
    this.drawn = true;
    this.stepCounts.fill(0);
    // Plumes face the camera around the vertical only, so they read as rising.
    const cam = camera.position;
    let nBreaths = 0;
    let minSeq = Number.POSITIVE_INFINITY;
    for (const mark of book.marks) {
      minSeq = Math.min(minSeq, mark.seq);
      const age = book.now - mark.at;
      const y = this.groundAt(mark);
      if (mark.kind === 'step') {
        const bucket = skillEventStepBucket(age);
        if (bucket < 0) continue;
        const index = this.stepCounts[bucket]++;
        if (index >= MAX_MARKS) continue;
        this.q.setFromAxisAngle(this.up, mark.heading);
        this.p.set(mark.x, y + STEP_LIFT, mark.z);
        this.steps[bucket].setMatrixAt(index, this.m.compose(this.p, this.q, this.one));
      } else {
        const pose = skillEventMarkPose(mark.kind, age, this.pose);
        if (pose.alpha <= 0 || nBreaths >= MAX_MARKS) continue;
        this.q.setFromAxisAngle(this.up, Math.atan2(cam.x - mark.x, cam.z - mark.z));
        this.p.set(mark.x, y + pose.lift, mark.z);
        this.s.set(pose.scale, pose.scale, pose.scale);
        this.breaths.setMatrixAt(nBreaths, this.m.compose(this.p, this.q, this.s));
        this.breathAlpha.setX(nBreaths, pose.alpha);
        nBreaths++;
      }
    }
    for (let bucket = 0; bucket < SKILL_EVENT_STEP_FADE_BUCKETS; bucket++) {
      const mesh = this.steps[bucket];
      mesh.count = Math.min(this.stepCounts[bucket], MAX_MARKS);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.breaths.count = nBreaths;
    this.breaths.instanceMatrix.needsUpdate = true;
    this.breathAlpha.needsUpdate = true;
    for (const seq of this.groundYBySeq.keys()) if (seq < minSeq) this.groundYBySeq.delete(seq);
  }

  private groundAt(mark: SkillEventMark): number {
    let y = this.groundYBySeq.get(mark.seq);
    if (y === undefined) {
      y = this.groundY(mark.x, mark.z);
      this.groundYBySeq.set(mark.seq, y);
    }
    return y;
  }
}

/** The world PvP ground: the King of the Hill circle, the skill event arena
 *  (at its live field radius), the Footprints in Ash marks and the Bankshot
 *  stones and bolts. */
export class PvpGroundVisuals {
  private readonly hill: HillRingVisuals;
  private readonly arena: HillRingVisuals;
  private readonly marks: SkillEventMarkVisuals;
  private readonly bankshot: BankshotVisuals;

  constructor(
    scene: THREE.Scene,
    compileGate: HillRingCompileGate | undefined,
    groundY: (x: number, z: number) => number,
  ) {
    this.hill = new HillRingVisuals(scene, compileGate, groundY);
    this.arena = new HillRingVisuals(scene, compileGate, groundY);
    this.marks = new SkillEventMarkVisuals(scene, compileGate, groundY);
    this.bankshot = new BankshotVisuals(scene, compileGate, groundY);
  }

  /** Each frame, from IWorld. */
  drive(
    world: {
      hillInfo: HillInfo | null;
      skillEventInfo: SkillEventInfo | null;
      skillEventMarks(): SkillEventMarkBook;
    },
    dt: number,
    camera: THREE.Camera,
  ): void {
    this.hill.sync(world.hillInfo);
    this.hill.update(dt);
    const event = world.skillEventInfo;
    this.arena.sync(skillEventRingInput(event));
    this.arena.update(dt);
    const book = world.skillEventMarks();
    this.marks.sync(book, camera);
    this.bankshot.sync(event, book);
  }
}

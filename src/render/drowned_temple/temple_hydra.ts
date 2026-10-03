// The Mere Hydra's one body (the showpiece of the Hydra Pool): the Blender
// model made with Sol (public/models/creatures/mere_hydra.glb; three necks, one
// mound under the water, seven clips) drawn ONCE at the pool, while the three
// head entities stay bodyless targets (manifest `bodyless`). Its clips follow
// the heads' state read from IWorld: it rises (Emerge) when pulled, the side
// heads' Tide Breath bars play Tide_Breath, the centre head's spit plays
// Brine_Spit, a head's bite plays Snap, and when a head falls its neck sinks
// into the pool (the chain folds down) while the others fight on; the last one
// plays Death. The breath itself is a torrent of frost from the mouth socket
// down its locked cone, the spit arcs of brine to each pool.
//
// The sixth pass (temple_hydra_fx.ts): each neck is tinted by its element
// (ice, venom, water) and its element burns at the mouth of whoever wields it;
// the Crushing Torrent pours a jet of lagoon water down its lane; the whole
// body sinks under the pool for the Tsunami while the wave rolls; a fallen
// head's stump stirs as its regrowth nears and the neck grows back in a burst.
//
// Cosmetic only; state comes from entity fields (cast bars, the dead flag,
// damage events), so offline and online look the same.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HYDRA_BODY } from '../../sim/content/drowned_temple_layout';
import {
  BRINE_SPIT_TEMPLATE,
  HYDRA_BRINE_SPIT,
  HYDRA_CENTER_ID,
  HYDRA_CRUSHING_TORRENT,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TIDE_BREATH,
  HYDRA_TSUNAMI,
  HYDRA_TUNING,
  hydraElementOwners,
  TSUNAMI_TEMPLATES,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { loadGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { TempleHydraFx, tintHydraNecks } from './temple_hydra_fx';
import {
  freshNeck,
  holdFallenNecks,
  type NeckMemory,
  releaseOrphanPours,
  stepNeck,
} from './temple_hydra_neck_core';
import { tsunamiWarnProgress } from './temple_tsunami_core';

export const MERE_HYDRA_URL = '/models/creatures/mere_hydra.glb';

let source: THREE.Object3D | null = null;
let clips: THREE.AnimationClip[] = [];
let loading: Promise<void> | null = null;

function startLoad(): Promise<void> {
  loading ??= loadGltf(MERE_HYDRA_URL)
    .then((gltf) => {
      source = gltf.scene;
      clips = gltf.animations;
    })
    .catch(() => undefined);
  return loading;
}

if (typeof window !== 'undefined') registerDeferredPreload(() => startLoad());

/** The three head templates, in the model's neck order (L, C, R). */
const HEADS = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID] as const;
const NECK = ['L', 'C', 'R'] as const;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

const BREATH_VERT = /* glsl */ `
attribute vec4 aSeed; // lane, phase, speed, size
uniform float uTime;
uniform float uLife;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uSpread;
uniform float uWidth;
varying float vFade;
varying vec2 vUv;
void main() {
  vUv = uv;
  float t = fract(uTime * aSeed.z + aSeed.y);
  vec3 dir = uTo - uFrom;
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + 1e-5);
  vec3 up = normalize(cross(side, dir));
  float lane = (aSeed.x - 0.5) * 2.0;
  vec3 c = uFrom + dir * t + side * lane * uSpread * t + up * sin(aSeed.y * 30.0) * uSpread * 0.25 * t;
  vFade = uLife * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.75, 1.0, t));
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * (0.6 + t * 3.2) * aSeed.w * uWidth;
  gl_Position = projectionMatrix * mv;
}
`;

const BREATH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColA;
uniform vec3 uColB;
varying float vFade;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  vec3 col = mix(uColA, uColB, core * core);
  gl_FragColor = vec4(col * core * vFade, core * vFade);
}
`;

interface Breath {
  mesh: THREE.Mesh;
  uniforms: {
    uLife: { value: number };
    uFrom: { value: THREE.Vector3 };
    uTo: { value: THREE.Vector3 };
    uSpread: { value: number };
    uWidth: { value: number };
    uColA: { value: THREE.Color };
    uColB: { value: THREE.Color };
  };
  life: number;
  headId: number;
  castId: string;
}

/** Each pouring cast's look: the Freezing Breath's frost cone, the Crushing
 *  Torrent's narrow jet of lagoon water. */
const POURS: Readonly<
  Record<string, { range: number; spread: number; width: number; a: number; b: number }>
> = {
  [HYDRA_TIDE_BREATH]: {
    range: HYDRA_TUNING.breathRange,
    spread: 5,
    width: 1,
    a: 0x73bfff,
    b: 0xf2faff,
  },
  [HYDRA_CRUSHING_TORRENT]: {
    range: HYDRA_TUNING.torrentLength,
    spread: 1.4,
    width: 1.35,
    a: 0x1f6f9c,
    b: 0xd8f2ff,
  },
};

interface Spit {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class TempleHydra {
  private body: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private heads: (number | null)[] = [null, null, null];
  private scan = 0;
  private engaged = false;
  private allDead = false;
  private readonly neckMem: NeckMemory[] = [freshNeck(), freshNeck(), freshNeck()];
  private readonly sinkDir = new THREE.Vector3();
  private readonly sinkQuat = new THREE.Quaternion();
  private readonly sinkScale = new THREE.Vector3();
  private readonly necks: (THREE.Object3D | null)[] = [null, null, null];
  private readonly sockets: (THREE.Object3D | null)[] = [null, null, null];
  private readonly breaths: Breath[] = [];
  private readonly spits: Spit[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly spitGeo = new THREE.SphereGeometry(0.45, 10, 8);
  private readonly spitMat = new THREE.MeshBasicMaterial({
    color: 0x9cf06a,
    transparent: true,
    opacity: 0.85,
    name: 'drownedTempleBrineSpit',
  });

  constructor(
    private readonly root: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly detail: boolean,
    groundY?: (x: number, z: number) => number,
  ) {
    void startLoad();
    for (let i = 0; i < 3; i++) this.breaths.push(this.makeBreath());
    this.fx = new TempleHydraFx(root, detail, groundY);
  }

  private readonly fx: TempleHydraFx;
  private waveId: number | null = null;
  private sink = 0;
  private clock = 0;
  private readonly socketPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  private makeBreath(): Breath {
    const n = this.detail ? 140 : 50;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const f = h - Math.floor(h);
      seeds.set([f, (i * 0.61803) % 1, 0.9 + f * 0.8, 0.6 + ((i * 0.37) % 1) * 0.9], i * 4);
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = n;
    const uniforms = {
      uTime: { value: 0 },
      uLife: { value: 0 },
      uFrom: { value: new THREE.Vector3() },
      uTo: { value: new THREE.Vector3() },
      uSpread: { value: 5 },
      uWidth: { value: 1 },
      uColA: { value: new THREE.Color(0x73bfff) },
      uColB: { value: new THREE.Color(0xf2faff) },
    };
    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        name: 'drownedTempleTideBreath',
        vertexShader: BREATH_VERT,
        fragmentShader: BREATH_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 11;
    this.root.add(mesh);
    return { mesh, uniforms, life: 0, headId: -1, castId: '' };
  }

  /** The world entity of head `i` (L, C, R), or null. */
  private head(i: number): EntityView | null {
    const id = this.heads[i];
    return id !== null ? (this.world?.entities.get(id) ?? null) : null;
  }

  private findHeads(): void {
    const world = this.world;
    if (!world) return;
    const me = world.entities.get(world.playerId);
    this.heads = [null, null, null];
    this.waveId = null;
    for (const e of world.entities.values()) {
      if (e.templateId === TSUNAMI_TEMPLATES.warn || e.templateId === TSUNAMI_TEMPLATES.surge) {
        this.waveId = e.id;
        continue;
      }
      if (e.kind !== 'mob') continue;
      const i = HEADS.indexOf(e.templateId as (typeof HEADS)[number]);
      if (i < 0) continue;
      // Nearest claim's heads only (a player sees one run).
      const prev = this.heads[i] !== null ? world.entities.get(this.heads[i] as number) : null;
      if (
        !prev ||
        (me &&
          Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) <
            Math.hypot(prev.pos.x - me.pos.x, prev.pos.z - me.pos.z))
      )
        this.heads[i] = e.id;
    }
  }

  private build(center: EntityView): void {
    if (!source || this.body) return;
    const body = cloneSkinned(source);
    body.name = 'drownedTempleMereHydra';
    tintHydraNecks(body);
    body.scale.setScalar(HYDRA_BODY.scale);
    body.rotation.y = Math.PI;
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = this.detail;
        m.frustumCulled = false;
      }
    });
    this.root.add(body);
    this.body = body;
    this.place(center);
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    for (let i = 0; i < 3; i++) {
      this.necks[i] = body.getObjectByName(`neck_${NECK[i]}_01`) ?? null;
      this.sockets[i] = body.getObjectByName(`Socket_Breath_${NECK[i]}`) ?? null;
    }
    this.play('Idle', true);
  }

  private place(center: EntityView): void {
    if (!this.body) return;
    // The model's root sits on the pool's water line, a hand behind the
    // centre head (the layout's HYDRA_BODY).
    this.body.position.set(center.pos.x, center.pos.y + 0.55, center.pos.z + 0.1);
  }

  private play(name: string, loop = false): void {
    const next = this.actions.get(name);
    if (!next || next === this.current) {
      if (next && !loop) next.reset().play();
      return;
    }
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.fadeIn(0.25).play();
    this.current?.fadeOut(0.25);
    this.current = next;
  }

  handleEvent(ev: SimEvent): void {
    if (!this.body || !this.world) return;
    if (ev.type === 'spellfx' && ev.ability === HYDRA_BRINE_SPIT && ev.fx === 'windup') {
      this.play('Brine_Spit');
      this.launchSpits();
      return;
    }
    if (ev.type === 'damage' && this.heads.includes(ev.sourceId) && !ev.ability) {
      if (this.current?.getClip().name === 'Idle') this.play('Snap');
    }
  }

  private launchSpits(): void {
    const world = this.world;
    const socket = this.sockets[1];
    if (!world || !socket) return;
    socket.getWorldPosition(this.tmp);
    for (const e of world.entities.values()) {
      if (e.templateId !== BRINE_SPIT_TEMPLATE) continue;
      if (Math.hypot(e.pos.x - this.tmp.x, e.pos.z - this.tmp.z) > 60) continue;
      const mesh = new THREE.Mesh(this.spitGeo, this.spitMat);
      mesh.renderOrder = 11;
      this.root.add(mesh);
      this.spits.push({
        mesh,
        from: this.tmp.clone(),
        to: new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z),
        t: 0,
      });
    }
  }

  update(dt: number, clock: number): void {
    const world = this.world;
    if (!world) return;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.5;
      this.findHeads();
    }
    const center = this.head(1) ?? this.head(0) ?? this.head(2);
    if (!center) {
      this.quenchBreaths();
      return;
    }
    if (!this.body) {
      this.build(center);
      if (!this.body) return;
    }
    // Pulled: rise out of the pool; reset: settle back.
    const anyEngaged = this.heads.some((_, i) => {
      const h = this.head(i);
      return h !== null && !h.dead && h.aggroTargetId !== null;
    });
    const dead = this.heads.every((_, i) => this.head(i)?.dead ?? true);
    if (dead && !this.allDead) {
      this.allDead = true;
      // The necks that fell before stay down under the Death clip.
      holdFallenNecks(this.neckMem);
      this.play('Death');
    } else if (!dead && this.allDead) {
      this.allDead = false;
      for (let i = 0; i < 3; i++) this.neckMem[i] = freshNeck();
      this.play('Idle', true);
    }
    if (anyEngaged && !this.engaged && !dead) this.play('Emerge');
    this.engaged = anyEngaged;
    if (!dead) {
      for (let i = 0; i < 3; i++) {
        const cast = this.head(i)?.castingAbility;
        if (
          (cast === HYDRA_TIDE_BREATH || cast === HYDRA_CRUSHING_TORRENT) &&
          this.current?.getClip().name !== 'Tide_Breath'
        )
          this.play('Tide_Breath');
      }
      const clip = this.current;
      if (clip && !clip.isRunning() && clip.getClip().name !== 'Idle') this.play('Idle', true);
    }
    this.mixer?.update(dt);
    // The Tsunami: the whole body sinks under the pool while the wave rolls.
    const submerged = this.heads.some((_, i) => this.head(i)?.castingAbility === HYDRA_TSUNAMI);
    this.sink = submerged ? Math.min(1, this.sink + dt / 1.1) : Math.max(0, this.sink - dt / 1.6);
    this.place(center);
    if (this.body) this.body.position.y -= this.sink * this.sink * 9;
    // A fallen head's neck folds down into the pool (after the mixer pose);
    // its stump stirs as the regrowth nears, and a regrown neck rises straight
    // up out of the water (temple_hydra_neck_core.ts owns every pose).
    this.clock = clock;
    for (let i = 0; i < 3; i++) {
      const h = this.head(i);
      const neck = this.necks[i];
      if (!neck) continue;
      const { pose, regrew } = stepNeck(this.neckMem[i], {
        dead: h?.dead ?? true,
        allDead: dead,
        regrowAfter: HYDRA_TUNING.regrowAfter,
        clock,
        dt,
        phase: i,
      });
      if (regrew) {
        const socket = this.sockets[i];
        if (socket) this.fx.burstAt(socket.getWorldPosition(this.tmp), clock);
      }
      if (!pose) continue;
      neck.scale.setScalar(pose.scale);
      neck.rotation.x += pose.tiltX;
      neck.rotation.z += pose.swayZ;
      if (pose.drop > 0 && neck.parent) {
        // Straight down in the world, in the neck base's parent frame.
        neck.parent.getWorldQuaternion(this.sinkQuat).invert();
        neck.parent.getWorldScale(this.sinkScale);
        this.sinkDir.set(0, -pose.drop, 0).applyQuaternion(this.sinkQuat).divide(this.sinkScale);
        neck.position.add(this.sinkDir);
      }
    }
    this.updateBreaths(dt, clock);
    this.updateSpits(dt);
    this.updateElements(dt, clock);
  }

  /** The element glows at each wielder's mouth, and the Tsunami's wave. */
  private updateElements(dt: number, clock: number): void {
    const deadFlags = [0, 1, 2].map((i) => this.head(i)?.dead ?? true);
    const sockets = [0, 1, 2].map((i) => {
      const socket = this.sockets[i];
      if (!socket || deadFlags[i] || this.sink > 0.4) return null;
      return socket.getWorldPosition(this.socketPos[i]);
    });
    const waveEntity = this.waveId !== null ? this.world?.entities.get(this.waveId) : undefined;
    const wave =
      waveEntity &&
      (waveEntity.templateId === TSUNAMI_TEMPLATES.warn ||
        waveEntity.templateId === TSUNAMI_TEMPLATES.surge)
        ? {
            x: waveEntity.pos.x,
            y: waveEntity.pos.y,
            z: waveEntity.pos.z,
            facing: waveEntity.facing,
            rolling: waveEntity.templateId === TSUNAMI_TEMPLATES.surge,
            build: this.tsunamiBuild(),
          }
        : null;
    this.fx.update(dt, clock, {
      sockets,
      wielders: hydraElementOwners(deadFlags),
      wave,
    });
  }

  /** How far the Tsunami's wall has built, off a submerged head's bar (the
   *  sim keeps every head's bar on the wave's own clock), or null. */
  private tsunamiBuild(): number | null {
    for (let i = 0; i < 3; i++) {
      const h = this.head(i);
      if (h && !h.dead && h.castingAbility === HYDRA_TSUNAMI)
        return tsunamiWarnProgress(h.castRemaining, h.castTotal);
    }
    return null;
  }

  private updateBreaths(dt: number, clock: number): void {
    // A pour whose head died, left the world or sank under the Tsunami is cut
    // at once (it used to keep pouring from a dead head's mouth forever).
    releaseOrphanPours(this.breaths, (id) => this.pourLive(id));
    for (let i = 0; i < 3; i++) {
      const h = this.head(i);
      if (!h || h.dead) continue;
      // Each pour runs in the bar's last half second and a beat past it.
      const cast = h.castingAbility;
      const pour = cast ? POURS[cast] : undefined;
      const firing = pour !== undefined && h.castRemaining < 0.5;
      let slot = this.breaths.find((b) => b.headId === h.id);
      if (firing && cast && (!slot || slot.castId !== cast)) {
        slot = slot ?? this.breaths.find((b) => b.life <= 0);
        if (slot) {
          slot.headId = h.id;
          slot.castId = cast;
          const look = POURS[cast];
          slot.uniforms.uSpread.value = look.spread;
          slot.uniforms.uWidth.value = look.width;
          slot.uniforms.uColA.value.setHex(look.a);
          slot.uniforms.uColB.value.setHex(look.b);
        }
      }
      if (!slot) continue;
      const socket = this.sockets[i];
      if (socket) socket.getWorldPosition(slot.uniforms.uFrom.value);
      const range = POURS[slot.castId]?.range ?? HYDRA_TUNING.breathRange;
      slot.uniforms.uTo.value.set(
        h.pos.x + Math.sin(h.facing) * range,
        h.pos.y + 0.5,
        h.pos.z + Math.cos(h.facing) * range,
      );
      slot.life = firing ? Math.min(1, slot.life + dt * 6) : Math.max(0, slot.life - dt * 1.6);
      if (slot.life <= 0 && !firing) slot.headId = -1;
    }
    for (const b of this.breaths) {
      if (b.headId < 0) b.life = Math.max(0, b.life - dt * 2);
      b.uniforms.uLife.value = b.life;
      (b.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = clock;
      b.mesh.visible = b.life > 0.01;
    }
  }

  /** A pour's head is still one of the three, alive and surfaced. */
  private pourLive(id: number): boolean {
    if (this.sink > 0.4) return false;
    for (let i = 0; i < 3; i++) {
      const h = this.head(i);
      if (h && h.id === id) return !h.dead;
    }
    return false;
  }

  /** Every pour dark at once (the Hydra left view). */
  private quenchBreaths(): void {
    for (const b of this.breaths) {
      b.headId = -1;
      b.life = 0;
      b.uniforms.uLife.value = 0;
      b.mesh.visible = false;
    }
  }

  private updateSpits(dt: number): void {
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const s = this.spits[i];
      s.t += dt / (HYDRA_TUNING.spitWarn * 0.8);
      const t = Math.min(1, s.t);
      s.mesh.position.lerpVectors(s.from, s.to, t);
      s.mesh.position.y += Math.sin(t * Math.PI) * 8;
      s.mesh.scale.setScalar(1 - t * 0.4);
      if (s.t >= 1) {
        s.mesh.removeFromParent();
        this.spits.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.fx.dispose();
    this.body?.removeFromParent();
    for (const b of this.breaths) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    for (const s of this.spits) s.mesh.removeFromParent();
    this.spitGeo.dispose();
    this.spitMat.dispose();
  }
}

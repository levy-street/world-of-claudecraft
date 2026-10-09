// The Sledge Tusker's sledge and body effects (plan: tusker_model_core.ts,
// the delivery's measured facts), composed by SanctumFx (sanctum_fx.ts):
//  - the sledge (its own Blender prop, models/creatures/sledge_tusker_sledge.glb):
//    hitched and hauled behind the beast while it patrols the road, dragged
//    round its turns like a trailer (Haul in step with the beast's Walk),
//    steam rising where it passes on the ice and soulfire burning in its three
//    braziers; left where it was unhitched at the pull (the client latches the
//    beast's pose on its first engaged frame, as the sim does); tipped by the
//    Spilled Braziers (its Tip clip throws the three bowls, each eased onto
//    the soulfire patch the sim lit for it); tipped on the beast's death if it
//    still stood; hitched again after a reset pull;
//  - the beast's clips the sim cannot play: the Unhitch at the pull (and its
//    trace chains' latch), the Charge down the Trample lane, the Roar at the
//    enrage (gestures through the renderer's triggerAttack seam, re-sent so a
//    view rebuilt mid-fight shows the truth);
//  - its weight on the ice: snow and ice chips at every footfall, the paws
//    raking the ice through the Trample's warning, the trumpet's breath, the
//    Tusk Sweep's spray across its front, the charge's wake, the enrage's slam
//    and red breath, the hitch bar dropping, the body crashing down.
//
// Cosmetic only (src/render/CLAUDE.md): nothing here is a telegraph (those are
// sanctum_fx.ts's, on the encounter band). The sledge is a clone of the cached
// GLB built once, under its own root, attached through attachSceneGroupGated
// (its programs link before its first frame); no per-frame allocation in the
// steady state; no light.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  SANCTUM_SOULFIRE_PATCH,
  SLEDGE_TUSKER_ID,
  TUSKER_ENRAGE,
  TUSKER_SPILLED_BRAZIERS,
  TUSKER_TRAMPLE,
  TUSKER_TUNING,
  TUSKER_TUSK_SWEEP,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import { DT, type Entity, type SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { loadGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import {
  TUSKER_CHARGE_GESTURE,
  TUSKER_TRACES_GONE_GESTURE,
  TUSKER_TRACES_ON_GESTURE,
  TUSKER_UNHITCH_GESTURE,
} from '../characters/sanctum_creature_looks';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { setRenderCategory } from '../renderer_diagnostics';
import { enrageBreath, FLAME_HEAT, rgb, SANCTUM_PALETTE } from './sanctum_fx_core';
import type { SanctumFxHost } from './sanctum_fx_host';
import {
  bowlFlight,
  bowlOffsets,
  haulRate,
  modelToWorld,
  nextSledgeState,
  rigidSledge,
  SLEDGE_MODEL,
  SLEDGE_TIP,
  type SledgePose,
  type SledgeState,
  sledgeToWorld,
  sweepClipRate,
  TUSKER_CLIP,
  TUSKER_MODEL,
  type TuskerFoot,
  trailSledge,
  trampleClipRate,
  tuskerFootfallsBetween,
  tuskerFootPoint,
  tuskerGait,
  tuskerModelScale,
  tuskerStride,
} from './tusker_model_core';

/** Either side of a body (walked without allocating). */
const SIDES = [-1, 1] as const;

/** Seconds between re-sends of the trace chains' latched state. */
const LATCH_RESEND = 1;
/** Seconds the bowls keep burning after the spill (the patches' life). */
const BOWLS_BURN = TUSKER_TUNING.patchSeconds + 1.3;

let source: THREE.Object3D | null = null;
let sourceClips: THREE.AnimationClip[] = [];
let loading: Promise<void> | null = null;

function startLoad(): Promise<void> {
  loading ??= loadGltf(SLEDGE_MODEL.url)
    .then((gltf) => {
      source = gltf.scene;
      sourceClips = gltf.animations;
    })
    .catch(() => undefined);
  return loading;
}

// Fetched with the deferred lane at world entry (the Mere Hydra's pattern),
// so the sledge is cached long before the Sledge Road.
if (typeof window !== 'undefined') registerDeferredPreload(() => startLoad());

/** What the effects remember of one Tusker between frames. */
interface Tracker {
  id: number;
  seen: boolean;
  scale: number;
  /** The drawn pose (the view's interpolation, estimated from the ticks). */
  lastX: number;
  lastZ: number;
  tickAge: number;
  x: number;
  z: number;
  facing: number;
  speed: number;
  placed: boolean;
  /** Gait cycles travelled. */
  phase: number;
  dead: boolean;
  deathAt: number;
  inCombat: boolean;
  /** The sledge. */
  state: SledgeState;
  pose: SledgePose;
  /** The spill was seen this pull (the event or a late-joining view). */
  spilled: boolean;
  tipAt: number;
  /** The bowls' offsets onto their patches (sledge space, with the height). */
  bowlOff: { x: number; y: number; z: number }[] | null;
  unhitchAt: number;
  tracesSentAt: number;
  /** The bar the effects already reacted to, its start and the beats fired. */
  bar: string;
  barAt: number;
  beats: number;
  chargeUntil: number;
  chargeYaw: number;
  roarAt: number;
  roarSlammed: boolean;
}

export class TuskerFx {
  readonly ready: Promise<void>;
  private readonly sledgeRoot = new THREE.Group();
  private body: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly bowls: THREE.Object3D[] = [];
  private readonly fires: THREE.Object3D[] = [];
  private readonly skeletons: THREE.Skeleton[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly trackers = new Map<number, Tracker>();
  /** The Tusker the one sledge belongs to (-1: none in view). */
  private owner = -1;
  private readonly feet: TuskerFoot[] = [];
  private readonly patches: { x: number; z: number }[] = [];
  private readonly tmpPt = { x: 0, z: 0 };
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly enrageGlow: THREE.Mesh;
  private readonly enrageMat: THREE.MeshBasicMaterial;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly host: SanctumFxHost,
    private readonly world: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
    glowTexture?: THREE.Texture,
  ) {
    this.sledgeRoot.name = 'sanctum-tusker-sledge';
    setRenderCategory(this.sledgeRoot, 'ui3d');
    // The enrage's breathing red glow, pooled flat on the ice round its feet
    // (built under the host's root: it rides the host's gated attach).
    this.enrageMat = new THREE.MeshBasicMaterial({
      map: glowTexture ?? null,
      color: 0xff3a24,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: 'sanctumTuskerEnrageGlow',
    });
    this.materials.push(this.enrageMat);
    const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.enrageGlow = new THREE.Mesh(glowGeo, this.enrageMat);
    this.enrageGlow.name = 'sanctumTuskerEnrage';
    this.enrageGlow.visible = false;
    this.enrageGlow.renderOrder = floorVfxRenderOrder('encounter', 1);
    host.root.add(this.enrageGlow);
    this.ready = startLoad()
      .then(async () => {
        if (this.disposed || !source) return;
        this.build(source, sourceClips);
        await attachSceneGroupGated(scene, this.sledgeRoot, compileGate, () => this.disposed);
      })
      .catch(() => {});
  }

  private build(src: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    const body = cloneSkinned(src);
    body.name = 'sanctumSledge';
    const shadows = this.host.density >= 1;
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = false;
      if (mesh.isSkinnedMesh) this.skeletons.push(mesh.skeleton);
    });
    for (let i = 1; i <= 3; i++) {
      const bowl = body.getObjectByName(`Brazier${i}`);
      const fire = body.getObjectByName(`BrazierFire${i}`);
      if (bowl) this.bowls.push(bowl);
      if (fire) this.fires.push(fire);
    }
    // Hidden until a Tusker is in view (the gate links hidden children too).
    body.visible = false;
    this.sledgeRoot.add(body);
    this.body = body;
    const mixer = new THREE.AnimationMixer(body);
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      if (clip.name === 'Tip') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    this.mixer = mixer;
    this.play('Idle');
  }

  private play(name: string, rate = 1, fade = 0.35): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = rate;
    if (next === this.current) return;
    next
      .reset()
      .setEffectiveWeight(1)
      .fadeIn(this.current ? fade : 0)
      .play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  private tracker(e: Entity): Tracker {
    let t = this.trackers.get(e.id);
    if (!t) {
      t = {
        id: e.id,
        seen: true,
        scale: e.scale || 1,
        lastX: e.pos.x,
        lastZ: e.pos.z,
        tickAge: 0,
        x: e.pos.x,
        z: e.pos.z,
        facing: e.facing,
        speed: 0,
        placed: false,
        phase: 0,
        dead: e.dead,
        deathAt: -1e9,
        inCombat: e.inCombat,
        state: 'hitched',
        pose: { x: 0, z: 0, yaw: 0 },
        spilled: false,
        tipAt: -1e9,
        bowlOff: null,
        unhitchAt: -1e9,
        tracesSentAt: -1e9,
        bar: '',
        barAt: 0,
        beats: 0,
        chargeUntil: -1,
        chargeYaw: 0,
        roarAt: -1e9,
        roarSlammed: true,
      };
      rigidSledge(e.pos, e.facing, t.scale, t.pose);
      this.trackers.set(e.id, t);
    }
    return t;
  }

  // ------------------------------------------------------------------ events

  /** The Tusker's own spellfx. True when drawn here (the renderer then skips
   *  its generic nova or windup). */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    if (src.templateId !== SLEDGE_TUSKER_ID) return false;
    const t = this.tracker(src);
    switch (ev.ability) {
      case TUSKER_TUSK_SWEEP:
        this.sweepSpray(t);
        if (!this.host.reducedMotion()) this.host.shake(0.3);
        return true;
      case TUSKER_TRAMPLE:
        // The windup at the bar's start is the lane's paint (no swing); the
        // nova at its end launches the charge.
        if (ev.fx === 'nova') this.launchCharge(src, t);
        return true;
      case TUSKER_SPILLED_BRAZIERS:
        t.spilled = true;
        this.tip(t);
        return true;
      case TUSKER_ENRAGE:
        this.playGesture?.(src.id, TUSKER_ENRAGE);
        t.roarAt = this.clock;
        t.roarSlammed = false;
        this.breath(t, 1.6);
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------- scans

  beginScan(): void {
    for (const t of this.trackers.values()) t.seen = false;
  }

  /** One Tusker seen by the scan (its live state is read every frame). */
  scanTusker(e: Entity): void {
    if (e.templateId !== SLEDGE_TUSKER_ID) return;
    const t = this.tracker(e);
    t.seen = true;
    if (this.owner < 0 || !this.trackers.has(this.owner)) this.owner = e.id;
  }

  /** A soulfire patch seen by the scan (the bowls land on these). */
  notePatch(o: Entity): void {
    if (o.templateId !== SANCTUM_SOULFIRE_PATCH || this.patches.length >= 8) return;
    this.patches.push({ x: o.pos.x, z: o.pos.z });
  }

  endScan(): void {
    for (const [id, t] of this.trackers) {
      if (t.seen) continue;
      this.trackers.delete(id);
      if (this.owner === id) this.owner = -1;
    }
    if (this.owner < 0) {
      const next = this.trackers.keys().next();
      if (!next.done) this.owner = next.value;
    }
  }

  /** Clear the patch list before a scan collects it again. */
  clearPatches(): void {
    this.patches.length = 0;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    if (this.disposed) return;
    this.clock = clock;
    let enrageShown = false;
    for (const t of this.trackers.values()) {
      const e = this.world.entities.get(t.id);
      if (!e) continue;
      this.follow(t, e, dt);
      this.stepState(t, e);
      this.stepBars(t, e);
      this.stepFootfalls(t, e, dt);
      this.stepCharge(t, dt);
      this.stepRoar(t, e);
      this.stepDeath(t, e);
      if (!e.dead && hasAura(e, TUSKER_ENRAGE)) {
        this.paintEnrage(t, dt);
        enrageShown = true;
      }
    }
    if (!enrageShown && this.enrageGlow.visible) this.enrageGlow.visible = false;
    this.paintSledge(dt);
  }

  /** The drawn pose: the view interpolates prevPos to pos over a tick; the
   *  tick's arrival is seen as pos changing. */
  private follow(t: Tracker, e: Entity, dt: number): void {
    t.scale = e.scale || 1;
    if (e.pos.x !== t.lastX || e.pos.z !== t.lastZ) {
      t.lastX = e.pos.x;
      t.lastZ = e.pos.z;
      t.tickAge = 0;
    } else {
      t.tickAge += dt;
    }
    const a = Math.min(1, t.tickAge / DT);
    const nx = e.prevPos.x + (e.pos.x - e.prevPos.x) * a;
    const nz = e.prevPos.z + (e.pos.z - e.prevPos.z) * a;
    const df = wrapAngle(e.facing - e.prevFacing);
    const facing = e.prevFacing + df * a;
    if (!t.placed) {
      t.x = nx;
      t.z = nz;
      t.facing = facing;
      t.speed = 0;
      t.placed = true;
      rigidSledge({ x: nx, z: nz }, facing, t.scale, t.pose);
    }
    const moved = Math.hypot(nx - t.x, nz - t.z);
    // A teleport (a reset pull's leash, a dev move) re-hangs the sledge: no
    // gait carries a body this far in one frame.
    if (moved > Math.max(3, 40 * dt)) {
      t.x = nx;
      t.z = nz;
      t.facing = facing;
      t.speed = 0;
      if (t.state === 'hitched') rigidSledge({ x: nx, z: nz }, facing, t.scale, t.pose);
      return;
    }
    const v = dt > 0 ? moved / dt : 0;
    t.speed += (v - t.speed) * Math.min(1, dt * 6);
    t.x = nx;
    t.z = nz;
    t.facing = facing;
    if (t.state === 'hitched') trailSledge(t.pose, t, t.facing, t.scale, dt);
  }

  private stepState(t: Tracker, e: Entity): void {
    const share = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    const was = t.state;
    const next = nextSledgeState(
      was,
      { dead: e.dead, inCombat: e.inCombat, hpShare: share },
      t.spilled,
    );
    if (next !== was) {
      t.state = next;
      if (next === 'hitched') {
        // A reset pull: the beast is back on its road and the sledge with it.
        t.spilled = false;
        t.bowlOff = null;
        t.tipAt = -1e9;
        const gy = this.host.groundY(t.pose.x, t.pose.z);
        this.host.puff(t.pose.x, gy + 0.5, t.pose.z, 18, snowPuff(2.6, 3));
        rigidSledge(t, t.facing, t.scale, t.pose);
        this.playGesture?.(t.id, TUSKER_TRACES_ON_GESTURE);
        if (t.id === this.owner) this.play('Idle', 1, 0);
      } else if (was === 'hitched') {
        // The pull (or a view joining a fight already under way).
        if (!e.dead && e.inCombat && share > TUSKER_TUNING.spillAtHpPct + 0.05) {
          t.unhitchAt = this.clock;
          this.playGesture?.(t.id, TUSKER_UNHITCH_GESTURE);
        } else {
          t.unhitchAt = this.clock - TUSKER_CLIP.unhitch - 1;
        }
        t.tracesSentAt = this.clock;
        // A view joining a fight already past half health: tipped long ago.
        if (next === 'tipped') this.tip(t, false);
      } else if (next === 'tipped' && was === 'dropped') {
        // The health crossing (the spill's event may land a frame later) or
        // its death with the sledge still standing.
        this.tip(t, true);
      }
    }
    // The trace chains stay gone for as long as the sledge is off the hook.
    if (
      t.state !== 'hitched' &&
      this.clock - t.unhitchAt > TUSKER_CLIP.unhitch + 0.3 &&
      this.clock - t.tracesSentAt >= LATCH_RESEND
    ) {
      t.tracesSentAt = this.clock;
      this.playGesture?.(t.id, TUSKER_TRACES_GONE_GESTURE);
    }
    // The hitch bar hits the ice behind it.
    const sinceUnhitch = this.clock - t.unhitchAt;
    if (sinceUnhitch >= TUSKER_CLIP.unhitchBar && sinceUnhitch - TUSKER_CLIP.unhitchBar < 0.06) {
      const ring = sledgeToWorld(t.pose, 0, SLEDGE_MODEL.front, this.tmpPt);
      const gy = this.host.groundY(ring.x, ring.z);
      this.host.puff(ring.x, gy + 0.3, ring.z, 16, snowPuff(2.2, 2.4));
      this.host.shards.burst(ring.x, gy + 0.2, ring.z, 5, {
        speed: 3,
        up: 3,
        size: [0.15, 0.35],
        radius: 1,
      });
    }
  }

  /** Tip the sledge (the spill, a late view past half health, its death). */
  private tip(t: Tracker, animate = true): void {
    // Already tipping this pull (the health crossing and the spill's event
    // arrive in either order): one Tip.
    if (t.state === 'tipped' && t.tipAt > -1e8) return;
    t.state = 'tipped';
    t.tipAt = animate ? this.clock : this.clock - SLEDGE_TIP.length;
    t.bowlOff = null;
    if (t.id === this.owner) {
      const tip = this.actions.get('Tip');
      if (tip) {
        tip.reset();
        tip.time = animate ? 0 : tip.getClip().duration;
        tip.setEffectiveWeight(1).play();
        if (this.current && this.current !== tip) this.current.fadeOut(0.15);
        this.current = tip;
      }
    }
  }

  private stepBars(t: Tracker, e: Entity): void {
    const bar = e.dead ? null : e.castingAbility;
    const key = bar === TUSKER_TUSK_SWEEP || bar === TUSKER_TRAMPLE ? bar : '';
    if (key !== t.bar) {
      t.bar = key;
      t.barAt = this.clock;
      t.beats = 0;
    }
    if (!key) return;
    const elapsed = Math.max(0, (e.castTotal || 0) - (e.castRemaining || 0));
    const k = tuskerModelScale(t.scale);
    if (key === TUSKER_TRAMPLE) {
      // The forefoot rakes the ice twice, then the trumpet's breath.
      const clipT = elapsed * trampleClipRate();
      const paws = TUSKER_CLIP.paws;
      while (t.beats < paws.length && clipT >= paws[t.beats]) {
        const foot = tuskerFootPoint('rightFore');
        const p = modelToWorld(t, t.facing, k, foot.x, foot.z + 0.6, this.tmpPt);
        const gy = this.host.groundY(p.x, p.z);
        this.host.puff(p.x, gy + 0.2, p.z, 12, snowPuff(2.4, 1.6));
        this.host.shards.burst(p.x, gy + 0.1, p.z, 4, {
          speed: 3.5,
          up: 4,
          size: [0.12, 0.3],
          heading: t.facing + Math.PI,
          spread: 0.7,
        });
        t.beats++;
      }
      if (t.beats === paws.length && clipT >= TUSKER_CLIP.trumpet) {
        this.breath(t, 1.2);
        t.beats++;
      }
    } else if (t.beats === 0 && elapsed * sweepClipRate() >= TUSKER_CLIP.sweepWindup) {
      // The wind-up: its weight comes down on its right foot.
      const foot = tuskerFootPoint('rightFore');
      const p = modelToWorld(t, t.facing, k, foot.x, foot.z, this.tmpPt);
      this.host.puff(p.x, this.host.groundY(p.x, p.z) + 0.2, p.z, 8, snowPuff(1.8, 1.4));
      t.beats = 1;
    }
  }

  /** The Tusk Sweep lands: spray and ice chips flung across the whole front,
   *  right to left, out to the cone's edge. */
  private sweepSpray(t: Tracker): void {
    const k = tuskerModelScale(t.scale);
    const reach = (TUSKER_TUNING.sweepRange + 3.5) * 0.8;
    const half = (TUSKER_TUNING.sweepArcDeg * Math.PI) / 360;
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      // Right (-x) to left (+x) of the beast.
      const a = t.facing - half + (2 * half * i) / steps;
      const r = TUSKER_MODEL.tuskTip.z * 0.6 * k;
      const x = t.x + Math.sin(a) * r;
      const z = t.z + Math.cos(a) * r;
      const gy = this.host.groundY(x, z);
      this.host.puff(x, gy + 0.4, z, 5, {
        ...snowPuff(5, 2.6),
        dir: [Math.sin(a) * 0.9, 0.35, Math.cos(a) * 0.9],
        spread: 0.45,
      });
      if (i % 2 === 0)
        this.host.shards.burst(x, gy + 0.3, z, 3, {
          speed: 9,
          up: 5,
          size: [0.18, 0.45],
          heading: a,
          spread: 0.3,
        });
    }
    // The tips' arc of frost glitter across the front.
    const tip = modelToWorld(t, t.facing, k, 0, reach / k, this.tmpPt);
    this.host.puff(tip.x, this.host.groundY(tip.x, tip.z) + 1.2, tip.z, 22, {
      speed: 4,
      up: 1.5,
      life: 0.9,
      size: [0.3, 0.08],
      color: rgb(SANCTUM_PALETTE.rime),
      alpha: 0.9,
      pool: 'glow',
      radius: reach * 0.6,
    });
  }

  /** The Trample's bar ran out: the charge down the lane. */
  private launchCharge(src: Entity, t: Tracker): void {
    this.playGesture?.(src.id, TUSKER_CHARGE_GESTURE);
    t.chargeUntil = this.clock + TUSKER_TUNING.trampleRun + 0.15;
    t.chargeYaw = src.facing;
    const k = tuskerModelScale(t.scale);
    const front = modelToWorld(t, t.facing, k, 0, TUSKER_MODEL.trunkTip.z, this.tmpPt);
    const gy = this.host.groundY(front.x, front.z);
    this.host.shockRing(front.x, front.z, SANCTUM_PALETTE.rime, 6, 0.55);
    this.host.puff(front.x, gy + 0.6, front.z, 26, snowPuff(5, 3.2));
    if (!this.host.reducedMotion()) this.host.shake(0.45);
  }

  private stepCharge(t: Tracker, dt: number): void {
    if (this.clock > t.chargeUntil) return;
    const k = tuskerModelScale(t.scale);
    const rate = dt * 60 * this.host.density;
    // The wake: snow thrown out to both sides and the ice chewed up behind.
    for (const side of SIDES) {
      if (this.host.rand() > rate * 0.5) continue;
      const p = modelToWorld(t, t.chargeYaw, k, side * 2.2, 1.5, this.tmpPt);
      const gy = this.host.groundY(p.x, p.z);
      const a = t.chargeYaw + side * (Math.PI / 2);
      this.host.puff(p.x, gy + 0.3, p.z, 3, {
        ...snowPuff(4.5, 2.8),
        dir: [Math.sin(a) * 0.8, 0.5, Math.cos(a) * 0.8],
        spread: 0.5,
      });
      if (this.host.rand() < 0.35)
        this.host.shards.burst(p.x, gy + 0.2, p.z, 1, {
          speed: 7,
          up: 4,
          size: [0.15, 0.4],
          heading: a,
          spread: 0.5,
        });
    }
    if (this.host.rand() < rate * 0.4) {
      const p = modelToWorld(t, t.chargeYaw, k, 0, -TUSKER_MODEL.tailBack, this.tmpPt);
      this.host.puff(p.x, this.host.groundY(p.x, p.z) + 0.4, p.z, 3, snowPuff(1.2, 3.4));
    }
  }

  private stepRoar(t: Tracker, e: Entity): void {
    if (t.roarSlammed || this.clock - t.roarAt < TUSKER_CLIP.roarSlam) return;
    t.roarSlammed = true;
    if (e.dead) return;
    const k = tuskerModelScale(t.scale);
    for (const foot of ['leftFore', 'rightFore'] as const) {
      const fp = tuskerFootPoint(foot);
      const p = modelToWorld(t, t.facing, k, fp.x, fp.z, this.tmpPt);
      const gy = this.host.groundY(p.x, p.z);
      this.host.puff(p.x, gy + 0.3, p.z, 16, snowPuff(4, 2.6));
      this.host.shards.burst(p.x, gy + 0.2, p.z, 5, { speed: 6, up: 6, size: [0.2, 0.5] });
    }
    this.host.shockRing(t.x, t.z, 0xff5a3a, 9, 0.7);
    if (!this.host.reducedMotion()) this.host.shake(0.55);
  }

  private stepDeath(t: Tracker, e: Entity): void {
    if (e.dead && !t.dead) t.deathAt = this.clock;
    t.dead = e.dead;
    if (!e.dead) return;
    const since = this.clock - t.deathAt;
    const k = tuskerModelScale(t.scale);
    const fire = (at: number, n: number, shake: number): void => {
      if (since < at || since - at > 0.06) return;
      // It falls on its left side (+x in model space).
      for (const along of [-3, 0, 3]) {
        const p = modelToWorld(t, t.facing, k, TUSKER_MODEL.deathRollLeft + 1.5, along, this.tmpPt);
        const gy = this.host.groundY(p.x, p.z);
        this.host.puff(p.x, gy + 0.4, p.z, n, snowPuff(4, 3.4));
        this.host.shards.burst(p.x, gy + 0.2, p.z, 3, { speed: 5, up: 5, size: [0.2, 0.5] });
      }
      if (shake > 0 && !this.host.reducedMotion()) this.host.shake(shake);
    };
    fire(TUSKER_CLIP.deathBody, 14, 0.5);
    fire(TUSKER_CLIP.deathHead, 6, 0);
  }

  private stepFootfalls(t: Tracker, e: Entity, dt: number): void {
    if (e.dead) return;
    const gait = this.clock <= t.chargeUntil ? 'run' : tuskerGait(t.speed, t.scale);
    const stride = tuskerStride(gait, t.scale);
    if (t.speed < 0.3 || stride <= 0) return;
    const before = t.phase;
    t.phase += (t.speed * dt) / stride;
    const n = tuskerFootfallsBetween(gait, before, t.phase, this.feet);
    if (n === 0) return;
    const k = tuskerModelScale(t.scale);
    const heavy = gait === 'run';
    for (const foot of this.feet) {
      const fp = tuskerFootPoint(foot);
      const p = modelToWorld(t, t.facing, k, fp.x, fp.z, this.tmpPt);
      const gy = this.host.groundY(p.x, p.z);
      this.host.puff(
        p.x,
        gy + 0.15,
        p.z,
        heavy ? 9 : 5,
        snowPuff(heavy ? 2.6 : 1.4, heavy ? 2 : 1.4),
      );
      if (heavy && this.host.rand() < 0.5)
        this.host.shards.burst(p.x, gy + 0.1, p.z, 2, { speed: 3, up: 3, size: [0.1, 0.25] });
    }
  }

  /** Steam snorted from the trunk (the trumpet, the roar). */
  private breath(t: Tracker, strength: number): void {
    const k = tuskerModelScale(t.scale);
    const tip = TUSKER_MODEL.trunkTip;
    const p = modelToWorld(t, t.facing, k, tip.x, tip.z + 0.8, this.tmpPt);
    const y = this.host.groundY(p.x, p.z) + tip.y * k + 0.6;
    this.host.puff(p.x, y, p.z, Math.round(10 * strength), {
      speed: 2.6 * strength,
      up: 0.8,
      life: 1.6,
      size: [0.5, 2.6],
      color: [0.9, 0.94, 0.98],
      alpha: 0.45,
      dir: [Math.sin(t.facing), 0.25, Math.cos(t.facing)],
      spread: 0.35,
      drag: 1.6,
    });
  }

  private paintEnrage(t: Tracker, dt: number): void {
    const k = tuskerModelScale(t.scale);
    const b = enrageBreath(this.clock);
    const g = this.enrageGlow;
    g.visible = true;
    g.position.set(t.x, this.host.groundY(t.x, t.z) + 0.25, t.z);
    g.rotation.y = t.facing;
    g.scale.set(TUSKER_MODEL.halfWidth * 5.5 * k * b, 1, (TUSKER_MODEL.tailBack + 9) * 1.9 * k * b);
    this.enrageMat.opacity = 0.55 + 0.25 * b;
    if (this.host.rand() < dt * 16 * this.host.density) {
      // Red steam and embers off its hump.
      const p = modelToWorld(t, t.facing, k, 0, 0.5, this.tmpPt);
      const y = this.host.groundY(p.x, p.z) + TUSKER_MODEL.headTop * k * 0.9;
      this.host.puff(p.x, y, p.z, 2, {
        speed: 1,
        up: 2.4,
        life: 1.8,
        size: [1.4, 4],
        color: [0.82, 0.3, 0.24],
        alpha: 0.3,
        radius: 2.2 * k,
      });
      this.host.puff(p.x, y - 1, p.z, 3, {
        speed: 1.5,
        up: 3.2,
        life: 1.3,
        size: [0.26, 0.08],
        color: [1, 0.45, 0.2],
        alpha: 1,
        radius: 2.6 * k,
        pool: 'glow',
      });
    }
  }

  // ------------------------------------------------------------------- sledge

  private paintSledge(dt: number): void {
    const body = this.body;
    const mixer = this.mixer;
    if (!body || !mixer) return;
    const t = this.owner >= 0 ? this.trackers.get(this.owner) : undefined;
    if (!t?.placed) {
      if (body.visible) body.visible = false;
      return;
    }
    body.visible = true;
    const pose = t.pose;
    const gy = this.host.groundY(pose.x, pose.z);
    body.position.set(pose.x, gy, pose.z);
    // Its runners follow the road's slope under it.
    const f = sledgeToWorld(pose, 0, SLEDGE_MODEL.front - 0.5, this.tmpPt);
    const hf = this.host.groundY(f.x, f.z);
    const r = sledgeToWorld(pose, 0, -SLEDGE_MODEL.back + 0.3, this.tmpPt);
    const hb = this.host.groundY(r.x, r.z);
    // Never stood on end by a ledge under one end (a road edge, a step): a
    // runner rides the higher floor and the bed tips at most a quarter turn
    // of a right angle.
    const pitch = Math.max(
      -0.35,
      Math.min(0.35, Math.atan2(hb - hf, SLEDGE_MODEL.front + SLEDGE_MODEL.back - 0.8)),
    );
    body.position.y = Math.max(gy, (hf + hb) / 2 - 0.4);
    body.rotation.set(pitch, pose.yaw, 0, 'YXZ');
    // Its clip.
    if (t.state === 'hitched') {
      const rate = haulRate(t.speed, t.scale);
      if (rate > 0) this.play('Haul', rate);
      else this.play('Idle');
    } else if (t.state === 'dropped') {
      this.play('Idle');
    }
    mixer.update(dt);
    if (t.state === 'tipped') this.landBowls(t, gy);
    body.updateMatrixWorld(true);
    this.burnBraziers(t, dt);
    if (t.state === 'hitched' && t.speed > 0.5) this.steamTrail(t, dt);
  }

  /** Ease each thrown bowl onto its patch (the offsets are measured once the
   *  patches are in view), and fire the landings. */
  private landBowls(t: Tracker, sledgeY: number): void {
    const tipTime = this.clock - t.tipAt;
    if (!t.bowlOff && this.patches.length > 0) {
      const off = bowlOffsets(t.pose, this.patches);
      t.bowlOff = off.map((o, i) => {
        const rest = SLEDGE_TIP.bowlRest[i];
        const w = sledgeToWorld(t.pose, rest.x + o.x, rest.z + o.z, this.tmpPt);
        return { x: o.x, y: this.host.groundY(w.x, w.z) - sledgeY, z: o.z };
      });
    }
    for (let i = 0; i < this.bowls.length; i++) {
      const bowl = this.bowls[i];
      const land = SLEDGE_TIP.bowlsLand[i] ?? SLEDGE_TIP.over;
      const off = t.bowlOff?.[i];
      if (off) {
        const k = bowlFlight(tipTime, i);
        // The offset is in sledge space: carry it into the bowl's parent.
        this.tmpV.set(off.x * k, off.y * k, off.z * k);
        localQuaternion(bowl.parent, this.body, this.tmpQ, this.tmpQ2);
        this.tmpV.applyQuaternion(this.tmpQ.invert());
        bowl.position.add(this.tmpV);
      }
      if (tipTime >= land && tipTime - land < 0.05) {
        const rest = SLEDGE_TIP.bowlRest[i];
        const w = sledgeToWorld(t.pose, rest.x + (off?.x ?? 0), rest.z + (off?.z ?? 0), this.tmpPt);
        const gy = this.host.groundY(w.x, w.z);
        this.host.shockRing(w.x, w.z, SANCTUM_PALETTE.soulGreen, 4.4, 0.6);
        this.host.puff(w.x, gy + 0.4, w.z, 22, {
          speed: 3.6,
          up: 2.5,
          life: 1.1,
          size: [1.4, 0.4],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          radius: 1.2,
        });
        this.host.puff(w.x, gy + 0.3, w.z, 10, {
          speed: 2.4,
          up: 1.6,
          life: 1.8,
          size: [1, 3],
          color: [0.85, 0.9, 0.95],
          alpha: 0.4,
          drag: 1.4,
        });
        if (i === 0 && !this.host.reducedMotion()) this.host.shake(0.25);
      }
    }
  }

  /** Soulfire licking up from the three braziers (and green-violet embers),
   *  heat steam over them. Spilled, the bowls burn on for the patches' life
   *  and then smoulder. */
  private burnBraziers(t: Tracker, dt: number): void {
    const spent = t.state === 'tipped' && this.clock - t.tipAt > BOWLS_BURN;
    const rate = dt * this.host.density * (spent ? 1.5 : 9);
    for (const fire of this.fires) {
      if (this.host.rand() > rate) continue;
      fire.getWorldPosition(this.tmpV);
      if (!spent)
        this.host.puff(this.tmpV.x, this.tmpV.y - 0.2, this.tmpV.z, 1, {
          speed: 0.25,
          up: 1.1,
          life: 0.75,
          size: [1.15, 0.45],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          radius: 0.35,
        });
      if (this.host.rand() < 0.4)
        this.host.puff(this.tmpV.x, this.tmpV.y + 0.4, this.tmpV.z, 1, {
          speed: 0.5,
          up: 2.2,
          life: 1.4,
          size: [0.14, 0.05],
          color: rgb(spent ? 0xff8a50 : SANCTUM_PALETTE.soulGreen),
          alpha: 1,
          pool: 'glow',
          radius: 0.5,
        });
      if (this.host.rand() < 0.3)
        this.host.puff(this.tmpV.x, this.tmpV.y + 0.8, this.tmpV.z, 1, {
          speed: 0.3,
          up: 1.2,
          life: 2.4,
          size: [0.6, 2.2],
          color: [0.82, 0.84, 0.88],
          alpha: spent ? 0.35 : 0.22,
          drag: 1.2,
        });
    }
  }

  /** Where the sledge passes on the ice, the ice steams. */
  private steamTrail(t: Tracker, dt: number): void {
    if (this.host.rand() > dt * 10 * this.host.density) return;
    const side = this.host.rand() < 0.5 ? -1 : 1;
    const p = sledgeToWorld(
      t.pose,
      side * (SLEDGE_MODEL.halfWidth - 0.2),
      -SLEDGE_MODEL.back + this.host.rand() * 2,
      this.tmpPt,
    );
    this.host.puff(p.x, this.host.groundY(p.x, p.z) + 0.15, p.z, 1, {
      speed: 0.3,
      up: 0.9,
      life: 2.6,
      size: [0.8, 2.6],
      color: [0.9, 0.93, 0.96],
      alpha: 0.3,
      drag: 1.4,
    });
  }

  hideAll(): void {
    if (this.body) this.body.visible = false;
    this.enrageGlow.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sledgeRoot.removeFromParent();
    this.mixer?.stopAllAction();
    if (this.body) this.mixer?.uncacheRoot(this.body);
    for (const s of this.skeletons) s.dispose();
    for (const m of this.materials) m.dispose();
    this.enrageGlow.geometry.dispose();
  }
}

/** Powder snow thrown up off the ice. */
function snowPuff(
  speed: number,
  size: number,
): {
  speed: number;
  up: number;
  life: number;
  size: readonly [number, number];
  color: readonly [number, number, number];
  alpha: number;
  drag: number;
} {
  return {
    speed,
    up: speed * 0.45,
    life: 1.3,
    size: [size * 0.45, size],
    color: [0.88, 0.93, 0.98],
    alpha: 0.6,
    drag: 2.2,
  };
}

/** The rotation of `node` relative to `root` (the product of the quaternions
 *  between them). Writes `out`. */
function localQuaternion(
  node: THREE.Object3D | null,
  root: THREE.Object3D | null,
  out: THREE.Quaternion,
  tmp: THREE.Quaternion,
): THREE.Quaternion {
  out.identity();
  let n = node;
  while (n && n !== root) {
    tmp.copy(n.quaternion);
    out.premultiply(tmp);
    n = n.parent;
  }
  return out;
}

function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Does the entity carry the aura (a loop: no per-frame closure). */
function hasAura(e: { auras?: readonly { id: string }[] }, id: string): boolean {
  const auras = e.auras;
  if (!auras) return false;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}

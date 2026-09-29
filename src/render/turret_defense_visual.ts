// Fire and Fly on screen: the private monsters' rigs with their stand-ins,
// health bars and strike rings, the dust they kick up wherever they meet the
// world (turret_contact_dust_core.ts, launched on the cannon's own puff draw),
// their hitstop and scorch flash when a shell strikes them, the cannon tower
// whose head turns toward the aim (turret_tower_visual.ts) with the player
// standing behind its breech, plus the cannon's shots (cannon_shell_visuals.ts,
// their muzzle and recoil on the tower's barrel), driven from
// IWorld.turretSession. Nothing is built until the player
// is first seen seated in the turret; the rig pools then grow one rig per frame
// for the current and next wave, and one per idle slot for the others, and live
// for the rest of the world session. Every rig attaches behind the compile gate while a capsule on a
// prewarmed material stands in at the monster's exact position: enemy positions
// are never hidden. An unused rig leaves the scene graph. No lights, no shadows,
// no per-frame THREE allocation. A rig's scorch flash swaps its materials only
// once their programs link behind the same compile gate (the rig keeps its own
// materials meanwhile). A health bar and a strike ring are what a player acts
// on: they paint over the cannon's dust (a higher rung of the floor ladder than
// the puff draw) and the bar faces the camera upright over the body, whatever
// its tumble. Every living monster also carries a red ground marker, drawn by
// turret_ground_markers.ts, and the explosive barrels are
// turret_barrel_visual.ts. Pure halves: turret_monster_pose_core.ts,
// turret_motion_forecast_core.ts, turret_contact_dust_core.ts,
// turret_defense_pool_core.ts and turret_tower_core.ts.
import * as THREE from 'three';
import { TURRET_PHYSICS, TURRET_WEAPON } from '../sim/content/turret_defense';
import { MOBS } from '../sim/data';
import type { ThrowProbe } from '../sim/minigames/thrown_body';
import type { TurretFeedback } from '../sim/minigames/turret_feedback';
import { DT, type Entity } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { timeBuildSpan } from './build_spans';
import { type CannonShellHost, CannonShellVisuals } from './cannon_shell_visuals';
import { type AnimState, CharacterVisual } from './characters';
import { charactersReady } from './characters/assets';
import { VISUALS, visualKeyFor } from './characters/manifest';
import type { FarBakeGate } from './characters/visual';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { type IdleScheduler, idleSlot } from './idle_queue';
import { GAIT_RUN_ENTER } from './locomotion';
import {
  TURRET_BARREL_BURSTS,
  TURRET_BARREL_IMPACTS,
  type TurretBarrelSource,
  TurretBarrelVisual,
  turretBarrelBlast,
} from './turret_barrel_visual';
import {
  newTurretContact,
  TURRET_CONTACT_BURSTS,
  TURRET_CONTACT_PUFFS,
  type TurretContactCounts,
  type TurretContactKind,
  turretContactBurstInto,
  turretContactCounts,
  turretContactLag,
  turretSlideTrailInto,
} from './turret_contact_dust_core';
import {
  nextTurretRig,
  TurretFeedbackCursor,
  TurretSlotBook,
  turretBodyCapacity,
  turretBuildOrder,
  turretRigCapacities,
  turretUrgentTemplates,
} from './turret_defense_pool_core';
import { TurretMarkerGround } from './turret_ground_marker_core';
import { TURRET_MARKER_ORDER, TurretGroundMarkers } from './turret_ground_markers';
import {
  newTurretMonsterPose,
  TurretAttitude,
  TurretDisplayClock,
  turretMonsterPoseInto,
  turretPivotHeight,
} from './turret_monster_pose_core';
import { TurretMotionForecast } from './turret_motion_forecast_core';
import {
  TURRET_BARREL,
  TURRET_TOWER_MODEL,
  turretBarrelPitch,
  turretGunnerInto,
} from './turret_tower_core';
import { type TurretTowerSource, TurretTowerVisual } from './turret_tower_visual';
import { ViewCreateRetryGate } from './view_create_retry';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;
type TurretPlanView = TurretSessionView['defense']['plan'];
type TurretDefenseView = TurretSessionView['defense'];

/**
 * The seated player's own view: its facing, already turned toward the aim, is
 * where the head turns; it is drawn standing behind the breech on the head's yaw.
 */
export interface TurretSelfView {
  readonly group: Pick<THREE.Object3D, 'position' | 'rotation'>;
}

interface RigSlot {
  readonly actor: CharacterVisual;
  /** Visibility owned by the compile gate: false until the rig's programs link. */
  readonly gate: THREE.Group;
  /** Pivot position and attitude. */
  readonly root: THREE.Group;
  /** Yaw, template scale and the offset from the pivot down to the feet. */
  readonly body: THREE.Group;
  /** World height of the scaled rig. */
  readonly height: number;
  /** The rig has its own airborne clip (a jump or fall pose). */
  readonly airClip: boolean;
  used: boolean;
}

interface BodySlot {
  owner: number | null;
  readonly attitude: TurretAttitude;
  readonly forecast: TurretMotionForecast;
  readonly slope: TurretMarkerGround;
  readonly standIn: THREE.Mesh;
  readonly health: THREE.Mesh;
  readonly ring: THREE.Mesh;
  used: boolean;
}

const HEALTH_BAR_WIDTH = 1.2;
/** Yards over the body's reach from its pivot (half its height, in any attitude). */
const HEALTH_BAR_LIFT = 0.35;
const RING_LIFT = 0.08;
/** A corpse sinks at least this far (yd), so a short body still leaves the ground. */
const SINK_DEPTH = 1.1;
/** Without the barrel (the tower still loading), the muzzle sits this high over the
 *  seated feet and this far toward the shot (turret_defense_sfx.ts plays the report there). */
const MUZZLE_LIFT = 2.2;
const MUZZLE_REACH = 2;
/** A shot entry older than this many ticks at its first read (a seat seen late) draws nothing. */
const SHOT_STALE_TICKS = 10;
/** The renderer's view retry: a failed rig or tower load (a streamed GLB still arriving) is tried again after it. */
const RIG_RETRY_MS = 2000;
/** The retry gate keys (entity, slot): the pool is one entity, each template a slot. */
const POOL = 0;
/** A later wave's rig waits for an idle slot, on the renderer's idle prewarm terms. */
const RIG_IDLE_TIMEOUT_MS = 250;
const RIG_IDLE_DEFERRALS = 2;
/** A hit at least this close to the blast's full strength is a core hit: the rig freezes on it. */
const CORE_HIT_FALLOFF = 0.999;
/** The core hit's hitstop: the rig's clip at this speed for this long (s). */
const HITSTOP_SCALE = 0.05;
const HITSTOP_SECONDS = 0.12;
/** The scorch a blast leaves on a body, by its falloff: from a graze to a core hit. */
const FLASH_MIN = 0.35;
const FLASH_GAIN = 0.55;

export class TurretDefenseVisual {
  readonly group = new THREE.Group();
  private readonly rigsRoot = new THREE.Group();
  private readonly markersRoot = new THREE.Group();
  private readonly book = new TurretSlotBook();
  private readonly rigs: RigSlot[] = [];
  private readonly bodies: BodySlot[] = [];
  private readonly built = new Map<string, number>();
  private readonly retry = new ViewCreateRetryGate(RIG_RETRY_MS);
  private readonly coolingDown = {
    has: (templateId: string): boolean => !this.retry.canAttempt(POOL, templateId, this.nowMs),
  };
  private readonly clock = new TurretDisplayClock();
  private readonly cursor = new TurretFeedbackCursor();
  private readonly weapon: CannonShellVisuals;
  private readonly barrels: TurretBarrelVisual;
  private readonly takeBurst = (now: number) => this.weapon.puffBurst(now);
  private readonly groundMarkers: TurretGroundMarkers;
  private readonly tower: TurretTowerVisual;
  private readonly gunner = { x: 0, y: 0, z: 0 };
  private readonly pose = newTurretMonsterPose();
  private readonly probe: ThrowProbe;
  private readonly contact = newTurretContact();
  private readonly contactCounts: Readonly<TurretContactCounts>;
  private readonly effectGate: FarBakeGate | null;
  /** Ids a shell struck at its core in the feedback being read (their launch freezes on it). */
  private readonly coreHits: number[] = [];
  private readonly anim: AnimState = {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    falling: false,
    backwards: false,
    dead: false,
    casting: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };
  private readonly muzzle = { x: 0, y: 0, z: 0 };
  private camera: THREE.Camera | null = null;
  private geometry: {
    capsule: THREE.CapsuleGeometry;
    box: THREE.BoxGeometry;
    ring: THREE.RingGeometry;
  } | null = null;
  private plan: TurretPlanView | null = null;
  private capacities = new Map<string, number>();
  private order: string[] = [];
  private urgent: ReadonlySet<string> = new Set();
  private orderWave = -1;
  private idleBuildPending = false;
  private nowMs = 0;
  private towerRetryAtMs = Number.NEGATIVE_INFINITY;
  private barrelRetryAtMs = Number.NEGATIVE_INFINITY;
  private startTick = Number.NaN;
  private charactersState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private disposed = false;
  private readonly templateOf = (kind: number): string => this.plan?.kinds[kind]?.templateId ?? '';

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly compileGate?: CompileGate,
    private readonly idleScheduler?: IdleScheduler,
    towerSource?: TurretTowerSource,
    barrelSource?: TurretBarrelSource,
  ) {
    this.probe = { ground: groundAt, water: () => null };
    this.tower = new TurretTowerVisual(compileGate, towerSource);
    this.groundMarkers = new TurretGroundMarkers(this.probe, compileGate);
    const texelSlot = () =>
      idleSlot(RIG_IDLE_TIMEOUT_MS, {
        scheduler: this.idleScheduler,
        maxTimeoutDeferrals: RIG_IDLE_DEFERRALS,
      });
    this.weapon = new CannonShellVisuals({
      blastRadius: TURRET_WEAPON.blastRadius,
      groundAt,
      compileGate,
      bursts: { slots: TURRET_CONTACT_BURSTS + TURRET_BARREL_BURSTS, puffs: TURRET_CONTACT_PUFFS },
      impacts: TURRET_BARREL_IMPACTS,
      texelSlot,
    });
    this.contactCounts = turretContactCounts(this.weapon.lowEffects);
    this.barrels = new TurretBarrelVisual(
      groundAt,
      compileGate,
      barrelSource,
      this.weapon.lowEffects,
      texelSlot,
    );
    this.effectGate = compileGate
      ? (target, settle) => {
          void compileGate(target).then(
            () => settle(),
            () => settle(),
          );
        }
      : null;
    this.group.name = 'fire-and-fly';
    this.rigsRoot.name = 'fire-and-fly-rigs';
    this.markersRoot.name = 'fire-and-fly-markers';
    this.group.add(this.rigsRoot, this.markersRoot);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Rigs built so far, per template (read by tests and diagnostics). */
  get rigCounts(): ReadonlyMap<string, number> {
    return this.built;
  }

  /** The renderer services the shots draw with (particles, camera kick, AoE ring); its camera the health bars face. */
  setHost(host: CannonShellHost | null): void {
    this.weapon.setHost(host);
    this.camera = host?.camera ?? null;
  }

  update(
    session: TurretSessionView | null | undefined,
    clock: number | null | undefined,
    time: number,
    dt: number,
    reducedMotion = false,
    self?: TurretSelfView,
  ): void {
    if (this.disposed) return;
    if (!session) {
      if (this.group.visible) this.stand();
      return;
    }
    this.nowMs = time * 1000;
    const defense = session.defense;
    const aimYaw = self ? self.group.rotation.y : Math.atan2(defense.aimX, defense.aimZ);
    if (defense.startTick !== this.startTick) {
      this.stand();
      this.startTick = defense.startTick;
      this.tower.reset(aimYaw);
    }
    this.commit(defense.plan, defense.wave);
    this.group.visible = true;
    if (this.rigsRoot.parent !== this.group) this.group.add(this.rigsRoot);
    const tick = this.clock.sample(clock ?? defense.startTick, time);
    for (let i = 0; i < this.rigs.length; i++) {
      if (!this.book.rigReady[i] && this.rigs[i].gate.visible) this.book.setRigReady(i);
    }
    this.book.assign(defense.monsters, this.templateOf);
    this.tower.place(defense.cx, session.origin.y, defense.cz);
    this.tower.aim(aimYaw, dt);
    this.consumeFeedback(session, tick, time, reducedMotion);
    if (self) this.standGunner(self, defense.cx, session.origin.y, defense.cz);
    for (const rig of this.rigs) rig.used = false;
    for (const body of this.bodies) body.used = false;
    const frozen = defense.phase === 'lost';
    const step = Math.max(0, Math.min(dt, 0.1));
    this.groundMarkers.begin();
    for (const m of defense.monsters) {
      const b = this.book.bodyOf(m.id);
      const kind = defense.plan.kinds[m.kind];
      if (b < 0 || !kind) continue;
      const body = this.bodies[b];
      if (body.owner !== m.id) {
        body.owner = m.id;
        body.attitude.reset();
        body.forecast.reset();
        body.slope.reset();
      }
      const motion = body.forecast.resolve(m, kind, defense, tick, this.probe, TURRET_PHYSICS);
      const pose = turretMonsterPoseInto(
        this.pose,
        motion,
        kind,
        tick,
        this.probe,
        frozen,
        defense,
      );
      body.forecast.blend(pose, tick, this.probe);
      this.groundMarkers.push(motion, pose, kind.radius, body.slope);
      body.attitude.step(pose, tick, reducedMotion);
      const r = this.book.rigOf(m.id);
      const rig = r >= 0 ? this.rigs[r] : null;
      const height = rig ? rig.height : kind.height;
      const pivot = turretPivotHeight(height, body.attitude.upY());
      const baseY = pose.y - pose.sink * Math.max(height, SINK_DEPTH);
      const a = body.attitude;
      if (rig) {
        rig.used = true;
        if (rig.root.parent !== rig.gate) rig.gate.add(rig.root);
        rig.root.visible = true;
        rig.root.position.set(pose.x, baseY + pivot, pose.z);
        rig.root.quaternion.set(a.x, a.y, a.z, a.w);
        this.anim.speed = pose.speed;
        this.anim.moving = pose.moving;
        this.anim.running =
          pose.moving && pose.speed >= (rig.actor.gait?.runEnter ?? GAIT_RUN_ENTER);
        this.anim.airborne = pose.airborne;
        this.anim.falling = pose.falling;
        this.anim.dead = pose.dead;
        // A rig with no airborne clip keeps flailing through its hit reactions in the air.
        if (pose.airborne && !rig.airClip && !pose.dead && !rig.actor.isMidOneShot) {
          rig.actor.playHit();
        }
        rig.actor.update(step, this.anim, true, reducedMotion);
      }
      body.used = true;
      body.standIn.visible = !rig;
      if (!rig) {
        body.standIn.position.set(pose.x, baseY + pivot, pose.z);
        body.standIn.quaternion.set(a.x, a.y, a.z, a.w);
        const width = kind.radius * 1.4;
        body.standIn.scale.set(width, height / 2, width);
      }
      const showHealth = !pose.dead && pose.health > 0 && pose.health < 1;
      body.health.visible = showHealth;
      if (showHealth) {
        body.health.position.set(pose.x, baseY + pivot + height / 2 + HEALTH_BAR_LIFT, pose.z);
        if (this.camera) body.health.quaternion.copy(this.camera.quaternion);
        else body.health.rotation.set(0, Math.atan2(pose.x - defense.cx, pose.z - defense.cz), 0);
        body.health.scale.set(HEALTH_BAR_WIDTH * pose.health, 0.12, 0.12);
      }
      body.ring.visible = pose.windup >= 0;
      if (pose.windup >= 0) {
        body.ring.position.set(pose.x, pose.y + RING_LIFT, pose.z);
        body.ring.scale.setScalar((kind.radius + 0.8) * (1.3 - 0.3 * pose.windup));
      }
    }
    // A hidden subtree still pays its matrix walk every frame: a free linked
    // rig leaves the graph (its programs stay linked, no key changes).
    for (let i = 0; i < this.rigs.length; i++) {
      if (!this.rigs[i].used && this.book.rigReady[i]) this.rigs[i].root.removeFromParent();
    }
    for (const body of this.bodies) {
      if (body.used) continue;
      body.standIn.visible = body.health.visible = body.ring.visible = false;
    }
    this.groundMarkers.end();
    this.barrels.update(defense, frozen, tick, time);
    this.weapon.update(tick, time);
  }

  /** Stops showing a session: every slot released, the clock and the shots cleared. */
  private stand(): void {
    this.group.visible = false;
    this.rigsRoot.removeFromParent();
    this.book.releaseAll();
    this.clock.reset();
    this.cursor.reset();
    this.weapon.clear();
    this.barrels.clear();
    for (const body of this.bodies) body.owner = null;
  }

  /** The commitment: first seen seated, the markers are built and the rig pools start growing. */
  private commit(plan: TurretPlanView, wave: number): void {
    if (this.charactersState === 'idle') {
      this.charactersState = 'loading';
      charactersReady().then(
        () => {
          if (this.charactersState === 'loading') this.charactersState = 'ready';
        },
        (error) => {
          this.charactersState = 'failed';
          console.error('Fire and Fly monster rigs unavailable, stand-ins only', error);
        },
      );
    }
    if (!this.weapon.prepared) {
      timeBuildSpan('zone:turret-weapon', () => this.weapon.prepare(this.group));
    }
    if (!this.tower.prepared && this.nowMs >= this.towerRetryAtMs) {
      this.tower.prepare(
        this.group,
        () =>
          this.weapon.setBarrel(
            this.tower.barrelNode,
            TURRET_TOWER_MODEL.muzzleTip,
            TURRET_BARREL.recoilKick,
          ),
        () => {
          this.towerRetryAtMs = this.nowMs + RIG_RETRY_MS;
        },
      );
    }
    if (!this.barrels.prepared && this.nowMs >= this.barrelRetryAtMs) {
      this.barrels.prepare(this.group, () => {
        this.barrelRetryAtMs = this.nowMs + RIG_RETRY_MS;
      });
    }
    if (plan !== this.plan) {
      this.plan = plan;
      this.capacities = turretRigCapacities(plan);
      const bodies = turretBodyCapacity(plan);
      this.growMarkers(bodies);
      this.groundMarkers.prepare(this.group, bodies);
      this.orderWave = -1;
    }
    if (wave !== this.orderWave) {
      this.orderWave = wave;
      this.order = turretBuildOrder(plan, wave);
      this.urgent = turretUrgentTemplates(plan, wave);
    }
    if (this.charactersState !== 'ready') return;
    const templateId = this.nextTemplate();
    if (templateId === null) return;
    if (this.urgent.has(templateId)) this.buildRig(templateId);
    else this.requestIdleBuild();
  }

  private nextTemplate(): string | null {
    return nextTurretRig(this.order, this.capacities, this.built, this.coolingDown);
  }

  /** One later-wave rig per idle slot, so combat frames keep their budget. */
  private requestIdleBuild(): void {
    if (this.idleBuildPending) return;
    this.idleBuildPending = true;
    void idleSlot(RIG_IDLE_TIMEOUT_MS, {
      scheduler: this.idleScheduler,
      maxTimeoutDeferrals: RIG_IDLE_DEFERRALS,
    }).then(() => {
      this.idleBuildPending = false;
      if (this.disposed || !this.group.visible) return;
      const templateId = this.nextTemplate();
      if (templateId !== null) this.buildRig(templateId);
    });
  }

  private buildRig(templateId: string): void {
    try {
      timeBuildSpan('zone:turret-rig', () => this.mintRig(templateId));
    } catch (error) {
      this.retry.markFailed(POOL, templateId, this.nowMs);
      console.error(`Fire and Fly rig ${templateId} unavailable, stand-ins until a retry`, error);
    }
  }

  private mintRig(templateId: string): void {
    const template = MOBS[templateId];
    const key = visualKeyFor({ kind: 'mob', templateId } as Entity);
    const actor = new CharacterVisual(key, template?.color ?? 0xffffff);
    const clips = VISUALS[key]?.clips;
    actor.setShadow(false);
    actor.setProxyShadow(false);
    actor.setFarBakeGate(this.effectGate);
    const scale = template?.scale ?? 1;
    const height = actor.height * scale;
    const body = new THREE.Group();
    body.scale.setScalar(scale);
    body.position.y = -height / 2;
    body.add(actor.root);
    const root = new THREE.Group();
    root.visible = false;
    root.add(body);
    const gate = new THREE.Group();
    gate.name = `fire-and-fly-rig:${templateId}`;
    gate.add(root);
    this.book.addRig(templateId);
    this.rigs.push({
      actor,
      gate,
      root,
      body,
      height,
      airClip: !!(clips?.jump || clips?.fall),
      used: false,
    });
    this.built.set(templateId, (this.built.get(templateId) ?? 0) + 1);
    void attachSceneGroupGated(this.rigsRoot, gate, this.compileGate, () => this.disposed).catch(
      () => {},
    );
  }

  private growMarkers(count: number): void {
    this.book.growBodies(count);
    const geometry = this.buildGeometry();
    const materials = worldQuestTraceMaterials();
    while (this.bodies.length < count) {
      const standIn = this.marker(geometry.capsule, materials.blue);
      const health = this.marker(geometry.box, materials.green);
      const ring = this.marker(geometry.ring, materials.red);
      ring.rotation.x = -Math.PI / 2;
      // The capsule writes no depth: it sorts after the ground marker under it,
      // or the disc would blend over its lower half.
      standIn.renderOrder = TURRET_MARKER_ORDER + 1;
      ring.renderOrder = floorVfxRenderOrder('encounter');
      health.renderOrder = floorVfxRenderOrder('encounter', 1);
      this.bodies.push({
        owner: null,
        attitude: new TurretAttitude(),
        forecast: new TurretMotionForecast(),
        slope: new TurretMarkerGround(),
        standIn,
        health,
        ring,
        used: false,
      });
    }
  }

  private buildGeometry(): NonNullable<TurretDefenseVisual['geometry']> {
    if (this.geometry) return this.geometry;
    const geometry = {
      capsule: new THREE.CapsuleGeometry(0.5, 1, 4, 10),
      box: new THREE.BoxGeometry(1, 1, 1),
      ring: new THREE.RingGeometry(0.86, 1, 32),
    };
    // vertexNormals is a program key bit and MeshBasic without an env map reads
    // no normal: without one, the markers draw the programs the world-quest-trace
    // prewarm stages (a positions-only ribbon), not a variant nothing links.
    for (const part of Object.values(geometry)) part.deleteAttribute('normal');
    this.geometry = geometry;
    return geometry;
  }

  private marker(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.renderCategory = 'ui3d';
    mesh.visible = false;
    this.markersRoot.add(mesh);
    return mesh;
  }

  /** The player's own model, drawn behind the breech and facing along the barrel. */
  private standGunner(self: TurretSelfView, cx: number, roofY: number, cz: number): void {
    const yaw = this.tower.headYaw;
    turretGunnerInto(this.gunner, cx, cz, roofY, yaw);
    self.group.position.set(this.gunner.x, this.gunner.y, this.gunner.z);
    self.group.rotation.y = yaw;
  }

  private consumeFeedback(
    session: TurretSessionView,
    tick: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    this.coreHits.length = 0;
    const defense = session.defense;
    for (const entry of this.cursor.take(session)) {
      const ev = entry.event;
      const stale = entry.tick < tick - SHOT_STALE_TICKS;
      switch (ev.type) {
        case 'fired': {
          if (stale) break;
          const dx = ev.x - ev.fromX;
          const dz = ev.z - ev.fromZ;
          const dist = Math.hypot(dx, dz);
          this.tower.fireAt(
            dist > 1e-6 ? Math.atan2(dx, dz) : this.tower.headYaw,
            turretBarrelPitch(dist, ev.y - session.origin.y),
          );
          this.muzzle.x = ev.fromX + (dist > 1e-6 ? dx / dist : 0) * MUZZLE_REACH;
          this.muzzle.y = session.origin.y + MUZZLE_LIFT;
          this.muzzle.z = ev.fromZ + (dist > 1e-6 ? dz / dist : 1) * MUZZLE_REACH;
          this.weapon.fire(ev, this.muzzle, time, reducedMotion);
          break;
        }
        case 'impact':
          if (stale) break;
          this.weapon.impact(ev, time, reducedMotion);
          this.scorchRigs(ev.hits);
          break;
        case 'barrelLit':
          if (!stale) this.barrels.light(ev, defense, this.weapon.puffBurst(time), time);
          break;
        case 'barrelExploded':
          if (stale) break;
          this.weapon.impact(turretBarrelBlast(ev), time, reducedMotion);
          this.barrels.explode(ev, this.takeBurst, time);
          this.scorchRigs(ev.hits);
          break;
        // The stagger at every contact: playHit's own cooldown spaces a
        // bounce from its launch, and a corpse's death clip overrides it. The
        // impact precedes its launches in the ring, so a core hit's stagger
        // starts frozen on the blast.
        case 'launched': {
          const rig = this.rigFor(ev.id);
          if (!rig) break;
          rig.actor.playHit(true);
          if (!reducedMotion && this.coreHits.includes(ev.id)) {
            rig.actor.holdFrame(HITSTOP_SCALE, HITSTOP_SECONDS);
          }
          break;
        }
        case 'bounce':
          this.rigFor(ev.id)?.actor.playHit();
          if (!stale) {
            const kind = ev.surface === 'wall' ? 'wall' : 'bounce';
            this.kickDust(defense, entry, kind, ev.id, ev, ev.speed, tick, time);
          }
          break;
        case 'landed':
          this.rigFor(ev.id)?.actor.playHit();
          // A landing is the contact too slow to bounce: its speed into the ground is at most that.
          if (!stale) {
            const speed = TURRET_PHYSICS.bounceMinSpeed;
            this.kickDust(defense, entry, 'land', ev.id, ev, speed, tick, time);
          }
          break;
        case 'bowled':
          if (!stale) this.kickDust(defense, entry, 'bowl', ev.struckId, ev, ev.speed, tick, time);
          break;
        case 'windupStart':
          this.rigFor(ev.id)?.actor.playAttack();
          break;
      }
    }
  }

  /** The scorch a blast leaves on each body it struck; a core hit's launch freezes on it. */
  private scorchRigs(hits: readonly { readonly id: number; readonly falloff: number }[]): void {
    for (const hit of hits) {
      const rig = this.rigFor(hit.id);
      if (!rig) continue;
      rig.actor.respondToElement('fire', Math.min(0.95, FLASH_MIN + FLASH_GAIN * hit.falloff));
      if (hit.falloff >= CORE_HIT_FALLOFF) this.coreHits.push(hit.id);
    }
  }

  /**
   * The dust of one contact, launched on the weapon's puff draw. The segment
   * the body starts at the contact gives the direction it leaves in, the tick
   * it touched (a contact read a frame late is aged by the difference) and,
   * after a landing, the slide the trail follows.
   */
  private kickDust(
    defense: TurretDefenseView,
    entry: TurretFeedback,
    kind: TurretContactKind,
    id: number,
    at: { readonly x: number; readonly y: number; readonly z: number },
    speed: number,
    tick: number,
    time: number,
  ): void {
    const m = monsterById(defense.monsters, id);
    const size = m ? defense.plan.kinds[m.kind] : undefined;
    if (!m || !size) return;
    const burst = this.weapon.puffBurst(time);
    if (!burst) return;
    const seg = m.seg;
    const fromHere = Math.abs(seg.x - at.x) < 1e-3 && Math.abs(seg.z - at.z) < 1e-3;
    const moving = fromHere && (seg.kind === 'fly' || seg.kind === 'skid');
    const c = this.contact;
    c.kind = kind;
    c.id = id;
    c.seq = entry.seq;
    c.x = at.x;
    c.y = at.y;
    c.z = at.z;
    c.speed = speed;
    c.dirX = moving ? seg.vx : 0;
    c.dirZ = moving ? seg.vz : 0;
    c.height = size.height;
    c.radius = size.radius;
    const lag = turretContactLag(tick - (fromHere ? seg.start : entry.tick));
    turretContactBurstInto(burst, c, this.contactCounts, this.groundAt);
    if (kind === 'land' && fromHere && seg.kind === 'skid') {
      const seed = Math.imul(id, 0x2545) ^ entry.seq;
      const from = tick - lag / DT;
      turretSlideTrailInto(burst, seg, size.height, seed, from, this.contactCounts, this.groundAt);
    }
    burst.at = time - lag;
  }

  private rigFor(id: number): RigSlot | null {
    const r = this.book.rigOf(id);
    return r >= 0 ? this.rigs[r] : null;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    const errors: unknown[] = [];
    for (const rig of this.rigs) {
      try {
        rig.actor.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.rigs.length = 0;
    if (this.geometry) for (const part of Object.values(this.geometry)) part.dispose();
    this.geometry = null;
    try {
      this.weapon.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.tower.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.barrels.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.groundMarkers.dispose();
    } catch (error) {
      errors.push(error);
    }
    // The capsule, bar and ring materials are page-lifetime prewarmed resources,
    // owned by their cache; the ground markers released their own above.
    if (errors.length > 0) throw new AggregateError(errors, 'Fire and Fly rigs failed to dispose');
  }
}

function monsterById(
  monsters: TurretDefenseView['monsters'],
  id: number,
): TurretDefenseView['monsters'][number] | null {
  for (const m of monsters) if (m.id === id) return m;
  return null;
}

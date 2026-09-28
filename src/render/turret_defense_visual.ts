// Fire and Fly on screen: the private monsters' rigs with their stand-ins,
// health bars and strike rings, plus the cannon's shots (cannon_shell_visuals.ts,
// its muzzle and recoil on the tank's own barrel), driven from
// IWorld.turretSession. Nothing is built until the player is first seen seated
// in the turret; the rig pools then grow one rig per frame for the current and
// next wave, and one per idle slot for the others, and live for the rest of the
// world session. Every rig attaches behind the compile gate while a capsule on a
// prewarmed material stands in at the monster's exact position: enemy positions
// are never hidden. An unused rig leaves the scene graph. No lights, no shadows,
// no per-frame THREE allocation. Pure halves: turret_monster_pose_core.ts and
// turret_defense_pool_core.ts.
import * as THREE from 'three';
import { TURRET_WEAPON } from '../sim/content/turret_defense';
import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { timeBuildSpan } from './build_spans';
import { type CannonShellHost, CannonShellVisuals } from './cannon_shell_visuals';
import { type AnimState, CharacterVisual } from './characters';
import { charactersReady } from './characters/assets';
import { visualKeyFor } from './characters/manifest';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { type IdleScheduler, idleSlot } from './idle_queue';
import { GAIT_RUN_ENTER } from './locomotion';
import {
  nextTurretRig,
  TurretFeedbackCursor,
  TurretSlotBook,
  turretBodyCapacity,
  turretBuildOrder,
  turretRigCapacities,
  turretUrgentTemplates,
} from './turret_defense_pool_core';
import {
  newTurretMonsterPose,
  TURRET_STAND_IN_HEIGHT,
  TurretAttitude,
  TurretDisplayClock,
  turretMonsterPoseInto,
  turretPivotHeight,
} from './turret_monster_pose_core';
import { ViewCreateRetryGate } from './view_create_retry';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;
type TurretPlanView = TurretSessionView['defense']['plan'];

/** The self view's tank, lent as the seated player's mount: its barrel is a node of the rig. */
export interface TurretSelfView {
  readonly mountVisual?: { readonly root: THREE.Object3D } | null;
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
  used: boolean;
}

interface BodySlot {
  owner: number | null;
  readonly attitude: TurretAttitude;
  readonly standIn: THREE.Mesh;
  readonly health: THREE.Mesh;
  readonly ring: THREE.Mesh;
  used: boolean;
}

const HEALTH_BAR_WIDTH = 1.2;
const HEALTH_BAR_LIFT = 0.35;
const RING_LIFT = 0.08;
/** A corpse sinks at least this far (yd), so a short body still leaves the ground. */
const SINK_DEPTH = 1.1;
/** The Dreadspark Groundshaker's barrel node, and its muzzle in the node's own
 *  (quantized, +z forward) space: the centre of the barrel's end ring. */
const TANK_BARREL_NODE = 'TankCannon';
const TANK_MUZZLE_TIP = { x: -0.133, y: 0, z: 1.02 };
/** Without the barrel (a rig still loading), the muzzle sits this high over the
 *  turret and this far toward the shot. */
const MUZZLE_LIFT = 2.2;
const MUZZLE_REACH = 2;
/** A shot entry older than this many ticks at its first read (a seat seen late) draws nothing. */
const SHOT_STALE_TICKS = 10;
/** The renderer's view retry: a failed rig (a streamed GLB still arriving) is tried again after it. */
const RIG_RETRY_MS = 2000;
/** The retry gate keys (entity, slot): the pool is one entity, each template a slot. */
const POOL = 0;
/** A later wave's rig waits for an idle slot, on the renderer's idle prewarm terms. */
const RIG_IDLE_TIMEOUT_MS = 250;
const RIG_IDLE_DEFERRALS = 2;

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
  private barrelSource: THREE.Object3D | null = null;
  private readonly pose = newTurretMonsterPose();
  private readonly probe: { ground(x: number, z: number): number };
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
  private startTick = Number.NaN;
  private charactersState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private disposed = false;
  private readonly templateOf = (kind: number): string => this.plan?.kinds[kind]?.templateId ?? '';

  constructor(
    scene: THREE.Object3D,
    groundAt: (x: number, z: number) => number,
    private readonly compileGate?: CompileGate,
    private readonly idleScheduler?: IdleScheduler,
  ) {
    this.probe = { ground: groundAt };
    this.weapon = new CannonShellVisuals({
      blastRadius: TURRET_WEAPON.blastRadius,
      groundAt,
      compileGate,
    });
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

  /** The renderer services the shots draw with (particles, camera kick, AoE ring). */
  setHost(host: CannonShellHost | null): void {
    this.weapon.setHost(host);
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
    if (defense.startTick !== this.startTick) {
      this.stand();
      this.startTick = defense.startTick;
    }
    this.commit(defense.plan, defense.wave);
    this.group.visible = true;
    if (this.rigsRoot.parent !== this.group) this.group.add(this.rigsRoot);
    const tick = this.clock.sample(clock ?? defense.startTick, time);
    for (let i = 0; i < this.rigs.length; i++) {
      if (!this.book.rigReady[i] && this.rigs[i].gate.visible) this.book.setRigReady(i);
    }
    this.book.assign(defense.monsters, this.templateOf);
    this.syncBarrel(self, false);
    this.consumeFeedback(session, self, tick, time, reducedMotion);
    for (const rig of this.rigs) rig.used = false;
    for (const body of this.bodies) body.used = false;
    const frozen = defense.phase === 'lost';
    const step = Math.max(0, Math.min(dt, 0.1));
    for (const m of defense.monsters) {
      const b = this.book.bodyOf(m.id);
      const kind = defense.plan.kinds[m.kind];
      if (b < 0 || !kind) continue;
      const body = this.bodies[b];
      if (body.owner !== m.id) {
        body.owner = m.id;
        body.attitude.reset();
      }
      const pose = turretMonsterPoseInto(this.pose, m, kind, tick, this.probe, frozen);
      body.attitude.step(pose, m.state, m.seg.start, tick, reducedMotion);
      const r = this.book.rigOf(m.id);
      const rig = r >= 0 ? this.rigs[r] : null;
      const height = rig ? rig.height : TURRET_STAND_IN_HEIGHT[kind.sizeClass];
      const pivot = turretPivotHeight(height, body.attitude.upY());
      const baseY = pose.y - pose.sink * Math.max(height, SINK_DEPTH);
      const a = body.attitude;
      if (rig) {
        rig.used = true;
        if (rig.root.parent !== rig.gate) rig.gate.add(rig.root);
        rig.root.visible = true;
        rig.root.position.set(pose.x, baseY + pivot, pose.z);
        rig.root.quaternion.set(a.x, a.y, a.z, a.w);
        rig.body.rotation.y = pose.yaw;
        this.anim.speed = pose.speed;
        this.anim.moving = pose.moving;
        this.anim.running =
          pose.moving && pose.speed >= (rig.actor.gait?.runEnter ?? GAIT_RUN_ENTER);
        this.anim.airborne = pose.airborne;
        this.anim.falling = pose.falling;
        this.anim.dead = pose.dead;
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
        body.health.position.set(pose.x, baseY + 2 * pivot + HEALTH_BAR_LIFT, pose.z);
        body.health.rotation.y = Math.atan2(pose.x - defense.cx, pose.z - defense.cz);
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
    this.barrelSource = null;
    this.weapon.setBarrel(null, TANK_MUZZLE_TIP);
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
    if (plan !== this.plan) {
      this.plan = plan;
      this.capacities = turretRigCapacities(plan);
      this.growMarkers(turretBodyCapacity(plan));
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
    const actor = new CharacterVisual(
      visualKeyFor({ kind: 'mob', templateId } as Entity),
      template?.color ?? 0xffffff,
    );
    actor.setShadow(false);
    actor.setProxyShadow(false);
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
    this.rigs.push({ actor, gate, root, body, height, used: false });
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
      ring.renderOrder = floorVfxRenderOrder('encounter');
      this.bodies.push({
        owner: null,
        attitude: new TurretAttitude(),
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

  /** The tank's barrel, looked up again only when the rig changes or a shot finds none. */
  private syncBarrel(self: TurretSelfView | undefined, retry: boolean): void {
    const root = self?.mountVisual?.root ?? null;
    if (root === this.barrelSource && !(retry && root && !this.weapon.hasBarrel)) return;
    this.barrelSource = root;
    this.weapon.setBarrel(root?.getObjectByName(TANK_BARREL_NODE) ?? null, TANK_MUZZLE_TIP);
  }

  private consumeFeedback(
    session: TurretSessionView,
    self: TurretSelfView | undefined,
    tick: number,
    time: number,
    reducedMotion: boolean,
  ): void {
    for (const entry of this.cursor.take(session)) {
      const ev = entry.event;
      const stale = entry.tick < tick - SHOT_STALE_TICKS;
      switch (ev.type) {
        case 'fired': {
          if (stale) break;
          this.syncBarrel(self, true);
          const dx = ev.x - ev.fromX;
          const dz = ev.z - ev.fromZ;
          const dist = Math.hypot(dx, dz);
          this.muzzle.x = ev.fromX + (dist > 1e-6 ? dx / dist : 0) * MUZZLE_REACH;
          this.muzzle.y = session.origin.y + MUZZLE_LIFT;
          this.muzzle.z = ev.fromZ + (dist > 1e-6 ? dz / dist : 1) * MUZZLE_REACH;
          this.weapon.fire(ev, this.muzzle, time, reducedMotion);
          break;
        }
        case 'impact':
          if (!stale) this.weapon.impact(ev, time, reducedMotion);
          break;
        // The stagger at every contact: playHit's own cooldown spaces a
        // bounce from its launch, and a corpse's death clip overrides it.
        case 'launched':
        case 'bounce':
        case 'landed':
          this.rigFor(ev.id)?.actor.playHit();
          break;
        case 'windupStart':
          this.rigFor(ev.id)?.actor.playAttack();
          break;
      }
    }
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
    // Materials are page-lifetime prewarmed resources, owned by their cache.
    if (errors.length > 0) throw new AggregateError(errors, 'Fire and Fly rigs failed to dispose');
  }
}

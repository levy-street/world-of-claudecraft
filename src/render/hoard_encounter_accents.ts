// Buried Hoard encounter accents: the ground that ruptures when a frontal of
// Warlord Grask lands, and the closing reticle under a hoard mob casting an
// interruptible control. Every number comes from hoard_encounter_accents_core.ts.
//
// Rules this module keeps (src/render/CLAUDE.md), same as its sibling
// hoard_boss_dressing.ts:
//  - pooled: every geometry and material is built once in the constructor and
//    attached through the scene gate, so nothing compiles mid-fight;
//  - no per-frame allocation, and the idle frame costs a couple of branches;
//  - cosmetic only: the low tier builds none of it. The warning for a frontal
//    is the floor telegraph; the warning for a control is the overhead cast bar.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { HOARD_ADD_CAST_SCHOOLS } from '../sim/rift/hoard_add_casts';
import { HOARD_CONTROL_CAST_SCHOOLS } from '../sim/rift/hoard_control_casts';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import {
  HOARD_SLAM_LANDED_WITHIN_SEC,
  HOARD_SLAM_SEC,
  HOARD_SLAM_SHARD_COUNT,
  type HoardSlamShardPlan,
  hoardControlSigil,
  hoardSlamRise,
  hoardSlamShards,
  hoardSlamShock,
} from './hoard_encounter_accents_core';
import { setRenderCategory } from './renderer_diagnostics';

const SLAM_SLOTS = 3;
const TRACKED_FRONTALS = 4;
const SIGIL_SLOTS = 6;
const ARC_SEGMENTS = 20;
const SCORCH_SEGMENTS = 16;
const CASTER_SCAN_SEC = 0.15;
const SHADOW = 0xb26bff;
const NATURE = 0x86ff6a;
const FROST = 0x8fe3ff;
const FIRE = 0xffa24a;
/** Every hoard cast that draws the ground sigil: the controls and the adds' own. */
const SIGIL_CASTS = { ...HOARD_CONTROL_CAST_SCHOOLS, ...HOARD_ADD_CAST_SCHOOLS };
const SIGIL_COLOR: Readonly<Record<string, number>> = { nature: NATURE, frost: FROST, fire: FIRE };

interface TrackedFrontal {
  /** -1 while free. */
  instanceId: number;
  cueId: number;
  x: number;
  z: number;
  facing: number;
  halfAngle: number;
  radius: number;
  remaining: number;
  seen: boolean;
}

interface SlamSlot {
  /** Seconds since the hit; negative while free. */
  age: number;
  group: THREE.Group;
  shards: THREE.InstancedMesh;
  arc: THREE.Mesh;
  scorch: THREE.Mesh;
  arcMaterial: THREE.MeshBasicMaterial;
  scorchMaterial: THREE.MeshBasicMaterial;
  plans: HoardSlamShardPlan[];
  baseY: Float32Array;
  facing: number;
  halfAngle: number;
  radius: number;
}

interface SigilSlot {
  /** -1 while free. */
  casterId: number;
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
}

function additive(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function dynamicGeometry(vertexCount: number, indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  geometry.setIndex(indices);
  return geometry;
}

/** A ribbon of `segments` quads: two vertices per station. */
function ribbonIndices(segments: number): number[] {
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment++) {
    const base = segment * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return indices;
}

function fanIndices(segments: number): number[] {
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment++) indices.push(0, segment + 1, segment + 2);
  return indices;
}

export class HoardEncounterAccents {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly enabled: boolean;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly slams: SlamSlot[] = [];
  private readonly sigils: SigilSlot[] = [];
  private readonly frontals: TrackedFrontal[] = [];
  private liveSlams = 0;
  private liveSigils = 0;
  private casterScan = 0;
  private clock = 0;
  private disposed = false;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
  ) {
    this.root.name = 'hoard-encounter-accents';
    // Attributed like the telegraphs it accents, but deliberately NOT actionable.
    setRenderCategory(this.root, 'ui3d');
    this.enabled =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    if (!this.enabled) {
      this.readyForEntry = Promise.resolve();
      return;
    }
    for (let index = 0; index < TRACKED_FRONTALS; index++) {
      this.frontals.push({
        instanceId: -1,
        cueId: -1,
        x: 0,
        z: 0,
        facing: 0,
        halfAngle: 0,
        radius: 0,
        remaining: 0,
        seen: false,
      });
    }
    this.buildSlams();
    this.buildSigils();
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private keep<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private buildSlams(): void {
    // A four-sided shard of broken ground, base on the floor.
    const spike = this.own(new THREE.ConeGeometry(0.5, 1, 4, 1));
    spike.translate(0, 0.5, 0);
    const rock = this.keep(
      new THREE.MeshStandardMaterial({
        color: 0x2f2822,
        emissive: 0x8a2a08,
        emissiveIntensity: 0.12,
        roughness: 0.85,
        metalness: 0,
        flatShading: true,
      }),
    );
    for (let index = 0; index < SLAM_SLOTS; index++) {
      const group = new THREE.Group();
      group.visible = false;
      const shards = new THREE.InstancedMesh(spike, rock, HOARD_SLAM_SHARD_COUNT);
      shards.frustumCulled = false;
      shards.castShadow = false;
      const arcMaterial = this.keep(additive(0xffc46b, 0.9));
      const arc = new THREE.Mesh(
        this.own(dynamicGeometry((ARC_SEGMENTS + 1) * 2, ribbonIndices(ARC_SEGMENTS))),
        arcMaterial,
      );
      const scorchMaterial = this.keep(additive(0xff4a0a, 0.5));
      const scorch = new THREE.Mesh(
        this.own(dynamicGeometry(SCORCH_SEGMENTS + 2, fanIndices(SCORCH_SEGMENTS))),
        scorchMaterial,
      );
      arc.frustumCulled = false;
      scorch.frustumCulled = false;
      arc.renderOrder = 23;
      scorch.renderOrder = 21;
      group.add(scorch, arc, shards);
      this.root.add(group);
      this.slams.push({
        age: -1,
        group,
        shards,
        arc,
        scorch,
        arcMaterial,
        scorchMaterial,
        plans: [],
        baseY: new Float32Array(HOARD_SLAM_SHARD_COUNT),
        facing: 0,
        halfAngle: 0,
        radius: 0,
      });
    }
  }

  private buildSigils(): void {
    const ring = this.own(new THREE.RingGeometry(0.9, 1, 48));
    ring.rotateX(-Math.PI / 2);
    // Four sides make the inner ring read as a closing reticle, not a disc.
    const reticle = this.own(new THREE.RingGeometry(0.78, 1, 4, 1));
    reticle.rotateX(-Math.PI / 2);
    for (let index = 0; index < SIGIL_SLOTS; index++) {
      const group = new THREE.Group();
      group.visible = false;
      // The ground ring is the whole tell: a column of light up the caster painted
      // the mob's own body its school's colour, which read as a glitch (playtest).
      const ringMaterial = this.keep(additive(SHADOW, 0.8));
      const outer = new THREE.Mesh(ring, ringMaterial);
      const inner = new THREE.Mesh(reticle, ringMaterial);
      for (const mesh of [outer, inner]) {
        mesh.frustumCulled = false;
        mesh.renderOrder = 22;
      }
      outer.position.y = 0.2;
      inner.position.y = 0.24;
      group.add(outer, inner);
      this.root.add(group);
      this.sigils.push({ casterId: -1, group, outer, inner, ringMaterial });
    }
  }

  /** Follows the brute frontals; one that runs its fuse out ruptures the ground. */
  sync(cues: readonly HoardBossCueView[]): void {
    if (!this.enabled) return;
    let tracked = 0;
    for (const frontal of this.frontals) {
      frontal.seen = false;
      if (frontal.instanceId !== -1) tracked++;
    }
    if (cues.length === 0 && tracked === 0) return;
    for (let index = 0; index < cues.length; index++) {
      const cue = cues[index];
      if (cue.kind !== 'sweep' || !cue.variant?.startsWith('brute-')) continue;
      let slot: TrackedFrontal | null = null;
      let free: TrackedFrontal | null = null;
      for (const frontal of this.frontals) {
        if (frontal.instanceId === cue.instanceId && frontal.cueId === cue.cueId) {
          slot = frontal;
          break;
        }
        if (frontal.instanceId === -1 && !free) free = frontal;
      }
      slot ??= free;
      if (!slot) continue;
      slot.instanceId = cue.instanceId;
      slot.cueId = cue.cueId;
      slot.x = cue.x;
      slot.z = cue.z;
      slot.facing = cue.facing ?? 0;
      slot.halfAngle = cue.halfAngle ?? Math.PI / 4;
      slot.radius = cue.radius;
      slot.remaining = cue.remaining;
      slot.seen = true;
    }
    for (const frontal of this.frontals) {
      if (frontal.instanceId === -1 || frontal.seen) continue;
      if (frontal.remaining <= HOARD_SLAM_LANDED_WITHIN_SEC) this.rupture(frontal);
      frontal.instanceId = -1;
    }
  }

  private rupture(frontal: TrackedFrontal): void {
    let slot = this.slams[0];
    for (const candidate of this.slams) {
      if (candidate.age < 0) {
        slot = candidate;
        break;
      }
      // All busy: recycle the oldest.
      if (candidate.age > slot.age) slot = candidate;
    }
    if (slot.age < 0) this.liveSlams++;
    slot.age = 0;
    slot.facing = frontal.facing;
    slot.halfAngle = frontal.halfAngle;
    slot.radius = frontal.radius;
    slot.plans = hoardSlamShards(frontal.cueId);
    const baseY = this.groundY(frontal.x, frontal.z);
    slot.group.position.set(frontal.x, baseY, frontal.z);
    slot.group.visible = true;
    for (let index = 0; index < slot.plans.length; index++) {
      const plan = slot.plans[index];
      const bearing = frontal.facing + plan.angleFraction * frontal.halfAngle;
      const reach = plan.radiusFraction * frontal.radius;
      slot.baseY[index] =
        this.groundY(frontal.x + Math.sin(bearing) * reach, frontal.z + Math.cos(bearing) * reach) -
        baseY -
        0.1;
    }
    // The scorch fan drapes over the ground once; the shock arc is built at unit
    // radius and only scaled afterwards.
    const scorch = slot.scorch.geometry.getAttribute('position') as THREE.BufferAttribute;
    scorch.setXYZ(0, 0, 0.14, 0);
    for (let segment = 0; segment <= SCORCH_SEGMENTS; segment++) {
      const bearing =
        frontal.facing - frontal.halfAngle + (segment / SCORCH_SEGMENTS) * frontal.halfAngle * 2;
      const dx = Math.sin(bearing) * frontal.radius;
      const dz = Math.cos(bearing) * frontal.radius;
      scorch.setXYZ(
        segment + 1,
        dx,
        this.groundY(frontal.x + dx, frontal.z + dz) - baseY + 0.14,
        dz,
      );
    }
    scorch.needsUpdate = true;
    const arc = slot.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let station = 0; station <= ARC_SEGMENTS; station++) {
      const bearing =
        frontal.facing - frontal.halfAngle + (station / ARC_SEGMENTS) * frontal.halfAngle * 2;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      arc.setXYZ(station * 2, sx * 0.9, 0.3, sz * 0.9);
      arc.setXYZ(station * 2 + 1, sx, 0.3, sz);
    }
    arc.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.clock += dt;
    if (this.liveSlams > 0) this.updateSlams(dt);
    this.updateSigils(dt);
  }

  private updateSlams(dt: number): void {
    for (const slot of this.slams) {
      if (slot.age < 0) continue;
      slot.age += dt;
      if (slot.age >= HOARD_SLAM_SEC + 0.2) {
        slot.age = -1;
        slot.group.visible = false;
        this.liveSlams--;
        continue;
      }
      const shock = hoardSlamShock(slot.age);
      slot.arc.scale.setScalar(slot.radius * shock.scale);
      slot.arcMaterial.opacity = shock.opacity;
      slot.scorchMaterial.opacity = shock.scorchOpacity;
      for (let index = 0; index < slot.plans.length; index++) {
        const plan = slot.plans[index];
        const bearing = slot.facing + plan.angleFraction * slot.halfAngle;
        const reach = plan.radiusFraction * slot.radius;
        const rise = Math.max(0.001, hoardSlamRise(slot.age, plan.delay));
        this.pos.set(Math.sin(bearing) * reach, slot.baseY[index], Math.cos(bearing) * reach);
        // Thrown outward, away from the boss.
        this.euler.set(Math.cos(bearing) * plan.lean, 0, -Math.sin(bearing) * plan.lean);
        this.quat.setFromEuler(this.euler);
        this.scale.set(plan.girth, plan.height * rise, plan.girth);
        this.matrix.compose(this.pos, this.quat, this.scale);
        slot.shards.setMatrixAt(index, this.matrix);
      }
      slot.shards.instanceMatrix.needsUpdate = true;
    }
  }

  /** Casters are found on a slow cadence (a cast starting is not a roster
   *  change, so there is no version to key on), and only inside a rift; a found
   *  caster is then a direct lookup until the cast ends. */
  private updateSigils(dt: number): void {
    const world = this.world;
    if (!world) return;
    if (!world.riftFloor) {
      if (this.liveSigils > 0) this.clearSigils();
      return;
    }
    this.casterScan -= dt;
    if (this.casterScan <= 0) {
      this.casterScan = CASTER_SCAN_SEC;
      this.scanCasters(world);
    }
    if (this.liveSigils === 0) return;
    const calm = this.reducedMotion();
    for (const slot of this.sigils) {
      if (slot.casterId === -1) continue;
      const caster = world.entities.get(slot.casterId);
      const castId = caster?.castingAbility;
      if (!caster || caster.dead || !castId || !SIGIL_CASTS[castId]) {
        slot.casterId = -1;
        slot.group.visible = false;
        this.liveSigils--;
        continue;
      }
      const progress = caster.castTotal > 0 ? 1 - caster.castRemaining / caster.castTotal : 1;
      const plan = hoardControlSigil(progress, this.clock, caster.scale, calm);
      slot.group.position.set(caster.pos.x, this.groundY(caster.pos.x, caster.pos.z), caster.pos.z);
      slot.outer.scale.setScalar(plan.outer);
      slot.inner.scale.setScalar(plan.inner);
      slot.inner.rotation.y += dt * plan.spin;
      slot.ringMaterial.opacity = plan.opacity;
    }
  }

  private scanCasters(world: IWorld): void {
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'mob' || entity.dead || !entity.castingAbility) continue;
      const cast = SIGIL_CASTS[entity.castingAbility];
      if (!cast) continue;
      let free: SigilSlot | null = null;
      let known = false;
      for (const slot of this.sigils) {
        if (slot.casterId === entity.id) {
          known = true;
          break;
        }
        if (slot.casterId === -1 && !free) free = slot;
      }
      if (known || !free) continue;
      free.casterId = entity.id;
      const color = SIGIL_COLOR[cast.school] ?? SHADOW;
      free.ringMaterial.color.setHex(color);
      free.inner.rotation.y = 0;
      free.group.visible = true;
      this.liveSigils++;
    }
  }

  private clearSigils(): void {
    for (const slot of this.sigils) {
      slot.casterId = -1;
      slot.group.visible = false;
    }
    this.liveSigils = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const slot of this.slams) slot.shards.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

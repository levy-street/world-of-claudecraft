// The PLACED mobile crafting station's world prop (the Last Keep report:
// "you can brew at it, it is just not visible"). Mirrors the placed-station
// entities (kind 'object', templateId `mobile_station_<suffix>`,
// src/sim/professions/mobile_station_object.ts) into the scene the way
// farm_patches.ts mirrors the placed feast: create on first appearance,
// re-seat on an authority move, remove on despawn. Each station wears the
// TOWN station's own prop cluster (mobile_stations_core.ts over
// STATION_PROP_CLUSTERS), built from the very same GLB template parts and
// worn-detail materials stations.ts instances at boot, so a placed Laden
// Hearth is the kitchens station's bonfire, crate and barrel, and the Grand
// Cauldron is the apothecary's cauldron, grand.
//
// A PREPARED GPU PRODUCER (src/render/CLAUDE.md, "GPU work: every new
// producer is a client of the scheduler"): every station group attaches
// through the host's compile gate (gated_scene_attach.ts), hidden until its
// programs link, under the label kind `mobile-station`. The materials are
// the town stations' cached ones (already linked at boot wherever a town
// station stands, for the INSTANCED draw; the plain-mesh program here is
// what the gate covers), and the station ENTITY's own invisible click proxy
// and nameplate stand in meanwhile (the feast stand-in rule,
// entity_gate_stand_in_core.ts). NO point light, deliberately: a fire light
// added after boot changes numPointLights, a program-cache-key input that
// would relink every lit material in view; the flame is emissive only, the
// decor_torch_fx.ts ruling, flickered here per frame (no allocation).
//
// FAIRNESS: the station is actionable for its party (the crafting gate reads
// it), so it draws at every graphics tier and reads no preset or knob.

import * as THREE from 'three';
import { isMobileStationTemplateId } from '../sim/professions/mobile_station_object';
import type { Entity } from '../sim/types';
import { groundHeight } from '../sim/world';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { farmFeastSurfaceNormal } from './farm_patches_core';
import { attachSceneGroupGated, GatedSceneAttachCancelledError } from './gated_scene_attach';
import { GFX } from './gfx';
import { type MobileStationProp, mobileStationPropPlan } from './mobile_stations_core';
import { setRenderCategory } from './renderer_diagnostics';
import {
  STATION_FLAME_BASE_SCALE,
  STATION_FLAME_Y,
  stationFlameGeometry,
  stationFlameMaterial,
  stationModelLoaded,
  stationTemplateParts,
} from './stations';

export type MobileStationCompileGate = (
  target: THREE.Object3D,
  label: string,
  priority: number,
) => Promise<unknown>;

/** One placed station's props while it stands. */
interface StationVisual {
  group: THREE.Group;
  /** Fallback-box geometries minted for a not-yet-loaded model (owned). */
  ownedGeometries: THREE.BufferGeometry[];
  /** Flame cones and their authored base scale, for the per-frame flicker. */
  flames: { mesh: THREE.Mesh; base: number; phase: number }[];
  /** Every station mesh, for the shadow budget. */
  shadowMeshes: THREE.Mesh[];
  /** The shadow budget's memo: written only when membership changes. */
  castsShadow: boolean;
}

/** How many placed stations may CAST shadows at once (insertion order,
 *  oldest first; the budget refills as stations despawn). Presence is never
 *  capped: the station is actionable for its party, so every one in
 *  interest scope draws; shadow casting is the expensive cosmetic half (a
 *  shadow-map draw per mesh, and a cluster is up to nine), so it is the
 *  half that sheds in a packed hub. The feast's FEAST_SHADOW_CAP twin. */
export const MOBILE_STATION_SHADOW_CAP = 8;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FLICKER_SPEED = 9;
const TWO_PI = Math.PI * 2;

function ignoreRetiredAttach(error: unknown): void {
  if (!(error instanceof GatedSceneAttachCancelledError)) throw error;
}

export class MobileStationVisuals {
  private readonly stations = new Map<number, StationVisual>();
  private readonly seen = new Set<number>();
  private readonly flameGeo = stationFlameGeometry();
  private readonly flameMat: THREE.Material;
  private time = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly compileGate: MobileStationCompileGate | null = null,
  ) {
    // One flame material for every placed fire (the town build mints one per
    // campfire; here they are dynamic, so a shared owned instance keeps the
    // program count at one and disposal symmetric).
    this.flameMat = stationFlameMaterial(GFX.standardMaterials);
  }

  /** Mirrors the placed-station entities: one entity-map walk plus set
   *  membership, no allocation in steady state (the applyFeasts idiom). */
  sync(entities: ReadonlyMap<number, Entity>, seed: number): void {
    if (this.disposed) return;
    this.seen.clear();
    for (const e of entities.values()) {
      if (e.kind !== 'object' || !isMobileStationTemplateId(e.templateId)) continue;
      this.seen.add(e.id);
      const existing = this.stations.get(e.id);
      if (!existing) this.create(e, seed);
      else if (!existing.group.position.equals(e.pos)) this.seat(existing.group, e, seed);
    }
    for (const [id, visual] of this.stations) {
      if (!this.seen.has(id)) this.remove(id, visual);
    }
    this.applyShadowBudget();
  }

  /** Re-derives which stations cast shadows (the first
   *  MOBILE_STATION_SHADOW_CAP in insertion order). Runs on the throttled
   *  read only; writes nothing when membership has not changed. */
  private applyShadowBudget(): void {
    let budget = MOBILE_STATION_SHADOW_CAP;
    for (const visual of this.stations.values()) {
      const cast = budget > 0;
      if (cast) budget--;
      if (visual.castsShadow === cast) continue;
      visual.castsShadow = cast;
      for (const mesh of visual.shadowMeshes) mesh.castShadow = cast;
    }
  }

  /** Per-frame writes only: the flame flicker. Allocates nothing. */
  update(dt: number): void {
    this.time = (this.time + dt) % TWO_PI;
    for (const visual of this.stations.values()) {
      for (const flame of visual.flames) {
        const t = this.time * FLICKER_SPEED + flame.phase;
        flame.mesh.scale.y = flame.base * (1 + Math.sin(t) * 0.14 + Math.sin(t * 2.3) * 0.06);
        flame.mesh.scale.x = flame.mesh.scale.z = flame.base * (1 + Math.sin(t * 1.7 + 1) * 0.06);
      }
    }
  }

  /** Test and diagnostics window: the ids currently mirrored. */
  standingIds(): number[] {
    return [...this.stations.keys()];
  }

  /** Terminal release: every station is removed best-effort (one failing
   *  geometry release strands nothing after it), the shared lathe and flame
   *  material are freed in a finally, and the first failure is rethrown
   *  after the drain (the renderer_resource_lifecycle.ts bestEffort shape). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    try {
      for (const [id, visual] of this.stations) {
        try {
          this.remove(id, visual);
        } catch (error) {
          failure ??= error;
        }
      }
    } finally {
      this.flameGeo.dispose();
      this.flameMat.dispose();
    }
    if (failure !== undefined) throw failure;
  }

  private create(e: Entity, seed: number): void {
    const plan = mobileStationPropPlan(e.templateId);
    if (!plan) return;
    const group = new THREE.Group();
    group.name = `mobileStation:${e.id}`;
    this.seat(group, e, seed);
    const ownedGeometries: StationVisual['ownedGeometries'] = [];
    const flames: StationVisual['flames'] = [];
    const shadowMeshes: StationVisual['shadowMeshes'] = [];
    for (const prop of plan) {
      group.add(this.buildProp(prop, e.id, ownedGeometries, flames, shadowMeshes));
    }
    setRenderCategory(group, 'props');
    // Casting starts OFF; the budget pass at the sync tail turns on the
    // first MOBILE_STATION_SHADOW_CAP stations.
    const record: StationVisual = {
      group,
      ownedGeometries,
      flames,
      shadowMeshes,
      castsShadow: false,
    };
    this.stations.set(e.id, record);
    this.attachGated(group, `mobile-station:${e.id}`, () => this.stations.get(e.id) !== record);
  }

  /** One prop of the cluster in the station's local frame: the town template
   *  parts (shared geometry and materials, never disposed here) under a
   *  holder carrying the authored offset, yaw and the plan's scale, plus a
   *  flame cone when the plan lights it. */
  private buildProp(
    prop: MobileStationProp,
    entityId: number,
    ownedGeometries: THREE.BufferGeometry[],
    flames: StationVisual['flames'],
    shadowMeshes: THREE.Mesh[],
  ): THREE.Group {
    const holder = new THREE.Group();
    holder.position.set(prop.dx, 0, prop.dz);
    holder.rotation.y = prop.rot;
    holder.scale.setScalar(prop.scale);
    const loaded = stationModelLoaded(prop.kind);
    for (const part of stationTemplateParts(prop.kind)) {
      const mesh = new THREE.Mesh(part.geo, part.mat);
      mesh.applyMatrix4(part.local);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      shadowMeshes.push(mesh);
      if (!loaded) ownedGeometries.push(part.geo);
      holder.add(mesh);
    }
    if (prop.fire > 0) {
      const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
      flame.position.y = STATION_FLAME_Y;
      const base = STATION_FLAME_BASE_SCALE * prop.fire;
      flame.scale.setScalar(base);
      holder.add(flame);
      flames.push({ mesh: flame, base, phase: (entityId % 11) * 0.7 });
    }
    return holder;
  }

  /** Placement and later authority corrections share one transform path
   *  (the feast's seat): the entity's ground seat, tilted to the walkable
   *  surface normal, with a per-entity yaw so two stations never align. */
  private seat(group: THREE.Group, e: Entity, seed: number): void {
    group.position.copy(e.pos);
    const normal = farmFeastSurfaceNormal(e.pos, (x, z) => groundHeight(x, z, seed));
    const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, (e.id % 7) * 0.45);
    group.quaternion
      .setFromUnitVectors(WORLD_UP, new THREE.Vector3(normal.x, normal.y, normal.z))
      .multiply(yaw);
  }

  private remove(id: number, visual: StationVisual): void {
    this.stations.delete(id);
    this.scene.remove(visual.group);
    for (const geo of visual.ownedGeometries) geo.dispose();
  }

  private attachGated(group: THREE.Group, label: string, retired: () => boolean): void {
    const gate = this.compileGate;
    if (!gate) {
      this.scene.add(group);
      return;
    }
    void attachSceneGroupGated(
      this.scene,
      group,
      (target) => gate(target, label, GPU_WORK_PRIORITY.LIVE_VIEW),
      retired,
    ).catch(ignoreRetiredAttach);
  }
}

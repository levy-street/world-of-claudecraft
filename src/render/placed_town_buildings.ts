// A built-in town made only of PLACED painted buildings (no civic batches):
// the shared view behind Highwatch (render/highwatch_town.ts), and the shape a
// later town of painted buildings takes. Each building is stood by
// buildPlacedTownBuilding (eastbrook_placed_building.ts) from the file of the
// profile's texture tier, keeps its own fog cull and camera fade (walk-in
// buildings stay solid while the player and the camera are both inside, the
// rule fenbridge_town_visibility_core.ts owns), and its FIRST reveal rides the
// town's reveal key piecewise, nearest first (town_reveal_core.ts), exactly as
// the Fenbridge view's buildings do. Each walk-in building registers its air
// with the indoor camera (placed_town_interiors.ts, the air in
// placed_town_interior_core.ts), so the camera keeps to its rooms while the
// player is inside. The town view of Fenbridge or Eastbrook
// owns the same building loop beside its own batches; this module is that
// loop on its own.
import * as THREE from 'three';
import type { BuildingDef, PromotedScenery } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { mediaAssetExists } from './assets/media';
import { registerDeferredPreload } from './assets/preload';
import { activeWorldHasAuthoredTown } from './authored_town_gate';
import {
  buildPlacedTownBuilding,
  type PlacedTown,
  type PlacedTownBuildingRecord,
  placedBuildingCullRadius,
} from './eastbrook_placed_building';
import {
  type FenbridgeBuildingVisibilityTarget,
  fenbridgeBuildingVisibilityPlanInto,
  fenbridgeFogVisible,
  newFenbridgeBuildingVisibilityPlan,
} from './fenbridge_town_visibility_core';
import { GFX, type GfxSettings } from './gfx';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { type PlacedTextureTier, placedTextureTierPath } from './placed_texture_tier_core';
import { createPlacedTownInteriors } from './placed_town_interiors';
import { activeWorldPromoted } from './promoted_scenery_gate';
import type { RevealGateCore } from './reveal_gate_core';
import {
  isLowSceneryCullActive,
  prepareSceneryDetailRoot,
  sceneryStructureFar,
} from './scenery_detail';
import {
  newTownPiecewiseReveal,
  orderTownRootsNearestFirst,
  townPiecewiseRevealInto,
  townRootVisible,
  townStaticReveal,
} from './town_reveal_core';

/** A building record a placed town draws: the record shape every town's
 *  makePlacedBuilding gives, plus the walk-in flag. */
export interface PlacedTownViewBuilding extends PlacedTownBuildingRecord {
  readonly walkIn?: boolean;
}

export interface PlacedTownSpec {
  readonly town: PlacedTown;
  readonly layoutId: string;
  /** The scene root's name, and the prefix of the town's reveal key. */
  readonly rootName: string;
  readonly revealKey: string;
  /** The town-wide cull and imminent-reveal circle. */
  readonly hub: {
    readonly center: { readonly x: number; readonly z: number };
    readonly radius: number;
  };
  readonly buildings: readonly PlacedTownViewBuilding[];
  /** The promoted-scenery family a document sets when it owns these
   *  buildings as its own placements (sim/authored_town_registry.ts). */
  readonly promotedBy: keyof PromotedScenery;
  /** A town's own additions to one of its models, built fresh for each view (in the model's
   *  frame): they join the building before its materials convert, so they fade, cull and
   *  reveal with it (Highwatch's guild sign, highwatch_guild_sign.ts). */
  readonly decorate?: (buildingId: string) => readonly THREE.Object3D[];
}

export interface PlacedTownView {
  group: THREE.Group;
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
  /**
   * First-reveal compile gating: each building's first fog-cull reveal is
   * held hidden until the gate warms the town key (building by building,
   * nearest first), so a cold approach never links the town's programs
   * inside a live frame. No gate keeps the historical immediate reveal.
   */
  setRevealGate(gate: RevealGateCore | null): void;
  /** The compile roots behind the town's reveal key (its buildings). */
  staticRevealRoots(): readonly THREE.Object3D[];
}

export interface PlacedTownDrawStats {
  colorDraws: number;
  shadowDraws: number;
  triangles: number;
  buildingCount: number;
  buildingFadeTargetCount: number;
}

interface BuildingHideTarget extends FenbridgeBuildingVisibilityTarget {
  group: THREE.Group;
  materials: OccluderFadeMat[];
  interiors: THREE.Object3D[];
  interiorsVisible: boolean;
  hidden: boolean;
  alpha: number;
}

type GroundAt = (x: number, z: number) => number;

// The town-wide cull circle's margin past the hub ring: the reveal key must be
// consulted before the camera reaches a building.
const TOWN_CULL_MARGIN_YD = 12;

/**
 * The town circle round its hub, which the town's fog test and its reveal's
 * imminence both read: the hub ring plus the margin, or further, so that it
 * holds every building's own cull circle whole. A building standing past it
 * would be hidden by the town's fog answer, or revealed without the imminent
 * priority, while its own cull still wants it drawn (Highwatch's smithy stands
 * on a terrace about 44 yards out). A town keeping its own margin past the
 * hub ring passes it (Fenbridge's six yards, render/fenbridge_town.ts).
 */
export function placedTownCullRadius(
  spec: Pick<PlacedTownSpec, 'hub' | 'buildings'>,
  margin = TOWN_CULL_MARGIN_YD,
): number {
  let radius = spec.hub.radius + margin;
  for (const building of spec.buildings) {
    const out =
      Math.hypot(building.position.x - spec.hub.center.x, building.position.z - spec.hub.center.z) +
      placedBuildingCullRadius(building);
    if (out > radius) radius = out;
  }
  return radius;
}

export function placedTownDrawStats(root: THREE.Object3D): PlacedTownDrawStats {
  let colorDraws = 0;
  let shadowDraws = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    colorDraws += Array.isArray(object.material) ? object.material.length : 1;
    if (object.castShadow) shadowDraws++;
    const position = object.geometry.getAttribute('position');
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    triangles += ((object.geometry.index?.count ?? position?.count ?? 0) / 3) * instances;
  });
  return {
    colorDraws,
    shadowDraws,
    triangles,
    buildingCount: Array.isArray(root.userData.buildingIds) ? root.userData.buildingIds.length : 0,
    buildingFadeTargetCount: Number(root.userData.buildingFadeTargetCount ?? 0),
  };
}

/**
 * The view half of a placed town: the painted buildings' sources (one per
 * model URL, read from the file of the profile's texture tier), the profile
 * hooks, the deferred preloads and the view builder. One kit per town, made
 * once at module load by the town's own module.
 */
export function createPlacedTownKit(spec: PlacedTownSpec) {
  const urls = Object.freeze([...new Set(spec.buildings.map((building) => building.assetId))]);
  const ids = new Set(spec.buildings.map((building) => building.id));
  const cullRadius = placedTownCullRadius(spec);
  const loadedSources = new Map<string, THREE.Object3D>();
  /** The FILE each resident source was read from: the URL names the model,
   *  the file follows the texture tier (same geometry). */
  const loadedSourceFiles = new Map<string, string>();
  const sourceLoadTasks = new Map<string, Promise<void>>();
  /** The camera interiors the live view registered (dropped when the next view builds). */
  const interiors = createPlacedTownInteriors();

  function prepareSource(url: string, tier: PlacedTextureTier = GFX.placedTextureTier) {
    const file = placedTextureTierPath(url, tier, mediaAssetExists);
    const residentFile = loadedSourceFiles.get(url);
    if (loadedSources.has(url) && residentFile === file) return Promise.resolve();
    const existing = sourceLoadTasks.get(url);
    if (existing) return existing;
    const task = loadGltf(file)
      .then((gltf) => {
        loadedSources.set(url, gltf.scene);
        loadedSourceFiles.set(url, file);
        // The tier this replaces is no longer wanted: drop its cache entry
        // (the retiring view's clones keep its textures alive until they go).
        if (residentFile !== undefined && residentFile !== file) releaseGltf(residentFile);
        sourceLoadTasks.delete(url);
      })
      .catch((err) => {
        sourceLoadTasks.delete(url);
        throw err;
      });
    sourceLoadTasks.set(url, task);
    return task;
  }

  /**
   * The painted buildings follow the graphics profile (their texture tier).
   * `target` is the profile about to be activated: a rebuild prepares its
   * assets BEFORE the live settings switch, so the tier comes from the target.
   */
  function prepareProfileAssets(
    target: Pick<GfxSettings, 'placedTextureTier'> = GFX,
  ): Promise<void> {
    return Promise.all(urls.map((url) => prepareSource(url, target.placedTextureTier))).then(
      () => undefined,
    );
  }

  /** Nothing is extracted from the sources, so a rebuild has no derived
   *  cache to drop: the next view reads each building from the source its
   *  tier loaded. */
  function resetProfileCaches(): void {}

  function registerPreloads(): void {
    for (const url of urls) registerDeferredPreload(() => prepareSource(url));
  }

  /** Stable-ID matching only; the props caller applies the built-in-world gate. */
  function isRebuildBuilding(building: BuildingDef): boolean {
    return building.id !== undefined && ids.has(building.id);
  }

  function emptyView(group: THREE.Group): PlacedTownView {
    group.userData.drawStats = placedTownDrawStats(group);
    return {
      group,
      update: () => undefined,
      setRevealGate: () => undefined,
      staticRevealRoots: () => [],
    };
  }

  function buildFromSources(
    sources: ReadonlyMap<string, THREE.Object3D>,
    groundAt: GroundAt,
    builtInWorld: boolean,
  ): PlacedTownView {
    const group = new THREE.Group();
    group.name = spec.rootName;
    group.userData.layoutId = spec.layoutId;
    group.userData.builtInOnly = true;
    group.userData.assetUrls = builtInWorld ? urls : [];
    group.userData.buildingIds = [];
    group.userData.buildingFadeTargetCount = 0;
    // the previous view's rooms go with it: a world without the town keeps no air
    interiors.clear();
    if (!builtInWorld) return emptyView(group);

    const hideTargets: BuildingHideTarget[] = [];
    const roots: THREE.Object3D[] = [];
    // The document may own the town's BUILDINGS as placements (the
    // promoted-scenery contract): the building loop stands down.
    const buildings = activeWorldPromoted(spec.promotedBy) ? [] : spec.buildings;
    for (const building of buildings) {
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`${spec.town} town building is missing: ${building.assetId}`);
      const built = buildPlacedTownBuilding(
        spec.town,
        building,
        source,
        groundAt,
        spec.decorate?.(building.id),
      );
      built.group.userData.placementId = building.id;
      // its rooms go to the indoor camera (placed_town_interiors.ts), and its doors to the
      // fade: a player stepping in sees in through one (fenbridge_town_visibility_core.ts)
      const interior = interiors.add(building, groundAt);
      const doorways = interior?.openings.map((opening) => interior.boxes[opening.box]);
      group.add(built.group);
      hideTargets.push({
        group: built.group,
        materials: built.mats,
        interiors: built.interiors,
        interiorsVisible: true,
        hidden: false,
        alpha: 1,
        x: building.position.x,
        z: building.position.z,
        halfWidth: building.nativeDimensions.width / 2,
        halfDepth: building.nativeDimensions.depth / 2,
        cosine: Math.cos(building.rotation),
        sine: Math.sin(building.rotation),
        topY: built.topY,
        cullRadius: built.cullRadius,
        walkIn: building.walkIn,
        doorways,
        doorwayFrame: interior?.frame,
      });
      roots.push(built.group);
    }
    group.userData.buildingIds = buildings.map((building) => building.id);
    group.userData.buildingFadeTargetCount = hideTargets.length;
    group.userData.drawStats = placedTownDrawStats(group);
    for (const root of roots) prepareSceneryDetailRoot(root);

    // Every root is a building, anchored at its own footprint, so each can
    // take the reach floor (town_reveal_core.ts).
    const piecewise = newTownPiecewiseReveal(
      spec.revealKey,
      roots,
      hideTargets.map((target) => target.x),
      hideTargets.map((target) => target.z),
      hideTargets.map(() => true),
    );
    const visibilityPlan = newFenbridgeBuildingVisibilityPlan();
    let revealGate: RevealGateCore | null = null;
    let revealed = false;
    // The gate asks for the roots the moment the consult fires the request,
    // so these are the CAMERA's coordinates of that very frame.
    let lastCamX = 0;
    let lastCamZ = 0;
    const orderedRoots: THREE.Object3D[] = [];
    return {
      group,
      setRevealGate(gate: RevealGateCore | null): void {
        revealGate = gate;
      },
      staticRevealRoots(): readonly THREE.Object3D[] {
        return orderTownRootsNearestFirst(
          roots,
          piecewise.x,
          piecewise.z,
          lastCamX,
          lastCamZ,
          orderedRoots,
        );
      },
      update(
        camX: number,
        camY: number,
        camZ: number,
        eyeX: number,
        eyeY: number,
        eyeZ: number,
        fogFar: number,
        dt: number,
        reducedMotion = false,
      ): void {
        if (hideTargets.length === 0) return;
        lastCamX = camX;
        lastCamZ = camZ;
        const lowCull = isLowSceneryCullActive(fogFar);
        const structureFar = sceneryStructureFar(fogFar);
        const cullX = lowCull ? eyeX : camX;
        const cullZ = lowCull ? eyeZ : camZ;
        const hubDx = cullX - spec.hub.center.x;
        const hubDz = cullZ - spec.hub.center.z;
        const reveal = townStaticReveal(
          fenbridgeFogVisible(
            cullX,
            cullZ,
            spec.hub.center.x,
            spec.hub.center.z,
            structureFar,
            cullRadius,
          ),
          revealed,
          hubDx * hubDx + hubDz * hubDz,
          cullRadius,
          revealGate,
          spec.revealKey,
        );
        if (reveal === 'revealed') revealed = true;
        // While the key is held, each building that has linked comes in on
        // its own, nearest first.
        townPiecewiseRevealInto(piecewise, reveal, camX, camZ, revealGate);
        for (let index = 0; index < hideTargets.length; index++) {
          const target = hideTargets[index];
          fenbridgeBuildingVisibilityPlanInto(
            visibilityPlan,
            target,
            target.hidden,
            camX,
            camY,
            camZ,
            eyeX,
            eyeY,
            eyeZ,
            structureFar,
            cullX,
            cullZ,
          );
          target.group.visible =
            visibilityPlan.visible && townRootVisible(reveal, piecewise, index);
          if (!visibilityPlan.visible) continue;
          const bDx = cullX - target.x;
          const bDz = cullZ - target.z;
          const interiorReach = target.cullRadius + 6;
          const showInteriors =
            !lowCull ||
            visibilityPlan.hidden ||
            bDx * bDx + bDz * bDz <= interiorReach * interiorReach;
          if (target.interiorsVisible !== showInteriors) {
            target.interiorsVisible = showInteriors;
            for (let i = 0; i < target.interiors.length; i++) {
              target.interiors[i].visible = showInteriors;
            }
          }
          prefetchOccluderFadeWithin(target.materials, target.x, target.z, camX, camZ);
          target.hidden = visibilityPlan.hidden;
          target.alpha = advanceOccluderFade(
            target.materials,
            target.alpha,
            target.hidden,
            dt,
            reducedMotion,
          );
        }
      },
    };
  }

  function buildView(seed: number): PlacedTownView {
    // Data-gated, not identity-gated: an editor copy of the built-in world
    // still carries the town's buildings and must get its real art
    // (authored_town_gate.ts).
    if (!activeWorldHasAuthoredTown(isRebuildBuilding)) {
      return buildFromSources(new Map(), () => 0, false);
    }
    for (const url of urls) {
      if (!loadedSources.has(url))
        throw new Error(`${spec.town} town asset was not preloaded: ${url}`);
    }
    return buildFromSources(loadedSources, (x, z) => terrainHeight(x, z, seed), true);
  }

  return {
    urls,
    cullRadius,
    prepareProfileAssets,
    resetProfileCaches,
    registerPreloads,
    isRebuildBuilding,
    buildView,
    /** Test-only: build from given sources without the loader. */
    buildFromSources,
  };
}

// A PLACED town building: one of the painted Tidehold models stood in a
// built-in town at the anchor, turn, size and seat its layout record gives it
// (makePlacedBuilding in sim/eastbrook_layout.ts, whose anchors are the Studio
// rebuild map's, in sim/fenbridge_layout.ts, and makePlacedTownBuilding in
// sim/placed_town_kit.ts for Highwatch), drawn with its own materials. Every
// town stands its painted buildings through this module. The
// town view owns everything around it (the reveal gate, the fog cull, the
// camera fade); this module only builds the group.
//
// It mirrors what render/placed_assets.ts does for the same file on an
// authored map, so the built-in town and the map show the same building:
//   - the seat: the model's lowest point rests on the terrain under its own
//     origin, then the authored lift buries the footing;
//   - the size: one uniform scale, never the per-axis fit the kit shells take;
//   - the glow: a weakly authored emissive channel is lifted over the bloom
//     threshold, exactly as a placed asset's is;
//   - the file: the profile's texture tier of the model, same geometry.
// Two surface touches ride on top, both plain material values (no shader
// layer, no new program, and a clone, the camera fade's twin included, copies
// both): the baked relief is lifted per atlas role, and each building's walls
// and roof take a small seeded colour variation (placed_building_surface_core.ts).
// One shader layer rides the re-baked walls only (painted_wall_detail.ts): their
// atlas alpha is a stone mask the layer keeps out of opacity, and on the Standard
// tiers a shared tiling detail normal carries the stones' relief. It is decided
// per mesh (the re-baked walls carry uv1, the looks do not) and re-attached on
// every hook-preserving clone, so the fade twin keys the same program.
import * as THREE from 'three';
import type { PaintedTownId } from '../sim/painted_towns';
import { GFX } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { type OccluderFadeMat, occluderFadeRecordFor } from './occluder_fade';
import { applyPaintedWallDetail } from './painted_wall_detail';
import {
  placedBuildingReliefScale,
  placedBuildingSurfaceRole,
  placedBuildingTint,
} from './placed_building_surface_core';

/** What a placed building record carries: every town's makePlacedBuilding
 *  builds this shape. */
export interface PlacedTownBuildingRecord {
  readonly id: string;
  readonly assetId: string;
  readonly position: { readonly x: number; readonly z: number };
  readonly rotation: number;
  readonly nativeDimensions: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly frontStandingPoint: { readonly x: number; readonly z: number };
  readonly placement: {
    readonly x: number;
    readonly z: number;
    readonly rotation: number;
    readonly scale: number;
    readonly lift: number;
  };
  readonly reach: {
    readonly center: { readonly x: number; readonly z: number };
    readonly halfWidth: number;
    readonly halfDepth: number;
  };
}

/** Which town stands the building: names its group and its id field. */
export type PlacedTown = 'eastbrook' | 'fenbridge' | 'highwatch' | PaintedTownId;

const PLACED_BUILDING_ASSET_PREFIX = '/models/tidehold/';

/** The emissive floor render/placed_assets.ts lifts a placed model's glow to
 *  (its MIN_NATIVE_EMISSIVE_INTENSITY): the painted walls author their lit
 *  panes at 1, under the bloom threshold, so unlifted they never glow. */
export const PLACED_BUILDING_EMISSIVE_FLOOR = 2.2;

/** Nodes holding a model's furniture. Indoors, so they never cast a shadow
 *  anyone can see; they still draw, through every door and pane. */
const INTERIOR_NODE_PREFIX = 'G_INT';

export function isPlacedBuildingAsset(url: string): boolean {
  return url.startsWith(PLACED_BUILDING_ASSET_PREFIX);
}

/** Whether a mesh hangs under one of the model's interior groups. */
export function isPlacedBuildingInterior(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.name.startsWith(INTERIOR_NODE_PREFIX)) return true;
  }
  return false;
}

type PlacedSourceMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
};

function liftWeakEmissive(material: PlacedSourceMaterial): void {
  const emissive = material.emissive;
  const intensity = material.emissiveIntensity;
  if (!emissive || intensity === undefined) return;
  if (emissive.r <= 0 && emissive.g <= 0 && emissive.b <= 0) return;
  if (intensity > 0 && intensity < PLACED_BUILDING_EMISSIVE_FLOOR) {
    material.emissiveIntensity = PLACED_BUILDING_EMISSIVE_FLOOR;
  }
}

/** Which standing building a material clone dresses: seeds its colour variation. */
export interface PlacedBuildingLook {
  readonly town: PlacedTown;
  readonly buildingId: string;
}

/** userData key recording the relief factor already applied to a material, so
 *  a second pass (a clone of a clone, a future load-time pass) never stacks. */
const RELIEF_APPLIED_KEY = 'placedBuildingRelief';

/** Lift the baked relief of a painted material by its role's factor (both
 *  normalScale components, so the loader's tangent sign survives). Idempotent. */
function liftBakedRelief(material: THREE.MeshStandardMaterial): void {
  if (!material.normalMap || material.userData[RELIEF_APPLIED_KEY] !== undefined) return;
  const scale = placedBuildingReliefScale(material.name);
  material.normalScale.multiplyScalar(scale);
  material.userData[RELIEF_APPLIED_KEY] = scale;
}

function tintForLook(
  material: THREE.Material,
  look: PlacedBuildingLook | undefined,
): readonly [number, number, number] | null {
  if (!look) return null;
  return placedBuildingTint(look.town, look.buildingId, placedBuildingSurfaceRole(material.name));
}

/**
 * The per-building clone of one of the model's materials. The Standard tiers
 * keep the GLB material whole; the Lambert tiers downgrade like every town
 * material, carrying everything a Lambert can still say about it (the leaf
 * cards' cutout and both-sides draw included, or they would draw as solid
 * quads). `look` names the standing building, for its colour variation;
 * `geometry` is the mesh's, which says whether its walls were re-baked
 * (painted_wall_detail.ts takes the material on both arms when they were).
 */
export function placedBuildingMaterial(
  source: THREE.Material,
  look?: PlacedBuildingLook,
  geometry?: THREE.BufferGeometry,
): THREE.Material {
  const tint = tintForLook(source, look);
  if (GFX.standardMaterials) {
    // The hook-preserving clone and nothing more: the camera fade's gate twin
    // (occluder_fade_gate.ts) is cloned the same way, so the program the twin
    // links is the program the fade flips to. A shader layer the clone-hook
    // registry does not carry (the loader's leaf edge fade) is deliberately
    // not copied by hand: the twin would not carry it, and the first fade
    // would link its program cold in a live frame. The leaf cards keep their
    // authored cutout. The relief lift and the tint are uniform VALUES, which
    // the twin's own clone copies, so they key no program of their own.
    const clone = cloneMaterialWithHooks(source) as PlacedSourceMaterial;
    liftWeakEmissive(clone);
    const standard = clone as THREE.MeshStandardMaterial;
    if (standard.isMeshStandardMaterial) liftBakedRelief(standard);
    if (tint && clone.color) clone.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
    // Last, over the hook-preserving clone, where material_clone_hooks.ts re-attaches it.
    applyPaintedWallDetail(clone, geometry);
    return clone;
  }
  const from = source as PlacedSourceMaterial;
  const lambert = new THREE.MeshLambertMaterial({
    map: from.map ?? null,
    color: from.color?.clone() ?? new THREE.Color(0xffffff),
    vertexColors: source.vertexColors,
    side: source.side,
    alphaTest: source.alphaTest,
    transparent: source.transparent,
    opacity: source.opacity,
    depthWrite: source.depthWrite,
  });
  if (tint) lambert.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
  if (from.emissive) lambert.emissive = from.emissive.clone();
  if (from.emissiveMap) lambert.emissiveMap = from.emissiveMap;
  if (from.emissiveIntensity !== undefined) lambert.emissiveIntensity = from.emissiveIntensity;
  lambert.name = source.name;
  // The Lambert walls carry no normal map: only the mask guard, so a transparent fade
  // never reads the atlas's stone mask as coverage.
  applyPaintedWallDetail(lambert, geometry);
  return lambert;
}

export interface PlacedBuildingBuild {
  group: THREE.Group;
  /** One fade record per (material, mesh shape) of the building. */
  mats: OccluderFadeMat[];
  /** Indoor furniture meshes (G_INT / *_INT_*) that only need to draw close up. */
  interiors: THREE.Object3D[];
  /** World height of the model's top, for the camera-fade box. */
  topY: number;
  /** From the record's own centre out to the farthest corner the model
   *  reaches (its porch, stair and eaves), for the fog cull. */
  cullRadius: number;
}

/**
 * Stand `source` (the loaded model scene) in `town` for `building`.
 * `groundAt` is the terrain height under a world point.
 */
export function buildPlacedTownBuilding(
  town: PlacedTown,
  building: PlacedTownBuildingRecord,
  source: THREE.Object3D,
  groundAt: (x: number, z: number) => number,
  extras: readonly THREE.Object3D[] = [],
): PlacedBuildingBuild {
  const { placement } = building;
  const clone = source.clone(true);
  // Bounds while the clone is parentless at the origin: the model's own frame.
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  // A town's own additions to a model (in the model's frame, inside its bounds): they join
  // the building before its materials convert, so they fade, cull and reveal with it.
  for (const extra of extras) clone.add(extra);

  const mats: OccluderFadeMat[] = [];
  const interiors: THREE.Object3D[] = [];
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const isInterior = isPlacedBuildingInterior(child) || /_INT(?:_|$)/.test(child.name);
    if (isInterior) interiors.push(child);
    child.castShadow = !isInterior;
    child.receiveShadow = true;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    const look: PlacedBuildingLook = { town, buildingId: building.id };
    const cloned = list.map((material) => placedBuildingMaterial(material, look, child.geometry));
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
    for (const material of cloned) occluderFadeRecordFor(mats, material, child);
  });

  const wrap = new THREE.Group();
  wrap.add(clone);
  wrap.scale.setScalar(placement.scale);

  const ground = groundAt(placement.x, placement.z);
  const group = new THREE.Group();
  group.name = `${town}Building:${building.id}`;
  group.userData[`${town}BuildingId`] = building.id;
  group.userData.assetId = building.assetId;
  group.userData.assetUrl = building.assetId;
  group.userData.position = building.position;
  group.userData.rotation = building.rotation;
  group.userData.target = building.nativeDimensions;
  group.userData.front = building.frontStandingPoint;
  group.userData.placement = placement;
  // The footing is the model's own, buried by the lift: no skirt is drawn.
  group.userData.foundationDepth = 0;
  group.position.set(
    placement.x,
    ground - box.min.y * placement.scale + placement.lift,
    placement.z,
  );
  group.rotation.y = placement.rotation;
  group.add(wrap);

  return {
    group,
    mats,
    interiors,
    topY: ground + building.nativeDimensions.height,
    cullRadius: placedBuildingCullRadius(building),
  };
}

/** A placed building's own cull circle round its position: far enough to hold
 *  its whole reach (eaves, annexes, the model's widest point). */
export function placedBuildingCullRadius(
  building: Pick<PlacedTownBuildingRecord, 'position' | 'reach'>,
): number {
  const reach = building.reach;
  return (
    Math.hypot(reach.center.x - building.position.x, reach.center.z - building.position.z) +
    Math.hypot(reach.halfWidth, reach.halfDepth)
  );
}

/** Eastbrook's placed building (sim/eastbrook_layout.ts). */
export function buildEastbrookPlacedBuilding(
  building: PlacedTownBuildingRecord,
  source: THREE.Object3D,
  groundAt: (x: number, z: number) => number,
): PlacedBuildingBuild {
  return buildPlacedTownBuilding('eastbrook', building, source, groundAt);
}

// The built-in world's renderer-owned scenery (render/props.ts buildProps and
// the zones' great-tree builders) as editable placements that draw EXACTLY
// what the game draws.
//
// Each family below mirrors its render/props.ts block call for call: the same
// group position and rotation, then each addParts / addInstance part's own
// offset, rotation and scale. gamePropPlacement composes that chain into one
// matrix and turns it into a placement, accounting for the two ways the game
// prepares a model that a placement does not:
//   - propAsset bakes PROP_ASSET_DEFS[key].yaw into the geometry and then
//     recentres it (footprint centre at the origin, base at y = 0);
//   - the game scales the model in its OWN units, while a placed asset first
//     normalizes the GLB to targetHeightFor(path) / its largest dimension.
// So the placement's uniform scale undoes that normalization (natural units),
// its axis scales and rotation are the decomposed chain, and its position is
// where the chain puts the GLB's own origin (PROP_NATURAL_SIZE carries each
// model's footprint centre and base for that).
//
// An earlier conversion fitted every model to a target box measured from its
// COLLISION boxes, which is not the drawn model: a mud hut's mushroom came out
// five times the size the game draws it, and a tent nearly twice as wide.
// world_prop_placements.ts keeps that version as legacyWorldMajorPropPlacements
// only to recognise (and upgrade) placements older documents saved from it.
//
// Not reproducible as placements, and left out: props.ts's hand-built meshes
// (a mud hut's doorway decal, a mine's dark mouth and lantern glass, the delve
// arch's animated void) and material-level looks (the cart's stripped awning,
// a zone's tinted bark), and the delve approach's hand-built braziers.

import * as THREE from 'three';
import { targetHeightFor } from '../render/asset_scale';
import {
  isEastbrookRebuildBuilding,
  isEastbrookRebuildFence,
  isEastbrookRebuildStall,
  isEastbrookRebuildWell,
} from '../render/eastbrook_town';
import {
  isFenbridgeRebuildBuilding,
  isFenbridgeRebuildStall,
  isFenbridgeRebuildWell,
} from '../render/fenbridge_town';
import { isHighwatchRebuildBuilding } from '../render/highwatch_town';
import { isPaintedTownRebuildBuilding } from '../render/painted_towns';
import { PROP_NATURAL_SIZE } from '../render/prop_natural_size.generated';
import {
  buildingAssetPick,
  HOUSE_HEIGHT,
  MUDFIN_HUT_PROP_KEYS,
  PROP_ASSET_DEFS,
  type PropKey,
} from '../render/props';
import { EVERGARDEN_PROPS } from '../sim/content/evergarden';
import { PALMREACH_PROPS } from '../sim/content/palmreach';
import { REALM_PROPS } from '../sim/content/realm';
import { WRAITHWOOD_PROPS } from '../sim/content/wraithwood';
import {
  DOCK_SECTION_LOCAL_Z,
  DOCK_SECTION_SURFACE_Y,
  dockSurfaceLine,
  dockSurfaceYAt,
} from '../sim/dock_layout';
import type { MapPlacement } from '../sim/map_doc';
import { MUDFIN_HUT_MODELS, mudfinHutAt } from '../sim/mudfin_huts';
import {
  CHAPEL_HALL,
  CHAPEL_TOWER,
  DELVE_ARCH_SCALE,
  DOCK_BOAT,
  DOCK_DRESSING,
  delveArchMouthSign,
  delveArchZ,
  propPlacementRoll as propRand,
  ruinRingColumns,
} from '../sim/prop_layout';
import { hash2 } from '../sim/rng';
import type { ZonePropsDef } from '../sim/types';
import {
  reachPalmRenderedHeight,
  reachPalmSpots,
  terrainHeight,
  WATER_LEVEL,
  waterLevel,
} from '../sim/world';

/** props.ts keyRand, the per-record roll its stalls, docks and houses use. */
function keyRand(key: number, n: number): number {
  return hash2(Math.round(key * 97), n * 7919, 0x9e3779);
}

function cleanZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
}

type Scale = number | readonly [number, number, number];

/** One addParts / addInstance call: the part's offset, rotation and scale
 *  inside its parent (props.ts: euler wins over rot, rot is a plain yaw). */
export interface GamePart {
  x?: number;
  y?: number;
  z?: number;
  rot?: number;
  euler?: THREE.Euler;
  scale: Scale;
}

const UP = new THREE.Vector3(0, 1, 0);

/** The size props.ts's propAsset reports for a model: its bounds after the
 *  def's baked yaw (the shipped yaws are quarter turns, so x and z swap). */
export function gamePropSize(key: PropKey): { x: number; y: number; z: number } {
  const n = PROP_NATURAL_SIZE[key];
  if (!n) throw new Error(`No natural size for prop ${key}`);
  const quarter = Math.abs(Math.sin(PROP_ASSET_DEFS[key].yaw ?? 0)) > 0.5;
  return quarter ? { x: n.z, y: n.y, z: n.x } : { x: n.x, y: n.y, z: n.z };
}

function assetIdOf(url: string): string {
  return url
    .replace(/^\/+/, '')
    .replace(/^models\//, '')
    .replace(/\.glb$/i, '');
}

/** A group's matrix: props.ts `g.position.set(x, y, z)` + its rotation. */
export function groupMatrix(
  x: number,
  y: number,
  z: number,
  rotation: number | THREE.Euler = 0,
  scale = 1,
): THREE.Matrix4 {
  const euler = typeof rotation === 'number' ? new THREE.Euler(0, rotation, 0) : rotation;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(euler),
    new THREE.Vector3(scale, scale, scale),
  );
}

/**
 * The placement that draws `key` exactly where props.ts draws it: `parent` is
 * the world matrix of the group the part was added to, `part` the addParts
 * options. Collides by the model's baked boxes, as every converted world prop
 * always has.
 */
export function gamePropPlacement(
  key: PropKey,
  name: string,
  parent: THREE.Matrix4,
  part: GamePart,
  seed: number,
): MapPlacement {
  const def = PROP_ASSET_DEFS[key];
  const natural = PROP_NATURAL_SIZE[key];
  if (!natural) throw new Error(`No natural size for prop ${key}`);
  const yaw = def.yaw ?? 0;
  const scale =
    typeof part.scale === 'number'
      ? new THREE.Vector3(part.scale, part.scale, part.scale)
      : new THREE.Vector3(part.scale[0], part.scale[1], part.scale[2]);
  const holder = new THREE.Matrix4().compose(
    new THREE.Vector3(part.x ?? 0, part.y ?? 0, part.z ?? 0),
    new THREE.Quaternion().setFromEuler(part.euler ?? new THREE.Euler(0, part.rot ?? 0, 0)),
    scale,
  );
  // propAsset: raw GLB -> baked yaw -> recentred on the yawed footprint centre
  // with its base at y = 0. Composed, the GLB's own origin lands at `origin`.
  const centre = new THREE.Vector3(natural.cx, 0, natural.cz).applyAxisAngle(UP, yaw);
  const chain = parent
    .clone()
    .multiply(holder)
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -natural.minY, -centre.z))
    .multiply(new THREE.Matrix4().makeRotationY(yaw));
  const origin = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const axes = new THREE.Vector3();
  chain.decompose(origin, rotation, axes);
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
  const assetId = assetIdOf(def.url);
  const maxDim = Math.max(natural.x, natural.y, natural.z);
  return {
    assetId,
    name,
    x: cleanZero(origin.x),
    z: cleanZero(origin.z),
    // PlacedAssetsView seats the origin at ground - minY * scaleY + y
    y: cleanZero(origin.y - terrainHeight(origin.x, origin.z, seed) + natural.minY * axes.y),
    rotX: cleanZero(euler.x),
    rotY: cleanZero(euler.y),
    rotZ: cleanZero(euler.z),
    scale: maxDim / targetHeightFor(`/models/${assetId}.glb`),
    scaleX: axes.x,
    scaleY: axes.y,
    scaleZ: axes.z,
    collide: true,
    collisionMode: 'baked',
  };
}

/** Mark a converted rail as a fence (jump-aware crossing, the isFence OBB)
 *  whose collider spans `width` x `depth` yards. */
function asFence(p: MapPlacement, width: number, depth: number): MapPlacement {
  p.worldPropKind = 'fence';
  p.worldPropWidth = width / (p.scale * (p.scaleX ?? 1));
  p.worldPropDepth = depth / (p.scale * (p.scaleZ ?? 1));
  return p;
}

// render/props.ts town fences: module lengths per kind.
const STONE_WALL_SCALE = 4.2;
const STONE_MODULE_LEN = 1.155 * STONE_WALL_SCALE;
const PALISADE_MODULE_LEN = 2.0;
const PALISADE_SEG = 6.4;
const WOOD_FENCE_DEPTH = 0.35;

/** render/props.ts's delve-approach rubble (rockLargeD), in the arch's frame. */
const DELVE_BOULDERS = [
  { dx: -8.5, dz: -1.8, s: 1.7, rot: 2.1 },
  { dx: 8.0, dz: 2.2, s: 1.45, rot: 0.7 },
] as const;

/** The great-tree model (foliage/twisted_1.glb): its largest dimension and
 *  base, measured from the GLB (pinned by tests/world_prop_conversion.test.ts). */
export const GREAT_TREE_MODEL = { maxDim: 16.4, minY: -0.2015 } as const;

/**
 * One great tree's raw scale and yaw, per the zone module that draws it, or
 * null when no module draws a giant there: the Nightbloom's elders are trunk
 * colliders whose crowns come from the zone's foliage pass, and the realm
 * draws only its first record. Those records stay records
 * (isConvertedGreatTree, withoutEditableWorldProps keeps them colliding).
 */
function greatTreeLook(
  tree: { x: number; z: number; r: number },
  seed: number,
): { scale: number; rot: number } | null {
  const is = (props: ZonePropsDef) =>
    (props.greatTrees ?? []).some((t) => t.x === tree.x && t.z === tree.z);
  const realm = REALM_PROPS.greatTrees?.[0];
  if (realm && realm.x === tree.x && realm.z === tree.z) return { scale: 6.5, rot: 0.8 };
  if (is(REALM_PROPS)) return null;
  if (is(PALMREACH_PROPS)) {
    // render/jungle_features.ts
    return {
      scale: tree.r * (2.5 + hash2(tree.x, tree.z, seed + 5201) * 0.5),
      rot: hash2(tree.z, tree.x, seed + 5211) * Math.PI * 2,
    };
  }
  if (is(EVERGARDEN_PROPS)) {
    // render/garden_features.ts
    return {
      scale: tree.r * (2.4 + hash2(tree.x, tree.z, seed + 6301) * 0.5),
      rot: hash2(tree.z, tree.x, seed + 6311) * Math.PI * 2,
    };
  }
  if (is(WRAITHWOOD_PROPS)) {
    // render/haunt_features.ts
    return {
      scale: tree.r * (2.4 + hash2(tree.x, tree.z, seed + 4101) * 0.5),
      rot: hash2(tree.z, tree.x, seed + 4111) * Math.PI * 2,
    };
  }
  return null;
}

/** Whether a great-tree record becomes a placement (a zone module draws it,
 *  on dry ground). The rest stay records, so their trunks keep colliding. */
export function isConvertedGreatTree(
  tree: { x: number; z: number; r: number },
  seed: number,
): boolean {
  if (greatTreeLook(tree, seed) === null) return false;
  // the realm's giant stands wherever it is; the others skip a drowned spot
  const realm = REALM_PROPS.greatTrees?.[0];
  const isRealm = realm !== undefined && realm.x === tree.x && realm.z === tree.z;
  return isRealm || terrainHeight(tree.x, tree.z, seed) >= WATER_LEVEL;
}

/** Expand the built-in world's renderer-owned scenery into placements. */
export function worldMajorPropPlacements(
  props: ZonePropsDef,
  seed = 20061,
  includePalms = false,
): MapPlacement[] {
  const out: MapPlacement[] = [];
  const ground = (x: number, z: number) => terrainHeight(x, z, seed);
  const add = (key: PropKey, name: string, parent: THREE.Matrix4, part: GamePart) => {
    const placement = gamePropPlacement(key, name, parent, part, seed);
    out.push(placement);
    return placement;
  };

  // ---- buildings (props.ts "buildings: village houses / inn / composed chapel")
  props.buildings.forEach((b, index) => {
    // The authored towns draw their own buildings (eastbrook_town.ts,
    // fenbridge_town.ts, highwatch_town.ts, painted_towns.ts; the authoredTowns,
    // highwatchTown and paintedTowns promotion families own them).
    if (
      isEastbrookRebuildBuilding(b) ||
      isFenbridgeRebuildBuilding(b) ||
      isHighwatchRebuildBuilding(b) ||
      isPaintedTownRebuildBuilding(b)
    ) {
      return;
    }
    const label = `Building ${index + 1}`;
    const y = ground(b.x, b.z);
    if (b.kind === 'chapel') {
      const tower = gamePropSize('bellTower');
      const chapel = groupMatrix(b.x, y - CHAPEL_HALL.sink, b.z, b.rot);
      add('bellTower', `${label} tower`, chapel, {
        z: CHAPEL_TOWER.dz,
        scale: [
          (b.w * CHAPEL_TOWER.wScale) / tower.x,
          CHAPEL_TOWER.height / tower.y,
          (b.d * CHAPEL_TOWER.dScale) / tower.z,
        ],
      });
      const hall = gamePropSize('house3');
      add('house3', `${label} hall`, chapel, {
        z: b.d / 2 - CHAPEL_HALL.dzFromFront,
        scale: [
          (b.w * CHAPEL_HALL.wScale) / hall.x,
          CHAPEL_HALL.height / hall.y,
          CHAPEL_HALL.depth / hall.z,
        ],
      });
      return;
    }
    const asset = buildingAssetPick(b);
    const size = gamePropSize(asset);
    const placement = add(asset, label, groupMatrix(b.x, y - 0.12, b.z, b.rot), {
      scale: [b.w / size.x, HOUSE_HEIGHT[asset] / size.y, b.d / size.z],
    });
    if (b.kind === 'inn') {
      // the inn's resting area spans the building's own footprint
      placement.worldPropKind = 'inn';
      placement.worldPropWidth = b.w / (placement.scale * (placement.scaleX ?? 1));
      placement.worldPropDepth = b.d / (placement.scale * (placement.scaleZ ?? 1));
    }
  });

  // ---- town fences (wood rail, low stone wall, log palisade)
  let fenceIndex = 0;
  for (const f of props.fences) {
    if (isEastbrookRebuildFence(f)) continue;
    const len = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
    if (len <= 0) continue;
    const stone = f.kind === 'stone';
    const palisade = f.kind === 'palisade';
    const n = Math.max(
      1,
      Math.round(len / (stone ? STONE_MODULE_LEN : palisade ? PALISADE_SEG : 2.35)),
    );
    const dirx = (f.x2 - f.x1) / len;
    const dirz = (f.z2 - f.z1) / len;
    const yaw = stone ? Math.atan2(dirx, dirz) : Math.atan2(-dirz, dirx);
    // the rail collider the sim builds from the record (colliders.ts)
    const depth = f.width ?? WOOD_FENCE_DEPTH;
    for (let i = 0; i < n; i++) {
      const x0 = f.x1 + (f.x2 - f.x1) * (i / n);
      const z0 = f.z1 + (f.z2 - f.z1) * (i / n);
      const x1 = f.x1 + (f.x2 - f.x1) * ((i + 1) / n);
      const z1 = f.z1 + (f.z2 - f.z1) * ((i + 1) / n);
      const g0 = ground(x0, z0);
      const g1 = ground(x1, z1);
      const pitch = Math.atan2(g1 - g0, len / n);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const name = `Fence ${++fenceIndex}`;
      const root = new THREE.Matrix4();
      if (stone) {
        // The low stone wall runs along its local z, and the placement rail
        // (worldPropKind 'fence') assumes local x, so it collides by its
        // baked boxes, a solid low wall.
        const segScale = (len / n / STONE_MODULE_LEN) * STONE_WALL_SCALE;
        add('hexFenceStone', name, root, {
          x: mx,
          y: (g0 + g1) / 2 - 0.12,
          z: mz,
          euler: new THREE.Euler(-pitch, yaw, 0, 'YXZ'),
          scale: [STONE_WALL_SCALE, STONE_WALL_SCALE, segScale],
        });
        continue;
      }
      if (palisade) {
        const p = add('hexnPalisade', name, root, {
          x: mx,
          y: (g0 + g1) / 2 - 0.15,
          z: mz,
          euler: new THREE.Euler(0, yaw, pitch, 'YZX'),
          scale: [len / n / PALISADE_MODULE_LEN, 3.2, 1.8],
        });
        asFence(p, len / n, depth);
        continue;
      }
      const sy = 2.9 + (propRand(mx, mz, 1) - 0.5) * 0.5;
      const p = add('fence', name, root, {
        x: mx,
        y: (g0 + g1) / 2 - 0.05,
        z: mz,
        euler: new THREE.Euler(0, yaw, pitch, 'YZX'),
        scale: [3.0, sy, 3.0],
      });
      asFence(p, len / n, depth);
    }
  }

  // ---- market stalls (smith and armorer stalls carry an anvil and a rack)
  props.stalls.forEach((s, index) => {
    if (isEastbrookRebuildStall(s) || isFenbridgeRebuildStall(s)) return;
    const key = s.x * 7.7 + s.z * 2.3;
    const label = `Market stall ${index + 1}`;
    const stall = groupMatrix(s.x, ground(s.x, s.z) - 0.06, s.z, s.rot);
    const standKey: PropKey = index % 2 === 0 ? 'stand1' : 'stand2';
    const stand = gamePropSize(standKey);
    add(standKey, label, stall, {
      scale: [3.1 / stand.x, 2.6 / stand.y, 2.5 / stand.z],
      rot: (keyRand(key, 1) - 0.5) * 0.1,
    });
    if (s.smithy) {
      add('anvil', `${label} anvil`, stall, { x: 1.35, z: 1.15, rot: 0.9, scale: 1.35 });
      add('weaponStand', `${label} weapon rack`, stall, {
        x: -1.45,
        z: 0.6,
        rot: 0.5 + Math.PI,
        scale: 1.25,
      });
    } else {
      add('farmCrate', `${label} produce crate`, stall, {
        x: 1.3,
        z: 1.05,
        rot: keyRand(key, 2) * Math.PI,
        scale: 1.5,
      });
      add('barrel', `${label} barrel`, stall, {
        x: -1.35,
        z: 0.85,
        rot: keyRand(key, 3) * Math.PI,
        scale: 1.15,
      });
    }
  });

  // ---- wells
  props.wells.forEach((w, index) => {
    if (isEastbrookRebuildWell(w) || isFenbridgeRebuildWell(w)) return;
    const size = gamePropSize('well');
    add(
      'well',
      `Well ${index + 1}`,
      groupMatrix(w.x, ground(w.x, w.z) - 0.1, w.z, propRand(w.x, w.z, 1) * Math.PI),
      { scale: [2.6 / size.x, 3.6 / size.y, 2.9 / size.z] },
    );
  });

  // ---- graveyards: four headstone shapes, leaning (instanced in props.ts)
  const graveKinds: PropKey[] = ['graveRound', 'graveCross', 'graveBevel', 'graveDecor'];
  props.graveyards.forEach((yard, yardIndex) => {
    for (let i = 0; i < 6; i++) {
      const gx = yard.x + (i % 3) * 2.2;
      const gz = yard.z + Math.floor(i / 3) * 2.6;
      add(
        graveKinds[i % graveKinds.length],
        `Graveyard ${yardIndex + 1} headstone ${i + 1}`,
        new THREE.Matrix4(),
        {
          x: gx,
          y: ground(gx, gz) - 0.06,
          z: gz,
          euler: new THREE.Euler(
            (propRand(gx, gz, 1) - 0.5) * 0.2,
            i * 0.4 + (propRand(gx, gz, 2) - 0.5) * 0.5,
            (propRand(gx, gz, 3) - 0.5) * 0.22,
          ),
          scale: 2.0 + keyRand(gx * 3 + gz, 4) * 0.5,
        },
      );
    }
  });

  // ---- campfires: the bonfire base (the flame rides placement.fire)
  props.campfires.forEach(([x, z], index) => {
    const p = add('bonfire', `Campfire ${index + 1}`, groupMatrix(x, ground(x, z), z), {
      y: -0.05,
      rot: propRand(x, z, 1) * Math.PI * 2,
      scale: 4.3,
    });
    p.fire = true;
  });

  // ---- bandit and war tents
  props.tents.forEach((t, index) => {
    const kind: PropKey = propRand(t.x, t.z, 2) < 0.55 ? 'tentOpen' : 'tentSmall';
    const size = gamePropSize(kind);
    const s = (3.0 * t.scale) / Math.max(size.x, size.z);
    add(
      kind,
      `Camp tent ${index + 1}`,
      groupMatrix(
        t.x,
        ground(t.x, t.z) - 0.06,
        t.z,
        new THREE.Euler(
          (propRand(t.x, t.z, 3) - 0.5) * 0.06,
          t.rot,
          (propRand(t.x, t.z, 4) - 0.5) * 0.06,
        ),
      ),
      { scale: [s, s * 1.32, s] },
    );
  });

  // ---- camp crates and barrels (a stack is one placement per level)
  props.crates.forEach(([x, z, stack], index) => {
    const barrel = index % 3 === 2;
    const kind: PropKey = barrel ? 'barrel' : 'crateWooden';
    const s = barrel ? 1.25 : 1.3 + propRand(x, z, 5) * 0.15;
    const unitH = barrel ? 1.13 : 0.878 * s;
    const pile = groupMatrix(x, ground(x, z) - 0.04, z);
    const base = `Camp ${barrel ? 'barrel' : 'crate'} ${index + 1}`;
    for (let level = 0; level < (stack ?? 1); level++) {
      add(kind, level === 0 ? base : `${base} level ${level + 1}`, pile, {
        y: level * unitH,
        euler: new THREE.Euler(
          level === 0 ? (propRand(x, z, 7) - 0.5) * 0.05 : 0,
          ((x * 13 + z * 7 + level * 5) % 1) * Math.PI,
          0,
        ),
        scale: s,
      });
    }
  });

  // ---- murloc mud huts: giant swamp mushrooms, a toadstool cluster at the foot
  const huts = props.mudHuts;
  const hutCenter = huts.reduce(
    (center, [x, z]) => ({ x: center.x + x / huts.length, z: center.z + z / huts.length }),
    { x: 0, z: 0 },
  );
  huts.forEach(([x, z], index) => {
    const hut = groupMatrix(x, ground(x, z), z);
    // the Mirefen camp's painted mudfin huts (sim/mudfin_huts.ts), no toadstools
    const mudfin = mudfinHutAt(x, z);
    if (mudfin) {
      const placement = add(MUDFIN_HUT_PROP_KEYS[mudfin.model], `Mud hut ${index + 1}`, hut, {
        y: -0.08,
        rot: mudfin.yaw,
        scale: 1,
      });
      // the solid wall the game builds for this hut (mudHutCollider), not a
      // generic circle guessed off the model's bounds
      placement.collisionMode = 'basic';
      placement.collideRadius = MUDFIN_HUT_MODELS[mudfin.model].radius;
      return;
    }
    const sxz = 13 + propRand(x, z, 15) * 3;
    const sy = 10.5 + propRand(x, z, 16) * 3;
    add('mushroomRed', `Mud hut ${index + 1}`, hut, {
      y: -0.15,
      scale: [sxz, sy, sxz],
      euler: new THREE.Euler(
        (propRand(x, z, 13) - 0.5) * 0.1,
        propRand(x, z, 12) * Math.PI * 2,
        (propRand(x, z, 14) - 0.5) * 0.1,
      ),
    });
    const face = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const around = face + 0.9 + propRand(x, z, 18);
    add('mushroomTan', `Mud hut ${index + 1} toadstools`, hut, {
      x: Math.sin(around) * 1.7,
      y: -0.05,
      z: Math.cos(around) * 1.7,
      rot: propRand(x, z, 19) * Math.PI * 2,
      scale: 2.6 + propRand(x, z, 20) * 1.4,
    });
  });

  // ---- ruin rings: the columns, then the toppled relics at the ring's heart
  props.ruinRings.forEach((ring, ringIndex) => {
    if (ring.bare || ring.columns <= 0) return;
    for (const col of ruinRingColumns(ring)) {
      const i = col.index;
      add(
        col.intact ? 'column' : 'columnBroken',
        `Ruin ${ringIndex + 1} column ${i + 1}`,
        groupMatrix(col.x, ground(col.x, col.z) - 0.1, col.z),
        {
          scale: [3.8, col.scaleY, 3.8],
          euler: new THREE.Euler(
            0,
            propRand(col.x, col.z, 8) * Math.PI,
            (i % 3 === 0 ? 0.13 : 0.03) * (i % 2 ? 1 : -1),
          ),
        },
      );
    }
    const relics = groupMatrix(ring.x - 2, ground(ring.x - 2, ring.z - 3), ring.z - 3);
    const label = `Ruin ${ringIndex + 1}`;
    add('statueHead', `${label} statue head`, relics, {
      x: -0.4,
      y: -0.55,
      z: 0.3,
      scale: 2.3,
      euler: new THREE.Euler(0.34, propRand(ring.x, ring.z, 30) * Math.PI * 2, 0.22),
    });
    add('statueBlock', `${label} statue block`, relics, {
      x: 2.1,
      y: -0.2,
      z: -1.3,
      rot: propRand(ring.x, ring.z, 31) * Math.PI,
      scale: 2.1,
    });
    add('column', `${label} fallen column`, relics, {
      x: -1.2,
      y: 0.62,
      z: -2.2,
      scale: 3.2,
      euler: new THREE.Euler(
        Math.PI / 2 - 0.06,
        0.6 + (propRand(ring.x, ring.z, 32) - 0.5) * 0.4,
        0,
        'YXZ',
      ),
    });
  });

  // ---- mine entrances: timber portal, rock mound, ore cart, lantern
  props.mines.forEach((m, mineIndex) => {
    const mine = groupMatrix(m.x, ground(m.x, m.z), m.z, m.rot);
    const label = `Mine ${mineIndex + 1}`;
    const abandonedCrypt = m.x < -140 && m.z > 590 && m.z < 630;
    add('timberPillar', `${label} left post`, mine, { x: -1.45, scale: [3.4, 3.5, 3.4] });
    add('timberPillar', `${label} right post`, mine, { x: 1.45, scale: [3.4, 3.5, 3.4] });
    add('timberPillar', `${label} lintel`, mine, {
      y: 3.42,
      x: -2.2,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.6, 4.4, 3.6],
    });
    add('timberPillar', `${label} cap beam`, mine, {
      y: 3.85,
      x: -2.45,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.0, 4.9, 3.0],
    });
    const mound: readonly (readonly [number, number, number, number])[] = abandonedCrypt
      ? [
          [0.2, 1.35, -3.2, 2.35],
          [-2.8, 0.25, -2.35, 1.75],
          [2.65, 0.3, -2.3, 1.75],
          [-1.7, 0.1, -1.25, 1.15],
          [1.75, 0.1, -1.2, 1.1],
          [0.2, 2.8, -4.15, 2.0],
          [-1.35, 1.45, -3.45, 1.55],
          [1.45, 1.5, -3.35, 1.5],
          [0, 0.15, -1.85, 1.2],
          [-3.45, 0.6, -3.5, 1.15],
          [3.35, 0.65, -3.45, 1.1],
          [0.1, 3.35, -2.85, 1.25],
        ]
      : [
          [0, 1.4, -3.0, 2.6],
          [-2.7, 0.3, -2.0, 1.9],
          [2.7, 0.35, -2.2, 2.0],
          [-1.6, 0.1, -1.0, 1.2],
          [1.8, 0.1, -0.9, 1.1],
          [0.3, 3.0, -4.2, 2.3],
          [-1.4, 1.6, -3.4, 1.8],
          [1.5, 1.7, -3.2, 1.7],
          [0, 0.2, -1.6, 1.4],
        ];
    const rockKinds: PropKey[] = ['rockTallA', 'rockLargeD', 'rockTallH', 'rockLargeF'];
    mound.forEach(([rx, ry, rz, rr], i) => {
      const kind = rockKinds[(i * 2 + 1) % rockKinds.length];
      const size = gamePropSize(kind);
      add(kind, `${label} mound rock ${i + 1}`, mine, {
        x: rx,
        y: ry,
        z: rz,
        scale: (2.1 * rr) / Math.max(size.x, size.z),
        euler: new THREE.Euler(
          (propRand(m.x, m.z, i + 80) - 0.5) * 0.5,
          propRand(m.x, m.z, i + 70) * Math.PI,
          (propRand(m.x, m.z, i + 90) - 0.5) * 0.5,
        ),
      });
    });
    if (!abandonedCrypt) {
      add('cart', `${label} ore cart`, mine, { x: 2.8, z: 1.6, rot: 0.5, scale: 1.9 });
      add('oreRocks', `${label} ore`, mine, { x: 2.75, y: 0.78, z: 1.55, rot: 0.9, scale: 2.6 });
      add('oreRocks', `${label} ore 2`, mine, { x: 3.4, z: 0.4, rot: 2.2, scale: 1.8 });
    }
    add('lanternWall', `${label} lantern`, mine, { x: 1.45, y: 2.0, z: 0.28, scale: 1.25 });
  });

  // ---- fishing docks: pitched plank sections, stone hut, shore clutter, rowboat
  props.docks.forEach((d, dockIndex) => {
    const label = `Dock ${dockIndex + 1}`;
    const y = ground(d.x, d.z);
    const key = d.x * 3.3 + d.z * 1.7;
    const ds = d.scale ?? 1;
    const dock = groupMatrix(d.x, y, d.z, d.rot);
    const surfaceLine = dockSurfaceLine(d, ground);
    const pitch = -Math.atan(surfaceLine.slope / ds);
    const zScale = (0.85 / Math.cos(pitch)) * ds;
    DOCK_SECTION_LOCAL_Z.forEach((lz, i) => {
      const section = dock
        .clone()
        .multiply(
          groupMatrix(
            0,
            dockSurfaceYAt(surfaceLine, lz) - y,
            lz * ds,
            new THREE.Euler(pitch, 0, 0),
          ),
        );
      add('dockPlatform', `${label} section ${i + 1}`, section, {
        y: -DOCK_SECTION_SURFACE_Y * ds,
        scale: [0.78 * ds, 0.52 * ds, zScale],
      });
    });
    if (d.hutLocal.hw > 0 && d.hutLocal.hd > 0) {
      const hut = gamePropSize('house3');
      add('house3', `${label} hut`, dock, {
        x: d.hutLocal.x,
        z: d.hutLocal.z,
        scale: [(d.hutLocal.hw * 2) / hut.x, 2.6 / hut.y, (d.hutLocal.hd * 2) / hut.z],
      });
    }
    const clutterNames = ['barrel 1', 'barrel 2', 'crate'];
    DOCK_DRESSING.forEach((dd, i) => {
      const off = {
        x: (dd.x * Math.cos(d.rot) + dd.z * Math.sin(d.rot)) * ds,
        z: (-dd.x * Math.sin(d.rot) + dd.z * Math.cos(d.rot)) * ds,
      };
      add(
        i === 2 ? 'crateWooden' : 'barrel',
        `${label} ${clutterNames[i] ?? `clutter ${i + 1}`}`,
        dock,
        {
          x: dd.x * ds,
          y: ground(d.x + off.x, d.z + off.z) - y,
          z: dd.z * ds,
          rot: keyRand(key, 5 + i) * Math.PI,
          scale: (dd.scale ?? 1) * ds,
        },
      );
    });
    const boatLx = DOCK_BOAT.x * ds;
    const boatLz = DOCK_BOAT.z * ds;
    const boatWx = d.x + boatLx * Math.cos(d.rot) + boatLz * Math.sin(d.rot);
    const boatWz = d.z - boatLx * Math.sin(d.rot) + boatLz * Math.cos(d.rot);
    const boatGround = ground(boatWx, boatWz);
    const wl = waterLevel();
    const afloat = boatGround < wl - 0.1;
    const boatRot = DOCK_BOAT.rot + (keyRand(key, 8) - 0.5) * 0.4;
    add('rowboat', `${label} rowboat`, dock, {
      x: boatLx,
      z: boatLz,
      y: (afloat ? wl + 0.18 : boatGround + 0.06) - y,
      rot: boatRot,
      scale: 0.85 * ds,
      euler: afloat ? undefined : new THREE.Euler(0.04, boatRot, 0.16),
    });
  });

  // ---- delve entrances: the portal-door arch (its void and lintel are effects)
  (props.delveMarkers ?? []).forEach((dm, index) => {
    const archZ = delveArchZ(dm.z, dm.delveId);
    const facing = delveArchMouthSign(dm.delveId) < 0 ? Math.PI : 0;
    add(
      'delveEntrance2',
      `Delve ${dm.delveId || index + 1}`,
      groupMatrix(dm.x, ground(dm.x, archZ), archZ, facing, DELVE_ARCH_SCALE),
      { scale: 1 },
    );
    // the mossy boulders flanking the approach
    const faceSign = delveArchMouthSign(dm.delveId);
    DELVE_BOULDERS.forEach((rb, i) => {
      const rx = dm.x + rb.dx;
      const rz = archZ + faceSign * rb.dz;
      add(
        'rockLargeD',
        `Delve ${dm.delveId || index + 1} boulder ${i + 1}`,
        groupMatrix(rx, ground(rx, rz) - 0.08, rz),
        {
          scale: rb.s,
          rot: rb.rot,
        },
      );
    });
  });

  // ---- marsh reeds
  (props.marshReeds ?? []).forEach(([x, z], i) => {
    add('marshReeds', `Marsh reeds ${i + 1}`, groupMatrix(x, ground(x, z) - 0.05, z), {
      scale: 3.0 + propRand(x, z, i + 5) * 0.6,
      euler: new THREE.Euler(
        (propRand(x, z, 10 + i) - 0.5) * 0.08,
        propRand(x, z, 12 + i) * Math.PI * 2,
        (propRand(x, z, 11 + i) - 0.5) * 0.08,
      ),
    });
  });

  // ---- great trees: the raw twisted-elder model, scaled per zone module
  (props.greatTrees ?? []).forEach((tree, index) => {
    if (!isConvertedGreatTree(tree, seed)) return;
    const look = greatTreeLook(tree, seed);
    if (!look) return;
    const path = '/models/foliage/twisted_1.glb';
    out.push({
      assetId: 'foliage/twisted_1',
      name: `Great tree ${index + 1}`,
      x: tree.x,
      z: tree.z,
      // the zones stand the model's origin 0.2 below the ground
      y: -0.2 + GREAT_TREE_MODEL.minY * look.scale,
      rotY: cleanZero(look.rot),
      scale: (look.scale * GREAT_TREE_MODEL.maxDim) / targetHeightFor(path),
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      collide: true,
      collisionMode: 'baked',
    });
  });

  if (includePalms) {
    reachPalmSpots(seed).forEach((palm, index) => {
      const assetId = `biome/beach_palm_${palm.variant + 1}`;
      out.push({
        assetId,
        name: `Palm tree ${index + 1}`,
        x: palm.x,
        z: palm.z,
        y: -0.15,
        rotY: palm.rot,
        scale: reachPalmRenderedHeight(palm) / targetHeightFor(`/models/${assetId}.glb`),
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        collide: true,
        collisionMode: 'baked',
      });
    });
  }
  return out;
}

// Converts the overworld scenery records that makers most often need to adjust
// into ordinary map placements. They then use the editor's existing selection,
// transform, undo, collision, and export pipeline instead of renderer-only props.

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
import { PROP_NATURAL_SIZE } from '../render/prop_natural_size.generated';
import { PROP_ASSET_DEFS } from '../render/props';
import { STREETLAMP_FIXTURE } from '../render/streetlamp_fixture.generated';
import { boxesForAssetId, collisionOverrideFor } from '../sim/asset_collision';
import { ASSET_COLLISION } from '../sim/asset_collision.generated';
import { builtinStreetlampPlan } from '../sim/colliders';
import { BUILTIN_WORLD } from '../sim/data';
import { type FenWillow, fenWillowSpots, hollowWillowSpots } from '../sim/fen_willows';
import { MAX_PLACEMENTS, type MapPlacement } from '../sim/map_doc';
import { hash2 } from '../sim/rng';
import { lampFixtureYaw } from '../sim/streetlamp_layout';
import { STREETLAMP_COLLIDER_RADIUS, STREETLAMP_FIXTURE_HEIGHT } from '../sim/streetlamp_style';
import type { ZonePropsDef } from '../sim/types';
import {
  farshorePalmSpots,
  reachPalmRenderedHeight,
  reachPalmSpots,
  terrainHeight,
} from '../sim/world';

const MIN_AXIS_SCALE = 0.05;

/** Decor with a record footprint at least this large (yards) collides by its
 *  baked/authored box set instead of the record circle/square, the
 *  building-sized pieces where a circle visibly disagrees with the mesh. */
export const DECOR_BAKED_COLLISION_MIN = 3;

/** Whether the asset resolves ANY baked or Collision Master boxes. */
export function decorHasBakedBoxes(assetId: string): boolean {
  const boxes = boxesForAssetId(assetId);
  return boxes !== null && boxes.length > 0;
}
// Beyond this, a fitted horizontal axis scale means the baked collision box does
// NOT represent the mesh footprint on that axis, so fitting the target width to
// it stretches the mesh grotesquely. The canonical offender is a camp tent whose
// collision is only two thin pole slabs: its X-extent collapses to the 0.1 floor
// and scaleX blows up to ~12, stretching the tent (and its red X-ray collision
// footprint) into a band across the whole map. When the fit exceeds this cap we
// fall back to the natural mesh aspect (axis scale 1, the prop just follows the
// uniform height scale). Legit props fit well under 3x, so they are untouched.
const MAX_FIT_STRETCH = 3;

/** Axis scale that makes `collisionExtent * scale * result == target`, but falls
 *  back to 1 (natural mesh aspect) when that would stretch past MAX_FIT_STRETCH ,
 *  i.e. when the collision box is too thin on this axis to represent the mesh. */
function fitAxisScale(target: number, collisionExtent: number, scale: number): number {
  const raw = target / (collisionExtent * scale);
  if (!Number.isFinite(raw) || raw > MAX_FIT_STRETCH) return 1;
  return Math.max(MIN_AXIS_SCALE, raw);
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function normalizedSize(assetId: string): { x: number; y: number; z: number } {
  const targetHeight = targetHeightFor(`/models/${assetId}.glb`);
  const boxes = ASSET_COLLISION[assetId] ?? [];
  if (boxes.length === 0) return { x: targetHeight, y: targetHeight, z: targetHeight };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.hx);
    minY = Math.min(minY, box.y - box.hy);
    minZ = Math.min(minZ, box.z - box.hz);
    maxX = Math.max(maxX, box.x + box.hx);
    maxY = Math.max(maxY, box.y + box.hy);
    maxZ = Math.max(maxZ, box.z + box.hz);
  }
  return {
    x: Math.max(0.1, maxX - minX),
    // PlacedAssetsView scales the complete GLB to targetHeightFor(path), not
    // to the vertical span of its collision boxes. Trees in particular only
    // bake trunk boxes, so using their collider height made promoted elders
    // more than three times too large once playtest loaded the real model.
    y: assetId === 'foliage/twisted_1' ? targetHeight : Math.max(0.1, maxY - minY),
    z: Math.max(0.1, maxZ - minZ),
  };
}

function collisionHeight(assetId: string): number {
  const boxes = ASSET_COLLISION[assetId] ?? [];
  if (boxes.length === 0) return targetHeightFor(`/models/${assetId}.glb`);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minY = Math.min(minY, box.y - box.hy);
    maxY = Math.max(maxY, box.y + box.hy);
  }
  return Math.max(0.1, maxY - minY);
}

function fittedPlacement(
  assetId: string,
  name: string,
  x: number,
  z: number,
  rotY: number,
  width: number,
  height: number,
  depth: number,
  y = 0,
  worldPropKind?: 'fence' | 'inn',
): MapPlacement {
  const size = normalizedSize(assetId);
  const scale = height / size.y;
  const placement: MapPlacement = {
    assetId,
    name,
    x,
    z,
    y,
    rotY: cleanZero(rotY),
    scale,
    scaleX: fitAxisScale(width, size.x, scale),
    scaleZ: fitAxisScale(depth, size.z, scale),
    collide: true,
    collisionMode: 'baked',
  };
  if (worldPropKind) {
    placement.worldPropKind = worldPropKind;
    placement.worldPropWidth = size.x;
    placement.worldPropDepth = size.z;
  }
  return placement;
}

function keyRand(key: number, stream: number): number {
  return hash2(Math.round(key * 97), stream * 7919, 0x9e3779);
}

function propRand(x: number, z: number, stream: number): number {
  return hash2(Math.round(x * 37), Math.round(z * 37) + stream * 7919, 0x517cc1);
}

function localPoint(
  x: number,
  z: number,
  rotY: number,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  return {
    x: x + localX * Math.cos(rotY) + localZ * Math.sin(rotY),
    z: z - localX * Math.sin(rotY) + localZ * Math.cos(rotY),
  };
}

function addFitted(
  out: MapPlacement[],
  assetId: string,
  name: string,
  x: number,
  z: number,
  rotY: number,
  width: number,
  height: number,
  depth: number,
  y = 0,
): MapPlacement {
  const placement = fittedPlacement(assetId, name, x, z, rotY, width, height, depth, y);
  out.push(placement);
  return placement;
}

function offsetAlongLocalZ(
  x: number,
  z: number,
  rotY: number,
  localZ: number,
): { x: number; z: number } {
  return { x: x + Math.sin(rotY) * localZ, z: z + Math.cos(rotY) * localZ };
}

/** Expand every built-in building and fence module into a selectable placement. */
export function worldMajorPropPlacements(
  props: ZonePropsDef,
  seed = 20061,
  includePalms = false,
): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (let index = 0; index < props.buildings.length; index++) {
    const building = props.buildings[index];
    // v0.39's authored towns (Eastbrook Vale, Fenbridge) draw their OWN
    // buildings from bespoke subtrees, and props.ts skips the generic kit
    // stand-ins for them. Promoting those stand-ins here would put a brown kit
    // house back on top of the white-and-blue authored one, the editor would
    // stop matching the live game precisely where the maker looks first.
    // Skipped rather than promoted: the authored art is not placement-shaped,
    // so these buildings render but are not individually editable.
    if (isEastbrookRebuildBuilding(building) || isFenbridgeRebuildBuilding(building)) continue;
    const label = `Building ${index + 1}`;
    if (building.kind === 'chapel') {
      const towerPos = offsetAlongLocalZ(building.x, building.z, building.rot, -0.75);
      out.push(
        fittedPlacement(
          'props/bell_tower',
          `${label} tower`,
          towerPos.x,
          towerPos.z,
          building.rot,
          building.w * 0.98,
          10.6,
          building.d * 0.72,
          -0.12,
        ),
      );
      const hallZ = building.d / 2 - 1.62;
      const hallPos = offsetAlongLocalZ(building.x, building.z, building.rot, hallZ);
      out.push(
        fittedPlacement(
          'props/house_3',
          `${label} hall`,
          hallPos.x,
          hallPos.z,
          building.rot,
          building.w * 0.9,
          2.5,
          3.2,
          -0.12,
        ),
      );
      continue;
    }

    let assetId = 'props/inn';
    let height = 7.6;
    let rotY = building.rot;
    if (building.kind === 'house') {
      const pool = ['props/house_1', 'props/house_2', 'props/blacksmith'] as const;
      const key = building.x * 13.7 + building.z * 3.1;
      assetId = pool[Math.floor(keyRand(key, 3) * 0.999 * pool.length)];
      height = assetId === 'props/blacksmith' ? 6.6 : assetId === 'props/house_2' ? 7.6 : 8;
      // The static prop renderer bakes this corrective yaw into house_2.
      if (assetId === 'props/house_2') rotY -= Math.PI / 2;
    }
    out.push(
      fittedPlacement(
        assetId,
        label,
        building.x,
        building.z,
        rotY,
        building.w,
        height,
        building.d,
        -0.12,
        building.kind === 'inn' ? 'inn' : undefined,
      ),
    );
  }

  let fenceIndex = 0;
  for (const fence of props.fences) {
    if (isEastbrookRebuildFence(fence)) continue;
    const length = Math.hypot(fence.x2 - fence.x1, fence.z2 - fence.z1);
    if (length <= 0) continue;
    const modules = Math.max(1, Math.round(length / 2.35));
    const yaw = Math.atan2(-(fence.z2 - fence.z1), fence.x2 - fence.x1);
    for (let i = 0; i < modules; i++) {
      const t = (i + 0.5) / modules;
      const x = fence.x1 + (fence.x2 - fence.x1) * t;
      const z = fence.z1 + (fence.z2 - fence.z1) * t;
      const x0 = fence.x1 + (fence.x2 - fence.x1) * (i / modules);
      const z0 = fence.z1 + (fence.z2 - fence.z1) * (i / modules);
      const x1 = fence.x1 + (fence.x2 - fence.x1) * ((i + 1) / modules);
      const z1 = fence.z1 + (fence.z2 - fence.z1) * ((i + 1) / modules);
      const g0 = terrainHeight(x0, z0, seed);
      const g1 = terrainHeight(x1, z1, seed);
      const centerGround = terrainHeight(x, z, seed);
      const pitch = Math.atan2(g1 - g0, length / modules);
      const placement = fittedPlacement(
        'props/fence',
        `Fence ${++fenceIndex}`,
        x,
        z,
        yaw,
        length / modules,
        2.9,
        0.35,
        (g0 + g1) / 2 - centerGround - 0.05,
        'fence',
      );
      placement.rotZ = cleanZero(pitch);
      out.push(placement);
    }
  }

  props.stalls.forEach((stall, index) => {
    if (isEastbrookRebuildStall(stall) || isFenbridgeRebuildStall(stall)) return;
    const assetId = index % 2 === 0 ? 'props/market_stand_1' : 'props/market_stand_2';
    addFitted(
      out,
      assetId,
      `Market stall ${index + 1}`,
      stall.x,
      stall.z,
      stall.rot,
      3.1,
      2.6,
      2.5,
      -0.06,
    );
    const addStallProp = (
      propAssetId: string,
      label: string,
      localX: number,
      localZ: number,
      localYaw: number,
      width: number,
      height: number,
      depth: number,
    ): void => {
      const point = localPoint(stall.x, stall.z, stall.rot, localX, localZ);
      addFitted(
        out,
        propAssetId,
        `Market stall ${index + 1} ${label}`,
        point.x,
        point.z,
        stall.rot + localYaw,
        width,
        height,
        depth,
      );
    };
    if (stall.smithy) {
      addStallProp('props/anvil', 'anvil', 1.35, 1.15, 0.9, 1.1, 0.9, 1.1);
      addStallProp('props/weapon_stand', 'weapon rack', -1.45, 0.6, 0.5 + Math.PI, 1.2, 2, 0.7);
    } else {
      addStallProp(
        'props/farmcrate_apple',
        'produce crate',
        1.3,
        1.05,
        keyRand(stall.x * 7.7 + stall.z * 2.3, 2) * Math.PI,
        1,
        0.8,
        1,
      );
      addStallProp(
        'props/barrel',
        'barrel',
        -1.35,
        0.85,
        keyRand(stall.x * 7.7 + stall.z * 2.3, 3) * Math.PI,
        0.8,
        1.25,
        0.8,
      );
    }
  });

  props.wells.forEach((well, index) => {
    if (isEastbrookRebuildWell(well) || isFenbridgeRebuildWell(well)) return;
    addFitted(
      out,
      'props/well',
      `Well ${index + 1}`,
      well.x,
      well.z,
      propRand(well.x, well.z, 1) * Math.PI,
      2.6,
      3.6,
      2.9,
      -0.1,
    );
  });

  props.graveyards.forEach((graveyard, graveyardIndex) => {
    const kinds = [
      'props/gravestone_round',
      'props/gravestone_cross',
      'props/gravestone_bevel',
      'props/gravestone_decorative',
    ] as const;
    for (let index = 0; index < 6; index++) {
      const x = graveyard.x + (index % 3) * 2.2;
      const z = graveyard.z + Math.floor(index / 3) * 2.6;
      const scale = 2 + keyRand(x * 3 + z, 4) * 0.5;
      const placement = addFitted(
        out,
        kinds[index % kinds.length],
        `Graveyard ${graveyardIndex + 1} headstone ${index + 1}`,
        x,
        z,
        index * 0.4 + (propRand(x, z, 2) - 0.5) * 0.5,
        0.75 * scale,
        1.15 * scale,
        0.45 * scale,
        -0.06,
      );
      placement.rotX = (propRand(x, z, 1) - 0.5) * 0.2;
      placement.rotZ = (propRand(x, z, 3) - 0.5) * 0.22;
    }
  });

  props.campfires.forEach(([x, z], index) => {
    const placement = addFitted(
      out,
      'props/bonfire',
      `Campfire ${index + 1}`,
      x,
      z,
      propRand(x, z, 1) * Math.PI * 2,
      1.7,
      1.35,
      1.7,
      -0.05,
    );
    placement.fire = true;
  });

  props.tents.forEach((tent, index) => {
    const assetId = propRand(tent.x, tent.z, 2) < 0.55 ? 'props/tent_open' : 'props/tent_small';
    const placement = addFitted(
      out,
      assetId,
      `Camp tent ${index + 1}`,
      tent.x,
      tent.z,
      tent.rot,
      3 * tent.scale,
      3.4 * tent.scale,
      3 * tent.scale,
      -0.06,
    );
    placement.rotX = (propRand(tent.x, tent.z, 3) - 0.5) * 0.06;
    placement.rotZ = (propRand(tent.x, tent.z, 4) - 0.5) * 0.06;
  });

  props.crates.forEach(([x, z], index) => {
    const barrel = index % 3 === 2;
    addFitted(
      out,
      barrel ? 'props/barrel' : 'props/crate_wooden',
      `Camp ${barrel ? 'barrel' : 'crate'} ${index + 1}`,
      x,
      z,
      ((x * 13 + z * 7) % 1) * Math.PI,
      barrel ? 0.85 : 1,
      barrel ? 1.3 : 1,
      barrel ? 0.85 : 1,
      -0.04,
    );
  });

  const hutCenter = props.mudHuts.reduce(
    (center, [x, z]) => ({
      x: center.x + x / props.mudHuts.length,
      z: center.z + z / props.mudHuts.length,
    }),
    { x: 0, z: 0 },
  );
  props.mudHuts.forEach(([x, z], index) => {
    const yaw = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const hut = addFitted(
      out,
      'props/mushroom_red',
      `Mud hut ${index + 1}`,
      x,
      z,
      yaw,
      4.2,
      12.5,
      4.2,
      -0.15,
    );
    hut.rotX = (propRand(x, z, 13) - 0.5) * 0.1;
    hut.rotZ = (propRand(x, z, 14) - 0.5) * 0.1;
    const clusterAngle = yaw + 0.9 + propRand(x, z, 18);
    addFitted(
      out,
      'props/mushroom_tan',
      `Mud hut ${index + 1} toadstools`,
      x + Math.sin(clusterAngle) * 1.7,
      z + Math.cos(clusterAngle) * 1.7,
      propRand(x, z, 19) * Math.PI * 2,
      1.1,
      1.6,
      1.1,
      -0.05,
    );
  });

  props.ruinRings.forEach((ring, ringIndex) => {
    for (let index = 0; index < ring.columns; index++) {
      const angle = (index / ring.columns) * Math.PI * 2;
      const x = ring.x + Math.sin(angle) * ring.ringR;
      const z = ring.z + Math.cos(angle) * ring.ringR;
      const intact = index % 4 === 1;
      const height = intact ? 3.5 + (index % 2) * 0.5 : 1.7 + (index % 3) * 0.85;
      const placement = addFitted(
        out,
        intact ? 'props/column' : 'props/column_broken',
        `Ruin ${ringIndex + 1} column ${index + 1}`,
        x,
        z,
        propRand(x, z, 8) * Math.PI,
        1.2,
        height,
        1.2,
        -0.1,
      );
      placement.rotZ = (index % 3 === 0 ? 0.13 : 0.03) * (index % 2 ? 1 : -1);
    }
    addFitted(
      out,
      'props/statue_head',
      `Ruin ${ringIndex + 1} statue head`,
      ring.x - 2.4,
      ring.z - 2.7,
      propRand(ring.x, ring.z, 30) * Math.PI * 2,
      2.2,
      2,
      2.2,
      -0.55,
    );
    addFitted(
      out,
      'props/statue_block',
      `Ruin ${ringIndex + 1} statue block`,
      ring.x + 0.1,
      ring.z - 4.3,
      propRand(ring.x, ring.z, 31) * Math.PI,
      2,
      1.5,
      2,
      -0.2,
    );
    const fallen = addFitted(
      out,
      'props/column',
      `Ruin ${ringIndex + 1} fallen column`,
      ring.x - 3.2,
      ring.z - 5.2,
      0.6,
      1.2,
      4,
      1.2,
      0.62,
    );
    fallen.rotX = Math.PI / 2 - 0.06;
  });

  props.mines.forEach((mine, mineIndex) => {
    const addMinePart = (
      assetId: string,
      label: string,
      localX: number,
      localZ: number,
      width: number,
      height: number,
      depth: number,
      localYaw = 0,
      y = 0,
    ): MapPlacement => {
      const point = localPoint(mine.x, mine.z, mine.rot, localX, localZ);
      return addFitted(
        out,
        assetId,
        `Mine ${mineIndex + 1} ${label}`,
        point.x,
        point.z,
        mine.rot + localYaw,
        width,
        height,
        depth,
        y,
      );
    };
    addMinePart('props/timber_pillar', 'left post', -1.45, 0, 0.7, 3.6, 0.7);
    addMinePart('props/timber_pillar', 'right post', 1.45, 0, 0.7, 3.6, 0.7);
    const lintel = addMinePart('props/timber_pillar', 'lintel', 0, 0, 0.7, 4.8, 0.7, 0, 3.4);
    lintel.rotZ = -Math.PI / 2;
    const mound: readonly [number, number, number, number][] = [
      [0, 1.4, -3, 2.6],
      [-2.7, 0.3, -2, 1.9],
      [2.7, 0.35, -2.2, 2],
      [-1.6, 0.1, -1, 1.2],
      [1.8, 0.1, -0.9, 1.1],
      [0.3, 3, -4.2, 2.3],
      [-1.4, 1.6, -3.4, 1.8],
      [1.5, 1.7, -3.2, 1.7],
      [0, 0.2, -1.6, 1.4],
    ];
    const rockKinds = [
      'props/rock_tall_a',
      'props/rock_large_d',
      'props/rock_tall_h',
      'props/rock_large_f',
    ] as const;
    mound.forEach(([x, y, z, radius], index) => {
      const rock = addMinePart(
        rockKinds[(index * 2 + 1) % rockKinds.length],
        `mound rock ${index + 1}`,
        x,
        z,
        radius * 2,
        radius * 1.7,
        radius * 2,
        propRand(mine.x, mine.z, index + 70) * Math.PI,
        y,
      );
      rock.rotX = (propRand(mine.x, mine.z, index + 80) - 0.5) * 0.5;
      rock.rotZ = (propRand(mine.x, mine.z, index + 90) - 0.5) * 0.5;
    });
    addMinePart('props/cart', 'ore cart', 2.8, 1.6, 2.2, 1.5, 3.2, 0.5);
    addMinePart('props/ore_rocks', 'ore', 2.75, 1.55, 1.4, 1.2, 1.4, 0.9, 0.75);
    addMinePart('props/lantern_wall', 'lantern', 1.45, 0.28, 0.45, 1.1, 0.45, 0, 2);
  });

  props.docks.forEach((dock, dockIndex) => {
    for (let index = 0; index < 4; index++) {
      const point = localPoint(dock.x, dock.z, dock.rot, 0, -index * 2.2);
      addFitted(
        out,
        'props/dock_platform',
        `Dock ${dockIndex + 1} section ${index + 1}`,
        point.x,
        point.z,
        dock.rot,
        3.2,
        1.25,
        2.3,
      );
    }
    if (dock.hutLocal.hw > 0 && dock.hutLocal.hd > 0) {
      const hut = localPoint(dock.x, dock.z, dock.rot, dock.hutLocal.x, dock.hutLocal.z);
      addFitted(
        out,
        'props/house_3',
        `Dock ${dockIndex + 1} hut`,
        hut.x,
        hut.z,
        dock.rot,
        dock.hutLocal.hw * 2,
        2.6,
        dock.hutLocal.hd * 2,
      );
    }
    const boat = localPoint(dock.x, dock.z, dock.rot, 2.4, -5);
    addFitted(
      out,
      'props/rowboat',
      `Dock ${dockIndex + 1} rowboat`,
      boat.x,
      boat.z,
      dock.rot + 0.5,
      2.4,
      0.9,
      4.8,
      0.18,
    );
    const clutter: readonly [string, string, number, number, number, number, number][] = [
      ['props/barrel', 'barrel 1', 0.55, -0.55, 0.8, 1.2, 0.8],
      ['props/barrel', 'barrel 2', 1.45, 0.9, 0.9, 1.4, 0.9],
      ['props/crate_wooden', 'crate', -0.6, -2.2, 0.9, 0.9, 0.9],
    ];
    clutter.forEach(([assetId, label, localX, localZ, width, height, depth], index) => {
      const point = localPoint(dock.x, dock.z, dock.rot, localX, localZ);
      addFitted(
        out,
        assetId,
        `Dock ${dockIndex + 1} ${label}`,
        point.x,
        point.z,
        dock.rot + keyRand(dock.x * 3.3 + dock.z * 1.7, index + 5) * Math.PI,
        width,
        height,
        depth,
        index === 1 ? 0 : 0.52,
      );
    });
  });

  (props.delveMarkers ?? []).forEach((marker, index) => {
    const drowned = marker.delveId === 'drowned_litany';
    const faceSign = drowned ? -1 : 1;
    addFitted(
      out,
      'dungeon/delve_entrance_2',
      `Delve ${marker.delveId || index + 1}`,
      marker.x,
      marker.z - faceSign * 4,
      drowned ? Math.PI : 0,
      10,
      12,
      4,
    );
  });

  // v0.31's marsh reeds are a scenery family like the campfires/crates above, so
  // the editable-all tier promotes them too rather than leaving them as static
  // props a maker cannot select or delete.
  (props.marshReeds ?? []).forEach(([x, z], index) => {
    addFitted(
      out,
      'props/reeds',
      `Marsh reeds ${index + 1}`,
      x,
      z,
      propRand(x, z, index + 5) * Math.PI * 2,
      3,
      3,
      3,
      -0.05,
    );
  });

  (props.greatTrees ?? []).forEach((tree, index) => {
    const placement = addFitted(
      out,
      'foliage/twisted_1',
      `Great tree ${index + 1}`,
      tree.x,
      tree.z,
      0.8,
      tree.r * 4,
      tree.r * 12,
      tree.r * 4,
      -0.2,
    );
    // Keep the model's authored proportions. The renderer applies `scale` on
    // all three axes; fitted axis multipliers would squash the broad canopy.
    placement.scaleX = 1;
    placement.scaleY = 1;
    placement.scaleZ = 1;
  });
  if (includePalms)
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
  return out;
}

/**
 * The props an authored town (Eastbrook Vale, Fenbridge) draws ITSELF.
 *
 * These are never promoted to placements, their real art is a bespoke
 * subtree, not a kit asset, so they must SURVIVE the strip below. Stripping
 * them leaves the town drawn by nobody: props.ts skips the kit stand-ins
 * because the authored subtree owns them, and the authored subtree skips
 * itself because the world no longer carries the buildings that gate it.
 * That is an empty village, which is exactly what happened.
 */
function authoredTownProps(
  props: ZonePropsDef,
): Pick<ZonePropsDef, 'buildings' | 'wells' | 'stalls' | 'fences'> {
  return {
    buildings: props.buildings.filter(
      (b) => isEastbrookRebuildBuilding(b) || isFenbridgeRebuildBuilding(b),
    ),
    wells: props.wells.filter((w) => isEastbrookRebuildWell(w) || isFenbridgeRebuildWell(w)),
    stalls: props.stalls.filter((s) => isEastbrookRebuildStall(s) || isFenbridgeRebuildStall(s)),
    fences: props.fences.filter((f) => isEastbrookRebuildFence(f)),
  };
}

/** Keep the rest of the shipped scenery, but suppress converted duplicates. */
export function withoutMajorWorldProps(props: ZonePropsDef): ZonePropsDef {
  const town = authoredTownProps(props);
  return { ...props, buildings: town.buildings, fences: town.fences };
}

/** Suppress every renderer-owned prop after it has been promoted to placements. */
/**
 * The dressing props a realm authors by asset key (`decorProps`) as editable
 * placements: the Evergarden's flower beds and iron fences, the hex-kit homes,
 * torches, shrubs, boats, 326 of them in the shipped world, and until now the
 * largest family a maker could see but not touch.
 *
 * Two conversions matter, and getting either wrong moves the art:
 *   size - props.ts draws the model at its OWN units times `scale`, while a
 *          placement is normalized to targetHeightFor(path) first, so the
 *          placement scale is (natural height x record scale) / normalized
 *          height (PROP_NATURAL_SIZE, generated from the GLBs themselves).
 *   yaw  - propAsset() bakes PROP_ASSET_DEFS[key].yaw into the geometry it
 *          draws; a placement loads the raw GLB, so that correction has to be
 *          added back to the record's rotation.
 *
 * Floating decor (moored ships) stays renderer-owned: it rides the waterline at
 * its own draft, and a placement would seat it on the seabed.
 */
export function decorPropPlacements(props: ZonePropsDef): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const d of props.decorProps ?? []) {
    if (d.float !== undefined) continue;
    const def = PROP_ASSET_DEFS[d.key];
    const natural = PROP_NATURAL_SIZE[d.key];
    if (!def || !natural) continue;
    const assetId = def.url
      .replace(/^\/+/, '')
      .replace(/^models\//, '')
      .replace(/\.glb$/i, '');
    if (!assetId) continue;
    const normalized = normalizedSize(assetId);
    const scale = (natural.y * (d.scale ?? 1)) / Math.max(0.01, normalized.y);
    const placement: MapPlacement = {
      assetId,
      name: propLabel(d.key),
      x: d.x,
      z: d.z,
      y: 0,
      rotY: cleanZero((d.rot ?? 0) + (def.yaw ?? 0)),
      scale: Math.max(MIN_AXIS_SCALE, scale),
      collide: false,
    };
    // Collision follows the record for SMALL dressing (r/hw/hd footprints are
    // truer for a flower bed and cheaper). BUILDING-sized decor is the
    // exception: a walk-in home blocking as a 4.5yd circle stops a body two
    // yards off its flat faces and lets it clip through the corners, exactly
    // "the collision doesn't line up with Collision Master". Anything with a
    // large footprint AND a baked/authored box set collides by that box set,
    // the same shapes the Collision Master shows.
    const footprint = d.hw !== undefined && d.hd !== undefined ? Math.max(d.hw, d.hd) : (d.r ?? 0);
    if (footprint >= DECOR_BAKED_COLLISION_MIN && decorHasBakedBoxes(assetId)) {
      placement.collide = true;
      placement.collisionMode = 'baked';
    } else if (d.hw !== undefined && d.hd !== undefined) {
      placement.collide = true;
      placement.collisionMode = 'basic';
      placement.collideShape = 'square';
      placement.collideRadius = Math.max(d.hw, d.hd);
    } else if ((d.r ?? 0) > 0) {
      placement.collide = true;
      placement.collisionMode = 'basic';
      placement.collideRadius = d.r;
    }
    out.push(placement);
  }
  return out;
}

/** A readable name for a promoted prop: "flowerBedRound" -> "Flower Bed Round". */
function propLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function withoutEditableWorldProps(props: ZonePropsDef): ZonePropsDef {
  const town = authoredTownProps(props);
  const out: ZonePropsDef = {
    ...props,
    buildings: town.buildings,
    wells: town.wells,
    stalls: town.stalls,
    mines: [],
    docks: [],
    tents: [],
    crates: [],
    campfires: [],
    mudHuts: [],
    ruinRings: [],
    fences: town.fences,
    graveyards: [],
    delveMarkers: [],
    greatTrees: [],
    marshReeds: [],
  };
  // Promoted by decorPropPlacements above: leaving the records here would draw
  // (and collide with) every flower bed, fence and torch twice, once movable
  // and once not. Floating decor is NOT promoted (it rides the waterline at its
  // own draft), so those records stay. Assigned only when the input carried the
  // family at all, so the projection keeps the document's own shape.
  // Benches and walls deliberately stay static: the authored town subtree draws
  // them with no skip on the generic path (custom_world_props.ts), so promoting
  // them would double them rather than free them.
  if (props.decorProps) out.decorProps = props.decorProps.filter((d) => d.float !== undefined);
  return out;
}

// Asset ids whose baked collision is too thin to fit width/depth to (see
// MAX_FIT_STRETCH). Maps saved BEFORE the fit fix have these promoted with a
// blown-up scaleX/scaleZ baked into the placement, so a code fix alone can't
// un-stretch them, repairStretchedWorldProps heals the persisted values.
const STRETCH_PRONE_ASSET_IDS = new Set(['props/tent_open', 'props/tent_small']);

/** Heal placements saved with a runaway fitted axis scale (the stretched camp
 *  tents): reset any stretch-prone prop's over-cap scaleX/scaleZ back to the
 *  natural mesh aspect (1), matching what fittedPlacement now produces. In-place
 *  like promoteMajorWorldProps; persists on the next save. Returns whether it
 *  changed anything. Only auto-generated world props are touched, and only when
 *  the axis exceeds MAX_FIT_STRETCH, a hand-set stretch never reaches that. */
export function repairStretchedWorldProps(map: { placements: MapPlacement[] }): boolean {
  let changed = false;
  for (const placement of map.placements) {
    if (STRETCH_PRONE_ASSET_IDS.has(placement.assetId)) {
      if ((placement.scaleX ?? 1) > MAX_FIT_STRETCH) {
        placement.scaleX = 1;
        changed = true;
      }
      if ((placement.scaleZ ?? 1) > MAX_FIT_STRETCH) {
        placement.scaleZ = 1;
        changed = true;
      }
    }
    if (placement.assetId === 'foliage/twisted_1') {
      // Older promoted great trees derived their uniform scale from the baked
      // trunk collider's height even though the renderer normalizes the full
      // canopy to 7.5 yards. Convert that legacy basis once.
      if (/^Great tree \d+$/.test(placement.name ?? '') && placement.scale > 8) {
        const ratio =
          collisionHeight(placement.assetId) / targetHeightFor(`/models/${placement.assetId}.glb`);
        placement.scale *= ratio;
        changed = true;
      }
      // Twisted trees must retain the GLB's authored proportions. Unequal axis
      // multipliers make their canopy and trunk look visibly squashed.
      if (placement.scaleX !== 1 || placement.scaleY !== 1 || placement.scaleZ !== 1) {
        placement.scaleX = 1;
        placement.scaleY = 1;
        placement.scaleZ = 1;
        changed = true;
      }
    }
  }
  return changed;
}

/** One-time in-memory upgrade for legacy world maps whose scenery was still
 * renderer-owned. Explicit empty/converted modes are already authoritative. */
export function promoteMajorWorldProps(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode === 'empty' || map.propsMode === 'editable-all') return false;
  if (map.presentationMode !== undefined) return false;
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const sourceProps =
    map.propsMode === 'editable-major'
      ? { ...BUILTIN_WORLD.props, buildings: [], fences: [] }
      : BUILTIN_WORLD.props;
  const converted = worldMajorPropPlacements(sourceProps, map.meta.seed, true);
  if (map.placements.length + converted.length > MAX_PLACEMENTS) return false;
  map.placements.push(...converted);
  map.propsMode = 'editable-all';
  return true;
}

/** Add editable beach palms to older full-world maps that were converted
 * before palms became ordinary placements. Idempotent and capacity-safe. */
export function promoteEditablePalms(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode !== 'editable-all' || map.presentationMode !== undefined) return false;
  if (map.placements.some((placement) => /^biome\/beach_palm_[123]$/.test(placement.assetId))) {
    return false;
  }
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const palms = reachPalmSpots(map.meta.seed).map((palm, index): MapPlacement => {
    const assetId = `biome/beach_palm_${palm.variant + 1}`;
    return {
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
    };
  });
  if (map.placements.length + palms.length > MAX_PLACEMENTS) return false;
  map.placements.push(...palms);
  return palms.length > 0;
}

/**
 * The road network's lamp posts as editable placements. The plan is the
 * pristine builtin one (colliders.ts caches it before any post stands) ,
 * empty when it has never been planned and the builtin world is not active,
 * in which case callers simply skip and retry on a later boot.
 *
 * Scale: a fixture instanced by streetlamps.ts stands STREETLAMP_FIXTURE_HEIGHT
 * tall; a placement normalizes the same GLB to targetHeightFor (its measured
 * unitHeight), so the ratio lands the promoted copy at the exact height the
 * game drew. Yaw: the same lampFixtureYaw the renderer resolves, off the
 * measured light axis, so the lit end still overhangs the road.
 */
export function streetlampPropPlacements(seed: number): MapPlacement[] {
  const plan = builtinStreetlampPlan(seed);
  if (!plan) return [];
  return plan.map((site, index) => {
    const fixture = STREETLAMP_FIXTURE[site.style];
    const placement: MapPlacement = {
      assetId: `props/streetlamp_${site.style}`,
      name: `Streetlamp ${index + 1}`,
      x: site.x,
      z: site.z,
      y: 0,
      rotY: cleanZero(
        fixture ? lampFixtureYaw(site.roadYaw, fixture.axis[0], fixture.axis[1]) : site.roadYaw,
      ),
      scale:
        STREETLAMP_FIXTURE_HEIGHT /
        (fixture?.unitHeight ?? targetHeightFor(`/models/props/streetlamp_${site.style}.glb`)),
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      collide: true,
      collisionMode: 'basic',
      collideRadius: STREETLAMP_COLLIDER_RADIUS[site.style],
    };
    return placement;
  });
}

// The willow GLB's largest source dimension (X), measured from the model the
// way gen_prop_natural_size.mjs measures every prop: the placed-asset
// pipeline normalizes by it (targetHeightFor / maxDim), while the fen/hollow
// feature builders draw the raw model at the spot's uniform scale, this is
// the conversion between the two.
const WILLOW_MAX_DIM = 0.972;

/**
 * The weeping willows (Willowfen shorelines + the Veiled Hollow's pools) as
 * editable placements, the reachPalmSpots idiom: the sim's spot list is the
 * single source the renderer drew and the colliders blocked, so the promoted
 * copies land exactly where the world had them.
 */
export function willowPropPlacements(seed: number): MapPlacement[] {
  const willowPath = '/models/props/willow_tree.glb';
  const toPlacement = (w: FenWillow, name: string): MapPlacement => ({
    assetId: 'props/willow_tree',
    name,
    x: w.x,
    z: w.z,
    y: -0.15,
    rotY: cleanZero(w.rot),
    scale: (w.s * WILLOW_MAX_DIM) / targetHeightFor(willowPath),
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    collide: true,
    collisionMode: 'basic',
    collideRadius: w.r,
  });
  return [
    ...fenWillowSpots(seed).map((w, i) => toPlacement(w, `Fen willow ${i + 1}`)),
    ...hollowWillowSpots(seed).map((w, i) => toPlacement(w, `Hollow willow ${i + 1}`)),
  ];
}

/** The Farshore isle's strand palms as placements (promoteEditablePalms'
 *  mapper over the isle's own spot list, same assets, other side of the
 *  map). */
export function farshorePalmPlacements(seed: number): MapPlacement[] {
  return farshorePalmSpots(seed).map((palm, index): MapPlacement => {
    const assetId = `biome/beach_palm_${palm.variant + 1}`;
    return {
      assetId,
      name: `Farshore palm ${index + 1}`,
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
    };
  });
}

/**
 * Repair pass: decor promoted before building-sized pieces switched to baked
 * collision still carries the record circle/square. Restamp any UNTOUCHED
 * such placement (mode 'basic' at a record-shaped radius, no hand-edited
 * hitboxes) to 'baked' so playtest blocks with the Collision Master's shapes.
 * Idempotent by construction; a maker's hand-tuned footprint is left alone.
 */
export function repairDecorBuildingCollision(map: { placements: MapPlacement[] }): number {
  // Only the decorProps family is eligible: other families' record circles
  // (an ember lily's rocky bed, a willow trunk) ARE the world's own blocking
  // and must not be "upgraded" away from parity.
  const decorAssetIds = new Set(
    Object.values(PROP_ASSET_DEFS).map((def) =>
      def.url
        .replace(/^\/+/, '')
        .replace(/^models\//, '')
        .replace(/\.glb$/i, ''),
    ),
  );
  let repaired = 0;
  for (const p of map.placements) {
    if (p.hitboxes && p.hitboxes.length > 0) continue;
    if (p.ramps && p.ramps.length > 0) continue;
    // A promotion-stamped NON-collider (records with no footprint, e.g. the
    // garden iron fences: collide false, mode UNSET) turns solid the moment
    // the maker authors Collision Master volumes for the asset, authoring
    // collision IS the intent. An explicit 'none' from the collision
    // dropdown is a maker choice and survives.
    if (p.collisionMode === undefined && !p.collide) {
      if (collisionOverrideFor(p.assetId) !== null) {
        p.collide = true;
        p.collisionMode = 'baked';
        delete p.collideRadius;
        delete p.collideShape;
        repaired++;
      }
      continue;
    }
    if (p.collisionMode !== 'basic') continue;
    // A Collision Master override ALWAYS wins over a promotion-stamped
    // footprint: the maker modelled that collision and the engine treats
    // 'basic' as a hand-picked choice it must never upgrade, so without
    // this, authoring collision for an asset did NOTHING to the hundreds of
    // promoted copies already on the map ("the collision doesn't match
    // Collision Master"). Big record footprints with a voxel bake upgrade
    // too; small dressing without authoring keeps its cheap record circle.
    const authored = collisionOverrideFor(p.assetId) !== null;
    if (!authored) {
      if ((p.collideRadius ?? 0) < DECOR_BAKED_COLLISION_MIN) continue;
      if (!decorAssetIds.has(p.assetId)) continue;
      if (!decorHasBakedBoxes(p.assetId)) continue;
    }
    p.collisionMode = 'baked';
    delete p.collideRadius;
    delete p.collideShape;
    repaired++;
  }
  return repaired;
}

/**
 * One-time upgrade for editable-all maps saved before the Farshore's palms
 * promoted. Idempotence discriminator: any beach palm east of the origin is
 * the isle's (the Palmreach strand sits entirely at x < -190).
 */
export function promoteFarshorePalms(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode !== 'editable-all' || map.presentationMode !== undefined) return false;
  if (
    map.placements.some(
      (placement) => /^biome\/beach_palm_[123]$/.test(placement.assetId) && placement.x > 0,
    )
  ) {
    return false;
  }
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const palms = farshorePalmPlacements(map.meta.seed);
  if (palms.length === 0) return false;
  if (map.placements.length + palms.length > MAX_PLACEMENTS) return false;
  map.placements.push(...palms);
  return true;
}

/**
 * One-time upgrade for editable-all maps saved before willows promoted (same
 * shape as promoteStreetlamps below).
 */
export function promoteWillows(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode !== 'editable-all' || map.presentationMode !== undefined) return false;
  if (map.placements.some((placement) => placement.assetId === 'props/willow_tree')) return false;
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const willows = willowPropPlacements(map.meta.seed);
  if (willows.length === 0) return false;
  if (map.placements.length + willows.length > MAX_PLACEMENTS) return false;
  map.placements.push(...willows);
  return true;
}

/**
 * One-time upgrade for editable-all maps saved before streetlamps promoted:
 * without it the projection's `promotedScenery.streetlamps` flag would stand
 * the renderer's lamps down with no placements to take over, and every road
 * would simply go dark. Same gates as promoteEditablePalms; idempotent via
 * the lamp-asset scan.
 */
export function promoteStreetlamps(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode !== 'editable-all' || map.presentationMode !== undefined) return false;
  if (map.placements.some((placement) => placement.assetId.startsWith('props/streetlamp_'))) {
    return false;
  }
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const lamps = streetlampPropPlacements(map.meta.seed);
  if (lamps.length === 0) return false;
  if (map.placements.length + lamps.length > MAX_PLACEMENTS) return false;
  map.placements.push(...lamps);
  return true;
}

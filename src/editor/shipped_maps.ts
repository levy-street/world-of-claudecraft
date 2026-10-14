// Adapters from the game's stable, sim-owned map layouts to ordinary editor
// documents. The converted maps contain only standard placements, so every
// wall, obstacle, and collision volume can be moved or deleted by the editor.

import { delveModuleRenderSpec } from '../render/delve_interiors';
import {
  DungeonInteriors,
  type DungeonInteriorVariant,
  type DungeonPlacementRecord,
  dungeonTorchLightColor,
} from '../render/dungeon';
import { COLLIDER_ASSET_IDS } from '../sim/collider_volumes';
import type { LayoutCollider } from '../sim/colliders';
import {
  DELVE_MODULE_LAYOUTS,
  type DelveModuleId,
  delveModuleColliders,
} from '../sim/delve_layout';
import {
  type LitanyDressingAnchor,
  type LitanyModuleId,
  litanyModuleGeometry,
} from '../sim/delve_litany_layout';
import { dungeonKitPlacementScale } from '../sim/dungeon_kit_dims';
import {
  ARENA_LAYOUT,
  CRYPT_LAYOUT,
  type DungeonLayout,
  layoutColliders,
  NYTHRAXIS_LAYOUT,
  SANCTUM_LAYOUT,
  TEMPLE_LAYOUT,
} from '../sim/dungeon_layout';
import type { MapPlacement, RegionRole } from '../sim/map_doc';
import type { MapPresentationMode } from '../sim/types';
import { yumiMazeColliders, yumiMazeLayout } from '../sim/yumi_maze_layout';
import { type CustomMap, newCustomMap, newFlatCustomMap } from './custom_map';
import { deepglassMap } from './shipped_deepglass';
import { thornhollowMap } from './shipped_thornhollow';

export type ShippedMapId =
  | 'overworld'
  | 'thornhollow'
  | 'deepglass'
  | 'hollow_crypt'
  | 'sunken_bastion'
  | 'gravewyrm_sanctum'
  | 'drowned_temple'
  | 'abandoned_crypt'
  | 'nythraxis_raid_arena'
  | 'ashen_coliseum'
  | 'protect_yumi_maze'
  | DelveModuleId;

export interface ShippedMapEntry {
  id: ShippedMapId;
  name: string;
  group: 'World' | 'Battleground' | 'Dungeon' | 'Arena' | 'Delve';
}

export const SHIPPED_MAPS: readonly ShippedMapEntry[] = [
  { id: 'overworld', name: 'World of ClaudeCraft', group: 'World' },
  { id: 'thornhollow', name: 'Thornhollow', group: 'Battleground' },
  { id: 'hollow_crypt', name: 'The Hollow Crypt', group: 'Dungeon' },
  { id: 'sunken_bastion', name: 'The Sunken Bastion', group: 'Dungeon' },
  { id: 'gravewyrm_sanctum', name: 'Gravewyrm Sanctum', group: 'Dungeon' },
  { id: 'drowned_temple', name: 'The Drowned Temple', group: 'Dungeon' },
  { id: 'abandoned_crypt', name: 'Abandoned Crypt', group: 'Dungeon' },
  {
    id: 'nythraxis_raid_arena',
    name: 'Nythraxis Raid Arena',
    group: 'Dungeon',
  },
  { id: 'ashen_coliseum', name: 'Ashen Coliseum', group: 'Arena' },
  { id: 'deepglass', name: 'Tidehold', group: 'Arena' },
  { id: 'protect_yumi_maze', name: 'Protect Yumi! Maze', group: 'Arena' },
  {
    id: 'reliquary_sunken_ossuary',
    name: 'Sunken Reliquary: Sunken Ossuary',
    group: 'Delve',
  },
  {
    id: 'reliquary_bell_niche',
    name: 'Sunken Reliquary: Bell Niche',
    group: 'Delve',
  },
  {
    id: 'reliquary_saintless_hall',
    name: 'Sunken Reliquary: Saintless Hall',
    group: 'Delve',
  },
  {
    id: 'reliquary_finale',
    name: 'Sunken Reliquary: Bell-Buried Chamber',
    group: 'Delve',
  },
  { id: 'litany_sluice', name: 'Drowned Litany: Sluice', group: 'Delve' },
  { id: 'litany_ledger', name: 'Drowned Litany: Ledger', group: 'Delve' },
  { id: 'litany_ring', name: 'Drowned Litany: Ring', group: 'Delve' },
  { id: 'litany_baptistry', name: 'Drowned Litany: Baptistry', group: 'Delve' },
  {
    id: 'litany_choir_loft',
    name: 'Drowned Litany: Choir Loft',
    group: 'Delve',
  },
  { id: 'litany_causeway', name: 'Drowned Litany: Causeway', group: 'Delve' },
  { id: 'litany_apse', name: 'Drowned Litany: Apse', group: 'Delve' },
] as const;

const entryById = new Map(SHIPPED_MAPS.map((entry) => [entry.id, entry]));
const WALL_MODULE_SPAN = 8;
const WALL_HEIGHT = 8;

function placement(
  assetId: string,
  x: number,
  z: number,
  options: Partial<MapPlacement> = {},
): MapPlacement {
  return {
    assetId,
    x,
    z,
    rotY: 0,
    scale: 1,
    collide: false,
    ...options,
  };
}

function collisionPlacements(collider: LayoutCollider): MapPlacement[] {
  if (collider.type === 'circle') {
    return [
      placement('collider/sphere', collider.x, collider.z, {
        collide: true,
        sizeX: collider.r * 2,
        sizeY: WALL_HEIGHT,
        sizeZ: collider.r * 2,
        name: 'Collision',
        hidden: true,
      }),
    ];
  }
  const alongX = collider.hw >= collider.hd;
  const length = (alongX ? collider.hw : collider.hd) * 2;
  const count = Math.max(1, Math.ceil(length / 200));
  const step = length / count;
  const out: MapPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const offset = -length / 2 + step * (i + 0.5);
    const lx = alongX ? offset : 0;
    const lz = alongX ? 0 : offset;
    const cos = Math.cos(collider.rot);
    const sin = Math.sin(collider.rot);
    out.push(
      placement(
        'collider/box',
        collider.x + lx * cos + lz * sin,
        collider.z - lx * sin + lz * cos,
        {
          rotY: collider.rot,
          collide: true,
          sizeX: alongX ? step : collider.hw * 2,
          sizeY: WALL_HEIGHT,
          sizeZ: alongX ? collider.hd * 2 : step,
          name: 'Collision',
          hidden: true,
        },
      ),
    );
  }
  return out;
}

function wallVisuals(collider: Extract<LayoutCollider, { type: 'obb' }>): MapPlacement[] {
  const alongX = collider.hw >= collider.hd;
  const length = (alongX ? collider.hw : collider.hd) * 2;
  const count = Math.max(1, Math.ceil(length / WALL_MODULE_SPAN));
  const step = length / count;
  const out: MapPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const offset = -length / 2 + step * (i + 0.5);
    const lx = alongX ? offset : 0;
    const lz = alongX ? 0 : offset;
    const cos = Math.cos(collider.rot);
    const sin = Math.sin(collider.rot);
    out.push(
      placement(
        'dungeon/wall',
        collider.x + lx * cos + lz * sin,
        collider.z - lx * sin + lz * cos,
        {
          rotY: collider.rot + (alongX ? 0 : Math.PI / 2),
          scale: 2,
          scaleX: step / WALL_MODULE_SPAN,
          name: 'Wall',
        },
      ),
    );
  }
  return out;
}

function obstacleVisual(collider: Extract<LayoutCollider, { type: 'circle' }>): MapPlacement {
  return placement('dungeon/pillar', collider.x, collider.z, {
    scale: 2,
    scaleX: Math.max(0.35, collider.r / 1.5),
    scaleZ: Math.max(0.35, collider.r / 1.5),
    name: 'Obstacle',
  });
}

function colliderBounds(colliders: readonly LayoutCollider[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of colliders) {
    const ex =
      c.type === 'circle'
        ? c.r
        : Math.abs(Math.cos(c.rot)) * c.hw + Math.abs(Math.sin(c.rot)) * c.hd;
    const ez =
      c.type === 'circle'
        ? c.r
        : Math.abs(Math.sin(c.rot)) * c.hw + Math.abs(Math.cos(c.rot)) * c.hd;
    minX = Math.min(minX, c.x - ex);
    maxX = Math.max(maxX, c.x + ex);
    minZ = Math.min(minZ, c.z - ez);
    maxZ = Math.max(maxZ, c.z + ez);
  }
  return { minX, maxX, minZ, maxZ };
}

function floorVisuals(bounds: ReturnType<typeof colliderBounds>): MapPlacement[] {
  const out: MapPlacement[] = [];
  const minX = Math.floor(bounds.minX / WALL_MODULE_SPAN) * WALL_MODULE_SPAN;
  const maxX = Math.ceil(bounds.maxX / WALL_MODULE_SPAN) * WALL_MODULE_SPAN;
  const minZ = Math.floor(bounds.minZ / WALL_MODULE_SPAN) * WALL_MODULE_SPAN;
  const maxZ = Math.ceil(bounds.maxZ / WALL_MODULE_SPAN) * WALL_MODULE_SPAN;
  for (let z = minZ; z <= maxZ; z += WALL_MODULE_SPAN) {
    for (let x = minX; x <= maxX; x += WALL_MODULE_SPAN) {
      out.push(
        placement('dungeon/floor_tile_large', x, z, {
          scale: 2,
          name: 'Floor',
        }),
      );
    }
  }
  return out;
}

function mapFromColliders(
  name: string,
  id: string,
  now: number,
  colliders: readonly LayoutCollider[],
  playerStart: { x: number; z: number },
  visiblePlacements?: readonly MapPlacement[],
  presentationMode: MapPresentationMode = 'blank',
  torchLightColor?: number,
  sourceCenter?: { x: number; z: number },
): CustomMap {
  const sourceBounds = colliderBounds(colliders);
  for (const item of visiblePlacements ?? []) {
    sourceBounds.minX = Math.min(sourceBounds.minX, item.x);
    sourceBounds.maxX = Math.max(sourceBounds.maxX, item.x);
    sourceBounds.minZ = Math.min(sourceBounds.minZ, item.z);
    sourceBounds.maxZ = Math.max(sourceBounds.maxZ, item.z);
  }
  const centerX = sourceCenter?.x ?? (sourceBounds.minX + sourceBounds.maxX) / 2;
  const centerZ = sourceCenter?.z ?? (sourceBounds.minZ + sourceBounds.maxZ) / 2;
  const localColliders = colliders.map((collider) => ({
    ...collider,
    x: collider.x - centerX,
    z: collider.z - centerZ,
  }));
  const bounds = colliderBounds(localColliders);
  for (const item of visiblePlacements ?? []) {
    bounds.minX = Math.min(bounds.minX, item.x - centerX);
    bounds.maxX = Math.max(bounds.maxX, item.x - centerX);
    bounds.minZ = Math.min(bounds.minZ, item.z - centerZ);
    bounds.maxZ = Math.max(bounds.maxZ, item.z - centerZ);
  }
  const width = Math.max(40, bounds.maxX - bounds.minX + 24);
  const height = Math.max(40, bounds.maxZ - bounds.minZ + 24);
  const map = newFlatCustomMap(name, id, now, { width, height });
  // The source layout already has its own collision shell. The blank-map
  // perimeter would sit between the opening camera and the room, tinting the
  // whole viewport with its translucent blocker preview.
  delete map.blockers;
  map.playerStart = { x: playerStart.x - centerX, z: playerStart.z - centerZ };
  map.placements = [
    ...(visiblePlacements
      ? visiblePlacements.map((item) => ({
          ...item,
          x: item.x - centerX,
          z: item.z - centerZ,
        }))
      : [
          ...floorVisuals(bounds),
          ...localColliders.flatMap((collider) =>
            collider.type === 'obb' ? wallVisuals(collider) : [obstacleVisual(collider)],
          ),
        ]),
    ...localColliders.flatMap(collisionPlacements),
  ];
  map.meta.description = 'Editable copy of a shipped World of ClaudeCraft map.';
  map.presentationMode = presentationMode;
  if (torchLightColor !== undefined) {
    map.lights = map.placements
      .filter((item) => item.assetId === 'dungeon/torch_mounted')
      .map((item) => ({
        x: item.x + Math.sin(item.rotY ?? 0) * 0.22,
        z: item.z,
        y: 6.4,
        color: torchLightColor,
        intensity: 30,
        range: 34,
      }));
  }
  return map;
}

interface LayoutSource {
  layout: DungeonLayout;
  interior: string;
  variant: DungeonInteriorVariant;
  playerStart?: { x: number; z: number };
}

const DUNGEON_LAYOUTS: Partial<Record<ShippedMapId, LayoutSource>> = {
  hollow_crypt: { layout: CRYPT_LAYOUT, interior: 'crypt', variant: 'crypt' },
  sunken_bastion: { layout: CRYPT_LAYOUT, interior: 'crypt', variant: 'bastion' },
  gravewyrm_sanctum: {
    layout: SANCTUM_LAYOUT,
    interior: 'sanctum',
    variant: 'sanctum',
  },
  drowned_temple: { layout: TEMPLE_LAYOUT, interior: 'temple', variant: 'temple' },
  abandoned_crypt: {
    layout: CRYPT_LAYOUT,
    interior: 'crypt',
    variant: 'crypt',
    playerStart: { x: 0, z: 4 },
  },
  nythraxis_raid_arena: {
    layout: NYTHRAXIS_LAYOUT,
    interior: 'nythraxis',
    variant: 'nythraxis',
    playerStart: { x: 0, z: 4 },
  },
  ashen_coliseum: {
    layout: ARENA_LAYOUT,
    interior: 'arena',
    variant: 'arena',
    playerStart: { x: 0, z: -14 },
  },
};

function isDelveId(id: ShippedMapId): id is DelveModuleId {
  return Object.hasOwn(DELVE_MODULE_LAYOUTS, id);
}

// ---- Ravenrift ------------------------------------------------------------
// The battleground opens as a REGION map: its coordinates ARE the region's own
// local space (the field is centred on its origin and its ground is flat), so
// what the maker drags here exports straight back with no offset.
//
// Two kinds of object come across. Everything the field is BUILT from - floor
// tiles, wall modules, the heart ruin, cover, torches, graves, dressing -
// arrives as ordinary catalogue placements the maker can move, restyle or
// delete, with the field's collision alongside as the usual editable collider
// volumes. The handful of things the GAME MODE reasons about - each team's
// flag, respawn ring, spawn banner, graveyard plot, and the rune pads - arrive
// tagged with a `regionRole`, because no model can tell the export "this is
// where Crimson respawns".

// Ravenrift's editable-field adapter is RETIRED. Upstream v0.35 replaced the
// fork's segment-based battleground layout with an authored map
// (data/battleground/thornhollow.map.json, compiled to
// sim/thornhollow_field.generated.ts), so the field is now edited as an
// ordinary authored map rather than reconstructed from layout constants.
// See docs/studio/history/MERGE-v0.35-STATUS.md.

function placementFromDungeonRecord(record: DungeonPlacementRecord): MapPlacement {
  const scale = typeof record.scale === 'number' ? record.scale : 1;
  return placement(`dungeon/${record.kind}`, record.x, record.z, {
    rotY: record.rotY,
    scale,
    scaleX: Array.isArray(record.scale) ? record.scale[0] : 1,
    scaleY: Array.isArray(record.scale) ? record.scale[1] : 1,
    scaleZ: Array.isArray(record.scale) ? record.scale[2] : 1,
    y: record.y,
    name: record.kind.replaceAll('_', ' '),
  });
}

const LITANY_ANCHOR_ASSET: Record<LitanyDressingAnchor['kind'], string> = {
  reed_cluster: 'dungeon/tree_dead_small',
  plank_bridge: 'resources/wood_plank_a',
  shrine_fragment: 'dungeon/shrine',
  corpse_candle: 'dungeon/skull_candle',
  bell_fragment: 'props/bell_tower',
  bone_pile: 'dungeon/bone_A',
  sluice_post: 'resources/wood_plank_b',
  root_wall: 'dungeon/tree_dead_medium',
  broken_bell_frame: 'props/bell_tower',
  dead_tree: 'dungeon/tree_dead_large',
};

function litanyFeaturePlacements(moduleId: LitanyModuleId): MapPlacement[] {
  const geometry = litanyModuleGeometry(moduleId);
  if (!geometry) return [];
  const out: MapPlacement[] = [];
  for (const hazard of geometry.hazards) {
    out.push(
      placement('fluid/acid', hazard.x, hazard.z, {
        sizeX: (hazard.rx ?? hazard.r) * 2,
        sizeY: 1,
        sizeZ: (hazard.rz ?? hazard.r) * 2,
        y: 0.11,
        hue: 172,
        lum: hazard.tier === 'shallow' ? 0.2 : 0.1,
        fluidDps: 4,
        fluidFx: 0,
        name: 'Blackwater',
        // The fluid surface still renders and playtests. Hiding the placement
        // suppresses only the editor's large translucent transform pad.
        hidden: true,
      }),
    );
  }
  for (const island of geometry.islands) {
    out.push(
      placement('dungeon/floor_dirt_large', island.x, island.z, {
        scaleX: island.hw / 2,
        scaleY: 0.2,
        scaleZ: island.hd / 2,
        y: 0.14,
        name: 'Dry island',
      }),
    );
  }
  for (const anchor of geometry.dressing) {
    out.push(
      placement(LITANY_ANCHOR_ASSET[anchor.kind], anchor.x, anchor.z, {
        rotY: anchor.rot ?? 0,
        name: anchor.kind.replaceAll('_', ' '),
      }),
    );
  }
  return out;
}

function tintLitanyPlacement(item: MapPlacement): MapPlacement {
  if (item.assetId.startsWith('dungeon/floor_')) {
    return { ...item, hue: 40, lum: 0.2 };
  }
  if (item.assetId.startsWith('dungeon/wall') || item.assetId.startsWith('dungeon/pillar')) {
    return { ...item, hue: 105, lum: 0.28 };
  }
  return item;
}

export async function createShippedMap(
  mapId: ShippedMapId,
  id: string,
  now: number,
): Promise<CustomMap> {
  const entry = entryById.get(mapId);
  if (!entry) throw new Error(`Unknown shipped map: ${mapId}`);
  if (mapId === 'overworld') return newCustomMap(entry.name, id, now);
  if (mapId === 'thornhollow') return thornhollowMap(entry.name, id, now);
  if (mapId === 'deepglass') return deepglassMap(entry.name, id, now);
  if (mapId === 'protect_yumi_maze') {
    const layout = yumiMazeLayout();
    return mapFromColliders(
      entry.name,
      id,
      now,
      yumiMazeColliders(),
      layout.spawnA[0],
      [],
      'yumiMaze',
    );
  }
  if (isDelveId(mapId)) {
    const layout = DELVE_MODULE_LAYOUTS[mapId];
    const spec = delveModuleRenderSpec(mapId);
    const records = await DungeonInteriors.captureDungeonPlacementRecords(spec.interior, spec);
    const visible = records.map(placementFromDungeonRecord);
    if (mapId.startsWith('litany_')) {
      for (let i = 0; i < visible.length; i++) visible[i] = tintLitanyPlacement(visible[i]);
      visible.push(...litanyFeaturePlacements(mapId as LitanyModuleId));
    }
    return mapFromColliders(
      entry.name,
      id,
      now,
      delveModuleColliders(mapId),
      { x: 0, z: layout.zMin + 8 },
      visible,
      'delve',
      dungeonTorchLightColor(spec.variant),
    );
  }
  const source = DUNGEON_LAYOUTS[mapId];
  if (!source) throw new Error(`Missing shipped layout: ${mapId}`);
  const records = await DungeonInteriors.captureDungeonPlacementRecords(source.interior, {
    layout: source.layout,
    variant: source.variant,
  });
  return mapFromColliders(
    entry.name,
    id,
    now,
    layoutColliders(source.layout),
    source.playerStart ?? { x: 0, z: source.layout.zMin + 8 },
    records.map(placementFromDungeonRecord),
    source.interior === 'temple'
      ? 'temple'
      : source.interior === 'nythraxis'
        ? 'nythraxis'
        : 'dungeon',
    dungeonTorchLightColor(source.variant),
  );
}

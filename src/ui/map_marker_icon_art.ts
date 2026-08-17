// Pure catalog for stable painted cartography identities shared by the world
// map and minimap. The loader adds a one-pixel terrain-separating keyline to
// every exact-size raster and turns gathering cooldown rasters grayscale.
// Dynamic emphasis stays with the painters: glow, pings, facing, aggro, and
// death are never baked into the masters. The loader precomputes closed state
// variants for gathering, navigation rank, and rewards. Quest state uses one
// generated master per actionable state so punctuation and state badges stay
// legible after the compact mobile HUD scales the canvases down.

import type { GatherNodeType, RiftTier, StationType } from '../sim/types';
import type { MapMarkerSemantic } from './map_marker_semantics_core';

export const MAP_MARKER_ART_IDS = [
  'dungeon-entrance',
  'dungeon-exit',
  'gather-ore',
  'gather-wood',
  'gather-herb',
  'station-forge',
  'station-kitchens',
  'station-apothecary',
  'station-tannery',
  'station-loom',
  'station-toolworks',
  'service-mailbox',
  'service-noticeboard',
  'quest-available',
  'quest-ready',
  'quest-repeat',
  'quest-cooldown',
  'delve-entrance',
  'delve-passage',
  'delve-surface-exit',
  'rift-entrance',
  'rift-descent',
  'rift-beacon',
  'rift-egress',
  'reward-treasure',
  'reward-locked-cache',
  'reward-reliquary',
  'world-passage',
] as const;

export type MapMarkerArtId = (typeof MAP_MARKER_ART_IDS)[number];

export const MAP_MARKER_SIZES = {
  minimapGatherReady: 18,
  minimapGatherReadyCompact: 24,
  minimapGatherReadyLocked: 18,
  minimapGatherReadyLockedCompact: 24,
  minimapGatherCooldown: 16,
  minimapGatherCooldownCompact: 22,
  minimapGatherCooldownLocked: 16,
  minimapGatherCooldownLockedCompact: 22,
  mapGatherReady: 20,
  mapGatherReadyCompact: 28,
  mapGatherReadyLocked: 20,
  mapGatherReadyLockedCompact: 28,
  mapGatherCooldown: 18,
  mapGatherCooldownCompact: 26,
  mapGatherCooldownLocked: 18,
  mapGatherCooldownLockedCompact: 26,
  minimapDungeon: 18,
  minimapDungeonCompact: 24,
  mapDungeon: 20,
  mapDungeonCompact: 30,
  minimapStation: 16,
  minimapStationCompact: 22,
  mapStation: 20,
  mapStationCompact: 28,
  minimapService: 16,
  minimapServiceCompact: 22,
  mapService: 20,
  mapServiceCompact: 28,
  minimapQuest: 20,
  minimapQuestCompact: 26,
  minimapQuestCooldown: 16,
  minimapQuestCooldownCompact: 22,
  mapQuest: 24,
  mapQuestCompact: 32,
  mapQuestCooldown: 18,
  mapQuestCooldownCompact: 26,
  minimapNavigation: 18,
  minimapNavigationCompact: 24,
  minimapNavigationLocked: 18,
  minimapNavigationLockedCompact: 24,
  mapNavigation: 22,
  mapNavigationCompact: 30,
  mapNavigationLocked: 22,
  mapNavigationLockedCompact: 30,
  minimapNavigationRankC: 18,
  minimapNavigationRankCCompact: 24,
  minimapNavigationRankB: 18,
  minimapNavigationRankBCompact: 24,
  minimapNavigationRankA: 18,
  minimapNavigationRankACompact: 24,
  minimapNavigationRankS: 18,
  minimapNavigationRankSCompact: 24,
  mapNavigationRankC: 22,
  mapNavigationRankCCompact: 30,
  mapNavigationRankB: 22,
  mapNavigationRankBCompact: 30,
  mapNavigationRankA: 22,
  mapNavigationRankACompact: 30,
  mapNavigationRankS: 22,
  mapNavigationRankSCompact: 30,
  minimapRewardAvailable: 18,
  minimapRewardAvailableCompact: 24,
  minimapRewardLocked: 18,
  minimapRewardLockedCompact: 24,
  minimapRewardActive: 18,
  minimapRewardActiveCompact: 24,
  minimapRewardOpened: 18,
  minimapRewardOpenedCompact: 24,
  minimapRewardJammed: 18,
  minimapRewardJammedCompact: 24,
  minimapRewardAvailableBountiful: 18,
  minimapRewardAvailableBountifulCompact: 24,
  minimapRewardLockedBountiful: 18,
  minimapRewardLockedBountifulCompact: 24,
  minimapRewardActiveBountiful: 18,
  minimapRewardActiveBountifulCompact: 24,
  minimapRewardOpenedBountiful: 18,
  minimapRewardOpenedBountifulCompact: 24,
  minimapRewardJammedBountiful: 18,
  minimapRewardJammedBountifulCompact: 24,
  mapRewardAvailable: 20,
  mapRewardAvailableCompact: 28,
  mapRewardLocked: 20,
  mapRewardLockedCompact: 28,
  mapRewardActive: 20,
  mapRewardActiveCompact: 28,
  mapRewardOpened: 20,
  mapRewardOpenedCompact: 28,
  mapRewardJammed: 20,
  mapRewardJammedCompact: 28,
  mapRewardAvailableBountiful: 20,
  mapRewardAvailableBountifulCompact: 28,
  mapRewardLockedBountiful: 20,
  mapRewardLockedBountifulCompact: 28,
  mapRewardActiveBountiful: 20,
  mapRewardActiveBountifulCompact: 28,
  mapRewardOpenedBountiful: 20,
  mapRewardOpenedBountifulCompact: 28,
  mapRewardJammedBountiful: 20,
  mapRewardJammedBountifulCompact: 28,
} as const;

export type MapMarkerSize = keyof typeof MAP_MARKER_SIZES;

const GATHER_MARKER_SIZES = [
  'minimapGatherReady',
  'minimapGatherReadyCompact',
  'minimapGatherReadyLocked',
  'minimapGatherReadyLockedCompact',
  'minimapGatherCooldown',
  'minimapGatherCooldownCompact',
  'minimapGatherCooldownLocked',
  'minimapGatherCooldownLockedCompact',
  'mapGatherReady',
  'mapGatherReadyCompact',
  'mapGatherReadyLocked',
  'mapGatherReadyLockedCompact',
  'mapGatherCooldown',
  'mapGatherCooldownCompact',
  'mapGatherCooldownLocked',
  'mapGatherCooldownLockedCompact',
] as const satisfies readonly MapMarkerSize[];

const DUNGEON_MARKER_SIZES = [
  'minimapDungeon',
  'minimapDungeonCompact',
  'mapDungeon',
  'mapDungeonCompact',
] as const satisfies readonly MapMarkerSize[];

const STATION_MARKER_SIZES = [
  'minimapStation',
  'minimapStationCompact',
  'mapStation',
  'mapStationCompact',
] as const satisfies readonly MapMarkerSize[];

const SERVICE_MARKER_SIZES = [
  'minimapService',
  'minimapServiceCompact',
  'mapService',
  'mapServiceCompact',
] as const satisfies readonly MapMarkerSize[];

const QUEST_MARKER_SIZES = [
  'minimapQuest',
  'minimapQuestCompact',
  'mapQuest',
  'mapQuestCompact',
] as const satisfies readonly MapMarkerSize[];

const QUEST_COOLDOWN_MARKER_SIZES = [
  'minimapQuestCooldown',
  'minimapQuestCooldownCompact',
  'mapQuestCooldown',
  'mapQuestCooldownCompact',
] as const satisfies readonly MapMarkerSize[];

const NAVIGATION_MARKER_SIZES = [
  'minimapNavigation',
  'minimapNavigationCompact',
  'mapNavigation',
  'mapNavigationCompact',
] as const satisfies readonly MapMarkerSize[];

const PASSAGE_MARKER_SIZES = [
  ...NAVIGATION_MARKER_SIZES,
  'minimapNavigationLocked',
  'minimapNavigationLockedCompact',
  'mapNavigationLocked',
  'mapNavigationLockedCompact',
] as const satisfies readonly MapMarkerSize[];

const RANKED_NAVIGATION_MARKER_SIZES = [
  ...NAVIGATION_MARKER_SIZES,
  'minimapNavigationRankC',
  'minimapNavigationRankCCompact',
  'minimapNavigationRankB',
  'minimapNavigationRankBCompact',
  'minimapNavigationRankA',
  'minimapNavigationRankACompact',
  'minimapNavigationRankS',
  'minimapNavigationRankSCompact',
  'mapNavigationRankC',
  'mapNavigationRankCCompact',
  'mapNavigationRankB',
  'mapNavigationRankBCompact',
  'mapNavigationRankA',
  'mapNavigationRankACompact',
  'mapNavigationRankS',
  'mapNavigationRankSCompact',
] as const satisfies readonly MapMarkerSize[];

const TREASURE_REWARD_MARKER_SIZES = [
  'minimapRewardAvailable',
  'minimapRewardAvailableCompact',
  'minimapRewardOpened',
  'minimapRewardOpenedCompact',
  'mapRewardAvailable',
  'mapRewardAvailableCompact',
  'mapRewardOpened',
  'mapRewardOpenedCompact',
] as const satisfies readonly MapMarkerSize[];

const CACHE_REWARD_MARKER_SIZES = [
  'minimapRewardAvailable',
  'minimapRewardAvailableCompact',
  'minimapRewardLocked',
  'minimapRewardLockedCompact',
  'minimapRewardActive',
  'minimapRewardActiveCompact',
  'minimapRewardOpened',
  'minimapRewardOpenedCompact',
  'minimapRewardJammed',
  'minimapRewardJammedCompact',
  'minimapRewardAvailableBountiful',
  'minimapRewardAvailableBountifulCompact',
  'minimapRewardLockedBountiful',
  'minimapRewardLockedBountifulCompact',
  'minimapRewardActiveBountiful',
  'minimapRewardActiveBountifulCompact',
  'minimapRewardOpenedBountiful',
  'minimapRewardOpenedBountifulCompact',
  'mapRewardAvailable',
  'mapRewardAvailableCompact',
  'mapRewardLocked',
  'mapRewardLockedCompact',
  'mapRewardActive',
  'mapRewardActiveCompact',
  'mapRewardOpened',
  'mapRewardOpenedCompact',
  'mapRewardJammed',
  'mapRewardJammedCompact',
  'mapRewardAvailableBountiful',
  'mapRewardAvailableBountifulCompact',
  'mapRewardLockedBountiful',
  'mapRewardLockedBountifulCompact',
  'mapRewardActiveBountiful',
  'mapRewardActiveBountifulCompact',
  'mapRewardOpenedBountiful',
  'mapRewardOpenedBountifulCompact',
] as const satisfies readonly MapMarkerSize[];

const RELIQUARY_REWARD_MARKER_SIZES = [
  'minimapRewardAvailable',
  'minimapRewardAvailableCompact',
  'minimapRewardLocked',
  'minimapRewardLockedCompact',
  'minimapRewardActive',
  'minimapRewardActiveCompact',
  'minimapRewardOpened',
  'minimapRewardOpenedCompact',
  'minimapRewardAvailableBountiful',
  'minimapRewardAvailableBountifulCompact',
  'minimapRewardLockedBountiful',
  'minimapRewardLockedBountifulCompact',
  'minimapRewardActiveBountiful',
  'minimapRewardActiveBountifulCompact',
  'minimapRewardOpenedBountiful',
  'minimapRewardOpenedBountifulCompact',
  'mapRewardAvailable',
  'mapRewardAvailableCompact',
  'mapRewardLocked',
  'mapRewardLockedCompact',
  'mapRewardActive',
  'mapRewardActiveCompact',
  'mapRewardOpened',
  'mapRewardOpenedCompact',
  'mapRewardAvailableBountiful',
  'mapRewardAvailableBountifulCompact',
  'mapRewardLockedBountiful',
  'mapRewardLockedBountifulCompact',
  'mapRewardActiveBountiful',
  'mapRewardActiveBountifulCompact',
  'mapRewardOpenedBountiful',
  'mapRewardOpenedBountifulCompact',
] as const satisfies readonly MapMarkerSize[];

const MAP_MARKER_URLS: Readonly<Record<MapMarkerArtId, string>> = {
  'dungeon-entrance': '/ui/map-markers/dungeon_entrance.webp',
  'dungeon-exit': '/ui/map-markers/dungeon_exit.webp',
  'gather-ore': '/ui/map-markers/gather_ore.webp',
  'gather-wood': '/ui/map-markers/gather_wood.webp',
  'gather-herb': '/ui/map-markers/gather_herb.webp',
  'station-forge': '/ui/map-markers/station_forge.webp',
  'station-kitchens': '/ui/map-markers/station_kitchens.webp',
  'station-apothecary': '/ui/map-markers/station_apothecary.webp',
  'station-tannery': '/ui/map-markers/station_tannery.webp',
  'station-loom': '/ui/map-markers/station_loom.webp',
  'station-toolworks': '/ui/map-markers/station_toolworks.webp',
  'service-mailbox': '/ui/map-markers/service_mailbox.webp',
  'service-noticeboard': '/ui/map-markers/service_noticeboard.webp',
  'quest-available': '/ui/map-markers/quest_available.webp',
  'quest-ready': '/ui/map-markers/quest_ready.webp',
  'quest-repeat': '/ui/map-markers/quest_repeat.webp',
  'quest-cooldown': '/ui/map-markers/quest_cooldown.webp',
  'delve-entrance': '/ui/map-markers/delve_entrance.webp',
  'delve-passage': '/ui/map-markers/delve_passage.webp',
  'delve-surface-exit': '/ui/map-markers/delve_surface_exit.webp',
  'rift-entrance': '/ui/map-markers/rift_entrance.webp',
  'rift-descent': '/ui/map-markers/rift_descent.webp',
  'rift-beacon': '/ui/map-markers/rift_beacon.webp',
  'rift-egress': '/ui/map-markers/rift_egress.webp',
  'reward-treasure': '/ui/map-markers/reward_treasure.webp',
  'reward-locked-cache': '/ui/map-markers/reward_locked_cache.webp',
  'reward-reliquary': '/ui/map-markers/reward_reliquary.webp',
  'world-passage': '/ui/map-markers/world_passage.webp',
};

export interface MapMarkerArt {
  sprite(id: MapMarkerArtId, size: MapMarkerSize): CanvasImageSource | null;
  preload(): void;
}

export const EMPTY_MAP_MARKER_ART: MapMarkerArt = {
  sprite: () => null,
  preload: () => {},
};

export function mapMarkerIconUrl(id: MapMarkerArtId): string {
  return MAP_MARKER_URLS[id];
}

export function gatherMarkerArtId(type: GatherNodeType): MapMarkerArtId {
  return `gather-${type}`;
}

export function stationMarkerArtId(type: StationType): MapMarkerArtId {
  return `station-${type}`;
}

export type QuestMarkerArtKind = 'available' | 'ready' | 'repeat' | 'cooldown';

/** Exhaustive quest-state to painted-identity routing shared by both map surfaces. */
export function questMarkerArtId(kind: QuestMarkerArtKind): MapMarkerArtId {
  switch (kind) {
    case 'available':
      return 'quest-available';
    case 'ready':
      return 'quest-ready';
    case 'repeat':
      return 'quest-repeat';
    case 'cooldown':
      return 'quest-cooldown';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export type MapMarkerPaintState = 'available' | 'locked' | 'active' | 'opened' | 'jammed';

export interface SemanticMapMarkerArt {
  readonly id: MapMarkerArtId;
  readonly state: MapMarkerPaintState;
  readonly bountiful: boolean;
  readonly rank?: RiftTier | null;
}

const semanticArt = (
  id: MapMarkerArtId,
  state: MapMarkerPaintState = 'available',
  bountiful = false,
  rank?: RiftTier | null,
): SemanticMapMarkerArt => ({ id, state, bountiful, ...(rank === undefined ? {} : { rank }) });

const DUNGEON_SEMANTIC_ART = {
  entrance: semanticArt('dungeon-entrance'),
  exit: semanticArt('dungeon-exit'),
} as const;
const RIFT_ENTRANCE_UNRANKED = semanticArt('rift-entrance', 'available', false, null);
const RIFT_ENTRANCE_RANKED = {
  C: semanticArt('rift-entrance', 'available', false, 'C'),
  B: semanticArt('rift-entrance', 'available', false, 'B'),
  A: semanticArt('rift-entrance', 'available', false, 'A'),
  S: semanticArt('rift-entrance', 'available', false, 'S'),
} as const satisfies Readonly<Record<RiftTier, SemanticMapMarkerArt>>;
const RIFT_EGRESS_UNRANKED = semanticArt('rift-egress', 'available', false, null);
const RIFT_EGRESS_RANKED = {
  C: semanticArt('rift-egress', 'available', false, 'C'),
  B: semanticArt('rift-egress', 'available', false, 'B'),
  A: semanticArt('rift-egress', 'available', false, 'A'),
  S: semanticArt('rift-egress', 'available', false, 'S'),
} as const satisfies Readonly<Record<RiftTier, SemanticMapMarkerArt>>;
const RIFT_DESCENT_ART = semanticArt('rift-descent');
const RIFT_BEACON_ART = semanticArt('rift-beacon', 'available', false, null);
const RIFT_REWARD_ART = {
  treasure: {
    available: semanticArt('reward-treasure'),
    locked: semanticArt('reward-locked-cache', 'locked'),
    opened: semanticArt('reward-treasure', 'opened'),
    jammed: semanticArt('reward-locked-cache', 'jammed'),
  },
  cache: {
    available: semanticArt('reward-locked-cache'),
    locked: semanticArt('reward-locked-cache', 'locked'),
    opened: semanticArt('reward-locked-cache', 'opened'),
    jammed: semanticArt('reward-locked-cache', 'jammed'),
  },
} as const;
const DELVE_PASSAGE_ART = {
  sealed: semanticArt('delve-passage', 'locked'),
  open: semanticArt('delve-passage'),
} as const;
const DELVE_SURFACE_ART = semanticArt('delve-surface-exit');

function delveRewardArt(
  reward: 'cache' | 'reliquary',
  state: 'locked' | 'ready' | 'active' | 'opened',
  bountiful: boolean,
): SemanticMapMarkerArt {
  return DELVE_REWARD_ART[reward][bountiful ? 'bountiful' : 'ordinary'][state];
}

const DELVE_REWARD_ART = {
  cache: {
    ordinary: {
      locked: semanticArt('reward-locked-cache', 'locked'),
      ready: semanticArt('reward-locked-cache'),
      active: semanticArt('reward-locked-cache', 'active'),
      opened: semanticArt('reward-locked-cache', 'opened'),
    },
    bountiful: {
      locked: semanticArt('reward-locked-cache', 'locked', true),
      ready: semanticArt('reward-locked-cache', 'available', true),
      active: semanticArt('reward-locked-cache', 'active', true),
      opened: semanticArt('reward-locked-cache', 'opened', true),
    },
  },
  reliquary: {
    ordinary: {
      locked: semanticArt('reward-reliquary', 'locked'),
      ready: semanticArt('reward-reliquary'),
      active: semanticArt('reward-reliquary', 'active'),
      opened: semanticArt('reward-reliquary', 'opened'),
    },
    bountiful: {
      locked: semanticArt('reward-reliquary', 'locked', true),
      ready: semanticArt('reward-reliquary', 'available', true),
      active: semanticArt('reward-reliquary', 'active', true),
      opened: semanticArt('reward-reliquary', 'opened', true),
    },
  },
} as const;

/** Closed semantic routing shared by the minimap and delve schematic painters. */
export function semanticMapMarkerArt(semantic: MapMarkerSemantic): SemanticMapMarkerArt | null {
  switch (semantic.kind) {
    case 'dungeon':
      return DUNGEON_SEMANTIC_ART[semantic.role];
    case 'rift-entrance':
      return semantic.rank ? RIFT_ENTRANCE_RANKED[semantic.rank] : RIFT_ENTRANCE_UNRANKED;
    case 'rift-descent':
      return RIFT_DESCENT_ART;
    case 'rift-return':
      if (semantic.route === 'beacon') return RIFT_BEACON_ART;
      return semantic.rank ? RIFT_EGRESS_RANKED[semantic.rank] : RIFT_EGRESS_UNRANKED;
    case 'rift-reward':
      return RIFT_REWARD_ART[semantic.reward][semantic.state];
    case 'rift-mechanic':
      // Mechanic markers use the semantic painter's allocation-free procedural
      // vocabulary. This generated family is intentionally navigation/reward only.
      return null;
    case 'delve-passage':
      return DELVE_PASSAGE_ART[semantic.state];
    case 'delve-surface':
      return DELVE_SURFACE_ART;
    case 'delve-reward':
      return delveRewardArt(semantic.reward, semantic.state, semantic.bountiful);
    default: {
      const exhaustive: never = semantic;
      return exhaustive;
    }
  }
}

const NAVIGATION_SIZE = {
  minimap: {
    standard: 'minimapNavigation',
    compact: 'minimapNavigationCompact',
    lockedStandard: 'minimapNavigationLocked',
    lockedCompact: 'minimapNavigationLockedCompact',
    CStandard: 'minimapNavigationRankC',
    CCompact: 'minimapNavigationRankCCompact',
    BStandard: 'minimapNavigationRankB',
    BCompact: 'minimapNavigationRankBCompact',
    AStandard: 'minimapNavigationRankA',
    ACompact: 'minimapNavigationRankACompact',
    SStandard: 'minimapNavigationRankS',
    SCompact: 'minimapNavigationRankSCompact',
  },
  map: {
    standard: 'mapNavigation',
    compact: 'mapNavigationCompact',
    lockedStandard: 'mapNavigationLocked',
    lockedCompact: 'mapNavigationLockedCompact',
    CStandard: 'mapNavigationRankC',
    CCompact: 'mapNavigationRankCCompact',
    BStandard: 'mapNavigationRankB',
    BCompact: 'mapNavigationRankBCompact',
    AStandard: 'mapNavigationRankA',
    ACompact: 'mapNavigationRankACompact',
    SStandard: 'mapNavigationRankS',
    SCompact: 'mapNavigationRankSCompact',
  },
} as const;

const REWARD_SIZE = {
  minimap: {
    standard: {
      available: 'minimapRewardAvailable',
      locked: 'minimapRewardLocked',
      active: 'minimapRewardActive',
      opened: 'minimapRewardOpened',
      jammed: 'minimapRewardJammed',
    },
    compact: {
      available: 'minimapRewardAvailableCompact',
      locked: 'minimapRewardLockedCompact',
      active: 'minimapRewardActiveCompact',
      opened: 'minimapRewardOpenedCompact',
      jammed: 'minimapRewardJammedCompact',
    },
    bountifulStandard: {
      available: 'minimapRewardAvailableBountiful',
      locked: 'minimapRewardLockedBountiful',
      active: 'minimapRewardActiveBountiful',
      opened: 'minimapRewardOpenedBountiful',
      jammed: 'minimapRewardJammedBountiful',
    },
    bountifulCompact: {
      available: 'minimapRewardAvailableBountifulCompact',
      locked: 'minimapRewardLockedBountifulCompact',
      active: 'minimapRewardActiveBountifulCompact',
      opened: 'minimapRewardOpenedBountifulCompact',
      jammed: 'minimapRewardJammedBountifulCompact',
    },
  },
  map: {
    standard: {
      available: 'mapRewardAvailable',
      locked: 'mapRewardLocked',
      active: 'mapRewardActive',
      opened: 'mapRewardOpened',
      jammed: 'mapRewardJammed',
    },
    compact: {
      available: 'mapRewardAvailableCompact',
      locked: 'mapRewardLockedCompact',
      active: 'mapRewardActiveCompact',
      opened: 'mapRewardOpenedCompact',
      jammed: 'mapRewardJammedCompact',
    },
    bountifulStandard: {
      available: 'mapRewardAvailableBountiful',
      locked: 'mapRewardLockedBountiful',
      active: 'mapRewardActiveBountiful',
      opened: 'mapRewardOpenedBountiful',
      jammed: 'mapRewardJammedBountiful',
    },
    bountifulCompact: {
      available: 'mapRewardAvailableBountifulCompact',
      locked: 'mapRewardLockedBountifulCompact',
      active: 'mapRewardActiveBountifulCompact',
      opened: 'mapRewardOpenedBountifulCompact',
      jammed: 'mapRewardJammedBountifulCompact',
    },
  },
} as const;

/** Resolve one exact cached raster. No painter scales or decorates the result. */
export function mapMarkerSizeForSemantic(
  surface: 'minimap' | 'map',
  compact: boolean,
  art: SemanticMapMarkerArt,
): MapMarkerSize {
  if (art.id.startsWith('reward-')) {
    const sizes = REWARD_SIZE[surface];
    const stateSizes = art.bountiful
      ? compact
        ? sizes.bountifulCompact
        : sizes.bountifulStandard
      : compact
        ? sizes.compact
        : sizes.standard;
    return stateSizes[art.state];
  }
  const sizes = NAVIGATION_SIZE[surface];
  if (art.state === 'locked') {
    return compact ? sizes.lockedCompact : sizes.lockedStandard;
  }
  if (art.rank) {
    switch (art.rank) {
      case 'C':
        return compact ? sizes.CCompact : sizes.CStandard;
      case 'B':
        return compact ? sizes.BCompact : sizes.BStandard;
      case 'A':
        return compact ? sizes.ACompact : sizes.AStandard;
      case 'S':
        return compact ? sizes.SCompact : sizes.SStandard;
    }
  }
  return compact ? sizes.compact : sizes.standard;
}

export function mapMarkerSizesFor(id: MapMarkerArtId): readonly MapMarkerSize[] {
  if (id.startsWith('dungeon-')) return DUNGEON_MARKER_SIZES;
  if (id.startsWith('gather-')) return GATHER_MARKER_SIZES;
  if (id.startsWith('service-')) return SERVICE_MARKER_SIZES;
  if (id === 'quest-cooldown') return QUEST_COOLDOWN_MARKER_SIZES;
  if (id.startsWith('quest-')) return QUEST_MARKER_SIZES;
  if (id === 'delve-passage') return PASSAGE_MARKER_SIZES;
  if (id === 'rift-entrance' || id === 'rift-egress') return RANKED_NAVIGATION_MARKER_SIZES;
  if (id.startsWith('delve-') || id.startsWith('rift-')) return NAVIGATION_MARKER_SIZES;
  if (id === 'reward-treasure') return TREASURE_REWARD_MARKER_SIZES;
  if (id === 'reward-locked-cache') return CACHE_REWARD_MARKER_SIZES;
  if (id === 'reward-reliquary') return RELIQUARY_REWARD_MARKER_SIZES;
  if (id === 'world-passage') return NAVIGATION_MARKER_SIZES;
  return STATION_MARKER_SIZES;
}

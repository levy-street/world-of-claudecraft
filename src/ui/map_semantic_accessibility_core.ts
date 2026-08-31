// Pure location, signature, and hit-test helpers for the map's semantic layer.
// Inputs are already-painted model coordinates and disclosure-filtered semantics;
// this module never reads world state or player-visible text.

import { BG_BASES } from '../sim/battleground_layout';
import type { StationType } from '../sim/types';
import type { DungeonMapModel } from './dungeon_map_view';
import {
  type BgMapModel,
  bgMapCanvasX,
  bgMapCanvasY,
  bgMapFitScale,
} from './hud/battleground/battleground_map_view';
import type { RiftMapModel } from './hud/rift/rift_map_core';
import { formatNumber, getLanguage, type TranslationKey, t } from './i18n';
import type { MapMarkerSemantic, MapMarkerSemanticLayer } from './map_marker_semantics_core';
import type {
  MapAllyMarker,
  MapGatherNodeMarker,
  MapNavigationMarker,
  MapNpcMarker,
  MapPartyMarker,
  MapPlayerMarker,
  MapPoiMarker,
  MapPortalMarker,
  MapQuestAreaMarker,
  MapServiceMarker,
  MapStationMarker,
} from './map_window_view';

export type MapInstanceSemantic = Exclude<MapMarkerSemantic, { kind: 'dungeon' | 'rift-entrance' }>;

export type MapMarkerDirection =
  | 'center'
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest';
export type MapMarkerDistance = 'near' | 'medium' | 'far';

export interface MapMarkerLocation {
  direction: MapMarkerDirection;
  distance: MapMarkerDistance;
}

export interface PaintedSemanticMarker {
  cx: number;
  cy: number;
  semantic: MapInstanceSemantic;
}

export interface MapSemanticHit extends MapMarkerLocation {
  marker: PaintedSemanticMarker;
  layer: MapMarkerSemanticLayer;
  distance2: number;
}

const CENTER_RADIUS_RATIO = 0.04;
const NEAR_RADIUS_RATIO = 0.2;
const MEDIUM_RADIUS_RATIO = 0.42;
const SUMMARY_GROUP_CAP = 40;
const SUMMARY_VISIBLE_GROUP_CAP = 18;

const DIRECTIONS = [
  'center',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'north',
  'northeast',
] as const satisfies readonly MapMarkerDirection[];
const DISTANCES = ['near', 'medium', 'far'] as const satisfies readonly MapMarkerDistance[];

function hashText(hash: number, value: string): number {
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash;
}

const HIT_TIE_PRIORITY: Readonly<Record<MapMarkerSemanticLayer, number>> = {
  navigation: 0,
  reward: 1,
  mechanic: 2,
};

export function semanticMarkerLayer(semantic: MapInstanceSemantic): MapMarkerSemanticLayer {
  switch (semantic.kind) {
    case 'rift-mechanic':
      return 'mechanic';
    case 'rift-reward':
    case 'delve-reward':
      return 'reward';
    default:
      return 'navigation';
  }
}

/** Quantize canvas coordinates relative to a reference point. Distances scale
 * with the canvas side, so the same painted layout describes identically on
 * desktop and compact maps. */
export function quantizeMapMarkerLocation(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  canvasSize: number,
): MapMarkerLocation {
  const code = quantizedLocationCode(x, y, centerX, centerY, canvasSize);
  return locationFromCode(code);
}

function quantizedLocationCode(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  canvasSize: number,
): number {
  const dx = x - centerX;
  const dy = y - centerY;
  const distance = Math.hypot(dx, dy);
  const side = Math.max(1, canvasSize);
  const band =
    distance <= side * NEAR_RADIUS_RATIO ? 0 : distance <= side * MEDIUM_RADIUS_RATIO ? 1 : 2;
  if (distance <= side * CENTER_RADIUS_RATIO) return band;
  // Canvas +Y points south. Adding half a sector rounds to the nearest octant.
  const octant = Math.round((Math.atan2(dy, dx) * 4) / Math.PI + 8) % 8;
  return (octant + 1) * DISTANCES.length + band;
}

function locationFromCode(code: number): MapMarkerLocation {
  return {
    direction: DIRECTIONS[Math.floor(code / DISTANCES.length)],
    distance: DISTANCES[code % DISTANCES.length],
  };
}

function semanticHitBefore(a: MapSemanticHit, b: MapSemanticHit): boolean {
  return (
    a.distance2 < b.distance2 ||
    (a.distance2 === b.distance2 && HIT_TIE_PRIORITY[a.layer] < HIT_TIE_PRIORITY[b.layer])
  );
}

function swapHitContents(a: MapSemanticHit, b: MapSemanticHit): void {
  const marker = a.marker;
  const layer = a.layer;
  const distance2 = a.distance2;
  const direction = a.direction;
  const distance = a.distance;
  a.marker = b.marker;
  a.layer = b.layer;
  a.distance2 = b.distance2;
  a.direction = b.direction;
  a.distance = b.distance;
  b.marker = marker;
  b.layer = layer;
  b.distance2 = distance2;
  b.direction = direction;
  b.distance = distance;
}

function writeHit(
  output: MapSemanticHit[],
  index: number,
  marker: PaintedSemanticMarker,
  distance2: number,
  centerX: number,
  centerY: number,
  canvasSize: number,
): MapSemanticHit {
  const locationCode = quantizedLocationCode(marker.cx, marker.cy, centerX, centerY, canvasSize);
  const layer = semanticMarkerLayer(marker.semantic);
  let hit = output[index];
  if (!hit) {
    hit = {
      marker,
      distance2,
      layer,
      direction: DIRECTIONS[Math.floor(locationCode / DISTANCES.length)],
      distance: DISTANCES[locationCode % DISTANCES.length],
    };
    output.push(hit);
  } else {
    hit.marker = marker;
    hit.distance2 = distance2;
    hit.layer = layer;
    hit.direction = DIRECTIONS[Math.floor(locationCode / DISTANCES.length)];
    hit.distance = DISTANCES[locationCode % DISTANCES.length];
  }
  return hit;
}

/** Fill a reusable sorted hit-slot pool. Entries beyond the returned active
 * count are capacity only and must not be consumed. */
export function mapSemanticHitsInto(
  markers: readonly PaintedSemanticMarker[],
  x: number,
  y: number,
  radius: number,
  centerX: number,
  centerY: number,
  canvasSize: number,
  output: MapSemanticHit[],
): number {
  const radius2 = Math.max(0, radius) ** 2;
  let activeCount = 0;
  for (const marker of markers) {
    const dx = x - marker.cx;
    const dy = y - marker.cy;
    const distance2 = dx * dx + dy * dy;
    if (distance2 > radius2) continue;
    writeHit(output, activeCount, marker, distance2, centerX, centerY, canvasSize);
    let index = activeCount;
    while (index > 0 && semanticHitBefore(output[index], output[index - 1])) {
      swapHitContents(output[index], output[index - 1]);
      index--;
    }
    activeCount++;
  }
  return activeCount;
}

/** Deterministic state token for write-elision signatures and regression tests. */
export function mapMarkerSemanticToken(semantic: MapInstanceSemantic): string {
  switch (semantic.kind) {
    case 'rift-descent':
      return 'rift-descent';
    case 'rift-return':
      return `rift-return:${semantic.route}:${semantic.rank ?? 'none'}`;
    case 'rift-reward':
      return `rift-reward:${semantic.reward}:${semantic.state}`;
    case 'rift-mechanic':
      return `rift-mechanic:${semantic.mechanic}:${semantic.state}`;
    case 'delve-passage':
      return `delve-passage:${semantic.state}`;
    case 'delve-surface':
      return 'delve-surface';
    case 'delve-reward':
      return `delve-reward:${semantic.reward}:${semantic.state}:${semantic.bountiful ? 1 : 0}`;
  }
}

export function mapSemanticMarkerSignature(
  marker: PaintedSemanticMarker,
  index: number,
  centerX: number,
  centerY: number,
  canvasSize: number,
): string {
  const location = quantizeMapMarkerLocation(marker.cx, marker.cy, centerX, centerY, canvasSize);
  return `${index}:${mapMarkerSemanticToken(marker.semantic)}:${location.direction}:${location.distance}`;
}

export type MapSemanticLabelId =
  | 'you'
  | 'availableQuest'
  | 'readyQuest'
  | 'repeatQuest'
  | 'cooldownQuest'
  | 'questObjective'
  | 'readyOre'
  | 'readyWood'
  | 'readyHerb'
  | 'readyLockedOre'
  | 'readyLockedWood'
  | 'readyLockedHerb'
  | 'cooldownOre'
  | 'cooldownWood'
  | 'cooldownHerb'
  | 'cooldownLockedOre'
  | 'cooldownLockedWood'
  | 'cooldownLockedHerb'
  | 'station'
  | 'service'
  | 'partyMember'
  | 'deadPartyMember'
  | 'partyMemberGeneric'
  | 'deadPartyMemberGeneric'
  | 'friend'
  | 'guildMember'
  | 'pointOfInterest'
  | 'dungeonEntrance'
  | 'dungeonExit'
  | 'delveEntrance'
  | 'worldPassage'
  | 'riftEntrance'
  | 'hostileEnemy'
  | 'aggressiveEnemy'
  | 'bossEnemy'
  | 'bossAggressiveEnemy'
  | 'lootableEnemy'
  | 'corpse'
  | 'deathZone'
  | 'teammate'
  | 'deadTeammate'
  | 'flagCarrier'
  | 'ownFlagStand'
  | 'enemyFlagStand'
  | 'riftDescent'
  | 'riftReturnBeacon'
  | 'riftReturnExit'
  | 'riftTreasureAvailable'
  | 'riftTreasureLocked'
  | 'riftTreasureOpened'
  | 'riftTreasureJammed'
  | 'riftCacheAvailable'
  | 'riftCacheLocked'
  | 'riftCacheOpened'
  | 'riftCacheJammed'
  | 'pylonUnlit'
  | 'pylonLit'
  | 'sequenceRuneUnlit'
  | 'sequenceRuneLit'
  | 'iceGoal'
  | 'boulderPad'
  | 'boulderMovable'
  | 'boulderPlaced'
  | 'gateSealed'
  | 'gateOpen'
  | 'switchReady'
  | 'switchOn'
  | 'orbDormant'
  | 'orbActive'
  | 'rollerHazard'
  | 'delvePassageSealed'
  | 'delvePassageOpen'
  | 'delveSurfaceExit'
  | 'delveCacheLocked'
  | 'delveCacheReady'
  | 'delveCacheActive'
  | 'delveCacheOpened'
  | 'delveReliquaryLocked'
  | 'delveReliquaryReady'
  | 'delveReliquaryActive'
  | 'delveReliquaryOpened';

type MapSummaryCategory =
  | 'navigation'
  | 'quest'
  | 'gather'
  | 'station'
  | 'service'
  | 'live'
  | 'objective';

/** Every populated category gets one slot before the bounded summary admits
 * repeated location groups. Authored stations/services then keep one slot per
 * semantic identity, followed by gather identities, so crowded quest areas do
 * not erase the player's resource and town-service vocabulary. */
const SUMMARY_CATEGORY_PRIORITY = Object.freeze([
  'navigation',
  'quest',
  'gather',
  'station',
  'service',
  'live',
  'objective',
] as const satisfies readonly MapSummaryCategory[]);
const SUMMARY_IDENTITY_PRIORITY = Object.freeze([
  'station',
  'service',
  'gather',
] as const satisfies readonly MapSummaryCategory[]);

function mapSummaryCategory(label: MapSemanticLabelId): MapSummaryCategory {
  switch (label) {
    case 'pointOfInterest':
    case 'dungeonEntrance':
    case 'dungeonExit':
    case 'delveEntrance':
    case 'worldPassage':
    case 'riftEntrance':
    case 'riftDescent':
    case 'riftReturnBeacon':
    case 'riftReturnExit':
    case 'delvePassageSealed':
    case 'delvePassageOpen':
    case 'delveSurfaceExit':
      return 'navigation';
    case 'availableQuest':
    case 'readyQuest':
    case 'repeatQuest':
    case 'cooldownQuest':
      return 'quest';
    case 'readyOre':
    case 'readyWood':
    case 'readyHerb':
    case 'readyLockedOre':
    case 'readyLockedWood':
    case 'readyLockedHerb':
    case 'cooldownOre':
    case 'cooldownWood':
    case 'cooldownHerb':
    case 'cooldownLockedOre':
    case 'cooldownLockedWood':
    case 'cooldownLockedHerb':
      return 'gather';
    case 'station':
      return 'station';
    case 'service':
      return 'service';
    case 'you':
    case 'partyMember':
    case 'deadPartyMember':
    case 'partyMemberGeneric':
    case 'deadPartyMemberGeneric':
    case 'friend':
    case 'guildMember':
    case 'hostileEnemy':
    case 'aggressiveEnemy':
    case 'bossEnemy':
    case 'bossAggressiveEnemy':
    case 'lootableEnemy':
    case 'corpse':
    case 'teammate':
    case 'deadTeammate':
    case 'flagCarrier':
      return 'live';
    case 'questObjective':
    case 'deathZone':
    case 'ownFlagStand':
    case 'enemyFlagStand':
    case 'riftTreasureAvailable':
    case 'riftTreasureLocked':
    case 'riftTreasureOpened':
    case 'riftTreasureJammed':
    case 'riftCacheAvailable':
    case 'riftCacheLocked':
    case 'riftCacheOpened':
    case 'riftCacheJammed':
    case 'pylonUnlit':
    case 'pylonLit':
    case 'sequenceRuneUnlit':
    case 'sequenceRuneLit':
    case 'iceGoal':
    case 'boulderPad':
    case 'boulderMovable':
    case 'boulderPlaced':
    case 'gateSealed':
    case 'gateOpen':
    case 'switchReady':
    case 'switchOn':
    case 'orbDormant':
    case 'orbActive':
    case 'rollerHazard':
    case 'delveCacheLocked':
    case 'delveCacheReady':
    case 'delveCacheActive':
    case 'delveCacheOpened':
    case 'delveReliquaryLocked':
    case 'delveReliquaryReady':
    case 'delveReliquaryActive':
    case 'delveReliquaryOpened':
      return 'objective';
    default: {
      const exhaustive: never = label;
      return exhaustive;
    }
  }
}

export function mapSemanticLabelId(semantic: MapInstanceSemantic): MapSemanticLabelId {
  switch (semantic.kind) {
    case 'rift-descent':
      return 'riftDescent';
    case 'rift-return':
      return semantic.route === 'beacon' ? 'riftReturnBeacon' : 'riftReturnExit';
    case 'rift-reward':
      if (semantic.reward === 'treasure') {
        if (semantic.state === 'available') return 'riftTreasureAvailable';
        if (semantic.state === 'locked') return 'riftTreasureLocked';
        if (semantic.state === 'opened') return 'riftTreasureOpened';
        return 'riftTreasureJammed';
      }
      if (semantic.state === 'available') return 'riftCacheAvailable';
      if (semantic.state === 'locked') return 'riftCacheLocked';
      if (semantic.state === 'opened') return 'riftCacheOpened';
      return 'riftCacheJammed';
    case 'rift-mechanic':
      switch (semantic.mechanic) {
        case 'pylon':
          return semantic.state === 'lit' ? 'pylonLit' : 'pylonUnlit';
        case 'sequence-rune':
          return semantic.state === 'lit' ? 'sequenceRuneLit' : 'sequenceRuneUnlit';
        case 'ice-goal':
          return 'iceGoal';
        case 'boulder-pad':
          return 'boulderPad';
        case 'boulder':
          return semantic.state === 'placed' ? 'boulderPlaced' : 'boulderMovable';
        case 'gate':
          return semantic.state === 'open' ? 'gateOpen' : 'gateSealed';
        case 'switch':
          return semantic.state === 'on' ? 'switchOn' : 'switchReady';
        case 'orb':
          return semantic.state === 'active' ? 'orbActive' : 'orbDormant';
        case 'roller':
          return 'rollerHazard';
        default: {
          const exhaustive: never = semantic;
          return exhaustive;
        }
      }
    case 'delve-passage':
      return semantic.state === 'open' ? 'delvePassageOpen' : 'delvePassageSealed';
    case 'delve-surface':
      return 'delveSurfaceExit';
    case 'delve-reward':
      if (semantic.reward === 'cache') {
        if (semantic.state === 'locked') return 'delveCacheLocked';
        if (semantic.state === 'ready') return 'delveCacheReady';
        if (semantic.state === 'active') return 'delveCacheActive';
        return 'delveCacheOpened';
      }
      if (semantic.state === 'locked') return 'delveReliquaryLocked';
      if (semantic.state === 'ready') return 'delveReliquaryReady';
      if (semantic.state === 'active') return 'delveReliquaryActive';
      return 'delveReliquaryOpened';
  }
}

type ArgumentKind =
  | 'none'
  | 'literal'
  | 'zone'
  | 'dungeon'
  | 'delve'
  | 'station'
  | 'poi'
  | 'rift'
  | 'service'
  | 'npc'
  | 'mob';

interface SummaryGroup extends MapMarkerLocation {
  label: MapSemanticLabelId;
  argumentKind: ArgumentKind;
  argument: string;
  argumentIndex: number;
  rank: string;
  bountiful: boolean;
  count: number;
  singleText: string;
  selected: boolean;
}

function sameSummaryIdentity(a: SummaryGroup, b: SummaryGroup): boolean {
  return (
    a.label === b.label &&
    a.argumentKind === b.argumentKind &&
    a.argument === b.argument &&
    a.argumentIndex === b.argumentIndex &&
    a.rank === b.rank &&
    a.bountiful === b.bountiful
  );
}

export interface MapSemanticNameResolvers {
  zone(zoneId: string): string;
  dungeon(dungeonId: string): string;
  delve(delveId: string): string;
  station(type: StationType): string;
  poi(zoneId: string, poiIndex: number): string;
  rift(name: string, rank: string | null): string;
  npc(npcId: string): string;
  mob(mobId: string): string;
}

export interface DelveSemanticMapModel {
  mobs: readonly { cx: number; cy: number; aggro: boolean }[];
  rewards: readonly PaintedSemanticMarker[];
  navigation: readonly PaintedSemanticMarker[];
  party: readonly { cx: number; cy: number; dead: number }[];
  player: { cx: number; cy: number };
  areaLabel: string;
}

export interface OverworldSemanticMapModel {
  questAreas: readonly MapQuestAreaMarker[];
  npcs: readonly MapNpcMarker[];
  gatherNodes: readonly MapGatherNodeMarker[];
  stations: readonly MapStationMarker[];
  services: readonly MapServiceMarker[];
  navigation: readonly MapNavigationMarker[];
  player: MapPlayerMarker | null;
  allies: readonly MapAllyMarker[];
  party: readonly MapPartyMarker[];
  portals: readonly MapPortalMarker[];
  pois: readonly MapPoiMarker[];
}

/** Stateful, DOM-free adapter over exact painter return models. It owns bounded
 * reusable summary/hit pools and caches localized prose on a signature made
 * only from identity, state, direction, and distance band. */
export class MapSemanticAccessibilityCore {
  readonly instanceMarkers: PaintedSemanticMarker[] = [];
  private readonly hitScratch: MapSemanticHit[] = [];
  private readonly groups: SummaryGroup[] = [];
  private readonly visibleGroupIndices: number[] = [];
  private groupCount = 0;
  private omittedCount = 0;
  private centerX = 0;
  private centerY = 0;
  private canvasSize = 1;
  private area = '';
  private lastHash = -1;
  private lastLanguage = '';
  private description = '';

  constructor(private readonly names: MapSemanticNameResolvers) {}

  clear(): void {
    this.instanceMarkers.length = 0;
    this.groupCount = 0;
    this.omittedCount = 0;
  }

  private begin(area: string, centerX: number, centerY: number, canvasSize: number): void {
    this.clear();
    this.area = area;
    this.centerX = centerX;
    this.centerY = centerY;
    this.canvasSize = canvasSize;
  }

  private add(
    x: number,
    y: number,
    label: MapSemanticLabelId,
    argumentKind: ArgumentKind = 'none',
    argument = '',
    argumentIndex = 0,
    rank = '',
    bountiful = false,
  ): void {
    const code = quantizedLocationCode(x, y, this.centerX, this.centerY, this.canvasSize);
    const direction = DIRECTIONS[Math.floor(code / DISTANCES.length)];
    const distance = DISTANCES[code % DISTANCES.length];
    for (let i = 0; i < this.groupCount; i++) {
      const group = this.groups[i];
      if (
        group.label === label &&
        group.argumentKind === argumentKind &&
        group.argument === argument &&
        group.argumentIndex === argumentIndex &&
        group.rank === rank &&
        group.bountiful === bountiful &&
        group.direction === direction &&
        group.distance === distance
      ) {
        group.count++;
        return;
      }
    }
    if (this.groupCount >= SUMMARY_GROUP_CAP) {
      this.omittedCount++;
      return;
    }
    let group = this.groups[this.groupCount];
    if (!group) {
      group = {
        label,
        argumentKind,
        argument,
        argumentIndex,
        rank,
        bountiful,
        direction,
        distance,
        count: 1,
        singleText: '',
        selected: false,
      };
      this.groups.push(group);
    } else {
      const sameText =
        group.label === label &&
        group.argumentKind === argumentKind &&
        group.argument === argument &&
        group.argumentIndex === argumentIndex &&
        group.rank === rank &&
        group.bountiful === bountiful &&
        group.direction === direction &&
        group.distance === distance;
      group.label = label;
      group.argumentKind = argumentKind;
      group.argument = argument;
      group.argumentIndex = argumentIndex;
      group.rank = rank;
      group.bountiful = bountiful;
      group.direction = direction;
      group.distance = distance;
      group.count = 1;
      group.selected = false;
      if (!sameText) group.singleText = '';
    }
    this.groupCount++;
  }

  private addSemantic(marker: PaintedSemanticMarker): void {
    const semantic = marker.semantic;
    this.add(
      marker.cx,
      marker.cy,
      mapSemanticLabelId(semantic),
      'none',
      '',
      0,
      semantic.kind === 'rift-return' ? (semantic.rank ?? '') : '',
      semantic.kind === 'delve-reward' && semantic.bountiful,
    );
  }

  private argument(
    kind: ArgumentKind,
    argument: string,
    argumentIndex: number,
    rank: string,
  ): string {
    switch (kind) {
      case 'none':
        return '';
      case 'literal':
        return argument;
      case 'zone':
        return this.names.zone(argument);
      case 'dungeon':
        return this.names.dungeon(argument);
      case 'delve':
        return this.names.delve(argument);
      case 'station':
        return this.names.station(argument as StationType);
      case 'poi':
        return this.names.poi(argument, argumentIndex);
      case 'rift':
        return this.names.rift(argument, rank || null);
      case 'service':
        return t(
          argument === 'mailbox' ? 'worldContent.mailboxName' : 'worldContent.noticeboardName',
        );
      case 'npc':
        return this.names.npc(argument);
      case 'mob':
        return this.names.mob(argument);
    }
  }

  private labelText(
    label: MapSemanticLabelId,
    argumentKind: ArgumentKind,
    argument: string,
    rank = '',
    bountiful = false,
    argumentIndex = 0,
  ): string {
    const name = this.argument(argumentKind, argument, argumentIndex, rank);
    let values: Record<string, string> | undefined;
    if (
      label === 'station' ||
      label === 'service' ||
      label === 'partyMember' ||
      label === 'deadPartyMember' ||
      label === 'friend' ||
      label === 'guildMember' ||
      label === 'pointOfInterest' ||
      label === 'bossEnemy' ||
      label === 'bossAggressiveEnemy' ||
      label === 'dungeonEntrance' ||
      label === 'delveEntrance' ||
      label === 'riftEntrance'
    )
      values = { name };
    else if (label === 'worldPassage') values = { zone: name };
    let text = t(`hud.core.mapMarkerLabels.${label}` as TranslationKey, values);
    if (rank && argumentKind !== 'rift')
      text = t('hud.core.mapMarkerLabels.ranked' as TranslationKey, { marker: text, rank });
    if (bountiful) text = t('hud.core.mapMarkerLabels.bountiful', { marker: text });
    return text;
  }

  private locatedText(
    marker: string,
    direction: MapMarkerDirection,
    distance: MapMarkerDistance,
    count = 1,
  ): string {
    const values = {
      marker,
      count: formatNumber(count, { maximumFractionDigits: 0 }),
      direction: t(`hud.core.mapMarkerDirections.${direction}` as TranslationKey),
      distance: t(`hud.core.mapMarkerDistances.${distance}` as TranslationKey),
    };
    return t(count === 1 ? 'hud.core.mapMarkerLocated' : 'hud.core.mapMarkerLocatedCount', values);
  }

  /** Choose a bounded, deterministic active prefix without allocating. Selection
   * is category-first, then identity-first for authored town/resource markers,
   * then stable painter order. The reused index pool is finally rewritten into
   * painter order so existing narration order remains unchanged. */
  private selectVisibleGroups(): void {
    this.visibleGroupIndices.length = 0;
    for (let i = 0; i < this.groupCount; i++) this.groups[i].selected = false;

    const select = (index: number): boolean => {
      const group = this.groups[index];
      if (group.selected || this.visibleGroupIndices.length >= SUMMARY_VISIBLE_GROUP_CAP)
        return false;
      group.selected = true;
      this.visibleGroupIndices.push(index);
      return true;
    };

    if (this.groupCount <= SUMMARY_VISIBLE_GROUP_CAP) {
      for (let i = 0; i < this.groupCount; i++) select(i);
      return;
    }

    // Keep the reader's orientation anchor even when another live marker is
    // chosen as the representative dynamic (party, ally, hostile, or corpse).
    for (let i = 0; i < this.groupCount; i++) {
      if (this.groups[i].label === 'you') {
        select(i);
        break;
      }
    }

    for (const category of SUMMARY_CATEGORY_PRIORITY) {
      for (let i = 0; i < this.groupCount; i++) {
        if (mapSummaryCategory(this.groups[i].label) === category && select(i)) break;
      }
    }

    for (const category of SUMMARY_IDENTITY_PRIORITY) {
      for (let i = 0; i < this.groupCount; i++) {
        const candidate = this.groups[i];
        if (mapSummaryCategory(candidate.label) !== category || candidate.selected) continue;
        let represented = false;
        for (
          let selectedIndex = 0;
          selectedIndex < this.visibleGroupIndices.length;
          selectedIndex++
        ) {
          if (
            sameSummaryIdentity(candidate, this.groups[this.visibleGroupIndices[selectedIndex]])
          ) {
            represented = true;
            break;
          }
        }
        if (!represented) select(i);
      }
    }

    for (let i = 0; i < this.groupCount; i++) select(i);

    this.visibleGroupIndices.length = 0;
    for (let i = 0; i < this.groupCount; i++) {
      if (this.groups[i].selected) this.visibleGroupIndices.push(i);
    }
  }

  private finish(): string {
    let hash = 2166136261;
    hash = hashText(hash, this.area);
    hash = Math.imul(hash ^ this.omittedCount, 16777619);
    for (let i = 0; i < this.groupCount; i++) {
      const group = this.groups[i];
      hash = hashText(hash, group.label);
      hash = hashText(hash, group.argumentKind);
      hash = hashText(hash, group.argument);
      hash = hashText(hash, group.rank);
      hash = hashText(hash, group.direction);
      hash = hashText(hash, group.distance);
      hash = Math.imul(hash ^ group.argumentIndex, 16777619);
      hash = Math.imul(hash ^ group.count, 16777619);
      hash = Math.imul(hash ^ Number(group.bountiful), 16777619);
    }
    const language = getLanguage();
    if (hash === this.lastHash && language === this.lastLanguage) return this.description;
    const languageChanged = language !== this.lastLanguage;
    this.lastHash = hash;
    this.lastLanguage = language;
    if (languageChanged) {
      for (let i = 0; i < this.groupCount; i++) this.groups[i].singleText = '';
    }
    this.selectVisibleGroups();
    let markers = '';
    for (let visibleIndex = 0; visibleIndex < this.visibleGroupIndices.length; visibleIndex++) {
      const group = this.groups[this.visibleGroupIndices[visibleIndex]];
      const label = this.labelText(
        group.label,
        group.argumentKind,
        group.argument,
        group.rank,
        group.bountiful,
        group.argumentIndex,
      );
      group.singleText = this.locatedText(label, group.direction, group.distance);
      markers +=
        group.count === 1
          ? group.singleText
          : this.locatedText(label, group.direction, group.distance, group.count);
      if (visibleIndex + 1 < this.visibleGroupIndices.length) markers += ' ';
    }
    let more = this.omittedCount;
    for (let i = 0; i < this.groupCount; i++) {
      if (!this.groups[i].selected) more += this.groups[i].count;
    }
    if (more > 0) {
      if (markers) markers += ' ';
      markers += t('hud.core.mapMarkerMore', {
        count: formatNumber(more, { maximumFractionDigits: 0 }),
      });
    }
    if (!markers) markers = t('hud.core.mapMarkerEmpty');
    this.description = t('hud.core.mapMarkerDescription', { area: this.area, markers });
    return this.description;
  }

  updateRift(model: RiftMapModel | null, canvasSize: number): string {
    const area = model?.areaLabel ?? '';
    this.begin(
      area,
      model?.player.cx ?? canvasSize / 2,
      model?.player.cy ?? canvasSize / 2,
      canvasSize,
    );
    if (!model) return this.finish();
    this.add(model.player.cx, model.player.cy, 'you');
    for (const object of model.objects) {
      this.instanceMarkers.push(object);
      this.addSemantic(object);
    }
    for (const mob of model.mobs)
      this.add(
        mob.cx,
        mob.cy,
        mob.state === 'loot' ? 'lootableEnemy' : mob.aggro ? 'aggressiveEnemy' : 'hostileEnemy',
      );
    for (const member of model.party)
      this.add(member.cx, member.cy, member.dead ? 'deadPartyMemberGeneric' : 'partyMemberGeneric');
    for (const zone of model.deathZones) this.add(zone.cx, zone.cy, 'deathZone');
    if (model.corpse) this.add(model.corpse.cx, model.corpse.cy, 'corpse');
    return this.finish();
  }

  updateDelve(model: DelveSemanticMapModel | null, canvasSize: number): string {
    const area = model?.areaLabel ?? '';
    this.begin(
      area,
      model?.player.cx ?? canvasSize / 2,
      model?.player.cy ?? canvasSize / 2,
      canvasSize,
    );
    if (!model) return this.finish();
    this.add(model.player.cx, model.player.cy, 'you');
    for (const reward of model.rewards) {
      this.instanceMarkers.push(reward);
      this.addSemantic(reward);
    }
    for (const navigation of model.navigation) {
      this.instanceMarkers.push(navigation);
      this.addSemantic(navigation);
    }
    for (const mob of model.mobs)
      this.add(mob.cx, mob.cy, mob.aggro ? 'aggressiveEnemy' : 'hostileEnemy');
    for (const member of model.party)
      this.add(member.cx, member.cy, member.dead ? 'deadPartyMemberGeneric' : 'partyMemberGeneric');
    return this.finish();
  }

  updateDungeon(model: DungeonMapModel | null, area: string, canvasSize: number): string {
    const player = model?.markers.find((marker) => marker.kind === 'player');
    this.begin(area, player?.cx ?? canvasSize / 2, player?.cy ?? canvasSize / 2, canvasSize);
    if (!model) return this.finish();
    for (const marker of model.markers) {
      switch (marker.kind) {
        case 'player':
          this.add(marker.cx, marker.cy, 'you');
          break;
        case 'exit':
          this.add(marker.cx, marker.cy, 'dungeonExit');
          break;
        case 'gate':
          this.add(marker.cx, marker.cy, 'gateSealed');
          break;
        case 'loot':
          this.add(
            marker.cx,
            marker.cy,
            marker.source === 'enemy' ? 'lootableEnemy' : 'riftTreasureAvailable',
          );
          break;
        case 'npc':
          this.add(marker.cx, marker.cy, 'pointOfInterest', 'npc', marker.templateId);
          break;
        case 'mob':
          this.add(
            marker.cx,
            marker.cy,
            marker.boss
              ? marker.aggro
                ? 'bossAggressiveEnemy'
                : 'bossEnemy'
              : marker.aggro
                ? 'aggressiveEnemy'
                : 'hostileEnemy',
            marker.boss ? 'mob' : 'none',
            marker.boss ? marker.templateId : '',
          );
          break;
        case 'party':
          this.add(
            marker.cx,
            marker.cy,
            marker.dead ? 'deadPartyMemberGeneric' : 'partyMemberGeneric',
          );
          break;
      }
    }
    return this.finish();
  }

  updateOverworld(model: OverworldSemanticMapModel, area: string, canvasSize: number): string {
    const centerX = model.player?.mx ?? canvasSize / 2;
    const centerY = model.player?.my ?? canvasSize / 2;
    this.begin(area, centerX, centerY, canvasSize);
    if (model.player) this.add(model.player.mx, model.player.my, 'you');
    for (const marker of model.navigation) {
      if (marker.kind === 'delve-entrance')
        this.add(marker.mx, marker.my, 'delveEntrance', 'delve', marker.delveId);
      else if (marker.kind === 'world-passage')
        this.add(marker.mx, marker.my, 'worldPassage', 'zone', marker.destinationZoneId);
      else
        this.add(marker.mx, marker.my, 'riftEntrance', 'rift', marker.name, 0, marker.rank ?? '');
    }
    for (const portal of model.portals)
      this.add(portal.mx, portal.my, 'dungeonEntrance', 'dungeon', portal.dungeonId);
    for (const npc of model.npcs)
      for (const quest of npc.quests)
        this.add(
          npc.mx,
          npc.my,
          quest.kind === 'ready'
            ? 'readyQuest'
            : quest.kind === 'repeat'
              ? 'repeatQuest'
              : quest.kind === 'cooldown'
                ? 'cooldownQuest'
                : 'availableQuest',
        );
    for (const areaMarker of model.questAreas)
      this.add(areaMarker.mx, areaMarker.my, 'questObjective');
    for (const node of model.gatherNodes) {
      const label = node.ready
        ? node.locked
          ? node.type === 'ore'
            ? 'readyLockedOre'
            : node.type === 'wood'
              ? 'readyLockedWood'
              : 'readyLockedHerb'
          : node.type === 'ore'
            ? 'readyOre'
            : node.type === 'wood'
              ? 'readyWood'
              : 'readyHerb'
        : node.locked
          ? node.type === 'ore'
            ? 'cooldownLockedOre'
            : node.type === 'wood'
              ? 'cooldownLockedWood'
              : 'cooldownLockedHerb'
          : node.type === 'ore'
            ? 'cooldownOre'
            : node.type === 'wood'
              ? 'cooldownWood'
              : 'cooldownHerb';
      this.add(node.mx, node.my, label);
    }
    for (const station of model.stations)
      this.add(station.mx, station.my, 'station', 'station', station.type);
    for (const service of model.services)
      this.add(service.mx, service.my, 'service', 'service', service.kind);
    for (const member of model.party)
      this.add(
        member.mx,
        member.my,
        member.dead ? 'deadPartyMember' : 'partyMember',
        'literal',
        member.name,
      );
    for (const ally of model.allies)
      this.add(
        ally.mx,
        ally.my,
        ally.kind === 'friend' ? 'friend' : 'guildMember',
        'literal',
        ally.name,
      );
    for (const poi of model.pois)
      this.add(poi.mx, poi.my, 'pointOfInterest', 'poi', poi.zoneId, poi.poiIndex);
    return this.finish();
  }

  updateBattleground(model: BgMapModel, area: string, canvasSize: number): string {
    const scale = bgMapFitScale(canvasSize, model.halfX, model.halfZ);
    const selfX = model.self ? bgMapCanvasX(model.self.x, canvasSize, scale) : canvasSize / 2;
    const selfY = model.self ? bgMapCanvasY(model.self.z, canvasSize, scale) : canvasSize / 2;
    this.begin(area, selfX, selfY, canvasSize);
    if (model.active) {
      if (model.self) this.add(selfX, selfY, 'you');
      const flip = model.myTeam === 0 ? 1 : -1;
      for (const base of BG_BASES) {
        this.add(
          bgMapCanvasX(base.flag.x * flip, canvasSize, scale),
          bgMapCanvasY(base.flag.z * flip, canvasSize, scale),
          base.team === model.myTeam ? 'ownFlagStand' : 'enemyFlagStand',
        );
      }
      for (const mate of model.mates)
        this.add(
          bgMapCanvasX(mate.x, canvasSize, scale),
          bgMapCanvasY(mate.z, canvasSize, scale),
          mate.carrying ? 'flagCarrier' : mate.dead ? 'deadTeammate' : 'teammate',
        );
    }
    return this.finish();
  }

  updateSimple(area: string, canvasSize: number): string {
    this.begin(area, canvasSize / 2, canvasSize / 2, canvasSize);
    return this.finish();
  }

  navigationText(marker: MapNavigationMarker): string {
    if (marker.kind === 'delve-entrance')
      return this.labelText('delveEntrance', 'delve', marker.delveId);
    if (marker.kind === 'world-passage')
      return this.labelText('worldPassage', 'zone', marker.destinationZoneId);
    return this.labelText('riftEntrance', 'rift', marker.name, marker.rank ?? '');
  }

  tooltipAt(x: number, y: number, radius: number): string {
    const count = mapSemanticHitsInto(
      this.instanceMarkers,
      x,
      y,
      radius,
      this.centerX,
      this.centerY,
      this.canvasSize,
      this.hitScratch,
    );
    if (count === 0) return '';
    const hit = this.hitScratch[0];
    const semantic = hit.marker.semantic;
    const labelId = mapSemanticLabelId(semantic);
    const rank = semantic.kind === 'rift-return' ? (semantic.rank ?? '') : '';
    const bountiful = semantic.kind === 'delve-reward' && semantic.bountiful;
    for (let i = 0; i < this.groupCount; i++) {
      const group = this.groups[i];
      if (
        group.label === labelId &&
        group.argumentKind === 'none' &&
        group.rank === rank &&
        group.bountiful === bountiful &&
        group.direction === hit.direction &&
        group.distance === hit.distance
      ) {
        if (!group.singleText) {
          const label = this.labelText(labelId, 'none', '', rank, bountiful);
          group.singleText = this.locatedText(label, hit.direction, hit.distance);
        }
        return group.singleText;
      }
    }
    const label = this.labelText(labelId, 'none', '', rank, bountiful);
    return this.locatedText(label, hit.direction, hit.distance);
  }
}

// Host-free world-map marker hit-testing adapter. Projection geometry, accepted-hit
// slots, and quest-objective refs are caller-owned reusable state; semantic copy
// comes from the accessibility core so pointer, touch, and screen-reader text agree.

import type { QuestObjectiveRef } from '../sim/quest_targets';
import { esc } from './esc';
import type { MapSemanticAccessibilityCore } from './map_semantic_accessibility_core';
import {
  MAP_NPC_GLYPH_HIT_RADIUS,
  MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX,
  type MapGatherNodeMarker,
  type MapNavigationMarker,
  type MapNpcMarker,
  type MapPointMarkerHit,
  type MapQuestAreaMarker,
  type MapServiceMarker,
  type MapStationMarker,
  mapPointMarkerHitsInto,
  questAreaObjectivesAtInto,
} from './map_window_view';

export interface MapMarkerTooltipResolvers {
  npc(marker: MapNpcMarker): string;
  navigation(marker: MapNavigationMarker): string;
  station(marker: MapStationMarker): string;
  service(marker: MapServiceMarker): string;
  gather(marker: MapGatherNodeMarker): string;
  questArea(refs: readonly QuestObjectiveRef[], activeCount: number): string;
  paint(html: string, clientX: number, clientY: number): void;
}

export interface MapMarkerTooltipGeometry {
  ready: boolean;
  clientLeft: number;
  clientTop: number;
  backingPerClientX: number;
  backingPerClientY: number;
  backingPerCssPx: number;
}

export function showMapMarkerTooltipAt(
  geometry: MapMarkerTooltipGeometry,
  clientX: number,
  clientY: number,
  touchTarget: boolean,
  questAreas: readonly MapQuestAreaMarker[],
  npcs: readonly MapNpcMarker[],
  gatherNodes: readonly MapGatherNodeMarker[],
  stations: readonly MapStationMarker[],
  services: readonly MapServiceMarker[],
  navigation: readonly MapNavigationMarker[],
  pointHits: MapPointMarkerHit[],
  questObjectives: QuestObjectiveRef[],
  semantics: MapSemanticAccessibilityCore,
  resolvers: MapMarkerTooltipResolvers,
): boolean {
  if (
    questAreas.length === 0 &&
    npcs.length === 0 &&
    gatherNodes.length === 0 &&
    stations.length === 0 &&
    services.length === 0 &&
    navigation.length === 0 &&
    semantics.instanceMarkers.length === 0
  )
    return false;
  if (!geometry.ready) return false;
  const cx = (clientX - geometry.clientLeft) * geometry.backingPerClientX;
  const cy = (clientY - geometry.clientTop) * geometry.backingPerClientY;
  const radius = touchTarget
    ? MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX * geometry.backingPerCssPx
    : MAP_NPC_GLYPH_HIT_RADIUS;
  const semanticText = semantics.tooltipAt(cx, cy, radius);
  let html = semanticText ? `<div class="tt-title">${esc(semanticText)}</div>` : '';
  const pointHitCount = html
    ? 0
    : mapPointMarkerHitsInto(
        npcs,
        navigation,
        services,
        stations,
        gatherNodes,
        cx,
        cy,
        radius,
        pointHits,
      );
  for (let i = 0; i < pointHitCount; i++) {
    const hit = pointHits[i];
    if (hit.kind === 'npc') html = resolvers.npc(hit.marker);
    else if (hit.kind === 'navigation') html = resolvers.navigation(hit.marker);
    else if (hit.kind === 'station') html = resolvers.station(hit.marker);
    else if (hit.kind === 'service') html = resolvers.service(hit.marker);
    else html = resolvers.gather(hit.marker);
    if (html) break;
  }
  if (!html && questAreas.length > 0) {
    const objectiveCount = questAreaObjectivesAtInto(questAreas, cx, cy, questObjectives);
    if (objectiveCount > 0) html = resolvers.questArea(questObjectives, objectiveCount);
  }
  if (!html) return false;
  resolvers.paint(html, clientX, clientY);
  return true;
}

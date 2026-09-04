// Zone and instance-map marker interaction state extracted from Hud. The
// controller owns reusable hit-test pools, painted marker references, semantic
// prose, and stable resolver callbacks. Hud supplies only content-specific HTML
// and the final tooltip paint callback.

import type { QuestObjectiveRef } from '../../../sim/quest_targets';
import {
  type MapMarkerTooltipGeometry,
  type MapMarkerTooltipResolvers,
  showMapMarkerTooltipAt,
} from '../../map_marker_tooltip_adapter';
import {
  MapSemanticAccessibilityCore,
  type MapSemanticNameResolvers,
  type OverworldSemanticMapModel,
} from '../../map_semantic_accessibility_core';
import type {
  MapGatherNodeMarker,
  MapNavigationMarker,
  MapNpcMarker,
  MapPointMarkerHit,
  MapQuestAreaMarker,
  MapServiceMarker,
  MapStationMarker,
  MapWorldBossMarker,
  MapWorldQuestMarker,
} from '../../map_window_view';
import {
  MAP_NPC_GLYPH_HIT_RADIUS,
  MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX,
  worldBossMarkerAt,
  worldQuestMarkerAt,
} from '../../map_window_view';

export interface MapMarkerInteractionDeps {
  names: MapSemanticNameResolvers;
  npc(marker: MapNpcMarker): string;
  navigation(marker: MapNavigationMarker): string;
  station(marker: MapStationMarker): string;
  service(marker: MapServiceMarker): string;
  gather(marker: MapGatherNodeMarker): string;
  worldQuest(marker: MapWorldQuestMarker): string;
  worldBoss(marker: MapWorldBossMarker): string;
  questArea(refs: readonly QuestObjectiveRef[], activeCount: number): string;
  paint(html: string, clientX: number, clientY: number): void;
  clearMemo(): void;
}

const EMPTY_MARKERS = Object.freeze([]) as readonly never[];

export class MapMarkerInteractionController {
  questAreas: readonly MapQuestAreaMarker[] = EMPTY_MARKERS;
  worldQuests: readonly MapWorldQuestMarker[] = EMPTY_MARKERS;
  worldBosses: readonly MapWorldBossMarker[] = EMPTY_MARKERS;
  npcs: readonly MapNpcMarker[] = EMPTY_MARKERS;
  gatherNodes: readonly MapGatherNodeMarker[] = EMPTY_MARKERS;
  stations: readonly MapStationMarker[] = EMPTY_MARKERS;
  services: readonly MapServiceMarker[] = EMPTY_MARKERS;
  navigation: readonly MapNavigationMarker[] = EMPTY_MARKERS;
  readonly semantics: MapSemanticAccessibilityCore;
  readonly pointHits: MapPointMarkerHit[] = [];
  readonly questObjectives: QuestObjectiveRef[] = [];
  selectedWorldQuestId: string | null = null;
  private readonly geometry: MapMarkerTooltipGeometry = {
    ready: false,
    clientLeft: 0,
    clientTop: 0,
    backingPerClientX: 0,
    backingPerClientY: 0,
    backingPerCssPx: 0,
  };
  private geometryCanvas: HTMLCanvasElement | null = null;
  private readonly tooltipResolvers: MapMarkerTooltipResolvers;
  private readonly clearMemo: () => void;

  constructor(deps: MapMarkerInteractionDeps) {
    this.semantics = new MapSemanticAccessibilityCore(deps.names);
    this.clearMemo = deps.clearMemo;
    this.tooltipResolvers = {
      npc: deps.npc,
      navigation: deps.navigation,
      station: deps.station,
      service: deps.service,
      gather: deps.gather,
      worldQuest: deps.worldQuest,
      worldBoss: deps.worldBoss,
      questArea: deps.questArea,
      paint: deps.paint,
    };
  }

  refreshGeometry(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.geometry.ready = rect.width > 0 && rect.height > 0;
    this.geometry.clientLeft = rect.left;
    this.geometry.clientTop = rect.top;
    this.geometry.backingPerClientX = canvas.width / Math.max(1, rect.width);
    this.geometry.backingPerClientY = canvas.height / Math.max(1, rect.height);
    this.geometry.backingPerCssPx = Math.max(
      this.geometry.backingPerClientX,
      this.geometry.backingPerClientY,
    );
    this.geometryCanvas = canvas;
  }

  refreshCurrentGeometry(): void {
    if (!this.geometryCanvas) return;
    this.refreshGeometry(this.geometryCanvas);
  }

  showAt(canvas: HTMLCanvasElement, clientX: number, clientY: number, touch = false): boolean {
    if (canvas !== this.geometryCanvas) return false;
    return showMapMarkerTooltipAt(
      this.geometry,
      clientX,
      clientY,
      touch,
      this.questAreas,
      this.worldQuests,
      this.worldBosses,
      this.npcs,
      this.gatherNodes,
      this.stations,
      this.services,
      this.navigation,
      this.pointHits,
      this.questObjectives,
      this.semantics,
      this.tooltipResolvers,
    );
  }

  selectWorldQuest(questId: string | null): boolean {
    if (questId === this.selectedWorldQuestId) return false;
    this.selectedWorldQuestId = questId;
    return true;
  }

  selectWorldQuestAt(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
    touch = false,
  ): boolean {
    if (canvas !== this.geometryCanvas || !this.geometry.ready) return false;
    const mx = (clientX - this.geometry.clientLeft) * this.geometry.backingPerClientX;
    const my = (clientY - this.geometry.clientTop) * this.geometry.backingPerClientY;
    const radius = touch
      ? MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX * this.geometry.backingPerCssPx
      : MAP_NPC_GLYPH_HIT_RADIUS;
    if (worldBossMarkerAt(this.worldBosses, mx, my, radius)) {
      return this.selectWorldQuest(null);
    }
    const marker = worldQuestMarkerAt(this.worldQuests, mx, my, radius);
    return this.selectWorldQuest(marker?.questId ?? null);
  }

  clear(): void {
    this.questAreas = EMPTY_MARKERS;
    this.worldQuests = EMPTY_MARKERS;
    this.worldBosses = EMPTY_MARKERS;
    this.npcs = EMPTY_MARKERS;
    this.gatherNodes = EMPTY_MARKERS;
    this.stations = EMPTY_MARKERS;
    this.services = EMPTY_MARKERS;
    this.navigation = EMPTY_MARKERS;
    this.selectedWorldQuestId = null;
    this.semantics.clear();
    this.pointHits.length = 0;
    this.clearMemo();
  }

  setOverworld(model: OverworldSemanticMapModel): void {
    this.questAreas = model.questAreas;
    this.worldQuests = model.worldQuests ?? EMPTY_MARKERS;
    this.worldBosses = model.worldBosses ?? EMPTY_MARKERS;
    this.npcs = model.npcs;
    this.gatherNodes = model.gatherNodes;
    this.stations = model.stations;
    this.services = model.services;
    this.navigation = model.navigation;
    if (
      this.selectedWorldQuestId &&
      !this.worldQuests.some((marker) => marker.questId === this.selectedWorldQuestId)
    ) {
      this.selectedWorldQuestId = null;
    }
    this.clearMemo();
  }
}

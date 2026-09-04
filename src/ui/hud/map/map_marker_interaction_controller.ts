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
  MapFarmPatchMarker,
  MapGatherNodeMarker,
  MapNavigationMarker,
  MapNpcMarker,
  MapPointMarkerHit,
  MapQuestAreaMarker,
  MapServiceMarker,
  MapStationMarker,
} from '../../map_window_view';

export interface MapMarkerInteractionDeps {
  names: MapSemanticNameResolvers;
  npc(marker: MapNpcMarker): string;
  navigation(marker: MapNavigationMarker): string;
  station(marker: MapStationMarker): string;
  service(marker: MapServiceMarker): string;
  gather(marker: MapGatherNodeMarker): string;
  farm(marker: MapFarmPatchMarker): string;
  questArea(refs: readonly QuestObjectiveRef[], activeCount: number): string;
  paint(html: string, clientX: number, clientY: number): void;
  clearMemo(): void;
}

const EMPTY_MARKERS = Object.freeze([]) as readonly never[];

export class MapMarkerInteractionController {
  questAreas: readonly MapQuestAreaMarker[] = EMPTY_MARKERS;
  npcs: readonly MapNpcMarker[] = EMPTY_MARKERS;
  gatherNodes: readonly MapGatherNodeMarker[] = EMPTY_MARKERS;
  stations: readonly MapStationMarker[] = EMPTY_MARKERS;
  services: readonly MapServiceMarker[] = EMPTY_MARKERS;
  farmPatches: readonly MapFarmPatchMarker[] = EMPTY_MARKERS;
  navigation: readonly MapNavigationMarker[] = EMPTY_MARKERS;
  readonly semantics: MapSemanticAccessibilityCore;
  readonly pointHits: MapPointMarkerHit[] = [];
  readonly questObjectives: QuestObjectiveRef[] = [];
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
      farm: deps.farm,
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
      this.npcs,
      this.gatherNodes,
      this.stations,
      this.services,
      this.navigation,
      this.farmPatches,
      this.pointHits,
      this.questObjectives,
      this.semantics,
      this.tooltipResolvers,
    );
  }

  clear(): void {
    this.questAreas = EMPTY_MARKERS;
    this.npcs = EMPTY_MARKERS;
    this.gatherNodes = EMPTY_MARKERS;
    this.stations = EMPTY_MARKERS;
    this.services = EMPTY_MARKERS;
    this.farmPatches = EMPTY_MARKERS;
    this.navigation = EMPTY_MARKERS;
    this.semantics.clear();
    this.pointHits.length = 0;
    this.clearMemo();
  }

  setOverworld(model: OverworldSemanticMapModel): void {
    this.questAreas = model.questAreas;
    this.npcs = model.npcs;
    this.gatherNodes = model.gatherNodes;
    this.stations = model.stations;
    this.services = model.services;
    this.farmPatches = model.farmPatches;
    this.navigation = model.navigation;
    this.clearMemo();
  }
}

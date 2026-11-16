// The world-map canvas's level-aware click, right-click and continent hover
// handlers, extracted from Hud's map binding (the monolith ratchet). The
// per-zone pan/zoom/marker-tooltip handlers stay in Hud; these are the ones that
// branch on the map level.
//
// - Right-click only ever zooms OUT one level (instance plan -> zone map ->
//   world map, map_surface_core.mapLevelUp); on the world map it does nothing.
// - On the world map, a mouse click on a world-quest emblem opens that quest's
//   zone with the quest selected; a click on a region opens that zone. Touch
//   keeps tap-for-tooltip on markers, so the reward card can be read first.
// - On the zone map, a click selects the world-quest emblem under it.
// - A mouse hover on the world map highlights the zone under the cursor and
//   shows its name + level band, or a dungeon gate's name when one is under it,
//   unless a marker tooltip (port, world quest) claimed the point first. A tap
//   on a gate shows its name the same way.

import type { IWorld } from '../../../world_api';
import type { ContinentMapPainter } from '../../continent_map_painter';
import { type ContinentZoneRegion, continentZoneAt } from '../../continent_map_view';
import {
  type MapLevel,
  mapLevelUp,
  remoteInstanceAnchor,
  resolveMapSurface,
} from '../../map_surface_core';
import { mapWindowMode } from '../../map_window_view';
import type { MapMarkerInteractionController } from './map_marker_interaction_controller';
import type { MapMarkerTooltipContent } from './map_marker_tooltip_content';

export interface ContinentMapInputDeps {
  readonly canvas: HTMLCanvasElement;
  /** Hud's marker hit-test state (the world-quest emblems on either level). */
  readonly markers: Pick<MapMarkerInteractionController, 'worldQuestAt' | 'selectWorldQuestAt'>;
  readonly tooltips: Pick<MapMarkerTooltipContent, 'continentZone' | 'continentDungeon'>;
  /** The continent painter, for the dungeon gates it last drew. */
  readonly continent: Pick<ContinentMapPainter, 'dungeonAt'>;
  world(): IWorld;
  level(): MapLevel;
  setLevel(level: MapLevel): void;
  isMobileLayout(): boolean;
  regions(): readonly ContinentZoneRegion[];
  hoverZone(): string | null;
  setHoverZone(zoneId: string | null): void;
  /** Redraw the open map window. */
  repaint(): void;
  /** Paint the marker tooltip under a client point; true when one was shown. */
  showMarkerTip(clientX: number, clientY: number, touch?: boolean): boolean;
  hideMarkerTip(): void;
  paintTooltip(html: string, clientX: number, clientY: number): void;
  hideTooltip(): void;
  openZone(zoneId: string): void;
  focusWorldQuest(questId: string): void;
}

export function bindContinentMapInput(deps: ContinentMapInputDeps): void {
  const { canvas } = deps;
  const canvasPoint = (clientX: number, clientY: number): { cx: number; cy: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      cx: ((clientX - rect.left) * canvas.width) / rect.width,
      cy: ((clientY - rect.top) * canvas.height) / rect.height,
    };
  };
  const gateTip = (cx: number, cy: number, touch: boolean): string | null => {
    const id = deps.continent.dungeonAt(cx, cy, touch);
    return id ? deps.tooltips.continentDungeon(id) : null;
  };
  let zoneTipShown = false;
  const hideZoneTip = (): void => {
    if (!zoneTipShown) return;
    zoneTipShown = false;
    deps.hideTooltip();
  };

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault(); // suppress the browser menu
    const world = deps.world();
    const surface = resolveMapSurface(
      mapWindowMode(world),
      deps.level(),
      remoteInstanceAnchor(world) !== null,
    );
    const next = mapLevelUp(surface);
    if (next) deps.setLevel(next);
  });

  canvas.addEventListener('click', (ev) => {
    const level = deps.level();
    if (level === 'zone') {
      if (deps.markers.selectWorldQuestAt(canvas, ev.clientX, ev.clientY)) deps.repaint();
      return;
    }
    if (level !== 'continent') return;
    const mobile = deps.isMobileLayout();
    if (!mobile) {
      const quest = deps.markers.worldQuestAt(canvas, ev.clientX, ev.clientY);
      if (quest) {
        hideZoneTip();
        deps.focusWorldQuest(quest.questId);
        return;
      }
    }
    if (deps.showMarkerTip(ev.clientX, ev.clientY, mobile)) return;
    const { cx, cy } = canvasPoint(ev.clientX, ev.clientY);
    const gate = mobile ? gateTip(cx, cy, true) : null;
    if (gate) {
      deps.paintTooltip(gate, ev.clientX, ev.clientY);
      zoneTipShown = true;
      return;
    }
    const zoneId = continentZoneAt(deps.regions(), cx, cy);
    if (zoneId) {
      hideZoneTip();
      deps.openZone(zoneId);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (deps.level() !== 'continent' || ev.pointerType !== 'mouse') return;
    if (deps.showMarkerTip(ev.clientX, ev.clientY)) return;
    deps.hideMarkerTip();
    const { cx, cy } = canvasPoint(ev.clientX, ev.clientY);
    const zoneId = continentZoneAt(deps.regions(), cx, cy);
    if (zoneId !== deps.hoverZone()) {
      deps.setHoverZone(zoneId); // repaint the highlight (+ cursor)
      deps.repaint();
    }
    const gate = gateTip(cx, cy, false);
    if (gate || zoneId) {
      const html = gate ?? deps.tooltips.continentZone(zoneId ?? '', deps.regions());
      deps.paintTooltip(html, ev.clientX, ev.clientY);
      zoneTipShown = true;
    } else {
      hideZoneTip();
    }
  });

  canvas.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    hideZoneTip();
    if (deps.level() !== 'continent' || deps.hoverZone() === null) return;
    deps.setHoverZone(null);
    deps.repaint();
  });
}

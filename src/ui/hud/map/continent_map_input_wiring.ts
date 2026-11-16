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
//   shows its name + level band, unless a marker tooltip (port, world quest)
//   claimed the point first.

import { type ContinentZoneRegion, continentZoneAt } from '../../continent_map_view';
import type { MapLevel } from '../../map_surface_core';

export interface ContinentMapInputDeps {
  readonly canvas: HTMLCanvasElement;
  level(): MapLevel;
  isMobileLayout(): boolean;
  regions(): readonly ContinentZoneRegion[];
  hoverZone(): string | null;
  /** Store the hovered zone and repaint the open map. */
  setHoverZone(zoneId: string | null): void;
  /** Paint the marker tooltip under a client point; true when one was shown. */
  showMarkerTip(clientX: number, clientY: number, touch?: boolean): boolean;
  hideMarkerTip(): void;
  worldQuestAt(clientX: number, clientY: number): { questId: string } | null;
  /** Zone level: select the world quest under the point (and repaint on change). */
  selectWorldQuestAt(clientX: number, clientY: number): void;
  zoneTooltip(zoneId: string): string;
  paintTooltip(html: string, clientX: number, clientY: number): void;
  hideTooltip(): void;
  levelUp(): void;
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
  let zoneTipShown = false;
  const hideZoneTip = (): void => {
    if (!zoneTipShown) return;
    zoneTipShown = false;
    deps.hideTooltip();
  };

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault(); // suppress the browser menu
    deps.levelUp();
  });

  canvas.addEventListener('click', (ev) => {
    const level = deps.level();
    if (level === 'zone') {
      deps.selectWorldQuestAt(ev.clientX, ev.clientY);
      return;
    }
    if (level !== 'continent') return;
    const mobile = deps.isMobileLayout();
    if (!mobile) {
      const quest = deps.worldQuestAt(ev.clientX, ev.clientY);
      if (quest) {
        hideZoneTip();
        deps.focusWorldQuest(quest.questId);
        return;
      }
    }
    if (deps.showMarkerTip(ev.clientX, ev.clientY, mobile)) return;
    const { cx, cy } = canvasPoint(ev.clientX, ev.clientY);
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
    if (zoneId !== deps.hoverZone()) deps.setHoverZone(zoneId);
    if (zoneId) {
      deps.paintTooltip(deps.zoneTooltip(zoneId), ev.clientX, ev.clientY);
      zoneTipShown = true;
    } else {
      hideZoneTip();
    }
  });

  canvas.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    hideZoneTip();
    if (deps.level() === 'continent' && deps.hoverZone() !== null) deps.setHoverZone(null);
  });
}

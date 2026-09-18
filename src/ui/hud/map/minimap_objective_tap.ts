// The minimap emblem's objective tap. A touch-safe activation keeps the emblem
// usable while another thumb is steering: a tap on a world-quest or world-boss
// marker opens the world map on that zone with the quest selected, any other tap
// toggles the map. Projection and layout are read only on activation, never in
// the painter. Hud members are private, so the binder takes the Hud untyped; the
// members it reads are welded to hud.ts in tests/minimap_objective_tap.test.ts.
import type { IWorld } from '../../../world_api';
import { MAP_OPEN_ZOOM } from '../../map_window_view';
import { minimapMode } from '../../minimap_markers';
import type { MinimapPainter } from '../../minimap_painter';
import { bindTouchTap } from '../../touch_tap';

/** The CSS-pixel hit radius: 20 meets the 40x40 touch-target floor. */
export const MINIMAP_OBJECTIVE_TAP_RADIUS_PX = 20;

/** A client-space tap mapped into the scaled canvas, with the hit radius in canvas
 *  pixels; null while the canvas has no layout box. */
export function minimapTapProbe(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): { x: number; y: number; radius: number } | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height,
    radius:
      MINIMAP_OBJECTIVE_TAP_RADIUS_PX *
      Math.max(canvas.width / rect.width, canvas.height / rect.height),
  };
}

/** The private Hud members the tap reads and writes. */
interface MinimapTapHost {
  sim: IWorld;
  minimapPainter: Pick<MinimapPainter, 'worldObjectiveAt'>;
  mapLevel: string;
  mapZoneOverride: string | null;
  mapZoom: number;
  mapCenter: { x: number; z: number } | null;
  mapPing: { x: number; z: number } | null;
  mapMarkerInteraction: { selectWorldQuest(questId: string | null): boolean };
  toggleMap(): void;
  updateMapWindow(): void;
}

export function bindMinimapObjectiveTap(mm: HTMLCanvasElement, hud: object): void {
  const h = hud as MinimapTapHost;
  bindTouchTap(mm, (event) => {
    const ev = event as MouseEvent | PointerEvent;
    const rect = mm.getBoundingClientRect();
    const probe =
      minimapMode(h.sim) === 'overworld' ? minimapTapProbe(ev.clientX, ev.clientY, rect, mm) : null;
    const marker = probe ? h.minimapPainter.worldObjectiveAt(probe.x, probe.y, probe.radius) : null;
    if (!marker) {
      h.toggleMap();
      return;
    }
    const mapWindow = document.querySelector('#map-window') as HTMLElement;
    if (mapWindow.style.display !== 'block') h.toggleMap();
    h.mapLevel = 'zone';
    h.mapZoneOverride = marker.zoneId;
    h.mapZoom = MAP_OPEN_ZOOM;
    h.mapCenter = null;
    h.mapPing = null;
    h.mapMarkerInteraction.selectWorldQuest(marker.kind === 'world-quest' ? marker.questId : null);
    h.updateMapWindow();
  });
}

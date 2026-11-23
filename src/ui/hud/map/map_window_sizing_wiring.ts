// Hud's one-call wiring for the world map window's two size controls: the
// canvas that follows a player-resized window (map_canvas_size_controller.ts)
// and the divider that widens the atlas rail (map_rail_resize_controller.ts).
// Kept out of hud.ts (a monolith under the line ratchet) and out of the two
// controllers, which stay free of the UI-scale and settings reads wired here.
import { getUiScale } from '../../ui_scale';
import { installMapCanvasSize } from './map_canvas_size_controller';
import { MapRailResizeController } from './map_rail_resize_controller';

/** The slice of Hud's options hooks this wiring reads (domain modules never
 *  import Hud, so the port is declared here and Hud's hooks satisfy it). */
export interface MapRailSettingsHooks {
  settings: {
    get(key: 'mapAtlasRailWidth'): number;
    set(key: 'mapAtlasRailWidth', value: number): void;
  };
}

export function installMapWindowSizing(
  canvas: HTMLCanvasElement,
  repaint: () => void,
  hooks: () => MapRailSettingsHooks | null,
): void {
  installMapCanvasSize(canvas, repaint);
  const win = canvas.closest<HTMLElement>('#map-window');
  const divider = win?.querySelector<HTMLElement>('.map-atlas-splitter');
  if (!win || !divider) return;
  const rail = new MapRailResizeController({
    win,
    divider,
    settings: {
      get: () => hooks()?.settings.get('mapAtlasRailWidth') ?? null,
      set: (width) => hooks()?.settings.set('mapAtlasRailWidth', width),
    },
    getScale: getUiScale,
  });
  rail.install();
  // The stored width is only readable once Hud.attachOptions runs, after this
  // install. The window's own box changes when it opens, so re-read then; a
  // matching width writes nothing, so the rail's own width change cannot loop.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => rail.sync()).observe(win);
}

// The world-quest board opener (src/ui/hud/quest/quest_dialog_controller.ts
// routes the taskmaster's "open the board" line here): open the map when it is
// closed and unfold the atlas rail if the player had folded it, so the board's
// world-quest section is on screen. The fold itself is the release's
// mapAtlasSidebarCollapsed preference (src/ui/map_sidebar_controller.ts, the
// toggle inside the rail); this module never owns a button of its own.
import type { MapSidebarSettingsPort } from '../../map_sidebar_controller';

export interface MapSidebarCollapseDeps {
  /** The release's collapse preference port (trackerCollapseSettings). */
  settings: MapSidebarSettingsPort;
  /** Whether the map window is open right now. */
  mapOpen: () => boolean;
  /** Open the map window when it is closed (the openBoard route). */
  openMap: () => void;
  /** Repaint the map after the rail changes width. */
  onChange: () => void;
}

export class MapSidebarCollapse {
  constructor(private readonly deps: MapSidebarCollapseDeps) {}

  collapsed(): boolean {
    return this.deps.settings.available() && this.deps.settings.collapsed();
  }

  /** Unfold the rail when the player had folded it; a no-op otherwise. */
  expand(): void {
    if (!this.collapsed()) return;
    this.deps.settings.setCollapsed(false);
    this.deps.onChange();
  }

  openBoard(): void {
    if (!this.deps.mapOpen()) this.deps.openMap();
    this.expand();
  }
}

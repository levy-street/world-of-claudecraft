// The atlas rail's fold, beyond its own toggle. The fold itself is the
// release's mapAtlasSidebarCollapsed preference (src/ui/map_sidebar_controller.ts,
// the toggle inside the rail); this module never owns a button of its own.
//
// Menu consolidation step 8: on the touch HUD the rail starts folded every time
// the map opens, because on a phone the map is the thing; the player can still
// unfold it. (The old world-quest board opener that unfolded the rail is gone:
// the board lives in the Rewards hub now.)
import type { MapSidebarSettingsPort } from '../../map_sidebar_controller';

export interface MapSidebarCollapseDeps {
  /** The release's collapse preference port (trackerCollapseSettings). */
  settings: MapSidebarSettingsPort;
}

export class MapSidebarCollapse {
  constructor(private readonly deps: MapSidebarCollapseDeps) {}

  collapsed(): boolean {
    return this.deps.settings.available() && this.deps.settings.collapsed();
  }

  /** The map just opened: fold the rail on the touch HUD, leave it otherwise. */
  foldOnOpen(touch: boolean): void {
    if (!touch || !this.deps.settings.available() || this.deps.settings.collapsed()) return;
    this.deps.settings.setCollapsed(true);
  }
}

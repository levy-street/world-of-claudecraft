// The map atlas rail's Side panel toggle: folds the rail (tracked quests, the
// world-quest board, the layer filters) away so the map takes the whole window,
// and remembers the choice in the mapSidebarCollapsed preference. The window
// carries one class (MAP_SIDEBAR_COLLAPSED_CLASS) that the stylesheet turns
// into the single-pane shape; the button's aria-pressed reads "panel shown".
//
// openBoard is the World Quest taskmaster's dialog route: it opens the map when
// it is closed and always unfolds the rail, since the board lives there.
import type { Settings } from '../../../game/settings';

export const MAP_SIDEBAR_COLLAPSED_CLASS = 'map-sidebar-collapsed';

export interface MapSidebarCollapseDeps {
  window: HTMLElement;
  button: HTMLButtonElement;
  /** The persisted preference store; null until the options hooks are wired. */
  settings: () => Pick<Settings, 'get' | 'set'> | null;
  /** Repaint the map after the stage changes width. */
  onChange: () => void;
  /** Open the map window when it is closed (the openBoard route). */
  openMap: () => void;
}

export class MapSidebarCollapse {
  constructor(private readonly deps: MapSidebarCollapseDeps) {
    deps.button.addEventListener('click', () => this.toggle());
    this.sync();
  }

  collapsed(): boolean {
    return (this.deps.settings()?.get('mapSidebarCollapsed') ?? false) === true;
  }

  /** Apply the persisted preference to the window and the button. */
  sync(): void {
    const collapsed = this.collapsed();
    this.deps.window.classList.toggle(MAP_SIDEBAR_COLLAPSED_CLASS, collapsed);
    this.deps.button.setAttribute('aria-pressed', String(!collapsed));
  }

  toggle(): void {
    this.set(!this.collapsed());
  }

  expand(): void {
    if (this.collapsed()) this.set(false);
  }

  openBoard(): void {
    if (this.deps.window.style.display !== 'block') this.deps.openMap();
    this.expand();
  }

  private set(collapsed: boolean): void {
    this.deps.settings()?.set('mapSidebarCollapsed', collapsed);
    this.sync();
    this.deps.onChange();
  }
}

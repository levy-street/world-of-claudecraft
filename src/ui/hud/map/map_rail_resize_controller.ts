// The divider between the world map's atlas rail and the map: drag it, or use
// its keys, to make the rail wider so long quest titles and the world-quest
// board stop truncating. The width lives in the --map-rail-width custom
// property on #map-window, which the map block in src/styles/components.css
// reads for the rail width, the stage inset, the divider position, and the
// window width (an unsized window grows with the rail, so the map keeps its
// size; a player-sized window keeps its width and the map yields instead).
// The choice persists through the injected settings port. Width rules are
// map_rail_width_core.ts.
//
// Event-driven chrome, like window_resize.ts: listeners on the divider only,
// pointer capture for the drag, no layout reads (the drag works from the
// pointer delta and the width it already knows).
import {
  clampMapRailWidth,
  MAP_RAIL_DEFAULT_WIDTH,
  MAP_RAIL_MAX_WIDTH,
  MAP_RAIL_MIN_WIDTH,
  mapRailWidthAfterDrag,
  mapRailWidthAfterKey,
} from './map_rail_width_core';

export interface MapRailWidthSettingsPort {
  /** The stored width, or null before the settings are available. */
  get(): number | null;
  set(width: number): void;
}

export interface MapRailResizeDeps {
  win: HTMLElement;
  divider: HTMLElement;
  settings: MapRailWidthSettingsPort;
  /** Live UI zoom factor (pointer deltas are zoomed, the width is not). */
  getScale(): number;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export class MapRailResizeController {
  private width = MAP_RAIL_DEFAULT_WIDTH;
  private drag: DragSession | null = null;
  private readonly listeners: Array<[string, (ev: Event) => void]> = [];

  constructor(private readonly deps: MapRailResizeDeps) {}

  install(): void {
    const { divider } = this.deps;
    divider.setAttribute('aria-valuemin', String(MAP_RAIL_MIN_WIDTH));
    divider.setAttribute('aria-valuemax', String(MAP_RAIL_MAX_WIDTH));
    this.apply(clampMapRailWidth(this.deps.settings.get() ?? MAP_RAIL_DEFAULT_WIDTH));
    this.listen('pointerdown', (ev) => this.onPointerDown(ev as PointerEvent));
    this.listen('pointermove', (ev) => this.onPointerMove(ev as PointerEvent));
    this.listen('pointerup', (ev) => this.onPointerEnd(ev as PointerEvent));
    this.listen('pointercancel', (ev) => this.onPointerEnd(ev as PointerEvent));
    this.listen('keydown', (ev) => this.onKeyDown(ev as KeyboardEvent));
    this.listen('dblclick', () => this.commit(MAP_RAIL_DEFAULT_WIDTH));
  }

  /**
   * Re-read the stored width (settings arrive after the HUD is built, so the
   * install-time read can miss them). Writes nothing when it already matches.
   */
  sync(): void {
    if (this.drag) return;
    const stored = clampMapRailWidth(this.deps.settings.get() ?? this.width);
    if (stored !== this.width) this.apply(stored);
  }

  currentWidth(): number {
    return this.width;
  }

  dispose(): void {
    for (const [type, fn] of this.listeners) this.deps.divider.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.endDrag();
  }

  private listen(type: string, fn: (ev: Event) => void): void {
    this.deps.divider.addEventListener(type, fn);
    this.listeners.push([type, fn]);
  }

  private apply(width: number): void {
    this.width = width;
    this.deps.win.style.setProperty('--map-rail-width', `${width}px`);
    this.deps.divider.setAttribute('aria-valuenow', String(width));
  }

  private commit(width: number): void {
    this.apply(width);
    this.deps.settings.set(width);
  }

  private onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 || this.drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.drag = { pointerId: ev.pointerId, startX: ev.clientX, startWidth: this.width };
    this.deps.divider.classList.add('is-dragging');
    try {
      this.deps.divider.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic/legacy pointer without active capture */
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    this.apply(
      mapRailWidthAfterDrag(drag.startWidth, ev.clientX - drag.startX, this.deps.getScale()),
    );
  }

  private onPointerEnd(ev: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== ev.pointerId) return;
    this.endDrag();
    this.deps.settings.set(this.width);
  }

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.deps.divider.classList.remove('is-dragging');
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const next = mapRailWidthAfterKey(this.width, ev.key, ev.shiftKey);
    if (next === null) return;
    ev.preventDefault();
    // The arrows and Home/End are movement and camera keys in the world, so a
    // press the divider used must not reach the game's key handling too.
    ev.stopPropagation();
    if (next !== this.width) this.commit(next);
  }
}

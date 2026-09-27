import { getUiScale } from './ui_scale';
import { rememberWindowPos } from './window_reflow';

type Centre = { x: number; y: number };
/** Keep the requested centre across navigation, clamping and reopening, and retain tab scroll. */
export class OptionsWindowLayout {
  private view: string | null = null;
  private centre: Centre | null = null;
  private placed: { left: number; top: number; width: number; height: number } | null = null;
  private readonly scroll = new Map<string, number>();
  begin(el: HTMLElement, view: string, tab = '', frame: string | null = null): Centre | null {
    const key = `${view}:${view === 'interface' ? tab : ''}:${frame ?? ''}`;
    const visible = el.style.display !== 'none';
    if (visible) {
      if (this.view) this.scroll.set(this.view, el.querySelector('.ui-win-body')?.scrollTop ?? 0);
      const box = el.getBoundingClientRect();
      // An external move (drag or viewport reflow) establishes a new requested centre.
      // Our own clamped placement must not accumulate drift on each Back/reopen.
      if (
        box.width &&
        box.height &&
        (!this.placed ||
          (['left', 'top', 'width', 'height'] as const).some(
            (key) => Math.abs(box[key] - this.placed![key]) > 1,
          ))
      ) {
        this.centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }
    }
    this.view = key;
    for (const [name, owner] of [
      ['kb-wide', 'keybinds'],
      ['gfx-wide', 'graphics'],
      ['perf-wide', 'performance'],
      ['aura-wide', 'auras'],
    ]) {
      if (view !== owner) el.classList.remove(name);
    }
    return this.centre;
  }
  finish(el: HTMLElement, centre: Centre | null): void {
    const body = el.querySelector('.ui-win-body');
    if (body) body.scrollTop = this.scroll.get(this.view ?? '') ?? 0;
    const doc = el.ownerDocument;
    const viewport = doc.defaultView;
    if (!viewport || doc.body.classList.contains('mobile-touch')) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.centre = centre ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const left = Math.max(
      0,
      Math.min(this.centre.x - box.width / 2, viewport.innerWidth - box.width),
    );
    const top = Math.max(
      0,
      Math.min(this.centre.y - box.height / 2, viewport.innerHeight - box.height),
    );
    const scale = getUiScale();
    el.style.left = `${left / scale}px`;
    el.style.top = `${top / scale}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
    this.placed = { left, top, width: box.width, height: box.height };
    // The shared window manager uses this stamp on reopen and viewport changes.
    rememberWindowPos(el, left, top);
    el.dataset.windowMoved = '1';
  }
}

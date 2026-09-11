// Paints the micro-menu rail's live state: the open-window ring on each launcher
// and the corner count badges. Every DOM mutation goes through the PainterHost
// write-elision facet, so a steady rail costs no DOM write at all; the badge span is
// the one node this painter creates, minted once per badged launcher on first paint.

import type { MicroMenuBadgeState, MicroMenuState } from './micro_menu_state_view';
import type { PainterHostWriters } from './painter_host';

/** The classes the badge span is minted with: the library primitive plus a hook the
 *  rail's own geometry rule reaches (the corner default overhangs a 34x30 button). */
export const MICRO_MENU_BADGE_CLASS = 'mm-badge ui-badge ui-badge--corner';

/** Window elements resolved by id, kept across paints. Same `isConnected`
 *  re-query contract as the launcher cache below, and for the same reason: a
 *  detached element is dropped and a miss is never cached, so a window minted
 *  late still lights its ring. Module scope rather than painter state because
 *  the predicate is a free function the pure view calls. */
const windowElements = new Map<string, HTMLElement>();

/**
 * Is the window with this element id currently open?
 *
 * Reads `data-window-open`, the marker Hud's window MutationObserver already keeps
 * on every `.window.panel` (it is set from the same isWindowVisible() decision that
 * drives every other open-state consumer, including the social window's class-driven
 * arm). An attribute read, so the rail's ring never forces a style recalc of its own,
 * and a cached element means a settled rail costs no id lookup either.
 */
export function microMenuWindowOpen(windowId: string): boolean {
  const cached = windowElements.get(windowId);
  if (cached?.isConnected) return cached.getAttribute('data-window-open') === '1';
  const el = document.getElementById(windowId);
  if (!el) {
    windowElements.delete(windowId);
    return false;
  }
  windowElements.set(windowId, el);
  return el.getAttribute('data-window-open') === '1';
}

export class MicroMenuStatePainter {
  private readonly launchers = new Map<string, HTMLElement>();
  private readonly badges = new Map<string, HTMLElement>();

  constructor(private readonly writers: PainterHostWriters) {}

  /** Resolve and cache a launcher. Nulls are NOT cached: a launcher can be absent
   *  from an entry document (or minted late), and re-querying a handful of ids is
   *  far cheaper than freezing the rail into a permanent no-op. */
  private launcher(selector: string): HTMLElement | null {
    const cached = this.launchers.get(selector);
    if (cached?.isConnected) return cached;
    const el = document.querySelector<HTMLElement>(selector);
    if (el) this.launchers.set(selector, el);
    return el;
  }

  /** The badge span for a launcher, minted on first paint. */
  private badge(selector: string, host: HTMLElement): HTMLElement {
    const cached = this.badges.get(selector);
    if (cached?.isConnected) return cached;
    const span = document.createElement('span');
    this.writers.setAttr(span, 'class', MICRO_MENU_BADGE_CLASS);
    // The count duplicates the launcher's own aria-label, which refreshKeybindLabels
    // owns; the badge itself is decoration for the screen reader.
    this.writers.setAttr(span, 'aria-hidden', 'true');
    host.appendChild(span);
    this.badges.set(selector, span);
    return span;
  }

  private paintBadge(badge: MicroMenuBadgeState): void {
    const host = this.launcher(badge.selector);
    if (!host) return;
    // ONE write per badge, and it must be the single-slot setText: the elision
    // cache holds one (kind, value) entry per element, so pairing setText with a
    // second single-slot writer here would make both of them write every tick.
    // Empty text is the hidden state (`.mm-badge:empty` is display:none).
    this.writers.setText(this.badge(badge.selector, host), badge.text);
  }

  paint(state: MicroMenuState): void {
    for (const launcher of state.launchers) {
      const el = this.launcher(launcher.selector);
      if (!el) continue;
      this.writers.toggleClass(el, 'is-on', launcher.on);
      this.writers.setAttr(el, 'aria-pressed', launcher.on ? 'true' : 'false');
    }
    for (const badge of state.badges) this.paintBadge(badge);
  }
}

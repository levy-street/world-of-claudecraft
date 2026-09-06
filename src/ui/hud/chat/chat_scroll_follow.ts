// Decides whether a chat / combat log pane should follow a newly appended line
// to the bottom. The old rule measured "near bottom" on every append, which
// broke as soon as a single message overflowed the pane while it was hidden
// (scrollTop stayed 0 with no way to catch up): a common case once Chat Text
// Size reaches 4K-readable sizes, where the login welcome alone is taller than
// the default frame. Instead, a pane FOLLOWS until the player scrolls away
// from the bottom, and follows again once they scroll back within a line or so.
// Host-agnostic (structural element interface) so a Vitest can pin it.

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface ScrollFollowTarget extends ScrollMetrics {
  addEventListener(type: 'scroll', listener: () => void): void;
}

/** Slack below which a pane still counts as sitting at the bottom. */
export const NEAR_BOTTOM_PX = 24;

export function isNearBottom(m: ScrollMetrics, threshold = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight < threshold;
}

export class ChatScrollFollow {
  private readonly pinned = new WeakMap<ScrollFollowTarget, boolean>();

  constructor(targets: readonly ScrollFollowTarget[] = []) {
    for (const el of targets) this.attach(el);
  }

  /** Track one pane: every scroll (player or programmatic) re-evaluates the pin. */
  attach(el: ScrollFollowTarget): void {
    this.pinned.set(el, true);
    el.addEventListener('scroll', () => this.pinned.set(el, isNearBottom(el)));
  }

  /**
   * Whether an append should scroll `el` to the bottom. Untracked panes and panes
   * the player has never scrolled away from follow; only a deliberate scroll up
   * (an event that left the pane more than NEAR_BOTTOM_PX above the bottom) parks it.
   */
  shouldFollow(el: ScrollFollowTarget): boolean {
    return this.pinned.get(el) ?? true;
  }
}

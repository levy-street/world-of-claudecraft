// Pure geometry for the auto-growing chat input. The chat bar is a textarea
// anchored by its BOTTOM edge (see #chat-input in index.html), so growing its
// height extends the box upward — away from the chat log beneath it. The DOM
// consumer (src/main.ts) measures the textarea's natural content height
// (scrollHeight) and feeds it here to get a clamped pixel height plus whether a
// scrollbar is needed once the content exceeds the cap. Kept host-agnostic so a
// Vitest unit test can pin the clamp behavior without a DOM.

export interface ChatInputSizeLimits {
  /** Minimum rendered height (a single line). */
  minHeight: number;
  /** Maximum rendered height before the textarea scrolls internally. */
  maxHeight: number;
}

export interface ChatInputSize {
  /** Pixel height to apply to the textarea. */
  height: number;
  /**
   * 'hidden' while the content fits within maxHeight (no scrollbar, clean
   * upward growth); 'auto' once it is capped so the overflow stays reachable.
   */
  overflowY: 'hidden' | 'auto';
}

// Clamp a measured content height to [minHeight, maxHeight]. When the content
// exceeds the cap we surface a scrollbar instead of growing without bound.
export function chatInputSize(scrollHeight: number, limits: ChatInputSizeLimits): ChatInputSize {
  const min = Math.max(0, limits.minHeight);
  const max = Math.max(min, limits.maxHeight);
  const natural = Math.round(Number.isFinite(scrollHeight) ? scrollHeight : min);
  const height = Math.min(max, Math.max(min, natural));
  // Compare the rounded measurement so a fractional scrollHeight that rounds
  // down to exactly `max` does not spuriously surface a scrollbar.
  return { height, overflowY: natural > max ? 'auto' : 'hidden' };
}

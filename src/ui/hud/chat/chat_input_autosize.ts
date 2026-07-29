// Pure geometry for the auto-growing chat input. The chat bar is a textarea
// anchored by its BOTTOM edge (see #chat-input in src/styles/hud.css), so growing
// its height extends the box upward, away from the chat log beneath it. The DOM
// consumer (src/main.ts) measures the textarea's natural content height
// (scrollHeight), the height its placeholder needs, and its border, then feeds
// them here to get a clamped pixel height plus whether a scrollbar is needed once
// the content exceeds the cap. Kept host-agnostic so a Vitest unit test can pin the
// clamp behavior without a DOM.

export interface ChatInputSizeLimits {
  /** Minimum rendered height (a single line). */
  minHeight: number;
  /** Maximum rendered height before the textarea scrolls internally. */
  maxHeight: number;
}

export interface ChatInputMeasurement {
  /**
   * scrollHeight of the typed value. A textarea's scrollHeight ignores the
   * placeholder, so an empty field measures as zero content here.
   */
  contentHeight: number;
  /**
   * Height the placeholder needs (the DOM consumer measures it by momentarily
   * mirroring the placeholder into the value). 0 when there is nothing to reserve
   * for. The box tracks the taller of this and contentHeight so an empty box still
   * shows a placeholder that wraps to more than one line without clipping it.
   */
  placeholderHeight: number;
  /**
   * Total vertical border (top + bottom). Under box-sizing: border-box a textarea's
   * scrollHeight excludes the border, so without adding it back the applied height
   * is short by the border and the last line clips at the bottom edge.
   */
  borderY: number;
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

// The structural slice of an HTMLTextAreaElement the autosize routine touches,
// so Vitest can drive it with a hand-rolled fake and the module stays
// DOM-import-free.
export interface AutosizeTextarea {
  value: string;
  placeholder: string;
  readonly scrollHeight: number;
  style: { height: string; overflowY: string };
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

// Clamp a measured content height to [minHeight, maxHeight]. Tracks whichever of the
// typed content or the placeholder is taller (an empty box must still fit its
// placeholder), adds the border-box compensation, and surfaces a scrollbar instead of
// growing without bound once the content exceeds the cap.
export function chatInputSize(
  measurement: ChatInputMeasurement,
  limits: ChatInputSizeLimits,
): ChatInputSize {
  const min = Math.max(0, limits.minHeight);
  const max = Math.max(min, limits.maxHeight);
  const content = Math.max(
    finite(measurement.contentHeight),
    finite(measurement.placeholderHeight),
  );
  const border = Math.max(0, finite(measurement.borderY));
  const natural = Math.round(content + border);
  const height = Math.min(max, Math.max(min, natural));
  // Compare the rounded, border-inclusive natural height so a value that lands exactly
  // on the cap does not spuriously surface a scrollbar.
  return { height, overflowY: natural > max ? 'auto' : 'hidden' };
}

// Size the chat textarea to whatever it is displaying: the typed value, or the
// placeholder hint while empty. Engines disagree on whether a textarea's
// scrollHeight accounts for the placeholder, so while the box is empty we
// briefly swap the placeholder in as the value, measure, and restore.
export function autosizeChatInput(
  el: AutosizeTextarea,
  limits: ChatInputSizeLimits,
  borderY: number,
): ChatInputSize {
  const measureScrollHeight = (): number => {
    el.style.height = 'auto';
    return el.scrollHeight;
  };
  let placeholderHeight = 0;
  if (el.value === '' && el.placeholder) {
    el.value = el.placeholder;
    placeholderHeight = measureScrollHeight();
    el.value = '';
  }
  const size = chatInputSize(
    { contentHeight: measureScrollHeight(), placeholderHeight, borderY },
    limits,
  );
  el.style.height = `${size.height}px`;
  el.style.overflowY = size.overflowY;
  return size;
}

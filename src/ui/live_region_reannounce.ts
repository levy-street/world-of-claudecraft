// Deterministic re-announce marker for the HUD polite live regions (WIRING, DOM-free +
// deterministic by construction, like the announcers it serves; not a registered pure core).
//
// WHY: an ARIA live region only re-reads on a screen reader when its text actually CHANGES.
// An identical consecutive announcement (a repeated combat resist, re-targeting a second mob
// of the SAME template so the name string is byte-identical, a player repeating the same chat
// line) would otherwise stay silent on a screen reader that suppresses unchanged live text.
// mark() forces a byte-different string when the new text equals the one last marked, by
// toggling a single trailing non-breaking space (U+00A0): it does not change how the text
// reads aloud, and because every caller trims (or builds a localized line that cannot end in
// U+00A0) before marking, a marked string can never collide with a real line (trim() strips
// U+00A0). State only (the last text + a boolean toggle), no clock and no randomness, so the
// same input sequence yields the same output sequence and a Vitest drives it without jsdom.
//
// This is the ONE shared owner of that toggle, lifted from CombatAnnouncer's original inline
// markedFor once a third consumer appeared (the combat summary, the chat summary, and the
// target-name region), so the three live-region writers re-announce identically (rule of three).

// A single U+00A0 (non-breaking space), built from its code point so the source carries no
// invisible literal. trim() strips U+00A0, so a trimmed caller line can never end in it.
const REANNOUNCE_MARKER = String.fromCharCode(0xa0);

export class ReannounceMarker {
  // The last LOGICAL text handed to mark() (before any marker), or null before the first call.
  private lastText: string | null = null;
  private toggle = false;

  /**
   * Return a byte-different string when `text` equals the text last marked (so an identical
   * consecutive live-region write still mutates the node and re-reads), or `text` unchanged
   * when it differs (the toggle resets, so a changed announcement is byte-faithful).
   */
  mark(text: string): string {
    if (text !== this.lastText) {
      this.lastText = text;
      this.toggle = false;
      return text;
    }
    this.toggle = !this.toggle;
    return this.toggle ? `${text}${REANNOUNCE_MARKER}` : text;
  }

  /**
   * Forget the last marked text so the next call is treated as fresh (byte-faithful), used
   * when the region is cleared (e.g. losing the target) so re-acquiring the same value later
   * announces cleanly rather than with a stray marker.
   */
  reset(): void {
    this.lastText = null;
    this.toggle = false;
  }
}

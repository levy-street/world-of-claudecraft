// The bank family's whole-number count formatter. Rule of three reached: the
// bank window's private fmt, the guild pane's copy, and the vault pane's third
// were the same one-liner, so the family now shares this leaf (the esc.ts /
// known_item.ts shape: no DOM, no state, every consumer's Vitest drives it).
import { formatNumber } from './i18n';

/** A whole-number count in the viewer's locale (no fraction digits). */
export function formatCount(n: number): string {
  return formatNumber(n, { maximumFractionDigits: 0 });
}

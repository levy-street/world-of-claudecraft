import { describe, expect, it } from 'vitest';
import { isWindowOpen } from '../src/ui/window_toggle';

// Regression for the "first M/B press does nothing" bug: every HUD window is
// hidden by the shared `.window { display: none }` CSS rule, so a freshly
// logged-in window has NO inline display (''). The toggle's open/closed test
// must read that empty inline display as CLOSED; otherwise the first press
// "closes" an already-hidden window (a no-op) and only the second press opens
// it. toggleBags regressed because it treated anything `!== 'none'` (including
// '') as open.
describe('isWindowOpen', () => {
  it('treats a fresh CSS-hidden window (no inline display) as closed', () => {
    expect(isWindowOpen('')).toBe(false);
  });

  it('treats an explicit display:none as closed', () => {
    expect(isWindowOpen('none')).toBe(false);
  });

  it('treats any visible inline display as open', () => {
    // bags open as 'flex' on the normal path and as 'block' on the pet-feed
    // path, so both must read as open or the close branch is skipped.
    expect(isWindowOpen('flex')).toBe(true);
    expect(isWindowOpen('block')).toBe(true);
  });
});

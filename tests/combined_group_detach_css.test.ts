// The combined action-bar group's detach rule must OUTRANK the combined-mode
// rule. `body.combined-action-bars #actionbar-group` declares
// `position: relative; margin: 0 auto` (the outline-hug fix), which at
// specificity (1,1,1) beats a plain `#actionbar-group.hud-frame-detached`
// (1,1,0). The detached rule only ever matters while combined (uncombined, the
// group is `display: contents` and owns no box), so losing that tie made the
// group stay in flow when re-homed onto #ui: the auto margins centered it AND
// the inline `left` offset applied relative on top, ratcheting the group to
// the right screen edge on every grab. That shipped as "combine action bars is
// broken". The fix is a body-qualified detached selector, pinned here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

const HUD_CSS = fileURLToPath(new URL('../src/styles/hud.css', import.meta.url));

describe('combined action-bar group detach CSS', () => {
  // Stripped so a pin can never match commented-out CSS. The shared helper
  // fits this sheet: block comments (the only CSS comment form) are blanked in
  // place, and its TS line-comment arm is inert here because the sheet's only
  // '//' runs sit inside ':'-guarded data-URI protocol text.
  const css = stripComments(readFileSync(HUD_CSS, 'utf8'));

  it('detaches the COMBINED group with a selector that outranks the combined-mode rule', () => {
    // The combined-mode rule this must beat (its position/margin are the hazard).
    const combined = css.match(/body\.combined-action-bars #actionbar-group\s*\{[^}]*\}/);
    expect(combined?.[0]).toMatch(/position:\s*relative/);
    expect(combined?.[0]).toMatch(/margin:\s*0 auto/);
    // The detach rule, body-qualified so it wins that tie: (1,2,1) > (1,1,1).
    const detached = css.match(
      /body\.combined-action-bars #actionbar-group\.hud-frame-detached[^{]*\{[^}]*\}/,
    );
    expect(detached, 'body-qualified detached selector missing').toBeTruthy();
    expect(detached?.[0]).toMatch(/position:\s*absolute/);
    expect(detached?.[0]).toMatch(/margin:\s*0(?![ a-z])/);
  });
});

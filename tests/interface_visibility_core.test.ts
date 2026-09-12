// The Hide Interface toggle core (src/ui/interface_visibility_core.ts) and its
// body-class painter (interface_visibility.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInterfaceVisibility } from '../src/ui/interface_visibility';
import {
  dispatchInterfaceVisibilityAction,
  HIDE_INTERFACE_ACTION,
  INTERFACE_HIDDEN_CLASS,
  InterfaceVisibility,
} from '../src/ui/interface_visibility_core';

describe('InterfaceVisibility', () => {
  it('starts shown, toggles, and reports only real changes', () => {
    const changes: boolean[] = [];
    const v = new InterfaceVisibility((h) => changes.push(h));
    expect(v.hidden).toBe(false);
    expect(v.toggle()).toBe(true);
    expect(v.hidden).toBe(true);
    expect(v.toggle()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('show() consumes the press only when something was hidden', () => {
    const changes: boolean[] = [];
    const v = new InterfaceVisibility((h) => changes.push(h));
    // Nothing hidden: Escape must fall through to the panels / game menu.
    expect(v.show()).toBe(false);
    expect(changes).toEqual([]);
    v.toggle();
    expect(v.show()).toBe(true);
    expect(v.hidden).toBe(false);
    // Idempotent: a second show writes nothing.
    expect(v.show()).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});

describe('dispatchInterfaceVisibilityAction', () => {
  it('routes exactly the hideInterface bind and leaves every other action alone', () => {
    const v = new InterfaceVisibility(() => {});
    expect(HIDE_INTERFACE_ACTION).toBe('hideInterface');
    expect(dispatchInterfaceVisibilityAction('sheathe', v)).toBe(false);
    expect(dispatchInterfaceVisibilityAction('escape', v)).toBe(false);
    expect(v.hidden).toBe(false);
    expect(dispatchInterfaceVisibilityAction('hideInterface', v)).toBe(true);
    expect(v.hidden).toBe(true);
    expect(dispatchInterfaceVisibilityAction('hideInterface', v)).toBe(true);
    expect(v.hidden).toBe(false);
  });
});

describe('createInterfaceVisibility', () => {
  it('mirrors the hidden flag onto body.interface-hidden', () => {
    const toggle = vi.fn<(token: string, force?: boolean) => boolean>(() => true);
    const v = createInterfaceVisibility({ classList: { toggle } });
    expect(INTERFACE_HIDDEN_CLASS).toBe('interface-hidden');
    v.toggle();
    expect(toggle).toHaveBeenLastCalledWith('interface-hidden', true);
    v.show();
    expect(toggle).toHaveBeenLastCalledWith('interface-hidden', false);
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});

// The CSS hide set is the other half of the feature: pin the selectors and the
// three properties (a descendant re-declaring `visibility: visible`, which the
// raid boss guide hint and the Minimal cross-hotbar rail do, must still vanish
// through opacity, and no hidden frame may keep a click from the canvas).
describe('hud.css interface-hidden hide set', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
  const rule = css.slice(css.indexOf('body.interface-hidden #ui > :not(.visually-hidden)'));
  const block = rule.slice(0, rule.indexOf('}') + 1);

  it('enumerates every #ui child except the a11y live regions plus the body-level siblings', () => {
    for (const sel of [
      'body.interface-hidden #ui > :not(.visually-hidden)',
      'body.interface-hidden #nameplates',
      'body.interface-hidden #discord-window',
      'body.interface-hidden #discord-cta-banner',
      'body.interface-hidden #mobile-controls',
      'body.interface-hidden #pad-mouse-cursor',
    ]) {
      expect(block, sel).toContain(sel);
    }
  });

  it('hides through visibility, opacity, and pointer-events, never display', () => {
    expect(block).toContain('visibility: hidden !important');
    expect(block).toContain('opacity: 0 !important');
    expect(block).toContain('pointer-events: none !important');
    expect(block).not.toContain('display:');
  });
});

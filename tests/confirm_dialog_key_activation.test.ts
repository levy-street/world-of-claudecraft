// @vitest-environment jsdom
//
// Fixed test-first: keyboard activation inside the
// #confirm-dialog family. The game input layer listens for keydown on window
// (bubble): Enter is the chat-open edge action, which focuses the chat
// composer mid-keydown and (in Chromium) suppresses the focused button's
// native Enter activation, and Space is preventDefault-ed outright as the
// jump key. Net effect, proven by a live browser probe: with the destroy
// confirm open and its OK button focused, Enter pulled focus OUT of the
// aria-modal dialog into chat (a containment breach) and activated nothing,
// Space did nothing, and only a mouse click could confirm. Escape-cancel was
// the lone keyboard path.
//
// bindDialogKeyActivation is the dialog-scoped repair: Enter or Space on a
// focused button inside the dialog activates that button and stops the event
// there, so the game layer never sees the press.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindDialogKeyActivation } from '../src/ui/dialog_key_activation';

function harness() {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  const cancel = document.createElement('button');
  const ok = document.createElement('button');
  root.append(cancel, ok);
  const outside = document.createElement('button');
  document.body.append(root, outside);
  let okClicks = 0;
  let cancelClicks = 0;
  ok.addEventListener('click', () => {
    okClicks += 1;
  });
  cancel.addEventListener('click', () => {
    cancelClicks += 1;
  });
  // Simulates the game input layer: a window-level bubble keydown listener
  // (src/game/input.ts attaches exactly this way); the dialog handler must
  // stop activation keys from ever reaching it.
  let windowSaw = 0;
  const spy = () => {
    windowSaw += 1;
  };
  window.addEventListener('keydown', spy);
  bindDialogKeyActivation(root);
  const press = (target: HTMLElement, init: KeyboardEventInit) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };
  return {
    root,
    ok,
    cancel,
    outside,
    press,
    counts: () => ({ okClicks, cancelClicks, windowSaw }),
    done: () => window.removeEventListener('keydown', spy),
  };
}

describe('bindDialogKeyActivation (confirm-dialog family keyboard repair)', () => {
  it('Enter on a focused button activates it, consumed before the game layer', () => {
    const h = harness();
    h.ok.focus();
    const ev = h.press(h.ok, { key: 'Enter', code: 'Enter' });
    expect(h.counts().okClicks).toBe(1);
    expect(h.counts().cancelClicks).toBe(0);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.counts().windowSaw).toBe(0);
    h.done();
  });

  it('Space on a focused button activates it, consumed before the game layer', () => {
    const h = harness();
    h.cancel.focus();
    const ev = h.press(h.cancel, { key: ' ', code: 'Space' });
    expect(h.counts().cancelClicks).toBe(1);
    expect(h.counts().okClicks).toBe(0);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.counts().windowSaw).toBe(0);
    h.done();
  });

  it('activation keys pass through when focus is not on a dialog button', () => {
    const h = harness();
    // Focus outside the dialog: the root handler never sees the event at all
    // (it does not bubble through the root), so the game layer keeps it.
    h.outside.focus();
    h.press(h.outside, { key: 'Enter', code: 'Enter' });
    // Focus on the dialog root itself (no button): passes through untouched.
    h.root.tabIndex = -1;
    h.root.focus();
    const ev = h.press(h.root, { key: 'Enter', code: 'Enter' });
    expect(h.counts().okClicks).toBe(0);
    expect(h.counts().cancelClicks).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.counts().windowSaw).toBe(2);
    h.done();
  });

  it('non-activation keys are left for the game layer even on a focused button', () => {
    const h = harness();
    h.ok.focus();
    const ev = h.press(h.ok, { key: 'a', code: 'KeyA' });
    expect(h.counts().okClicks).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.counts().windowSaw).toBe(1);
    h.done();
  });

  it('both confirmDialog and inputDialog wire the binder (source pin)', () => {
    // cwd-relative: vitest's jsdom transform rewrites import.meta.url to a
    // non-file scheme, so the sibling suites' URL idiom cannot work here.
    const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const calls = hud.match(/bindDialogKeyActivation\(el\)/g) ?? [];
    // Exactly the two family dialogs (confirmDialog + inputDialog): a moved
    // or third call site is a deliberate change, re-pin it here.
    expect(calls.length).toBe(2);
  });
});

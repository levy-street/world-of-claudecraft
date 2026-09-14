// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { makeBankWindowFocus } from '../src/ui/bank_window_focus';
import type { FocusManager } from '../src/ui/focus_manager';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  vi.restoreAllMocks();
});
it.each([false, true])(
  'traps focus only in weekly mode (%s) and returns to the opener',
  (weekly) => {
    document.body.innerHTML =
      '<button id="opener">Open</button><section id="bank"><button>Close</button></section>';
    document.body.classList.toggle('weekly-vault-open', weekly);
    const opener = document.querySelector<HTMLElement>('#opener')!;
    const root = document.querySelector<HTMLElement>('#bank')!;
    opener.focus();
    const release = vi.fn();
    const open = vi.fn(() => ({ release }));
    const restore = vi.fn();
    const fm = { open, restore, activeFocusable: () => opener } as unknown as FocusManager;
    const bridge = makeBankWindowFocus(fm, () => root);
    const captured = bridge.captureFocus();
    expect(captured).toBe(opener);
    expect(open).toHaveBeenCalledTimes(weekly ? 1 : 0);
    bridge.restoreFocus(captured);
    if (weekly) expect(release).toHaveBeenCalledWith(true, opener);
    else expect(restore).toHaveBeenCalledWith(opener);
  },
);

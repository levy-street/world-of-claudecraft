// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { makeBankWindowFocus } from '../src/ui/bank_window_focus';
import type { FocusManager } from '../src/ui/focus_manager';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  vi.restoreAllMocks();
});

// The bank never traps Tab (its docked bags stay reachable) and returns focus
// to its opener. The weekly rewards sheet that used to trap inside this root is
// the Rewards hub's Vault tab now (menu consolidation step 7), so no body class
// switches the bank into a trap any more.
it('records the opener without a trap and returns focus to it', () => {
  document.body.innerHTML =
    '<button id="opener">Open</button><section id="bank"><button>Close</button></section>';
  document.body.classList.add('weekly-vault-open');
  const opener = document.querySelector<HTMLElement>('#opener')!;
  const root = document.querySelector<HTMLElement>('#bank')!;
  opener.focus();
  const open = vi.fn(() => ({ release: vi.fn() }));
  const restore = vi.fn();
  const fm = { open, restore, activeFocusable: () => opener } as unknown as FocusManager;
  const bridge = makeBankWindowFocus(fm, () => root);
  const captured = bridge.captureFocus();
  expect(captured).toBe(opener);
  expect(open).not.toHaveBeenCalled();
  bridge.restoreFocus(captured);
  expect(restore).toHaveBeenCalledWith(opener);
});

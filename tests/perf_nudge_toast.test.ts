// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { initPerfNudgeToast } from '../src/ui/perf_nudge_toast';

// The R16 persistence round-trip the pure view cannot cover: the toast OWNS
// the dismissal storage (key, keyed value, comparison), so dismiss-then-reboot
// and the changed-cause re-arm are proven here against real localStorage. Each
// simulated reboot clears the DOM (a fresh document on a real reload) while
// localStorage persists, exactly the per-install semantics.

const KEY = 'woc_perf_nudge_dismissed';

function bootInit(suggestionIds: string[], desktopShell = false): boolean {
  document.body.innerHTML = '';
  return initPerfNudgeToast({
    suggestionIds,
    softwareNoticeAlreadyShown: false,
    desktopShell,
  });
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('initPerfNudgeToast persistence round-trip', () => {
  it('shows once, persists the keyed dismissal, and stays hidden across reboots for the same cause', () => {
    expect(bootInit(['hardware-acceleration'])).toBe(true);
    const root = document.getElementById('perf-nudge');
    expect(root).not.toBeNull();
    expect(root?.hidden).toBe(false);
    expect(root?.getAttribute('role')).toBe('status');
    expect(document.querySelector('#perf-nudge .perf-nudge-message')?.textContent).toContain(
      'without GPU acceleration',
    );

    (document.querySelector('.perf-nudge-dismiss') as HTMLButtonElement).click();
    expect(document.getElementById('perf-nudge')?.hidden).toBe(true);
    // The storage key and its keyed value are the load-bearing literals.
    expect(localStorage.getItem(KEY)).toBe('hardware-acceleration');

    // Reboot with the SAME cause: never re-nag, no element is even created.
    expect(bootInit(['hardware-acceleration'])).toBe(false);
    expect(document.getElementById('perf-nudge')).toBeNull();
  });

  it('re-arms when the triggering cause changes, then keys the new dismissal', () => {
    expect(bootInit(['hardware-acceleration'])).toBe(true);
    (document.querySelector('.perf-nudge-dismiss') as HTMLButtonElement).click();
    expect(localStorage.getItem(KEY)).toBe('hardware-acceleration');

    // A different machine-local cause re-arms the toast (ruling R16).
    expect(bootInit(['integrated-gpu'])).toBe(true);
    expect(document.querySelector('#perf-nudge .perf-nudge-message')?.textContent).toContain(
      'integrated',
    );
    (document.querySelector('.perf-nudge-dismiss') as HTMLButtonElement).click();
    expect(localStorage.getItem(KEY)).toBe('integrated-gpu');

    // And the new dismissal holds on the next reboot.
    expect(bootInit(['integrated-gpu'])).toBe(false);
  });

  it('never treats an empty stored value as a dismissal of nothing', () => {
    localStorage.setItem(KEY, '');
    expect(bootInit(['integrated-gpu'])).toBe(true);
  });

  it('picks the desktop software copy inside the shell', () => {
    expect(bootInit(['hardware-acceleration'], true)).toBe(true);
    expect(document.querySelector('#perf-nudge .perf-nudge-message')?.textContent).toContain(
      'restart the game',
    );
  });
});

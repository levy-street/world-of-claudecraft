// @vitest-environment jsdom
// Round-trip behavior of the options-window deed-broadcast account row
// (buildDeedBroadcastRow): loads the persisted accounts.deed_broadcasts state
// before enabling, flips optimistically on click with the server echo winning,
// reverts a failed write, and defaults to the column TRUE when the read fails.
// The row renders only when main.ts wired the online seam; the absence arm is
// source-pinned in tests/options_window.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { buildDeedBroadcastRow, type DeedBroadcastSeam } from '../src/ui/options_window';

function mount(seam: DeedBroadcastSeam): { row: HTMLElement; toggle: HTMLButtonElement } {
  const parent = document.createElement('div');
  buildDeedBroadcastRow(parent, seam);
  const row = parent.querySelector('.set-row') as HTMLElement;
  const toggle = row.querySelector('button.set-toggle') as HTMLButtonElement;
  return { row, toggle };
}

async function settled(): Promise<void> {
  // Drain the promise chain (catch + then hops) without timers.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('deed broadcast row', () => {
  it('stays disabled and busy until the persisted state loads, then renders it', async () => {
    let resolveGet: (v: boolean) => void = () => {};
    const seam: DeedBroadcastSeam = {
      get: () => new Promise((resolve) => (resolveGet = resolve)),
      set: vi.fn(async (v: boolean) => v),
    };
    const { row, toggle } = mount(seam);
    expect(row.querySelector('.set-name')?.textContent).toBe(
      'Share deed unlocks with guild and friends',
    );
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-busy')).toBe('true');
    resolveGet(false);
    await settled();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-busy')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(seam.set).not.toHaveBeenCalled();
  });

  it('round-trips a toggle: optimistic flip, one write, the echo wins', async () => {
    const set = vi.fn(async (v: boolean) => v);
    const { toggle } = mount({ get: async () => true, set });
    await settled();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    // Optimistic flip lands synchronously; the button locks while in flight.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.disabled).toBe(true);
    await settled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(false);
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('the server echo wins over the optimistic flip when they differ', async () => {
    // A server that refuses the change echoes the OLD value; the row must
    // settle on the echo, not the optimistic flip (deleting the echo
    // application would leave the row lying until the next open).
    const set = vi.fn(async (): Promise<boolean> => false);
    const { toggle } = mount({ get: async () => false, set });
    await settled();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    // Optimistic flip to true...
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await settled();
    // ...but the echo said false, so false is what renders.
    expect(set).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.disabled).toBe(false);
  });

  it('reverts to the last known state when the write fails', async () => {
    const set = vi.fn(async (): Promise<boolean> => {
      throw new Error('offline');
    });
    const { toggle } = mount({ get: async () => true, set });
    await settled();
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await settled();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.disabled).toBe(false);
  });

  it('renders the column default (enabled) when the read fails, still writable', async () => {
    const set = vi.fn(async (v: boolean) => v);
    const { toggle } = mount({
      get: async () => {
        throw new Error('offline');
      },
      set,
    });
    await settled();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    await settled();
    expect(set).toHaveBeenCalledWith(false);
  });

  it('carries the accessible name on the toggle itself', async () => {
    const { toggle } = mount({ get: async () => true, set: async (v) => v });
    await settled();
    expect(toggle.getAttribute('aria-label')).toBe('Share deed unlocks with guild and friends');
  });
});

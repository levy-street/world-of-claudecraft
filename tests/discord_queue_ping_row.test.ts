// @vitest-environment happy-dom
// The options-window queue-pop Discord DM opt-in row (buildDiscordQueuePingRow):
// the account-toggle family's second member. The round-trip mechanics (busy
// until loaded, optimistic flip, echo wins, failed write reverts) are pinned on
// the shared core by tests/deed_broadcast_row.test.ts; this file pins what is
// specific to THIS row: its label and its FALSE fallback (the column default,
// the opposite of the deed row's TRUE).
import { describe, expect, it, vi } from 'vitest';
import { type AccountToggleSeam, buildDiscordQueuePingRow } from '../src/ui/options_window';

function mount(seam: AccountToggleSeam): { row: HTMLElement; toggle: HTMLButtonElement } {
  const parent = document.createElement('div');
  buildDiscordQueuePingRow(parent, seam);
  const row = parent.querySelector('.set-row') as HTMLElement;
  const toggle = row.querySelector('button.set-toggle') as HTMLButtonElement;
  return { row, toggle };
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('discord queue-ping row', () => {
  it('renders the opt-in label, busy until the persisted state loads', async () => {
    let resolveGet: (v: boolean) => void = () => {};
    const seam: AccountToggleSeam = {
      get: () => new Promise((resolve) => (resolveGet = resolve)),
      set: vi.fn(async (v: boolean) => v),
    };
    const { row, toggle } = mount(seam);
    expect(row.querySelector('.set-name')?.textContent).toBe(
      'Send me a Discord direct message when my battleground or arena queue pops (needs a linked Discord account)',
    );
    expect(toggle.getAttribute('aria-label')).toBe(row.querySelector('.set-name')?.textContent);
    expect(toggle.disabled).toBe(true);
    // Before the read lands the row shows the column default: OFF.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    resolveGet(true);
    await settled();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(seam.set).not.toHaveBeenCalled();
  });

  it('falls back to OFF (the column default) when the read fails', async () => {
    const { toggle } = mount({
      get: async () => Promise.reject(new Error('offline')),
      set: vi.fn(),
    });
    await settled();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('opts in with ONE write and lets the echo win', async () => {
    const set = vi.fn(async (v: boolean) => v);
    const { toggle } = mount({ get: async () => false, set });
    await settled();
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await settled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.disabled).toBe(false);
  });
});

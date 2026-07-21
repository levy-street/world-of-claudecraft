import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { ActionBarLayout } from '../src/world_api/action_bar';

// The ClientWorld upload-coalescing contract, driven on a bare prototype instance
// (no WebSocket plumbing) with fake timers. This pins the write-amplification
// defenses: a burst of edits collapses to ONE wire save carrying the final
// layout, and an unchanged re-save sends nothing.
function bareClient(): { client: any; sent: any[] } {
  const client: any = Object.create(ClientWorld.prototype);
  client.actionBarSaveTimer = null;
  client.actionBarSaveLastJson = null;
  client.actionBarSavePending = null;
  const sent: any[] = [];
  client.cmd = (payload: any) => sent.push(payload);
  return { client, sent };
}

const A: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'a' }] } } };
const B: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'b' }] } } };
const C: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'c' }] } } };

describe('ClientWorld.saveActionBarLayout (debounce + dedup)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of edits into one wire save carrying the final layout', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout(A);
    client.saveActionBarLayout(B);
    client.saveActionBarLayout(C);
    expect(sent).toHaveLength(0); // nothing sent until the debounce elapses
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);
    expect(sent[0].cmd).toBe('save_hotbar_layout');
    expect(sent[0].layout).toEqual(C);
  });

  it('skips a re-save whose serialized layout matches the last one sent', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout(A);
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);
    // Identical layout again: deduped, no timer even scheduled.
    client.saveActionBarLayout(A);
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);
    // A genuine change still uploads.
    client.saveActionBarLayout(B);
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(2);
    expect(sent[1].layout).toEqual(B);
  });

  it('drops a malformed layout without scheduling a send', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout({ forms: 'garbage' } as unknown as ActionBarLayout);
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(0);
  });

  it('flushes a pending debounced save immediately (logout / tab-close path)', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout(A);
    expect(sent).toHaveLength(0); // still inside the debounce window
    client.flushActionBarLayoutSave();
    expect(sent).toHaveLength(1);
    expect(sent[0].cmd).toBe('save_hotbar_layout');
    expect(sent[0].layout).toEqual(A);
    // The cancelled debounce timer must not then fire a duplicate.
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);
  });

  it('flush with nothing pending is a no-op', () => {
    const { client, sent } = bareClient();
    client.flushActionBarLayoutSave();
    expect(sent).toHaveLength(0);
  });
});

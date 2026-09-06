import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_BAR_SAVE_DEBOUNCE_MS,
  ActionBarLayoutUploader,
  type ActionBarSaveCommand,
} from '../src/net/action_bar_upload';
import { ClientWorld } from '../src/net/online';
import type { ActionBarLayout } from '../src/world_api/action_bar';

// The upload-coalescing contract of the uploader ClientWorld composes, under
// fake timers. This pins the write-amplification defenses: a burst of edits
// collapses to ONE wire save carrying the final layout, an unchanged re-save
// sends nothing, and every send names the profile it arranges.
function uploader(): { up: ActionBarLayoutUploader; sent: ActionBarSaveCommand[] } {
  const sent: ActionBarSaveCommand[] = [];
  return { up: new ActionBarLayoutUploader((command) => sent.push(command)), sent };
}

// The ClientWorld routing on a bare prototype instance (no WebSocket plumbing):
// saveActionBarLayout feeds the uploader and the flush path sends its command.
// Kept bespoke on purpose (issue #2088): this fixture returns the {client, sent}
// pair, unlike tests/helpers/bare_client.ts's bareClient(), which is the default
// for a new suite that just needs a bare ClientWorld.
function bareClient(): { client: any; sent: any[] } {
  const client: any = Object.create(ClientWorld.prototype);
  const sent: any[] = [];
  client.cmd = (payload: any) => sent.push(payload);
  client.actionBarUploader = new ActionBarLayoutUploader((command) => client.cmd(command));
  return { client, sent };
}

const A: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'a' }] } } };
const B: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'b' }] } } };
const C: ActionBarLayout = { v: 1, forms: { normal: { bar: [{ type: 'ability', id: 'c' }] } } };
const AFTER_DEBOUNCE = ACTION_BAR_SAVE_DEBOUNCE_MS + 100;

describe('ActionBarLayoutUploader (debounce + dedup)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of edits into one wire save carrying the final layout', () => {
    const { up, sent } = uploader();
    up.save('desktop', A);
    up.save('desktop', B);
    up.save('desktop', C);
    expect(sent).toHaveLength(0); // nothing sent until the debounce elapses
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ cmd: 'save_hotbar_layout', profile: 'desktop', layout: C });
  });

  it('skips a re-save whose serialized layout matches the last one sent', () => {
    const { up, sent } = uploader();
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    // Identical layout again: deduped, no timer even scheduled.
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    // A genuine change still uploads.
    up.save('desktop', B);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(2);
    expect(sent[1].layout).toEqual(B);
  });

  it('keeps one pending save per profile, so a switch inside the window drops nothing', () => {
    const { up, sent } = uploader();
    up.save('desktop', A);
    up.save('touch', B);
    up.save('desktop', C); // the desktop edit is refined again before the window closes
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent.map((command) => [command.profile, command.layout])).toEqual([
      ['desktop', C],
      ['touch', B],
    ]);
    // Dedupe is per profile too: the same layout again under desktop is skipped,
    // while touch still sends its own change.
    up.save('desktop', C);
    up.save('touch', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual({ cmd: 'save_hotbar_layout', profile: 'touch', layout: A });
  });

  it('treats the same layout under another profile as a genuine change', () => {
    const { up, sent } = uploader();
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    up.save('touch', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent.map((command) => command.profile)).toEqual(['desktop', 'touch']);
    expect(sent[1].layout).toEqual(A);
  });

  it('drops a malformed or empty layout without scheduling a send', () => {
    const { up, sent } = uploader();
    up.save('desktop', { forms: 'garbage' } as unknown as ActionBarLayout);
    up.save('touch', { v: 1, forms: {} });
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(0);
  });

  it('flushes a pending debounced save immediately (logout / tab-close path)', () => {
    const { up, sent } = uploader();
    up.save('touch', A);
    expect(sent).toHaveLength(0); // still inside the debounce window
    up.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ cmd: 'save_hotbar_layout', profile: 'touch', layout: A });
    // The cancelled debounce timer must not then fire a duplicate.
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
  });

  it('flush with nothing pending is a no-op', () => {
    const { up, sent } = uploader();
    up.flush();
    expect(sent).toHaveLength(0);
  });
});

describe('ClientWorld.saveActionBarLayout routes through the uploader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the profile-tagged save_hotbar_layout command after the debounce', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout('touch', A);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toEqual([{ cmd: 'save_hotbar_layout', profile: 'touch', layout: A }]);
  });

  it('flushActionBarLayoutSave sends a pending save at once and never twice', () => {
    const { client, sent } = bareClient();
    client.saveActionBarLayout('desktop', B);
    client.flushActionBarLayoutSave();
    expect(sent).toHaveLength(1);
    expect(sent[0].cmd).toBe('save_hotbar_layout');
    expect(sent[0].profile).toBe('desktop');
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    client.flushActionBarLayoutSave(); // nothing pending: no-op
    expect(sent).toHaveLength(1);
  });
});

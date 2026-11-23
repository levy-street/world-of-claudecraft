import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const up = new ActionBarLayoutUploader((command) => {
    sent.push(command);
    return true;
  });
  return { up, sent };
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

  it('closing the client sends a pending save before closing the socket and never twice', () => {
    const { client, sent } = bareClient();
    client.ws = {
      onclose: null,
      close: vi.fn(() => {
        expect(sent).toEqual([{ cmd: 'save_hotbar_layout', profile: 'desktop', layout: B }]);
      }),
    };
    client.saveActionBarLayout('desktop', B);
    client.close();
    expect(sent).toHaveLength(1);
    expect(sent[0].cmd).toBe('save_hotbar_layout');
    expect(sent[0].profile).toBe('desktop');
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    client.close(); // nothing pending: no duplicate upload
    expect(sent).toHaveLength(1);
  });
});

// A save the socket refuses (closed mid-debounce, a backgrounded phone whose
// transport already died) must stay pending and go out on the next flush, and
// must never be recorded as delivered: the dedupe otherwise refused to re-send
// the identical layout for the rest of the session, and the server's older copy
// won over the local mirror at the next login (the "my mount slot vanished"
// report: abilities auto-place back, item slots do not).
describe('ActionBarLayoutUploader: a refused send stays pending', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function refusable(): {
    up: ActionBarLayoutUploader;
    sent: ActionBarSaveCommand[];
    gate: { accept: boolean };
  } {
    const sent: ActionBarSaveCommand[] = [];
    const gate = { accept: false };
    const up = new ActionBarLayoutUploader((command) => {
      if (!gate.accept) return false;
      sent.push(command);
      return true;
    });
    return { up, sent, gate };
  }

  it('keeps the save pending when the socket refuses it and sends it on the next accepting flush', () => {
    const { up, sent, gate } = refusable();
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(0);
    up.flush(); // still refused: still pending
    expect(sent).toHaveLength(0);
    gate.accept = true;
    up.flush();
    expect(sent).toEqual([{ cmd: 'save_hotbar_layout', profile: 'desktop', layout: A }]);
    up.flush(); // delivered once, nothing left pending
    expect(sent).toHaveLength(1);
  });

  it('never dedupes a layout whose only send was refused', () => {
    const { up, sent, gate } = refusable();
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(0);
    gate.accept = true;
    up.save('desktop', A); // the same edit again, now with the socket open
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    expect(sent[0].layout).toEqual(A);
  });

  it('cancels a pending save when the layout reverts to the last delivered one', () => {
    const { up, sent, gate } = refusable();
    gate.accept = true;
    up.save('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
    up.save('desktop', B);
    up.save('desktop', A); // undone inside the window: the server already holds A
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(1);
  });
});

describe('ClientWorld re-sends a stranded layout save after a reconnect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes the pending save from the post-reconnect preference re-push', () => {
    const client: any = Object.create(ClientWorld.prototype);
    const sent: any[] = [];
    const gate = { accept: false };
    client.cmd = (payload: any) => {
      if (!gate.accept) return false;
      sent.push(payload);
      return true;
    };
    client.actionBarUploader = new ActionBarLayoutUploader((command) => client.cmd(command));
    client.saveActionBarLayout('desktop', A);
    vi.advanceTimersByTime(AFTER_DEBOUNCE);
    expect(sent).toHaveLength(0); // the debounce fired into a closed socket
    gate.accept = true;
    client.resendSessionPreferences(); // the resume handshake's re-push, after `connected` flips
    expect(sent.map((command) => command.cmd)).toEqual(['save_hotbar_layout']);
    expect(sent[0].layout).toEqual(A);
  });

  it('cmd reports whether the frame reached the socket', () => {
    const client: any = Object.create(ClientWorld.prototype);
    const frames: string[] = [];
    client.ws = { readyState: 1, send: (frame: string) => frames.push(frame) };
    client.connected = false;
    expect(client.cmd({ cmd: 'interact' })).toBe(false);
    expect(frames).toHaveLength(0);
    client.connected = true;
    expect(client.cmd({ cmd: 'interact' })).toBe(true);
    expect(frames).toHaveLength(1);
  });
});

describe('ActionBarLayoutUploader: partial refusal across profiles, and the socket arms', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers the accepted profile and keeps only the refused one pending', () => {
    const sent: ActionBarSaveCommand[] = [];
    const refused = new Set<string>(['desktop']);
    const up = new ActionBarLayoutUploader((command) => {
      if (refused.has(command.profile)) return false;
      sent.push(command);
      return true;
    });
    up.save('desktop', A);
    up.save('touch', B);
    up.flush();
    expect(sent.map((command) => command.profile)).toEqual(['touch']);
    refused.clear();
    up.flush();
    expect(sent.map((command) => command.profile)).toEqual(['touch', 'desktop']);
    expect(sent[1].layout).toEqual(A);
    up.flush(); // nothing left
    expect(sent).toHaveLength(2);
  });

  it('cmd refuses a frame on a socket that is not OPEN and while spectating', () => {
    const client: any = Object.create(ClientWorld.prototype);
    const frames: string[] = [];
    client.ws = { readyState: 3, send: (frame: string) => frames.push(frame) };
    client.connected = true;
    expect(client.cmd({ cmd: 'interact' })).toBe(false);
    client.ws.readyState = 1;
    client.spectating = 'Someone';
    expect(client.cmd({ cmd: 'interact' })).toBe(false);
    expect(frames).toHaveLength(0);
    client.spectating = null;
    expect(client.cmd({ cmd: 'interact' })).toBe(true);
    expect(frames).toHaveLength(1);
  });

  it('the production uploader is wired to the boolean-returning cmd', () => {
    const online = readFileSync(join(__dirname, '../src/net/online.ts'), 'utf8');
    expect(online).toContain('new ActionBarLayoutUploader((command) => this.cmd(command))');
    expect(online).toContain(
      'private cmd(payload: { cmd: ClientCommand } & Record<string, unknown>): boolean {',
    );
  });
});

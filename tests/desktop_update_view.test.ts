import { describe, expect, it } from 'vitest';
import {
  dismissUpdateToast,
  expireUpToDateToast,
  INITIAL_UPDATE_TOAST_STATE,
  reduceUpdateToast,
} from '../src/ui/desktop_update_view';

describe('reduceUpdateToast', () => {
  it('walks the launch happy path: checking -> downloading (+progress) -> ready', () => {
    let state = INITIAL_UPDATE_TOAST_STATE;
    state = reduceUpdateToast(state, { type: 'checking' });
    expect(state).toMatchObject({ mode: 'checking', checkedOnce: true });
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'downloading', version: '0.19.0', percent: 0 });
    state = reduceUpdateToast(state, { type: 'progress', percent: 50 });
    expect(state).toMatchObject({ mode: 'downloading', percent: 50 });
    state = reduceUpdateToast(state, { type: 'downloaded', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'ready', version: '0.19.0', percent: 100 });
  });

  it('shows the checking card only for the first check per session', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    expect(state.mode).toBe('checking');
    // The first check found nothing; the card resolved and hid.
    state = reduceUpdateToast(state, { type: 'not-available' });
    state = expireUpToDateToast(state);
    expect(state.mode).toBe('hidden');
    // The 4-hour recheck stays silent.
    state = reduceUpdateToast(state, { type: 'checking' });
    expect(state.mode).toBe('hidden');
    // ...but an update it finds still surfaces.
    state = reduceUpdateToast(state, { type: 'available', version: '0.20.0' });
    expect(state).toMatchObject({ mode: 'downloading', version: '0.20.0' });
  });

  it('resolves a visible check into the up-to-date confirmation, silent otherwise', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    state = reduceUpdateToast(state, { type: 'not-available' });
    expect(state.mode).toBe('uptodate');
    // The consumer's timer expiry hides it without setting the dismissal flag.
    state = expireUpToDateToast(state);
    expect(state).toMatchObject({ mode: 'hidden', dismissed: false });
    // A recheck's not-available with nothing showing changes nothing.
    state = reduceUpdateToast(state, { type: 'not-available' });
    expect(state.mode).toBe('hidden');
  });

  it('expireUpToDateToast only ever collapses the uptodate mode', () => {
    const downloading = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    expect(expireUpToDateToast(downloading)).toBe(downloading);
  });

  it('an error clears a checking or downloading card but never the ready one', () => {
    let checking = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    checking = reduceUpdateToast(checking, { type: 'error' });
    expect(checking.mode).toBe('hidden');

    let downloading = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    downloading = reduceUpdateToast(downloading, { type: 'error' });
    expect(downloading.mode).toBe('hidden');

    let ready = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'downloaded',
      version: '0.19.0',
    });
    ready = reduceUpdateToast(ready, { type: 'error' });
    expect(ready.mode).toBe('ready');
  });

  it('progress only moves the bar while downloading, and clamps junk percents', () => {
    const checking = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    expect(reduceUpdateToast(checking, { type: 'progress', percent: 40 }).percent).toBe(0);

    // Stray progress chatter over the up-to-date confirmation changes nothing.
    const uptodate = reduceUpdateToast(checking, { type: 'not-available' });
    const afterStray = reduceUpdateToast(uptodate, { type: 'progress', percent: 40 });
    expect(afterStray).toMatchObject({ mode: 'uptodate', percent: 0 });

    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'progress', percent: 33.4 });
    expect(state.percent).toBe(33);
    state = reduceUpdateToast(state, { type: 'progress', percent: 250 });
    expect(state.percent).toBe(100);
    state = reduceUpdateToast(state, { type: 'progress', percent: Number.NaN });
    expect(state.percent).toBe(100);
  });

  it('keeps download progress across a re-emitted available (4h recheck)', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'progress', percent: 60 });
    expect(state.percent).toBe(60);
    // Same update re-announced mid-download must not zero the bar.
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'downloading', version: '0.19.0', percent: 60 });
    // A newer version stamp on the same download path is allowed to update.
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.1' });
    expect(state).toMatchObject({ mode: 'downloading', version: '0.19.1', percent: 60 });
  });

  it('never lets progress regress mid-download', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'progress', percent: 50 });
    const afterLower = reduceUpdateToast(state, { type: 'progress', percent: 20 });
    expect(afterLower.percent).toBe(50);
    // Identity elision: a no-op lower sample returns the same state object.
    expect(afterLower).toBe(state);
    state = reduceUpdateToast(state, { type: 'progress', percent: 70 });
    expect(state.percent).toBe(70);
  });

  it('keeps ready sticky over later checking/available/progress chatter', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'downloaded',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'checking' });
    expect(state.mode).toBe('ready');
    state = reduceUpdateToast(state, { type: 'available', version: '0.20.0' });
    expect(state.mode).toBe('ready');
    state = reduceUpdateToast(state, { type: 'progress', percent: 10 });
    expect(state.mode).toBe('ready');
    state = reduceUpdateToast(state, { type: 'not-available' });
    expect(state.mode).toBe('ready');
  });

  it('keeps the downloading version when downloaded omits one', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'downloaded' });
    expect(state).toMatchObject({ mode: 'ready', version: '0.19.0' });
  });

  it('a downloading dismissal suppresses later chatter but downloaded re-surfaces', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = dismissUpdateToast(state);
    expect(state).toMatchObject({ mode: 'hidden', dismissed: true });
    state = reduceUpdateToast(state, { type: 'checking' });
    expect(state.mode).toBe('hidden');
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state.mode).toBe('hidden');
    state = reduceUpdateToast(state, { type: 'downloaded', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'ready', dismissed: false });
  });

  it('dismissing the informational checking/uptodate cards never suppresses the download', () => {
    // Swatting the launch spinner must not opt the player out of the notice.
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    state = dismissUpdateToast(state);
    expect(state).toMatchObject({ mode: 'hidden', dismissed: false });
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state.mode).toBe('downloading');

    // Same for the up-to-date confirmation's corner dismiss.
    let uptodate = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, { type: 'checking' });
    uptodate = reduceUpdateToast(uptodate, { type: 'not-available' });
    uptodate = dismissUpdateToast(uptodate);
    expect(uptodate).toMatchObject({ mode: 'hidden', dismissed: false });
    uptodate = reduceUpdateToast(uptodate, { type: 'available', version: '0.19.0' });
    expect(uptodate.mode).toBe('downloading');
  });
});

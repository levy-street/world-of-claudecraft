import { describe, expect, it } from 'vitest';
import {
  dismissUpdateToast,
  INITIAL_UPDATE_TOAST_STATE,
  reduceUpdateToast,
} from '../src/ui/desktop_update_view';

describe('reduceUpdateToast', () => {
  it('walks the happy path: available -> downloading, downloaded -> ready', () => {
    let state = INITIAL_UPDATE_TOAST_STATE;
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'downloading', version: '0.19.0' });
    state = reduceUpdateToast(state, { type: 'progress', percent: 50 });
    expect(state.mode).toBe('downloading');
    state = reduceUpdateToast(state, { type: 'downloaded', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'ready', version: '0.19.0' });
  });

  it('keeps ready sticky over later available/progress chatter', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'downloaded',
      version: '0.19.0',
    });
    state = reduceUpdateToast(state, { type: 'available', version: '0.20.0' });
    expect(state.mode).toBe('ready');
    state = reduceUpdateToast(state, { type: 'progress', percent: 10 });
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

  it('a dismissal suppresses downloading chatter but downloaded re-surfaces', () => {
    let state = reduceUpdateToast(INITIAL_UPDATE_TOAST_STATE, {
      type: 'available',
      version: '0.19.0',
    });
    state = dismissUpdateToast(state);
    expect(state.mode).toBe('hidden');
    state = reduceUpdateToast(state, { type: 'available', version: '0.19.0' });
    expect(state.mode).toBe('hidden');
    state = reduceUpdateToast(state, { type: 'downloaded', version: '0.19.0' });
    expect(state).toMatchObject({ mode: 'ready', dismissed: false });
  });
});

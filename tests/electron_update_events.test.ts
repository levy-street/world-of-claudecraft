import { describe, expect, it } from 'vitest';
import { shouldNotifyProgress, updateEventPayload } from '../electron/update_events.cjs';

describe('updateEventPayload (renderer-facing whitelist)', () => {
  it('passes only type and version for available/downloaded', () => {
    expect(
      updateEventPayload('available', {
        version: '0.19.0',
        files: [{ url: 'https://feed/x.zip' }],
        path: '/tmp/secret',
      }),
    ).toEqual({ type: 'available', version: '0.19.0' });
    expect(updateEventPayload('downloaded', { version: '0.19.0' })).toEqual({
      type: 'downloaded',
      version: '0.19.0',
    });
  });

  it('clamps junk versions and percent values', () => {
    expect(updateEventPayload('available', { version: 42 })).toEqual({
      type: 'available',
      version: '',
    });
    expect(updateEventPayload('available', { version: 'v'.repeat(200) })?.version?.length).toBe(64);
    expect(updateEventPayload('progress', { percent: 33.4 })).toEqual({
      type: 'progress',
      percent: 33,
    });
    expect(updateEventPayload('progress', { percent: 250 })).toEqual({
      type: 'progress',
      percent: 100,
    });
    expect(updateEventPayload('progress', { percent: Number.NaN })).toEqual({
      type: 'progress',
      percent: 0,
    });
  });

  it('returns null for event types the renderer does not need', () => {
    expect(updateEventPayload('checking-for-update', {})).toBeNull();
    expect(updateEventPayload('error', new Error('x'))).toBeNull();
  });
});

describe('shouldNotifyProgress (IPC throttle)', () => {
  it('notifies every 10 points and at 100, once', () => {
    expect(shouldNotifyProgress(-1, 0)).toBe(true);
    expect(shouldNotifyProgress(0, 5)).toBe(false);
    expect(shouldNotifyProgress(0, 10)).toBe(true);
    expect(shouldNotifyProgress(90, 99)).toBe(false);
    expect(shouldNotifyProgress(90, 100)).toBe(true);
    expect(shouldNotifyProgress(100, 100)).toBe(false);
  });

  it('rejects non-finite percents', () => {
    expect(shouldNotifyProgress(0, Number.NaN)).toBe(false);
    expect(shouldNotifyProgress(0, undefined)).toBe(false);
  });
});

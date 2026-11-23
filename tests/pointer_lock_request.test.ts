import { describe, expect, it, vi } from 'vitest';
import { RawPointerLockRequester } from '../src/game/pointer_lock_request';

function notSupported(): Error {
  const err = new Error('raw input unavailable');
  err.name = 'NotSupportedError';
  return err;
}

// Let the requester's rejection handlers run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RawPointerLockRequester', () => {
  it('asks for raw (unadjusted) movement when raw is allowed', () => {
    const requestPointerLock = vi.fn(() => Promise.resolve());
    const requester = new RawPointerLockRequester(true);

    requester.request({ requestPointerLock }, vi.fn());

    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    expect(requestPointerLock).toHaveBeenCalledWith({ unadjustedMovement: true });
    expect(requester.requestsRaw).toBe(true);
  });

  it('keeps every request plain when raw is not allowed (the Gecko path)', () => {
    const requestPointerLock = vi.fn(() => Promise.resolve());
    const requester = new RawPointerLockRequester(false);

    requester.request({ requestPointerLock }, vi.fn());

    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    expect(requestPointerLock).toHaveBeenCalledWith();
    expect(requester.requestsRaw).toBe(false);
  });

  it('on NotSupportedError, reports it once and goes plain for the rest of the session', async () => {
    const requestPointerLock = vi.fn((options?: { unadjustedMovement?: boolean }) =>
      options?.unadjustedMovement ? Promise.reject(notSupported()) : Promise.resolve(),
    );
    const onRawUnsupported = vi.fn();
    const requester = new RawPointerLockRequester(true);

    requester.request({ requestPointerLock }, onRawUnsupported);
    await flush();

    expect(onRawUnsupported).toHaveBeenCalledTimes(1);
    expect(requester.requestsRaw).toBe(false);
    // The caller's next request (its next mouse move) is the plain fallback.
    requester.request({ requestPointerLock }, onRawUnsupported);
    expect(requestPointerLock).toHaveBeenLastCalledWith();
    await flush();
    expect(onRawUnsupported).toHaveBeenCalledTimes(1);
  });

  it('swallows any other rejection without giving up on raw input', async () => {
    // A denied or superseded request goes through the pointerlockerror path the
    // caller already handles; it says nothing about raw support.
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    const requestPointerLock = vi.fn(() => Promise.reject(denied));
    const onRawUnsupported = vi.fn();
    const requester = new RawPointerLockRequester(true);

    requester.request({ requestPointerLock }, onRawUnsupported);
    await flush();

    expect(onRawUnsupported).not.toHaveBeenCalled();
    expect(requester.requestsRaw).toBe(true);
  });

  it('swallows a rejected plain request so it never surfaces as unhandled', async () => {
    const requestPointerLock = vi.fn(() => Promise.reject(new Error('denied')));
    const requester = new RawPointerLockRequester(false);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      requester.request({ requestPointerLock }, vi.fn());
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('works with an engine that returns nothing (pre-promise pointer lock)', () => {
    const requestPointerLock = vi.fn(() => undefined);
    const requester = new RawPointerLockRequester(true);

    expect(() => requester.request({ requestPointerLock }, vi.fn())).not.toThrow();
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('falls back synchronously, in the same handler, when the raw request throws NotSupported', () => {
    const requestPointerLock = vi.fn((options?: { unadjustedMovement?: boolean }) => {
      if (options?.unadjustedMovement) throw notSupported();
    });
    const onRawUnsupported = vi.fn();
    const requester = new RawPointerLockRequester(true);

    requester.request({ requestPointerLock }, onRawUnsupported);

    expect(requestPointerLock).toHaveBeenCalledTimes(2);
    expect(requestPointerLock).toHaveBeenLastCalledWith();
    expect(requester.requestsRaw).toBe(false);
    // The plain lock was already requested, so the caller must not re-request.
    expect(onRawUnsupported).not.toHaveBeenCalled();
  });

  it('after any other synchronous throw, still locks plain this drag but keeps raw for later', () => {
    const requestPointerLock = vi.fn((options?: { unadjustedMovement?: boolean }) => {
      if (!options?.unadjustedMovement) return;
      const err = new Error('denied');
      err.name = 'NotAllowedError';
      throw err;
    });
    const onRawUnsupported = vi.fn();
    const requester = new RawPointerLockRequester(true);

    expect(() => requester.request({ requestPointerLock }, onRawUnsupported)).not.toThrow();

    expect(requestPointerLock).toHaveBeenCalledTimes(2);
    expect(requestPointerLock).toHaveBeenLastCalledWith();
    expect(requester.requestsRaw).toBe(true);
    expect(onRawUnsupported).not.toHaveBeenCalled();
  });

  it('treats a synchronous TypeError on the options argument as raw unsupported', () => {
    // An engine whose requestPointerLock rejects the options dictionary.
    const requestPointerLock = vi.fn((options?: { unadjustedMovement?: boolean }) => {
      if (options) throw new TypeError('no options accepted');
    });
    const requester = new RawPointerLockRequester(true);

    requester.request({ requestPointerLock }, vi.fn());

    expect(requestPointerLock).toHaveBeenCalledTimes(2);
    expect(requestPointerLock).toHaveBeenLastCalledWith();
    expect(requester.requestsRaw).toBe(false);
  });

  it('toggling the setting never forgets that raw input proved unsupported', async () => {
    const requestPointerLock = vi.fn((options?: { unadjustedMovement?: boolean }) =>
      options?.unadjustedMovement ? Promise.reject(notSupported()) : Promise.resolve(),
    );
    const requester = new RawPointerLockRequester(true);
    requester.request({ requestPointerLock }, vi.fn());
    await flush();

    requester.setRawEnabled(false);
    requester.setRawEnabled(true);

    expect(requester.requestsRaw).toBe(false);
    requester.request({ requestPointerLock }, vi.fn());
    expect(requestPointerLock).toHaveBeenLastCalledWith();
  });

  it('the Raw Mouse Input setting switches requests between raw and plain', () => {
    const requestPointerLock = vi.fn(() => Promise.resolve());
    const requester = new RawPointerLockRequester(true);

    requester.setRawEnabled(false);
    expect(requester.requestsRaw).toBe(false);
    requester.request({ requestPointerLock }, vi.fn());
    expect(requestPointerLock).toHaveBeenLastCalledWith();

    requester.setRawEnabled(true);
    expect(requester.requestsRaw).toBe(true);
    requester.request({ requestPointerLock }, vi.fn());
    expect(requestPointerLock).toHaveBeenLastCalledWith({ unadjustedMovement: true });
  });

  it('turning the setting on never brings raw input to the Gecko path', () => {
    const requestPointerLock = vi.fn(() => Promise.resolve());
    const requester = new RawPointerLockRequester(false);

    requester.setRawEnabled(true);
    requester.request({ requestPointerLock }, vi.fn());
    expect(requestPointerLock).toHaveBeenLastCalledWith();
  });

  it('does nothing when the target has no pointer lock at all', () => {
    const requester = new RawPointerLockRequester(true);
    expect(() => requester.request({}, vi.fn())).not.toThrow();
  });
});

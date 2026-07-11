import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: nativeMocks.addListener,
    getLaunchUrl: nativeMocks.getLaunchUrl,
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    close: nativeMocks.close,
    open: vi.fn(),
  },
}));

import { installNativeDiscordUrlHandler } from '../src/net/native_discord';

const CALLBACK = 'worldofclaudecraft://discord-auth?ok=1&mode=login&code=handoff';

beforeEach(() => {
  nativeMocks.addListener.mockReset();
  nativeMocks.getLaunchUrl.mockReset();
  nativeMocks.close.mockReset();
  nativeMocks.close.mockResolvedValue(undefined);
});

describe('native Discord URL handler', () => {
  it('handles a cold-launch callback and closes the browser first', async () => {
    nativeMocks.addListener.mockResolvedValue({ remove: vi.fn() });
    nativeMocks.getLaunchUrl.mockResolvedValue({ url: CALLBACK });
    const events: string[] = [];

    await installNativeDiscordUrlHandler(async (result) => {
      events.push(`${result.mode}:${result.code}`);
    });

    expect(nativeMocks.close).toHaveBeenCalledOnce();
    expect(events).toEqual(['login:handoff']);
  });

  it('handles a warm callback even when Browser.close is unsupported', async () => {
    let listener: ((event: { url: string }) => void) | undefined;
    nativeMocks.addListener.mockImplementation((_name, callback) => {
      listener = callback;
      return Promise.resolve({ remove: vi.fn() });
    });
    nativeMocks.getLaunchUrl.mockResolvedValue(undefined);
    nativeMocks.close.mockRejectedValue(new Error('unsupported'));
    const onResult = vi.fn();
    await installNativeDiscordUrlHandler(onResult);

    listener?.({ url: CALLBACK });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(onResult.mock.calls[0]?.[0].code).toBe('handoff');
  });

  it('deduplicates the warm event followed by the same launch URL', async () => {
    let listener: ((event: { url: string }) => void) | undefined;
    nativeMocks.addListener.mockImplementation((_name, callback) => {
      listener = callback;
      return Promise.resolve({ remove: vi.fn() });
    });
    nativeMocks.getLaunchUrl.mockResolvedValue({ url: CALLBACK });
    const onResult = vi.fn();
    await installNativeDiscordUrlHandler(onResult);
    listener?.({ url: CALLBACK });
    await Promise.resolve();

    expect(onResult).toHaveBeenCalledOnce();
  });
});

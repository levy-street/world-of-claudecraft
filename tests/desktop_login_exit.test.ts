import { describe, expect, it, vi } from 'vitest';
import { initDesktopLoginExit } from '../src/game/desktop_login_exit';
import type { DesktopBridge, DesktopDisplayMode } from '../src/runtime';

class FakeButton {
  hidden = true;
  readonly listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === 'click') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'click') this.listeners.delete(listener);
  }

  click(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeRoot {
  constructor(readonly button: FakeButton | null) {}

  querySelector(selector: string): FakeButton | null {
    return selector === '#desktop-login-exit' ? this.button : null;
  }
}

const bridge = (overrides: Partial<DesktopBridge> = {}): DesktopBridge =>
  ({
    openBrowserLogin: async () => {},
    takeLoginCode: async () => null,
    onLoginCode: () => () => {},
    getDisplayMode: async () => 'borderless',
    quitApp: async () => true,
    ...overrides,
  }) as DesktopBridge;

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('initDesktopLoginExit', () => {
  it('is a no-op when the button is absent', () => {
    const getDisplayMode = vi.fn(async () => 'borderless' as DesktopDisplayMode);
    const dispose = initDesktopLoginExit(bridge({ getDisplayMode }), new FakeRoot(null));
    expect(getDisplayMode).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it.each(['getDisplayMode', 'quitApp'] as const)(
    'leaves the button hidden when %s is absent',
    async (missing) => {
      const button = new FakeButton();
      const candidate = bridge();
      delete candidate[missing];
      initDesktopLoginExit(candidate, new FakeRoot(button));
      await settle();
      expect(button.hidden).toBe(true);
      expect(button.listeners.size).toBe(0);
    },
  );

  it.each(['getDisplayMode', 'quitApp'] as const)(
    'leaves the button hidden when %s is not callable',
    async (method) => {
      const button = new FakeButton();
      const candidate = bridge();
      Object.assign(candidate, { [method]: true });
      initDesktopLoginExit(candidate, new FakeRoot(button));
      await settle();
      expect(button.hidden).toBe(true);
      expect(button.listeners.size).toBe(0);
    },
  );

  it('reveals the button for borderless mode and installs one click listener', async () => {
    const button = new FakeButton();
    initDesktopLoginExit(bridge(), new FakeRoot(button));
    await settle();
    expect(button.hidden).toBe(false);
    expect(button.listeners.size).toBe(1);
  });

  it.each(['windowed', 'exclusive', '', null])(
    'keeps the button hidden for a %j mode response',
    async (mode) => {
      const button = new FakeButton();
      initDesktopLoginExit(
        bridge({ getDisplayMode: async () => mode as DesktopDisplayMode }),
        new FakeRoot(button),
      );
      await settle();
      expect(button.hidden).toBe(true);
    },
  );

  it('keeps the button hidden when the display-mode read throws or rejects', async () => {
    for (const getDisplayMode of [
      () => {
        throw new Error('sync mode failure');
      },
      () => Promise.reject(new Error('async mode failure')),
    ]) {
      const button = new FakeButton();
      initDesktopLoginExit(
        bridge({ getDisplayMode: getDisplayMode as DesktopBridge['getDisplayMode'] }),
        new FakeRoot(button),
      );
      await settle();
      expect(button.hidden).toBe(true);
    }
  });

  it('calls both bridge methods with the bridge as their receiver', async () => {
    const button = new FakeButton();
    const liveBridge = bridge();
    const getDisplayMode = vi.fn(function (this: DesktopBridge) {
      expect(this).toBe(liveBridge);
      return Promise.resolve('borderless' as const);
    });
    const quitApp = vi.fn(function (this: DesktopBridge) {
      expect(this).toBe(liveBridge);
      return Promise.resolve(true);
    });
    Object.assign(liveBridge, { getDisplayMode, quitApp });
    initDesktopLoginExit(liveBridge, new FakeRoot(button));
    await settle();
    button.click();
    await settle();
    expect(getDisplayMode).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('contains synchronous throws and rejected quit promises', async () => {
    for (const quitApp of [
      () => {
        throw new Error('sync quit failure');
      },
      () => Promise.reject(new Error('async quit failure')),
    ]) {
      const button = new FakeButton();
      initDesktopLoginExit(
        bridge({ quitApp: quitApp as DesktopBridge['quitApp'] }),
        new FakeRoot(button),
      );
      await settle();
      expect(() => button.click()).not.toThrow();
      await settle();
    }
  });

  it('teardown removes the listener and restores the fail-closed hidden state', async () => {
    const button = new FakeButton();
    const quitApp = vi.fn(async () => true);
    const dispose = initDesktopLoginExit(bridge({ quitApp }), new FakeRoot(button));
    await settle();
    dispose();
    expect(button.hidden).toBe(true);
    expect(button.listeners.size).toBe(0);
    button.click();
    expect(quitApp).not.toHaveBeenCalled();
  });

  it('teardown prevents a late display-mode response from revealing the button', async () => {
    let resolveMode!: (mode: DesktopDisplayMode) => void;
    const pendingMode = new Promise<DesktopDisplayMode>((resolve) => {
      resolveMode = resolve;
    });
    const button = new FakeButton();
    const dispose = initDesktopLoginExit(
      bridge({ getDisplayMode: () => pendingMode }),
      new FakeRoot(button),
    );
    dispose();
    resolveMode('borderless');
    await settle();
    expect(button.hidden).toBe(true);
  });
});

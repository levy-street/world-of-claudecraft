import { beforeEach, describe, expect, it, vi } from 'vitest';

// The one-call composition in src/game/desktop_shell_integration.ts is the line
// every desktop nicety hangs off: a piece silently dropped from it ships a
// desktop build where that feature never runs at all (the phase 3 QA audit
// found the GPU-status subscription had no pin here). Mock the bridge and the
// four pieces, and pin composition, the relay-first ordering contract, and the
// no-bridge no-op that keeps the web build untouched.

vi.mock('../src/runtime', () => ({ desktopBridge: vi.fn(() => null) }));
vi.mock('../src/ui/desktop_update_toast', () => ({ initDesktopUpdateToast: vi.fn() }));
vi.mock('../src/game/desktop_error_relay', () => ({ initDesktopErrorRelay: vi.fn() }));
vi.mock('../src/game/desktop_gpu_status', () => ({ initDesktopGpuStatus: vi.fn(() => () => {}) }));
vi.mock('../src/game/desktop_display_change', () => ({
  initDesktopDisplayChange: vi.fn(() => () => {}),
}));
vi.mock('../src/game/desktop_presentation', () => ({
  initDesktopPresentation: vi.fn(() => () => {}),
}));
vi.mock('../src/game/desktop_shell_strings', () => ({ initDesktopShellStrings: vi.fn() }));
vi.mock('../src/game/desktop_notifications', () => ({ initDesktopNotifications: vi.fn() }));
vi.mock('../src/game/discord_presence', () => ({ initDiscordPresence: vi.fn() }));

import { initDesktopDisplayChange } from '../src/game/desktop_display_change';
import { initDesktopErrorRelay } from '../src/game/desktop_error_relay';
import { initDesktopGpuStatus } from '../src/game/desktop_gpu_status';
import { initDesktopNotifications } from '../src/game/desktop_notifications';
import { initDesktopPresentation } from '../src/game/desktop_presentation';
import { initDesktopShellIntegration } from '../src/game/desktop_shell_integration';
import { initDesktopShellStrings } from '../src/game/desktop_shell_strings';
import { initDiscordPresence } from '../src/game/discord_presence';
import { desktopBridge } from '../src/runtime';
import { initDesktopUpdateToast } from '../src/ui/desktop_update_toast';

const bridge = vi.mocked(desktopBridge);
const pieces = [
  initDesktopErrorRelay,
  initDesktopShellStrings,
  initDesktopUpdateToast,
  initDesktopGpuStatus,
  initDesktopDisplayChange,
  initDesktopPresentation,
  initDesktopNotifications,
  initDiscordPresence,
].map((piece) => vi.mocked(piece as (bridge: unknown) => unknown));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initDesktopShellIntegration', () => {
  it('composes every desktop piece exactly once with the live bridge', () => {
    const liveBridge = { onGpuStatus: () => () => {} };
    bridge.mockReturnValue(liveBridge as never);
    initDesktopShellIntegration();
    for (const piece of pieces) {
      expect(piece).toHaveBeenCalledTimes(1);
      expect(piece).toHaveBeenCalledWith(liveBridge);
    }
    // The error relay's listeners must exist before anything else runs.
    const orders = pieces.map((piece) => piece.mock.invocationCallOrder[0]);
    expect(orders[0]).toBe(Math.min(...orders));
    // The notification away-gate reads the presentation latch, so it must
    // compose after the subscription that keeps the latch truthful.
    expect(vi.mocked(initDesktopNotifications).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(initDesktopPresentation).mock.invocationCallOrder[0],
    );
  });

  it('is a total no-op without a bridge (web build, plain browser, older shell)', () => {
    bridge.mockReturnValue(null as never);
    initDesktopShellIntegration();
    for (const piece of pieces) {
      expect(piece).not.toHaveBeenCalled();
    }
  });

  it('disposes the previous composition before re-composing (no stacked subscriptions)', () => {
    // The three subscribing inits return unsubscribe handles; a re-init that
    // discarded them would leave the old closures folding bridge pushes beside
    // the new ones (double GPU latch, double display fold, double presentation
    // latch). The retained handles must fire exactly once, on the NEXT init.
    const liveBridge = { onGpuStatus: () => () => {} };
    bridge.mockReturnValue(liveBridge as never);
    const disposals: string[] = [];
    vi.mocked(initDesktopGpuStatus).mockReturnValue(() => {
      disposals.push('gpu');
    });
    vi.mocked(initDesktopDisplayChange).mockReturnValue(() => {
      disposals.push('display');
    });
    vi.mocked(initDesktopPresentation).mockReturnValue(() => {
      disposals.push('presentation');
    });
    initDesktopShellIntegration();
    expect(disposals).toEqual([]);
    initDesktopShellIntegration();
    // Exactly the first composition's three handles, disposed exactly once,
    // and every piece composed once per init (one live subscription each).
    expect(disposals).toEqual(['gpu', 'display', 'presentation']);
    for (const piece of pieces) {
      expect(piece).toHaveBeenCalledTimes(2);
    }
  });
});

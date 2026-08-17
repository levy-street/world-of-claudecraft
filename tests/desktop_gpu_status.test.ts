// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopGpuStatus } from '../src/runtime';

// The desktop shell's GPU verdict crosses two module boundaries and can land on
// either side of the notice's init, so this suite drives the REAL toast (no DOM
// mocks) through both race orders, plus the payload validation, the latch, the
// feature check that keeps web and older shells untouched, and the persisted
// dismissal round trip the pure view cannot cover.

const KEY = 'woc_gpu_notice_dismissed';
const DISCRETE: DesktopGpuStatus = {
  softwareRendering: false,
  discreteInactive: true,
  adapter: 'Intel UHD Graphics 770',
};

// Each boot is a fresh module registry (module state is per page session) with a
// fresh document, while localStorage persists, exactly the per-install shape.
async function boot(options: { withGpuStatus?: boolean } = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  const toast = await import('../src/ui/gpu_notice_toast');
  const status = await import('../src/game/desktop_gpu_status');
  const shell: { push: ((status: DesktopGpuStatus) => void) | null; unsubscribes: number } = {
    push: null,
    unsubscribes: 0,
  };
  const bridge = (options.withGpuStatus === false
    ? {}
    : {
        onGpuStatus: (callback: (status: DesktopGpuStatus) => void) => {
          shell.push = callback;
          return () => {
            shell.unsubscribes += 1;
          };
        },
      }) as unknown as DesktopBridge;
  const unsubscribe = status.initDesktopGpuStatus(bridge);
  const push = (raw: unknown): void => {
    if (!shell.push) throw new Error('the bridge never received a subscription');
    shell.push(raw as DesktopGpuStatus);
  };
  return { toast, status, shell, bridge, unsubscribe, push };
}

const noticeRoot = (): HTMLElement | null => document.getElementById('gpu-notice');
const noticeText = (): string =>
  document.querySelector('#gpu-notice .gpu-notice-message')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('normalizeDesktopGpuStatus', () => {
  it('accepts a well-formed payload and defaults a missing adapter string', async () => {
    const { status } = await boot();
    expect(status.normalizeDesktopGpuStatus(DISCRETE)).toEqual(DISCRETE);
    expect(
      status.normalizeDesktopGpuStatus({ softwareRendering: true, discreteInactive: false }),
    ).toEqual({ softwareRendering: true, discreteInactive: false, adapter: '' });
  });

  it('re-applies the 64-char adapter cap against an out-of-contract shell', async () => {
    const { status } = await boot();
    const normalized = status.normalizeDesktopGpuStatus({
      softwareRendering: false,
      discreteInactive: true,
      adapter: 'a'.repeat(65),
    });
    expect(normalized?.adapter).toBe('a'.repeat(64));
    expect(normalized?.adapter.length).toBe(64);
  });

  it('strips any field outside the three-key whitelist, whatever the shell sends', async () => {
    // The shell is an independently updated binary: a future or compromised
    // build must not smuggle extra diagnostics through the normalizer.
    const { status } = await boot();
    const normalized = status.normalizeDesktopGpuStatus({
      softwareRendering: true,
      discreteInactive: false,
      adapter: 'WARP',
      glVendor: 'smuggled',
      devices: [{ vendorId: 32902 }],
    });
    expect(normalized).toEqual({
      softwareRendering: true,
      discreteInactive: false,
      adapter: 'WARP',
    });
    // The exact key set IS the whitelist: pin it literally so a pass-through
    // rewrite (returning the raw payload) can never sneak extras across.
    expect(Object.keys(normalized as object).sort()).toEqual([
      'adapter',
      'discreteInactive',
      'softwareRendering',
    ]);
  });

  it('drops anything without both booleans rather than coercing a false verdict', async () => {
    const { status } = await boot();
    expect(status.normalizeDesktopGpuStatus(null)).toBeNull();
    expect(status.normalizeDesktopGpuStatus('software')).toBeNull();
    expect(status.normalizeDesktopGpuStatus({ softwareRendering: true })).toBeNull();
    expect(status.normalizeDesktopGpuStatus({ discreteInactive: true })).toBeNull();
    expect(
      status.normalizeDesktopGpuStatus({ softwareRendering: 'yes', discreteInactive: true }),
    ).toBeNull();
  });
});

describe('mergeShellGpuVerdict', () => {
  it('takes software rendering from either source and the discrete verdict only from the shell', async () => {
    const { status } = await boot();
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: true,
        localHybridGpuLikely: false,
        shell: null,
      }),
    ).toEqual({
      softwareRendering: true,
      discreteInactive: false,
      hybridGpuLikely: false,
    });
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: false,
        localHybridGpuLikely: false,
        shell: DISCRETE,
      }),
    ).toEqual({
      softwareRendering: false,
      discreteInactive: true,
      hybridGpuLikely: false,
    });
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: false,
        localHybridGpuLikely: false,
        shell: { softwareRendering: true, discreteInactive: false, adapter: 'SwiftShader' },
      }),
    ).toEqual({ softwareRendering: true, discreteInactive: false, hybridGpuLikely: false });
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: false,
        localHybridGpuLikely: false,
        shell: null,
      }),
    ).toEqual({
      softwareRendering: false,
      discreteInactive: false,
      hybridGpuLikely: false,
    });
  });

  it('takes the hybrid verdict only from the page, whatever the shell says', async () => {
    // hybrid_gpu_detect classifies the page's adapter string and is
    // structurally false inside the shell; the shell payload has no hybrid
    // field to contribute, so the local flag must pass through unchanged.
    const { status } = await boot();
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: false,
        localHybridGpuLikely: true,
        shell: null,
      }),
    ).toEqual({ softwareRendering: false, discreteInactive: false, hybridGpuLikely: true });
    expect(
      status.mergeShellGpuVerdict({
        localSoftwareRendering: false,
        localHybridGpuLikely: true,
        shell: DISCRETE,
      }),
    ).toEqual({ softwareRendering: false, discreteInactive: true, hybridGpuLikely: true });
  });
});

describe('initDesktopGpuStatus', () => {
  it('is a no-op on a bridge without onGpuStatus (older shell, or the web build)', async () => {
    const { status, toast, unsubscribe } = await boot({ withGpuStatus: false });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(status.latchedDesktopGpuStatus()).toBeNull();
    // Nothing was forwarded, so a hardware session still shows no notice at all.
    expect(
      toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: false,
        desktopPlatform: 'other',
      }),
    ).toBe(false);
    expect(noticeRoot()).toBeNull();
  });

  it('latches the last valid verdict and ignores a malformed push', async () => {
    const { status, push } = await boot();
    expect(status.latchedDesktopGpuStatus()).toBeNull();
    push(DISCRETE);
    expect(status.latchedDesktopGpuStatus()).toEqual(DISCRETE);
    push({ softwareRendering: 'nope' });
    expect(status.latchedDesktopGpuStatus()).toEqual(DISCRETE);
    push({ softwareRendering: true, discreteInactive: true, adapter: 'WARP' });
    expect(status.latchedDesktopGpuStatus()).toEqual({
      softwareRendering: true,
      discreteInactive: true,
      adapter: 'WARP',
    });
  });

  it('returns the shell unsubscribe hook', async () => {
    const { shell, unsubscribe } = await boot();
    unsubscribe();
    expect(shell.unsubscribes).toBe(1);
  });
});

describe('the shell verdict / notice init race', () => {
  it('shows the notice when the verdict arrives BEFORE the notice inits', async () => {
    const { toast, push } = await boot();
    push(DISCRETE);
    expect(noticeRoot()).toBeNull();
    expect(
      toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(true);
    expect(noticeRoot()?.hidden).toBe(false);
    expect(noticeText()).toContain('dedicated (gaming) GPU');
    expect(toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: false,
      discreteInactive: true,
      hybridGpuLikely: false,
    });
  });

  it('builds the notice lazily when the verdict arrives AFTER the notice inits', async () => {
    const { toast, push } = await boot();
    expect(
      toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(false);
    expect(noticeRoot()).toBeNull();
    expect(toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: false,
      discreteInactive: false,
      hybridGpuLikely: false,
    });

    push(DISCRETE);
    const root = noticeRoot();
    expect(root).not.toBeNull();
    expect(root?.hidden).toBe(false);
    expect(root?.getAttribute('role')).toBe('status');
    expect(root?.getAttribute('aria-live')).toBe('polite');
    expect(noticeText()).toContain('dedicated (gaming) GPU');
    expect(toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: false,
      discreteInactive: true,
      hybridGpuLikely: false,
    });
  });

  it('leaves a hardware session alone when the shell reports a healthy GPU', async () => {
    const { toast, push } = await boot();
    expect(
      toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(false);
    push({ softwareRendering: false, discreteInactive: false, adapter: 'NVIDIA RTX 5090' });
    expect(noticeRoot()).toBeNull();
    expect(toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: false,
      discreteInactive: false,
      hybridGpuLikely: false,
    });
  });
});

describe('the persisted dismissal across shell verdicts', () => {
  it('stores the verdict signature, never re-nags for it, and re-arms on a new component', async () => {
    const first = await boot();
    first.push(DISCRETE);
    expect(
      first.toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(true);
    (document.querySelector('.gpu-notice-dismiss') as HTMLButtonElement).click();
    expect(noticeRoot()?.hidden).toBe(true);
    // The storage key and the stored signature are the load-bearing literals.
    expect(localStorage.getItem(KEY)).toBe('discrete-inactive');

    // Same machine, next launch: same verdict, still quiet.
    const second = await boot();
    second.push(DISCRETE);
    expect(
      second.toast.initGpuNotice({
        softwareRendering: false,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(false);
    expect(noticeRoot()).toBeNull();
    // The quiet re-boot told the player nothing: the display latch must stay
    // empty so an unread notice never suppresses the perf nudge (ruling R16).
    expect(second.toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: false,
      discreteInactive: false,
      hybridGpuLikely: false,
    });

    // The session degrades further (software rendering too): that component was
    // never dismissed, so the notice re-arms with the more severe copy.
    second.push({ softwareRendering: true, discreteInactive: true, adapter: 'WARP' });
    expect(noticeRoot()?.hidden).toBe(false);
    expect(noticeText()).toContain('without GPU acceleration');
    expect(second.toast.gpuNoticeDisplayed()).toEqual({
      softwareRendering: true,
      discreteInactive: true,
      hybridGpuLikely: false,
    });
  });

  it('keeps the legacy dismissal honored for software while showing the new shell verdict', async () => {
    localStorage.setItem(KEY, '1');
    const { toast, push } = await boot();
    expect(
      toast.initGpuNotice({
        softwareRendering: true,
        desktopShell: true,
        desktopPlatform: 'other',
      }),
    ).toBe(false);
    expect(noticeRoot()).toBeNull();
    push(DISCRETE);
    expect(noticeRoot()?.hidden).toBe(false);
    // Software still wins the body copy, but the notice only came back because
    // the inactive dedicated GPU was never dismissed.
    expect(noticeText()).toContain('without GPU acceleration');
    expect(localStorage.getItem(KEY)).toBe('1');
    (document.querySelector('.gpu-notice-dismiss') as HTMLButtonElement).click();
    expect(localStorage.getItem(KEY)).toBe('discrete-inactive,software');
  });
});

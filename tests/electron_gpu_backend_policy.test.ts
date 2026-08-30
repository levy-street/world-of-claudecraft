// The GPU backend policy (electron/gpu_backend_policy.cjs): which machines Auto
// may try Vulkan on at all, from /sys/class/drm, and how the ladder's launch
// decision honors the cap. The ladder only sees the failures it can observe; a
// driver that renders wrong without dying (the Steam Deck report) is caught here
// or nowhere.

import { describe, expect, it } from 'vitest';
import { decideGpuBackendLaunch, TOP_GPU_BACKEND_RUNG } from '../electron/gpu_backend.cjs';
import {
  AUTO_VULKAN_EXCLUSIONS,
  autoBackendCeiling,
  autoVulkanExclusion,
  linuxGpuAdapters,
  PCI_VENDOR_AMD,
  PCI_VENDOR_NVIDIA,
  renderingAdapters,
} from '../electron/gpu_backend_policy.cjs';
import { PRIME_RELAUNCH_MARKER } from '../electron/gpu_preference.cjs';

type Card = { vendor?: string; device?: string; bootVga?: string };

/** A fake /sys/class/drm: card directories with their PCI id files. */
function sysfs(cards: Record<string, Card>) {
  const readdir = (dir: string) => {
    if (dir !== '/sys/class/drm') throw new Error('ENOENT');
    // Real listings carry connectors and render nodes beside the cards.
    return [...Object.keys(cards), 'card0-DP-1', 'renderD128', 'version'];
  };
  const readFile = (path: string) => {
    const m = /^\/sys\/class\/drm\/(card\d+)\/device\/(vendor|device|boot_vga)$/.exec(path);
    if (!m) throw new Error('ENOENT');
    const card = cards[m[1]];
    const value =
      m[2] === 'vendor' ? card?.vendor : m[2] === 'device' ? card?.device : card?.bootVga;
    if (value === undefined) throw new Error('ENOENT');
    return `${value}\n`;
  };
  return { readdir, readFile };
}

// The Steam Deck's APU (Van Gogh), as sysfs prints it.
const DECK = { card0: { vendor: '0x1002', device: '0x163f', bootVga: '1' } };
const RTX_3090 = { card0: { vendor: '0x10de', device: '0x2204', bootVga: '1' } };
// An AMD APU driving the screen next to an NVIDIA laptop card.
const HYBRID = {
  card0: { vendor: '0x1002', device: '0x1681', bootVga: '1' },
  card1: { vendor: '0x10de', device: '0x28e0', bootVga: '0' },
};
// An Intel iGPU driving the screen next to an AMD laptop card: under the PRIME
// offload (DRI_PRIME=1) the AMD card renders.
const HYBRID_AMD_DGPU = {
  card0: { vendor: '0x8086', device: '0x7d55', bootVga: '1' },
  card1: { vendor: '0x1002', device: '0x7480', bootVga: '0' },
};

const VERSION = '0.41.0';
const linuxLaunch = (
  prefs: Parameters<typeof decideGpuBackendLaunch>[0]['prefs'],
  autoCeiling: ReturnType<typeof autoBackendCeiling>,
  env: Record<string, string | undefined> = {},
) => decideGpuBackendLaunch({ platform: 'linux', env, prefs, appVersion: VERSION, autoCeiling });

describe('the exclusion list (load-bearing literals)', () => {
  it('keeps AMD off Auto Vulkan, vendor-wide, with its reason and what lifts it', () => {
    expect(PCI_VENDOR_AMD).toBe('0x1002');
    expect(PCI_VENDOR_NVIDIA).toBe('0x10de');
    const amd = AUTO_VULKAN_EXCLUSIONS.find((entry) => entry.vendor === PCI_VENDOR_AMD);
    expect(amd).toBeDefined();
    // Vendor-wide: no device id, so every AMD card is opt-in, not just the Deck.
    expect(amd?.device).toBeUndefined();
    expect(amd?.reason).toMatch(/Steam Deck/);
    expect(amd?.until).toMatch(/measured/);
    // Every entry is a decision with its evidence, never a bare vendor.
    for (const entry of AUTO_VULKAN_EXCLUSIONS) {
      expect(entry.vendor).toMatch(/^0x[0-9a-f]{4}$/);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.until.length).toBeGreaterThan(0);
    }
  });
});

describe('linuxGpuAdapters', () => {
  it('reads each card device with a PCI vendor, normalized, and skips the rest', () => {
    const { readdir, readFile } = sysfs({
      card0: { vendor: '0x10DE', device: '0x2204', bootVga: '1' },
      card1: { vendor: '0x8086', device: '0x7d67' },
      // A platform device: no PCI ids at all.
      card2: {},
    });
    expect(linuxGpuAdapters(readdir, readFile)).toEqual([
      { card: 'card0', vendor: '0x10de', device: '0x2204', bootVga: true },
      { card: 'card1', vendor: '0x8086', device: '0x7d67', bootVga: false },
    ]);
  });

  it('answers nothing on an unreadable /sys', () => {
    const readdir = () => {
      throw new Error('ENOENT');
    };
    expect(linuxGpuAdapters(readdir, sysfs({}).readFile)).toEqual([]);
  });
});

describe('renderingAdapters', () => {
  const all = linuxGpuAdapters(sysfs(HYBRID).readdir, sysfs(HYBRID).readFile);

  it('judges the card that drives the screen when sysfs names one', () => {
    expect(renderingAdapters(all).map((a) => a.vendor)).toEqual([PCI_VENDOR_AMD]);
  });

  it('judges the card that does not drive the screen under the PRIME offload, whatever its vendor', () => {
    expect(renderingAdapters(all, { [PRIME_RELAUNCH_MARKER]: '1' }).map((a) => a.vendor)).toEqual([
      PCI_VENDOR_NVIDIA,
    ]);
    const amdDgpu = linuxGpuAdapters(
      sysfs(HYBRID_AMD_DGPU).readdir,
      sysfs(HYBRID_AMD_DGPU).readFile,
    );
    expect(
      renderingAdapters(amdDgpu, { [PRIME_RELAUNCH_MARKER]: '1' }).map((a) => a.vendor),
    ).toEqual([PCI_VENDOR_AMD]);
  });

  it('falls back to the screen card when the marker is set on a single-card machine', () => {
    const amdOnly = all.filter((a) => a.vendor === PCI_VENDOR_AMD);
    expect(renderingAdapters(amdOnly, { [PRIME_RELAUNCH_MARKER]: '1' })).toEqual(amdOnly);
  });

  it('judges every adapter when nothing says which one renders', () => {
    const noBootVga = all.map((a) => ({ ...a, bootVga: false }));
    expect(renderingAdapters(noBootVga)).toEqual(noBootVga);
    expect(renderingAdapters([])).toEqual([]);
  });
});

describe('autoVulkanExclusion', () => {
  const amd = { card: 'card0', vendor: '0x1002', device: '0x163f', bootVga: true };
  const nvidia = { card: 'card0', vendor: '0x10de', device: '0x2204', bootVga: true };

  it('matches a vendor-wide entry on any device of that vendor', () => {
    const hit = autoVulkanExclusion([nvidia, amd]);
    expect(hit?.adapter).toBe(amd);
    expect(hit?.exclusion.vendor).toBe(PCI_VENDOR_AMD);
    expect(autoVulkanExclusion([nvidia])).toBeNull();
  });

  it('matches a device-scoped entry on that device only', () => {
    const deckOnly = [{ vendor: '0x1002', device: '0x163f', reason: 'deck', until: 'later' }];
    expect(autoVulkanExclusion([amd], deckOnly)?.adapter).toBe(amd);
    expect(autoVulkanExclusion([{ ...amd, device: '0x1681' }], deckOnly)).toBeNull();
  });
});

describe('autoBackendCeiling', () => {
  it('caps Auto at OpenGL on the Steam Deck, naming the card and the reason', () => {
    const ceiling = autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(DECK) });
    expect(ceiling?.rung).toBe('opengl');
    expect(ceiling?.why).toContain('0x1002:0x163f excluded');
    expect(ceiling?.why).toContain('Steam Deck');
  });

  it('leaves an NVIDIA machine free to climb', () => {
    expect(autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(RTX_3090) })).toBeNull();
  });

  it('on a hybrid machine, caps exactly when the AMD card is the one rendering', () => {
    const prime = { [PRIME_RELAUNCH_MARKER]: '1' };
    // AMD APU on the screen, NVIDIA offload: capped without the offload, free under it.
    expect(autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(HYBRID) })?.rung).toBe(
      'opengl',
    );
    expect(autoBackendCeiling({ platform: 'linux', env: prime, ...sysfs(HYBRID) })).toBeNull();
    // Intel on the screen, AMD offload: the other way round.
    expect(
      autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(HYBRID_AMD_DGPU) }),
    ).toBeNull();
    expect(
      autoBackendCeiling({ platform: 'linux', env: prime, ...sysfs(HYBRID_AMD_DGPU) })?.why,
    ).toContain('0x1002:0x7480 excluded');
  });

  it('names the vendor alone when the card has no readable device id, and takes an injected list', () => {
    const noDevice = { card0: { vendor: '0x1002', bootVga: '1' } };
    expect(autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(noDevice) })?.why).toMatch(
      /^0x1002 excluded: /,
    );
    const intelOnly = [{ vendor: '0x8086', reason: 'test', until: 'test' }];
    expect(
      autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(DECK), exclusions: intelOnly }),
    ).toBeNull();
    expect(
      autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(RTX_3090), exclusions: intelOnly }),
    ).toBeNull();
    expect(
      autoBackendCeiling({
        platform: 'linux',
        env: {},
        adapters: [{ card: 'card0', vendor: '0x8086', device: '0x7d55', bootVga: true }],
        exclusions: intelOnly,
      })?.why,
    ).toBe('0x8086:0x7d55 excluded: test');
  });

  it('is no ceiling off Linux, and none on an unreadable /sys', () => {
    expect(autoBackendCeiling({ platform: 'win32', env: {}, ...sysfs(DECK) })).toBeNull();
    expect(autoBackendCeiling({ platform: 'darwin', env: {}, ...sysfs(DECK) })).toBeNull();
    const readdir = () => {
      throw new Error('EACCES');
    };
    expect(autoBackendCeiling({ platform: 'linux', env: {}, readdir })).toBeNull();
  });
});

describe('decideGpuBackendLaunch under a ceiling', () => {
  const capped = autoBackendCeiling({ platform: 'linux', env: {}, ...sysfs(DECK) });

  it('runs a fresh Auto launch on OpenGL, capped, outside the memory', () => {
    const launch = linuxLaunch({ gpuBackend: 'auto' }, capped);
    expect(launch.rung).toBe('opengl');
    expect(launch.backend).toBe('default');
    expect(launch.capped).toBe(true);
    // Not the memory's: nothing is remembered from it, the counter does not move.
    expect(launch.auto).toBe(false);
    // The rescue still applies.
    expect(launch.ladder).toBe(true);
    expect(launch.reason).toBe(`auto, capped at opengl: ${capped?.why}`);
  });

  it('caps a remembered or proven Vulkan rung the same way', () => {
    const remembered = linuxLaunch(
      {
        gpuBackend: 'auto',
        gpuBackendToAttempt: 'vulkan-plain',
        gpuBackendProof: { backend: 'vulkan-plain', appVersion: VERSION, gpuAdapter: '' },
      },
      capped,
    );
    expect(remembered.rung).toBe('opengl');
    expect(remembered.capped).toBe(true);
  });

  it('leaves an explicit choice alone: the setting and the env both reach Vulkan', () => {
    const setting = linuxLaunch({ gpuBackend: 'vulkan' }, capped);
    expect(setting.rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(setting.capped).toBe(false);
    const env = linuxLaunch({ gpuBackend: 'auto' }, capped, { WOC_GPU_BACKEND: 'vulkan' });
    expect(env.rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(env.capped).toBe(false);
  });

  it('leaves a rescued child on the rung its parent chose', () => {
    const rescued = linuxLaunch({ gpuBackend: 'auto' }, capped, {
      WOC_GPU_BACKEND_RESCUED_TO: 'vulkan-plain',
    });
    expect(rescued.rung).toBe('vulkan-plain');
    expect(rescued.rescued).toBe(true);
    expect(rescued.capped).toBe(false);
  });

  it('caps a memory already AT the ceiling too, so the row can say why', () => {
    // A demotion from before the policy: still a machine the policy holds there,
    // and outside the memory from now on (nothing counted, nothing rewritten).
    const alreadyThere = linuxLaunch(
      { gpuBackend: 'auto', gpuBackendToAttempt: 'opengl', launchesSinceBackendReprobe: 0 },
      capped,
    );
    expect(alreadyThere.rung).toBe('opengl');
    expect(alreadyThere.auto).toBe(false);
    expect(alreadyThere.capped).toBe(true);
  });

  it('changes nothing without a ceiling, or when the memory sits below it', () => {
    const free = linuxLaunch({ gpuBackend: 'auto' }, null);
    expect(free.rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(free.auto).toBe(true);
    expect(free.capped).toBe(false);
    // A ceiling at plain Vulkan over a memory that says OpenGL: the memory's own
    // verdict is the lower one and stands.
    const below = linuxLaunch(
      { gpuBackend: 'auto', gpuBackendToAttempt: 'opengl', launchesSinceBackendReprobe: 0 },
      { rung: 'vulkan-plain', why: 'test' },
    );
    expect(below.rung).toBe('opengl');
    expect(below.auto).toBe(true);
    expect(below.capped).toBe(false);
  });

  it('is not a Linux concern elsewhere', () => {
    const win = decideGpuBackendLaunch({
      platform: 'win32',
      env: {},
      prefs: { gpuBackend: 'auto' },
      appVersion: VERSION,
      autoCeiling: capped,
    });
    expect(win.ladder).toBe(false);
    expect(win.capped).toBe(false);
  });
});

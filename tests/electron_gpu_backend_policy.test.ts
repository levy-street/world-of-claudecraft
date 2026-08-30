// The GPU backend policy (electron/gpu_backend_policy.cjs): what a given GPU
// needs from Vulkan (switches every Vulkan launch on that card carries) and
// whether Auto may try Vulkan there, from /sys/class/drm, and how the ladder's
// launch decision honors the cap. The ladder only sees the failures it can
// observe; a driver that renders wrong without dying (the Steam Deck report)
// is caught here or nowhere.

import { describe, expect, it } from 'vitest';
import { decideGpuBackendLaunch, TOP_GPU_BACKEND_RUNG } from '../electron/gpu_backend.cjs';
import {
  DISABLE_DRM_FORMAT_MODIFIER_SWITCH,
  GPU_BACKEND_POLICY,
  gpuBackendPolicy,
  gpuPolicyEntry,
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

const WORKAROUND = [['disable-angle-features', 'supportsImageDrmFormatModifier']];
const linux = (cards: Record<string, Card>, env: Record<string, string> = {}) =>
  gpuBackendPolicy({ platform: 'linux', env, ...sysfs(cards) });

const VERSION = '0.41.0';
const linuxLaunch = (
  prefs: Parameters<typeof decideGpuBackendLaunch>[0]['prefs'],
  autoCeiling: ReturnType<typeof gpuBackendPolicy>['autoCeiling'],
  env: Record<string, string | undefined> = {},
) => decideGpuBackendLaunch({ platform: 'linux', env, prefs, appVersion: VERSION, autoCeiling });

describe('the policy entries (load-bearing literals)', () => {
  it('gives every AMD card the DRM-format-modifier workaround on Vulkan, with no Auto ceiling', () => {
    expect(PCI_VENDOR_AMD).toBe('0x1002');
    expect(PCI_VENDOR_NVIDIA).toBe('0x10de');
    expect(DISABLE_DRM_FORMAT_MODIFIER_SWITCH).toEqual([
      'disable-angle-features',
      'supportsImageDrmFormatModifier',
    ]);
    const amd = GPU_BACKEND_POLICY.find((entry) => entry.vendor === PCI_VENDOR_AMD);
    expect(amd).toBeDefined();
    // Vendor-wide: the import bug is the RADV path, not one APU (the maintainer's call).
    expect(amd?.device).toBeUndefined();
    expect(amd?.vulkanSwitches).toEqual(WORKAROUND);
    // Auto climbs on AMD like anywhere else: with the workaround, Vulkan measured
    // ahead of OpenGL on the Deck.
    expect(amd?.autoCeiling).toBeUndefined();
    expect(amd?.reason).toMatch(/Steam Deck/);
    expect(amd?.until).toMatch(/measured/);
    // Every entry is a decision with its evidence, never a bare vendor.
    for (const entry of GPU_BACKEND_POLICY) {
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

describe('gpuPolicyEntry', () => {
  const amd = { card: 'card0', vendor: '0x1002', device: '0x163f', bootVga: true };
  const nvidia = { card: 'card0', vendor: '0x10de', device: '0x2204', bootVga: true };

  it('matches a vendor-wide entry on any device of that vendor', () => {
    const hit = gpuPolicyEntry([nvidia, amd]);
    expect(hit?.adapter).toBe(amd);
    expect(hit?.entry.vendor).toBe(PCI_VENDOR_AMD);
    expect(gpuPolicyEntry([nvidia])).toBeNull();
  });

  it('lets a device-scoped entry win over its vendor, whatever the list order', () => {
    const vendorWide = { vendor: '0x1002', reason: 'vendor', until: 'later' };
    const deckOnly = { vendor: '0x1002', device: '0x163f', reason: 'deck', until: 'later' };
    expect(gpuPolicyEntry([amd], [vendorWide, deckOnly])?.entry).toBe(deckOnly);
    expect(gpuPolicyEntry([amd], [deckOnly, vendorWide])?.entry).toBe(deckOnly);
    // Another AMD card: the vendor entry, never the Deck's.
    expect(gpuPolicyEntry([{ ...amd, device: '0x1681' }], [deckOnly, vendorWide])?.entry).toBe(
      vendorWide,
    );
    expect(gpuPolicyEntry([{ ...amd, device: '0x1681' }], [deckOnly])).toBeNull();
  });
});

describe('gpuBackendPolicy', () => {
  it('gives the Steam Deck the workaround, Auto free to climb, and names the card', () => {
    const policy = linux(DECK);
    expect(policy.vulkanSwitches).toEqual(WORKAROUND);
    expect(policy.autoCeiling).toBeNull();
    expect(policy.why).toMatch(/^0x1002:0x163f: /);
    expect(policy.why).toContain('Steam Deck');
  });

  it('asks nothing of an NVIDIA machine', () => {
    expect(linux(RTX_3090)).toEqual({ vulkanSwitches: [], autoCeiling: null, why: '' });
  });

  it('on a hybrid machine, follows the card that is rendering', () => {
    const prime = { [PRIME_RELAUNCH_MARKER]: '1' };
    // AMD APU on the screen, NVIDIA offload: the workaround without the offload only.
    expect(linux(HYBRID).vulkanSwitches).toEqual(WORKAROUND);
    expect(linux(HYBRID, prime).vulkanSwitches).toEqual([]);
    // Intel on the screen, AMD offload: the other way round.
    expect(linux(HYBRID_AMD_DGPU).vulkanSwitches).toEqual([]);
    expect(linux(HYBRID_AMD_DGPU, prime).why).toMatch(/^0x1002:0x7480: /);
  });

  it("reads an entry's ceiling as the Auto cap, with the same why", () => {
    const held = [
      {
        vendor: '0x8086',
        autoCeiling: 'opengl' as const,
        vulkanSwitches: [],
        reason: 'test',
        until: 'test',
      },
    ];
    const intel = { card0: { vendor: '0x8086', bootVga: '1' } };
    const policy = gpuBackendPolicy({ platform: 'linux', env: {}, ...sysfs(intel), entries: held });
    // No readable device id: the vendor alone names the card.
    expect(policy.autoCeiling).toEqual({ rung: 'opengl', why: '0x8086: test' });
    expect(policy.why).toBe('0x8086: test');
    expect(policy.vulkanSwitches).toEqual([]);
  });

  it('copies the switches, so a caller cannot edit the entry through them', () => {
    const policy = linux(DECK);
    policy.vulkanSwitches.push(['x', 'y']);
    expect(linux(DECK).vulkanSwitches).toEqual(WORKAROUND);
  });

  it('asks nothing off Linux, and nothing on an unreadable /sys', () => {
    const none = { vulkanSwitches: [], autoCeiling: null, why: '' };
    expect(gpuBackendPolicy({ platform: 'win32', env: {}, ...sysfs(DECK) })).toEqual(none);
    expect(gpuBackendPolicy({ platform: 'darwin', env: {}, ...sysfs(DECK) })).toEqual(none);
    const readdir = () => {
      throw new Error('EACCES');
    };
    expect(gpuBackendPolicy({ platform: 'linux', env: {}, readdir })).toEqual(none);
  });
});

describe('decideGpuBackendLaunch under a ceiling', () => {
  const capped = { rung: 'opengl' as const, why: '0x1002:0x163f: held for the test' };

  it('runs a fresh Auto launch on OpenGL, capped, outside the memory', () => {
    const launch = linuxLaunch({ gpuBackend: 'auto' }, capped);
    expect(launch.rung).toBe('opengl');
    expect(launch.backend).toBe('default');
    expect(launch.capped).toBe(true);
    // Not the memory's: nothing is remembered from it, the counter does not move.
    expect(launch.auto).toBe(false);
    // The rescue still applies.
    expect(launch.ladder).toBe(true);
    expect(launch.reason).toBe(`auto, capped at opengl: ${capped.why}`);
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

'use strict';

// What a given GPU needs from the Vulkan backend, and whether Auto may try it there. The
// ladder in electron/gpu_backend.cjs answers "what happens when Vulkan dies"; this module
// answers the questions before it, from evidence the shell has before Electron starts:
// "does this card need a workaround to run Vulkan at all" and "should Auto even attempt
// Vulkan here".
//
// Why it exists: the ladder's verdict only knows the failures it can observe (the GPU
// process dying, a software rasterizer, a backend that did not bind). A driver that
// renders WRONG without dying is invisible to it: the session runs, counts as healthy,
// and Auto remembers the rung. That is what a Steam Deck reported (AMD APU, Mesa RADV):
// the game came up on Vulkan and every texture was noise. The cause, found on the Deck:
// ANGLE could not import Chromium's tiled AMD buffer through a DRM format modifier
// (VK_ERROR_INVALID_DRM_FORMAT_MODIFIER_PLANE_LAYOUT_EXT), so the compositor read the
// buffer with the wrong layout. Disabling that ANGLE import path
// (`--disable-angle-features=supportsImageDrmFormatModifier`) fixed the picture and kept
// the fast path: on the Deck, Vulkan with the workaround beat OpenGL (51.7 against 49.7
// fps, a recent p95 of 22 against 33 ms, no frame over 50 ms against three).
//
// So an entry names a card (a PCI vendor, optionally one device) and what Vulkan needs
// there: `vulkanSwitches`, appended to EVERY Vulkan launch on that card (Auto, the
// setting, WOC_GPU_BACKEND: the switches follow the hardware, never the mode, so a player
// who picks Vulkan on an AMD card gets the workaround too), and optionally `autoCeiling`,
// the rung Auto is held at while the card is unmeasured. AMD ships with the workaround
// and NO ceiling (the maintainer's call: the import bug is the RADV path, not one APU,
// and a Vulkan choice without the workaround would have no fix at all). The most specific
// entry wins, so one device can carry its own answer beside its vendor's.
//
// The evidence is /sys/class/drm, read synchronously at the top of main (the same source
// and the same reason as the PRIME hybrid check in electron/gpu_preference.cjs:
// app.getGPUInfo needs the app ready, far too late to shape the command line). Pure
// functions with injected readers, exercised by tests/electron_gpu_backend_policy.test.ts.

const { readdirSync: nodeReaddirSync, readFileSync: nodeReadFileSync } = require('node:fs');
const { PRIME_RELAUNCH_MARKER } = require('./gpu_preference.cjs');

/** PCI vendor ids as sysfs prints them (lowercase, `0x` prefixed). */
const PCI_VENDOR_AMD = '0x1002';
const PCI_VENDOR_NVIDIA = '0x10de';

/**
 * ANGLE's DRM-format-modifier image import, which fails on Chromium's tiled AMD buffers
 * under RADV and leaves the compositor reading them with the wrong layout. Off, ANGLE
 * imports the buffer the plain way; the Vulkan compositor and its zero-copy handoff stay.
 */
const DISABLE_DRM_FORMAT_MODIFIER_SWITCH = [
  'disable-angle-features',
  'supportsImageDrmFormatModifier',
];

/**
 * The policy entries. Each names a vendor, optionally one device id (the most specific
 * entry wins), what Vulkan needs on that card (`vulkanSwitches`, [name, value] pairs),
 * optionally the rung Auto is held at (`autoCeiling`, a ladder rung; absent means Auto
 * climbs as anywhere else), the reason, and what would lift the entry, so the list reads
 * as open questions rather than a graveyard.
 *
 * An entry is a decision with its evidence, never a guess: add one when a machine has
 * been seen to render wrong or die on Vulkan in a way the ladder cannot catch; narrow or
 * remove it when the backend has been measured healthy without it on that hardware.
 */
const GPU_BACKEND_POLICY = Object.freeze([
  Object.freeze({
    vendor: PCI_VENDOR_AMD,
    vulkanSwitches: Object.freeze([DISABLE_DRM_FORMAT_MODIFIER_SWITCH]),
    reason:
      'AMD (Mesa RADV): ANGLE cannot import the tiled AMD buffer through a DRM format modifier, the compositor then draws it as noise (Steam Deck, 2026-08-30); with the import path off, Vulkan measured ahead of OpenGL there',
    until:
      'ANGLE or RADV imports the tiled buffer correctly, measured on AMD hardware without the switch',
  }),
]);

const CARD_NAME = /^card\d+$/;

/** A sysfs id file (`vendor`, `device`, `boot_vga`) as a trimmed lowercase string, or ''. */
function readIdFile(readFile, card, name) {
  try {
    return String(readFile(`/sys/class/drm/${card}/device/${name}`, 'utf8'))
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The GPUs this machine exposes, from /sys/class/drm: `{ card, vendor, device, bootVga }`
 * per card device with a PCI vendor id (a virtual or platform device has none and is
 * skipped). `bootVga` is true on the card the firmware brought the screen up on. Empty
 * when /sys is unreadable (an exotic sandbox): no evidence, and the caller decides what
 * no evidence means.
 */
function linuxGpuAdapters(readdir = nodeReaddirSync, readFile = nodeReadFileSync) {
  let cards;
  try {
    cards = readdir('/sys/class/drm').filter((name) => CARD_NAME.test(String(name)));
  } catch {
    return [];
  }
  const adapters = [];
  for (const card of cards.sort()) {
    const vendor = readIdFile(readFile, card, 'vendor');
    if (!/^0x[0-9a-f]{4}$/.test(vendor)) continue;
    const device = readIdFile(readFile, card, 'device');
    adapters.push({
      card,
      vendor,
      device: /^0x[0-9a-f]{4}$/.test(device) ? device : '',
      bootVga: readIdFile(readFile, card, 'boot_vga') === '1',
    });
  }
  return adapters;
}

/**
 * The adapters the policy must judge: the one that will actually render, when that can
 * be told, otherwise all of them.
 *
 * Under the PRIME offload (this process is the relaunched child, marker set) Chromium
 * renders on the card that does NOT drive the screen: that is what DRI_PRIME=1 and the
 * NVIDIA offload variables select, whichever vendor it is (an NVIDIA card beside an AMD
 * APU, or an AMD card beside an Intel iGPU). Without the offload the card that drives the
 * screen renders, when sysfs names one. When neither can be told, every adapter is
 * judged, so an entry matching any card on the machine applies: the cost of being wrong
 * that way is a switch the driver ignores or a slower backend, the cost of being wrong
 * the other way is a game that renders noise. Known limit: an offload the driver silently
 * ignored (the NVIDIA variables on a machine without the NVIDIA driver) leaves the display
 * card rendering while the offload card is judged.
 */
function renderingAdapters(adapters, env = {}) {
  const list = Array.isArray(adapters) ? adapters : [];
  const display = list.filter((a) => a.bootVga === true);
  if (env[PRIME_RELAUNCH_MARKER] === '1') {
    const offload = list.filter((a) => a.bootVga !== true);
    if (offload.length > 0 && display.length > 0) return offload;
  }
  return display.length > 0 ? display : list;
}

/**
 * The entry that applies to `adapters`, as `{ adapter, entry }`, or null. The most
 * specific match wins: a device-scoped entry over its vendor's, whatever the list order;
 * across adapters, the first adapter with a match.
 */
function gpuPolicyEntry(adapters, entries = GPU_BACKEND_POLICY) {
  for (const adapter of Array.isArray(adapters) ? adapters : []) {
    let best = null;
    for (const entry of entries) {
      if (adapter?.vendor !== entry.vendor) continue;
      if (typeof entry.device === 'string') {
        if (adapter.device !== entry.device) continue;
        return { adapter, entry };
      }
      best = best ?? { adapter, entry };
    }
    if (best) return best;
  }
  return null;
}

/**
 * What this machine's GPU asks of the backend lever:
 * - `vulkanSwitches`: appended to every Vulkan launch here (empty when nothing is);
 * - `autoCeiling`: `{ rung, why }` when Auto is held at a rung, else null;
 * - `why`: the applied entry's card and reason, for the launch log; '' when none.
 * Off Linux there is no backend choice, so nothing applies. `env` is where the PRIME
 * marker is read from; `readdir` / `readFile` are the sysfs readers, injectable.
 */
function gpuBackendPolicy({ platform, env, readdir, readFile, adapters, entries } = {}) {
  const none = { vulkanSwitches: [], autoCeiling: null, why: '' };
  if (platform !== 'linux') return none;
  const list = adapters ?? linuxGpuAdapters(readdir, readFile);
  const hit = gpuPolicyEntry(renderingAdapters(list, env ?? {}), entries);
  if (!hit) return none;
  const id = hit.adapter.device
    ? `${hit.adapter.vendor}:${hit.adapter.device}`
    : hit.adapter.vendor;
  const why = `${id}: ${hit.entry.reason}`;
  const ceilingRung = hit.entry.autoCeiling;
  return {
    vulkanSwitches: [...(hit.entry.vulkanSwitches ?? [])],
    autoCeiling: typeof ceilingRung === 'string' ? { rung: ceilingRung, why } : null,
    why,
  };
}

module.exports = {
  DISABLE_DRM_FORMAT_MODIFIER_SWITCH,
  GPU_BACKEND_POLICY,
  PCI_VENDOR_AMD,
  PCI_VENDOR_NVIDIA,
  gpuBackendPolicy,
  gpuPolicyEntry,
  linuxGpuAdapters,
  renderingAdapters,
};

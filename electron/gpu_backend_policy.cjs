'use strict';

// Which machines Auto may TRY Vulkan on. The ladder in electron/gpu_backend.cjs answers
// "what happens when Vulkan dies"; this module answers the question before it, "should
// Auto even attempt Vulkan here", from evidence the shell has before Electron starts.
//
// Why it exists: the ladder's verdict only knows the failures it can observe (the GPU
// process dying, a software rasterizer, a backend that did not bind). A driver that
// renders WRONG without dying is invisible to it: the session runs, counts as healthy,
// and Auto remembers the rung. That is what a Steam Deck reported (AMD APU, Mesa RADV,
// ANGLE Vulkan): the game came up and every texture was noise. Vulkan was only ever
// measured on NVIDIA and Intel, so on the vendors it was not measured on, Auto stays on
// OpenGL and Vulkan is the player's explicit choice (the setting, or WOC_GPU_BACKEND).
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
 * The exclusion list: adapters Auto never tries Vulkan on. Each entry names a vendor,
 * optionally one device id (to exclude a single card rather than a vendor), and the
 * reason, which is what the launch log line prints. The `until` line says what would
 * lift it, so the list is a set of open questions rather than a graveyard.
 *
 * An entry is a decision with its evidence, never a guess: add one when a machine has
 * been seen to render wrong or die on Vulkan in a way the ladder cannot catch; remove it
 * when the backend has been measured healthy on that hardware.
 */
const AUTO_VULKAN_EXCLUSIONS = Object.freeze([
  Object.freeze({
    vendor: PCI_VENDOR_AMD,
    reason: 'AMD (Mesa RADV) renders corrupted textures on ANGLE Vulkan (Steam Deck, 2026-08-30)',
    until: 'Vulkan is measured healthy on AMD hardware; until then it is opt-in there',
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
 * judged, so an excluded card anywhere on the machine keeps Auto off Vulkan: the cost of
 * being wrong that way is a slower backend, the cost of being wrong the other way is a
 * game that renders noise. Known limit: an offload the driver silently ignored (the
 * NVIDIA variables on a machine without the NVIDIA driver) leaves the display card
 * rendering while the offload card is judged.
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

/** The first exclusion one of `adapters` matches, as `{ adapter, exclusion }`, or null. */
function autoVulkanExclusion(adapters, exclusions = AUTO_VULKAN_EXCLUSIONS) {
  for (const adapter of Array.isArray(adapters) ? adapters : []) {
    for (const exclusion of exclusions) {
      if (adapter?.vendor !== exclusion.vendor) continue;
      if (typeof exclusion.device === 'string' && adapter.device !== exclusion.device) continue;
      return { adapter, exclusion };
    }
  }
  return null;
}

/**
 * What Auto may attempt on this machine: `{ rung: 'opengl', why }` when one of the
 * rendering adapters is excluded, `null` when Auto is free to climb. Only Auto reads
 * this: an explicit setting or WOC_GPU_BACKEND=vulkan is the player's decision, and the
 * whole point of the exclusion list is that Vulkan stays reachable by choice.
 *
 * Off Linux there is no backend choice, so no ceiling. `env` is where the PRIME marker
 * is read from; `readdir` / `readFile` are the sysfs readers, injectable for tests.
 */
function autoBackendCeiling({ platform, env, readdir, readFile, adapters, exclusions } = {}) {
  if (platform !== 'linux') return null;
  const list = adapters ?? linuxGpuAdapters(readdir, readFile);
  const hit = autoVulkanExclusion(renderingAdapters(list, env ?? {}), exclusions);
  if (!hit) return null;
  const id = hit.adapter.device
    ? `${hit.adapter.vendor}:${hit.adapter.device}`
    : hit.adapter.vendor;
  return { rung: 'opengl', why: `${id} excluded: ${hit.exclusion.reason}` };
}

module.exports = {
  AUTO_VULKAN_EXCLUSIONS,
  PCI_VENDOR_AMD,
  PCI_VENDOR_NVIDIA,
  autoBackendCeiling,
  autoVulkanExclusion,
  linuxGpuAdapters,
  renderingAdapters,
};

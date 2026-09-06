// Type declarations for the GPU backend policy (electron/gpu_backend_policy.cjs): what a
// given GPU needs from the Vulkan backend, and whether Auto may try it there. main.cjs
// runs outside tsc; these types serve tests/electron_gpu_backend_policy.test.ts.

import type { GpuBackendRung } from './gpu_backend.cjs';

export const PCI_VENDOR_AMD: string;
export const PCI_VENDOR_NVIDIA: string;
/** `--disable-angle-features=supportsImageDrmFormatModifier`, as a [name, value] pair. */
export const DISABLE_DRM_FORMAT_MODIFIER_SWITCH: readonly [string, string];

/** What a card asks of the lever: a vendor, optionally one device, the switches every
 *  Vulkan launch there carries, optionally the rung Auto is held at, and why. */
export interface GpuBackendPolicyEntry {
  vendor: string;
  device?: string;
  vulkanSwitches?: ReadonlyArray<readonly [string, string]>;
  autoCeiling?: GpuBackendRung;
  reason: string;
  until: string;
}
export const GPU_BACKEND_POLICY: readonly GpuBackendPolicyEntry[];

/** A GPU as /sys/class/drm lists it: lowercase `0x` ids, '' for a missing device id. */
export interface LinuxGpuAdapter {
  card: string;
  vendor: string;
  device: string;
  bootVga: boolean;
}

export type SysfsReaddir = (dir: string) => readonly string[];
export type SysfsReadFile = (path: string, encoding: string) => string | Buffer;

export function linuxGpuAdapters(
  readdir?: SysfsReaddir,
  readFile?: SysfsReadFile,
): LinuxGpuAdapter[];

export function renderingAdapters(
  adapters: readonly LinuxGpuAdapter[],
  env?: Record<string, string | undefined>,
): LinuxGpuAdapter[];

export function gpuPolicyEntry(
  adapters: readonly LinuxGpuAdapter[],
  entries?: readonly GpuBackendPolicyEntry[],
): { adapter: LinuxGpuAdapter; entry: GpuBackendPolicyEntry } | null;

/** The policy's cap on an Auto launch. */
export interface AutoBackendCeiling {
  rung: GpuBackendRung;
  why: string;
}

/** What this machine's GPU asks of the lever. */
export interface GpuBackendPolicyVerdict {
  vulkanSwitches: Array<readonly [string, string]>;
  autoCeiling: AutoBackendCeiling | null;
  why: string;
}

export function gpuBackendPolicy(input?: {
  platform?: string;
  env?: Record<string, string | undefined>;
  readdir?: SysfsReaddir;
  readFile?: SysfsReadFile;
  adapters?: readonly LinuxGpuAdapter[];
  entries?: readonly GpuBackendPolicyEntry[];
}): GpuBackendPolicyVerdict;

// Type declarations for the GPU backend policy (electron/gpu_backend_policy.cjs): which
// machines Auto may try Vulkan on. main.cjs runs outside tsc; these types serve
// tests/electron_gpu_backend_policy.test.ts.

import type { GpuBackendRung } from './gpu_backend.cjs';

export const PCI_VENDOR_AMD: string;
export const PCI_VENDOR_NVIDIA: string;

/** An adapter Auto never tries Vulkan on: a vendor, optionally one device, and why. */
export interface AutoVulkanExclusion {
  vendor: string;
  device?: string;
  reason: string;
  until: string;
}
export const AUTO_VULKAN_EXCLUSIONS: readonly AutoVulkanExclusion[];

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

export function autoVulkanExclusion(
  adapters: readonly LinuxGpuAdapter[],
  exclusions?: readonly AutoVulkanExclusion[],
): { adapter: LinuxGpuAdapter; exclusion: AutoVulkanExclusion } | null;

/** The policy's cap on an Auto launch, or null when Auto is free to climb. */
export interface AutoBackendCeiling {
  rung: GpuBackendRung;
  why: string;
}

export function autoBackendCeiling(input?: {
  platform?: string;
  env?: Record<string, string | undefined>;
  readdir?: SysfsReaddir;
  readFile?: SysfsReadFile;
  adapters?: readonly LinuxGpuAdapter[];
  exclusions?: readonly AutoVulkanExclusion[];
}): AutoBackendCeiling | null;

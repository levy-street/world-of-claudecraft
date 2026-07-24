import { classifyGpuRenderer, isWeakIntegratedGpu } from '../render/gfx';
import { isSoftwareRendererName } from '../render/software_renderer';

export type PerfSuggestionSeverity = 'info' | 'warning' | 'critical';

// The complete suggestion-id catalog, in the analyzer's emit-priority order.
// These ids are the CLIENT-COMPUTED fleet dimension (packet 0 ruling R14): the
// perf reporter sends them on the beacon and the server validates against its
// own deliberate copy (KNOWN_PERF_SUGGESTION_IDS in server/perf_report.ts;
// server/ cannot import src/game, and tests/perf_suggestion_id_parity.test.ts
// pins the two catalogs equal).
export const PERF_SUGGESTION_IDS = [
  'hardware-acceleration',
  'integrated-gpu',
  'high-dpi',
  'forced-high-graphics',
  'low-memory',
  'browser-stalls',
  'heap-pressure',
  'context-loss',
] as const;

export type PerfSuggestionId = (typeof PERF_SUGGESTION_IDS)[number];

export interface PerfSuggestion {
  id: PerfSuggestionId;
  severity: PerfSuggestionSeverity;
  title: string;
  body: string;
  action?: { label: string; href: string };
}

export interface PerfDoctorSnapshot {
  frameMs: { p95: number; long50: number };
  windows: { last10s: { frames: number; fps: number; frameMs: { p95: number; long50: number } } };
  renderer: {
    tier: string;
    pixelRatio: number;
    glRenderer: string;
    contextLost: number;
    contextRestored: number;
  } | null;
  browser: {
    longTasks: { count: number; p95: number; max: number };
    memory: { usedMB: number; limitMB: number } | null;
  };
  device: {
    dpr: number;
    deviceMemory: number | null;
    hardwareConcurrency: number;
    maxTouchPoints: number;
  };
}

function hasForcedHighGraphics(search: string): boolean {
  const params = new URLSearchParams(search);
  const gfx = params.get('gfx');
  return gfx === 'high' || gfx === 'ultra';
}

function lowGraphicsHref(search: string): string {
  const params = new URLSearchParams(search);
  params.set('gfx', 'low');
  const qs = params.toString();
  const path = typeof location !== 'undefined' ? location.pathname : '/';
  const hash = typeof location !== 'undefined' ? location.hash : '';
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

function isBadFrameWindow(s: PerfDoctorSnapshot): boolean {
  const w = s.windows.last10s;
  return w.frames !== 0 && (w.fps < 45 || w.frameMs.p95 >= 28 || w.frameMs.long50 >= 3);
}

/**
 * An adapter name that classifies as an INTEGRATED part via gfx.ts's GPU
 * classification (ruling R15): the named mid-integrated families (Iris Xe,
 * integrated Radeons, desktop UHD 7xx) plus the weak-integrated Intel list.
 * The generic weak arm is deliberately excluded: it also matches old MOBILE
 * SoCs (Adreno 3xx, Mali-T), where "switch to the gaming GPU" is nonsense.
 */
function isIntegratedGpuName(name: string): boolean {
  return classifyGpuRenderer(name) === 'midIntegrated' || isWeakIntegratedGpu(name);
}

// This module used to be a dev-only diagnostics LIBRARY with no live importer;
// since packet 0 phase 05 it has two: perf_reporter.ts computes the suggestion
// ids for the fleet beacon (ruling R14) and perf_nudge.ts drives the player
// nudge toast from them (ruling R16). Only the IDS ride those consumers; the
// title/body strings stay English dev diagnostics by design (the toast renders
// its own t() keys, see src/ui/perf_nudge_view.ts), so they never go through t().
export function analyzePerfSuggestions(
  s: PerfDoctorSnapshot,
  search = typeof location !== 'undefined' ? location.search : '',
  env: { desktopShell: boolean } = { desktopShell: false },
): PerfSuggestion[] {
  const out: PerfSuggestion[] = [];
  const badFrames = isBadFrameWindow(s);
  const renderer = s.renderer;

  if (renderer && isSoftwareRendererName(renderer.glRenderer)) {
    out.push({
      id: 'hardware-acceleration',
      severity: 'critical',
      title: 'Software rendering (no real GPU)',
      body: 'The game is not running on a real GPU. Update your graphics drivers. On Windows, set the game to High performance under Settings > System > Display > Graphics; in a browser, enable hardware acceleration and restart it.',
    });
  } else if (
    badFrames &&
    renderer &&
    isIntegratedGpuName(renderer.glRenderer) &&
    !env.desktopShell
  ) {
    // Hybrid-GPU laptops (brainstorm finding 16): the browser binds the
    // integrated GPU even when a discrete one exists. Mutually exclusive with
    // 'hardware-acceleration' (software classification wins, ruling R15), and
    // never inside the desktop shell, which already forces the dGPU (PR #1991).
    // Copy is conditional on purpose: the adapter string cannot prove a
    // discrete GPU exists, only that the session is NOT on one.
    out.push({
      id: 'integrated-gpu',
      severity: 'warning',
      title: 'Running on the integrated (power-saving) GPU',
      body: 'This session is rendering on an integrated GPU. If this computer also has a gaming GPU, the browser is not using it: on Windows, set your browser to High performance under Settings > System > Display > Graphics and restart it. The desktop app picks the gaming GPU automatically.',
    });
  }

  if (badFrames && renderer && s.device.dpr >= 2 && renderer.pixelRatio >= 1.7) {
    out.push({
      id: 'high-dpi',
      severity: 'warning',
      title: 'High-DPI rendering is expensive here',
      body: 'This screen is rendering a lot of pixels. Lower graphics quality if movement or camera turns feel choppy.',
      action: { label: 'Use Low graphics', href: lowGraphicsHref(search) },
    });
  }

  if (badFrames && hasForcedHighGraphics(search)) {
    out.push({
      id: 'forced-high-graphics',
      severity: 'warning',
      title: 'Forced high graphics is hurting performance',
      body: 'This session is overriding automatic graphics detection. Switch back to Auto or Low for smoother laptop play.',
      action: { label: 'Use Low graphics', href: lowGraphicsHref(search) },
    });
  }

  if (badFrames && s.device.deviceMemory !== null && s.device.deviceMemory <= 4) {
    out.push({
      id: 'low-memory',
      severity: 'warning',
      title: 'Low memory device detected',
      body: 'Close extra tabs and apps before playing. Browser games share memory with the operating system and extensions.',
      action: { label: 'Use Low graphics', href: lowGraphicsHref(search) },
    });
  }

  const longTasks = s.browser.longTasks;
  if (badFrames && longTasks.count >= 3 && (longTasks.p95 >= 80 || longTasks.max >= 150)) {
    out.push({
      id: 'browser-stalls',
      severity: 'warning',
      title: 'Browser or extension stalls detected',
      body: 'Something outside the game is blocking the browser main thread. Try disabling extensions or ad blockers for this site.',
    });
  }

  const memory = s.browser.memory;
  if (badFrames && memory && memory.limitMB > 0 && memory.usedMB / memory.limitMB >= 0.75) {
    out.push({
      id: 'heap-pressure',
      severity: 'warning',
      title: 'Browser memory pressure detected',
      body: 'Reloading the game or closing other tabs may reduce stutters during long sessions.',
    });
  }

  if (renderer && (renderer.contextLost > 0 || renderer.contextRestored > 0)) {
    out.push({
      id: 'context-loss',
      severity: 'critical',
      title: 'Graphics context reset detected',
      body: 'The browser reset the game graphics context. Lower graphics quality and update your browser or GPU drivers if this repeats.',
      action: { label: 'Use Low graphics', href: lowGraphicsHref(search) },
    });
  }

  return out.slice(0, 3);
}

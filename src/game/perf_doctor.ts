import { isSoftwareRendererName } from '../render/software_renderer';

export type PerfSuggestionSeverity = 'info' | 'warning' | 'critical';

export interface PerfSuggestion {
  id: string;
  severity: PerfSuggestionSeverity;
  title: string;
  body: string;
  action?: { label: string; href: string };
}

interface PerfDoctorSnapshot {
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

// This module is currently a dev-only diagnostics LIBRARY with no live importer (only its test
// drives it), so its suggestion strings stay English by design rather than going through t().
export function analyzePerfSuggestions(
  s: PerfDoctorSnapshot,
  search = typeof location !== 'undefined' ? location.search : '',
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

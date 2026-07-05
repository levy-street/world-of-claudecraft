// Injectable metrics sampler for the performance overlay.
//
// Lifted out of main.ts so the per-tick assembly of a MetricsSample is a pure
// function of its injected sources (renderer stats, frame meter, online client,
// world entity count, echo/jitter) plus a few environment probes. main.ts shrinks
// to wiring; this is unit-testable with fakes (offline => network rows null,
// missing performance.memory => null, etc.). It owns no state — createMetricsSampler
// returns a sample() closure.

import type { MetricsSample } from './perf_overlay_model';

/** The renderer fields the overlay surfaces (a narrow view of renderer.perfStats). */
export interface SamplerRenderer {
  perfStats(): {
    calls: number | null;
    triangles: number | null;
    geometries: number | null;
    textures: number | null;
    programs: number | null;
    effectiveRenderScale?: number | null;
    glRenderer?: string | null;
  };
}

/** The frame-meter readers the sampler needs (satisfied by FrameMeter). */
export interface SamplerMeter {
  fps(): number;
  frameTimeMs(): number;
  lowFps(pct: number): number | null;
  graphSamples(): number[];
  hitches(): number;
}

/** The online-client fields used for the network rows. Null when offline. */
export interface SamplerOnline {
  connected: boolean;
  /** ms between server snapshots; <=0 means unknown (snapshot row hidden). */
  snapInterval: number;
}

export interface SamplerDeps {
  renderer: SamplerRenderer;
  meter: SamplerMeter;
  /** The online client, or null when running the offline browser world. */
  getOnline: () => SamplerOnline | null;
  getEntityCount: () => number;
  /** Smoothed input-echo RTT (ms); <=0 means not yet measured (ping/jitter hidden). */
  getEchoMs: () => number;
  getJitterMs: () => number;
  /** Player-input edges in the trailing 60 s. */
  getApm: () => number;
  // Environment probes — injectable so tests need no browser globals. Each
  // defaults to the real browser source, returning null where unsupported.
  readMemory?: () => { usedMb: number; limitMb: number | null } | null;
  readConnectionType?: () => string | null;
  isBackgrounded?: () => boolean;
}

function defaultReadMemory(): { usedMb: number; limitMb: number | null } | null {
  if (typeof performance === 'undefined') return null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return null;
  return { usedMb: mem.usedJSHeapSize / 1048576, limitMb: mem.jsHeapSizeLimit / 1048576 };
}

function defaultReadConnectionType(): string | null {
  if (typeof navigator === 'undefined') return null;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  return typeof conn?.effectiveType === 'string' ? conn.effectiveType : null;
}

function defaultIsBackgrounded(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/** Build a sample() that gathers the raw, nullable signals the overlay surfaces.
 *  Renderer/browser fields reflect the last rendered frame (fine at the overlay's
 *  ~4 Hz repaint); network fields are online-only and null offline; unsupported
 *  sources (heap, connection) report null so their rows simply hide. */
export function createMetricsSampler(deps: SamplerDeps): () => MetricsSample {
  const readMemory = deps.readMemory ?? defaultReadMemory;
  const readConnectionType = deps.readConnectionType ?? defaultReadConnectionType;
  const isBackgrounded = deps.isBackgrounded ?? defaultIsBackgrounded;

  return (): MetricsSample => {
    const r = deps.renderer.perfStats();
    const online = deps.getOnline();
    const isOnline = online != null;
    const echo = deps.getEchoMs();
    const mem = readMemory();
    return {
      fps: deps.meter.fps(),
      frameTimeMs: deps.meter.frameTimeMs(),
      fps1Low: deps.meter.lowFps(1),
      fps01Low: deps.meter.lowFps(0.1),
      frameSamples: deps.meter.graphSamples(),
      online: isOnline,
      connected: isOnline ? online.connected : true,
      pingMs: isOnline && echo > 0 ? echo : null,
      jitterMs: isOnline && echo > 0 ? deps.getJitterMs() : null,
      snapshotHz: isOnline && online.snapInterval > 0 ? 1000 / online.snapInterval : null,
      connectionType: readConnectionType(),
      drawCalls: r.calls,
      triangles: r.triangles,
      geometries: r.geometries,
      textures: r.textures,
      programs: r.programs,
      renderScale: typeof r.effectiveRenderScale === 'number' ? r.effectiveRenderScale : null,
      gpu: r.glRenderer || null,
      memoryUsedMb: mem ? mem.usedMb : null,
      memoryLimitMb: mem ? mem.limitMb : null,
      hitches: deps.meter.hitches(),
      entities: deps.getEntityCount(),
      apm: deps.getApm(),
      backgrounded: isBackgrounded(),
    };
  };
}

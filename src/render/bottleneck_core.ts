// Fuses the client's existing perf signals into one bottleneck verdict, the
// pure core. Consumers: the ?perf dev overlay (a one-line diagnosis) and the
// perf beacon (a stable token the fleet aggregates can group by), so a slow
// Windows session tells us WHICH resource it starved on instead of just "27
// fps". Signals come from surfaces that already exist: the frame ring and
// main-thread buckets (src/game/perf.ts), the renderer phase spans and
// program counters (renderer.perfStats()), the GPU timer when the extension
// exists (gpu_timer_core.ts), and the governor's external-frame-cap
// classification (render_budget.ts).
//
// Verdict order is deliberate. Compile stalls trump everything: a session
// paying mid-play shader links hitches regardless of raw throughput, and on
// ANGLE/D3D11 those links are the dominant Windows complaint (#2571, #2243).
// The cap check follows so a healthy vsync-limited session never reads as
// bound. Only then do the throughput verdicts run.

export type BottleneckVerdict =
  | 'compile-stalls'
  | 'vsync-capped'
  | 'balanced'
  | 'gpu-bound'
  | 'render-cpu-bound'
  | 'cpu-main-bound'
  | 'unknown';

export type BottleneckConfidence = 'high' | 'medium' | 'low';

export interface BottleneckSignals {
  /** Wall frame time p95 over the window (ms). */
  frameP95Ms: number;
  /** The budget one frame gets at the session's target rate (ms). */
  targetFrameMs: number;
  /** GPU whole-frame p95 from the timer extension; null when unsupported. */
  gpuFrameP95Ms: number | null;
  /** CPU wall p95 of the renderer submit phase (driver-side sync shows here). */
  submitP95Ms: number;
  /** CPU wall p95 of the whole renderer.sync span. */
  rendererCpuP95Ms: number;
  /** Average per-frame ms of the non-renderer main buckets (sim, hud, events). */
  mainOtherAvgMs: number;
  /** Long task p95 (ms) from the PerformanceObserver window. */
  longTaskP95Ms: number;
  /** GL programs linked inside the window, after prewarm settled. */
  programDelta: number;
  /** The render-budget governor's external frame cap (vsync) classification. */
  externalFrameCap: boolean;
  /** Live render scale after governor backoff (below 1 = already shedding). */
  effectiveRenderScale: number;
}

export interface BottleneckReading {
  verdict: BottleneckVerdict;
  confidence: BottleneckConfidence;
  /** Dev-channel English (perf overlay carve-out), never player-facing UI. */
  detail: string;
}

// Tunables, exported so the verdict matrix in tests pins them explicitly.
export const COMPILE_STALL_PROGRAM_DELTA = 6;
export const COMPILE_STALL_LONG_TASK_MS = 50;
export const MEETING_TARGET_RATIO = 1.15;
export const GPU_DOMINANT_RATIO = 0.8;
export const GPU_MINOR_RATIO = 0.55;
export const SUBMIT_DOMINANT_RATIO = 0.5;
export const RENDER_VS_MAIN_RATIO = 1.5;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function classifyBottleneck(s: BottleneckSignals): BottleneckReading {
  const hasFrames = s.frameP95Ms > 0 && s.targetFrameMs > 0;
  if (!hasFrames) {
    return { verdict: 'unknown', confidence: 'low', detail: 'no frame window yet' };
  }

  // 1. Mid-play shader links. Program growth plus long tasks in the same
  // window is the storm signature regardless of average throughput.
  if (
    s.programDelta >= COMPILE_STALL_PROGRAM_DELTA &&
    s.longTaskP95Ms >= COMPILE_STALL_LONG_TASK_MS
  ) {
    return {
      verdict: 'compile-stalls',
      confidence: 'high',
      detail: `${s.programDelta} programs linked mid-window, long task p95 ${round(s.longTaskP95Ms)}ms`,
    };
  }

  // 2. A steady external cap (vsync or an OS/driver frame limiter) with the
  // renderer in headroom is not a bottleneck; calling it one would send a
  // healthy session to the top of a fleet triage query.
  if (s.externalFrameCap) {
    return {
      verdict: 'vsync-capped',
      confidence: 'medium',
      detail: `cadence ${round(s.frameP95Ms)}ms classified as an external frame cap`,
    };
  }

  // 3. Meeting target: nothing to attribute.
  if (s.frameP95Ms <= s.targetFrameMs * MEETING_TARGET_RATIO) {
    return {
      verdict: 'balanced',
      confidence: 'high',
      detail: `frame p95 ${round(s.frameP95Ms)}ms within target ${round(s.targetFrameMs)}ms`,
    };
  }

  // 4. Slow, with a real GPU clock: attribute by share of the wall frame.
  if (s.gpuFrameP95Ms !== null && s.gpuFrameP95Ms > 0) {
    const gpuShare = s.gpuFrameP95Ms / s.frameP95Ms;
    if (gpuShare >= GPU_DOMINANT_RATIO) {
      const shedding = s.effectiveRenderScale < 1 ? ', governor already shedding resolution' : '';
      return {
        verdict: 'gpu-bound',
        confidence: 'high',
        detail: `gpu p95 ${round(s.gpuFrameP95Ms)}ms of ${round(s.frameP95Ms)}ms frame${shedding}`,
      };
    }
    if (gpuShare < GPU_MINOR_RATIO) {
      if (s.rendererCpuP95Ms >= s.mainOtherAvgMs * RENDER_VS_MAIN_RATIO) {
        return {
          verdict: 'render-cpu-bound',
          confidence: 'high',
          detail: `renderer cpu p95 ${round(s.rendererCpuP95Ms)}ms dominates, gpu only ${round(s.gpuFrameP95Ms)}ms`,
        };
      }
      return {
        verdict: 'cpu-main-bound',
        confidence: 'high',
        detail: `main thread outside renderer ${round(s.mainOtherAvgMs)}ms/frame, gpu only ${round(s.gpuFrameP95Ms)}ms`,
      };
    }
    return {
      verdict: 'balanced',
      confidence: 'medium',
      detail: `gpu ${round(s.gpuFrameP95Ms)}ms and cpu share the ${round(s.frameP95Ms)}ms frame`,
    };
  }

  // 5. Slow, no GPU timer (Firefox, Safari, older drivers): infer from the
  // submit span. A submit-dominated frame usually means the driver made the
  // CPU wait for the GPU queue, but it is an inference, not a measurement.
  if (
    s.submitP95Ms >= s.rendererCpuP95Ms * SUBMIT_DOMINANT_RATIO &&
    s.submitP95Ms > s.mainOtherAvgMs
  ) {
    return {
      verdict: 'gpu-bound',
      confidence: 'low',
      detail: `inferred from submit p95 ${round(s.submitP95Ms)}ms, no GPU timer on this context`,
    };
  }
  if (s.mainOtherAvgMs > s.rendererCpuP95Ms) {
    return {
      verdict: 'cpu-main-bound',
      confidence: 'medium',
      detail: `main thread outside renderer ${round(s.mainOtherAvgMs)}ms/frame dominates`,
    };
  }
  return {
    verdict: 'render-cpu-bound',
    confidence: 'medium',
    detail: `renderer cpu p95 ${round(s.rendererCpuP95Ms)}ms leads without a GPU timer to confirm`,
  };
}

/** The allowlisted beacon tokens (server clamps against this exact set). */
export const BOTTLENECK_VERDICTS: readonly BottleneckVerdict[] = [
  'compile-stalls',
  'vsync-capped',
  'balanced',
  'gpu-bound',
  'render-cpu-bound',
  'cpu-main-bound',
  'unknown',
];

// Adapter-name software-renderer detection: the SINGLE source of truth for
// deciding whether a WebGL adapter string names a software rasterizer (no real
// GPU), consumed by gfx.ts (classifyGpuRenderer + isSoftwareGL), perf_doctor.ts,
// and perf_reporter.ts, and guarded so the detectors never drift apart again.
//
// Why this exists: Chromium 141 removed the automatic SwiftShader WebGL fallback.
// On Windows the software fallback is now the D3D11 WARP rasterizer, whose
// unmasked renderer string looks like
//   "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)"
// The older detectors matched only /swiftshader|llvmpipe|software/ and silently
// missed WARP, so a WARP machine (a real-world no-GPU laptop or locked-down VM)
// looked like a normal GPU to isSoftwareGL / perf_doctor / the perf telemetry
// bucket while classifyGpuRenderer alone had already learned the WARP tokens.
// Sharing one pattern here keeps all of them in lockstep.
//
// NOTE: electron/shell_guards.cjs has its OWN isSoftwareRenderer that matches
// Chromium GPU-feature-status strings ("software only", "disabled"), a different
// domain (feature status, not adapter names). It is intentionally NOT a consumer.

/**
 * The adapter-name tokens that mark a software rasterizer, case-insensitive. Kept
 * EXACTLY in step with the software arm of classifyGpuRenderer in gfx.ts: a bare
 * "warp" token is deliberately omitted (it is a substring of real adapter names),
 * so WARP is caught via its "Microsoft Basic Render" / "microsoft basic" tokens.
 */
export const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|basic render|softpipe|microsoft basic|software/i;

/** True when a WebGL adapter (unmasked renderer) string names a software rasterizer. */
export function isSoftwareRendererName(name: string | undefined | null): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return false;
  return SOFTWARE_RENDERER_PATTERN.test(trimmed);
}

/** The WEBGL_lose_context extension shape we use to release a probe context. */
interface LoseContextExtension {
  loseContext(): void;
}

/** The minimal WebGL context surface the probe touches (getExtension only). */
interface ProbeGlContext {
  getExtension(name: string): unknown;
}

/**
 * The minimal canvas surface the probe needs: just getContext with the
 * failIfMajorPerformanceCaveat attribute. Deliberately NOT the DOM lib
 * HTMLCanvasElement type, so this module stays importable in Node and a unit test
 * can inject a plain stub object.
 */
export interface ProbeCanvas {
  getContext(
    contextId: string,
    options?: { failIfMajorPerformanceCaveat?: boolean },
  ): ProbeGlContext | null;
}

function scratchCanvas(): ProbeCanvas | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas') as unknown as ProbeCanvas;
}

function releaseContext(gl: ProbeGlContext): void {
  const lose = gl.getExtension('WEBGL_lose_context') as LoseContextExtension | null;
  lose?.loseContext();
}

/**
 * A drift-proof software oracle that does not depend on the adapter-name string at
 * all: it asks the browser directly, by requesting a context with
 * failIfMajorPerformanceCaveat. Per the Chromium source, that attribute rejects
 * exactly the SwiftShader / WARP software paths, so if BOTH webgl2 and webgl are
 * refused the session is running on software.
 *
 * Returns TRUE when both context requests return null (software), FALSE when
 * either succeeds (a real accelerated context, immediately released via
 * WEBGL_lose_context so it does not count against the per-domain live-context
 * limit), and NULL when there is no canvas and no document (Node) or getContext
 * itself throws. A caller may inject a canvas (real or a test stub); otherwise a
 * throwaway scratch canvas is created.
 */
export function probeMajorPerformanceCaveat(canvas?: ProbeCanvas): boolean | null {
  try {
    const surface = canvas ?? scratchCanvas();
    if (!surface) return null;
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl2 = surface.getContext('webgl2', opts);
    if (gl2) {
      releaseContext(gl2);
      return false;
    }
    const gl1 = surface.getContext('webgl', opts);
    if (gl1) {
      releaseContext(gl1);
      return false;
    }
    return true;
  } catch {
    return null;
  }
}

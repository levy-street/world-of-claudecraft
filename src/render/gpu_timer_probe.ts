// The GPU timer probe's WebGL2 arm: EXT_disjoint_timer_query_webgl2 over the
// world renderer's own context, driving the pure ledger (gpu_timer_probe_core.ts).
// Dev only, `?gputimer=1` only (render_dev_flags.ts): the extension has a
// per-query cost and is fingerprint-grade, so a player session never enables
// it and the probe stays null there. Without the extension (Mesa builds and
// ANGLE profiles that omit it) the probe reports `available: false` and every
// call is a no-op.
//
// What the brackets can and cannot separate: three's `render()` draws the
// shadow maps, the background and the whole sorted render list inside one
// call, with no hook between the opaque and transparent lists and none per
// scene group, so the scene is ONE bracket. The shadow maps are split off by
// wrapping the renderer's `shadowMap.render` (a public function property):
// the frame opens `shadow` before the call and the wrapper hands over to
// `scene` once the maps are drawn. On composer tiers every other pass (AO,
// bloom, grade, screen fx, SMAA) is its own bracket (post_composer.ts).
//
// Only the PRESENT submit is bracketed: `beginFrame` (frame_present.ts) arms
// the probe and `endFrame` disarms it, so a composer or renderer draw issued
// out of band (a prewarm pass, the scene census, a screenshot) opens nothing,
// the way `discardOutOfBandDraws` keeps those draws out of the draw stats.
//
// Scheduler contract (src/render/CLAUDE.md, "GPU work"): the extension is
// fetched once, before the context's ordered extension sweep so the enabled
// set is the same for every program of the session, and because that set is
// then NOT the shader-warm worker's, the probe retires the worker through
// `noteShaderWarmExtensionDrift` so a capture under the flag reads as what it
// is (no warm-up paying) instead of a player-representative first-seconds
// regime; query objects come from a pool the ledger recycles, so a steady
// frame allocates no GL object; and a result is only read once
// QUERY_RESULT_AVAILABLE says so, on a later frame, so the readback never
// forces a GPU sync. A context that cannot mint a query halts the ledger
// rather than throwing inside the submit, and after a restore (in place on
// the same renderer) the pool drops the dead queries `isQuery` no longer
// recognises instead of binding them.

import {
  GPU_TIMER_SCENE_BRACKET,
  GPU_TIMER_SHADOW_BRACKET,
  GPU_TIMER_UNAVAILABLE,
  GpuTimerLedger,
  type GpuTimerQueryBackend,
  type GpuTimerSnapshot,
} from './gpu_timer_probe_core';
import { gpuTimerRequested } from './render_dev_flags';
import { noteShaderWarmExtensionDrift } from './shader_warm_client';

/** The extension's members the adapter reads, so a test can hand in a stub. */
export interface DisjointTimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** The slice of WebGL2 the adapter touches. */
export interface GpuTimerGl {
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery | null): void;
  isQuery(query: WebGLQuery | null): boolean;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
  getExtension(name: string): unknown;
  QUERY_RESULT_AVAILABLE: number;
  QUERY_RESULT: number;
}

/** The shadow-map object as the split hook sees it (three's WebGLShadowMap
 *  exposes `render` as an own function property, which is what makes the
 *  wrap possible without a patch). */
export interface ShadowMapRenderHost {
  render(lights: unknown, scene: unknown, camera: unknown): void;
}

export const GPU_TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

/** The probe as the frame submit sees it (frame_present.ts, post_composer.ts). */
export interface GpuFrameTimer {
  /** Arm the probe for the present submit that follows; brackets opened
   *  before this (out-of-band draws) are ignored. */
  beginFrame(): void;
  /** Open a scene-drawing submit: `shadow` first, handed over to `name`
   *  (default `scene`) by the shadow-map hook once the maps are drawn. */
  beginScene(name?: string): void;
  begin(name: string): void;
  end(): void;
  /** Seal the frame, poll the readback, disarm. */
  endFrame(): void;
}

class GlQueryBackend implements GpuTimerQueryBackend<WebGLQuery> {
  constructor(
    private readonly gl: GpuTimerGl,
    private readonly ext: DisjointTimerQueryExt,
  ) {}

  createQuery(): WebGLQuery | null {
    return this.gl.createQuery();
  }

  deleteQuery(query: WebGLQuery): void {
    this.gl.deleteQuery(query);
  }

  queryValid(query: WebGLQuery): boolean {
    // False for every object minted before a context loss, so a pool that
    // survived a restore replaces them instead of reusing dead handles.
    return this.gl.isQuery(query);
  }

  beginQuery(query: WebGLQuery): void {
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
  }

  endQuery(): void {
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }

  resultAvailable(query: WebGLQuery): boolean {
    // A lost context answers null; treat it as not yet available so the ring
    // drops the frame instead of reading garbage.
    return this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE) === true;
  }

  resultNs(query: WebGLQuery): number {
    const value = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
    return typeof value === 'number' ? value : 0;
  }

  disjoint(): boolean {
    return this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) === true;
  }
}

export class GpuTimerProbe implements GpuFrameTimer {
  readonly available: boolean;
  private readonly ledger: GpuTimerLedger<WebGLQuery> | null;
  private sceneHandOver = GPU_TIMER_SCENE_BRACKET;
  private inFrame = false;
  private noHandover = 0;
  private unwrapShadow: (() => void) | null = null;

  constructor(gl: GpuTimerGl) {
    const ext = gl.getExtension(GPU_TIMER_EXTENSION) as DisjointTimerQueryExt | null;
    this.available = ext !== null && ext !== undefined;
    this.ledger = ext ? new GpuTimerLedger<WebGLQuery>(new GlQueryBackend(gl, ext)) : null;
  }

  beginFrame(): void {
    if (this.ledger) this.inFrame = true;
  }

  beginScene(name = GPU_TIMER_SCENE_BRACKET): void {
    if (!this.inFrame) return;
    this.sceneHandOver = name;
    this.ledger?.begin(GPU_TIMER_SHADOW_BRACKET);
  }

  begin(name: string): void {
    if (!this.inFrame) return;
    this.ledger?.begin(name);
  }

  end(): void {
    if (!this.inFrame || !this.ledger) return;
    // A scene submit closing while still under `shadow` never reached the
    // shadow-map hook: the label is wrong for this frame, and the count says so.
    if (this.ledger.open === GPU_TIMER_SHADOW_BRACKET) this.noHandover++;
    this.ledger.end();
  }

  endFrame(): void {
    // A scene submit still open at the seal never handed over either.
    if (this.inFrame && this.ledger?.open === GPU_TIMER_SHADOW_BRACKET) this.noHandover++;
    this.inFrame = false;
    this.ledger?.endFrame();
  }

  snapshot(): GpuTimerSnapshot {
    if (!this.ledger) return GPU_TIMER_UNAVAILABLE;
    return { ...this.ledger.snapshot(), sceneNoHandover: this.noHandover };
  }

  /** Wrap the renderer's shadow-map render so the open `shadow` bracket hands
   *  over to the scene bracket once the maps are drawn. Any other render (a
   *  prewarm pass, a screenshot, a portrait context of its own) finds no
   *  `shadow` bracket open and passes through untouched. */
  installShadowSplit(shadowMap: ShadowMapRenderHost): void {
    const ledger = this.ledger;
    if (!ledger || this.unwrapShadow) return;
    const original = shadowMap.render;
    shadowMap.render = (lights, scene, camera) => {
      original.call(shadowMap, lights, scene, camera);
      if (this.inFrame && ledger.open === GPU_TIMER_SHADOW_BRACKET) {
        ledger.end();
        ledger.begin(this.sceneHandOver);
      }
    };
    this.unwrapShadow = () => {
      shadowMap.render = original;
    };
  }

  dispose(): void {
    this.inFrame = false;
    this.unwrapShadow?.();
    this.unwrapShadow = null;
    this.ledger?.dispose();
  }
}

/** The probe for this session, or null unless `?gputimer=1` asked for it.
 *  Call it on the world context BEFORE the ordered extension sweep. */
export function createGpuTimerProbe(gl: GpuTimerGl): GpuTimerProbe | null {
  if (!gpuTimerRequested()) return null;
  const probe = new GpuTimerProbe(gl);
  // The timer extension is now in the game context's enabled set and not in
  // the warm worker's: every program it warms would be keyed for a set the
  // game does not have, so retire it and let the readout name the cause.
  if (probe.available) noteShaderWarmExtensionDrift(GPU_TIMER_EXTENSION);
  return probe;
}

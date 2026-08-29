// The messages between the shader warm client (main thread) and its worker
// (shader_warm_worker.ts). Plain data both ways: the worker receives GLSL
// text and answers with ids, never with programs. The game receives nothing
// from the worker at all: a program the worker linked AND resolved sits in
// the browser's shared program cache, so the game's own link of the same
// text is a hit. Host-agnostic (types only).

/** One program to warm: the exact text three will link, plus the attribute
 *  three binds at location 0 (part of the browser's cache key). */
export interface ShaderWarmSource {
  id: number;
  vertex: string;
  fragment: string;
  index0Attribute: string;
  /** Higher first (the queue's GPU_WORK_PRIORITY classes). */
  priority: number;
}

export interface ShaderWarmInitMessage {
  kind: 'init';
  /** The game context's own attributes, so the worker's context is created
   *  the same way. */
  contextAttributes: Record<string, unknown> | null;
  /** The extensions the game context has enabled, in order: the worker must
   *  reproduce exactly this set or refuse (the cache key carries it). */
  extensions: string[];
  /** The worker's admission window bounds for this platform class. */
  maxWindow: number;
  /** Programs kept linked after their resolve, for this platform class. */
  retain: number;
}

export interface ShaderWarmRequestMessage {
  kind: 'warm';
  sources: ShaderWarmSource[];
}

export interface ShaderWarmCancelMessage {
  kind: 'cancel';
  ids: number[];
}

export interface ShaderWarmPauseMessage {
  kind: 'pause' | 'resume' | 'dispose';
}

export type ShaderWarmClientMessage =
  | ShaderWarmInitMessage
  | ShaderWarmRequestMessage
  | ShaderWarmCancelMessage
  | ShaderWarmPauseMessage;

/** Why the worker could not take the game context's contract. A context
 *  without KHR_parallel_shader_compile is NOT a refusal: the worker then
 *  resolves each link by blocking its own thread, one at a time. */
export type ShaderWarmRefusal = 'no-offscreen-canvas' | 'no-webgl2' | 'extension-mismatch';

export interface ShaderWarmReadyMessage {
  kind: 'ready';
  ok: boolean;
  reason: ShaderWarmRefusal | null;
  /** What the worker's context enabled, for the readout. */
  extensions: string[];
  adapter: string;
}

export interface ShaderWarmWarmedMessage {
  kind: 'warmed';
  id: number;
  /** Submission to resolution, on the worker's clock. */
  linkMs: number;
}

export interface ShaderWarmFailedMessage {
  kind: 'failed';
  id: number;
  reason: 'link-failed' | 'context-lost' | 'cancelled' | 'not-ready';
}

export interface ShaderWarmLostMessage {
  kind: 'lost';
}

export interface ShaderWarmStatsMessage {
  kind: 'stats';
  pending: number;
  inFlight: number;
  windowLinks: number;
  state: string;
  warmed: number;
  failed: number;
  retained: number;
  /** Requests the client gave up on (a hold that expired) and the worker
   *  dropped before linking. */
  cancelled: number;
  /** The window's history: how often it halved, and the widest it got. An
   *  oscillating window and a converged one read differently here. */
  backoffCount: number;
  maxWindowObserved: number;
  /** The judge's etalon: milliseconds per thousand GLSL characters for a
   *  link this driver has to itself; null before the first solo settle. */
  etalonMsPerKchar: number | null;
  /** Solo settles the etalon was taught by. */
  soloSamples: number;
}

export type ShaderWarmWorkerMessage =
  | ShaderWarmReadyMessage
  | ShaderWarmWarmedMessage
  | ShaderWarmFailedMessage
  | ShaderWarmLostMessage
  | ShaderWarmStatsMessage;

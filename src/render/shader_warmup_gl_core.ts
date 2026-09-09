// The GL discipline of a shader warm-up, shared by every warming context
// (the character-select cache's hidden canvas, src/game/shader_cache_warmup.ts,
// and the worker's OffscreenCanvas, shader_warm_worker.ts): how a program is
// submitted so its browser cache key matches the game's own link, and how a
// link is resolved so it enters the cache at all. Host-agnostic: the gl is a
// structural slice, so a test hands in a plain object and a real WebGL2
// context satisfies it as is.
//
// The two rules the measurements settled (tmp reports of 2026-08-27/28):
// - the bind at location 0 is part of the cache key: three binds `position`
//   there on every program that has it, so a warm-up that links the same
//   GLSL without that bind writes a key the game never asks for;
// - an unresolved parallel link never reaches the cache: the completion query
//   answers without resolving, the first LINK_STATUS read resolves, and the
//   resolved link is what the browser caches.

/** The WebGL surface a warm-up context needs. */
export interface WarmupGl {
  VERTEX_SHADER: number;
  FRAGMENT_SHADER: number;
  RENDERER: number;
  LINK_STATUS: number;
  createShader(type: number): WebGLShader | null;
  shaderSource(shader: WebGLShader, source: string): void;
  compileShader(shader: WebGLShader): void;
  createProgram(): WebGLProgram | null;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  bindAttribLocation(program: WebGLProgram, index: number, name: string): void;
  linkProgram(program: WebGLProgram): void;
  deleteShader(shader: WebGLShader): void;
  deleteProgram(program: WebGLProgram): void;
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
  getProgramParameter(program: WebGLProgram, pname: number): unknown;
}

export interface WarmProgramSources {
  vertex: string;
  fragment: string;
  /** The attribute bound at location 0 before the link; empty for none. */
  index0Attribute: string;
}

export interface WarmProgramHandle {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
}

/** KHR_parallel_shader_compile's non-blocking link-completion query. */
export const COMPLETION_STATUS_KHR = 0x91b1;

/** Compile both stages, replay three's location-0 bind, and submit the link
 *  without querying it (a LINK_STATUS read here would make the off-thread
 *  link synchronous). Null when the context refuses an object. */
export function submitWarmProgram(
  gl: WarmupGl,
  sources: WarmProgramSources,
): WarmProgramHandle | null {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    return null;
  }
  gl.shaderSource(vertex, sources.vertex);
  gl.compileShader(vertex);
  gl.shaderSource(fragment, sources.fragment);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  if (sources.index0Attribute) gl.bindAttribLocation(program, 0, sources.index0Attribute);
  gl.linkProgram(program);
  return { program, vertex, fragment };
}

export type WarmPollResult = 'pending' | 'linked' | 'failed';

/** One completion poll. A completed link is resolved by the LINK_STATUS read
 *  that follows (which is what enters the cache); its answer says whether
 *  the driver accepted the program. A query that throws (a context on its
 *  way out) reads as failed. */
export function pollWarmProgram(gl: WarmupGl, handle: WarmProgramHandle): WarmPollResult {
  try {
    if (gl.getProgramParameter(handle.program, COMPLETION_STATUS_KHR) !== true) return 'pending';
    return gl.getProgramParameter(handle.program, gl.LINK_STATUS) === true ? 'linked' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Resolve without the completion query: blocks the calling thread until the
 *  link is done (fine on a worker, never on the main thread). */
export function resolveWarmProgram(gl: WarmupGl, handle: WarmProgramHandle): WarmPollResult {
  try {
    return gl.getProgramParameter(handle.program, gl.LINK_STATUS) === true ? 'linked' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The shaders are free once the link resolved; the program itself is kept
 *  or dropped by the caller's retention rule. */
export function releaseWarmShaders(gl: WarmupGl, handle: WarmProgramHandle): void {
  try {
    gl.deleteShader(handle.vertex);
    gl.deleteShader(handle.fragment);
  } catch {
    // A lost context has nothing left to delete.
  }
}

export function deleteWarmProgram(gl: WarmupGl, handle: WarmProgramHandle): void {
  try {
    gl.deleteProgram(handle.program);
  } catch {
    // Same: nothing to delete on a lost context.
  }
}

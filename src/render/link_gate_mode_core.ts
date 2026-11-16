// Whether the renderer may hold content behind a compile gate on this browser,
// and in which mode.
//
// Every gate (the reveal gates, the view and swap gates, the effect gates, the
// boot compile lanes) waits on `compileAsync`, and was switched off wholesale
// when the context lacks KHR_parallel_shader_compile, on the premise that a
// link without the extension happens synchronously wherever it is issued.
// That premise holds where the browser links on the calling thread, and is
// false in Chromium, which runs every GL call, the link included, in its GPU
// process behind the command buffer. Measured 2026-11-11 on a Snapdragon 7s
// Gen 3 phone (Chrome 156, ANGLE over OpenGL ES, no extension) with salted,
// never-cached programs: issuing a link costs about 2 ms on the main thread
// and no frame hitches; a LINK_STATUS query 1.5 s later costs about 4 ms (the
// link finished in the background); the same program met first at draw time
// hitched the frame. With the gates off, that phone linked 26 programs live on
// its first town turn, up to seven in one 343 ms frame.
//
// So a Chromium context without the extension runs the FIRST-SIGHT gates in
// DEFERRED mode (the reveal, view, swap, effect and streamed-group gates, the
// renderer's `compileGatesSupported`): the same machinery, where three reports
// a program ready as soon as its link is issued (it has no completion query to
// ask), the gate's touch tail, which reads the program's uniform tables, is
// what waits for the link to finish, and the queue admits new links at one per
// frame (link_frame_ledger.ts), because the GPU process runs them in order.
// The BULK lanes stay off there as before (`asyncCompileSupported`: the boot
// manifest's compile entries, the background zone prewarm, the self-spirit
// warm): measured on the desktop proxy, the zone prewarm alone queued 340 to
// 460 units ahead of the reveal gates, which then hit their watchdog and
// revealed unprepared, and its drain cost every frame 2 to 4 ms on the phone.
// `?linkgate=off` restores the old wholesale switch-off; `?linkgate=deferred`
// forces deferred mode on any engine, for measurement only.
//
// Pure and DOM-free (RENDER_PURE_CORES).

export type LinkGateMode = 'parallel' | 'deferred' | 'none';

export type LinkGateOverride = 'off' | 'deferred' | null;

export interface LinkGateModeInput {
  /** three's renderer has compileAsync at all. */
  compileAsync: boolean;
  /** The context exposes KHR_parallel_shader_compile. */
  parallelExtension: boolean;
  /** The browser engine (game/browser_env.ts detectBrowserEngine). */
  engine: string;
  /** The `?linkgate=` dev override, null when absent. */
  override: LinkGateOverride;
}

export function resolveLinkGateMode(input: LinkGateModeInput): LinkGateMode {
  if (!input.compileAsync) return 'none';
  if (input.parallelExtension) return 'parallel';
  if (input.override === 'off') return 'none';
  if (input.override === 'deferred') return 'deferred';
  return input.engine === 'chromium' ? 'deferred' : 'none';
}

/** Parse the `?linkgate=` value. */
export function parseLinkGateOverride(raw: string | null): LinkGateOverride {
  return raw === 'off' || raw === 'deferred' ? raw : null;
}

// The shader warm worker's beacon block: the smallest readout that answers,
// over the fleet, the two questions the local readout can only answer one
// machine at a time. Did the worker run at all on this session's backend, and
// when it did not, what refused or retired it (a breaker rule, a drifted
// extension set, a phone-class WebKit).
//
// Deliberately a PROJECTION, not a passthrough: the client's snapshot names
// the adapter and carries per-gate counts and GLSL-derived keys, none of which
// belong in a fleet row, so this core takes the eight fields the fleet reads
// and bounds every one of them. `active` is the worker being READY, never the
// setting or the mode: a mode of `all` on a session whose worker was retired
// at second four is not an active worker, and reading the setting as if it
// were is what would make the fleet numbers say the opposite of the truth.

/** The client snapshot's fields this block projects (structurally, so the
 *  core stays free of the render layer). */
export interface ShaderWarmBeaconInput {
  worker: string;
  refusal: string | null;
  mode: string;
  setting: string;
  backend: string | null;
  warmed: number;
  held: number;
  heldTimedOut: number;
}

export interface ShaderWarmBeaconSummary {
  /** The worker was ready when the report was built. */
  active: boolean;
  worker: string;
  refusal: string | null;
  mode: string;
  setting: string;
  backend: string | null;
  warmed: number;
  held: number;
  heldTimedOut: number;
}

/** The longest any string in the block: every one of them is a short enum-like
 *  token the client mints (a state, a mode, a backend class, a refusal with at
 *  most one appended name), so a longer value is a defect and is cut here
 *  rather than shipped. The bound is the server's own token bound
 *  (SHADER_WARM_TOKEN_MAX, server/perf_report_entry_blocks.ts), so the one
 *  refusal that carries a name, an extension-drift naming the longest WebGL
 *  extension ('extension-drift:webgl_compressed_texture_s3tc_srgb', 50
 *  characters), reaches the fleet whole instead of being cut into a token the
 *  server then drops on charset. */
export const SHADER_WARM_BEACON_TEXT_MAX = 64;

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, SHADER_WARM_BEACON_TEXT_MAX) : '';
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function shaderWarmBeaconSummary(snapshot: ShaderWarmBeaconInput): ShaderWarmBeaconSummary {
  return {
    active: snapshot.worker === 'ready',
    worker: text(snapshot.worker),
    refusal: snapshot.refusal === null ? null : text(snapshot.refusal),
    mode: text(snapshot.mode),
    setting: text(snapshot.setting),
    backend: snapshot.backend === null ? null : text(snapshot.backend),
    warmed: count(snapshot.warmed),
    held: count(snapshot.held),
    heldTimedOut: count(snapshot.heldTimedOut),
  };
}

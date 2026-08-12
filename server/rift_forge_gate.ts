// The Rift forge wire gate.
//
// The forge (upgrade / enchant / socket on Riftbound bands) shipped end to end
// in the sim and on the wire, but its client UI never did: no stock caller
// exists (none ever has, per git history), the wiki deliberately does not name
// the feature, and the only live users are crafted wire frames from modified
// clients spending real essence and gems for real combat stats. Hiding a
// feature from the stock UI does not hide it from DevTools or a custom client,
// so the authoritative server refuses the three dispatch arms unless the realm
// explicitly opts in.
//
// RIFT_FORGE_ENABLED=1 opens the wire (PTR, internal playtests, or the future
// intentional ship). Anything else, including unset, keeps it closed in every
// environment, the same strict opt-in convention as ALLOW_DEV_COMMANDS. The
// env var is read per verdict, never captured at import, so tests and a
// supervised restart both see the live value. That per-verdict read is
// affordable ONLY because the dispatch call site sits behind the per-session
// command lane (~30/s) and short-circuits to forge tokens; never call these
// from the 20 Hz world loop or the per-viewer broadcast pass (capture the
// verdict once per pass there instead).
//
// Scope is deliberately the server boundary only. The sim methods stay live
// for the offline single-player world, the headless RL env, the existing
// tests (tests/rift_progression.test.ts), and the future UI; none of those
// can turn a crafted frame into realm-visible progression, which is the only
// surface this gate exists to close.

import type { CommandName } from '../src/world_api';

/** The three forge wire tokens, pinned to the shared command vocabulary. */
export const RIFT_FORGE_WIRE_COMMANDS = [
  'rift_upgrade_item',
  'rift_enchant_item',
  'rift_socket_gem',
] as const satisfies readonly CommandName[];

const RIFT_FORGE_CMD_SET: ReadonlySet<string> = new Set(RIFT_FORGE_WIRE_COMMANDS);

/** True when the realm has explicitly opted the forge wire open. */
export function riftForgeWireEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RIFT_FORGE_ENABLED === '1';
}

/**
 * The dispatch-time verdict: true when `cmd` is a forge command and the wire
 * is closed, in which case the caller refuses without touching the sim. A
 * non-forge command (or a non-string) is never refused here and follows the
 * normal dispatch path.
 *
 * `env` is optional rather than defaulted so the hot dispatch call pays the
 * `process.env` object load only on forge tokens (the `??` sits behind the
 * short-circuit), not on every command frame.
 */
export function refusedRiftForgeCommand(
  cmd: unknown,
  env?: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    typeof cmd === 'string' &&
    RIFT_FORGE_CMD_SET.has(cmd) &&
    !riftForgeWireEnabled(env ?? process.env)
  );
}

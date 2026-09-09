// The program-key ledger: every program three mints in a session, with its
// full cache key and the moment it appeared.
//
// The live-program watch (live_program_watch.ts) names what escaped the
// preparation after the reveal; the prewarm stats count what each lane linked.
// Neither says WHICH renderer state a program was keyed under, so "about 30
// programs compiled twice" stayed a count. This ledger keeps the keys, so the
// pure core (program_key_ledger_core.ts) can group them by material and name
// the field that differs, and a capture can place every link on the login's
// timeline (constructor, zone preparation, a manifest entry, live).
//
// Off unless the page asked for performance evidence (`?perf` or
// `?perfTrace=1`, the flags the perf beacon and the hitch probes already use):
// a key is a few hundred characters and a session mints hundreds of programs,
// which is memory a player's session has no use for. Bounded either way.
//
// Module-owned like the watch, for the same reason (the renderer's line
// ratchet); swept from the watch's own readouts, so the renderer gains no
// call site: right before and after every manifest entry, at the reveal, and
// around every live frame's render.

import { type LiveProgramEntry, liveProgramIdentity } from './live_program_watch_core';
import type { ProgramKeyLedgerRecord } from './program_key_ledger_core';

/** A long session relinks; a login mints a few hundred. */
export const PROGRAM_KEY_LEDGER_LIMIT = 4096;

interface LedgerHost {
  info?: { programs?: LiveProgramEntry[] | null } | null;
}

interface LedgerState {
  enabled: boolean;
  entries: ProgramKeyLedgerRecord[];
  known: Set<string>;
  lastLength: number;
  /** Records dropped past the limit, so a snapshot can say it is partial. */
  dropped: number;
}

function flagRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('perf') || params.get('perfTrace') === '1';
}

const state: LedgerState = {
  enabled: typeof location !== 'undefined' && flagRequested(location.search),
  entries: [],
  known: new Set<string>(),
  lastLength: 0,
  dropped: 0,
};

/**
 * Records every program in the host's list that the ledger has not seen,
 * stamped by `now`. One length compare when nothing moved (the per-frame
 * case); a walk otherwise, with a set lookup per entry. Returns how many were
 * added. The clock is a thunk read only once the sweep has something to
 * record, so a disabled ledger and a settled list cost the caller no clock
 * read at all (the watch's readouts run several times per frame).
 */
export function sweepProgramKeyLedger(webgl: LedgerHost, now: () => number): number {
  if (!state.enabled) return 0;
  const programs = webgl.info?.programs;
  if (!programs || programs.length === state.lastLength) return 0;
  const atMs = now();
  let added = 0;
  for (const program of programs) {
    const identity = liveProgramIdentity(program);
    if (state.known.has(identity)) continue;
    state.known.add(identity);
    if (state.entries.length >= PROGRAM_KEY_LEDGER_LIMIT) {
      state.dropped++;
      continue;
    }
    state.entries.push({
      key: program.cacheKey ?? '',
      atMs: Math.round(atMs),
      id: typeof program.id === 'number' ? program.id : null,
      name: program.name ?? '',
    });
    added++;
  }
  state.lastLength = programs.length;
  return added;
}

export function programKeyLedgerEnabled(): boolean {
  return state.enabled;
}

/** The records so far (a copy), plus how many the bound dropped. */
export function programKeyLedgerSnapshot(): {
  enabled: boolean;
  entries: ProgramKeyLedgerRecord[];
  dropped: number;
} {
  return { enabled: state.enabled, entries: state.entries.slice(), dropped: state.dropped };
}

export function setProgramKeyLedgerEnabledForTest(enabled: boolean): void {
  state.enabled = enabled;
}

export function resetProgramKeyLedgerForTest(search = ''): void {
  state.enabled = flagRequested(search);
  state.entries.length = 0;
  state.known.clear();
  state.lastLength = 0;
  state.dropped = 0;
}

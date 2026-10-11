// The pending Town Focus re-spec (#1144) as persisted state and as a read view.
//
// A 'time' / 'timeAndPartial' re-spec is queued on PlayerMeta.pendingTownFocus
// and commits in the per-player tick loop once its duration elapses
// (town_focus_commands.ts updateTownFocusRespec). This leaf owns the two
// things the queue needs beyond that loop:
//   - the SAVE encoding, so the queue survives a logout, an expired linkdead
//     grace, and an instance handoff (all of which rebuild the player from
//     CharacterState). Sim time restarts from 0 on every process and every
//     instance, so the wait is stored as REMAINING seconds and re-anchored on
//     the loading Sim's clock, never as an absolute readyAtTime.
//   - the READ view both hosts hand the Town Focus panel (IWorld
//     `townFocusPending`): the queued allocation plus whole seconds left, so
//     the panel can show that Save took and how long is left instead of the
//     old committed allocation. The server ships exactly this view on the
//     `tfpend` self-wire key and the online mirror re-parses it through the
//     same strict parse the load uses, so a malformed frame refuses to null
//     rather than rendering a partial queue.
//
// Pure leaf in the shape of harvest_preference.ts: no Sim import, no rng, no
// clock of its own (callers pass `now`), never mutates or aliases its inputs.

import { normalizeTownFocusOnLoad } from './focus';

/** The live queue on PlayerMeta. `readyAtTime` is in the owning Sim's clock. */
export interface PendingTownFocus {
  allocation: Record<string, number>;
  readyAtTime: number;
  coin: number;
  materials: number;
}

/** The save form (CharacterState.pendingTownFocus): remaining seconds, never
 *  an absolute time. */
export interface SavedPendingTownFocus {
  allocation: Record<string, number>;
  remainingSeconds: number;
  coin: number;
  materials: number;
}

/** What the panel reads (IWorld `townFocusPending`, self-wire `tfpend`). */
export interface TownFocusPendingView {
  readonly allocation: Record<string, number>;
  /** Whole seconds until the queued allocation commits, rounded up, never
   *  negative. */
  readonly remainingSeconds: number;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function remainingSecondsAt(readyAtTime: number, now: number): number {
  return Math.max(0, Math.ceil(readyAtTime - now));
}

/** Two allocations name the same points on the same families, in any key
 *  order. Both sides are read through the load normalizer so a zero row or
 *  an unknown key never makes two equal requests read as different. */
export function sameTownFocusAllocation(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const na = normalizeTownFocusOnLoad(a);
  const nb = normalizeTownFocusOnLoad(b);
  const keys = Object.keys(na);
  if (keys.length !== Object.keys(nb).length) return false;
  return keys.every((key) => nb[key] === na[key]);
}

/** The sparse CharacterState fragment for one save: absent while nothing is
 *  queued, so a pre-feature save and an idle player read byte-identical. */
export function serializePendingTownFocus(
  pending: PendingTownFocus | undefined,
  now: number,
): { pendingTownFocus?: SavedPendingTownFocus } {
  if (!pending) return {};
  return {
    pendingTownFocus: {
      allocation: { ...pending.allocation },
      remainingSeconds: remainingSecondsAt(pending.readyAtTime, now),
      coin: pending.coin,
      materials: pending.materials,
    },
  };
}

/**
 * Parse an untrusted queue view (a persisted save, a wire frame) strictly.
 * Refuses to null on any shape a live writer could never have produced; the
 * allocation is normalized exactly like the committed one on load
 * (normalizeTownFocusOnLoad), and the seconds are rounded up to a whole
 * count so the wire form and the view form agree.
 */
export function parseTownFocusPendingView(raw: unknown): TownFocusPendingView | null {
  if (!isPlainRecord(raw)) return null;
  if (!isPlainRecord(raw.allocation)) return null;
  if (!isFiniteNonNegative(raw.remainingSeconds)) return null;
  return {
    allocation: normalizeTownFocusOnLoad(raw.allocation),
    remainingSeconds: Math.ceil(raw.remainingSeconds),
  };
}

/** Restore a persisted queue onto the loading Sim's clock (`now`). Absent,
 *  and anything the strict parse or the charge fields refuse, loads as
 *  nothing queued: a refused queue was never charged for, so dropping it
 *  costs the player nothing, exactly like the pre-persistence logout did. */
export function loadPendingTownFocus(saved: unknown, now: number): PendingTownFocus | undefined {
  const view = parseTownFocusPendingView(saved);
  if (view === null || !isPlainRecord(saved)) return undefined;
  if (!isFiniteNonNegative(saved.coin) || !isFiniteNonNegative(saved.materials)) return undefined;
  return {
    allocation: view.allocation,
    readyAtTime: now + view.remainingSeconds,
    coin: saved.coin,
    materials: saved.materials,
  };
}

/** The read view for a live queue at `now`; null while nothing is queued.
 *  Cloned, never the live allocation. */
export function townFocusPendingView(
  pending: PendingTownFocus | undefined,
  now: number,
): TownFocusPendingView | null {
  if (!pending) return null;
  return {
    allocation: { ...pending.allocation },
    remainingSeconds: remainingSecondsAt(pending.readyAtTime, now),
  };
}

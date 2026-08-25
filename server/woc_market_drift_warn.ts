// Dev-channel visibility for economy-service vocabulary drift, extracted from
// the service coordinator (the 12 QA round's ask, taken with the module
// budget row it pays for). The anti-snipe allowlist fails SILENTLY toward
// never extending when the service stops emitting the exact ledger-matched
// word, and the wire screen collapses an unknown word to 'other' with no
// trace: the first sighting of each unrecognized verdict word is worth one
// line so a service drift is visible instead of invisible.
//
// Membership is judged through the SAME exported Sets the wire screens use
// (woc_market_rules.ts WOC_MARKET_WIRE_PENDING_SET / WOC_MARKET_WIRE_FAIL_SET),
// so the two judges can never disagree about what "recognized" means.

import { WOC_MARKET_WIRE_FAIL_SET, WOC_MARKET_WIRE_PENDING_SET } from './woc_market_rules';

/** Log-channel clamp for wire-supplied identifiers: printable ASCII only,
 *  bounded, so a hostile or corrupt value cannot forge log lines or flood
 *  the channel (the same discipline the route layer's signature screen
 *  applies at intake; this belt covers values that predate it). The bound
 *  matches the intake screen's 256 so a real base58 signature (87 to 88
 *  chars) survives whole: the retirement trace is reconciliation evidence,
 *  and a truncated signature defeats an exact-match log search. */
export function logSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 256);
}

/** Distinct unrecognized verdict words warned about before the channel goes
 *  quiet: one line per word is a drift signal, an unbounded set fed by wire
 *  text is a leak. */
export const WIRE_DRIFT_WARN_CAP = 100;

/** Verdict words already warned about, one channel per vocabulary (once per
 *  word per instance; production runs one instance per realm process). Keys
 *  are logSafe-clamped and the set is capped, so a misbehaving service
 *  answering a distinct unbounded word per call cannot grow process memory
 *  for its lifetime. */
export class WocWireDriftWarner {
  private readonly channels = {
    pending: { words: new Set<string>(), suppressed: false },
    fail: { words: new Set<string>(), suppressed: false },
  };

  notePending(reason: string | null): void {
    this.note('pending', WOC_MARKET_WIRE_PENDING_SET, reason);
  }

  /** The fail-side twin. Fail words persist verbatim on the settlement row,
   *  so operators CAN query the drift after the fact; the warn exists so
   *  they never have to know to look (the same silent-collapse class the
   *  pending warn closes: every affected player sees the generic line). */
  noteFail(reason: string | null): void {
    this.note('fail', WOC_MARKET_WIRE_FAIL_SET, reason);
  }

  private note(
    kind: 'pending' | 'fail',
    vocabulary: ReadonlySet<string>,
    reason: string | null,
  ): void {
    if (reason === null) return;
    if (vocabulary.has(reason)) return;
    const chan = this.channels[kind];
    const word = logSafe(reason);
    if (chan.words.has(word)) return;
    if (chan.words.size >= WIRE_DRIFT_WARN_CAP) {
      if (!chan.suppressed) {
        chan.suppressed = true;
        console.warn(`[woc_market] further unrecognized ${kind} verdict words suppressed`);
      }
      return;
    }
    chan.words.add(word);
    // Two literals, not one interpolated shape: the pending line predates the
    // fail channel and is pinned byte-for-byte, and "fail confirm verdict"
    // reads wrong for a word that arrived on a bond refusal.
    if (kind === 'pending') {
      console.warn(`[woc_market] unrecognized pending confirm verdict ${word}`);
    } else {
      console.warn(`[woc_market] unrecognized fail verdict ${word}`);
    }
  }
}

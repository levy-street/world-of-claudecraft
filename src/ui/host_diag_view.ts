// The System Report section's pure decisions (the pure-core + thin-painter
// recipe in src/ui/CLAUDE.md): a three-step phase machine plus the ONE mapping
// from a desktop shell result to what the section says. DOM-free, so the whole
// result table is driven without a browser (tests/host_diag_view.test.ts).
//
// The i18n import is TYPE-ONLY by design: the core picks KEYS and placeholder
// values, and the painter resolves them through t(). That keeps the table
// assertable as data rather than as rendered English.

import type { DesktopHostDiagResult } from '../runtime';
import type { TranslationKey } from './i18n.catalog';

/** Where the section stands: nothing asked for yet, a run in flight, or a verdict. */
export type HostDiagPhase = 'idle' | 'running' | 'result';

/** The render-model's tone vocabulary, which the painter maps to a CSS class. */
export type HostDiagTone = 'success' | 'info' | 'error';

export interface HostDiagResultModel {
  tone: HostDiagTone;
  messageKey: TranslationKey;
  /** Placeholder values for `messageKey`; absent when the line takes none. */
  messageValues?: Record<string, string>;
}

export interface HostDiagState {
  phase: HostDiagPhase;
  result: HostDiagResultModel | null;
}

/** Fresh objects rather than shared constants: the painter holds the state it is
 *  handed, so a shared literal would let one section's mutation reach another. */
export function hostDiagIdle(): HostDiagState {
  return { phase: 'idle', result: null };
}

export function hostDiagRunning(): HostDiagState {
  return { phase: 'running', result: null };
}

/**
 * The result table. Returns null for the ONE outcome that says nothing: the
 * player closed the save dialog, which is a decision, not a failure, so the
 * section returns to idle silently.
 *
 * Every failure is ONE line: a rejected promise, a missing bridge, a shell
 * answering something unknown. From the player's side those are one event, "no
 * file was written", and the answer to all of them is to try again.
 *
 * `busy` is NOT a failure: a run is already open and will still write its file,
 * so it renders the running line.
 *
 * Every nativeStatus of a SAVED report renders the same plain saved line: the
 * Windows half falling short still leaves a file support can read, and the
 * shortfall is not something the player can act on.
 */
export function hostDiagResultModel(
  result: DesktopHostDiagResult | null | undefined,
): HostDiagResultModel | null {
  if (!result) return { tone: 'error', messageKey: 'hudChrome.hostDiag.failed' };
  if (result.status === 'cancelled') return null;
  // A run is already open (the section was rebuilt mid-collection and clicked
  // again): that first run will still write its file, so "failed" would be false.
  if (result.status === 'busy') return { tone: 'info', messageKey: 'hudChrome.hostDiag.running' };
  if (result.status !== 'saved') return { tone: 'error', messageKey: 'hudChrome.hostDiag.failed' };
  const fileName = result.fileName ?? '';
  // The shell always names the file it wrote; the nameless arm is the defensive
  // one, and it drops the placeholder rather than printing an empty quote.
  if (fileName === '') return { tone: 'success', messageKey: 'hudChrome.hostDiag.savedNoName' };
  return {
    tone: 'success',
    messageKey: 'hudChrome.hostDiag.saved',
    messageValues: { fileName },
  };
}

/** The phase a settled request leaves the section in. */
export function hostDiagSettled(result: DesktopHostDiagResult | null | undefined): HostDiagState {
  const model = hostDiagResultModel(result);
  return model ? { phase: 'result', result: model } : hostDiagIdle();
}

// The System Report section's result table (src/ui/host_diag_view.ts). The
// section itself is a handful of nodes; the whole judgement is here, so every
// arm of the shell's (status, nativeStatus) matrix gets its own decisive
// assertion.
//
// Pure, so no DOM environment: the core returns KEYS, which is exactly what makes
// the table assertable as data rather than as rendered English.

import { describe, expect, it } from 'vitest';
import type { DesktopHostDiagResult } from '../src/runtime';
import {
  type HostDiagResultModel,
  hostDiagIdle,
  hostDiagResultModel,
  hostDiagRunning,
  hostDiagSettled,
} from '../src/ui/host_diag_view';

const NATIVE_STATUSES: DesktopHostDiagResult['nativeStatus'][] = [
  'ok',
  'partial',
  'unsupported-platform',
  'unavailable',
  'error',
  null,
];

function saved(
  nativeStatus: DesktopHostDiagResult['nativeStatus'],
  fileName = 'woc-host-diag-20260919.json',
): DesktopHostDiagResult {
  return { status: 'saved', nativeStatus, fileName };
}

function model(result: DesktopHostDiagResult): HostDiagResultModel {
  const m = hostDiagResultModel(result);
  if (!m) throw new Error('expected a render model, got the silent (cancelled) arm');
  return m;
}

describe('host_diag_view: phases', () => {
  it('starts idle with no result and mints a fresh object each time', () => {
    expect(hostDiagIdle()).toEqual({ phase: 'idle', result: null });
    expect(hostDiagRunning()).toEqual({ phase: 'running', result: null });
    // Fresh objects, so one section's state can never be reached through another's.
    expect(hostDiagIdle()).not.toBe(hostDiagIdle());
    expect(hostDiagRunning()).not.toBe(hostDiagRunning());
  });

  it('settles into the result phase, carrying the model the table chose', () => {
    const state = hostDiagSettled(saved('ok'));
    expect(state.phase).toBe('result');
    expect(state.result?.messageKey).toBe('hudChrome.hostDiag.saved');
  });
});

describe('host_diag_view: saved', () => {
  it('names the saved file and passes it through as a placeholder value', () => {
    const m = model(saved('ok', 'report.json'));
    expect(m.tone).toBe('success');
    expect(m.messageKey).toBe('hudChrome.hostDiag.saved');
    expect(m.messageValues).toEqual({ fileName: 'report.json' });
  });

  it('falls back to the nameless line rather than an empty placeholder', () => {
    const m = model({ status: 'saved', nativeStatus: 'ok' });
    expect(m.messageKey).toBe('hudChrome.hostDiag.savedNoName');
    expect(m.messageValues).toBeUndefined();
    const blank = model(saved('ok', ''));
    expect(blank.messageKey).toBe('hudChrome.hostDiag.savedNoName');
  });

  it('renders the SAME plain saved line for every native status, shortfalls included', () => {
    // The owner's decision: a saved file is a saved file. A partial, missing or
    // wedged Windows half still leaves something support can read, and none of
    // those are anything the player can act on, so the section says none of it.
    for (const nativeStatus of NATIVE_STATUSES) {
      expect(model(saved(nativeStatus)), `nativeStatus ${String(nativeStatus)}`).toEqual({
        tone: 'success',
        messageKey: 'hudChrome.hostDiag.saved',
        messageValues: { fileName: 'woc-host-diag-20260919.json' },
      });
    }
  });
});

describe('host_diag_view: the non-saved arms', () => {
  it('returns to idle silently when the player cancelled the save dialog', () => {
    // A closed dialog is a decision, not a failure: no message at all.
    expect(hostDiagResultModel({ status: 'cancelled', nativeStatus: null })).toBeNull();
    expect(hostDiagSettled({ status: 'cancelled', nativeStatus: null })).toEqual({
      phase: 'idle',
      result: null,
    });
    // Even if the shell got as far as a native verdict before the cancel.
    expect(hostDiagResultModel({ status: 'cancelled', nativeStatus: 'ok' })).toBeNull();
  });

  it('renders busy as the running line, never as a failure', () => {
    // The first run is still open and will write its file, so "could not be
    // created" would be false.
    expect(hostDiagResultModel({ status: 'busy', nativeStatus: null })).toEqual({
      tone: 'info',
      messageKey: 'hudChrome.hostDiag.running',
    });
  });

  it('maps every failed outcome to the one try-again failure line', () => {
    // The glue already folds a missing bridge and a rejected promise into the
    // 'error' verdict; this pins that a null answer and an unrecognized status
    // land on the same line, so no shell can leave the section silent.
    const expected = { tone: 'error', messageKey: 'hudChrome.hostDiag.failed' };
    expect(hostDiagResultModel({ status: 'error', nativeStatus: null })).toEqual(expected);
    expect(hostDiagResultModel({ status: 'error', nativeStatus: 'error' })).toEqual(expected);
    expect(hostDiagResultModel(null)).toEqual(expected);
    expect(hostDiagResultModel(undefined)).toEqual(expected);
    expect(hostDiagResultModel({ status: 'exploded' } as unknown as DesktopHostDiagResult)).toEqual(
      expected,
    );
    expect(hostDiagSettled(null).phase, 'and it is a RESULT, not a silent idle').toBe('result');
  });
});

import { describe, expect, it } from 'vitest';
import {
  dismissPerfNudge,
  isPerfNudgeArmId,
  PERF_NUDGE_ARM_IDS,
  perfNudgeDismissalValue,
  resolvePerfNudge,
} from '../src/ui/perf_nudge_view';

// Every input dimension of the state machine gets its own decisive case
// (packet 0 rulings R15/R16): arm selection, software-notice suppression,
// desktop-shell copy split, prior dismissal, and the id-set re-arm value.

const baseInput = {
  suggestionIds: [] as readonly string[],
  softwareNoticeAlreadyShown: false,
  dismissedBefore: false,
  desktopShell: false,
};

describe('resolvePerfNudge arm selection', () => {
  it('stays hidden on an empty id list', () => {
    expect(resolvePerfNudge(baseInput)).toEqual({ shown: false, bodyKey: null });
  });

  it('stays hidden when only non-arm diagnostics are present', () => {
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['high-dpi', 'browser-stalls', 'context-loss'],
    });
    expect(state).toEqual({ shown: false, bodyKey: null });
  });

  it('shows the web software copy for hardware-acceleration outside the shell', () => {
    const state = resolvePerfNudge({ ...baseInput, suggestionIds: ['hardware-acceleration'] });
    expect(state).toEqual({ shown: true, bodyKey: 'perfNudge.hardwareAccelerationWeb' });
  });

  it('shows the desktop software copy inside the Electron shell', () => {
    // Inside the shell "enable hardware acceleration in your browser" is
    // actively wrong advice, exactly like gpuNoticeBodyKey's split.
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['hardware-acceleration'],
      desktopShell: true,
    });
    expect(state).toEqual({ shown: true, bodyKey: 'perfNudge.hardwareAccelerationDesktop' });
  });

  it('shows the integrated-gpu copy for the hybrid-laptop arm', () => {
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['high-dpi', 'integrated-gpu'],
    });
    expect(state).toEqual({ shown: true, bodyKey: 'perfNudge.integratedGpu' });
  });

  it('lets the software arm win if both arm ids ever co-occur', () => {
    // The analyzer keeps them mutually exclusive (software wins, ruling R15);
    // the view mirrors that priority defensively.
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['integrated-gpu', 'hardware-acceleration'],
    });
    expect(state.bodyKey).toBe('perfNudge.hardwareAccelerationWeb');
  });
});

describe('resolvePerfNudge suppression and dismissal', () => {
  it('suppresses the software arm when the boot-time gpu notice already showed', () => {
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['hardware-acceleration'],
      softwareNoticeAlreadyShown: true,
    });
    expect(state).toEqual({ shown: false, bodyKey: null });
  });

  it('does not let the boot notice suppress the integrated-gpu arm', () => {
    // The suppression exists only for the redundant software double-toast
    // (ruling R16); an integrated-GPU diagnosis says something new.
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['integrated-gpu'],
      softwareNoticeAlreadyShown: true,
    });
    expect(state.shown).toBe(true);
  });

  it('never re-shows after a matching persisted dismissal', () => {
    const state = resolvePerfNudge({
      ...baseInput,
      suggestionIds: ['integrated-gpu'],
      dismissedBefore: true,
    });
    expect(state).toEqual({ shown: false, bodyKey: null });
  });

  it('dismissing hides the toast', () => {
    const shown = resolvePerfNudge({ ...baseInput, suggestionIds: ['hardware-acceleration'] });
    expect(dismissPerfNudge(shown)).toEqual({ shown: false, bodyKey: null });
  });
});

describe('perfNudgeDismissalValue', () => {
  it('keys on the nudge-relevant ids only, order-proof', () => {
    expect(perfNudgeDismissalValue(['high-dpi', 'integrated-gpu'])).toBe('integrated-gpu');
    expect(perfNudgeDismissalValue(['integrated-gpu', 'hardware-acceleration', 'low-memory'])).toBe(
      perfNudgeDismissalValue(['hardware-acceleration', 'integrated-gpu']),
    );
  });

  it('is empty when nothing nudge-worthy is present, so it can never match a stored value', () => {
    expect(perfNudgeDismissalValue([])).toBe('');
    expect(perfNudgeDismissalValue(['heap-pressure'])).toBe('');
  });

  it('changes when the triggering id set changes, which re-arms the toast', () => {
    const softwareValue = perfNudgeDismissalValue(['hardware-acceleration']);
    const integratedValue = perfNudgeDismissalValue(['integrated-gpu']);
    expect(softwareValue).not.toBe(integratedValue);
    expect(softwareValue).not.toBe('');
    expect(integratedValue).not.toBe('');
  });
});

describe('isPerfNudgeArmId', () => {
  it('accepts exactly the two machine-local arm ids', () => {
    expect([...PERF_NUDGE_ARM_IDS]).toEqual(['hardware-acceleration', 'integrated-gpu']);
    expect(isPerfNudgeArmId('hardware-acceleration')).toBe(true);
    expect(isPerfNudgeArmId('integrated-gpu')).toBe(true);
    expect(isPerfNudgeArmId('high-dpi')).toBe(false);
    expect(isPerfNudgeArmId('')).toBe(false);
  });
});

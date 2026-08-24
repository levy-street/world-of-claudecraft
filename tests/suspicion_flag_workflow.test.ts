import { describe, expect, it } from 'vitest';
import {
  allowedSuspicionFlagTransition,
  DETECTOR_FLAG_SEVERITY,
  isSuspicionFlagStatus,
  SUSPICION_FLAG_ACTIVE_STATUSES,
  SUSPICION_FLAG_STATUSES,
  severityForRegistrationBurst,
} from '../server/suspicion_flag_workflow';
import {
  allowedFlagTransitions,
  FLAG_ACTIVE_STATUSES,
  FLAG_STATUSES,
  flagGoldTrendCopper,
  isFlagStatus,
} from '../src/admin/flag_workflow';

describe('suspicion flag workflow state machine', () => {
  it('allows exactly the documented transitions', () => {
    const allowed: Record<string, string[]> = {
      new: ['under_review', 'cleared', 'actioned'],
      under_review: ['cleared', 'actioned'],
      cleared: ['under_review'],
      actioned: ['under_review'],
    };
    for (const from of SUSPICION_FLAG_STATUSES) {
      for (const to of SUSPICION_FLAG_STATUSES) {
        expect(allowedSuspicionFlagTransition(from, to), `${from} -> ${to}`).toBe(
          allowed[from].includes(to),
        );
      }
    }
  });

  it('never allows a flag to leave the record: no transition deletes, and every resolved state can reopen', () => {
    expect(allowedSuspicionFlagTransition('cleared', 'under_review')).toBe(true);
    expect(allowedSuspicionFlagTransition('actioned', 'under_review')).toBe(true);
    // A resolved flag can never silently flip straight back to new.
    expect(allowedSuspicionFlagTransition('cleared', 'new')).toBe(false);
    expect(allowedSuspicionFlagTransition('actioned', 'new')).toBe(false);
  });

  it('validates status strings strictly', () => {
    expect(isSuspicionFlagStatus('under_review')).toBe(true);
    expect(isSuspicionFlagStatus('frobnicated')).toBe(false);
    expect(isSuspicionFlagStatus(3)).toBe(false);
    expect(isSuspicionFlagStatus(null)).toBe(false);
  });

  it('pins the detector severity bar and maps burst signal counts to severities', () => {
    expect(DETECTOR_FLAG_SEVERITY).toBe('high');
    expect(severityForRegistrationBurst(1)).toBe('medium');
    expect(severityForRegistrationBurst(2)).toBe('high');
    expect(severityForRegistrationBurst(4)).toBe('high');
  });
});

describe('admin client mirror parity (src/admin/flag_workflow.ts)', () => {
  it('keeps the status vocabulary and active set in lockstep with the server', () => {
    expect([...FLAG_STATUSES]).toEqual([...SUSPICION_FLAG_STATUSES]);
    expect([...FLAG_ACTIVE_STATUSES]).toEqual([...SUSPICION_FLAG_ACTIVE_STATUSES]);
  });

  it('keeps the transition table in lockstep with the server', () => {
    for (const from of SUSPICION_FLAG_STATUSES) {
      const clientAllowed = allowedFlagTransitions(from);
      for (const to of SUSPICION_FLAG_STATUSES) {
        expect(clientAllowed.includes(to), `${from} -> ${to}`).toBe(
          allowedSuspicionFlagTransition(from, to),
        );
      }
    }
  });

  it('validates and computes the gold trend on the client', () => {
    expect(isFlagStatus('cleared')).toBe(true);
    expect(isFlagStatus('nope')).toBe(false);
    expect(flagGoldTrendCopper({ copperAtFlag: 100, copperNow: 350 })).toBe(250);
    expect(flagGoldTrendCopper({ copperAtFlag: 400, copperNow: 350 })).toBe(-50);
    expect(flagGoldTrendCopper({ copperAtFlag: null, copperNow: 350 })).toBeNull();
    expect(flagGoldTrendCopper({ copperAtFlag: 100, copperNow: null })).toBeNull();
  });
});

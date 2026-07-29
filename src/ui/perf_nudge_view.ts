// Pure view-core for the one-time performance nudge toast (DOM-free,
// Node-tested in tests/perf_nudge_view.test.ts; registered in UI_PURE_CORES).
// The thin DOM consumer is src/ui/perf_nudge_toast.ts; the suggestion ids come
// from the client perf-doctor analyzer (src/game/perf_doctor.ts), assembled by
// src/game/perf_nudge.ts after real gameplay frames (packet 0 rulings R14-R16).
//
// The nudge is the sibling of the boot-time gpu notice (gpu_notice_view.ts):
// cosmetic-only and gameplay-neutral (it hides nothing and delays nothing a
// player acts on; it only EXPLAINS a machine-local cause of bad performance and
// says what to do about it). It shows at most once per install PER CAUSE SET:
// the consumer persists the dismissal keyed by the id set that triggered it, so
// the same causes never re-nag but a NEW cause re-arms the toast.
//
// Only the two MACHINE-LOCAL analyzer arms nudge the player: software
// rendering ('hardware-acceleration') and the hybrid-laptop integrated GPU
// ('integrated-gpu'), which the analyzer keeps mutually exclusive (software
// wins, ruling R15). The other suggestion ids stay fleet diagnostics only.

export const PERF_NUDGE_ARM_IDS = ['hardware-acceleration', 'integrated-gpu'] as const;

export type PerfNudgeBodyKey =
  | 'perfNudge.integratedGpu'
  | 'perfNudge.hardwareAccelerationDesktop'
  | 'perfNudge.hardwareAccelerationWeb';

export interface PerfNudgeState {
  shown: boolean;
  bodyKey: PerfNudgeBodyKey | null;
}

/** True when a suggestion id is one of the two nudge-worthy machine-local arms. */
export function isPerfNudgeArmId(id: string): boolean {
  return (PERF_NUDGE_ARM_IDS as readonly string[]).includes(id);
}

/**
 * The persisted-dismissal VALUE for a suggestion-id set: the nudge-relevant ids,
 * sorted and joined, so the consumer can compare the stored dismissal against
 * the CURRENT trigger set. An empty string means nothing nudge-worthy, which a
 * consumer must never treat as dismissed. Sorting makes the value order-proof;
 * a changed trigger set produces a different value, which re-arms the toast.
 */
export function perfNudgeDismissalValue(suggestionIds: readonly string[]): string {
  return suggestionIds.filter(isPerfNudgeArmId).sort().join(',');
}

/**
 * Resolve the toast state from the analyzer ids plus the environment:
 * - nothing nudge-worthy in the ids: hidden;
 * - dismissedBefore (the consumer already matched the persisted dismissal
 *   against THIS id set): hidden, never re-nag;
 * - the software arm is suppressed when the boot-time gpu notice already showed
 *   this session (ruling R16; the two toasts would say the same thing twice).
 *   Suppression is FINAL, deliberately not falling through to the integrated
 *   arm: a software session's true cause is software rendering, and integrated
 *   advice would be wrong there whether or not its toast was suppressed;
 * - the software arm wins over 'integrated-gpu' if both ever co-occur,
 *   mirroring the analyzer's mutual exclusion (ruling R15);
 * - desktopShell picks the software-arm copy variant, exactly like
 *   gpuNoticeBodyKey: "enable hardware acceleration in your browser" is wrong
 *   advice inside the Electron shell.
 */
export function resolvePerfNudge(input: {
  suggestionIds: readonly string[];
  softwareNoticeAlreadyShown: boolean;
  dismissedBefore: boolean;
  desktopShell: boolean;
}): PerfNudgeState {
  const hidden: PerfNudgeState = { shown: false, bodyKey: null };
  if (input.dismissedBefore) return hidden;
  if (input.suggestionIds.includes('hardware-acceleration')) {
    if (input.softwareNoticeAlreadyShown) return hidden;
    return {
      shown: true,
      bodyKey: input.desktopShell
        ? 'perfNudge.hardwareAccelerationDesktop'
        : 'perfNudge.hardwareAccelerationWeb',
    };
  }
  if (input.suggestionIds.includes('integrated-gpu')) {
    return { shown: true, bodyKey: 'perfNudge.integratedGpu' };
  }
  return hidden;
}

/** The player closed the nudge: hide it now; the consumer persists the keyed dismissal. */
export function dismissPerfNudge(_state: PerfNudgeState): PerfNudgeState {
  return { shown: false, bodyKey: null };
}

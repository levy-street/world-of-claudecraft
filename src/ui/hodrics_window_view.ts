// Pure, host-agnostic view model for the Hodric's Castle Gauntlet window
// (opened at the Herald). The pure-core half of the pure-core + thin-painter
// split (reference: arena_window_view.ts). It decides the snapshot state
// (offline vs live), the action affordance (idle / queued / in-match), and
// what the standings section shows. DOM/i18n live in hodrics_window.ts.

import type { HcInfo, HcStandingView } from '../world_api';

/** The main action affordance for the current state. */
export type HcWindowAction =
  | { kind: 'in-match' }
  | { kind: 'queued'; position: number }
  | { kind: 'idle' };

/** The full Gauntlet window view-model: the offline notice, or the live panel. */
export type HcWindowView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      /** Null until the first race is on the books. */
      standing: HcStandingView | null;
      action: HcWindowAction;
      /** The offline practice-vs-the-court affordance is wired + applicable. */
      practice: boolean;
      /** Identity of the rendered content; the painter skips a rebuild when equal. */
      sig: string;
    };

export interface HcWindowViewInput {
  info: HcInfo | null;
  /** The offline practice hook is wired (offline only, hidden online). */
  practiceAvailable: boolean;
}

/**
 * Build the Gauntlet window view-model. `info === null` is the online
 * not-yet-synced state; the offline Sim always returns a real snapshot, so
 * both hosts produce identical output from mirrored data.
 */
export function buildHcWindowView(input: HcWindowViewInput): HcWindowView {
  const info = input.info;
  if (!info) return { kind: 'offline' };
  let action: HcWindowAction;
  if (info.match && info.match.state !== 'over') {
    action = { kind: 'in-match' };
  } else if (info.queued) {
    action = { kind: 'queued', position: info.queued.position };
  } else {
    action = { kind: 'idle' };
  }
  const practice = input.practiceAvailable && action.kind === 'idle';
  const sig = JSON.stringify([info.standing, action, practice]);
  return { kind: 'live', standing: info.standing, action, practice, sig };
}

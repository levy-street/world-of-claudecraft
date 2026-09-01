// Builds the three ContextRecoveryCallbacks attachContextRecoveryHandlers wires
// onto the game canvas: entry-diagnostics checkpoints for the fleet's crash
// probe, console breadcrumbs for a live devtools session, and (only on the
// stuck outcome) the existing fatalOverlay reload prompt. A sibling module
// rather than three closures inline in main.ts's own entry sequence, so this
// coverage can grow without growing the firewall file (src/main.ts sits at a
// pinned, zero-headroom line ceiling; see tests/monolith_budget.test.ts).
import type { ContextRecoveryCallbacks } from '../render/context_loss_recovery';
import type { EntryCheckpoint, EntryDiagnostics } from './entry_crash_guard';

export interface ContextRecoveryDiagnosticsDeps {
  entryDiagnostics: {
    checkpoint: (checkpoint: EntryCheckpoint, diagnostics?: EntryDiagnostics) => void;
  };
  renderEntryDiagnostics: () => EntryDiagnostics;
  ktx2MipsOnContextLost: () => void;
  /** Renderer's own lost-context tally BEFORE this loss (0 pre-renderer); the
   *  builder adds the +1 for the loss this callback is reporting. */
  contextLostCount: () => number;
  showFatalOverlay: (message: string) => void;
  /** Pre-localized: this module stays i18n-free like the rest of src/game. */
  stuckMessage: string;
}

export function buildContextRecoveryCallbacks(
  deps: ContextRecoveryDiagnosticsDeps,
): ContextRecoveryCallbacks {
  return {
    onLost: () => {
      deps.ktx2MipsOnContextLost();
      deps.entryDiagnostics.checkpoint('webgl-context-lost', {
        ...deps.renderEntryDiagnostics(),
        contextLost: deps.contextLostCount() + 1,
      });
      console.warn('[entry-diag] WebGL context lost during or after world entry');
    },
    onRestored: () => {
      deps.entryDiagnostics.checkpoint('webgl-context-restored');
      console.info('[entry-diag] WebGL context restored during or after world entry');
    },
    onStuck: () => {
      // The one signal that says the loss never came back, the exact
      // hypothesis attachContextRecoveryHandlers exists to test: a checkpoint
      // plus a console.error give the fleet and any live devtools session the
      // evidence to tell "lost and restored" apart from "lost forever"
      // instead of only ever seeing a DOM overlay.
      deps.entryDiagnostics.checkpoint('webgl-context-stuck', deps.renderEntryDiagnostics());
      console.error('[entry-diag] WebGL context loss did not restore; prompting a reload');
      deps.showFatalOverlay(deps.stuckMessage);
    },
  };
}

// The thin DOM half of the "restoring graphics" note (the decision is
// graphics_restore_note_view.ts): one status line, minted empty and hidden at
// install (a live region inserted together with its text is often not
// announced), filled and shown on the hold's raise, hidden on its release.
// Cold chrome: event driven, no frame work, no layout read. pointer-events
// stay off (the CSS section), so the note never takes a click the world or
// the HUD would have had.

import { onContextRestoreHoldChange } from '../render/context_restore_hold';
import { graphicsRestoreNoteView } from './graphics_restore_note_view';
import { t } from './i18n';

export const GRAPHICS_RESTORE_NOTE_ID = 'graphics-restore-note';

type HoldSubscribe = (listener: (held: boolean) => void) => () => void;

/** Mount the note under `parent` (the HUD root). Returns the teardown. */
export function installGraphicsRestoreNote(
  parent: HTMLElement,
  subscribe: HoldSubscribe = onContextRestoreHoldChange,
): () => void {
  const note = document.createElement('div');
  note.id = GRAPHICS_RESTORE_NOTE_ID;
  note.className = 'graphics-restore-note ui-pill';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.hidden = true;
  parent.appendChild(note);
  const apply = (held: boolean): void => {
    const view = graphicsRestoreNoteView(held);
    if (!view.visible) {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    // Resolved before anything shows, and at every show, so a language switch
    // between two restores needs no fan-out arm.
    const text = t(view.textKey);
    note.hidden = false;
    note.textContent = text;
  };
  const unsubscribe = subscribe(apply);
  return () => {
    unsubscribe();
    note.remove();
  };
}

// Thin DOM consumer for the tutorial island's live single-button notes.
// Hud paints the town-bell homecoming and Ferryman Odo's island welcome
// through this shared, focus-trapped window.

import { bindDialogKeyActivation } from './dialog_key_activation';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import type { TutorialGreetingNote } from './tutorial_greeting_view';

const TITLE_ID = 'tutorial-greeting-title';

/** Render one of the live single-button ferry notes in the shared dialog shell. */
export function renderTutorialGreetingNote(
  note: TutorialGreetingNote,
  deps: { onClose(): void },
): HTMLElement {
  document.getElementById('tutorial-greeting')?.remove();
  const el = document.createElement('div');
  el.id = 'tutorial-greeting';
  el.className = 'window panel';
  el.style.display = 'block';
  markDialogRoot(el, { labelledBy: TITLE_ID, modal: true });

  const speaker = tEntity({ kind: 'npc', id: note.speakerNpcId, field: 'name' });
  const speakerTitle = tEntity({ kind: 'npc', id: note.speakerNpcId, field: 'title' });
  el.innerHTML =
    `<div class="panel-title"><span id="${TITLE_ID}">${esc(speaker)}<span class="quest-muted"> &lt;${esc(speakerTitle)}&gt;</span></span></div>` +
    `<div class="cd-body"><p class="cd-para">${esc(t(note.bodyKey))}</p></div>` +
    `<div class="cd-actions"><button type="button" class="btn cd-ok" data-close>${esc(t(note.closeKey))}</button></div>`;

  document.body.appendChild(el);
  el.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => deps.onClose());
  bindDialogKeyActivation(el);
  return el;
}

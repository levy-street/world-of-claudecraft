// Thin DOM consumer for ferry welcomes and the Eastbrook guidance choice.
// Hud paints the town-bell homecoming and Ferryman Odo's island welcome
// through this shared, focus-trapped window.

import { bindDialogKeyActivation } from './dialog_key_activation';
import { markDialogRoot } from './dialog_root';
import { npcDisplayTitle } from './entity_display_core';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import type { TutorialGreetingNote } from './tutorial_greeting_view';

const TITLE_ID = 'tutorial-greeting-title';

/** Render a ferry welcome or guidance choice in the shared dialog shell. */
export function renderTutorialGreetingNote(
  note: TutorialGreetingNote,
  deps: { onClose(): void; onGuidanceChoice?(enabled: boolean): void },
): HTMLElement {
  document.getElementById('tutorial-greeting')?.remove();
  const el = document.createElement('div');
  el.id = 'tutorial-greeting';
  el.className = 'window panel';
  el.classList.toggle('guidance-choice', note.guidanceChoice === true);
  el.style.display = 'block';
  markDialogRoot(el, { labelledBy: TITLE_ID, modal: true });

  const speaker = tEntity({ kind: 'npc', id: note.speakerNpcId, field: 'name' });
  const speakerTitle = npcDisplayTitle(note.speakerNpcId);
  const actions = note.guidanceChoice
    ? `<button type="button" class="ui-btn ui-btn--gold cd-ok" data-guidance="on">${esc(t('hudChrome.tutorialGreeting.guidanceOn'))}</button>` +
      `<button type="button" class="ui-btn" data-guidance="off">${esc(t('hudChrome.tutorialGreeting.guidanceOff'))}</button>`
    : `<button type="button" class="btn cd-ok" data-close>${esc(t(note.closeKey))}</button>`;
  const paragraphs = [note.bodyKey, ...(note.extraBodyKeys ?? [])]
    .map((key) => `<p class="cd-para">${esc(t(key))}</p>`)
    .join('');
  el.innerHTML =
    `<div class="panel-title"><span id="${TITLE_ID}">${esc(speaker)}<span class="quest-muted"> &lt;${esc(speakerTitle)}&gt;</span></span></div>` +
    `<div class="cd-body">${paragraphs}</div>` +
    `<div class="cd-actions">${actions}</div>`;

  document.body.appendChild(el);
  el.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => deps.onClose());
  for (const button of el.querySelectorAll<HTMLButtonElement>('[data-guidance]')) {
    button.addEventListener('click', () => {
      deps.onGuidanceChoice?.(button.dataset.guidance === 'on');
      deps.onClose();
    });
  }
  bindDialogKeyActivation(el);
  return el;
}

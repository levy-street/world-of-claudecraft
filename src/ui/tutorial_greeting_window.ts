// Thin DOM consumer for the spawn greeting dialog (tutorial island): paints
// the once-ever choice fired by the `tutorialGreeting` event, spoken by the
// harbor-guide greeter at the Eastbrook spawn.
//
// Reuses the shared confirm-dialog modal family (the .window.panel shell plus
// the .cd-body / .cd-actions chrome, so no new styles), the
// profession_tutorial_window precedent. The pure model (which copy, which
// speaker) lives in tutorial_greeting_view.ts; this consumer only localizes
// and paints. The Hud owns the focus trap, z-index floor, and the two choice
// callbacks (play sends the IWorld command; skip just closes), since those
// need Hud state.

import { bindDialogKeyActivation } from './dialog_key_activation';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import type { TutorialGreetingModel, TutorialGreetingNote } from './tutorial_greeting_view';

export interface TutorialGreetingDeps {
  onPlay(): void;
  onSkip(): void;
}

const TITLE_ID = 'tutorial-greeting-title';

/** Build (or rebuild) the #tutorial-greeting modal from the model, wire the
 *  play/skip affordances and keyboard activation, and return the root element
 *  so the Hud can trap focus and floor its z-index. Any prior instance is
 *  removed first (the one-shot never stacks). */
export function renderTutorialGreeting(
  model: TutorialGreetingModel,
  deps: TutorialGreetingDeps,
): HTMLElement {
  document.getElementById('tutorial-greeting')?.remove();
  const el = document.createElement('div');
  el.id = 'tutorial-greeting';
  el.className = 'window panel';
  el.style.display = 'block';
  // The visible panel title is the dialog's accessible name (labelledBy), the
  // markDialogRoot convention every cold window follows.
  markDialogRoot(el, { labelledBy: TITLE_ID, modal: true });

  const speaker = tEntity({ kind: 'npc', id: model.speakerNpcId, field: 'name' });
  const speakerTitle = tEntity({ kind: 'npc', id: model.speakerNpcId, field: 'title' });
  // Name plus <Title> in the one title span, the quest-dialog gossip idiom.
  el.innerHTML =
    `<div class="panel-title"><span id="${TITLE_ID}">${esc(speaker)}<span class="quest-muted"> &lt;${esc(speakerTitle)}&gt;</span></span></div>` +
    `<div class="cd-body"><p class="cd-para">${esc(t(model.bodyKey))}</p></div>` +
    `<div class="cd-actions">` +
    `<button type="button" class="btn cd-ok" data-play>${esc(t(model.playKey))}</button>` +
    `<button type="button" class="btn" data-skip>${esc(t(model.skipKey))}</button>` +
    `</div>`;

  document.body.appendChild(el);
  el.querySelector<HTMLElement>('[data-play]')?.addEventListener('click', () => deps.onPlay());
  el.querySelector<HTMLElement>('[data-skip]')?.addEventListener('click', () => deps.onSkip());
  bindDialogKeyActivation(el);
  return el;
}

/** The single-button note variant: the same #tutorial-greeting shell (so the
 *  managed-close registry and mobile CSS cover it unchanged), one closing
 *  affordance. Used for the decline follow-up and the first bell homecoming. */
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

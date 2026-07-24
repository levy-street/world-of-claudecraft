// Thin DOM painter for the Last Bell dialogue-choice window. Cold render on
// prompt open (prompt text + option buttons for the leader, a waiting line
// for everyone else); the per-frame countdown routes through the PainterHost
// write-elision facet. Text is built with textContent (no innerHTML), so the
// interpolated leader name needs no esc(). hud.ts's controller owns event
// routing and the focus trap lifetime; this module only paints and reports
// the clicked option through `deps`.

import type { TranslationKey } from '../../i18n';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { SceneChoiceModel } from './scene_choice_view';

export interface SceneChoiceWindowDeps {
  document: Document;
  /** The HUD layer the window appends to (#ui). */
  container: HTMLElement;
  writers: PainterHostWriters;
  onAnswer(choiceId: string, optionId: string): void;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

export class SceneChoiceWindow {
  readonly root: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private readonly waitingEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  /** The choiceId the cold render was built for; a change re-renders. */
  private renderedChoiceId: string | null = null;
  private renderedIsLeader = false;

  constructor(private readonly deps: SceneChoiceWindowDeps) {
    const doc = deps.document;
    this.root = doc.createElement('div');
    this.root.className = 'scene-choice';
    this.root.style.display = 'none';
    this.promptEl = doc.createElement('div');
    this.promptEl.className = 'scene-choice-prompt';
    this.promptEl.id = 'scene-choice-prompt';
    this.optionsEl = doc.createElement('div');
    this.optionsEl.className = 'scene-choice-options';
    this.waitingEl = doc.createElement('div');
    this.waitingEl.className = 'scene-choice-waiting';
    this.timerEl = doc.createElement('div');
    this.timerEl.className = 'scene-choice-timer';
    this.root.append(this.promptEl, this.optionsEl, this.waitingEl, this.timerEl);
    deps.container.appendChild(this.root);
  }

  /** Per-frame paint. Cold parts rebuild only when the prompt (or the local
   *  player's leader role) changes; the countdown is the only hot write. */
  update(model: SceneChoiceModel, leaderName: string): void {
    const w = this.deps.writers;
    w.setDisplay(this.root, model.visible ? '' : 'none');
    if (!model.visible) {
      this.renderedChoiceId = null;
      return;
    }
    if (this.renderedChoiceId !== model.choiceId || this.renderedIsLeader !== model.isLeader) {
      this.renderedChoiceId = model.choiceId;
      this.renderedIsLeader = model.isLeader;
      this.renderPrompt(model, leaderName);
    }
    w.setText(
      this.timerEl,
      model.remainingSeconds !== null
        ? t('hudChrome.scene.timer', { seconds: formatNumber(model.remainingSeconds, NUM0) })
        : '',
    );
  }

  private renderPrompt(model: SceneChoiceModel, leaderName: string): void {
    const doc = this.deps.document;
    // Prompt and option text arrive as stable keys (S3): render t(key) directly.
    this.promptEl.textContent =
      model.promptKey !== null ? t(model.promptKey as TranslationKey) : '';
    this.optionsEl.textContent = '';
    if (model.isLeader) {
      for (const option of model.options) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'scene-choice-option';
        btn.textContent = t(option.key as TranslationKey);
        const choiceId = model.choiceId;
        btn.addEventListener('click', () => {
          if (choiceId !== null) this.deps.onAnswer(choiceId, option.id);
        });
        this.optionsEl.appendChild(btn);
      }
      this.waitingEl.style.display = 'none';
    } else {
      // Non-leaders see the same prompt but wait on the leader's answer.
      this.waitingEl.style.display = '';
      this.waitingEl.textContent = t('hudChrome.scene.waitingFor', { name: leaderName });
    }
    this.optionsEl.style.display = model.isLeader ? '' : 'none';
  }
}

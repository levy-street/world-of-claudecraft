// Thin DOM painter for the Last Bell dialogue-choice window. Cold render on
// prompt open (prompt text + option buttons for the leader, a waiting line
// for everyone else); the per-frame countdown routes through the PainterHost
// write-elision facet. Text is built with textContent (no innerHTML), so the
// interpolated leader name needs no esc(). hud.ts's controller owns event
// routing and the focus trap lifetime; this module only paints and reports
// the clicked option through `deps`.

import type { TranslationKey } from '../../i18n';
import { formatNumber, getLanguage, t } from '../../i18n';
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
  private renderedOptionStructure: { id: string; key: string }[] = [];
  private optionButtons: HTMLButtonElement[] = [];
  private renderedLanguage = '';
  private renderedPromptKey: string | null = null;
  private renderedValues: Record<string, string | number> | null = null;
  private renderedValuesSource: Record<string, string | number> | null = null;
  private renderedLeaderName = '';
  private timerLanguage = '';
  private timerSeconds: number | null = null;
  private timerText = '';

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
    const language = getLanguage();
    const structureChanged =
      this.renderedChoiceId !== model.choiceId ||
      this.renderedIsLeader !== model.isLeader ||
      !this.hasSameOptionStructure(model.options);
    if (structureChanged) {
      this.renderedChoiceId = model.choiceId;
      this.renderedIsLeader = model.isLeader;
      this.renderedOptionStructure = model.options.map(({ id, key }) => ({ id, key }));
      this.renderStructure(model);
      // Newly-created controls have no localized text yet.
      this.renderedLanguage = '';
    }
    if (
      this.renderedLanguage !== language ||
      this.renderedPromptKey !== model.promptKey ||
      (this.renderedValuesSource !== model.values &&
        !this.hasSameValues(this.renderedValues, model.values)) ||
      this.renderedLeaderName !== leaderName
    ) {
      this.renderedLanguage = language;
      this.renderedPromptKey = model.promptKey;
      this.renderedValues = model.values === null ? null : { ...model.values };
      this.renderedValuesSource = model.values;
      this.renderedLeaderName = leaderName;
      this.renderLocalizedText(model, leaderName);
    }
    if (this.timerLanguage !== language || this.timerSeconds !== model.remainingSeconds) {
      this.timerLanguage = language;
      this.timerSeconds = model.remainingSeconds;
      this.timerText =
        model.remainingSeconds !== null
          ? t('hudChrome.scene.timer', { seconds: formatNumber(model.remainingSeconds, NUM0) })
          : '';
    }
    w.setText(this.timerEl, this.timerText);
  }

  /** Invalidate the cold localized body after a live locale switch. */
  relocalize(): void {
    this.renderedLanguage = '';
    this.timerLanguage = '';
  }

  private hasSameOptionStructure(options: SceneChoiceModel['options']): boolean {
    if (this.renderedOptionStructure.length !== options.length) return false;
    for (let i = 0; i < options.length; i++) {
      const rendered = this.renderedOptionStructure[i];
      const next = options[i];
      if (rendered.id !== next.id || rendered.key !== next.key) return false;
    }
    return true;
  }

  private hasSameValues(
    rendered: Record<string, string | number> | null,
    next: Record<string, string | number> | null,
  ): boolean {
    if (rendered === null || next === null) return rendered === next;
    const renderedKeys = Object.keys(rendered);
    const nextKeys = Object.keys(next);
    if (renderedKeys.length !== nextKeys.length) return false;
    return nextKeys.every((key) => rendered[key] === next[key]);
  }

  private renderStructure(model: SceneChoiceModel): void {
    const doc = this.deps.document;
    this.optionsEl.textContent = '';
    this.optionButtons = [];
    if (model.isLeader) {
      for (const option of model.options) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'scene-choice-option';
        const choiceId = model.choiceId;
        btn.addEventListener('click', () => {
          if (choiceId !== null) this.deps.onAnswer(choiceId, option.id);
        });
        this.optionsEl.appendChild(btn);
        this.optionButtons.push(btn);
      }
      this.waitingEl.style.display = 'none';
    } else {
      this.waitingEl.style.display = '';
    }
    this.optionsEl.style.display = model.isLeader ? '' : 'none';
  }

  private renderLocalizedText(model: SceneChoiceModel, leaderName: string): void {
    // Prompt and option text arrive as stable keys (S3): render t(key) directly.
    // Numeric prompt values (the fare price) format through formatNumber.
    let promptValues: Record<string, string> | undefined;
    if (model.values !== null) {
      promptValues = {};
      for (const [k, v] of Object.entries(model.values)) {
        promptValues[k] = typeof v === 'number' ? formatNumber(v, NUM0) : v;
      }
    }
    this.promptEl.textContent =
      model.promptKey !== null ? t(model.promptKey as TranslationKey, promptValues) : '';
    if (model.isLeader) {
      for (let i = 0; i < model.options.length; i++) {
        this.optionButtons[i].textContent = t(model.options[i].key as TranslationKey);
      }
    } else {
      // Non-leaders see the same prompt but wait on the leader's answer.
      this.waitingEl.textContent = t('hudChrome.scene.waitingFor', { name: leaderName });
    }
  }
}

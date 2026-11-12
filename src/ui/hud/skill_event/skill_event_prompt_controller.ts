// The hourly skill event's join prompt: the thin controller over the pure core
// (skill_event_prompt_core.ts). It opens the HUD's shared Accept and Decline
// prompt (the party invite and duel challenge family, injected so this module
// never reaches into the Hud) with the localized warning, sends the join on
// Accept, and removes the prompt when it stops applying.

import type { SkillEventInfo } from '../../../world_api';
import { t } from '../../i18n';
import {
  answerSkillEventPrompt,
  newSkillEventPromptState,
  stepSkillEventPrompt,
} from './skill_event_prompt_core';

/** The HUD's shared prompt: text, accept label, accept, decline. */
export type ShowSkillEventPrompt = (
  text: string,
  acceptLabel: string,
  onAccept: () => void,
  onDecline: () => void,
) => HTMLElement;

export class SkillEventPromptController {
  private readonly state = newSkillEventPromptState();
  private el: HTMLElement | null = null;

  constructor(
    private readonly show: ShowSkillEventPrompt,
    private readonly join: () => void,
  ) {}

  update(info: SkillEventInfo | null): void {
    const action = stepSkillEventPrompt(this.state, info);
    if (action === 'open') {
      this.el = this.show(
        t('hud.prompts.skillEventJoin'),
        t('hud.prompts.acceptSkillEvent'),
        () => {
          answerSkillEventPrompt(this.state);
          this.el = null;
          this.join();
        },
        () => {
          answerSkillEventPrompt(this.state);
          this.el = null;
        },
      );
    } else if (action === 'close') {
      this.el?.remove();
      this.el = null;
    }
  }
}

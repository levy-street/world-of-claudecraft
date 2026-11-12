// The hourly skill event's HUD: one small composition the Hud updates on its
// medium band (the prompt) and each frame (the hearts). It owns the
// join prompt (skill_event_prompt_controller.ts) and the heart bar that stands
// in for the health bar during a heart event (heart_bar_painter.ts).

import { SKILL_EVENT_HEARTS } from '../../../sim/pvp/skill_event_rules';
import type { SkillEventInfo } from '../../../world_api';
import type { PainterHostWriters } from '../../painter_host';
import { HeartBar } from './heart_bar_painter';
import { buildHeartBarView } from './heart_bar_view';
import {
  type ShowSkillEventPrompt,
  SkillEventPromptController,
} from './skill_event_prompt_controller';

export class SkillEventHud {
  private readonly prompt: SkillEventPromptController;
  private readonly hearts: HeartBar;

  constructor(
    show: ShowSkillEventPrompt,
    join: () => void,
    writers: Pick<PainterHostWriters, 'setAttr' | 'setStyleProp'>,
  ) {
    this.prompt = new SkillEventPromptController(show, join);
    this.hearts = new HeartBar(writers);
  }

  /** The join prompt, on the Hud's medium band. */
  update(info: SkillEventInfo | null): void {
    this.prompt.update(info);
  }

  /** The heart row, every frame beside the player frame, from the viewer's own
   *  entity (its `eventHearts` rides the entity wire every tick). */
  paintHearts(hearts: number | undefined): void {
    this.hearts.paint(buildHeartBarView(hearts, SKILL_EVENT_HEARTS));
  }
}

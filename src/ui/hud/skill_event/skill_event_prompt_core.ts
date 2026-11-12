// The hourly skill event's join prompt: the PURE decision (no DOM). The sim
// says whether the prompt applies right now (SkillEventInfo.canJoin: near the
// arena, not joined, not flagged); this core turns that level into an edge, so
// the prompt opens once when a player comes into range and again only after
// they have left the range and come back. Standing nearby never re-nags, and a
// prompt that no longer applies (the player walked off, joined, flagged, or the
// event ended) is closed.

import type { SkillEventInfo } from '../../../world_api';

export interface SkillEventPromptState {
  /** The prompt applied on the last update. */
  eligible: boolean;
  /** A prompt is on screen. */
  open: boolean;
}

export function newSkillEventPromptState(): SkillEventPromptState {
  return { eligible: false, open: false };
}

export type SkillEventPromptAction = 'open' | 'close' | 'none';

/** Advance the state for this frame's readout and say what to do. */
export function stepSkillEventPrompt(
  state: SkillEventPromptState,
  info: SkillEventInfo | null,
): SkillEventPromptAction {
  const eligible = info?.canJoin === true;
  const was = state.eligible;
  state.eligible = eligible;
  if (eligible && !was && !state.open) {
    state.open = true;
    return 'open';
  }
  if (!eligible && state.open) {
    state.open = false;
    return 'close';
  }
  return 'none';
}

/** The player answered (or the prompt timed out): it is no longer on screen. */
export function answerSkillEventPrompt(state: SkillEventPromptState): void {
  state.open = false;
}

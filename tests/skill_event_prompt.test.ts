// The skill event join prompt's pure core (src/ui/hud/skill_event/
// skill_event_prompt_core.ts): it opens on the edge into range, never re-opens
// while the player stays near, closes when it stops applying, and opens again
// only after the player leaves and comes back.

import { describe, expect, it } from 'vitest';
import {
  answerSkillEventPrompt,
  buildHeartBarView,
  newSkillEventPromptState,
  stepSkillEventPrompt,
} from '../src/ui/hud/skill_event';
import type { SkillEventInfo } from '../src/world_api';

function info(canJoin: boolean): SkillEventInfo {
  return {
    kind: 'riposte',
    phase: 'warning',
    zoneId: 'galecrest',
    x: 0,
    z: 0,
    radius: 25,
    fieldRadius: 25,
    minutesLeft: 4,
    joined: false,
    canJoin,
    participants: 0,
    yourKills: 0,
    score: null,
    hearts: null,
    maxHearts: 4,
    kit: null,
    stones: null,
    hand: null,
  };
}

describe('skill event join prompt', () => {
  it('opens once on coming into range and stays quiet while near', () => {
    const state = newSkillEventPromptState();
    expect(stepSkillEventPrompt(state, null)).toBe('none');
    expect(stepSkillEventPrompt(state, info(false))).toBe('none');
    expect(stepSkillEventPrompt(state, info(true))).toBe('open');
    expect(stepSkillEventPrompt(state, info(true))).toBe('none');
    // Declined: still near, still not shown again.
    answerSkillEventPrompt(state);
    expect(stepSkillEventPrompt(state, info(true))).toBe('none');
  });

  it('closes an open prompt the moment it stops applying', () => {
    const state = newSkillEventPromptState();
    expect(stepSkillEventPrompt(state, info(true))).toBe('open');
    expect(stepSkillEventPrompt(state, info(false))).toBe('close');
    expect(stepSkillEventPrompt(state, null)).toBe('none');
  });

  it('opens again after the player leaves the range and comes back', () => {
    const state = newSkillEventPromptState();
    expect(stepSkillEventPrompt(state, info(true))).toBe('open');
    answerSkillEventPrompt(state);
    expect(stepSkillEventPrompt(state, info(false))).toBe('none');
    expect(stepSkillEventPrompt(state, info(true))).toBe('open');
  });
});

describe('skill event heart bar', () => {
  it('shows only while the viewer carries hearts', () => {
    expect(buildHeartBarView(undefined, 4).show).toBe(false);
    expect(buildHeartBarView(3, 4)).toEqual({ show: true, filled: 3, max: 4 });
    expect(buildHeartBarView(0, 4)).toEqual({ show: true, filled: 0, max: 4 });
    expect(buildHeartBarView(3, 0).show).toBe(false);
  });

  it('clamps the hearts into the bar', () => {
    expect(buildHeartBarView(9, 4).filled).toBe(4);
    expect(buildHeartBarView(-2, 4).filled).toBe(0);
    expect(buildHeartBarView(Number.NaN, 4).show).toBe(false);
  });
});

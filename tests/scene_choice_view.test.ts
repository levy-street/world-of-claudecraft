// Last Bell dialogue-choice view core (src/ui/hud/scene/scene_choice_view.ts):
// leader vs non-leader presentation, the response-window countdown, and
// close-on-result.

import { describe, expect, it } from 'vitest';
import {
  choicePromptOpen,
  choiceResolve,
  createSceneChoiceState,
  type SceneChoicePrompt,
  sceneChoiceView,
} from '../src/ui/hud/scene/scene_choice_view';

const PROMPT: SceneChoicePrompt = {
  choiceId: 'lb_c1',
  promptKey: 'lb.q0.choice1.prompt',
  options: [
    { id: 'stand', key: 'lb.q0.choice1.stand' },
    { id: 'run', key: 'lb.q0.choice1.run' },
  ],
  windowSeconds: 20,
  defaultOptionId: 'stand',
  leaderPid: 42,
};

describe('scene choice view', () => {
  it('is hidden until a prompt opens', () => {
    const s = createSceneChoiceState();
    const m = sceneChoiceView(s, 0, 42);
    expect(m.visible).toBe(false);
    expect(m.promptKey).toBeNull();
    expect(m.options).toHaveLength(0);
  });

  it('the leader sees clickable options; everyone else waits on the leader', () => {
    const s = createSceneChoiceState();
    choicePromptOpen(s, PROMPT, 100);
    const leader = sceneChoiceView(s, 100, 42);
    expect(leader.visible).toBe(true);
    expect(leader.isLeader).toBe(true);
    expect(leader.promptKey).toBe('lb.q0.choice1.prompt');
    expect(leader.options.map((o) => o.id)).toEqual(['stand', 'run']);
    const member = sceneChoiceView(s, 100, 43);
    expect(member.visible).toBe(true);
    expect(member.isLeader).toBe(false);
    expect(member.leaderPid).toBe(42);
    // Same prompt and options are broadcast to everyone (spec: the selection
    // is shared); only the clickability differs.
    expect(member.options.map((o) => o.key)).toEqual(['lb.q0.choice1.stand', 'lb.q0.choice1.run']);
  });

  it('counts the response window down in whole seconds and floors at 0', () => {
    const s = createSceneChoiceState();
    choicePromptOpen(s, PROMPT, 100);
    expect(sceneChoiceView(s, 100, 42).remainingSeconds).toBe(20);
    expect(sceneChoiceView(s, 105.5, 42).remainingSeconds).toBe(15);
    expect(sceneChoiceView(s, 119.99, 42).remainingSeconds).toBe(1);
    expect(sceneChoiceView(s, 125, 42).remainingSeconds).toBe(0);
  });

  it('an unbounded window (windowSeconds 0) has no countdown', () => {
    const s = createSceneChoiceState();
    choicePromptOpen(s, { ...PROMPT, windowSeconds: 0 }, 100);
    expect(sceneChoiceView(s, 150, 42).remainingSeconds).toBeNull();
  });

  it('closes on the matching result and ignores a foreign one', () => {
    const s = createSceneChoiceState();
    choicePromptOpen(s, PROMPT, 100);
    expect(choiceResolve(s, 'some_other_choice')).toBe(false);
    expect(sceneChoiceView(s, 101, 42).visible).toBe(true);
    expect(choiceResolve(s, 'lb_c1')).toBe(true);
    expect(sceneChoiceView(s, 101, 42).visible).toBe(false);
    // A second result for the same id is a no-op (already closed).
    expect(choiceResolve(s, 'lb_c1')).toBe(false);
  });

  it('a newer prompt replaces a stale one and restarts the countdown', () => {
    const s = createSceneChoiceState();
    choicePromptOpen(s, PROMPT, 100);
    choicePromptOpen(s, { ...PROMPT, choiceId: 'lb_c2', windowSeconds: 10 }, 130);
    const m = sceneChoiceView(s, 131, 42);
    expect(m.choiceId).toBe('lb_c2');
    expect(m.remainingSeconds).toBe(9);
  });

  it('returns the same reused model container across frames', () => {
    const s = createSceneChoiceState();
    expect(sceneChoiceView(s, 0, 1)).toBe(sceneChoiceView(s, 1, 1));
  });
});

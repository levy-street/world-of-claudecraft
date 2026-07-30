// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import type { SceneChoiceState } from '../src/ui/hud/scene/scene_choice_view';
import { SceneHudController } from '../src/ui/hud/scene/scene_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';

describe('SceneHudController reconnect convergence', () => {
  let container: HTMLElement;
  let calls: { method: string; args: unknown[] }[];

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
    calls = [];
  });

  function makeController(initialNow = 1) {
    let now = initialNow;
    const writers: PainterHostWriters = {
      setText: (el, text) => calls.push({ method: 'setText', args: [el, text] }),
      setDisplay: (el, display) => calls.push({ method: 'setDisplay', args: [el, display] }),
      setTransform: (el, transform) =>
        calls.push({ method: 'setTransform', args: [el, transform] }),
      setWidth: (el, width) => calls.push({ method: 'setWidth', args: [el, width] }),
      setStyleProp: (el, prop, value) =>
        calls.push({ method: 'setStyleProp', args: [el, prop, value] }),
      toggleClass: (el, cls, on) => calls.push({ method: 'toggleClass', args: [el, cls, on] }),
      setAttr: (el, name, value) => calls.push({ method: 'setAttr', args: [el, name, value] }),
    };
    const trap = {
      focusFirst: vi.fn(),
      release: vi.fn(),
    };
    const world = {
      playerId: 7,
      entities: new Map(),
      answerSceneChoice: vi.fn(),
    } as unknown as IWorld;
    const openFocusTrap = vi.fn(() => trap);
    const controller = new SceneHudController({
      document,
      container,
      writers,
      world: () => world,
      now: () => now,
      openFocusTrap,
      skip: vi.fn(),
    });
    return {
      controller,
      openFocusTrap,
      setNow(value: number) {
        now = value;
      },
      trap,
    };
  }

  it('restores authoritative cinematic and leader prompt state, then tears both down', () => {
    const { controller, openFocusTrap, trap } = makeController();
    controller.onEvent({
      type: 'sceneSync',
      state: {
        sceneId: 'sc_active',
        remainingSeconds: 5,
        inputLocked: true,
        letterbox: true,
        musicSilenced: true,
      },
    } as SimEvent);
    controller.onEvent({
      type: 'sceneChoiceSync',
      state: {
        choiceId: 'ch_active',
        promptKey: 'lb.fare.promptOut',
        options: [
          { id: 'pay', key: 'lb.fare.pay' },
          { id: 'decline', key: 'lb.fare.decline' },
        ],
        values: { price: 12 },
        defaultOptionId: 'decline',
        leaderPid: 7,
        windowSeconds: 8,
        remainingSeconds: 6,
      },
    } as SimEvent);
    controller.update();

    expect(
      calls.some(
        (call) =>
          call.method === 'toggleClass' &&
          call.args[0] === document.body &&
          call.args[1] === 'cinematic-mode' &&
          call.args[2] === true,
      ),
    ).toBe(true);
    expect(openFocusTrap).toHaveBeenCalledTimes(1);
    expect(trap.focusFirst).toHaveBeenCalledWith('.scene-choice-option');

    controller.onEvent({ type: 'sceneSync', state: null } as SimEvent);
    controller.onEvent({ type: 'sceneChoiceSync', state: null } as SimEvent);
    controller.update();

    expect(trap.release).toHaveBeenCalledTimes(1);
    expect(
      calls.some(
        (call) =>
          call.method === 'toggleClass' &&
          call.args[0] === document.body &&
          call.args[1] === 'cinematic-mode' &&
          call.args[2] === false,
      ),
    ).toBe(true);
  });

  it('expires subtitles only when the injected world clock reaches their deadline', () => {
    const { controller, setNow } = makeController(13.99);
    controller.onEvent({
      type: 'scene',
      sceneId: 'sc_clocked_subtitle',
      pid: 7,
      presentationTime: 10,
      op: {
        kind: 'line',
        speaker: 'lb.speaker.tam',
        speakerEntityId: null,
        key: 'lb.q0.coalfast.look',
        dur: 4,
      },
    } as SimEvent);

    controller.update();
    expect(
      calls.some(
        (call) =>
          call.method === 'setDisplay' &&
          (call.args[0] as HTMLElement).classList.contains('scene-subtitle') &&
          call.args[1] === '',
      ),
    ).toBe(true);

    calls = [];
    setNow(14);
    controller.update();
    expect(
      calls.some(
        (call) =>
          call.method === 'setDisplay' &&
          (call.args[0] as HTMLElement).classList.contains('scene-subtitle') &&
          call.args[1] === 'none',
      ),
    ).toBe(true);
  });

  it('anchors a queued choice to its event-batch clock instead of drain time', () => {
    const { controller } = makeController(14);
    controller.onEvent({
      type: 'sceneChoice',
      choiceId: 'choice_stalled',
      pid: 7,
      presentationTime: 10,
      promptKey: 'lb.q0.coalfast.look',
      options: [{ id: 'go', key: 'lb.q0.coalfast.look' }],
      windowSeconds: 8,
      defaultOptionId: 'go',
      leaderPid: 7,
    });

    const choice = (controller as unknown as { choice: SceneChoiceState }).choice;
    expect(choice.deadlineAt).toBe(18);
    expect(choice.model.remainingSeconds).toBe(4);
  });
});

// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneChoiceModel } from '../src/ui/hud/scene/scene_choice_view';
import { SceneChoiceWindow } from '../src/ui/hud/scene/scene_choice_window';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';

const writers: PainterHostWriters = {
  setText: (el, text) => {
    el.textContent = text;
  },
  setDisplay: (el, display) => {
    el.style.display = display;
  },
  setTransform: (el, transform) => {
    el.style.transform = transform;
  },
  setWidth: (el, width) => {
    el.style.width = width;
  },
  setStyleProp: (el, prop, value) => {
    el.style.setProperty(prop, value);
  },
  toggleClass: (el, cls, on) => {
    el.classList.toggle(cls, on);
  },
  setAttr: (el, name, value) => {
    el.setAttribute(name, value);
  },
};

function model(over: Partial<SceneChoiceModel> = {}): SceneChoiceModel {
  return {
    visible: true,
    choiceId: 'lb_shared_choice',
    promptKey: 'lb.fare.promptOut',
    values: { price: 12 },
    options: [
      { id: 'pay', key: 'lb.fare.pay' },
      { id: 'decline', key: 'lb.fare.decline' },
    ],
    isLeader: true,
    leaderPid: 7,
    remainingSeconds: 8,
    ...over,
  };
}

describe('SceneChoiceWindow retained controls', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('es');
  });

  beforeEach(() => {
    setLanguage('en');
    document.body.replaceChildren();
  });

  afterEach(() => {
    setLanguage('en');
  });

  function makeWindow() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onAnswer = vi.fn();
    const window = new SceneChoiceWindow({ document, container, writers, onAnswer });
    return { window, onAnswer };
  }

  it('relocalizes option text without replacing or unfocusing the active button', () => {
    const { window } = makeWindow();
    const current = model({
      promptKey: 'hudChrome.finder.chooseActivities',
      values: null,
      options: [
        { id: 'pay', key: 'hudChrome.finder.accept' },
        { id: 'decline', key: 'hudChrome.finder.decline' },
      ],
    });
    window.update(current, 'Leader');
    const buttons = [...window.root.querySelectorAll<HTMLButtonElement>('.scene-choice-option')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Accept', 'Decline']);
    buttons[1].focus();

    setLanguage('es');
    window.relocalize();
    window.update(current, 'Leader');

    const repainted = [...window.root.querySelectorAll<HTMLButtonElement>('.scene-choice-option')];
    expect(repainted[0]).toBe(buttons[0]);
    expect(repainted[1]).toBe(buttons[1]);
    expect(repainted.map((button) => button.textContent)).toEqual(['Aceptar', 'Rechazar']);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('repaints changed interpolation values without rebuilding the option structure', () => {
    const { window } = makeWindow();
    window.update(model({ values: { price: 12 } }), 'Leader');
    const button = window.root.querySelector<HTMLButtonElement>('.scene-choice-option');
    const firstPrompt = window.root.querySelector('.scene-choice-prompt')?.textContent;

    window.update(model({ values: { price: 13 } }), 'Leader');

    expect(window.root.querySelector<HTMLButtonElement>('.scene-choice-option')).toBe(button);
    expect(window.root.querySelector('.scene-choice-prompt')?.textContent).not.toBe(firstPrompt);
  });

  it('rebuilds controls when the ordered option structure changes', () => {
    const { window, onAnswer } = makeWindow();
    window.update(model(), 'Leader');
    const first = window.root.querySelector<HTMLButtonElement>('.scene-choice-option');

    window.update(
      model({
        options: [
          { id: 'decline', key: 'lb.fare.decline' },
          { id: 'pay', key: 'lb.fare.pay' },
        ],
      }),
      'Leader',
    );

    const replacement = window.root.querySelector<HTMLButtonElement>('.scene-choice-option');
    expect(replacement).not.toBe(first);
    replacement?.click();
    expect(onAnswer).toHaveBeenCalledWith('lb_shared_choice', 'decline');
  });
});

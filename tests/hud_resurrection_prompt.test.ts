// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

interface PromptHarness {
  promptSequence: number;
  resurrectionPromptEl: HTMLElement | null;
  showPrompt(
    text: string,
    acceptLabel: string,
    onAccept: () => void,
    onDecline: () => void,
    declineLabel: string,
    onTimeout: () => void,
    focusFirst: boolean,
  ): HTMLElement;
  closeResurrectionPrompt(): void;
}

function harness(): PromptHarness {
  const hud = Object.create(Hud.prototype) as unknown as PromptHarness;
  hud.promptSequence = 0;
  hud.resurrectionPromptEl = null;
  return hud;
}

describe('HUD resurrection confirmation prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="prompt-stack"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('is an accessible yes/no dialog, focuses Yes, and accepts only after the click', () => {
    const hud = harness();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const prompt = hud.showPrompt(
      'A mage wants to resurrect you.',
      'Yes',
      onAccept,
      onDecline,
      'No',
      vi.fn(),
      true,
    );

    expect(prompt.getAttribute('role')).toBe('alertdialog');
    expect(prompt.getAttribute('aria-modal')).toBe('false');
    const titleId = prompt.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toBe(
      'A mage wants to resurrect you.',
    );
    const [accept, decline] = [...prompt.querySelectorAll('button')];
    expect(accept.textContent).toBe('Yes');
    expect(decline.textContent).toBe('No');
    expect(document.activeElement).toBe(accept);
    expect(onAccept).not.toHaveBeenCalled();

    accept.click();
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDecline).not.toHaveBeenCalled();
    expect(prompt.isConnected).toBe(false);
  });

  it('removes the previous resurrection prompt before replacing it', () => {
    const hud = harness();
    const previous = document.createElement('div');
    document.querySelector('#prompt-stack')?.appendChild(previous);
    hud.resurrectionPromptEl = previous;

    hud.closeResurrectionPrompt();

    expect(previous.isConnected).toBe(false);
    expect(hud.resurrectionPromptEl).toBe(null);
  });
});

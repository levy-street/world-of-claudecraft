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

  it('an offer arriving while the player is alive never paints a prompt', () => {
    // Online, a rez can complete against a player who is no longer dead (they
    // released, respawned, or took another healer's rez while this cast was in
    // flight). The arm used to show the centred prompt unconditionally, and
    // the per-frame `!p.dead` closer removed it on the very next frame: a
    // one-frame dark-panel flash at 34% centre, and an offer that was
    // unanswerable anyway (the sim keeps offers only for dead players).
    const hud = eventHarness({ dead: false });

    hud.handleEvents([offerEvent()]);

    expect(document.querySelector('#prompt-stack')?.childElementCount).toBe(0);
    expect(hud.resurrectionPromptEl).toBe(null);
  });

  it('an offer arriving while dead still shows the prompt', () => {
    // The guard must not eat the real thing: the normal online order delivers
    // the death snapshot ticks before any rez can finish casting.
    const hud = eventHarness({ dead: true });

    hud.handleEvents([offerEvent()]);

    expect(document.querySelector('#prompt-stack')?.childElementCount).toBe(1);
    expect(hud.resurrectionPromptEl).not.toBe(null);
  });
});

// A minimal Hud able to run the handleEvents resurrectionOffer arm (the
// noticeboard suite's Object.create idiom; stub every field the drain touches).
interface EventHarness {
  sim: {
    playerId: number;
    player: { dead: boolean; pos: { x: number; z: number } };
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
  };
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  showBanner: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  promptSequence: number;
  resurrectionPromptEl: HTMLElement | null;
  handleEvents(events: unknown[]): void;
}

function eventHarness(player: { dead: boolean }): EventHarness {
  const hud = Object.create(Hud.prototype) as unknown as EventHarness;
  hud.sim = {
    playerId: 17,
    player: { dead: player.dead, pos: { x: 0, z: 0 } },
    craftingIdentity: { synced: false },
    craftSkills: {},
  };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.showBanner = vi.fn();
  hud.log = vi.fn();
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  hud.promptSequence = 0;
  hud.resurrectionPromptEl = null;
  return hud;
}

function offerEvent(): unknown {
  return { type: 'resurrectionOffer', fromName: 'Lumina', pid: 17 };
}

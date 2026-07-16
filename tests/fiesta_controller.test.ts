// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FiestaController } from '../src/ui/hud/fiesta/fiesta_controller';
import type { FiestaMatchInfo, IWorld } from '../src/world_api';

function match(overrides: Partial<FiestaMatchInfo> = {}): FiestaMatchInfo {
  return {
    team: 'A',
    scoreA: 0,
    scoreB: 0,
    myScore: 0,
    theirScore: 0,
    scoreLimit: 3,
    wave: 1,
    totalWaves: 3,
    ring: { cx: 0, cz: 0, radius: 20 },
    down: false,
    respawnIn: 0,
    augments: [],
    offer: null,
    augmentPending: 0,
    teamA: [{ pid: 1, name: 'Aki', cls: 'warrior', kills: 0, down: false, me: true }],
    teamB: [{ pid: 2, name: 'Bex', cls: 'mage', kills: 0, down: false, me: false }],
    powerups: [],
    ...overrides,
  };
}

function harness() {
  document.body.innerHTML = `
    <div id="ui">
      <div id="fiesta-score"></div>
      <div id="fiesta-respawn"></div>
      <div id="fiesta-augments"></div>
      <div id="fiesta-pending"></div>
    </div>`;
  const ui = document.getElementById('ui') as HTMLElement;
  const score = document.getElementById('fiesta-score') as HTMLElement;
  const respawn = document.getElementById('fiesta-respawn') as HTMLElement;
  const augments = document.getElementById('fiesta-augments') as HTMLElement;
  const pending = document.getElementById('fiesta-pending') as HTMLElement;
  const fiesta = match();
  const arenaInfo: {
    match: { state: 'active' | 'over'; fiesta: FiestaMatchInfo };
  } = {
    match: {
      state: 'active',
      fiesta,
    },
  };
  const arenaAugmentPick = vi.fn();
  const world = {
    arenaInfo,
    arenaAugmentPick,
  } as unknown as Pick<IWorld, 'arenaInfo' | 'arenaAugmentPick'>;
  const audio = {
    click: vi.fn(),
    scorePing: vi.fn(),
    revive: vi.fn(),
  };
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const controller = new FiestaController({
    document,
    world: () => world,
    audio,
    crestIconUrl: (playerClass) => `crest:${playerClass}`,
    random: () => 0.5,
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
  });
  return {
    controller,
    document,
    ui,
    score,
    respawn,
    augments,
    pending,
    fiesta,
    arenaInfo,
    audio,
    scheduled,
    arenaAugmentPick,
  };
}

describe('FiestaController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('paints the active authoritative score without firing a synthetic score cue', () => {
    const test = harness();

    test.controller.update();

    expect(test.controller.isActive()).toBe(true);
    expect(test.score.innerHTML).toContain('fs-core');
    expect(test.audio.scorePing).not.toHaveBeenCalled();
  });

  it('cues and flashes only after a real score transition', () => {
    const test = harness();
    test.controller.update();
    test.fiesta.scoreA = 1;
    test.fiesta.myScore = 1;

    test.controller.update();

    expect(test.audio.scorePing).toHaveBeenCalledWith(true);
    expect(test.score.classList.contains('flash-mine')).toBe(true);
    expect(
      Array.from(test.ui.children).some((child) => child.classList.contains('fiesta-confetti')),
    ).toBe(true);
    expect(test.scheduled.some(({ delayMs }) => delayMs === 2800)).toBe(true);
  });

  it('plays the revive cue only on the down-to-alive transition', () => {
    const test = harness();
    test.fiesta.down = true;
    test.fiesta.respawnIn = 4;
    test.controller.update();
    expect(test.respawn.style.display).toBe('flex');

    test.fiesta.down = false;
    test.fiesta.respawnIn = 0;
    test.controller.update();

    expect(test.audio.revive).toHaveBeenCalledTimes(1);
    expect(test.respawn.style.display).toBe('none');
  });

  it('tears down every transient surface when the mirrored match stops', () => {
    const test = harness();
    test.controller.update();
    test.arenaInfo.match.state = 'over';

    test.controller.update();

    expect(test.controller.isActive()).toBe(false);
    for (const element of [test.score, test.respawn, test.augments, test.pending]) {
      expect(element.style.display).toBe('none');
      expect(element.innerHTML).toBe('');
    }
  });

  it('localizes word metadata and owns the timed word-pop lifetime', () => {
    const test = harness();
    const parts = test.controller.wordParts('spree', 5);

    test.controller.wordPop(parts.text, parts.color, parts.tier);

    const pop = Array.from(test.ui.children).find((child) =>
      child.classList.contains('fiesta-word'),
    );
    expect(pop?.textContent).toBe(parts.text);
    expect(test.scheduled.at(-1)?.delayMs).toBe(1400);
  });

  it('renders the authoritative augment offer and submits one selected choice', () => {
    const test = harness();
    test.fiesta.offer = {
      tier: 'silver',
      wave: 1,
      choices: ['aug_brutality', 'aug_toughness', 'aug_keen_eye'],
    };

    test.controller.update();

    const cards = test.augments.querySelectorAll<HTMLButtonElement>('.fa-card');
    expect(cards).toHaveLength(3);
    cards[1].click();
    expect(test.arenaAugmentPick).toHaveBeenCalledWith('aug_toughness');
    expect(test.audio.click).toHaveBeenCalledTimes(1);
    expect(test.augments.style.display).toBe('none');
    expect(test.augments.innerHTML).toBe('');
  });
});

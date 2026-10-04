// @vitest-environment happy-dom
// Tibbs' shift offer in the quest dialog: his lines, Take the shift (the
// sim's targeted interact on him), and Not today (his answer, then closed).
import { describe, expect, it, vi } from 'vitest';
import { TIBBS_ENTITY_ID, TIBBS_NPC_ID } from '../src/sim/graveyard_shift/grave_entry';
import type { Entity } from '../src/sim/types';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { QuestDialogController } from '../src/ui/hud/quest/quest_dialog_controller';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

// Importing the dialog pulls in a module whose three.js loader may finish a
// download after this file's environment is torn down (under a loaded run):
// happy-dom has no ProgressEvent, so give the late callback one to build.
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event {
  constructor(type: string, init?: EventInit) {
    super(type, init);
  }
};

function harness(deedsEarned = new Map<string, string>()) {
  setLanguage('en');
  document.body.innerHTML = '';
  const element = document.createElement('div');
  element.id = 'quest-dialog';
  document.body.appendChild(element);
  const tibbs = {
    id: TIBBS_ENTITY_ID,
    kind: 'npc',
    templateId: TIBBS_NPC_ID,
    pos: { x: 0, y: 0, z: 0 },
    questIds: [],
    vendorItems: [],
  } as unknown as Entity;
  const targetEntity = vi.fn();
  const interact = vi.fn();
  const world = {
    entities: new Map([[tibbs.id, tibbs]]),
    cfg: { playerClass: 'warrior' },
    player: { name: 'Ari', pos: { x: 0, y: 0, z: 0 } },
    questLog: new Map(),
    questsDone: new Set<string>(),
    deedsEarned,
    clueHunt: null,
    targetEntity,
    interact,
  } as unknown as IWorld;
  const trap: FocusTrapHandle = {
    release: vi.fn(),
    focusFirst: vi.fn(),
    opener: vi.fn(() => null),
  };
  const noop = vi.fn();
  const controller = new QuestDialogController({
    element,
    document,
    world: () => world,
    now: () => 1_000,
    text: {
      npcName: () => 'Tibbs',
      mobName: (id) => id,
      npcTitle: () => 'Mob Union Rep',
      npcGreeting: () => 'Hello',
      delveName: (id) => id,
      questTitle: (id) => id,
      questNarrative: (id) => id,
      objectiveLabel: (id) => id,
      number: String,
      progress: (label) => label,
      suggestedPlayers: () => '',
      money: String,
    },
    openFocusTrap: () => trap,
    closeTransient: noop,
    hideTooltip: noop,
    itemIcon: () => '<img>',
    itemTooltip: () => '',
    attachTooltip: noop,
    openChronicles: noop,
    openVendor: noop,
    openHeroicVendor: noop,
    openCrucibleVendor: noop,
    openWarfareVendor: noop,
    openMarket: noop,
    openWorldQuestBoard: noop,
    openDelveBoard: noop,
    openCardDuel: noop,
    openTrain: noop,
    openUnbind: noop,
    openCrafting: noop,
    onOpenChange: noop,
    voice: { play: noop, isPlaying: vi.fn(() => false), setDistance: noop },
  });
  return { controller, element, targetEntity, interact };
}

describe("Tibbs' shift offer", () => {
  it('shows his pitch under his name and title with the two choices', () => {
    const { controller, element } = harness();
    controller.open(TIBBS_ENTITY_ID);
    expect(element.style.display).toBe('block');
    expect(element.querySelector('#quest-dialog-title')?.textContent).toContain('Tibbs');
    expect(element.querySelector('#quest-dialog-title')?.textContent).toContain('Mob Union Rep');
    const lines = [...element.querySelectorAll('.qd-text')].map((el) => el.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('four thousand eight hundred times');
    // One speech in paragraphs, not a stack of quoted lines.
    expect(lines.some((line) => line?.includes('"'))).toBe(false);
    expect(element.querySelector('[data-gshift-accept]')?.textContent).toBe('Take the shift');
    expect(element.querySelector('[data-gshift-decline]')?.textContent).toBe('Not today');
  });

  it('Take the shift targets Tibbs and interacts, then closes', () => {
    const { controller, element, targetEntity, interact } = harness();
    controller.open(TIBBS_ENTITY_ID);
    element.querySelector<HTMLButtonElement>('[data-gshift-accept]')!.click();
    expect(targetEntity).toHaveBeenCalledWith(TIBBS_ENTITY_ID);
    expect(interact).toHaveBeenCalledOnce();
    expect(targetEntity.mock.invocationCallOrder[0]).toBeLessThan(
      interact.mock.invocationCallOrder[0],
    );
    expect(element.style.display).not.toBe('block');
  });

  it('Not today answers in his voice, stays up through a refresh, and closes on continue', () => {
    const { controller, element, interact } = harness();
    controller.open(TIBBS_ENTITY_ID);
    element.querySelector<HTMLButtonElement>('[data-gshift-decline]')!.click();
    expect(interact).not.toHaveBeenCalled();
    const reply = () => [...element.querySelectorAll('.qd-text')].map((el) => el.textContent);
    expect(reply()).toEqual(['"Fair. Nobody reads the job description either."']);
    controller.refresh();
    controller.refreshIfChanged();
    expect(reply()).toEqual(['"Fair. Nobody reads the job description either."']);
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button.btn')];
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(element.style.display).not.toBe('block');
  });

  it('after the win he only says the shift is covered: no Take the shift, Continue closes', () => {
    const { controller, element, interact } = harness(
      new Map([['hid_boss_for_a_day', '2026-10-04']]),
    );
    controller.open(TIBBS_ENTITY_ID);
    const lines = [...element.querySelectorAll('.qd-text')].map((el) => el.textContent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '"Your shift is covered. Morthen is back at work, and he says thank you."',
    );
    expect(element.querySelector('[data-gshift-accept]')).toBeNull();
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button.btn')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Continue']);
    buttons[0].click();
    expect(interact).not.toHaveBeenCalled();
    expect(element.style.display).not.toBe('block');
  });
});

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELVES, NPCS, STATIONS } from '../src/sim/data';
import { CHRONICLER_TEMPLATE_IDS } from '../src/sim/deeds';
import type { Entity } from '../src/sim/types';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { QuestDialogController } from '../src/ui/hud/quest/quest_dialog_controller';
import type { IWorld } from '../src/world_api';

function npc(id: number, templateId: string, x = 0): Entity {
  return {
    id,
    kind: 'npc',
    templateId,
    pos: { x, y: 0, z: 0 },
    questIds: [],
    vendorItems: [],
  } as unknown as Entity;
}

function ordinaryNpcId(): string {
  const chroniclers = new Set(CHRONICLER_TEMPLATE_IDS as readonly string[]);
  const entry = Object.values(NPCS).find(
    (definition) => !definition.banker && !chroniclers.has(definition.id),
  );
  if (!entry) throw new Error('ordinary NPC fixture not found');
  return entry.id;
}

function harness(entity = npc(10, ordinaryNpcId()), questState = 'available') {
  document.body.innerHTML = '';
  const element = document.createElement('div');
  element.id = 'quest-dialog';
  document.body.appendChild(element);
  const entities = new Map([[entity.id, entity]]);
  const targetEntity = vi.fn();
  const interact = vi.fn();
  const acceptLinkedQuest = vi.fn();
  const acceptQuest = vi.fn();
  const turnInQuest = vi.fn();
  const reportTelemetry = vi.fn();
  const world = {
    entities,
    cfg: { playerClass: 'warrior' },
    player: { name: 'Ari', pos: { x: 0, y: 0, z: 0 } },
    questLog: new Map(),
    partyInfo: null,
    craftingIdentity: {
      version: 1,
      synced: true,
      craftSkills: {},
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
      switchCount: 0,
      amendsProgress: 0,
      amendsRequired: 5,
    },
    questState: vi.fn(() => questState),
    targetEntity,
    interact,
    acceptLinkedQuest,
    acceptQuest,
    turnInQuest,
    reportTelemetry,
  } as unknown as IWorld;
  const release = vi.fn();
  const focusFirst = vi.fn();
  const trap: FocusTrapHandle = { release, focusFirst };
  const voice = {
    play: vi.fn(),
    isPlaying: vi.fn(() => true),
    setDistance: vi.fn(),
  };
  const openChronicles = vi.fn();
  const openVendor = vi.fn();
  const openHeroicVendor = vi.fn();
  const openMarket = vi.fn();
  const openDelveBoard = vi.fn();
  const openValeCup = vi.fn();
  const openCardDuel = vi.fn();
  const openTrain = vi.fn();
  const controller = new QuestDialogController({
    element,
    document,
    world: () => world,
    now: () => 1_000,
    text: {
      npcName: (id) => `npc:${id}`,
      mobName: (id) => `mob:${id}`,
      npcTitle: () => 'Title',
      npcGreeting: () => 'Hello',
      delveName: (id) => `delve:${id}`,
      questTitle: (id) => `quest:${id}`,
      questNarrative: (id, field) => `${field}:${id}`,
      objectiveLabel: (id, index) => `objective:${id}:${index}`,
      number: String,
      progress: (label, current, total) => `${label} ${current}/${total}`,
      suggestedPlayers: () => '',
      money: (copper) => `money:${copper}`,
    },
    openFocusTrap: () => trap,
    closeTransient: vi.fn(),
    hideTooltip: vi.fn(),
    itemIcon: () => '<img>',
    itemTooltip: () => 'tooltip',
    attachTooltip: vi.fn(),
    openChronicles,
    openVendor,
    openHeroicVendor,
    openMarket,
    openDelveBoard,
    openValeCup,
    openCardDuel,
    openTrain,
    voice,
  });
  return {
    controller,
    document,
    element,
    entity,
    entities,
    world,
    targetEntity,
    interact,
    acceptLinkedQuest,
    acceptQuest,
    turnInQuest,
    reportTelemetry,
    release,
    focusFirst,
    voice,
    openChronicles,
    openVendor,
    openHeroicVendor,
    openMarket,
    openDelveBoard,
    openValeCup,
    openCardDuel,
    openTrain,
  };
}

describe('QuestDialogController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('owns the normal gossip lifecycle and fades the greeting from NPC distance', () => {
    const test = harness();

    test.controller.open(test.entity.id);
    test.controller.updateVoice();

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('Hello');
    expect(test.voice.play).toHaveBeenCalledWith(`greeting__${test.entity.templateId}`);
    expect(test.voice.setDistance).toHaveBeenCalledWith(0);
    expect(test.focusFirst).toHaveBeenCalledTimes(1);

    test.entity.pos.x = 9;
    test.controller.updateProximity();

    expect(test.element.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
  });

  it('routes bankers and chroniclers through authoritative interaction without gossip', () => {
    const bankerId = Object.values(NPCS).find((definition) => definition.banker)?.id;
    if (!bankerId) throw new Error('banker fixture not found');
    const banker = harness(npc(20, bankerId));

    banker.controller.open(20);

    expect(banker.targetEntity).toHaveBeenCalledWith(20);
    expect(banker.interact).toHaveBeenCalledTimes(1);
    expect(banker.element.style.display).not.toBe('block');

    const chronicler = harness(npc(21, CHRONICLER_TEMPLATE_IDS[0]));
    chronicler.controller.open(21);

    expect(chronicler.targetEntity).toHaveBeenCalledWith(21);
    expect(chronicler.interact).toHaveBeenCalledTimes(1);
    expect(chronicler.openChronicles).toHaveBeenCalledTimes(1);
    expect(chronicler.element.style.display).not.toBe('block');
  });

  it('offers a linked quest only to a current party member and delegates acceptance', () => {
    const test = harness();
    test.world.partyInfo = {
      members: [{ pid: 42 }],
    } as IWorld['partyInfo'];

    test.controller.openLinked('q_wolves', 42);

    test.element.querySelector<HTMLButtonElement>('.btn')?.click();
    expect(test.acceptLinkedQuest).toHaveBeenCalledWith('q_wolves', 42);
    expect(test.element.style.display).toBe('none');
  });

  it('routes available and ready quest actions through IWorld with telemetry', () => {
    const offeredNpc = npc(30, 'marshal_redbrook');
    offeredNpc.questIds = ['q_wolves'];
    const offered = harness(offeredNpc, 'available');
    offered.controller.open(offeredNpc.id);
    offered.element.querySelector<HTMLButtonElement>('[data-quest="q_wolves"]')?.click();
    expect(offered.element.innerHTML).toContain('text:q_wolves');
    offered.element.querySelector<HTMLButtonElement>('.btn')?.click();

    expect(offered.acceptQuest).toHaveBeenCalledWith('q_wolves');
    expect(offered.reportTelemetry).toHaveBeenCalledWith('quest_accept', { timeMs: 0 });

    const readyNpc = npc(31, 'marshal_redbrook');
    readyNpc.questIds = ['q_wolves'];
    const ready = harness(readyNpc, 'ready');
    ready.controller.open(readyNpc.id);
    ready.element.querySelector<HTMLButtonElement>('[data-quest="q_wolves"]')?.click();
    expect(ready.element.innerHTML).toContain('completion:q_wolves');
    ready.element.querySelector<HTMLButtonElement>('.btn')?.click();

    expect(ready.turnInQuest).toHaveBeenCalledWith('q_wolves');
    expect(ready.reportTelemetry).toHaveBeenCalledWith('quest_turnin', { timeMs: 0 });
  });

  it('previews and dispatches the selected profession attunement target', () => {
    const smith = npc(32, 'smith_haldren');
    smith.questIds = ['q_archetype_acceptance'];
    const test = harness(smith, 'available');
    test.controller.open(smith.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_archetype_acceptance"]')?.click();

    const select = test.element.querySelector<HTMLSelectElement>('[data-profession-selection]');
    const preview = test.element.querySelector<HTMLElement>('[data-profession-preview]');
    expect(select?.options).toHaveLength(10);
    expect(preview?.textContent).toBeTruthy();

    if (!select) throw new Error('profession selector missing');
    // The option labels lead with the pair archetype name and keep both craft
    // names visible, e.g. "Bladewright (Jewelcrafting + Weaponcrafting)".
    const option = [...select.options].find((o) => o.value === 'jewelcrafting+weaponcrafting');
    expect(option?.textContent).toBe('Bladewright (Jewelcrafting + Weaponcrafting)');
    select.value = 'jewelcrafting+weaponcrafting';
    select.dispatchEvent(new Event('change'));
    // The preview names the pair title and both major crafts.
    expect(preview?.textContent).toContain('Bladewright');
    expect(preview?.textContent).toContain('Jewelcrafting');
    expect(preview?.textContent).toContain('Weaponcrafting');

    test.element.querySelector<HTMLButtonElement>('.btn')?.click();
    expect(test.acceptQuest).toHaveBeenCalledWith(
      'q_archetype_acceptance',
      'jewelcrafting+weaponcrafting',
    );
  });

  it('keeps the accept action disabled when a profession quest has no target', () => {
    const smith = npc(33, 'smith_haldren');
    smith.questIds = ['q_prof_make_amends'];
    const test = harness(smith, 'available');
    test.controller.open(smith.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_prof_make_amends"]')?.click();

    const select = test.element.querySelector<HTMLSelectElement>('[data-profession-selection]');
    const accept = test.element.querySelector<HTMLButtonElement>('.btn');
    expect(select?.options).toHaveLength(0);
    expect(accept?.disabled).toBe(true);
    accept?.click();
    expect(test.acceptQuest).not.toHaveBeenCalled();
  });

  it('closes gossip before opening every non-quest destination', () => {
    const vendorNpc = npc(40, ordinaryNpcId());
    vendorNpc.vendorItems = ['minor_healing_potion'];
    const vendor = harness(vendorNpc);
    vendor.controller.open(vendorNpc.id);
    vendor.element.querySelector<HTMLButtonElement>('[data-vendor]')?.click();
    expect(vendor.openVendor).toHaveBeenCalledWith(vendorNpc.id);
    expect(vendor.release).toHaveBeenCalledWith(false);

    const marketId = Object.values(NPCS).find((definition) => definition.market)?.id;
    const heroicId = Object.values(NPCS).find((definition) => definition.heroicVendor)?.id;
    if (!marketId || !heroicId) throw new Error('quest route fixtures not found');

    const market = harness(npc(41, marketId));
    market.controller.open(41);
    market.element.querySelector<HTMLButtonElement>('[data-market]')?.click();
    expect(market.openMarket).toHaveBeenCalledTimes(1);

    const heroic = harness(npc(42, heroicId));
    heroic.controller.open(42);
    heroic.element.querySelector<HTMLButtonElement>('[data-heroic-shop]')?.click();
    expect(heroic.openHeroicVendor).toHaveBeenCalledWith(42);

    const boardNpcId = DELVES.collapsed_reliquary.boardNpcId;
    const board = harness(npc(43, boardNpcId));
    board.controller.open(43);
    board.element.querySelector<HTMLButtonElement>('[data-delve-board]')?.click();
    expect(board.openDelveBoard).toHaveBeenCalledWith(43);

    const valeCup = harness(npc(44, 'groundskeeper_bram'));
    valeCup.controller.open(44);
    valeCup.element.querySelector<HTMLButtonElement>('[data-vcup]')?.click();
    expect(valeCup.openValeCup).toHaveBeenCalledTimes(1);

    const cardMaster = harness(npc(45, 'card_master'));
    cardMaster.controller.open(45);
    cardMaster.element.querySelector<HTMLButtonElement>('[data-card-duel]')?.click();
    expect(cardMaster.openCardDuel).toHaveBeenCalledTimes(1);
  });

  it('a station master offers the Train option and routes it to openTrain (Phase 9)', () => {
    // Every STATIONS masterNpcId renders the [data-train] gossip option; the
    // click routes the NPC ENTITY id (not the template id) to deps.openTrain.
    const master = harness(npc(46, STATIONS[0].masterNpcId));
    master.controller.open(46);
    const button = master.element.querySelector<HTMLButtonElement>('[data-train]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBeTruthy();
    button?.click();
    expect(master.openTrain).toHaveBeenCalledWith(46);
    expect(master.release).toHaveBeenCalledWith(false);
  });

  it('a non-master NPC renders no Train option (Phase 9)', () => {
    const masters = new Set(STATIONS.map((station) => station.masterNpcId));
    const plainId = Object.values(NPCS).find(
      (definition) => !definition.banker && !masters.has(definition.id),
    )?.id;
    if (!plainId) throw new Error('non-master NPC fixture not found');
    const plain = harness(npc(47, plainId));
    plain.controller.open(47);
    expect(plain.element.querySelector('[data-train]')).toBeNull();
  });

  it('closes stale gossip when the authoritative NPC disappears', () => {
    const test = harness();
    test.controller.open(test.entity.id);
    test.entities.delete(test.entity.id);

    test.controller.refresh();

    expect(test.element.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledTimes(1);
  });
});

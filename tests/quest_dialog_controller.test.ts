// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_QUEST_ID,
} from '../src/sim/content/world_quest_fire_and_fly';
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_NPCS,
  INVESTIGATION_QUEST_ID,
} from '../src/sim/content/world_quest_investigation';
import { DELVES, ITEMS, NPCS, QUESTS, STATIONS } from '../src/sim/data';
import { CHRONICLER_TEMPLATE_IDS } from '../src/sim/deeds';
import { fireAndFlyScoreboardId } from '../src/sim/fire_and_fly_scoreboards';
import type { Entity } from '../src/sim/types';
import { WEEKLY_KEEPER_ENTITY_ID, WEEKLY_KEEPER_ID } from '../src/sim/weekly_rewards';
import { craftNameText } from '../src/ui/char_window';
import { itemDisplayName } from '../src/ui/entity_i18n';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { QuestDialogController } from '../src/ui/hud/quest/quest_dialog_controller';
import { ensureLocaleLoaded, setLanguage, supportedLanguages, t } from '../src/ui/i18n';
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

function harness(
  entity = npc(10, ordinaryNpcId()),
  questState = 'available',
  identityExtra: Record<string, unknown> = {},
  worldExtra: Record<string, unknown> = {},
) {
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
  const convertHusks = vi.fn();
  const world = {
    entities,
    cfg: { playerClass: 'warrior' },
    player: { name: 'Ari', pos: { x: 0, y: 0, z: 0 } },
    questLog: new Map(),
    partyInfo: null,
    stationPlacements: STATIONS,
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
      ...identityExtra,
    },
    questState: vi.fn(() => questState),
    // The quest-marker inputs the gossip list reads (the phase 23 classifier).
    questsDone: new Set<string>(),
    targetEntity,
    interact,
    acceptLinkedQuest,
    acceptQuest,
    turnInQuest,
    reportTelemetry,
    convertHusks,
    clueHunt: null,
    ...worldExtra,
  } as unknown as IWorld;
  const release = vi.fn();
  const focusFirst = vi.fn();
  // The element the dialog's OWN focus trap recorded as ITS opener (e.g. the
  // world interact prompt that opened the quest dialog): stays connected and
  // visible outside #quest-dialog, unlike a button inside the dialog, which
  // close(false) hides before a successor window's restore() would run.
  const trapOpener = document.createElement('button');
  trapOpener.id = 'world-interact-prompt';
  document.body.appendChild(trapOpener);
  const trapOpenerFn = vi.fn(() => trapOpener as HTMLElement | null);
  const trap: FocusTrapHandle = { release, focusFirst, opener: trapOpenerFn };
  const voice = {
    play: vi.fn(),
    isPlaying: vi.fn(() => true),
    setDistance: vi.fn(),
  };
  const openChronicles = vi.fn();
  const openVendor = vi.fn();
  const openHeroicVendor = vi.fn();
  const openCrucibleVendor = vi.fn();
  const openWarfareVendor = vi.fn();
  const openMarket = vi.fn();
  const openWorldQuestBoard = vi.fn();
  const openDelveBoard = vi.fn();
  const openCardDuel = vi.fn();
  const openTrain = vi.fn();
  const openUnbind = vi.fn();
  const openCrafting = vi.fn();
  const onOpenChange = vi.fn();
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
    openCrucibleVendor,
    openWarfareVendor,
    openMarket,
    openWorldQuestBoard,
    openDelveBoard,
    openCardDuel,
    openTrain,
    openUnbind,
    openCrafting,
    onOpenChange,
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
    convertHusks,
    release,
    focusFirst,
    trapOpener,
    trapOpenerFn,
    voice,
    openChronicles,
    openVendor,
    openHeroicVendor,
    openCrucibleVendor,
    openWarfareVendor,
    openMarket,
    openWorldQuestBoard,
    openDelveBoard,
    openCardDuel,
    openTrain,
    openUnbind,
    openCrafting,
    onOpenChange,
  };
}

describe('QuestDialogController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  // The per-locale label-in-name arm switches the module-global language; a
  // failure mid-loop must not cascade a non-English locale into every later
  // test in this file.
  afterEach(() => setLanguage('en'));

  it('owns the normal gossip lifecycle and fades the greeting from NPC distance', () => {
    const test = harness();

    test.controller.open(test.entity.id);
    test.controller.updateVoice();

    expect(test.element.style.display).toBe('block');
    expect(test.element.innerHTML).toContain('Hello');
    expect(test.voice.play).toHaveBeenCalledWith(`greeting__${test.entity.templateId}`);
    expect(test.voice.setDistance).toHaveBeenCalledWith(0);
    expect(test.focusFirst).toHaveBeenCalledTimes(1);
    expect(test.onOpenChange).toHaveBeenCalledWith(true);
    expect(test.onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
      test.voice.play.mock.invocationCallOrder[0],
    );
    expect(test.controller.isOpen).toBe(true);

    test.entity.pos.x = 9;
    test.controller.updateProximity();

    expect(test.element.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledWith(true);
    expect(test.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(test.controller.isOpen).toBe(false);
  });

  it('renders a completed repeatable as the blue row with the repeatable aria', () => {
    // The phase 23 gossip arm over the real cadenced work order. Before the
    // first completion the row keeps the first-offer gold glyph and the
    // available aria (acceptance (b)'s negative); once questsDone carries the
    // id, the glyph class flips to quest-repeat and the aria names the
    // repeatable state (acceptance (e)).
    const workOrder = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
    if (!workOrder) throw new Error('expected a cadenced work order');
    const giver = npc(30, workOrder.giverNpcId);
    (giver as unknown as { questIds: string[] }).questIds = [workOrder.id];

    const fresh = harness(giver, 'available');
    fresh.controller.open(30);
    const freshRow = fresh.element.querySelector(`[data-quest="${workOrder.id}"]`);
    if (!freshRow) throw new Error('expected the gossip quest row');
    expect(freshRow.innerHTML).toContain('<span class="gold">!</span>');
    expect(freshRow.getAttribute('aria-label')).toBe(
      t('questUi.dialog.availableQuestAria', { name: `quest:${workOrder.id}` }),
    );

    const giver2 = npc(31, workOrder.giverNpcId);
    (giver2 as unknown as { questIds: string[] }).questIds = [workOrder.id];
    const done = harness(giver2, 'available');
    (done.world as unknown as { questsDone: Set<string> }).questsDone.add(workOrder.id);
    done.controller.open(31);
    const doneRow = done.element.querySelector(`[data-quest="${workOrder.id}"]`);
    if (!doneRow) throw new Error('expected the gossip quest row');
    expect(doneRow.innerHTML).toContain('<span class="quest-repeat">!</span>');
    expect(doneRow.getAttribute('aria-label')).toBe(
      t('questUi.dialog.repeatableQuestAria', { name: `quest:${workOrder.id}` }),
    );

    // Inside the cadence window the dialog lists NO row for the order (it is
    // not offerable), exactly the pre-phase dialog: the dimmed marker is an
    // overhead/map statement, never a dead gossip button.
    const giver3 = npc(32, workOrder.giverNpcId);
    (giver3 as unknown as { questIds: string[] }).questIds = [workOrder.id];
    const blocked = harness(giver3, 'unavailable');
    (blocked.world as unknown as { questsDone: Set<string> }).questsDone.add(workOrder.id);
    (
      blocked.world.craftingIdentity as unknown as { cadenceBlockedQuests: string[] }
    ).cadenceBlockedQuests = [workOrder.id];
    blocked.controller.open(32);
    expect(blocked.element.querySelector(`[data-quest="${workOrder.id}"]`)).toBeNull();
  });

  it('surfaces a lapsed work order in an OPEN dialog through refreshIfChanged', () => {
    // A cadence lapse is a pure tick-threshold crossing: the state re-opens
    // with NO quest event to repaint through, while the dimmed map marker's
    // "Available again soon" tag walks the player to this very NPC. The
    // slowHud refreshIfChanged watch must rebuild the row set in place,
    // and an unchanged signature must never rebuild the focus-trapped DOM.
    const workOrder = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
    if (!workOrder) throw new Error('expected a cadenced work order');
    const giver = npc(33, workOrder.giverNpcId);
    (giver as unknown as { questIds: string[] }).questIds = [workOrder.id];
    const test = harness(giver, 'unavailable');
    (test.world as unknown as { questsDone: Set<string> }).questsDone.add(workOrder.id);
    test.controller.open(33);
    expect(test.element.querySelector(`[data-quest="${workOrder.id}"]`)).toBeNull();

    // Unchanged signature: the same DOM nodes survive (identity, not HTML
    // equality, since a rebuild would produce identical markup).
    const anchorNode = test.element.querySelector('[data-close]');
    test.controller.refreshIfChanged();
    expect(test.element.querySelector('[data-close]')).toBe(anchorNode);

    // The window lapses: the quest state re-opens and the watch repaints.
    (test.world.questState as ReturnType<typeof vi.fn>).mockReturnValue('available');
    test.controller.refreshIfChanged();
    const row = test.element.querySelector(`[data-quest="${workOrder.id}"]`);
    if (!row) throw new Error('expected the lapsed work order row without close/reopen');
    expect(row.innerHTML).toContain('<span class="quest-repeat">!</span>');
    expect(row.getAttribute('aria-label')).toBe(
      t('questUi.dialog.repeatableQuestAria', { name: `quest:${workOrder.id}` }),
    );
  });

  it('routes the Weekly Vault Keeper through authoritative interaction without gossip', () => {
    const keeper = harness(npc(WEEKLY_KEEPER_ENTITY_ID, WEEKLY_KEEPER_ID));
    keeper.controller.open(WEEKLY_KEEPER_ENTITY_ID);
    expect(keeper.targetEntity).toHaveBeenCalledWith(WEEKLY_KEEPER_ENTITY_ID);
    expect(keeper.interact).toHaveBeenCalledTimes(1);
    expect(keeper.element.style.display).not.toBe('block');
  });

  it('a clue hand-over at an ordinary quest giver renders the row and the click sends the interact', () => {
    // The 2026-09-22 playtest bug: the fenwitch salt hunt's first step is a
    // hand-over of one cooking salt at Mother Sedge, an ORDINARY quest giver.
    // The gossip menu only sent the interact for service NPCs or an active
    // quest's discuss row, so the sim's clue check (talkToNpc runs
    // onNpcTalkedForClueHunt first on every host) was never reached and the
    // salt was never taken. The row is the one affordance that sends it.
    const sedge = harness(
      npc(77, 'mother_sedge'),
      'none',
      {},
      {
        clueHunt: { huntId: 'hunt_willowfen_fenwitch_salt', step: 0 },
      },
    );
    sedge.controller.open(77);
    expect(sedge.element.style.display).toBe('block');
    const row = sedge.element.querySelector<HTMLButtonElement>('[data-clue-step]');
    expect(row).not.toBeNull();
    const salt = itemDisplayName(ITEMS.cooking_salt);
    expect(row?.textContent).toContain(t('questUi.dialog.clueDeliver', { count: '1', item: salt }));
    expect(row?.getAttribute('aria-label')).toBe(
      t('questUi.dialog.clueDeliverAria', { count: '1', item: salt, name: 'npc:mother_sedge' }),
    );
    // The English literals once, beside the t() form.
    expect(row?.textContent).toContain(`Hand over 1 ${salt}.`);
    expect(row?.getAttribute('aria-label')).toBe(`Hand over 1 ${salt} to npc:mother_sedge`);
    expect(sedge.interact).not.toHaveBeenCalled();
    row?.click();
    expect(sedge.targetEntity).toHaveBeenCalledWith(77);
    expect(sedge.interact).toHaveBeenCalledTimes(1);
    // No successor window: close WITH the trap's own focus restore (the husk
    // trade shape), never the bindRoute release(false).
    expect(sedge.release).toHaveBeenCalledWith(true);
    expect(sedge.release).not.toHaveBeenCalledWith(false);
    expect(sedge.controller.isOpen).toBe(false);
  });

  it('the clue row is absent for another NPC, a non-talk step, or no hunt', () => {
    // Same hunt, wrong NPC: the step names mother_sedge, not widow_tansy.
    const tansy = harness(
      npc(78, 'widow_tansy'),
      'none',
      {},
      {
        clueHunt: { huntId: 'hunt_willowfen_fenwitch_salt', step: 0 },
      },
    );
    tansy.controller.open(78);
    expect(tansy.element.querySelector('[data-clue-step]')).toBeNull();
    // Right NPC, no hunt (the harness default): nothing to hand over.
    const idle = harness(npc(77, 'mother_sedge'), 'none');
    idle.controller.open(77);
    expect(idle.element.querySelector('[data-clue-step]')).toBeNull();
    expect(idle.interact).not.toHaveBeenCalled();
  });

  it('refreshIfChanged repaints the open dialog when the clue step moves off this NPC', () => {
    const sedge = harness(
      npc(77, 'mother_sedge'),
      'none',
      {},
      {
        clueHunt: { huntId: 'hunt_willowfen_fenwitch_salt', step: 0 },
      },
    );
    sedge.controller.open(77);
    expect(sedge.element.querySelector('[data-clue-step]')).not.toBeNull();
    // Unchanged state: no repaint (the DOM node identity survives).
    const before = sedge.element.querySelector('[data-clue-step]');
    sedge.controller.refreshIfChanged();
    expect(sedge.element.querySelector('[data-clue-step]')).toBe(before);
    // The hunt ended (or advanced past this NPC): the row must go. The
    // harness world is the live object the controller reads.
    (sedge.world as unknown as { clueHunt: unknown }).clueHunt = null;
    sedge.controller.refreshIfChanged();
    expect(sedge.element.querySelector('[data-clue-step]')).toBeNull();
  });

  it('routes bankers and chroniclers through authoritative interaction without gossip', () => {
    const bankerId = Object.values(NPCS).find((definition) => definition.banker)?.id;
    if (!bankerId) throw new Error('banker fixture not found');
    const banker = harness(npc(20, bankerId));

    banker.controller.open(20);

    expect(banker.targetEntity).toHaveBeenCalledWith(20);
    expect(banker.interact).toHaveBeenCalledTimes(1);
    expect(banker.element.style.display).not.toBe('block');

    // The Riftwright (riftForge flag) takes the same short-circuit: the sim's
    // interact emits the window-opening event, identical on every host.
    const forgeId = Object.values(NPCS).find((definition) => definition.riftForge)?.id;
    if (!forgeId) throw new Error('rift forge fixture not found');
    const forge = harness(npc(22, forgeId));
    forge.controller.open(22);
    expect(forge.targetEntity).toHaveBeenCalledWith(22);
    expect(forge.interact).toHaveBeenCalledTimes(1);
    expect(forge.element.style.display).not.toBe('block');

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

  it('the preview promises the REMEMBERED hobby when the identity carries one', () => {
    // The controller must pass identity.questedHobbies through to the view:
    // with the pass-through dropped, the preview silently reverts to the
    // skill default, the exact defect the mirror exists to fix.
    const darva = npc(33, 'forgemistress_darva');
    darva.questIds = ['q_prof_attune_smith'];
    const test = harness(darva, 'available', {
      questedHobbies: { 'weaponcrafting+armorcrafting': 'tailoring' },
    });
    test.controller.open(darva.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_prof_attune_smith"]')?.click();
    const select = test.element.querySelector<HTMLSelectElement>('[data-profession-selection]');
    const preview = test.element.querySelector<HTMLElement>('[data-profession-preview]');
    if (!select) throw new Error('profession selector missing');
    select.value = 'weaponcrafting+armorcrafting';
    select.dispatchEvent(new Event('change'));
    expect(preview?.textContent).toContain('Tailoring');
    expect(preview?.textContent).not.toContain('Leatherworking');
  });

  it('previews and dispatches the selected profession attunement target', () => {
    // Each wave-one attune quest pins one pair, so the Smith acceptance
    // quest at Forgemistress Darva narrows the selector to exactly its pair.
    const darva = npc(32, 'forgemistress_darva');
    darva.questIds = ['q_prof_attune_smith'];
    const test = harness(darva, 'available');
    test.controller.open(darva.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_prof_attune_smith"]')?.click();

    const select = test.element.querySelector<HTMLSelectElement>('[data-profession-selection]');
    const preview = test.element.querySelector<HTMLElement>('[data-profession-preview]');
    // The pinned pair is the only legal target for an unattuned player.
    expect(select?.options).toHaveLength(1);
    expect(preview?.textContent).toBeTruthy();
    expect(preview?.getAttribute('aria-live')).toBe('polite');
    expect(preview?.getAttribute('aria-atomic')).toBe('true');

    if (!select) throw new Error('profession selector missing');
    // The single option leads with the pair archetype name and keeps both craft
    // names visible: "Smith (Weaponcrafting + Armorcrafting)".
    const option = [...select.options].find((o) => o.value === 'weaponcrafting+armorcrafting');
    expect(option?.textContent).toBe('Smith (Weaponcrafting + Armorcrafting)');
    select.value = 'weaponcrafting+armorcrafting';
    select.dispatchEvent(new Event('change'));
    // The preview names the pair title, both major crafts, and the make-amends
    // return cost (preview completeness).
    expect(preview?.textContent).toContain('Smith');
    expect(preview?.textContent).toContain('Weaponcrafting');
    expect(preview?.textContent).toContain('Armorcrafting');
    expect(preview?.textContent).toContain('make-amends');
    const smithCrest = preview?.querySelector<HTMLImageElement>('.qd-profession-crest');
    expect(smithCrest?.getAttribute('src')).toBe('/ui/professions/archetype_smith.webp');
    expect(smithCrest?.getAttribute('alt')).toBe('');

    // The preview painter updates both the localized copy and its crest when
    // the selection changes. Add a second canonical option to exercise that
    // reusable select path even though this quest currently pins one pair.
    const bombardier = document.createElement('option');
    bombardier.value = 'engineering+alchemy';
    bombardier.textContent = 'Bombardier';
    select.appendChild(bombardier);
    select.value = 'engineering+alchemy';
    select.dispatchEvent(new Event('change'));
    expect(preview?.textContent).toContain('Bombardier');
    expect(
      preview?.querySelector<HTMLImageElement>('.qd-profession-crest')?.getAttribute('src'),
    ).toBe('/ui/professions/archetype_bombardier.webp');

    // Restore the quest's legal pinned target before dispatching acceptance.
    select.value = 'weaponcrafting+armorcrafting';
    select.dispatchEvent(new Event('change'));

    test.element.querySelector<HTMLButtonElement>('.btn')?.click();
    expect(test.acceptQuest).toHaveBeenCalledWith(
      'q_prof_attune_smith',
      'weaponcrafting+armorcrafting',
    );
  });

  it('renders the real hobby-switch preview as localized copy with no archetype crest', () => {
    const haldren = npc(33, 'smith_haldren');
    haldren.questIds = ['q_prof_hobby_switch'];
    const test = harness(haldren, 'available');
    Object.assign(test.world.craftingIdentity, {
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
    });

    test.controller.open(haldren.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_prof_hobby_switch"]')?.click();

    const select = test.element.querySelector<HTMLSelectElement>('[data-profession-selection]');
    const preview = test.element.querySelector<HTMLElement>('[data-profession-preview]');
    if (!select) throw new Error('hobby profession selector missing');
    expect([...select.options].map((option) => option.value)).toEqual(['tailoring']);
    expect(preview?.textContent).toBe(
      t('hudChrome.crafting.hobbyPreview', { hobby: craftNameText('tailoring') }),
    );
    expect(preview?.getAttribute('aria-live')).toBe('polite');
    expect(preview?.getAttribute('aria-atomic')).toBe('true');
    expect(preview?.querySelector('.qd-profession-crest')).toBeNull();

    select.dispatchEvent(new Event('change'));
    expect(preview?.querySelector('.qd-profession-crest')).toBeNull();
  });

  it('keeps the accept action disabled when a profession quest has no target', () => {
    // The make-amends return quest at Forgemistress Darva is only
    // legal for a pair the character has held before, so an unattuned player
    // (no history) sees zero targets and a disabled accept.
    const darva = npc(34, 'forgemistress_darva');
    darva.questIds = ['q_prof_amends_smith'];
    const test = harness(darva, 'available');
    test.controller.open(darva.id);
    test.element.querySelector<HTMLButtonElement>('[data-quest="q_prof_amends_smith"]')?.click();

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
    const vendorButton = vendor.element.querySelector<HTMLButtonElement>('[data-vendor]');
    expect(vendorButton?.innerHTML).toContain('/ui/currency/coin_gold.webp');
    vendorButton?.focus();
    vendorButton?.click();
    expect(vendor.openVendor).toHaveBeenCalledWith(vendorNpc.id, vendor.trapOpener);
    expect(vendor.release).toHaveBeenCalledWith(false);

    const marketId = Object.values(NPCS).find((definition) => definition.market)?.id;
    const heroicId = Object.values(NPCS).find((definition) => definition.heroicVendor)?.id;
    if (!marketId || !heroicId) throw new Error('quest route fixtures not found');

    const market = harness(npc(41, marketId));
    market.controller.open(41);
    market.element.querySelector<HTMLButtonElement>('[data-market]')?.click();
    expect(market.openMarket).toHaveBeenCalledTimes(1);

    // The World Quest taskmaster offers the board row and nothing else; the
    // row routes to the map rail through openWorldQuestBoard.
    const boardId = Object.values(NPCS).find((definition) => definition.worldQuestBoard)?.id;
    if (!boardId) throw new Error('world quest board fixture not found');
    const taskmaster = harness(npc(45, boardId));
    taskmaster.controller.open(45);
    taskmaster.element.querySelector<HTMLButtonElement>('[data-world-quest-board]')?.click();
    expect(taskmaster.openWorldQuestBoard).toHaveBeenCalledTimes(1);

    const heroic = harness(npc(42, heroicId));
    heroic.controller.open(42);
    const heroicButton = heroic.element.querySelector<HTMLButtonElement>('[data-heroic-shop]');
    expect(heroicButton?.innerHTML).toContain('/ui/items/heroic_mark.webp');
    heroicButton?.focus();
    heroicButton?.click();
    expect(heroic.openHeroicVendor).toHaveBeenCalledWith(42, heroic.trapOpener);

    const boardNpcId = DELVES.collapsed_reliquary.boardNpcId;
    const board = harness(npc(43, boardNpcId));
    board.controller.open(43);
    board.element.querySelector<HTMLButtonElement>('[data-delve-board]')?.click();
    expect(board.openDelveBoard).toHaveBeenCalledWith(43);

    const cardMaster = harness(npc(45, 'card_master'));
    cardMaster.controller.open(45);
    cardMaster.element.querySelector<HTMLButtonElement>('[data-card-duel]')?.click();
    expect(cardMaster.openCardDuel).toHaveBeenCalledTimes(1);
  });

  it('REPLACES the generic goods row with the WARFARE shop row at a flagged NPC', () => {
    // The WARFARE quartermaster shows ONE shop row, not two (owner 2026-08-07).
    // This reverses the round-2 review decision that shipped both: the two rows
    // open the SAME stock, because a quartermaster's vendorItems IS the whole
    // WARFARE catalog, so the generic grid was a flat copy of what the sectioned
    // window lays out properly. Distinct labels made them tellable apart without
    // making the duplication any less confusing.
    const flaggedId = Object.values(NPCS).find((definition) => definition.warfareVendor)?.id;
    if (!flaggedId) throw new Error('warfare vendor fixture not found');
    const flagged = npc(60, flaggedId);
    // Non-empty on purpose, and this is the load-bearing half. The honor buy
    // path (items.ts buyItem) is generic over vendorItems and refuses an empty
    // list; the warfareVendor flag is a WINDOW routing hint it never reads. So
    // the suppression has to happen on the ROW. Emptying the stock to hide the
    // row would turn the shop itself off, which is why this fixture stocks the
    // NPC and still expects no goods row.
    flagged.vendorItems = ['minor_healing_potion'];
    const both = harness(flagged);
    both.controller.open(flagged.id);

    const goods = both.element.querySelector<HTMLButtonElement>('[data-vendor]');
    const shop = both.element.querySelector<HTMLButtonElement>('[data-warfare-shop]');
    expect(goods, 'no generic goods row at a flagged NPC, even with stock').toBeNull();
    expect(shop, 'the WARFARE shop row').not.toBeNull();
    expect(shop?.innerHTML).toContain('/ui/currency/honor.webp');
    expect(shop?.textContent).toContain(t('hudChrome.warfareShop.gossipOption'));
    expect(shop?.getAttribute('aria-label')).toBe(
      t('hudChrome.warfareShop.gossipOptionAria', { name: `npc:${flaggedId}` }),
    );

    // The shop row routes to the sectioned window and nowhere else.
    shop?.click();
    expect(both.openWarfareVendor).toHaveBeenCalledWith(flagged.id, both.trapOpener);
    expect(both.openVendor).not.toHaveBeenCalled();

    // Scoped to the FLAG, not to vendors generally: an ordinary stocked NPC
    // still gets its goods row, routing to the ordinary window. ("closes gossip
    // before opening every non-quest destination" above covers the same NPC;
    // asserted here too so deleting that one cannot quietly make this vacuous.)
    const ordinary = npc(61, ordinaryNpcId());
    ordinary.vendorItems = ['minor_healing_potion'];
    const generic = harness(ordinary);
    generic.controller.open(61);
    const genericGoods = generic.element.querySelector<HTMLButtonElement>('[data-vendor]');
    expect(genericGoods, 'an unflagged stocked NPC keeps its goods row').not.toBeNull();
    genericGoods?.click();
    expect(generic.openVendor).toHaveBeenCalledWith(61, generic.trapOpener);
    expect(generic.openWarfareVendor).not.toHaveBeenCalled();
  });

  it("hands the successor window the DIALOG TRAP's own opener, not the in-dialog button (WCAG 2.4.3)", () => {
    // Regression for the second review finding on PR #2619: the first fix
    // captured document.activeElement (the in-dialog gossip button) BEFORE
    // close(false) hid #quest-dialog, but that button still lives INSIDE the
    // dialog's own subtree, so by the time the successor window's
    // focusManager.restore() runs later (after close(false) has taken
    // effect), the button fails FocusManager.canFocus (display:none ancestor,
    // getClientRects().length === 0) and focus still falls to <body>. The
    // real fix hands the successor the quest dialog's OWN trap opener
    // instead: a sibling element outside the dialog (e.g. the world interact
    // prompt) that stays connected and visible for the whole time the vendor
    // window is open, exactly like openBank()'s live side-rail button.
    const vendorNpc = npc(50, ordinaryNpcId());
    vendorNpc.vendorItems = ['minor_healing_potion'];
    const test = harness(vendorNpc);
    test.controller.open(vendorNpc.id);
    const vendorButton = test.element.querySelector<HTMLButtonElement>('[data-vendor]');
    expect(vendorButton).not.toBeNull();
    vendorButton?.focus();
    expect(test.document.activeElement).toBe(vendorButton);

    vendorButton?.click();

    // The dialog is hidden by the time openVendor is invoked...
    expect(test.element.style.display).toBe('none');
    // ...openVendor received the trap's OWN opener, read from the trap
    // handle rather than document.activeElement...
    expect(test.trapOpenerFn).toHaveBeenCalled();
    expect(test.openVendor).toHaveBeenCalledWith(vendorNpc.id, test.trapOpener);
    // ...and, unlike the in-dialog button, that element sits OUTSIDE the
    // hidden #quest-dialog subtree: jsdom never lays out real geometry (so
    // FocusManager.canFocus's getClientRects() check cannot be exercised
    // here), but this is the structural precondition it depends on, and it
    // is exactly what the in-dialog button fails once close(false) hides its
    // ancestor.
    expect(test.trapOpener.isConnected).toBe(true);
    expect(test.element.contains(test.trapOpener)).toBe(false);
    expect(vendorButton && test.element.contains(vendorButton)).toBe(true);
  });

  it('a station master offers the Train option and routes it to openTrain', () => {
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

  it('a farmer NPC offers the husk-trade row and the click sends convertHusks once, then closes', () => {
    // The farming go-live: every NpcDef carrying the farmer flag renders the
    // [data-husk-trade] row (the ONE UI affordance for convert_husks). The
    // fixture entity has NO quests and NO vendor rows, so the row is what
    // keeps this dialog worth opening at all. The click goes straight to the
    // live world (IWorldFarming.convertHusks) exactly once, and the dialog
    // closes like every other non-quest destination (the market-row shape).
    const farmerId = Object.values(NPCS).find((definition) => definition.farmer)?.id;
    if (!farmerId) throw new Error('farmer NPC fixture not found');
    const farmer = harness(npc(48, farmerId));
    farmer.controller.open(48);
    expect(farmer.element.style.display).toBe('block');
    const button = farmer.element.querySelector<HTMLButtonElement>('[data-husk-trade]');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain(t('hudChrome.farming.huskTrade'));
    expect(button?.getAttribute('aria-label')).toBe(
      t('hudChrome.farming.huskTradeAria', { name: `npc:${farmerId}` }),
    );
    // The English literals once, beside the t() form: a key swap to any other
    // existing key would keep the t() comparisons green on their own.
    expect(button?.textContent).toContain('Trade husks for compost');
    expect(button?.getAttribute('aria-label')).toBe(`Trade husks for compost with npc:${farmerId}`);
    // WCAG 2.5.3 label-in-name (the Phase 14 a11y batch): the accessible
    // name CONTAINS the visible label verbatim, so speech-input users can
    // say what they see. Pinned as the containment PROPERTY, not just the
    // literal above, so a future reword of either key must keep it.
    expect(button?.getAttribute('aria-label')).toContain(button?.textContent?.trim() ?? 'MISSING');
    // No shop row for an empty stock, so the trade row is the only action.
    expect(farmer.element.querySelector('[data-vendor]')).toBeNull();
    expect(farmer.convertHusks).not.toHaveBeenCalled();
    button?.click();
    expect(farmer.convertHusks).toHaveBeenCalledTimes(1);
    // The trade opens NO successor window (the sim's own event lines are the
    // feedback), so the dialog closes WITH focus restore: the bindRoute
    // family releases with false because it hands the trap opener to a
    // successor that restores focus on its own close; with no successor that
    // chain would drop keyboard focus to <body> (Phase 9 QA, the frontend
    // seam's finding).
    expect(farmer.release).toHaveBeenCalledWith(true);
    expect(farmer.release).not.toHaveBeenCalledWith(false);
    expect(farmer.controller.isOpen).toBe(false);
  });

  it('label-in-name holds in EVERY locale for the husk pair (WCAG 2.5.3)', async () => {
    // The Phase 14 a11y batch reworded the aria pair so the accessible name
    // contains the visible label verbatim in every locale (speech-input
    // users say what they see in their language). The property is asserted
    // across the WHOLE supported set: the five filled non-Latin locales
    // render their fills, the rest English-fall-back BOTH keys together, so
    // containment must hold everywhere; a future one-sided fill (aria
    // translated, visible pending, or vice versa) reds here. Rendered
    // through the real sink in the app's own order (await, then switch).
    const FILLED = new Set(['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW']);
    for (const locale of supportedLanguages) {
      if (locale === 'en') continue;
      await ensureLocaleLoaded(locale);
      setLanguage(locale);
      const visible = t('hudChrome.farming.huskTrade');
      const aria = t('hudChrome.farming.huskTradeAria', { name: 'X' });
      expect(aria, locale).toContain(visible);
      // Non-vacuity where a real fill exists: not English-falling-back.
      if (FILLED.has(locale)) expect(visible, locale).not.toBe('Trade husks for compost');
    }
    setLanguage('en');
  });

  it('a farmer with stock renders the trade row BESIDE the goods row', () => {
    // The two go-live counters at once: Jessica sells seeds and trades husks
    // from the same dialog, so neither row may suppress the other.
    const stocked = npc(49, 'farmer_jessica');
    stocked.vendorItems = [...(NPCS.farmer_jessica.vendorItems ?? [])];
    const jessica = harness(stocked);
    jessica.controller.open(49);
    expect(jessica.element.querySelector('[data-vendor]')).not.toBeNull();
    expect(jessica.element.querySelector('[data-husk-trade]')).not.toBeNull();
  });

  it('a non-farmer NPC renders no husk-trade row', () => {
    const plainId = Object.values(NPCS).find(
      (definition) =>
        !definition.banker &&
        !definition.farmer &&
        !(CHRONICLER_TEMPLATE_IDS as readonly string[]).includes(definition.id),
    )?.id;
    if (!plainId) throw new Error('non-farmer NPC fixture not found');
    const plain = harness(npc(50, plainId));
    plain.controller.open(50);
    expect(plain.element.querySelector('[data-husk-trade]')).toBeNull();
    expect(plain.convertHusks).not.toHaveBeenCalled();
  });

  it('a non-master NPC renders no Train option', () => {
    const masters = new Set(STATIONS.map((station) => station.masterNpcId));
    const plainId = Object.values(NPCS).find(
      (definition) => !definition.banker && !masters.has(definition.id),
    )?.id;
    if (!plainId) throw new Error('non-master NPC fixture not found');
    const plain = harness(npc(47, plainId));
    plain.controller.open(47);
    expect(plain.element.querySelector('[data-train]')).toBeNull();
  });

  it('a station master offers the Unbind service and routes it to openUnbind', () => {
    // Every station master offers the Maker's Bond unbind service beside
    // training (the same isStationMasterNpc gate); the click routes the NPC
    // ENTITY id to deps.openUnbind and releases the dialog.
    const master = harness(npc(48, STATIONS[0].masterNpcId));
    master.controller.open(48);
    const button = master.element.querySelector<HTMLButtonElement>('[data-unbind]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBeTruthy();
    button?.click();
    expect(master.openUnbind).toHaveBeenCalledWith(48);
    expect(master.release).toHaveBeenCalledWith(false);
  });

  it('a non-master NPC renders no Unbind option', () => {
    const masters = new Set(STATIONS.map((station) => station.masterNpcId));
    const plainId = Object.values(NPCS).find(
      (definition) => !definition.banker && !masters.has(definition.id),
    )?.id;
    if (!plainId) throw new Error('non-master NPC fixture not found');
    const plain = harness(npc(49, plainId));
    plain.controller.open(49);
    expect(plain.element.querySelector('[data-unbind]')).toBeNull();
  });

  it('a station master offers the Crafting shortcut and routes its craft to openCrafting', () => {
    // The Eastbrook forge master: a fresh viewer (no craft skills) resolves
    // to weaponcrafting, the first forge craft in declaration order. The aria
    // names the resolved craft (the {craft} placeholder is substituted).
    const forge = STATIONS.find((station) => station.type === 'forge');
    if (!forge) throw new Error('forge station fixture not found');
    const master = harness(npc(51, forge.masterNpcId));
    master.controller.open(51);
    const button = master.element.querySelector<HTMLButtonElement>('[data-crafting]');
    expect(button).not.toBeNull();
    const aria = button?.getAttribute('aria-label') ?? '';
    expect(aria).toContain(craftNameText('weaponcrafting'));
    expect(aria).not.toContain('{craft}');
    button?.click();
    expect(master.openCrafting).toHaveBeenCalledWith('weaponcrafting');
    expect(master.release).toHaveBeenCalledWith(false);
  });

  it('the Crafting shortcut follows the viewer stronger craft at the two-craft forge', () => {
    const forge = STATIONS.find((station) => station.type === 'forge');
    if (!forge) throw new Error('forge station fixture not found');
    const master = harness(npc(52, forge.masterNpcId), 'available', {
      craftSkills: { weaponcrafting: 5, armorcrafting: 30 },
    });
    master.controller.open(52);
    master.element.querySelector<HTMLButtonElement>('[data-crafting]')?.click();
    expect(master.openCrafting).toHaveBeenCalledWith('armorcrafting');
  });

  it('a non-master NPC renders no Crafting shortcut', () => {
    const masters = new Set(STATIONS.map((station) => station.masterNpcId));
    const plainId = Object.values(NPCS).find(
      (definition) => !definition.banker && !masters.has(definition.id),
    )?.id;
    if (!plainId) throw new Error('non-master NPC fixture not found');
    const plain = harness(npc(53, plainId));
    plain.controller.open(53);
    expect(plain.element.querySelector('[data-crafting]')).toBeNull();
  });

  it('does not leak Train, Crafting, or Unbind into a world with no authored stations', () => {
    const master = harness(npc(50, STATIONS[0].masterNpcId));
    (master.world as unknown as { stationPlacements: typeof STATIONS }).stationPlacements = [];

    master.controller.open(50);

    expect(master.element.querySelector('[data-train]')).toBeNull();
    expect(master.element.querySelector('[data-crafting]')).toBeNull();
    expect(master.element.querySelector('[data-unbind]')).toBeNull();
  });

  it('closes stale gossip when the authoritative NPC disappears', () => {
    const test = harness();
    test.controller.open(test.entity.id);
    test.entities.delete(test.entity.id);

    test.controller.refresh();

    expect(test.element.style.display).toBe('none');
    expect(test.release).toHaveBeenCalledTimes(1);
  });

  it('refreshIfChanged retires a lingering intro hint when attunement lands under the open dialog', () => {
    // The online edge: the cprof identity mirror replaces craftingIdentity
    // AFTER the gossip dialog opened, and no quest event fires for it. The
    // stale hint self-healed only on reopen before the staleness probe.
    const haldren = npc(51, 'smith_haldren');
    const test = harness(haldren, 'available');
    test.controller.open(haldren.id);
    expect(test.element.querySelector('[data-prof-intro-hint]')).not.toBeNull();

    (test.world.craftingIdentity.attunedPairs as string[]).push('weaponcrafting+armorcrafting');
    test.controller.refreshIfChanged();

    expect(test.element.querySelector('[data-prof-intro-hint]')).toBeNull();
    expect(test.element.style.display).toBe('block');
  });

  it('refreshIfChanged never rebuilds the dialog DOM while the hint state is unchanged', () => {
    // The dialog holds focus-trapped buttons: an unconditional slow-band
    // rebuild would drop keyboard focus every second, so node identity must
    // survive a no-change probe.
    const haldren = npc(52, 'smith_haldren');
    const test = harness(haldren, 'available');
    test.controller.open(haldren.id);
    const hintNode = test.element.querySelector('[data-prof-intro-hint]');
    expect(hintNode).not.toBeNull();

    test.controller.refreshIfChanged();

    expect(test.element.querySelector('[data-prof-intro-hint]')).toBe(hintNode);
  });

  it('opens a caravan briefing and confirms through target then interact', () => {
    const caravan = {
      ...npc(80, 'eastbrook_freight_caravan'),
      kind: 'mob',
      dead: false,
    } as Entity;
    const test = harness(caravan);
    test.world.player.level = 60;
    test.world.player.dead = false;
    test.world.worldQuestLog = new Map([
      ['wq_eastbrook_caravan', { questId: 'wq_eastbrook_caravan', state: 'active', count: 0 }],
    ]);

    test.controller.open(caravan.id);
    const start = test.element.querySelector<HTMLButtonElement>('[data-start-wq]');
    expect(test.controller.isOpen).toBe(true);
    expect(start).not.toBeNull();
    expect(start?.hidden).toBe(false);
    start?.click();
    expect(test.targetEntity).toHaveBeenCalledWith(caravan.id);
    expect(test.interact).toHaveBeenCalledTimes(1);
    expect(test.targetEntity.mock.invocationCallOrder[0]).toBeLessThan(
      test.interact.mock.invocationCallOrder[0],
    );
  });
});

describe('investigation quest dialogue', () => {
  it('opens records using existing dialogue chrome and distance dismissal', () => {
    const clue = INVESTIGATION_CLUES[0];
    const entity = {
      ...npc(clue.entityId, `ground_${clue.objectItemId}`),
      kind: 'object',
    } as Entity;
    const h = harness(entity);
    h.world.worldQuestCycle = 'wq3_0';
    h.world.worldQuestLog = new Map([
      [
        INVESTIGATION_QUEST_ID,
        {
          questId: INVESTIGATION_QUEST_ID,
          state: 'active',
          count: 0,
          investigation: { heard: 0, clues: 1, cleared: 0 },
        },
      ],
    ]);
    h.controller.open(entity.id);
    expect(h.controller.isOpen).toBe(true);
    expect(h.element.querySelector('#quest-dialog-title')?.textContent).toBe('Standing Orders');
    expect(h.element.querySelector('[data-close]')).not.toBeNull();
    expect(h.element.querySelector('[data-accuse]')).toBeNull();
    const title = h.element.querySelector('#quest-dialog-title');
    h.controller.refreshIfChanged();
    expect(h.element.querySelector('#quest-dialog-title')).toBe(title);
    h.world.player.pos.x = 100;
    h.controller.updateProximity();
    expect(h.controller.isOpen).toBe(false);
    expect(h.release).toHaveBeenCalled();
  });
  it('refreshes after online snapshot arrival, emits only accusation intent and restores correction', () => {
    const entity = npc(INVESTIGATION_NPC_IDS[0], INVESTIGATION_NPCS[0].id);
    const h = harness(entity);
    h.world.worldQuestCycle = 'wq3_0';
    const progress = {
      questId: INVESTIGATION_QUEST_ID,
      state: 'active' as const,
      count: 0,
      investigation: { heard: 7, clues: 3, cleared: 0, mobId: undefined as number | undefined },
    };
    h.world.worldQuestLog = new Map([[INVESTIGATION_QUEST_ID, progress]]);
    h.world.accuseWorldQuestSuspect = vi.fn();
    h.controller.open(entity.id);
    expect(h.element.querySelector('[data-accuse]')).toBeNull();
    progress.investigation.heard = 15;
    h.controller.refreshIfChanged();
    // One option per guard, in post order, each naming the guard.
    const options = Array.from(h.element.querySelectorAll<HTMLButtonElement>('[data-accuse]'));
    expect(options.map((b) => Number(b.dataset.accuse))).toEqual(INVESTIGATION_NPC_IDS.slice(1));
    expect(options[0].textContent).toBe('Accuse npc:infiltrator_nella');
    options[1].click();
    expect(h.world.accuseWorldQuestSuspect).toHaveBeenCalledWith(INVESTIGATION_NPC_IDS[2]);
    expect(progress.investigation.cleared).toBe(0);
    expect(h.controller.isOpen).toBe(false);
    progress.investigation.cleared = 2;
    h.controller.open(entity.id);
    expect(h.element.textContent).toContain('try again');
    expect(
      Array.from(h.element.querySelectorAll<HTMLButtonElement>('[data-accuse]')).map((b) =>
        Number(b.dataset.accuse),
      ),
    ).toEqual([INVESTIGATION_NPC_IDS[1], INVESTIGATION_NPC_IDS[3], INVESTIGATION_NPC_IDS[4]]);
    // A guard's own dialog never carries the option.
    const guard = npc(INVESTIGATION_NPC_IDS[2], INVESTIGATION_NPCS[2].id);
    h.world.entities.set(guard.id, guard);
    h.controller.open(guard.id);
    expect(h.element.querySelector('[data-accuse]')).toBeNull();
    h.controller.open(entity.id);
    progress.investigation.mobId = 500;
    h.controller.refreshIfChanged();
    expect(h.controller.isOpen).toBe(false);
  });
});

describe("Master Gunner Alder's Gunnery Board", () => {
  function alderHarness(
    recruitment: { trialsWon: number; recruited: boolean },
    state: 'active' | 'completed' = 'active',
    fireAndFlyRecords: IWorld['fireAndFlyRecords'] = {},
  ) {
    const worldQuestLeaderboard = vi.fn();
    const startWorldQuestActivity = vi.fn();
    const h = harness(
      npc(77, FIRE_AND_FLY_NPC_DEF.id),
      'available',
      {},
      {
        player: { id: 1, name: 'Ari', level: 20, dead: false, pos: { x: 0, y: 0, z: 0 } },
        worldQuestLog: new Map([
          [FIRE_AND_FLY_QUEST_ID, { questId: FIRE_AND_FLY_QUEST_ID, count: 0, state }],
        ]),
        fireAndFlyRecruitment: recruitment,
        fireAndFlyRecords,
        startWorldQuestActivity,
        worldQuestLeaderboard,
      },
    );
    h.controller.open(77);
    return { ...h, startWorldQuestActivity, worldQuestLeaderboard };
  }
  const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-gb-row]')];
  const action = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('[data-gb-take]') as HTMLButtonElement;
  const row = (root: HTMLElement, match: (el: HTMLElement) => boolean) => {
    const found = rows(root).find(match);
    if (!found) throw new Error('row not painted');
    return found;
  };
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it("greets with the recruitment's line on the board and plays that line's clip", () => {
    const alder = FIRE_AND_FLY_NPC_DEF.id;
    const greeting = (root: HTMLElement) => root.querySelector('.gb-greeting')?.textContent;
    const fresh = alderHarness({ trialsWon: 0, recruited: false });
    expect(fresh.voice.play).toHaveBeenCalledWith(`greeting__${alder}`);
    expect(greeting(fresh.element)).toBe(
      `"${t('entities.npcs.fire_and_fly_instructor.greeting')}"`,
    );
    const underWay = alderHarness({ trialsWon: 2, recruited: false });
    expect(underWay.voice.play).toHaveBeenCalledWith(`greeting__${alder}__trials`);
    expect(greeting(underWay.element)).toBe(
      `"${t('questUi.worldQuest.fireAndFly.greeting.trials')}"`,
    );
    const recruited = alderHarness({ trialsWon: 3, recruited: true });
    expect(recruited.voice.play).toHaveBeenCalledWith(`greeting__${alder}__recruited`);
    expect(recruited.voice.play).toHaveBeenCalledTimes(1);
    expect(greeting(recruited.element)).toBe(
      `"${t('questUi.worldQuest.fireAndFly.greeting.recruited')}"`,
    );
  });

  it('keeps the shown greeting and its clip on one stage when the board cannot open', () => {
    const h = alderHarness({ trialsWon: 3, recruited: true });
    h.controller.close();
    (h.world.player as { dead: boolean }).dead = true;
    h.voice.play.mockClear();
    h.controller.open(77);
    expect(h.element.querySelector('[data-gb-row]')).toBeNull();
    expect(h.element.querySelector('.qd-text')?.textContent).toBe(
      `"${t('questUi.worldQuest.fireAndFly.greeting.recruited')}"`,
    );
    expect(h.voice.play).toHaveBeenCalledWith(`greeting__${FIRE_AND_FLY_NPC_DEF.id}__recruited`);
  });

  it('paints the board instead of listing the scenarios as start buttons', () => {
    const h = alderHarness({ trialsWon: 1, recruited: false });
    expect(h.element.querySelector('#quest-dialog-title')?.textContent).toBe('Gunnery Board');
    expect(h.element.querySelectorAll('[data-start-wq], [data-difficulty]')).toHaveLength(0);
    expect(rows(h.element).map((row) => row.querySelector('.gb-row-name')?.textContent)).toEqual([
      "Recruit's Trial",
      'Standing Watch',
      "Veterans' Test",
      'The Pack',
      'The Deluge',
      'The Cracked Tower',
      'The Powder Store',
    ]);
    expect(h.element.querySelectorAll('[data-gb-take]')).toHaveLength(1);
    expect(h.element.textContent?.match(/practice run/gi) ?? []).toHaveLength(0);
    expect(h.element.getAttribute('role')).toBe('dialog');
    expect(h.element.getAttribute('aria-labelledby')).toBe('quest-dialog-title');
  });

  it('opens on the next trial, and a locked pick disables the action with its reason', () => {
    const h = alderHarness({ trialsWon: 1, recruited: false });
    const selected = rows(h.element).filter((row) => row.getAttribute('aria-selected') === 'true');
    expect(selected.map((row) => row.dataset.gbRow)).toEqual(['fire_and_fly_standard']);
    expect(selected[0].tabIndex).toBe(0);
    rows(h.element)[3].click();
    expect(action(h.element).disabled).toBe(true);
    expect(action(h.element).getAttribute('aria-describedby')).toBe('gb-locked');
    expect(h.element.querySelector('#gb-locked')?.textContent).toBe(
      "Win the Veterans' Test to be recruited and open the missions.",
    );
    // In the foot, right above the button it disables: a phone pins the foot, so the
    // reason is never left below the fold of the scrolling brief.
    expect(h.element.querySelector('.gb-foot > #gb-locked + [data-gb-take]')).not.toBeNull();
    action(h.element).click();
    expect(h.startWorldQuestActivity).not.toHaveBeenCalled();
  });

  it("takes the picked mission through the instructor's start command", () => {
    const h = alderHarness({ trialsWon: 3, recruited: true });
    rows(h.element)
      .find((row) => row.dataset.gbRow === 'fire_and_fly_powder')
      ?.click();
    expect(action(h.element).textContent).toBe('Take the mission');
    action(h.element).click();
    expect(h.targetEntity).toHaveBeenCalledWith(77);
    expect(h.startWorldQuestActivity).toHaveBeenCalledWith(FIRE_AND_FLY_QUEST_ID, {
      courseId: 'fire_and_fly_powder',
    });
    expect(h.controller.isOpen).toBe(false);
  });

  it('moves the pick with the arrows, keeps them from the game, and takes it on Enter', () => {
    const h = alderHarness({ trialsWon: 3, recruited: true }, 'completed');
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const first = row(h.element, (el) => el.dataset.gbRow === 'fire_and_fly_pack');
    press(first, 'ArrowDown');
    const next = row(h.element, (el) => el.getAttribute('aria-selected') === 'true');
    expect(next.dataset.gbRow).toBe('fire_and_fly_deluge');
    expect(document.activeElement).toBe(next);
    expect(action(h.element).textContent).toBe('Practice');
    press(next, 'Enter');
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
    expect(h.startWorldQuestActivity).toHaveBeenCalledWith(FIRE_AND_FLY_QUEST_ID, {
      courseId: 'fire_and_fly_deluge',
    });
  });

  it("paints the medals from the character's own records, with no ladder request", () => {
    const pack = fireAndFlyScoreboardId('fire_and_fly_pack', 'lifetime') as string;
    const h = alderHarness({ trialsWon: 3, recruited: true }, 'active', {
      [pack]: { metric: 20_900, medal: 'gold', day: '2030-01-01' },
    });
    expect(h.worldQuestLeaderboard).not.toHaveBeenCalled();
    const packRow = row(h.element, (el) => el.dataset.gbRow === 'fire_and_fly_pack');
    expect(packRow.querySelector('.gb-medal-gold')?.getAttribute('title')).toBe('Gold medal');
    expect(h.element.querySelector('.gb-mastery')?.textContent).toBe(
      "Gunner's Mastery: 3 of 12 stars",
    );
    // The pack has its medal: the board opens on the first mission without one.
    expect(
      rows(h.element).find((row) => row.getAttribute('aria-selected') === 'true')?.dataset.gbRow,
    ).toBe('fire_and_fly_deluge');
    rows(h.element)
      .find((row) => row.dataset.gbRow === 'fire_and_fly_pack')
      ?.click();
    expect(h.element.querySelector('.gb-fact-best dd')?.textContent).toBe(
      'Gold medal, 20,900 points',
    );
  });

  it('keeps focus on the close button across a quest-event repaint', () => {
    const h = alderHarness({ trialsWon: 3, recruited: true });
    h.element.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    h.controller.refresh();
    expect(document.activeElement).toBe(h.element.querySelector('[data-close]'));
  });

  it('keeps the pick across a quest-event repaint and drops it on a fresh open', () => {
    const h = alderHarness({ trialsWon: 3, recruited: true });
    rows(h.element)
      .find((row) => row.dataset.gbRow === 'fire_and_fly_deluge')
      ?.click();
    h.controller.refresh();
    const picked = () =>
      rows(h.element).find((row) => row.getAttribute('aria-selected') === 'true')?.dataset.gbRow;
    expect(picked()).toBe('fire_and_fly_deluge');
    h.controller.close();
    h.controller.open(77);
    expect(picked()).toBe('fire_and_fly_pack');
  });

  it('closes from its own close button', () => {
    const h = alderHarness({ trialsWon: 0, recruited: false });
    rows(h.element)[1].click();
    h.element.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(h.controller.isOpen).toBe(false);
  });
});

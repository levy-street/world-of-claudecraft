// @vitest-environment happy-dom
//
// hub_lesson_controller.ts: the Eastbrook hub coach's thin DOM consumer.
// Reproduces the two playtest defects fixed here (coaching before Hale's
// quest is accepted; a step naming a real control not also echoed above the
// correct dummy) and pins the accompanying eligibility/accessibility/mobile
// corrections, driving the REAL controller over a hand-rolled meters port
// (the meters_windows.test.ts fake-IWorld idiom).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HUB_DUMMY_DRILL_QUEST_ID,
  HUB_HEALING_DRILL_QUEST_ID,
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import type { QuestState } from '../src/sim/types';
import {
  HubLessonController,
  type HubLessonControllerDeps,
  type HubLessonEncounterLike,
  type HubLessonMetersPort,
  type HubMeterTab,
} from '../src/ui/hud/practice/hub_lesson_controller';
import type { IWorld } from '../src/world_api';

const PID = 1;
const DAMAGE_DUMMY_ID = 200;
const HEALING_DUMMY_ID = 201;

/** A controllable double for the narrow meters slice the controller reads. */
class FakeMeters {
  anyOpen = false;
  tabOpenState: Record<HubMeterTab, boolean> = { dmg: false, heal: false, threat: false };
  currentEnc: HubLessonEncounterLike | null = null;
  historyList: HubLessonEncounterLike[] = [];
  viewedByTab: Record<HubMeterTab, { startedAt: number; isCurrent: boolean } | null> = {
    dmg: null,
    heal: null,
    threat: null,
  };
  tooltipVisible = false;
  readonly rowEl = document.createElement('div');
  readonly historyArrowEl = document.createElement('button');
  readonly tabButtonEl = document.createElement('button');

  port(): HubLessonMetersPort {
    return {
      anyWindowOpen: () => this.anyOpen,
      tabOpen: (tab) => this.tabOpenState[tab],
      tabButtonElement: () => this.tabButtonEl,
      historyArrowElement: () => this.historyArrowEl,
      rowElementForPid: () => this.rowEl,
      viewedEncounter: (tab) => this.viewedByTab[tab],
      current: () => this.currentEnc,
      history: () => this.historyList,
    };
  }
}

function enc(startedAt: number, dummyId: string, dmg = 1): HubLessonEncounterLike {
  return { startedAt, mainMobTemplateId: dummyId, tallies: new Map([[PID, { dmg, heal: 0 }]]) };
}

function fakeWorld(playerClass: 'warrior' | 'priest' = 'warrior') {
  const entities = new Map<number, any>();
  const player: {
    id: number;
    name: string;
    level: number;
    targetId: number | null;
    pos: { x: number; y: number; z: number };
  } = {
    id: PID,
    name: 'Hero',
    level: 5,
    targetId: null,
    pos: { x: HUB_TRAINING_DUMMY_POS.x, y: 0, z: HUB_TRAINING_DUMMY_POS.z },
  };
  entities.set(PID, { id: PID, kind: 'player', templateId: playerClass });
  entities.set(DAMAGE_DUMMY_ID, {
    id: DAMAGE_DUMMY_ID,
    kind: 'mob',
    templateId: HUB_TRAINING_DUMMY_ID,
    dead: false,
    pos: { x: HUB_TRAINING_DUMMY_POS.x, y: 0, z: HUB_TRAINING_DUMMY_POS.z },
  });
  entities.set(HEALING_DUMMY_ID, {
    id: HEALING_DUMMY_ID,
    kind: 'mob',
    templateId: HUB_HEALING_DUMMY_ID,
    dead: false,
    pos: { x: HUB_HEALING_DUMMY_POS.x, y: 0, z: HUB_HEALING_DUMMY_POS.z },
  });
  const quests: Partial<Record<string, QuestState>> = {};
  const world = {
    cfg: { playerClass },
    entities,
    player,
    questState: (id: string): QuestState => quests[id] ?? 'unavailable',
  } as unknown as IWorld;
  return { world, entities, player, quests };
}

function makeController(
  world: IWorld,
  meters: FakeMeters,
  overrides: Partial<HubLessonControllerDeps> = {},
) {
  const element = document.createElement('div');
  element.id = 'hub-lesson-coach';
  document.body.appendChild(element);
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const projections: Array<{ x: number; y: number; z: number }> = [];
  const controller = new HubLessonController({
    element,
    world,
    keybinds: { primaryLabel: () => 'X' } as unknown as HubLessonControllerDeps['keybinds'],
    meters: meters.port(),
    worldToScreen: (x, y, z) => {
      projections.push({ x, y, z });
      return { x: 100, y: 80, behind: false };
    },
    ...overrides,
  });
  return { controller, element, projections };
}

function bubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.tut-prompt-hub-lesson');
}

let now = 0;
function tick(controller: HubLessonController, ms = 300): void {
  now += ms;
  controller.update(now);
}

beforeEach(() => {
  document.body.innerHTML = '';
  now = 0;
});

describe('HubLessonController: eligibility gating', () => {
  it('shows nothing while the quest sits unaccepted (available)', () => {
    const { world, quests } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'available';
    const { controller, element } = makeController(world, new FakeMeters());
    tick(controller);
    expect(element.innerHTML).toBe('');
    expect(element.style.display).not.toBe('block');
    expect(bubble()).toBeNull();
  });

  it('starts coaching, mirrored in the world bubble, the instant the quest is accepted', () => {
    const { world, quests } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const { controller, element, projections } = makeController(world, new FakeMeters());
    tick(controller);
    expect(element.style.display).toBe('block');
    expect(element.innerHTML).toContain('Target the dummy to begin.');
    const b = bubble();
    expect(b).not.toBeNull();
    expect(b!.style.display).toBe('flex');
    expect(b!.innerHTML).toBe(element.innerHTML);
    // Anchored over the DAMAGE dummy, not a guessed position.
    expect(projections.at(-1)).toMatchObject({
      x: HUB_TRAINING_DUMMY_POS.x,
      z: HUB_TRAINING_DUMMY_POS.z,
    });
  });

  it('hides again on abandonment (back to available)', () => {
    const { world, quests } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const { controller, element } = makeController(world, new FakeMeters());
    tick(controller);
    expect(element.style.display).toBe('block');
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'available';
    tick(controller);
    expect(element.innerHTML).toBe('');
    expect(bubble()!.style.display).toBe('none');
  });

  it('stays eligible through ready/done so a turn-in never cuts off owed guidance', () => {
    const { world, quests } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'ready';
    const { controller, element } = makeController(world, new FakeMeters());
    tick(controller);
    expect(element.style.display).toBe('block');
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'done';
    tick(controller);
    expect(element.style.display).toBe('block');
  });
});

describe('HubLessonController: reacceptance refreshes the zero-attempt baseline', () => {
  it('does not credit combat that landed while the track was abandoned as the first attempt', () => {
    const { world, quests, player } = fakeWorld();
    const meters = new FakeMeters();
    // A qualifying encounter already sits on the ledger the instant the
    // quest is first accepted: this seeds the baseline to key 10.
    meters.historyList = [enc(10, HUB_TRAINING_DUMMY_ID)];
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const { controller } = makeController(world, meters);
    tick(controller); // seeds lastCountedKey = 10, attempts stays 0

    // Abandoned...
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'available';
    tick(controller);

    // ...and more (unwatched) combat lands on the ledger before re-accepting.
    meters.historyList = [enc(20, HUB_TRAINING_DUMMY_ID)];

    // Re-accepted, still targeting, window+tab already open: with the fix,
    // key 20 is the new baseline and does NOT itself count as the attempt.
    player.targetId = DAMAGE_DUMMY_ID;
    meters.anyOpen = true;
    meters.tabOpenState.dmg = true;
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const element = document.getElementById('hub-lesson-coach')!;
    tick(controller);
    // Still AWAITING an attempt ('act'), never jumped straight to
    // 'read-row' off the pre-existing key-20 encounter.
    expect(element.innerHTML).toContain('Attack the dummy to start the measurement.');

    // A genuinely NEW attempt (key 30) is what finally counts.
    meters.currentEnc = enc(30, HUB_TRAINING_DUMMY_ID);
    meters.viewedByTab.dmg = { startedAt: 30, isCurrent: true };
    tick(controller);
    expect(element.innerHTML).toContain('Total is all your damage this run.');
  });
});

describe('HubLessonController: the world bubble mirrors every guided step', () => {
  function accept() {
    const { world, quests, player, entities } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const meters = new FakeMeters();
    const { controller, element } = makeController(world, meters);
    return { world, quests, player, entities, meters, controller, element };
  }

  it('mirrors open-window/open-tab/act with identical, dummy-anchored html', () => {
    const { player, meters, controller, element } = accept();
    tick(controller);
    expect(bubble()!.innerHTML).toBe(element.innerHTML);

    player.targetId = DAMAGE_DUMMY_ID;
    tick(controller);
    expect(element.innerHTML).toContain('Open');
    expect(bubble()!.innerHTML).toBe(element.innerHTML);

    meters.anyOpen = true;
    tick(controller);
    expect(element.innerHTML).toContain('Switch to the Damage tab.');
    expect(bubble()!.innerHTML).toBe(element.innerHTML);

    meters.tabOpenState.dmg = true;
    tick(controller);
    expect(element.innerHTML).toContain('Attack the dummy to start the measurement.');
    expect(bubble()!.innerHTML).toBe(element.innerHTML);
  });

  it('read-row Continue works from the bubble copy, identically to the tracker copy', () => {
    const { player, meters, controller, element } = accept();
    player.targetId = DAMAGE_DUMMY_ID;
    meters.anyOpen = true;
    meters.tabOpenState.dmg = true;
    tick(controller); // -> act
    meters.currentEnc = enc(100, HUB_TRAINING_DUMMY_ID);
    meters.viewedByTab.dmg = { startedAt: 100, isCurrent: true };
    tick(controller); // qualifying attempt lands -> read-row
    expect(element.innerHTML).toContain('Total is all your damage this run.');
    expect(element.querySelector('.hlc-ack')).not.toBeNull();
    const bubbleAck = bubble()!.querySelector<HTMLButtonElement>('.hlc-ack');
    expect(bubbleAck).not.toBeNull();
    // Accessibility fix: a real, reachable button, never hidden from AT.
    expect(bubble()!.hasAttribute('aria-hidden')).toBe(false);
    expect(bubbleAck!.hasAttribute('tabindex')).toBe(false);

    bubbleAck!.click(); // click the WORLD copy, not the tracker's
    tick(controller);
    expect(element.innerHTML).toContain(
      'Hover, focus, or hold your row for the per-ability split.',
    );
    expect(bubble()!.innerHTML).toBe(element.innerHTML);
  });

  it('anchors the healing track bubble over the healing dummy, not the damage one', () => {
    const { world, quests, player } = fakeWorld('priest');
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'unavailable';
    quests[HUB_HEALING_DRILL_QUEST_ID] = 'active';
    player.pos = { x: HUB_HEALING_DUMMY_POS.x, y: 0, z: HUB_HEALING_DUMMY_POS.z };
    const meters = new FakeMeters();
    const { controller, projections } = makeController(world, meters);
    tick(controller);
    expect(projections.at(-1)).toMatchObject({
      x: HUB_HEALING_DUMMY_POS.x,
      z: HUB_HEALING_DUMMY_POS.z,
    });
  });

  it('shows the wrong-run fallback identically on both surfaces, with no ack button', () => {
    const { player, meters, controller, element } = accept();
    player.targetId = DAMAGE_DUMMY_ID;
    meters.anyOpen = true;
    meters.tabOpenState.dmg = true;
    tick(controller); // -> act
    meters.currentEnc = enc(100, HUB_TRAINING_DUMMY_ID);
    // The panel is showing some OTHER segment, not the tracked attempt:
    // needsTrackedRun is true, so the step falls back to "find your run".
    meters.viewedByTab.dmg = { startedAt: 999, isCurrent: false };
    tick(controller);
    expect(element.innerHTML).toContain('Use the meter arrows to return to your practice run.');
    expect(element.querySelector('.hlc-ack')).toBeNull();
    expect(bubble()!.innerHTML).toBe(element.innerHTML);
    expect(bubble()!.querySelector('.hlc-ack')).toBeNull();
  });

  it('hides the bubble (but not the tracker) once the correct dummy is missing', () => {
    const { world, quests, entities } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const meters = new FakeMeters();
    const { controller, element } = makeController(world, meters);
    tick(controller);
    expect(bubble()!.style.display).toBe('flex');
    expect(element.classList.contains('hlc-bubble-visible')).toBe(true);
    entities.delete(DAMAGE_DUMMY_ID);
    tick(controller);
    expect(element.style.display).toBe('block');
    expect(bubble()!.style.display).toBe('none');
    expect(element.classList.contains('hlc-bubble-visible')).toBe(false);
  });

  it('marks the tracker only while the bubble is actually on screen, falling back off-viewport or too near the top', () => {
    const { world, quests } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const meters = new FakeMeters();
    let sx = 100;
    let sy = 80;
    const { controller, element } = makeController(world, meters, {
      worldToScreen: () => ({ x: sx, y: sy, behind: false }),
    });

    tick(controller);
    expect(element.classList.contains('hlc-bubble-visible')).toBe(true);
    expect(bubble()!.style.display).toBe('flex');

    sx = window.innerWidth + 200; // off the right edge
    tick(controller);
    expect(element.classList.contains('hlc-bubble-visible')).toBe(false);
    expect(bubble()!.style.display).toBe('none');

    sx = 100;
    sy = 10; // on screen, but too close to the top for the upward bubble
    tick(controller);
    expect(element.classList.contains('hlc-bubble-visible')).toBe(false);
    expect(bubble()!.style.display).toBe('none');

    sy = 200; // clears both fallbacks again
    tick(controller);
    expect(element.classList.contains('hlc-bubble-visible')).toBe(true);
    expect(bubble()!.style.display).toBe('flex');
  });

  it('never hides the tracker via inline style; the touch hide is a scoped CSS rule (desktop keeps both)', () => {
    const { controller, element } = accept();
    tick(controller);
    expect(document.body.classList.contains('mobile-touch')).toBe(false);
    expect(element.classList.contains('hlc-bubble-visible')).toBe(true);
    expect(element.style.display).toBe('block');
  });

  it('hides everything outside the yard, keeps the replay offer tracker-only', () => {
    const { world, quests, player } = fakeWorld();
    quests[HUB_DUMMY_DRILL_QUEST_ID] = 'active';
    const meters = new FakeMeters();
    const { controller, element } = makeController(world, meters);
    tick(controller);
    player.pos = { x: 5000, y: 0, z: 5000 };
    tick(controller);
    expect(element.innerHTML).toBe('');
    expect(bubble()!.style.display).toBe('none');
  });

  it('tears down the bubble and the tracker on dispose', () => {
    const { controller, element } = accept();
    tick(controller);
    expect(bubble()).not.toBeNull();
    controller.dispose();
    expect(bubble()).toBeNull();
    expect(element.innerHTML).toBe('');
    expect(element.style.display).toBe('none');
    expect(() => tick(controller)).not.toThrow();
  });
});

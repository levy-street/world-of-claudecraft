import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { QUESTS, WORLD_QUESTS } from '../src/sim/data';
import { createForgeWorkshop } from '../src/sim/minigames/forge_workshop';
import { createGliderFlightState, scoreGliderFlight } from '../src/sim/minigames/glider_flight';
import type { QuestProgress, WorldQuestProgress } from '../src/sim/types';
import * as questStrip from '../src/ui/hud/quest/quest_strip_controller';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import { makeWriterFacet } from '../src/ui/painter_host';
import { dropPointerFocus } from '../src/ui/pointer_blur';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';

const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

/** A private facet per rig: the controller takes Hud's shared one in production,
 *  and a test needs only the elision behaviour. */
function writers() {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
}

function progress(questId: string, state: QuestProgress['state'] = 'active'): QuestProgress {
  return {
    questId,
    state,
    counts: QUESTS[questId].objectives.map((objective, index) =>
      index === 0 ? objective.count : 0,
    ),
  };
}

/** In-memory Storage stand-in, so a rig never touches the shipped per-character rows. */
function fakeStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

function harness(
  entries: QuestProgress[] = [],
  worldEntries: WorldQuestProgress[] = [],
  clueHunt: { huntId: string; step: number } | null = null,
) {
  const questLog = new Map(entries.map((entry) => [entry.questId, entry]));
  const worldQuestLog = new Map(worldEntries.map((entry) => [entry.questId, entry]));
  const tracking = new QuestTrackingState(fakeStorage());
  // Same identity the fake world reports, so the controller's own per-frame sync
  // is a no-op and a rig can seed the set before the first update.
  tracking.useCharacter('warrior', 'Adventurer');
  let html = '';
  let writes = 0;
  let collapsed = false;
  const header = {
    classList: { contains: (value: string) => value === 'qt-header' },
    focus: vi.fn(),
    // A real blur moves document focus to the body; the fake document mirrors that.
    blur: vi.fn(() => {
      docState.activeElement = null;
    }),
  };
  const docState: { activeElement: unknown } = { activeElement: header };
  const element = {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      writes++;
    },
    querySelector: (selector: string) => (selector === '.qt-header' ? header : null),
  } as unknown as HTMLElement;
  const document = docState as unknown as Document;
  const settings = {
    available: vi.fn(() => true),
    collapsed: vi.fn(() => collapsed),
    setCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
  };
  const click = vi.fn();
  const controller = new QuestTrackerController({
    writers: writers(),
    element,
    document,
    world: () =>
      ({
        cfg: { playerClass: 'warrior' },
        player: { name: 'Adventurer' },
        questLog,
        worldQuestLog,
        clueHunt,
      }) as unknown as Pick<IWorld, 'questLog' | 'cfg' | 'player' | 'worldQuestLog' | 'clueHunt'>,
    settings,
    tracking,
    questTitle: (questId) => `title:${questId}`,
    objectiveLabel: (questId, index) => `objective:${questId}:${index}`,
    click,
  });
  return {
    controller,
    questLog,
    tracking,
    settings,
    click,
    header,
    html: () => html,
    writes: () => writes,
    setCollapsed: (next: boolean) => {
      collapsed = next;
    },
    collapsed: () => collapsed,
  };
}

describe('QuestTrackerController', () => {
  it('drops an untracked quest from the tracker and reserves its acceptance number', () => {
    // The map badges number every LOG entry, so an untracked quest must leave a
    // gap rather than renumber the rows after it; otherwise a tracker row and the
    // gold badge for the same quest would name different numbers.
    const wolves = progress('q_wolves');
    wolves.counts[0] = 0;
    const test = harness([wolves, progress('q_boars', 'ready')]);
    test.controller.update(0);
    expect(test.html()).toContain('title:q_wolves');

    test.tracking.setTracked('q_wolves', false);
    test.controller.update(0);

    expect(test.html()).not.toContain('title:q_wolves');
    expect(test.html()).toContain('title:q_boars');
    // q_boars keeps the number 2 it had while q_wolves was tracked.
    expect(test.html()).toContain('class="qt-num ui-badge ui-num">2</span>title:q_boars');
    expect(test.html()).toContain('<span class="qt-count ui-num">1</span>');
    // Presentation only: the quest is still in the authoritative log.
    expect(test.questLog.has('q_wolves')).toBe(true);
  });

  it('brings a re-tracked quest back on the next update', () => {
    const test = harness([progress('q_wolves'), progress('q_boars', 'ready')]);
    test.tracking.setTracked('q_wolves', false);
    test.controller.update(0);
    expect(test.html()).not.toContain('title:q_wolves');

    test.tracking.setTracked('q_wolves', true);
    test.controller.update(0);
    expect(test.html()).toContain('title:q_wolves');
  });

  it('renders authoritative quests in acceptance order and elides an identical paint', () => {
    const wolves = progress('q_wolves');
    wolves.counts[0] = 0;
    const test = harness([wolves, progress('q_boars', 'ready')]);

    test.controller.update(0);
    test.controller.update(0);

    expect(test.writes()).toBe(1);
    expect(test.html()).toContain('title:q_wolves');
    expect(test.html()).toContain('title:q_boars');
    expect(test.html().indexOf('title:q_wolves')).toBeLessThan(
      test.html().indexOf('title:q_boars'),
    );
    expect(test.html()).toContain('objective:q_wolves:0');
    expect(test.html()).toContain('quest-complete');
    expect(test.html()).toContain('class="qt-header ui-cin"');
    // A <button> takes no colour from #quest-tracker, so the heading names the
    // gold accent itself (the review finding: it rendered black).
    expect(hudCss).toMatch(/#quest-tracker \.qt-header \{\s*\n\s*color: var\(--color-accent\);/);
    expect(test.html()).toContain('class="qt-num ui-badge ui-num"');
    // The right-rail board separates the objective label from its live numeric column.
    expect(test.html()).toContain('class="qt-obj ui-meta counted"');
    expect(test.html()).toContain('class="qt-obj-count ui-num"');
    expect(test.html()).toContain('0 / 8');
    expect(test.html()).toContain('<span class="qt-count ui-num">2</span>');
  });

  it('renders complete and single-target objectives without a numeric column', () => {
    const incomplete = progress('q_greyjaw');
    incomplete.counts[0] = 0;
    const test = harness([incomplete, progress('q_ringleader')]);

    test.controller.update(0);

    expect(test.html()).toContain('class="qt-obj ui-meta muted"');
    expect(test.html()).toContain('objective:q_greyjaw:0</span></div>');
    expect(test.html()).toContain('class="qt-obj ui-meta done"');
    expect(test.html()).toContain('objective:q_ringleader:0</span></div>');
    expect(test.html()).not.toContain('class="qt-obj-count ui-num"');
  });

  it('keeps an unknown quest id tracked at its log position, never a throw (R34)', () => {
    // The log is server truth: a quest accepted on a current client reaches a
    // bundle that predates it. The tracker runs every frame inside
    // hud.update(), so a throw here used to kill the whole HUD tail; and a
    // SKIP would desync the tracker numbers from the world map badges, which
    // number every log entry. The unknown entry renders its raw id with no
    // objectives, and the KNOWN quest behind it keeps number 3.
    // Built by hand: the progress() helper derives counts from QUESTS, which
    // is exactly what an unknown id cannot do (the wire sends counts as-is).
    const ghost = { questId: 'q_ghost_of_v33', state: 'active' as const, counts: [0] };
    // The prototype-key arm: QUESTS is a prototype-bearing Record, so a bare
    // truthiness read resolves 'constructor' to a FUNCTION and the objectives
    // deref throws; only the own-property gate renders it as unknown.
    const proto = { questId: 'constructor', state: 'active' as const, counts: [0] };
    const test = harness([progress('q_wolves'), ghost, proto, progress('q_boars', 'ready')]);

    test.controller.update(0);

    expect(test.html()).toContain('q_ghost_of_v33');
    // The title SAYS unknown (the questUi.tracker.unknownQuest sentence
    // carrying the raw id), never a bare content slug on its own.
    expect(test.html()).toContain('Unknown quest (q_ghost_of_v33)');
    expect(test.html().indexOf('title:q_wolves')).toBeLessThan(
      test.html().indexOf('q_ghost_of_v33'),
    );
    expect(test.html().indexOf('q_ghost_of_v33')).toBeLessThan(
      test.html().indexOf('title:q_boars'),
    );
    // No objective rows for the unknown entries; the prototype key renders
    // as its raw id too, never a function deref.
    expect(test.html()).not.toContain('objective:q_ghost_of_v33');
    expect(test.html()).toContain('constructor');
    expect(test.html()).not.toContain('objective:constructor');
  });

  it('clears a stale collapse preference once when the authoritative log empties', () => {
    const test = harness();
    test.setCollapsed(true);

    test.controller.update(0);
    test.controller.update(0);

    expect(test.settings.setCollapsed).toHaveBeenCalledTimes(1);
    expect(test.settings.setCollapsed).toHaveBeenCalledWith(false);
    expect(test.html()).toBe('');
    expect(test.writes()).toBe(0);
  });

  it('renders the tracker header label through the real questUi.tracker.title key, at its runtime home', () => {
    // The static index.html markup dropped its data-i18n="questUi.tracker.title"
    // node (tests/localization_coverage.test.ts pins the absence): the header
    // label is now painted here, directly via t('questUi.tracker.title')
    // (quest_tracker_controller.ts), never through the questTitle dep (which
    // only names individual quest rows). English source: 'Quests'
    // (src/ui/i18n.catalog/quests.ts).
    const test = harness([progress('q_wolves')]);
    test.controller.update(0);
    expect(test.html()).toContain('<span class="qt-h-label">Quests</span>');
  });

  it('persists a toggle, repaints the collapsed header, and restores header focus', () => {
    const test = harness([progress('q_wolves')]);
    test.controller.update(0);

    test.controller.toggleCollapsed();

    expect(test.collapsed()).toBe(true);
    expect(test.settings.setCollapsed).toHaveBeenLastCalledWith(true);
    expect(test.click).toHaveBeenCalledTimes(1);
    expect(test.html()).toContain('aria-expanded="false"');
    expect(test.html()).not.toContain('title:q_wolves');
    expect(test.header.focus).toHaveBeenCalledTimes(1);
  });

  it('does not restore header focus after a pointer-driven toggle (the focus drop ran first)', () => {
    // hud.ts binds the pointer-only focus drop (src/ui/pointer_blur.ts) over
    // #quest-tracker in the CAPTURE phase, so a mouse click drops the header's
    // focus before the click handler toggles and repaints: the repaint's refocus
    // check (activeElement is a .qt-header) then sees nothing to restore, and the
    // header cannot be left holding focus for Space to re-toggle. Keyboard
    // activation (no drop) keeps the restore above.
    const test = harness([progress('q_wolves')]);
    test.controller.update(0);

    dropPointerFocus(test.header);
    test.controller.toggleCollapsed();

    expect(test.header.blur).toHaveBeenCalledTimes(1);
    expect(test.collapsed()).toBe(true);
    expect(test.header.focus).not.toHaveBeenCalled();
  });

  it('releases collapse after forging succeeds while retaining the result row', () => {
    const forging = createForgeWorkshop(42, 100);
    const rig = harness(
      [],
      [{ questId: 'wq_evergarden_forging', state: 'completed', count: 1, forging }],
    );
    rig.controller.update(0);
    rig.controller.toggleCollapsed();
    expect(rig.collapsed()).toBe(false);
    forging.phase = 'success';
    forging.result = { elapsed: 30, adjustedTime: 30, mistakes: 0, rating: 'gold' };
    rig.controller.update(1);
    expect(rig.html()).toContain('Gold! 30s. Mistakes: 0.');
    expect(rig.html()).not.toContain('disabled aria-disabled="true"');
    rig.controller.toggleCollapsed();
    expect(rig.collapsed()).toBe(true);
    rig.controller.toggleCollapsed();
    expect(rig.html()).toContain('Gold! 30s. Mistakes: 0.');
  });

  it('stops forcing touch selection on every update after forge success', () => {
    const update = vi.fn();
    const build = vi.spyOn(questStrip, 'buildQuestStrip').mockReturnValue({
      active: () => true,
      update,
    } as unknown as questStrip.QuestStripController);
    try {
      const forging = createForgeWorkshop(42, 100);
      const questId = 'wq_evergarden_forging';
      const rig = harness(
        [progress('q_wolves')],
        [{ questId, state: 'completed', count: 1, forging }],
      );
      rig.controller.update(0);
      expect(update.mock.lastCall?.[2]).toBe(questId);
      forging.phase = 'working';
      rig.controller.update(1);
      expect(update.mock.lastCall?.[2]).toBe(questId);
      forging.phase = 'success';
      forging.result = { elapsed: 30, adjustedTime: 30, mistakes: 0, rating: 'gold' };
      for (const now of [2, 3, 4]) {
        rig.controller.update(now);
        expect(update.mock.lastCall?.[2]).toBeUndefined();
        expect(update.mock.lastCall?.[0].map((quest: { id: string }) => quest.id)).toEqual([
          'q_wolves',
          questId,
        ]);
      }
    } finally {
      build.mockRestore();
    }
  });

  it('keeps completed-quest practice visible and reads the sim clock rather than frame milliseconds', () => {
    const forging = createForgeWorkshop(42, 100);
    forging.phase = 'working';
    forging.observedAt = 103;
    const rig = harness(
      [],
      [
        {
          questId: 'wq_evergarden_forging',
          state: 'completed',
          count: 1,
          forging,
        },
      ],
    );
    rig.setCollapsed(true);
    rig.controller.update(500000);
    expect(rig.html()).toContain('Strikes: 0/10');
    expect(rig.html()).not.toContain('Gold:');
    expect(rig.html()).not.toContain('Stoke the fire');
    expect(rig.html()).not.toContain('500000');
    expect(rig.collapsed()).toBe(true);
    rig.controller.toggleCollapsed();
    expect(rig.collapsed()).toBe(true);
  });

  it('shows authoritative movement instructions even when collapsed without changing the preference', () => {
    const questId = 'wq_eastbrook_calligraphy';
    const entry: WorldQuestProgress = {
      questId,
      state: 'active',
      count: 0,
      tracing: {
        questId,
        shapeIndex: 0,
        phase: 'preview',
        previewUntil: 6,
        expiresAt: 80,
        trail: [],
        lastPosition: { x: 0, z: 0 },
        segment: 0,
        direction: 0,
        started: false,
      },
    };
    const rig = harness([], [entry]);
    rig.setCollapsed(true);
    rig.controller.update(0);
    expect(rig.html()).toContain('Watch the outline. Golden sparkles will guide you.');
    expect(rig.html()).toContain('Round 1 of 3: Triangle.');
    expect(rig.html()).toContain('disabled aria-disabled="true"');
    expect(rig.html()).not.toContain('title="Collapse quest tracker"');
    rig.controller.toggleCollapsed();
    expect(rig.collapsed()).toBe(true);
    expect(rig.settings.setCollapsed).not.toHaveBeenCalled();
    expect(rig.click).not.toHaveBeenCalled();
    if (!entry.tracing) throw new Error('missing tracing fixture');
    entry.tracing.phase = 'failed';
    entry.tracing.reason = 'off-path';
    rig.controller.update(1);
    expect(rig.html()).toContain('You left the outline.');
    const writes = rig.writes();
    rig.controller.update(2);
    expect(rig.writes()).toBe(writes);
    entry.count = 1;
    entry.tracing.shapeIndex = 1;
    entry.tracing.phase = 'preview';
    rig.controller.update(3);
    expect(rig.html()).toContain('Round 2 of 3: Square.');
    expect(rig.html()).not.toContain('You left the outline.');
    entry.count = 2;
    entry.tracing.shapeIndex = 2;
    entry.traceVariant = 'hourglass';
    rig.controller.update(4);
    expect(rig.html()).toContain('Round 3 of 3: Hourglass.');
    expect(rig.html()).not.toContain('2/3');
    entry.state = 'completed';
    entry.count = 3;
    entry.tracing.phase = 'success';
    entry.traceResult = { score: 87, rating: 'silver', precision: 80, efficiency: 90, time: 91 };
    rig.controller.update(5);
    expect(rig.html()).toContain(
      'Silver: 87/100. Base reward unchanged. Gold: deed, title, +10 Renown.',
    );
    expect(rig.html()).not.toContain('3/3');
    expect(rig.html()).toContain('quest-complete');
    expect(rig.html()).not.toContain('You left the outline.');
    delete entry.tracing;
    rig.controller.update(6);
    expect(rig.html()).not.toContain('87/100');
    expect(entry.traceResult.score).toBe(87);
  });

  it('tracks an active world quest without an accepted quest-log entry', () => {
    const quest = WORLD_QUESTS.find((entry) => entry.id === 'wq_eastbrook_bandits');
    expect(quest).toBeDefined();
    if (!quest) throw new Error('missing Eastbrook bandit fixture');
    const test = harness(
      [],
      [
        { questId: quest.id, count: 2, state: 'active' },
        { questId: 'wq_eastbrook_calligraphy', count: 1, state: 'completed' },
      ],
    );

    test.controller.update(0);

    expect(test.html()).toContain('Eastbrook Vale');
    expect(test.html()).not.toContain(`data-quest="${quest.id}"`);
    expect(test.html()).not.toMatch(/class="qt-title" role="button"[^>]*wq_/);
    expect(test.html()).toContain(`2 / ${quest.count}`);
    expect(test.html()).not.toContain('Arcane Calligraphy');
  });
});

it('tracks completed glider replays through flight and result without retaining stale saved medals', () => {
  const update = vi.fn();
  const build = vi
    .spyOn(questStrip, 'buildQuestStrip')
    .mockReturnValue({ active: () => true, update } as unknown as questStrip.QuestStripController);
  try {
    const glider = createGliderFlightState();
    const questId = 'wq_galecrest_slalom';
    const entry: WorldQuestProgress = { questId, state: 'completed', count: 1, glider };
    const rig = harness([], [entry]);
    for (const phase of ['countdown', 'flying'] as const) {
      glider.phase = phase;
      rig.controller.update(0);
      expect(update.mock.lastCall?.[2]).toBe(questId);
      expect(update.mock.lastCall?.[0]).toEqual([
        expect.objectContaining({ id: questId, complete: false }),
      ]);
    }
    glider.phase = 'won';
    glider.result = scoreGliderFlight(6, 6, 20);
    rig.controller.update(1);
    expect(update.mock.lastCall?.[2]).toBeUndefined();
    expect(update.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({
        id: questId,
        complete: true,
        objectives: expect.arrayContaining([
          expect.objectContaining({ label: expect.stringContaining('Gold') }),
        ]),
      }),
    ]);
    entry.gliderResult = glider.result;
    delete entry.glider;
    rig.controller.update(2);
    expect(update.mock.lastCall?.[0]).toEqual([]);
  } finally {
    build.mockRestore();
  }
});

it('rides the active Clue Scroll hunt as one row with the current clue as its instruction', () => {
  const test = harness([], [], { huntId: 'hunt_drakelands_gate_ashes', step: 1 });
  test.controller.update(0);
  expect(test.html()).toContain('Ashes at the Gate (clue 2 of 4)');
  // The clue prose is the whole objective line, with no numeric column.
  expect(test.html()).toContain('qt-obj ui-meta');
  expect(test.html()).not.toContain('class="qt-obj-count ui-num"');
  expect(test.html()).toContain('Scout Yerrin');
  expect(test.html()).toContain('<span class="qt-count ui-num">1</span>');
  // A retired hunt id paints nothing rather than throwing (R34).
  const retired = harness([], [], { huntId: 'hunt_nowhere', step: 0 });
  retired.controller.update(0);
  expect(retired.html()).toBe('');
});

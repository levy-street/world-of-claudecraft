import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { QUESTS, WORLD_QUESTS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createForgeWorkshop } from '../src/sim/minigames/forge_workshop';
import { createGliderFlightState, scoreGliderFlight } from '../src/sim/minigames/glider_flight';
import type { QuestProgress, WorldQuestProgress } from '../src/sim/types';
import * as questStrip from '../src/ui/hud/quest/quest_strip_controller';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import { makeWriterFacet } from '../src/ui/painter_host';
import { dropPointerFocus } from '../src/ui/pointer_blur';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from '../src/ui/world_quest_view';
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
  // The World Quests section lists a quest only while the player stands in
  // its area, so the rig's player stands at the first world quest's centre.
  const firstArea = worldEntries[0] && WORLD_QUESTS_BY_ID[worldEntries[0].questId]?.area;
  const playerPos = { x: firstArea?.x ?? 0, y: 0, z: firstArea?.z ?? 0 };
  const questLog = new Map(entries.map((entry) => [entry.questId, entry]));
  const worldQuestLog = new Map(worldEntries.map((entry) => [entry.questId, entry]));
  const tracking = new QuestTrackingState(fakeStorage());
  // Same identity the fake world reports, so the controller's own per-frame sync
  // is a no-op and a rig can seed the set before the first update.
  tracking.useCharacter('warrior', 'Adventurer');
  let html = '';
  let writes = 0;
  let collapsed = false;
  let worldQuestsCollapsed = false;
  const wqHeader = {
    classList: { contains: (value: string) => value === 'qt-header' },
    focus: vi.fn(),
  };
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
    querySelector: (selector: string) =>
      selector === '.qt-header:not([data-qt-section])'
        ? header
        : selector === '.qt-header[data-qt-section="worldQuests"]'
          ? wqHeader
          : null,
  } as unknown as HTMLElement;
  const document = docState as unknown as Document;
  const settings = {
    available: vi.fn(() => true),
    collapsed: vi.fn(() => collapsed),
    setCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
    worldQuestsCollapsed: vi.fn(() => worldQuestsCollapsed),
    setWorldQuestsCollapsed: vi.fn((next: boolean) => {
      worldQuestsCollapsed = next;
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
        player: { name: 'Adventurer', pos: playerPos },
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
    playerPos,
    questLog,
    tracking,
    settings,
    click,
    header,
    wqHeader,
    html: () => html,
    writes: () => writes,
    setCollapsed: (next: boolean) => {
      collapsed = next;
    },
    collapsed: () => collapsed,
    setWorldQuestsCollapsed: (next: boolean) => {
      worldQuestsCollapsed = next;
    },
    worldQuestsCollapsed: () => worldQuestsCollapsed,
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
    rig.controller.toggleCollapsed('worldQuests');
    expect(rig.worldQuestsCollapsed()).toBe(false);
    forging.phase = 'success';
    forging.result = { elapsed: 30, adjustedTime: 30, mistakes: 0, rating: 'gold' };
    rig.controller.update(1);
    expect(rig.html()).toContain('Gold! 30s. Mistakes: 0.');
    expect(rig.html()).not.toContain('disabled aria-disabled="true"');
    rig.controller.toggleCollapsed('worldQuests');
    expect(rig.worldQuestsCollapsed()).toBe(true);
    expect(rig.html()).not.toContain('Gold! 30s. Mistakes: 0.');
    rig.controller.toggleCollapsed('worldQuests');
    expect(rig.html()).toContain('Gold! 30s. Mistakes: 0.');
    // The Quests section is not on screen, so its toggle is inert.
    rig.controller.toggleCollapsed();
    expect(rig.settings.setCollapsed).not.toHaveBeenCalled();
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
    rig.setWorldQuestsCollapsed(true);
    rig.controller.update(500000);
    expect(rig.html()).toContain('Strikes: 0/10');
    expect(rig.html()).not.toContain('Gold:');
    expect(rig.html()).not.toContain('Stoke the fire');
    expect(rig.html()).not.toContain('500000');
    rig.controller.toggleCollapsed('worldQuests');
    expect(rig.worldQuestsCollapsed()).toBe(true);
    expect(rig.settings.setWorldQuestsCollapsed).not.toHaveBeenCalled();
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
    rig.setWorldQuestsCollapsed(true);
    rig.controller.update(0);
    expect(rig.html()).toContain('Watch the outline. Golden sparkles will guide you.');
    expect(rig.html()).toContain('Round 1 of 3: Triangle.');
    expect(rig.html()).toContain('disabled aria-disabled="true"');
    expect(rig.html()).not.toContain('title="Collapse quest tracker"');
    expect(rig.html()).not.toContain('title="Collapse world quests"');
    rig.controller.toggleCollapsed();
    rig.controller.toggleCollapsed('worldQuests');
    expect(rig.worldQuestsCollapsed()).toBe(true);
    expect(rig.settings.setCollapsed).not.toHaveBeenCalled();
    expect(rig.settings.setWorldQuestsCollapsed).not.toHaveBeenCalled();
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
    // Listed the classic way: the tally rides inline after the objective.
    expect(test.html()).toContain(`${worldQuestObjectiveLabel(quest.id)}: 2/${quest.count}`);
    expect(test.html()).not.toContain('Arcane Calligraphy');
  });

  it('lists a world quest only in its area, keeps it 5 sec after leaving, and keeps its progress', () => {
    const quest = WORLD_QUESTS.find((entry) => entry.id === 'wq_eastbrook_bandits');
    if (!quest) throw new Error('missing Eastbrook bandit fixture');
    const entry: WorldQuestProgress = { questId: quest.id, count: 5, state: 'active' };
    const test = harness([], [entry]);
    const row = `${worldQuestObjectiveLabel(quest.id)}: 5/${quest.count}`;
    test.controller.update(0);
    expect(test.html()).toContain(row);
    // Walk out of the area: the row lingers for the grace, then drops off.
    test.playerPos.x = quest.area.x + quest.area.radius + 50;
    test.controller.update(1_000);
    expect(test.html()).toContain(row);
    test.controller.update(1_000 + 5_000);
    expect(test.html()).not.toContain(row);
    // Back inside: the row returns with the same 5/N (display only, the
    // progress on the log entry never moved).
    test.playerPos.x = quest.area.x;
    test.controller.update(30_000);
    expect(test.html()).toContain(row);
    // Completed: it shows as done for the grace, then leaves the section.
    entry.state = 'completed';
    entry.count = quest.count;
    test.controller.update(31_000);
    expect(test.html()).toContain(worldQuestDisplayName(quest.id));
    test.controller.update(31_000 + 5_000);
    expect(test.html()).not.toContain(worldQuestDisplayName(quest.id));
  });

  it('gives world quests their own "World Quests" section after the Quests section', () => {
    const wolves = progress('q_wolves');
    wolves.counts[0] = 0;
    const questId = 'wq_eastbrook_bandits';
    const entry: WorldQuestProgress = { questId, count: 3, state: 'active' };
    const total = WORLD_QUESTS.find((quest) => quest.id === questId)?.count;
    expect(total).toBeGreaterThan(4);
    const test = harness([wolves], [entry]);
    test.controller.update(0);
    const html = test.html();

    const questsHeader = html.indexOf('<span class="qt-h-label">Quests</span>');
    const wqHeader = html.indexOf('<span class="qt-h-label">World Quests</span>');
    expect(questsHeader).toBeGreaterThanOrEqual(0);
    expect(wqHeader).toBeGreaterThan(questsHeader);
    expect(html).toContain(
      'class="qt-header qt-header-wq ui-cin" data-qt-section="worldQuests" aria-expanded="true" aria-controls="qt-wq-list" title="Collapse world quests"',
    );
    // Each list holds only its own rows: the normal quest keeps its log number
    // and click-to-open row, the world quest is a plain title with no badge.
    const quests = html.slice(html.indexOf('<div id="qt-list">'), html.indexOf('<button', 1));
    const worldQuests = html.slice(html.indexOf('<div id="qt-wq-list">'));
    expect(quests).toContain('data-quest="q_wolves"');
    expect(quests).toContain('title:q_wolves');
    expect(quests).not.toContain(worldQuestDisplayName(questId));
    expect(worldQuests).toContain(
      `<div class="qt-title qt-wq-title ui-cin">${worldQuestDisplayName(questId)}</div>`,
    );
    expect(worldQuests).not.toContain('title:q_wolves');
    expect(worldQuests).not.toContain('qt-num');
    expect(worldQuests).toContain(
      `<div class="qt-obj ui-meta counted"><span>- ${worldQuestObjectiveLabel(questId)}: 3/${total}</span></div>`,
    );
    // The Quests header counts its own rows only.
    expect(html).toContain(
      '<span class="qt-h-label">Quests</span> <span class="qt-count ui-num">1</span>',
    );
    expect(html).toContain(
      '<span class="qt-h-label">World Quests</span> <span class="qt-count ui-num">1</span>',
    );

    // Progress updates live on the next frame.
    entry.count = 4;
    test.controller.update(1);
    expect(test.html()).toContain(`${worldQuestObjectiveLabel(questId)}: 4/${total}`);
  });

  it('collapses each section on its own header and persists it in its own setting', () => {
    const questId = 'wq_eastbrook_bandits';
    const test = harness([progress('q_wolves')], [{ questId, count: 1, state: 'active' }]);
    test.controller.update(0);

    test.controller.toggleHeader({
      dataset: { qtSection: 'worldQuests' },
    } as unknown as HTMLElement);
    expect(test.settings.setWorldQuestsCollapsed).toHaveBeenLastCalledWith(true);
    expect(test.settings.setCollapsed).not.toHaveBeenCalled();
    expect(test.html()).toContain('data-qt-section="worldQuests" aria-expanded="false"');
    expect(test.html()).not.toContain(worldQuestDisplayName(questId));
    // The quest list is untouched, and the World Quests header keeps its count.
    expect(test.html()).toContain('title:q_wolves');
    expect(test.html()).toContain(
      '<span class="qt-h-label">World Quests</span> <span class="qt-count ui-num">1</span>',
    );

    // The Quests header (no section attribute) flips only the quest list.
    test.controller.toggleHeader({ dataset: {} } as unknown as HTMLElement);
    expect(test.collapsed()).toBe(true);
    expect(test.html()).not.toContain('title:q_wolves');
    test.controller.toggleHeader({
      dataset: { qtSection: 'worldQuests' },
    } as unknown as HTMLElement);
    expect(test.worldQuestsCollapsed()).toBe(false);
    expect(test.html()).toContain(worldQuestDisplayName(questId));
    expect(test.html()).not.toContain('title:q_wolves');
  });

  it('clears a stale collapse per section once that section empties', () => {
    // Quests collapsed while only world quests are tracked: the Quests header is
    // not on screen, so the next accepted quest must not arrive hidden.
    const onlyWorld = harness([], [{ questId: 'wq_eastbrook_bandits', count: 1, state: 'active' }]);
    onlyWorld.setCollapsed(true);
    onlyWorld.controller.update(0);
    expect(onlyWorld.settings.setCollapsed).toHaveBeenCalledTimes(1);
    expect(onlyWorld.settings.setCollapsed).toHaveBeenCalledWith(false);
    expect(onlyWorld.settings.setWorldQuestsCollapsed).not.toHaveBeenCalled();

    // World Quests collapsed with no world quest left (the daily reset): the
    // next world quest arrives expanded. The Quests preference is untouched.
    const onlyQuests = harness([progress('q_wolves')]);
    onlyQuests.setCollapsed(true);
    onlyQuests.setWorldQuestsCollapsed(true);
    onlyQuests.controller.update(0);
    onlyQuests.controller.update(1);
    expect(onlyQuests.settings.setWorldQuestsCollapsed).toHaveBeenCalledTimes(1);
    expect(onlyQuests.settings.setWorldQuestsCollapsed).toHaveBeenCalledWith(false);
    expect(onlyQuests.settings.setCollapsed).not.toHaveBeenCalled();
    expect(onlyQuests.collapsed()).toBe(true);
  });

  it('numbers the clue hunt row after the log, never counting world quests', () => {
    const test = harness(
      [progress('q_wolves')],
      [
        { questId: 'wq_eastbrook_bandits', count: 1, state: 'active' },
        { questId: 'wq_hollow_sporelings', count: 0, state: 'active' },
      ],
      { huntId: 'hunt_drakelands_gate_ashes', step: 0 },
    );
    test.controller.update(0);
    const quests = test.html().slice(0, test.html().indexOf('data-qt-section'));
    expect(quests).toContain('class="qt-num ui-badge ui-num">1</span>title:q_wolves');
    expect(quests).toContain('class="qt-num ui-badge ui-num">2</span>Ashes at the Gate');
  });

  it('keeps the World Quests header a disabled control on a host that cannot persist it', () => {
    const test = harness([], [{ questId: 'wq_eastbrook_bandits', count: 1, state: 'active' }]);
    const settings = test.settings as { setWorldQuestsCollapsed?: unknown };
    delete settings.setWorldQuestsCollapsed;
    test.controller.update(0);
    expect(test.html()).toMatch(/data-qt-section="worldQuests"[^>]*disabled aria-disabled="true"/);
    test.controller.toggleCollapsed('worldQuests');
    expect(test.click).not.toHaveBeenCalled();
  });

  it('restores keyboard focus to the World Quests header it toggled', () => {
    const test = harness([], [{ questId: 'wq_eastbrook_bandits', count: 1, state: 'active' }]);
    test.controller.update(0);
    test.controller.toggleCollapsed('worldQuests');
    expect(test.wqHeader.focus).toHaveBeenCalledTimes(1);
    expect(test.header.focus).not.toHaveBeenCalled();
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
    // The finished replay keeps its row for the completion grace, then the
    // stale saved medal is gone with it.
    rig.controller.update(2);
    expect(update.mock.lastCall?.[0]).toHaveLength(1);
    rig.controller.update(2 + 5_000);
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

import { describe, expect, it, vi } from 'vitest';
import { QUESTS } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import type { IWorld } from '../src/world_api';

function progress(questId: string, state: QuestProgress['state'] = 'active'): QuestProgress {
  return {
    questId,
    state,
    counts: QUESTS[questId].objectives.map((objective, index) =>
      index === 0 ? objective.count : 0,
    ),
  };
}

function harness(entries: QuestProgress[] = []) {
  const questLog = new Map(entries.map((entry) => [entry.questId, entry]));
  let html = '';
  let writes = 0;
  let collapsed = false;
  const header = {
    classList: { contains: (value: string) => value === 'qt-header' },
    focus: vi.fn(),
  };
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
  const document = { activeElement: header } as unknown as Document;
  const settings = {
    available: vi.fn(() => true),
    collapsed: vi.fn(() => collapsed),
    setCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
  };
  const click = vi.fn();
  const controller = new QuestTrackerController({
    element,
    document,
    world: () => ({ questLog }) as Pick<IWorld, 'questLog'>,
    settings,
    questTitle: (questId) => `title:${questId}`,
    objectiveLabel: (questId, index) => `objective:${questId}:${index}`,
    click,
  });
  return {
    controller,
    questLog,
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
  it('renders authoritative quests in acceptance order and elides an identical paint', () => {
    const test = harness([progress('q_wolves'), progress('q_boars', 'ready')]);

    test.controller.update();
    test.controller.update();

    expect(test.writes()).toBe(1);
    expect(test.html()).toContain('title:q_wolves');
    expect(test.html()).toContain('title:q_boars');
    expect(test.html().indexOf('title:q_wolves')).toBeLessThan(
      test.html().indexOf('title:q_boars'),
    );
    expect(test.html()).toContain('objective:q_wolves:0');
    expect(test.html()).toContain('quest-complete');
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

    test.controller.update();

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

    test.controller.update();
    test.controller.update();

    expect(test.settings.setCollapsed).toHaveBeenCalledTimes(1);
    expect(test.settings.setCollapsed).toHaveBeenCalledWith(false);
    expect(test.html()).toBe('');
    expect(test.writes()).toBe(0);
  });

  it('persists a toggle, repaints the collapsed header, and restores header focus', () => {
    const test = harness([progress('q_wolves')]);
    test.controller.update();

    test.controller.toggleCollapsed();

    expect(test.collapsed()).toBe(true);
    expect(test.settings.setCollapsed).toHaveBeenLastCalledWith(true);
    expect(test.click).toHaveBeenCalledTimes(1);
    expect(test.html()).toContain('aria-expanded="false"');
    expect(test.html()).not.toContain('title:q_wolves');
    expect(test.header.focus).toHaveBeenCalledTimes(1);
  });
});

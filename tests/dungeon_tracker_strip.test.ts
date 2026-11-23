// The dungeon run on TOUCH: there the right-anchored trackers give way to the
// top-band quest strip, so the run rides the strip as a page of its own
// (QuestTrackerController hands it over through its dungeonRow dep). Pinned
// here: the page trails the quests so nothing shifts under the selection, takes
// the strip once on first sight, never reaches the desktop tracker, and the
// real strip core then shows every boss.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUESTS } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { dungeonStripQuest } from '../src/ui/hud/dungeon/dungeon_tracker_view';
import * as questStrip from '../src/ui/hud/quest/quest_strip_controller';
import { questStripProgressJump, questStripView } from '../src/ui/hud/quest/quest_strip_core';
import type { TrackedQuest } from '../src/ui/hud/quest/quest_tracker';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import { makeWriterFacet } from '../src/ui/painter_host';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';
import type { DungeonRunView } from '../src/world_api/dungeons';

const CRYPT = ['sexton_marrow', 'rimeweb', 'cantor_ilvane', 'morthen'] as const;
const TEXT = {
  title: (dungeonId: string, heroic: boolean) => `${dungeonId}${heroic ? ' (H)' : ''}`,
  bossName: (mobId: string) => mobId,
};

function run(
  defeated: readonly string[] = [],
  difficulty: 'normal' | 'heroic' = 'normal',
): DungeonRunView {
  return {
    dungeonId: 'hollow_crypt',
    difficulty,
    bosses: CRYPT.map((mobId) => ({ mobId, defeated: defeated.includes(mobId) })),
  };
}

function progress(questId: string): QuestProgress {
  return { questId, state: 'active', counts: QUESTS[questId].objectives.map(() => 0) };
}

function fakeStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

interface Rig {
  controller: QuestTrackerController;
  /** The strip's update(quests, now, focusQuestId) calls. */
  update: ReturnType<typeof vi.fn>;
  world: { dungeonRun: DungeonRunView | null };
  dungeonRow: ReturnType<typeof vi.fn>;
  html(): string;
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function rig(touch: boolean, withDep = true): Rig {
  const update = vi.fn();
  const build = vi.spyOn(questStrip, 'buildQuestStrip').mockReturnValue({
    active: () => touch,
    update,
  } as unknown as questStrip.QuestStripController);
  restore = () => build.mockRestore();
  const world: { dungeonRun: DungeonRunView | null } = { dungeonRun: null };
  const dungeonRow = vi.fn((): TrackedQuest | null => dungeonStripQuest(world, TEXT));
  let html = '';
  const element = {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
    },
    querySelector: () => null,
  } as unknown as HTMLElement;
  const tracking = new QuestTrackingState(fakeStorage());
  tracking.useCharacter('warrior', 'Adventurer');
  const controller = new QuestTrackerController({
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
    element,
    document: { activeElement: null } as unknown as Document,
    world: () =>
      ({
        cfg: { playerClass: 'warrior' },
        player: { name: 'Adventurer', pos: { x: 0, y: 0, z: 0 } },
        questLog: new Map([['q_wolves', progress('q_wolves')]]),
        worldQuestLog: new Map(),
        clueHunt: null,
      }) as unknown as Pick<IWorld, 'questLog' | 'cfg' | 'player' | 'worldQuestLog' | 'clueHunt'>,
    settings: {
      available: () => true,
      collapsed: () => false,
      setCollapsed: () => {},
    },
    tracking,
    questTitle: (questId) => `title:${questId}`,
    objectiveLabel: (questId, index) => `objective:${questId}:${index}`,
    click: () => {},
    ...(withDep ? { dungeonRow } : {}),
  });
  return { controller, update, world, dungeonRow, html: () => html };
}

/** The quests the strip was last handed (the first argument of its update). */
function stripQuests(r: Rig): TrackedQuest[] {
  const call = r.update.mock.lastCall;
  if (!call) throw new Error('the strip was never updated');
  return call[0] as TrackedQuest[];
}
const stripIds = (r: Rig) => stripQuests(r).map((quest) => quest.id);
const stripFocus = (r: Rig) => r.update.mock.lastCall?.[2] as string | undefined;

describe('dungeon run on the touch quest strip', () => {
  it('is absent outside a dungeon: the strip carries only the tracked quests', () => {
    const r = rig(true);
    r.controller.update(0);
    expect(stripIds(r)).toEqual(['q_wolves']);
    expect(stripFocus(r)).toBeUndefined();
  });

  it('joins the strip after the quests and takes it once, on first sight', () => {
    const r = rig(true);
    r.controller.update(0);
    r.world.dungeonRun = run();
    r.controller.update(1);
    expect(stripIds(r)).toEqual(['q_wolves', 'dungeon:hollow_crypt:normal']);
    expect(stripFocus(r)).toBe('dungeon:hollow_crypt:normal');
    // Every later tick leaves the selection alone, so the player can cycle away.
    for (const now of [2, 3, 4]) {
      r.controller.update(now);
      expect(stripIds(r)).toEqual(['q_wolves', 'dungeon:hollow_crypt:normal']);
      expect(stripFocus(r)).toBeUndefined();
    }
  });

  it('carries each boss as a counted objective, done or not', () => {
    const r = rig(true);
    r.world.dungeonRun = run(['sexton_marrow', 'rimeweb'], 'heroic');
    r.controller.update(0);
    const page = stripQuests(r)[1];
    expect(page).toMatchObject({
      id: 'dungeon:hollow_crypt:heroic',
      title: 'hollow_crypt (H)',
      complete: false,
    });
    expect(page.objectives.map((o) => [o.label, o.current, o.total])).toEqual([
      ['sexton_marrow', 1, 1],
      ['rimeweb', 1, 1],
      ['cantor_ilvane', 0, 1],
      ['morthen', 0, 1],
    ]);
  });

  it('leaves with the player, and takes the strip again on the next visit', () => {
    const r = rig(true);
    r.world.dungeonRun = run();
    r.controller.update(0);
    r.controller.update(1);
    r.world.dungeonRun = null;
    r.controller.update(2);
    expect(stripIds(r)).toEqual(['q_wolves']);
    expect(stripFocus(r)).toBeUndefined();
    r.world.dungeonRun = run(['sexton_marrow']);
    r.controller.update(3);
    expect(stripFocus(r)).toBe('dungeon:hollow_crypt:normal');
  });

  it('treats the other difficulty as a new page that takes the strip', () => {
    const r = rig(true);
    r.world.dungeonRun = run();
    r.controller.update(0);
    r.controller.update(1);
    expect(stripFocus(r)).toBeUndefined();
    r.world.dungeonRun = run([], 'heroic');
    r.controller.update(2);
    expect(stripFocus(r)).toBe('dungeon:hollow_crypt:heroic');
  });

  it('coming and going never moves a quest under the selection', () => {
    // The strip's selection is positional, so the page must not shift any quest:
    // every quest keeps the index the controller gave it before the dungeon.
    const r = rig(true);
    r.controller.update(0);
    const before = stripIds(r);
    r.world.dungeonRun = run();
    r.controller.update(1);
    expect(stripIds(r).slice(0, before.length)).toEqual(before);
    r.world.dungeonRun = null;
    r.controller.update(2);
    expect(stripIds(r)).toEqual(before);
  });

  it('never joins the desktop tracker, which has the plate instead', () => {
    const r = rig(false);
    r.world.dungeonRun = run(['sexton_marrow']);
    r.controller.update(0);
    r.controller.update(1);
    expect(r.dungeonRow).not.toHaveBeenCalled();
    expect(r.update).not.toHaveBeenCalled();
    expect(r.html()).toContain('title:q_wolves');
    expect(r.html()).not.toContain('hollow_crypt');
    expect(r.html()).not.toContain('sexton_marrow');
  });

  it('a host that passes no dungeon row keeps the strip exactly as it was', () => {
    const r = rig(true, false);
    r.world.dungeonRun = run();
    r.controller.update(0);
    expect(stripIds(r)).toEqual(['q_wolves']);
    expect(stripFocus(r)).toBeUndefined();
  });
});

describe('the real strip core over the dungeon page', () => {
  const pages = (defeated: readonly string[], wolvesSlain = 0): TrackedQuest[] => {
    const page = dungeonStripQuest({ dungeonRun: run(defeated) }, TEXT);
    if (!page) throw new Error('no page');
    const wolves = {
      id: 'q_wolves',
      number: 1,
      title: 'Wolves',
      complete: false,
      objectives: [{ label: 'Wolf', current: wolvesSlain, total: 8 }],
    };
    // The order the controller hands the strip: the quests, then the run.
    return [wolves, page];
  };

  it('shows all four bosses of the page without trimming any', () => {
    const view = questStripView(pages(['rimeweb']), 1);
    expect(view.title).toBe('hollow_crypt');
    expect(view.hiddenObjectives).toBe(0);
    expect(view.objectives.map((o) => o.done)).toEqual([false, true, false, false]);
    expect(view.counter).toMatchObject({ position: 2, total: 2, visible: true });
  });

  it('a boss falling brings the strip back to the dungeon page', () => {
    // The player cycled away to the quest; the kill is objective progress on
    // the dungeon page, which the strip's own rule jumps to.
    const jump = questStripProgressJump({
      previous: pages([]),
      next: pages(['sexton_marrow']),
      now: 60_000,
      lastCycleAt: 0,
    });
    expect(jump).toBe(1);
  });

  it('a quest that progressed on the same tick as the kill keeps the strip', () => {
    // "Slay the boss" quests complete on the very tick the boss falls: the
    // quest is what the player is being given credit for, and it is listed
    // first, so it wins the tie.
    const jump = questStripProgressJump({
      previous: pages([], 0),
      next: pages(['sexton_marrow'], 1),
      now: 60_000,
      lastCycleAt: 0,
    });
    expect(jump).toBe(0);
  });

  it('marks the page complete when the last boss falls', () => {
    expect(questStripView(pages([...CRYPT]), 1).complete).toBe(true);
    expect(questStripView(pages(['morthen']), 1).complete).toBe(false);
  });
});

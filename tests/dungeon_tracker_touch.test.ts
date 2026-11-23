// @vitest-environment happy-dom
// The dungeon run on touch, end to end through the REAL pieces: the dungeon
// tracker painter builds the page, the quest tracker controller hands it over
// (its dungeonRow dep, wired exactly as hud.ts wires it) and the real quest
// strip controller paints it into the strip's own markup. The sibling suite
// (dungeon_tracker_strip.test.ts) pins the controller's hand-off against a
// stubbed strip; this one pins what the player reads: "Sexton Marrow: 0/1".
import { beforeEach, describe, expect, it } from 'vitest';
import { QUESTS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createForgeWorkshop } from '../src/sim/minigames/forge_workshop';
import type { QuestProgress, WorldQuestProgress } from '../src/sim/types';
import { mobDisplayName } from '../src/ui/entity_display_core';
import { dungeonDisplayName } from '../src/ui/entity_i18n';
import { DungeonTrackerPainter } from '../src/ui/hud/dungeon/dungeon_tracker_painter';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import { worldQuestDisplayName } from '../src/ui/world_quest_view';
import type { IWorld } from '../src/world_api';
import type { DungeonRunView } from '../src/world_api/dungeons';

const CRYPT = ['sexton_marrow', 'rimeweb', 'cantor_ilvane', 'morthen'] as const;
const LESSON = 'wq_evergarden_forging';

/** The strip markup of both entries (mirrors tests/quest_strip_controller.test.ts). */
const STRIP_MARKUP = `
  <div id="quest-strip" class="empty">
    <button type="button" id="quest-strip-main" aria-labelledby="quest-strip-title quest-strip-complete quest-strip-count" aria-describedby="quest-strip-objs quest-strip-hint">
      <span class="quest-strip-title-row">
        <span id="quest-strip-title" class="quest-strip-title"></span>
        <span id="quest-strip-complete" class="quest-complete"></span>
        <span id="quest-strip-cycle" class="quest-strip-cycle" aria-hidden="true"><span id="quest-strip-prev" class="quest-strip-arrow">&#8249;</span><span id="quest-strip-count" class="quest-strip-count"></span><span id="quest-strip-next" class="quest-strip-arrow">&#8250;</span></span>
      </span>
      <span id="quest-strip-objs" class="quest-strip-objs">
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span id="quest-strip-more" class="quest-strip-obj quest-strip-more"></span>
      </span>
    </button>
    <span id="quest-strip-hint" class="visually-hidden"></span>
  </div>`;

function run(
  defeated: readonly string[] = [],
  difficulty: 'normal' | 'heroic' = 'normal',
): DungeonRunView {
  return Object.freeze({
    dungeonId: 'hollow_crypt',
    difficulty,
    bosses: CRYPT.map((mobId) => ({ mobId, defeated: defeated.includes(mobId) })),
  });
}

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

function fakeStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

function mount(worldQuests: WorldQuestProgress[] = []) {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';
  controls.innerHTML = STRIP_MARKUP;
  const trackerRoot = document.createElement('div');
  trackerRoot.id = 'dungeon-tracker';
  const questRoot = document.createElement('div');
  questRoot.id = 'quest-tracker';
  document.body.append(controls, trackerRoot, questRoot);
  document.body.classList.add('mobile-touch');

  const wolves: QuestProgress = {
    questId: 'q_wolves',
    state: 'active',
    counts: QUESTS.q_wolves.objectives.map(() => 0),
  };
  const area = worldQuests[0] && WORLD_QUESTS_BY_ID[worldQuests[0].questId].area;
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Adventurer', pos: { x: area?.x ?? 0, y: 0, z: area?.z ?? 0 } },
    questLog: new Map([[wolves.questId, wolves]]),
    worldQuestLog: new Map(worldQuests.map((entry) => [entry.questId, entry])),
    clueHunt: null,
    dungeonRun: null as DungeonRunView | null,
  };
  const dungeonTracker = new DungeonTrackerPainter({
    root: () => trackerRoot,
    writers: writers(),
    world: () => world,
  });
  const tracking = new QuestTrackingState(fakeStorage());
  tracking.useCharacter('warrior', 'Adventurer');
  const questTracker = new QuestTrackerController({
    writers: writers(),
    element: questRoot,
    document,
    world: () =>
      world as unknown as Pick<
        IWorld,
        'questLog' | 'cfg' | 'player' | 'worldQuestLog' | 'clueHunt'
      >,
    settings: { available: () => true, collapsed: () => false, setCollapsed: () => {} },
    tracking,
    questTitle: (questId) => `title:${questId}`,
    objectiveLabel: (questId, index) => `objective:${questId}:${index}`,
    click: () => {},
    // The line hud.ts wires.
    dungeonRow: () => dungeonTracker.stripQuest(),
  });
  let now = 0;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    world,
    dungeonTracker,
    questTracker,
    /** One medium-band pass, in the order Hud.update drives the two. */
    tick() {
      now += 250;
      dungeonTracker.update();
      questTracker.update(now);
    },
    title: () => el('quest-strip-title').textContent,
    counter: () => el('quest-strip-count').textContent,
    objectives: () =>
      [...document.querySelectorAll<HTMLElement>('.quest-strip-obj:not(.quest-strip-more)')]
        .filter((row) => row.textContent !== '')
        .map((row) => row.textContent),
    more: () => el('quest-strip-more').textContent,
    plate: trackerRoot,
  };
}

beforeEach(() => {
  setLanguage('en');
  document.body.replaceChildren();
  document.body.className = '';
});

describe('the dungeon run through the real touch quest strip', () => {
  it('shows the quest outside a dungeon and the run, boss by boss, on stepping in', () => {
    const r = mount();
    r.tick();
    expect(r.title()).toBe('title:q_wolves');
    r.world.dungeonRun = run();
    r.tick();
    // The page took the strip on first sight and every boss fits (no "+N more").
    expect(r.title()).toBe('The Hollow Crypt');
    expect(r.counter()).toBe('2/2');
    expect(r.objectives()).toEqual([
      'Sexton Marrow: 0/1',
      'Lady of the Bonechill: 0/1',
      'Cantor Ilvane: 0/1',
      'Morthen the Gravecaller: 0/1',
    ]);
    expect(r.more()).toBe('');
    // The desktop plate stays unpainted: on touch the strip is the tracker.
    expect(r.plate.classList.contains('is-live')).toBe(false);
    expect(r.plate.querySelector('.dgt-name')?.textContent).toBe('');
  });

  it('counts a boss 1/1 the pass after it falls', () => {
    const r = mount();
    r.world.dungeonRun = run();
    r.tick();
    r.world.dungeonRun = run(['sexton_marrow']);
    r.tick();
    expect(r.title()).toBe('The Hollow Crypt');
    expect(r.objectives()[0]).toBe('Sexton Marrow: 1/1');
    expect(r.objectives()[1]).toBe('Lady of the Bonechill: 0/1');
  });

  it('titles a heroic run with its difficulty', () => {
    const r = mount();
    r.world.dungeonRun = run([], 'heroic');
    r.tick();
    expect(r.title()).toBe('The Hollow Crypt (Heroic)');
  });

  it('gives the strip back to the quests on leaving', () => {
    const r = mount();
    r.world.dungeonRun = run();
    r.tick();
    r.world.dungeonRun = null;
    r.tick();
    expect(r.title()).toBe('title:q_wolves');
    expect(r.counter()).toBe('');
  });

  it('a running lesson keeps the strip on the tick the dungeon page first appears', () => {
    // A minigame lesson is authoritative instruction the player is acting on
    // right now; the first-sighting grab is a courtesy and must not take the
    // strip from it (`focusQuestId ??=` in the controller).
    const forging = createForgeWorkshop(42, 100);
    forging.phase = 'working';
    const r = mount([{ questId: LESSON, state: 'completed', count: 1, forging }]);
    r.tick();
    expect(r.title()).toBe(worldQuestDisplayName(LESSON));
    r.world.dungeonRun = run();
    r.tick();
    expect(r.title()).toBe(worldQuestDisplayName(LESSON));
    // The page did join the strip (three pages now), it just did not take it.
    expect(r.counter()).toBe('2/3');
    r.tick();
    expect(r.title()).toBe(worldQuestDisplayName(LESSON));
  });

  it('follows a language switch through the two relocalize arms, in the Hud`s order', async () => {
    const r = mount();
    r.world.dungeonRun = run([], 'heroic');
    r.tick();
    expect(r.title()).toBe('The Hollow Crypt (Heroic)');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    // A plain pass cannot see a locale-only change: the page is remembered.
    r.tick();
    expect(r.title()).toBe('The Hollow Crypt (Heroic)');
    r.dungeonTracker.relocalize();
    r.questTracker.relocalize();
    r.tick();
    const name = dungeonDisplayName('hollow_crypt');
    expect(name).not.toBe('The Hollow Crypt');
    expect(r.title()).toBe(
      t('hudChrome.dungeonTracker.heroicTitle', {
        name,
        difficulty: t('hudChrome.finder.heroic'),
      }),
    );
    expect(r.objectives()[0]).toBe(
      t('questUi.detail.objectiveProgress', {
        label: mobDisplayName('sexton_marrow'),
        current: '0',
        total: '1',
      }),
    );
    expect(r.objectives()[0]).not.toContain('Sexton Marrow');
  });
});

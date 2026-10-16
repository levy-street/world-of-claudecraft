// @vitest-environment happy-dom
// Behavioral pin for the dungeon objectives tracker painter
// (src/ui/hud/dungeon/dungeon_tracker_painter.ts): the plate and boss rows it
// states for a run; that an unchanged run neither writes NOR resolves (no t(),
// no formatter, no name lookup); that a language switch re-resolves; that the
// plate keeps out from under the button rail by measurement; that touch gets
// nothing but the strip page; and the source contracts a per-file scan holds.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeDungeonRun } from '../src/net/dungeon_run_wire';
import * as displayCore from '../src/ui/entity_display_core';
import * as entityI18n from '../src/ui/entity_i18n';
import {
  DungeonTrackerPainter,
  RAIL_MEASURE_POLLS,
} from '../src/ui/hud/dungeon/dungeon_tracker_painter';
import {
  DUNGEON_TRACKER_FLASH_BUILDS,
  DUNGEON_TRACKER_ROW_CAP,
} from '../src/ui/hud/dungeon/dungeon_tracker_view';
import * as i18n from '../src/ui/i18n';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import type { DungeonRunView } from '../src/world_api/dungeons';

const { ensureLocaleLoaded, setLanguage, t } = i18n;
const CRYPT = ['sexton_marrow', 'rimeweb', 'cantor_ilvane', 'morthen'] as const;

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

/** The same run through the online decode, as a ClientWorld holds it. */
function mirrored(view: DungeonRunView): DungeonRunView {
  const decoded = decodeDungeonRun(JSON.parse(JSON.stringify(view)));
  if (!decoded) throw new Error('decode dropped the run');
  return decoded;
}

/** The real elided facet over fresh caches, counting what reaches the DOM. */
function countingFacet(): { facet: PainterHostWriters; counts: { writes: number; skips: number } } {
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { facet, counts };
}

type Rect = { left: number; top: number; right: number; bottom: number };
const rectOf = (r: Rect) =>
  ({ ...r, width: r.right - r.left, height: r.bottom - r.top }) as DOMRect;

function rig(initial: DungeonRunView | null = null, rail: HTMLElement | null = null) {
  const root = document.createElement('div');
  root.id = 'dungeon-tracker';
  document.body.append(root);
  const world = { dungeonRun: initial };
  const { facet, counts } = countingFacet();
  const painter = new DungeonTrackerPainter({
    root: () => root,
    writers: facet,
    world: () => world,
    rail: () => rail,
  });
  const q = (selector: string) => root.querySelector(selector) as HTMLElement;
  const rows = () =>
    [...root.querySelectorAll<HTMLElement>('.dgt-row')].filter(
      (row) => row.style.display !== 'none',
    );
  return { root, world, painter, counts, q, rows };
}

/** Count every text resolve the painter can make: t(), the formatter, and the
 *  two entity name resolvers. */
function resolveSpies() {
  const spies = [
    vi.spyOn(i18n, 't'),
    vi.spyOn(i18n, 'formatNumber'),
    vi.spyOn(entityI18n, 'dungeonDisplayName'),
    vi.spyOn(displayCore, 'mobDisplayName'),
  ];
  return {
    calls: () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
    clear: () => {
      for (const spy of spies) spy.mockClear();
    },
  };
}

beforeEach(() => {
  setLanguage('en');
  document.body.replaceChildren();
  document.body.className = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('DungeonTrackerPainter: skeleton', () => {
  it('builds the plate and the whole row pool once, hidden, with no text', () => {
    const { root, q } = rig();
    expect(q('.dgt-plate').classList.contains('ui-panel-soft')).toBe(true);
    expect(q('.dgt-name').classList.contains('ui-cin')).toBe(true);
    expect(q('.dgt-diff').classList.contains('ui-chip')).toBe(true);
    expect(q('.dgt-bar').classList.contains('ui-bar')).toBe(true);
    expect(q('.dgt-bar-fill').classList.contains('ui-bar-fill')).toBe(true);
    const pool = root.querySelectorAll<HTMLElement>('.dgt-row');
    expect(pool).toHaveLength(DUNGEON_TRACKER_ROW_CAP);
    for (const row of pool) expect(row.style.display).toBe('none');
    expect(root.textContent).toBe('');
    // The decorations are hidden from assistive tech; the list is a real list.
    expect(q('.dgt-bar').getAttribute('aria-hidden')).toBe('true');
    expect(q('.dgt-mark').getAttribute('aria-hidden')).toBe('true');
    expect(q('.dgt-list').getAttribute('role')).toBe('list');
    expect(pool[0].getAttribute('role')).toBe('listitem');
  });

  it('never rebuilds: the same nodes carry every later paint', () => {
    const { root, world, painter, q } = rig(run());
    const plate = q('.dgt-plate');
    const firstRow = root.querySelector('.dgt-row');
    painter.update();
    world.dungeonRun = run(['sexton_marrow']);
    painter.update();
    world.dungeonRun = null;
    painter.update();
    world.dungeonRun = run([...CRYPT], 'heroic');
    painter.update();
    expect(q('.dgt-plate')).toBe(plate);
    expect(root.querySelector('.dgt-row')).toBe(firstRow);
    expect(root.querySelectorAll('.dgt-row')).toHaveLength(DUNGEON_TRACKER_ROW_CAP);
  });
});

// Read through a variable path: under the happy-dom environment Vite rewrites
// a literal `new URL('../index.html', import.meta.url)` into an asset URL.
const readRepo = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('DungeonTrackerPainter: in the real entry markup', () => {
  it.each(['index.html', 'play.html'])(
    '%s seats it first in the tracker stack, and it paints there',
    (entry) => {
      // The behaviour the wiring in hud.ts depends on: the entry holds a real
      // #dungeon-tracker, first in the stack (above the quest tracker), and the
      // painter, given no root as in hud.ts, finds it by its id and takes it
      // over without touching its siblings.
      const html = readRepo(['..', entry].join('/'));
      const holder = document.createElement('template');
      holder.innerHTML = html;
      const ui = holder.content.querySelector('template#game-ui-template') as HTMLTemplateElement;
      const stack = ui.content.querySelector('#right-tracker-stack') as HTMLElement;
      expect([...stack.children].map((el) => el.id).slice(0, 2)).toEqual([
        'dungeon-tracker',
        'quest-tracker',
      ]);
      document.body.append(stack);
      const root = stack.querySelector('#dungeon-tracker') as HTMLElement;
      expect(root.getAttribute('role')).toBe('group');
      const siblings = stack.children.length;
      const world = { dungeonRun: run(['rimeweb'], 'heroic') as DungeonRunView | null };
      const painter = new DungeonTrackerPainter({
        writers: countingFacet().facet,
        world: () => world,
      });
      painter.update();
      expect(root.classList.contains('is-live')).toBe(true);
      expect(root.querySelector('.dgt-name')?.textContent).toBe('The Hollow Crypt');
      expect(stack.children.length).toBe(siblings);
      expect(stack.querySelector('#qt-body')?.innerHTML).toBe('');
    },
  );
});

describe('DungeonTrackerPainter: what it shows', () => {
  it('stays out of the stack outside a run, and joins it inside one', () => {
    const { root, world, painter } = rig();
    painter.update();
    expect(root.classList.contains('is-live')).toBe(false);
    world.dungeonRun = run();
    painter.update();
    expect(root.classList.contains('is-live')).toBe(true);
    world.dungeonRun = null;
    painter.update();
    expect(root.classList.contains('is-live')).toBe(false);
  });

  it('names the dungeon and every boss from the entity name keys, counted 0 of 1', () => {
    const { painter, q, rows, root } = rig(run());
    painter.update();
    expect(q('.dgt-name').textContent).toBe('The Hollow Crypt');
    expect(rows().map((row) => row.querySelector('.dgt-boss')?.textContent)).toEqual([
      'Sexton Marrow',
      'Lady of the Bonechill',
      'Cantor Ilvane',
      'Morthen the Gravecaller',
    ]);
    const zeroOfOne = t('hudChrome.questTracker.objectiveValue', { current: '0', total: '1' });
    expect(zeroOfOne).toBe('0 / 1');
    for (const row of rows()) {
      expect(row.querySelector('.dgt-count')?.textContent).toBe(zeroOfOne);
      expect(row.classList.contains('is-done')).toBe(false);
    }
    expect(q('.dgt-tally').textContent).toBe('0 / 4');
    expect(q('.dgt-bar-fill').style.width).toBe('0%');
    // The group's accessible name is the tracker's own frame name.
    expect(root.getAttribute('aria-label')).toBe('Dungeon Tracker');
  });

  it('reads a row count first, the classic objective line', () => {
    const { painter, rows } = rig(run());
    painter.update();
    const row = rows()[0];
    expect([...row.children].map((child) => child.className.split(' ')[0])).toEqual([
      'dgt-count',
      'dgt-boss',
      'dgt-mark',
    ]);
    expect(row.textContent).toBe('0 / 1Sexton Marrow');
  });

  it('ticks a boss to 1 of 1, marks its row done, and moves the rail and tally', () => {
    const { world, painter, q, rows } = rig(run());
    painter.update();
    world.dungeonRun = run(['rimeweb']);
    painter.update();
    const [marrow, lady] = rows();
    expect(lady.querySelector('.dgt-count')?.textContent).toBe('1 / 1');
    expect(lady.classList.contains('is-done')).toBe(true);
    expect(lady.classList.contains('is-flash')).toBe(true);
    expect(marrow.classList.contains('is-done')).toBe(false);
    expect(marrow.classList.contains('is-flash')).toBe(false);
    expect(q('.dgt-tally').textContent).toBe('1 / 4');
    expect(q('.dgt-bar-fill').style.width).toBe('25%');
  });

  it('lets the kill highlight go after its hold, leaving the row done', () => {
    const { world, painter, rows } = rig(run());
    painter.update();
    world.dungeonRun = run(['sexton_marrow']);
    for (let i = 0; i < DUNGEON_TRACKER_FLASH_BUILDS; i++) painter.update();
    expect(rows()[0].classList.contains('is-flash')).toBe(true);
    painter.update();
    expect(rows()[0].classList.contains('is-flash')).toBe(false);
    expect(rows()[0].classList.contains('is-done')).toBe(true);
  });

  it('shows the difficulty only on a heroic run', () => {
    const { world, painter, q } = rig(run());
    painter.update();
    expect(q('.dgt-plate').classList.contains('is-heroic')).toBe(false);
    expect(q('.dgt-diff').textContent).toBe('');
    world.dungeonRun = run([], 'heroic');
    painter.update();
    expect(q('.dgt-plate').classList.contains('is-heroic')).toBe(true);
    expect(q('.dgt-diff').textContent).toBe('Heroic');
  });

  it('reads a finished run as complete, in the tracker`s own word', () => {
    const { world, painter, q, rows } = rig(run(['sexton_marrow', 'rimeweb', 'cantor_ilvane']));
    painter.update();
    expect(q('.dgt-plate').classList.contains('is-complete')).toBe(false);
    world.dungeonRun = run([...CRYPT]);
    painter.update();
    expect(q('.dgt-plate').classList.contains('is-complete')).toBe(true);
    expect(q('.dgt-plate').classList.contains('is-complete-flash')).toBe(true);
    expect(q('.dgt-tally').textContent).toBe(t('hudChrome.dungeonTracker.complete'));
    expect(q('.dgt-tally').textContent).toBe('Complete');
    expect(q('.dgt-bar-fill').style.width).toBe('100%');
    expect(rows().every((row) => row.classList.contains('is-done'))).toBe(true);
    expect(rows().every((row) => row.querySelector('.dgt-count')?.textContent === '1 / 1')).toBe(
      true,
    );
  });

  it('a run walked into already finished is complete without the glow', () => {
    const { painter, q } = rig(run([...CRYPT]));
    painter.update();
    expect(q('.dgt-plate').classList.contains('is-complete')).toBe(true);
    expect(q('.dgt-plate').classList.contains('is-complete-flash')).toBe(false);
  });

  it('hides the rows a shorter boss list leaves behind, and clears their state', () => {
    const { world, painter, rows, root } = rig(run([...CRYPT]));
    painter.update();
    expect(rows()).toHaveLength(4);
    world.dungeonRun = Object.freeze({
      dungeonId: 'drowned_temple',
      difficulty: 'normal' as const,
      bosses: [
        { mobId: 'choirmother_selthe', defeated: false },
        { mobId: 'tideglass_colossus', defeated: false },
        { mobId: 'ysolei', defeated: false },
      ],
    });
    painter.update();
    expect(rows()).toHaveLength(3);
    const fourth = root.querySelectorAll<HTMLElement>('.dgt-row')[3];
    expect(fourth.style.display).toBe('none');
    expect(fourth.classList.contains('is-done')).toBe(false);
    expect(fourth.classList.contains('is-flash')).toBe(false);
  });
});

describe('DungeonTrackerPainter: nothing changed means nothing done', () => {
  it.each([
    ['a Sim-shaped run', (view: DungeonRunView) => view],
    ['a ClientWorld-shaped run', mirrored],
  ])('an unchanged %s writes once and then nothing', (_label, shape) => {
    const { world, painter, counts } = rig(shape(run(['sexton_marrow'], 'heroic')));
    painter.update();
    const establishing = counts.writes;
    expect(establishing).toBeGreaterThan(10);
    for (let i = 0; i < 40; i++) painter.update();
    expect(counts.writes).toBe(establishing);
    expect(counts.skips).toBeGreaterThan(0);
    // A real change writes again: the elision is not a stuck painter.
    world.dungeonRun = shape(run(['sexton_marrow', 'rimeweb'], 'heroic'));
    painter.update();
    expect(counts.writes).toBeGreaterThan(establishing);
  });

  it('resolves no text at all on an unchanged poll', () => {
    const { world, painter } = rig(run(['sexton_marrow'], 'heroic'));
    const spies = resolveSpies();
    painter.update();
    // The first paint resolves everything: the name, the chip, the tally, the
    // aria label, and a name and a count per boss.
    expect(spies.calls()).toBeGreaterThanOrEqual(4 + CRYPT.length * 2);
    spies.clear();
    for (let i = 0; i < 40; i++) painter.update();
    expect(spies.calls()).toBe(0);
    // A boss falls: one resolve pass, then silence again while the glow runs.
    world.dungeonRun = run(['sexton_marrow', 'rimeweb'], 'heroic');
    painter.update();
    expect(spies.calls()).toBeGreaterThan(0);
    spies.clear();
    for (let i = 0; i < DUNGEON_TRACKER_FLASH_BUILDS + 5; i++) painter.update();
    expect(spies.calls()).toBe(0);
  });

  it('resolves nothing while there is no run, and writes at most the hide', () => {
    const { painter, counts } = rig();
    const spies = resolveSpies();
    painter.update();
    const first = counts.writes;
    for (let i = 0; i < 20; i++) painter.update();
    expect(counts.writes).toBe(first);
    expect(first).toBeLessThanOrEqual(1);
    expect(spies.calls()).toBe(0);
  });

  it('a language switch re-resolves once through relocalize, with the run unchanged', async () => {
    const { painter, q, rows, root } = rig(run([...CRYPT], 'heroic'));
    painter.update();
    expect(q('.dgt-name').textContent).toBe('The Hollow Crypt');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    // The gate is blind to the locale by design: a plain poll keeps the old text.
    painter.update();
    expect(q('.dgt-name').textContent).toBe('The Hollow Crypt');
    const spies = resolveSpies();
    painter.relocalize();
    expect(spies.calls()).toBeGreaterThan(0);
    expect(q('.dgt-name').textContent).toBe(entityI18n.dungeonDisplayName('hollow_crypt'));
    expect(q('.dgt-name').textContent).not.toBe('The Hollow Crypt');
    expect(q('.dgt-diff').textContent).toBe(t('hudChrome.finder.heroic'));
    expect(q('.dgt-diff').textContent).not.toBe('Heroic');
    expect(q('.dgt-tally').textContent).toBe(t('hudChrome.dungeonTracker.complete'));
    expect(q('.dgt-tally').textContent).not.toBe('Complete');
    expect(rows()[0].querySelector('.dgt-boss')?.textContent).toBe(
      displayCore.mobDisplayName('sexton_marrow'),
    );
    expect(rows()[0].querySelector('.dgt-boss')?.textContent).not.toBe('Sexton Marrow');
    expect(root.getAttribute('aria-label')).not.toBe('Dungeon Tracker');
    // And the gate is re-latched, not cleared: the next poll resolves nothing.
    spies.clear();
    painter.update();
    expect(spies.calls()).toBe(0);
  });
});

describe('DungeonTrackerPainter: the plate keeps out from under the button rail', () => {
  function railRig(railRect: Rect) {
    const rail = document.createElement('div');
    const reads = { count: 0 };
    rail.getBoundingClientRect = () => {
      reads.count++;
      return rectOf(railRect);
    };
    const r = rig(run(), rail);
    r.root.getBoundingClientRect = () => {
      reads.count++;
      return rectOf({ left: 1000, top: 300, right: 1240, bottom: 440 });
    };
    r.q('.dgt-plate').getBoundingClientRect = () => {
      reads.count++;
      return rectOf({ left: 1000, top: 300, right: 1240, bottom: 353 });
    };
    return { ...r, reads };
  }
  const width = (root: HTMLElement) => root.style.getPropertyValue('--dgt-plate-w');

  it('fills the column while the rail is below it', () => {
    const { root, painter } = railRig({ left: 1168, top: 600, right: 1238, bottom: 1038 });
    painter.update();
    expect(width(root)).toBe('100%');
    expect(root.classList.contains('is-narrow')).toBe(false);
  });

  it('narrows to the rail-free share when the rail stands beside it', () => {
    const { root, painter } = railRig({ left: 1168, top: 250, right: 1238, bottom: 688 });
    painter.update();
    // 168 of 240 clear, less the 8 of 240 gap: two thirds of the column.
    expect(width(root)).toBe('66.7%');
    // And says so, for the stylesheet to set the name a size down.
    expect(root.classList.contains('is-narrow')).toBe(true);
  });

  it('follows the rail when it moves away, within the measure cadence', () => {
    const railRect = { left: 1168, top: 250, right: 1238, bottom: 688 };
    const { root, painter } = railRig(railRect);
    painter.update();
    expect(width(root)).toBe('66.7%');
    // The player drags the rail off in Edit Frames (the stub reads it live).
    railRect.left = 300;
    railRect.right = 370;
    for (let i = 0; i < RAIL_MEASURE_POLLS; i++) painter.update();
    expect(width(root)).toBe('100%');
    expect(root.classList.contains('is-narrow')).toBe(false);
  });

  it('measures on entry and then on a bounded cadence, never every poll', () => {
    const { painter, reads } = railRig({ left: 1168, top: 250, right: 1238, bottom: 688 });
    painter.update();
    expect(reads.count).toBe(3);
    for (let i = 1; i < RAIL_MEASURE_POLLS * 10; i++) painter.update();
    expect(reads.count).toBe(3 * 10);
  });

  it('measures nothing outside a run', () => {
    const { world, painter, reads } = railRig({ left: 1168, top: 250, right: 1238, bottom: 688 });
    world.dungeonRun = null;
    for (let i = 0; i < 12; i++) painter.update();
    expect(reads.count).toBe(0);
  });
});

describe('DungeonTrackerPainter: on touch the strip carries the run', () => {
  it('states, resolves and measures nothing for the plate', () => {
    document.body.classList.add('mobile-touch');
    const rail = document.createElement('div');
    const railRead = vi.fn(() => rectOf({ left: 0, top: 0, right: 0, bottom: 0 }));
    rail.getBoundingClientRect = railRead;
    const { root, painter, counts } = rig(run(['sexton_marrow'], 'heroic'), rail);
    const spies = resolveSpies();
    for (let i = 0; i < 10; i++) painter.update();
    expect(root.classList.contains('is-live')).toBe(false);
    expect(root.querySelector('.dgt-name')?.textContent).toBe('');
    expect(spies.calls()).toBe(0);
    expect(railRead).not.toHaveBeenCalled();
    expect(counts.writes).toBeLessThanOrEqual(1);
  });

  it('hands the strip a page built once per run, not once per poll', () => {
    const { world, painter } = rig();
    expect(painter.stripQuest()).toBeNull();
    world.dungeonRun = run(['sexton_marrow']);
    const spies = resolveSpies();
    const page = painter.stripQuest();
    expect(page).toMatchObject({
      title: 'The Hollow Crypt',
      complete: false,
      objectives: [
        { label: 'Sexton Marrow', current: 1, total: 1 },
        { label: 'Lady of the Bonechill', current: 0, total: 1 },
        { label: 'Cantor Ilvane', current: 0, total: 1 },
        { label: 'Morthen the Gravecaller', current: 0, total: 1 },
      ],
    });
    spies.clear();
    for (let i = 0; i < 20; i++) expect(painter.stripQuest()).toBe(page);
    expect(spies.calls()).toBe(0);
    world.dungeonRun = run(['sexton_marrow', 'rimeweb']);
    expect(painter.stripQuest()).not.toBe(page);
    expect(painter.stripQuest()?.objectives[1].current).toBe(1);
    world.dungeonRun = null;
    expect(painter.stripQuest()).toBeNull();
  });

  it('titles a heroic run with its difficulty through the catalog template', () => {
    const { painter } = rig(run([], 'heroic'));
    expect(painter.stripQuest()?.title).toBe('The Hollow Crypt (Heroic)');
  });

  it('rebuilds the page in the new language after relocalize', async () => {
    const { painter } = rig(run([], 'heroic'));
    const english = painter.stripQuest();
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    painter.relocalize();
    const japanese = painter.stripQuest();
    expect(japanese).not.toBe(english);
    expect(japanese?.title).not.toBe('The Hollow Crypt (Heroic)');
    expect(japanese?.title).toContain(entityI18n.dungeonDisplayName('hollow_crypt'));
    expect(japanese?.objectives[0].label).toBe(displayCore.mobDisplayName('sexton_marrow'));
  });
});

describe('dungeon tracker source contracts', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const painter = read('../src/ui/hud/dungeon/dungeon_tracker_painter.ts');
  const view = read('../src/ui/hud/dungeon/dungeon_tracker_view.ts');

  it('the painter carries no color, pixel or English literal of its own', () => {
    const code = painter.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(/);
    expect(code).not.toMatch(/\d+px/);
    expect(code).not.toMatch(/setText\([^,]+,\s*['"`][A-Za-z]/);
    expect(code).not.toMatch(/Heroic|Complete|Dungeon Tracker/);
  });

  it('the painter talks to IWorld only, never to a concrete world', () => {
    expect(painter).not.toMatch(/from ['"][^'"]*\/sim\/sim['"]/);
    expect(painter).not.toMatch(/from ['"][^'"]*\/net\/online['"]/);
    expect(painter).toContain("Pick<IWorld, 'dungeonRun'>");
  });

  it('the core is DOM-free and resolves no text itself', () => {
    const code = view.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\bdocument\b|\bwindow\b|HTMLElement/);
    expect(code).not.toMatch(/from ['"][^'"]*\/i18n['"]/);
    expect(code).not.toMatch(/\bt\(/);
  });
});

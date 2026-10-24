// The dungeon objectives tracker's pure core (src/ui/hud/dungeon/dungeon_tracker_view.ts):
// what the plate and its boss rows show for a run, which rows a kill just lit,
// and the same run projected as a page of the touch quest strip. Driven with
// plain IWorld-shaped stubs, one shaped like the offline Sim's read and one like
// the online ClientWorld's decoded mirror, because the core must not care which
// world it is handed.
import { describe, expect, it } from 'vitest';
import { decodeDungeonRun } from '../src/net/dungeon_run_wire';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { QUESTS } from '../src/sim/data';
import { dungeonRunPlan } from '../src/sim/instances/dungeon_run';
import {
  buildDungeonTracker,
  DUNGEON_PLATE_MIN_FRACTION,
  DUNGEON_PLATE_RAIL_GAP_FRACTION,
  DUNGEON_STRIP_QUEST_PREFIX,
  DUNGEON_TRACKER_FLASH_BUILDS,
  DUNGEON_TRACKER_ROW_CAP,
  type DungeonTrackerModel,
  dungeonPlateFraction,
  dungeonStripQuest,
  makeDungeonTrackerModel,
} from '../src/ui/hud/dungeon/dungeon_tracker_view';
import { QUEST_STRIP_MAX_OBJECTIVES, questStripView } from '../src/ui/hud/quest/quest_strip_core';
import type { DungeonRunView } from '../src/world_api/dungeons';

const CRYPT = ['sexton_marrow', 'rimeweb', 'cantor_ilvane', 'morthen'] as const;

/** The run as the offline Sim hands it over: frozen, reference-stable. */
function simRun(
  defeated: readonly string[] = [],
  difficulty: 'normal' | 'heroic' = 'normal',
  bosses: readonly string[] = CRYPT,
  dungeonId = 'hollow_crypt',
): DungeonRunView {
  return Object.freeze({
    dungeonId,
    difficulty,
    bosses: Object.freeze(
      bosses.map((mobId) => Object.freeze({ mobId, defeated: defeated.includes(mobId) })),
    ),
  });
}

/** The same run as the online ClientWorld mirrors it: through the wire decode. */
function clientRun(
  defeated: readonly string[] = [],
  difficulty: 'normal' | 'heroic' = 'normal',
): DungeonRunView {
  const run = decodeDungeonRun(JSON.parse(JSON.stringify(simRun(defeated, difficulty))));
  if (!run) throw new Error('the wire decode dropped a well-formed run');
  return run;
}

const SHAPES = [
  ['a Sim-shaped world', simRun],
  ['a ClientWorld-shaped world', clientRun],
] as const;

const rowsOf = (model: DungeonTrackerModel) =>
  model.rows.slice(0, model.count).map((row) => [row.mobId, row.done, row.flash]);

describe('dungeon tracker model', () => {
  it('starts hidden, with its whole row pool preallocated', () => {
    const model = makeDungeonTrackerModel();
    expect(model.visible).toBe(false);
    expect(model.count).toBe(0);
    expect(model.rows).toHaveLength(DUNGEON_TRACKER_ROW_CAP);
    expect(new Set(model.rows).size).toBe(DUNGEON_TRACKER_ROW_CAP);
  });

  it('stays hidden outside a run and for a run with no bosses', () => {
    const model = makeDungeonTrackerModel();
    expect(buildDungeonTracker({ dungeonRun: null }, model).visible).toBe(false);
    expect(buildDungeonTracker({ dungeonRun: simRun([], 'normal', []) }, model).visible).toBe(
      false,
    );
  });

  it.each(SHAPES)('builds the same model from %s', (_label, make) => {
    const model = buildDungeonTracker(
      { dungeonRun: make(['sexton_marrow'], 'heroic') },
      makeDungeonTrackerModel(),
    );
    expect(model.visible).toBe(true);
    expect(model.dungeonId).toBe('hollow_crypt');
    expect(model.heroic).toBe(true);
    expect(model.count).toBe(4);
    expect(model.defeated).toBe(1);
    expect(model.complete).toBe(false);
    expect(rowsOf(model)).toEqual([
      ['sexton_marrow', true, false],
      ['rimeweb', false, false],
      ['cantor_ilvane', false, false],
      ['morthen', false, false],
    ]);
  });

  it('the two world shapes yield field-for-field identical models', () => {
    const a = buildDungeonTracker(
      { dungeonRun: simRun(['rimeweb', 'morthen'], 'heroic') },
      makeDungeonTrackerModel(),
    );
    const b = buildDungeonTracker(
      { dungeonRun: clientRun(['rimeweb', 'morthen'], 'heroic') },
      makeDungeonTrackerModel(),
    );
    expect(a).toEqual(b);
  });

  it('marks a normal run as not heroic', () => {
    const model = buildDungeonTracker({ dungeonRun: simRun() }, makeDungeonTrackerModel());
    expect(model.heroic).toBe(false);
  });

  it('rebuilds in place: the same container and the same row objects every build', () => {
    const model = makeDungeonTrackerModel();
    const rows = model.rows;
    const first = [...rows];
    for (const defeated of [[], ['sexton_marrow'], ['sexton_marrow', 'rimeweb']]) {
      const out = buildDungeonTracker({ dungeonRun: simRun(defeated) }, model);
      expect(out).toBe(model);
      expect(out.rows).toBe(rows);
      expect(out.rows.every((row, i) => row === first[i])).toBe(true);
    }
    expect(buildDungeonTracker({ dungeonRun: null }, model)).toBe(model);
    expect(model.rows).toBe(rows);
  });

  it('reads complete only when every boss is down', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker(
      { dungeonRun: simRun(['sexton_marrow', 'rimeweb', 'cantor_ilvane']) },
      model,
    );
    expect([model.defeated, model.complete]).toEqual([3, false]);
    buildDungeonTracker({ dungeonRun: simRun([...CRYPT]) }, model);
    expect([model.defeated, model.complete]).toEqual([4, true]);
  });

  it('never reads complete with a boss alive past the row pool', () => {
    // A list longer than the pool shows the rows it can, but the tally and the
    // finished state count EVERY boss: a full pool of dead rows with a boss
    // still standing behind it must not read Complete.
    const long = Array.from({ length: DUNGEON_TRACKER_ROW_CAP + 3 }, (_, i) => `boss_${i}`);
    const pooled = long.slice(0, DUNGEON_TRACKER_ROW_CAP);
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun(pooled, 'normal', long) }, model);
    expect(model.count).toBe(DUNGEON_TRACKER_ROW_CAP);
    expect(model.rows.slice(0, model.count).every((row) => row.done)).toBe(true);
    expect([model.total, model.defeated, model.complete]).toEqual([
      DUNGEON_TRACKER_ROW_CAP + 3,
      DUNGEON_TRACKER_ROW_CAP,
      false,
    ]);
    // One of the unpooled bosses falls: the tally moves, still not complete.
    buildDungeonTracker(
      { dungeonRun: simRun([...pooled, long[long.length - 1]], 'normal', long) },
      model,
    );
    expect([model.defeated, model.complete]).toEqual([DUNGEON_TRACKER_ROW_CAP + 1, false]);
    buildDungeonTracker({ dungeonRun: simRun(long, 'normal', long) }, model);
    expect([model.defeated, model.complete]).toEqual([DUNGEON_TRACKER_ROW_CAP + 3, true]);
  });

  it('bumps rev exactly when something the painter resolves text from changes', () => {
    const model = makeDungeonTrackerModel();
    const revs: number[] = [];
    const build = (run: DungeonRunView | null) => {
      buildDungeonTracker({ dungeonRun: run }, model);
      revs.push(model.rev);
    };
    build(simRun()); // first sighting
    build(simRun()); // nothing
    build(simRun()); // nothing
    build(simRun(['rimeweb'])); // a row turns done
    for (let i = 0; i < DUNGEON_TRACKER_FLASH_BUILDS + 2; i++) build(simRun(['rimeweb'])); // the highlight runs out: no text
    build(simRun(['rimeweb'], 'heroic')); // the difficulty
    build(null); // hidden: nothing to resolve
    build(simRun(['rimeweb'], 'heroic')); // back on screen
    const steps = revs.map((rev, i) => (i === 0 ? rev : rev - revs[i - 1]));
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps.slice(1, 3)).toEqual([0, 0]);
    expect(steps[3]).toBe(1);
    expect(steps.slice(4, 4 + DUNGEON_TRACKER_FLASH_BUILDS + 2).every((d) => d === 0)).toBe(true);
    const tail = steps.slice(4 + DUNGEON_TRACKER_FLASH_BUILDS + 2);
    expect(tail).toEqual([1, 0, 1]);
  });

  it('no authored dungeon comes near the pool, or the strip page cap', () => {
    const tracked = FINDER_ACTIVITIES.map((a) => dungeonRunPlan(a.dungeonId, a.difficulty)).filter(
      (plan) => plan !== null,
    );
    expect(tracked.length).toBeGreaterThanOrEqual(10);
    for (const plan of tracked) {
      expect(plan.length).toBeLessThanOrEqual(DUNGEON_TRACKER_ROW_CAP);
      // The strip shows a page's objectives in full only up to its own cap.
      expect(plan.length).toBeLessThanOrEqual(QUEST_STRIP_MAX_OBJECTIVES);
    }
  });
});

describe('dungeon tracker kill highlight', () => {
  it('never lights a row that was already down when the tracker appeared', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun(['sexton_marrow', 'rimeweb']) }, model);
    expect(model.rows.slice(0, 4).map((row) => row.flash)).toEqual([false, false, false, false]);
    expect(model.completeFlash).toBe(false);
  });

  it('lights the row of a boss that falls while the tracker is up, then lets it rest', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    const after = simRun(['rimeweb']);
    for (let build = 0; build < DUNGEON_TRACKER_FLASH_BUILDS; build++) {
      buildDungeonTracker({ dungeonRun: after }, model);
      expect(model.rows[1].flash, `build ${build}`).toBe(true);
      expect(model.rows[0].flash).toBe(false);
    }
    buildDungeonTracker({ dungeonRun: after }, model);
    expect(model.rows[1].flash).toBe(false);
    expect(model.rows[1].done).toBe(true);
  });

  it('lights two bosses that fall on the same poll, each on its own row', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    buildDungeonTracker({ dungeonRun: simRun(['sexton_marrow', 'cantor_ilvane']) }, model);
    expect(model.rows.slice(0, 4).map((row) => row.flash)).toEqual([true, false, true, false]);
  });

  it('lights the plate when the LAST boss falls in view, not for a run entered already finished', () => {
    const watched = makeDungeonTrackerModel();
    buildDungeonTracker(
      { dungeonRun: simRun(['sexton_marrow', 'rimeweb', 'cantor_ilvane']) },
      watched,
    );
    expect(watched.completeFlash).toBe(false);
    const done = simRun([...CRYPT]);
    for (let build = 0; build < DUNGEON_TRACKER_FLASH_BUILDS; build++) {
      buildDungeonTracker({ dungeonRun: done }, watched);
      expect(watched.completeFlash, `build ${build}`).toBe(true);
      expect(watched.complete).toBe(true);
    }
    buildDungeonTracker({ dungeonRun: done }, watched);
    expect(watched.completeFlash).toBe(false);
    expect(watched.complete).toBe(true);

    const walkedIn = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: done }, walkedIn);
    expect([walkedIn.complete, walkedIn.completeFlash]).toEqual([true, false]);
  });

  it('treats leaving and coming back as a first sighting', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    buildDungeonTracker({ dungeonRun: null }, model);
    // The boss died while the player was outside: nothing to celebrate on return.
    buildDungeonTracker({ dungeonRun: simRun(['sexton_marrow']) }, model);
    expect(model.rows[0]).toMatchObject({ done: true, flash: false });
  });

  it('treats another dungeon, or the other difficulty, as a first sighting', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    buildDungeonTracker({ dungeonRun: simRun(['sexton_marrow'], 'heroic') }, model);
    expect(model.rows[0]).toMatchObject({ done: true, flash: false });
    buildDungeonTracker(
      {
        dungeonRun: simRun(
          ['knight_commander_olen'],
          'heroic',
          ['knight_commander_olen', 'gaol_turnkey', 'gaoler_ossick', 'vael_the_mistcaller'],
          'sunken_bastion',
        ),
      },
      model,
    );
    expect(model.dungeonId).toBe('sunken_bastion');
    expect(model.rows[0]).toMatchObject({
      mobId: 'knight_commander_olen',
      done: true,
      flash: false,
    });
  });

  it('drops a highlight at once if the row reopens (a fresh claim of the same dungeon)', () => {
    const model = makeDungeonTrackerModel();
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    buildDungeonTracker({ dungeonRun: simRun(['sexton_marrow']) }, model);
    expect(model.rows[0].flash).toBe(true);
    buildDungeonTracker({ dungeonRun: simRun() }, model);
    expect(model.rows[0]).toMatchObject({ done: false, flash: false, flashHold: 0 });
  });
});

describe('how far the plate may reach before the button rail', () => {
  // Boxes in one space. The column is 240 wide at x 1000; the stock rail is a
  // 70 wide strip against its right edge.
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  });
  const column = box(1000, 300, 1240, 440);
  const plate = box(1000, 300, 1240, 353);
  const railAt = (top: number) => box(1168, top, 1238, top + 438);

  it('fills the column when there is no rail, or the rail is hidden', () => {
    expect(dungeonPlateFraction(column, plate, null)).toBe(1);
    expect(dungeonPlateFraction(column, plate, box(0, 0, 0, 0))).toBe(1);
  });

  it('fills the column while the rail is below the plate, however close', () => {
    expect(dungeonPlateFraction(column, plate, railAt(353))).toBe(1);
    expect(dungeonPlateFraction(column, plate, railAt(600))).toBe(1);
  });

  it('keeps to the rail-free share once the rail is level with the plate', () => {
    const fraction = dungeonPlateFraction(column, plate, railAt(352));
    expect(fraction).toBeCloseTo(168 / 240 - DUNGEON_PLATE_RAIL_GAP_FRACTION, 10);
    // The plate then ends short of the rail by the gap.
    expect(column.left + fraction * 240).toBeLessThan(1168);
  });

  it('gives the same share at every UI scale, since it is a ratio of boxes', () => {
    const at = (scale: number) => {
      const s = (b: ReturnType<typeof box>) =>
        box(b.left * scale, b.top * scale, b.right * scale, b.bottom * scale);
      return dungeonPlateFraction(s(column), s(plate), s(railAt(250)));
    };
    expect(at(1.25)).toBeCloseTo(at(1), 10);
    expect(at(1.5)).toBeCloseTo(at(1), 10);
    expect(at(0.75)).toBeCloseTo(at(1), 10);
    expect(at(1)).toBeLessThan(1);
  });

  it('fills the column when the rail is beside some other column (a moved rail or tracker)', () => {
    expect(dungeonPlateFraction(column, plate, box(400, 250, 470, 700))).toBe(1);
    expect(dungeonPlateFraction(column, plate, box(1240, 250, 1310, 700))).toBe(1);
    // A horizontal rail that sits under the tracker.
    expect(dungeonPlateFraction(column, plate, box(900, 500, 1300, 566))).toBe(1);
  });

  it('never shrinks the plate to a sliver: a rail ACROSS the column is left alone', () => {
    // A horizontal rail lying over the plate leaves no column to keep to.
    expect(dungeonPlateFraction(column, plate, box(900, 310, 1300, 376))).toBe(1);
    const half = column.left + 240 * (DUNGEON_PLATE_MIN_FRACTION + DUNGEON_PLATE_RAIL_GAP_FRACTION);
    expect(dungeonPlateFraction(column, plate, box(half - 1, 250, half + 69, 700))).toBe(1);
    expect(dungeonPlateFraction(column, plate, box(half + 1, 250, half + 71, 700))).toBeLessThan(1);
  });

  it('is sticky the safe way: a narrowed plate that wrapped taller stays narrowed', () => {
    const rail = railAt(360);
    // Full width the plate ends above the rail...
    expect(dungeonPlateFraction(column, plate, rail)).toBe(1);
    // ...but once narrowed and wrapped past it, it does not widen back into it.
    const wrapped = box(1000, 300, 1160, 371);
    expect(dungeonPlateFraction(column, wrapped, rail)).toBeLessThan(1);
  });
});

describe('dungeon run as a touch quest strip page', () => {
  const text = {
    title: (dungeonId: string, heroic: boolean) => `<${dungeonId}${heroic ? '+H' : ''}>`,
    bossName: (mobId: string) => `[${mobId}]`,
  };

  it('is null outside a run', () => {
    expect(dungeonStripQuest({ dungeonRun: null }, text)).toBeNull();
    expect(dungeonStripQuest({ dungeonRun: simRun([], 'normal', []) }, text)).toBeNull();
  });

  it.each(SHAPES)('projects the run onto the strip model from %s', (_label, make) => {
    const quest = dungeonStripQuest({ dungeonRun: make(['sexton_marrow'], 'heroic') }, text);
    expect(quest).toEqual({
      id: `${DUNGEON_STRIP_QUEST_PREFIX}hollow_crypt:heroic`,
      number: 0,
      title: '<hollow_crypt+H>',
      complete: false,
      objectives: [
        { label: '[sexton_marrow]', current: 1, total: 1 },
        { label: '[rimeweb]', current: 0, total: 1 },
        { label: '[cantor_ilvane]', current: 0, total: 1 },
        { label: '[morthen]', current: 0, total: 1 },
      ],
    });
  });

  it('is a different page per difficulty, and never collides with a quest id', () => {
    const normal = dungeonStripQuest({ dungeonRun: simRun() }, text);
    const heroic = dungeonStripQuest({ dungeonRun: simRun([], 'heroic') }, text);
    expect(normal?.id).not.toBe(heroic?.id);
    expect(normal?.id.startsWith(DUNGEON_STRIP_QUEST_PREFIX)).toBe(true);
    expect(normal?.title).toBe('<hollow_crypt>');
    // No logged quest id and no other synthetic page (the Clue Scroll's
    // `clue:` row) can be read as the dungeon page.
    expect(Object.keys(QUESTS).filter((id) => id.startsWith(DUNGEON_STRIP_QUEST_PREFIX))).toEqual(
      [],
    );
    expect('clue:hunt'.startsWith(DUNGEON_STRIP_QUEST_PREFIX)).toBe(false);
  });

  it('reads complete once every boss is down', () => {
    expect(dungeonStripQuest({ dungeonRun: simRun([...CRYPT]) }, text)?.complete).toBe(true);
    expect(dungeonStripQuest({ dungeonRun: simRun(['morthen']) }, text)?.complete).toBe(false);
  });

  it('the strip shows every boss of the page, each done or not', () => {
    const quest = dungeonStripQuest({ dungeonRun: simRun(['rimeweb']) }, text);
    if (!quest) throw new Error('no page');
    const view = questStripView([quest], 0);
    expect(view.hiddenObjectives).toBe(0);
    expect(view.objectives.map((o) => [o.label, o.done])).toEqual([
      ['[sexton_marrow]', false],
      ['[rimeweb]', true],
      ['[cantor_ilvane]', false],
      ['[morthen]', false],
    ]);
  });
});

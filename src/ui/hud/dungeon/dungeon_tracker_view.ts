// Pure, host-agnostic core of the dungeon objectives tracker: the plate at the
// top of the right tracker stack that names the group dungeon a player stands
// in and lists its bosses, each counted 0 of 1 until it falls.
//
// It decides WHAT the tracker shows from IWorld.dungeonRun (the sim's own
// answer to "which bosses, in what order, and which are down": see
// src/sim/instances/dungeon_run.ts), and nothing about how it is drawn. No DOM
// and no i18n: every name is resolved by the painter (dungeon_tracker_painter.ts)
// from the ids carried here, so the core is the same on a Sim and a ClientWorld.
//
// Allocation-light: the model is ONE caller-owned object with a fixed row
// pool, rebuilt in place on every poll, so the medium band it runs on makes no
// garbage and an unchanged run is a handful of field writes.
//
// The model also carries the one piece of memory the tracker has: which rows
// were already down on the previous build. That is what lets a boss falling
// IN FRONT OF the player light its row for a moment, while a row that was
// already down when the player walked in (a re-entry, a late join, a
// reconnect) is simply drawn as done. The glow is decoration over a count that
// is already on screen; nothing actionable rides it.
//
// TOUCH has no room for a plate in the right column (the stack's seat on a
// landscape phone runs straight into the action ring), and the quest tracker
// is already replaced there by the top-band quest strip. So on touch the run
// rides that strip as one page of its own: dungeonStripQuest() projects it
// onto the strip's own TrackedQuest model, and the strip paints it like any
// other page ("Sexton Marrow: 0/1"), with no second presentation to keep in
// step.

import type { IWorld } from '../../../world_api';
import type { TrackedQuest } from '../quest/quest_tracker';

/**
 * The row pool: far above any authored boss list (the longest is four), so a
 * dungeon never loses a row to it. tests/dungeon_tracker_view.test.ts pins
 * every tracked dungeon under this cap.
 */
export const DUNGEON_TRACKER_ROW_CAP = 8;

/**
 * How many consecutive builds a fresh kill keeps its highlight. The tracker
 * is polled on the HUD's medium band (about 4 Hz), so this is a little over a
 * second: long enough for the CSS glow to play out once, then the row rests.
 */
export const DUNGEON_TRACKER_FLASH_BUILDS = 6;

export interface DungeonTrackerRow {
  /** The boss's mob template id; the painter resolves its name. */
  mobId: string;
  done: boolean;
  /** The boss fell while the tracker was up (see DUNGEON_TRACKER_FLASH_BUILDS). */
  flash: boolean;
  /** Builds the flash still has to run; the core's own memory. */
  flashHold: number;
}

export interface DungeonTrackerModel {
  /** False outside a tracked dungeon: the painter hides the whole tracker. */
  visible: boolean;
  dungeonId: string;
  heroic: boolean;
  /** Live rows: `rows[0 .. count)`; slots past it are stale pool entries. */
  count: number;
  rows: DungeonTrackerRow[];
  /** Every boss of the run, including any the row pool could not hold. */
  total: number;
  /** How many of those `total` bosses are down. */
  defeated: number;
  /** Every boss of the run is down (never just the rows the pool holds). */
  complete: boolean;
  /**
   * Bumped whenever something the painter RESOLVES TEXT from changes: the
   * tracker appearing, the dungeon, the difficulty, a boss in a row, a row
   * turning done, or the tally. The highlight holds do not move it, so the
   * painter can skip every t() and name lookup on an unchanged poll.
   */
  rev: number;
  /** The LAST boss fell while the tracker was up: the plate's one-time glow. */
  completeFlash: boolean;
  completeHold: number;
}

/** Id prefix of the run's page on the touch quest strip. Logged quests are
 *  `q_...` ids and the Clue Scroll page is `clue:...`, so the page cannot be
 *  mistaken for either. */
export const DUNGEON_STRIP_QUEST_PREFIX = 'dungeon:';

/** The localized text the strip page needs; resolved by the caller. */
export interface DungeonStripText {
  /** The page title: the dungeon's name, with the difficulty when heroic. */
  title(dungeonId: string, heroic: boolean): string;
  bossName(mobId: string): string;
}

/**
 * The run as one page of the touch quest strip, or null outside a tracked
 * dungeon: the dungeon is the title, each boss one counted objective (0 or 1
 * of 1), and the page reads complete once every boss is down. The difficulty
 * is part of the id, so a heroic run after a normal one is a new page.
 */
export function dungeonStripQuest(
  world: Pick<IWorld, 'dungeonRun'>,
  text: DungeonStripText,
): TrackedQuest | null {
  const run = world.dungeonRun;
  if (!run || run.bosses.length === 0) return null;
  const heroic = run.difficulty === 'heroic';
  return {
    id: `${DUNGEON_STRIP_QUEST_PREFIX}${run.dungeonId}:${run.difficulty}`,
    // Not a logged quest: it has no acceptance-order badge.
    number: 0,
    title: text.title(run.dungeonId, heroic),
    complete: run.bosses.every((boss) => boss.defeated),
    objectives: run.bosses.map((boss) => ({
      label: text.bossName(boss.mobId),
      current: boss.defeated ? 1 : 0,
      total: 1,
    })),
  };
}

/** A fresh, hidden model with its row pool preallocated. */
export function makeDungeonTrackerModel(): DungeonTrackerModel {
  const rows: DungeonTrackerRow[] = [];
  for (let i = 0; i < DUNGEON_TRACKER_ROW_CAP; i++) {
    rows.push({ mobId: '', done: false, flash: false, flashHold: 0 });
  }
  return {
    visible: false,
    dungeonId: '',
    heroic: false,
    count: 0,
    rows,
    total: 0,
    defeated: 0,
    complete: false,
    rev: 0,
    completeFlash: false,
    completeHold: 0,
  };
}

/** One measured box, in any one consistent coordinate space. */
export interface DungeonTrackerBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The plate never narrows below this share of its column: past it the rail
 *  is not beside the tracker but across it, and a sliver of a plate is worse
 *  than an overlap. */
export const DUNGEON_PLATE_MIN_FRACTION = 0.5;

/** Clear space kept between the plate and the rail, as a share of the column
 *  (8px of the stock 240px), so it scales with the HUD like everything else. */
export const DUNGEON_PLATE_RAIL_GAP_FRACTION = 8 / 240;

/**
 * How much of its column the plate may fill before it reaches the button
 * rail: 1 when the rail is nowhere near it, less when the rail stands beside
 * it. The plate is the one OPAQUE box in the tracker stack, and the stack
 * paints above the rail, so wherever the two meet the plate would cover
 * buttons; text rows are harmless there and are not narrowed.
 *
 * Pure arithmetic over three measured boxes in the same space, so it is right
 * at every UI scale, for a horizontal or a moved rail, and for a tracker that
 * was itself moved or sits in the combined group: nothing here knows where
 * either one is supposed to be. `column` is the tracker's own box and `plate`
 * the plate's CURRENT box, narrowed or not; reading the current box makes the
 * answer sticky in the one direction that matters (a narrowed plate that
 * wrapped taller stays narrowed), so it cannot flip back and forth.
 */
export function dungeonPlateFraction(
  column: DungeonTrackerBox,
  plate: DungeonTrackerBox,
  rail: DungeonTrackerBox | null,
): number {
  const width = column.right - column.left;
  if (!rail || width <= 0) return 1;
  if (rail.right <= rail.left || rail.bottom <= rail.top) return 1;
  // Beside the column at all, and level with the plate?
  if (rail.left >= column.right || rail.right <= column.left) return 1;
  if (rail.top >= plate.bottom || rail.bottom <= plate.top) return 1;
  const free = (rail.left - column.left) / width - DUNGEON_PLATE_RAIL_GAP_FRACTION;
  if (free >= 1) return 1;
  return free < DUNGEON_PLATE_MIN_FRACTION ? 1 : free;
}

/**
 * Rebuild `out` in place from the world's current run and return it. Call it
 * once per poll with the same `out`: the previous build's rows are the memory
 * the highlight is decided against.
 */
export function buildDungeonTracker(
  world: Pick<IWorld, 'dungeonRun'>,
  out: DungeonTrackerModel,
): DungeonTrackerModel {
  const run = world.dungeonRun;
  if (!run || run.bosses.length === 0) {
    // Hidden: forget everything, so the next sighting is a first sighting.
    out.visible = false;
    out.dungeonId = '';
    out.heroic = false;
    out.count = 0;
    out.total = 0;
    out.defeated = 0;
    out.complete = false;
    out.completeFlash = false;
    out.completeHold = 0;
    return out;
  }
  const heroic = run.difficulty === 'heroic';
  const count = Math.min(run.bosses.length, DUNGEON_TRACKER_ROW_CAP);
  // The same run as last build: only then is "was not done, is done now" a
  // kill the player just watched. A different dungeon, difficulty or boss
  // list is a first sighting and never lights anything.
  let sameRun =
    out.visible && out.dungeonId === run.dungeonId && out.heroic === heroic && out.count === count;
  for (let i = 0; sameRun && i < count; i++) {
    if (out.rows[i].mobId !== run.bosses[i].mobId) sameRun = false;
  }
  const wasComplete = sameRun && out.complete;
  // Anything the painter resolves text from: a first sighting, or below, a
  // row turning done.
  let changed = !sameRun;
  let defeated = 0;
  for (let i = 0; i < count; i++) {
    const boss = run.bosses[i];
    const row = out.rows[i];
    if (row.done !== boss.defeated) changed = true;
    let hold = sameRun ? row.flashHold : 0;
    if (sameRun && boss.defeated && !row.done) hold = DUNGEON_TRACKER_FLASH_BUILDS;
    else if (hold > 0) hold--;
    // A row cannot be both open and lit (a fresh claim of the same dungeon).
    if (!boss.defeated) hold = 0;
    row.mobId = boss.mobId;
    row.done = boss.defeated;
    row.flashHold = hold;
    row.flash = hold > 0;
    if (boss.defeated) defeated++;
  }
  // The tally and the finished state count EVERY boss, also one the pool had
  // no row for: a plate must never read Complete with a boss still standing.
  const total = run.bosses.length;
  for (let i = count; i < total; i++) {
    if (run.bosses[i].defeated) defeated++;
  }
  const complete = defeated === total;
  if (out.total !== total || out.defeated !== defeated) changed = true;
  let completeHold = sameRun ? out.completeHold : 0;
  if (sameRun && complete && !wasComplete) completeHold = DUNGEON_TRACKER_FLASH_BUILDS;
  else if (completeHold > 0) completeHold--;
  if (!complete) completeHold = 0;
  out.visible = true;
  out.dungeonId = run.dungeonId;
  out.heroic = heroic;
  out.count = count;
  out.total = total;
  out.defeated = defeated;
  out.complete = complete;
  if (changed) out.rev++;
  out.completeHold = completeHold;
  out.completeFlash = completeHold > 0;
  return out;
}

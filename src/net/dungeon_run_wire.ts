// Decode of the self record's `dgrun` key: the group dungeon run the player
// stands in (IWorld.dungeonRun). The server ships the sim's own view verbatim
// (server/dungeon_run_wire.ts over src/sim/instances/dungeon_run.ts), delta
// elided, so a frame arrives only when the run changes: on entry, when a boss
// falls, and as an explicit null on leaving.
//
// The one decode idiom of this directory: DOM-free, ClientWorld-free, every
// field re-validated. A run this bundle cannot name (a dungeon or a boss a
// version-skewed server knows and this client does not) is dropped WHOLE
// rather than rendered short: a list missing a boss would read as a wrong
// count, and no tracker is the honest degradation.

import { DUNGEONS, MOBS } from '../sim/data';
import { isDungeonDifficulty } from '../sim/types';
import type { DungeonRunBossView, DungeonRunView } from '../world_api/dungeons';

/** Far above any authored boss list; a longer one is not a frame of ours. */
const MAX_BOSS_ROWS = 16;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Do two runs say the same thing, row for row? */
export function sameDungeonRun(a: DungeonRunView, b: DungeonRunView): boolean {
  if (a.dungeonId !== b.dungeonId || a.difficulty !== b.difficulty) return false;
  if (a.bosses.length !== b.bosses.length) return false;
  for (let i = 0; i < a.bosses.length; i++) {
    const x = a.bosses[i];
    const y = b.bosses[i];
    if (x.mobId !== y.mobId || x.defeated !== y.defeated) return false;
  }
  return true;
}

/**
 * The mirror after one `dgrun` frame: the decoded run, except that a frame
 * repeating the run already held (the server re-sends every key to a session
 * whose delta cache it reset) keeps the object already held, which is what
 * makes the mirror reference-stable the way the seam promises.
 */
export function nextDungeonRun(held: DungeonRunView | null, value: unknown): DungeonRunView | null {
  const decoded = decodeDungeonRun(value);
  return held && decoded && sameDungeonRun(held, decoded) ? held : decoded;
}

/** The decoded run, or null for an absent, cleared or malformed frame. */
export function decodeDungeonRun(value: unknown): DungeonRunView | null {
  if (!record(value)) return null;
  const { dungeonId, difficulty, bosses } = value;
  if (typeof dungeonId !== 'string' || !Object.hasOwn(DUNGEONS, dungeonId)) return null;
  if (!isDungeonDifficulty(difficulty)) return null;
  if (!Array.isArray(bosses) || bosses.length === 0 || bosses.length > MAX_BOSS_ROWS) return null;
  const rows: DungeonRunBossView[] = [];
  for (const boss of bosses) {
    if (!record(boss)) return null;
    const { mobId, defeated } = boss;
    if (typeof mobId !== 'string' || !Object.hasOwn(MOBS, mobId)) return null;
    if (typeof defeated !== 'boolean') return null;
    rows.push(Object.freeze({ mobId, defeated }));
  }
  return Object.freeze({ dungeonId, difficulty, bosses: Object.freeze(rows) });
}

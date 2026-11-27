// The self record's `bkills` key (IWorld.bossKills, the Adventure Journal's
// "Your kills"): the client decode. The server encode is
// server/dungeon_run_wire.ts bossKillsWireJson. The decode runs the sim's own
// sanitizer, so a mirror can never hold a count the sim would refuse to load,
// and a repeated frame keeps the held object, so the journal's identity check
// stays a no-op until a count really moves.

import { type BossKillTally, sameBossKills, sanitizeBossKills } from '../sim/boss_kill_tally';

/** The mirror after one `bkills` frame, reference-stable while unchanged. A
 *  mirror with nothing held yet takes the decoded tally as is. */
export function nextBossKills(held: BossKillTally | undefined, value: unknown): BossKillTally {
  const decoded = sanitizeBossKills(value);
  return held && sameBossKills(held, decoded) ? held : decoded;
}

// Thornhollow Fields team parties: each team of five fights as ONE party for the match
// (party chat plus the left-screen party frames), formed at match start
// through the same dungeon-finder formation seam manual groups use, and
// unwound again when the match ends or a member deserts.
//
// The base premade (the first queued party unit in seat order, the same unit
// formDungeonFinderGroup keeps) survives with its party id, leader, and loot
// settings; solos, and players whose party reaches outside the team, are
// auto-added and are exactly the links to undo afterward, so a premade that
// queued together leaves the field exactly as it arrived. An all-solo team
// gets a fresh party; unwinding its four auto-added members drops it to one,
// which the party machine's own <=1 rule then disbands.
//
// src/sim-pure: sibling sim imports only, no rng draws (the bg zero-rng pin
// covers this path), runs unchanged in Node, the browser, and the RL env.

import type { SimContext } from '../sim_context';
import type { FinderFormationUnit } from './party';

const LEAVE_VERB = 'has left the party'; // the manual-leave notice, verbatim

/**
 * Merge one team into a single party. Returns the pids that were AUTO-added
 * (everyone outside the surviving base unit): the links to unwind later.
 * Returns [] without mutating when the team is already one whole premade, or
 * when formation validation refuses (for example dev matches whose seats are
 * not real players).
 */
export function formBgTeamParty(ctx: SimContext, teamPids: number[]): number[] {
  const teamSet = new Set(teamPids);
  const units: FinderFormationUnit[] = [];
  const seenParty = new Set<number>();
  for (const pid of teamPids) {
    const party = ctx.partyOf(pid);
    if (party && party.members.every((m) => teamSet.has(m))) {
      if (!seenParty.has(party.id)) {
        seenParty.add(party.id);
        units.push({ partyId: party.id, leaderPid: party.leader, members: [...party.members] });
      }
      continue;
    }
    // Partied with someone outside this team: pull the member out solo first
    // (their old party gets the normal leave notice), then merge them.
    if (party) ctx.removeFromParty(pid, LEAVE_VERB);
    units.push({ partyId: null, leaderPid: pid, members: [pid] });
  }
  if (units.length < 2) return []; // one whole premade (or an empty team): nothing to add
  const formed = ctx.formDungeonFinderGroup(units, { raid: false });
  if (!formed) return [];
  // The same base-unit rule the formation applied: that unit kept its party.
  const base = units.find((u) => u.partyId !== null) ?? units[0];
  return units.filter((u) => u !== base).flatMap((u) => u.members);
}

/** Unwind every auto-added team-party link (match end). */
export function unwindBgTeamParties(ctx: SimContext, auto: [number[], number[]]): void {
  for (const team of [0, 1] as const) {
    for (const pid of auto[team]) ctx.removeFromParty(pid, LEAVE_VERB);
    auto[team] = [];
  }
}

/** Unwind one player's auto-added link (desertion); no-op for premade members. */
export function unwindBgAutoPartyFor(
  ctx: SimContext,
  auto: [number[], number[]],
  pid: number,
): void {
  for (const team of [0, 1] as const) {
    if (!auto[team].includes(pid)) continue;
    ctx.removeFromParty(pid, LEAVE_VERB);
    auto[team] = auto[team].filter((p) => p !== pid);
  }
}

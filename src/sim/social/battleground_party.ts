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
  const premadeBase = units.find((u) => u.partyId !== null);
  const base = premadeBase ?? units[0];
  const added = units.filter((u) => u !== base).flatMap((u) => u.members);
  // When NO unit brought a party of its own, the group is entirely this
  // system's invention, so its base is an auto-added member like every other
  // and belongs in the list. That is what lets a deserting base be unwound by
  // id. When a premade IS the base, the party is the players' own group and
  // its members stay out, so deserting never breaks up friends: a partial
  // premade's party CONTAINS the auto-added solos, so any rule that inferred
  // system-built from party contents would evict a friend by mistake.
  return premadeBase ? added : [...base.members, ...added];
}

/**
 * Add ONE backfilled fighter to a team's existing match party. Returns true when
 * the link was made, so the caller can record it as auto-added and unwind it
 * exactly like a start-of-match one.
 *
 * The joiner is always the added unit, never the base: the team's party (and so
 * its id, leader, and loot settings) is the one that must survive, which is the
 * mirror of the rule formBgTeamParty applies at start. Returns false when the
 * team holds no party to join (an all-solo side whose formation refused, or a
 * dev match), leaving the fighter partyless rather than inventing a group.
 */
export function joinBgTeamParty(
  ctx: SimContext,
  teamPids: number[],
  joinerPid: number,
  opts: { autoAdded: readonly number[] },
): boolean {
  let existing = teamPids
    .filter((pid) => pid !== joinerPid)
    .map((pid) => ctx.partyOf(pid))
    .find((party) => party !== null);
  if (!existing) return false;
  if (existing.members.includes(joinerPid)) return false; // already linked
  // Clear out members who have left the match so the merge below is not refused
  // for capacity while the team fights a man down.
  //
  // ONLY auto-added ones. Membership of this party is not evidence that the
  // system built it: formBgTeamParty merges the solos INTO a premade's own
  // group when there is one, so on a partial premade the party is the players'
  // and a departed FRIEND is sitting in it legitimately. Sweeping by presence
  // would evict them here, which is the same eviction the desertion path was
  // just fixed not to do, only deferred to whenever the next backfill lands.
  // When nothing was auto-added the filter is empty and the join fails for
  // capacity, which is exactly what a whole premade already does.
  {
    const stale = existing.members.filter(
      (m) => !teamPids.includes(m) && opts.autoAdded.includes(m),
    );
    for (const m of stale) ctx.removeFromParty(m, LEAVE_VERB);
    if (stale.length > 0) {
      const refreshed = teamPids
        .filter((pid) => pid !== joinerPid)
        .map((pid) => ctx.partyOf(pid))
        .find((party) => party !== null);
      if (!refreshed) return false;
      existing = refreshed;
    }
  }
  // Partied with someone outside this match: pull them out solo first, so the
  // old party gets the normal leave notice before the merge.
  if (ctx.partyOf(joinerPid)) ctx.removeFromParty(joinerPid, LEAVE_VERB);
  const formed = ctx.formDungeonFinderGroup(
    [
      { partyId: existing.id, leaderPid: existing.leader, members: [...existing.members] },
      { partyId: null, leaderPid: joinerPid, members: [joinerPid] },
    ],
    { raid: false },
  );
  return formed !== null;
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
    if (auto[team].includes(pid)) {
      ctx.removeFromParty(pid, LEAVE_VERB);
      auto[team] = auto[team].filter((p) => p !== pid);
    }
  }
}

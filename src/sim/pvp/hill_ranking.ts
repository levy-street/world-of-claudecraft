// King of the Hill: the hold ranking. Every group that holds the hill banks
// the seconds it held it with at least one member standing inside, across every
// separate hold of the same stand (a group that walked away banks nothing, so a
// quiet realm cannot be won from afar); the
// realm hears the standings every HILL_NOTICE_SECONDS while the hill stands
// and once more when it falls, and the group (or groups, on a tie) that held
// it longest, if for at least HILL_VAULT_MIN_HOLD_SECONDS, earns one point
// toward the Weekly Vault's PvP row for each member
// who stood inside for HILL_VAULT_MIN_INSIDE_SECONDS and is still in the group
// when it falls (or is its sole survivor after disband), so the payees are
// capped at a party's size (hill.ts pays
// it through the host-injected credit, so this barrel never imports the vault
// module: an import cycle through entity.ts).
//
// Pure: no SimContext, no rng, no clock. The records live on the hill
// (ActiveHill.holds), the sim updates them in its once-a-second pass, and the
// ordering here is a plain function of them, so every host ranks the same.

/** One group's hold over one stand. */
export interface HillHoldRecord {
  /** The group key (hill_rules.ts hillGroupKey). */
  key: string;
  /** Seconds this group has held the hill with a member standing inside, over
   *  the whole stand, summed over every separate hold. */
  seconds: number;
  /** The name the realm knows the group by: its party leader's, or the lone
   *  player's. Refreshed on each pass a member stands inside. */
  name: string;
  /** A party (the "{name}'s group" line) or a lone player (the bare name). */
  party: boolean;
  /** pid -> seconds that player stood inside while this group held the hill,
   *  in the order they first did: the Weekly Vault point's candidates. */
  holders: Map<number, number>;
  /** The sole member left when this party disbanded, while still ungrouped. */
  disbandedSurvivor?: number;
}

/** How many places the realm announcements list. */
export const HILL_RANKING_SHOWN = 3;

/** The groups that held the hill, longest first. A tie keeps the order the
 *  groups first held it (the records map's insertion order; Array.sort is
 *  stable), so the ranking is the same on every host. */
export function hillRanking(records: Iterable<HillHoldRecord>): HillHoldRecord[] {
  return [...records].filter((r) => r.seconds > 0).sort((a, b) => b.seconds - a.seconds);
}

/** Every group tied for the longest hold, or none when nobody held the hill:
 *  a tie at the top shares the award rather than breaking it on an order. */
export function hillLongestHolds(records: Iterable<HillHoldRecord>): HillHoldRecord[] {
  const ranked = hillRanking(records);
  if (ranked.length === 0) return [];
  const best = ranked[0].seconds;
  return ranked.filter((r) => r.seconds === best);
}

/** The players the longest hold pays: nobody unless it lasted at least
 *  `minHoldSeconds` in total; otherwise every holder of every group tied at
 *  the top who stood inside for at least `minInsideSeconds` while it held and
 *  `stillInGroup` (the host's membership check at the fall), each once (a
 *  player who held for two tied groups earns one point). */
export function hillVaultPayees(
  records: Iterable<HillHoldRecord>,
  minHoldSeconds: number,
  minInsideSeconds: number,
  stillInGroup: (pid: number, key: string) => boolean,
): number[] {
  const longest = hillLongestHolds(records);
  if (longest.length === 0 || longest[0].seconds < minHoldSeconds) return [];
  const payees = new Set<number>();
  for (const record of longest) {
    for (const [pid, inside] of record.holders) {
      if (inside >= minInsideSeconds && stillInGroup(pid, record.key)) payees.add(pid);
    }
  }
  return [...payees];
}

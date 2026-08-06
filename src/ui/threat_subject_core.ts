// Which mob the Threat tab is about, resolved LIVE every render.
//
// The encounter's `mainMobId` is the wrong answer and was the bug: it latches to
// the biggest-maxHp mob the party ever damaged, with a strict `>` comparison, so
// a second mob of the SAME size never takes over and a dead one never releases
// it. Once that mob died the tab silently fell through to a damage readout that
// could no longer change, which players correctly reported as "the threat meter
// stopped updating" and, because the frozen numbers no longer matched the live
// fight, as people stealing aggro from below on the meter.
//
// The hate table is per MOB, so the tab can only ever be about one of them. This
// core picks that one the way a player expects: the mob you are looking at, and
// otherwise the biggest one actually engaged with your group.
//
// DOM-free and i18n-free (UI_PURE_CORES, tests/architecture.test.ts); it reads a
// structural slice of Entity so both the offline Sim and the online ClientWorld
// satisfy it.

/** The slice of a mob entity the subject rule reads. */
export interface ThreatSubjectMob {
  id: number;
  kind: string;
  dead: boolean;
  maxHp: number;
  threat: Map<number, number>;
}

export interface ThreatSubjectInput {
  entities: Iterable<ThreatSubjectMob>;
  /** The local player's selected target, when they have one. */
  playerTargetId: number | null;
  /**
   * Party members, self, AND their pets: a mob counts as engaged when any of
   * these sits on its hate table. Pets are included because a pet can be the
   * only member of the group a mob has ever seen.
   */
  trackedPids: ReadonlySet<number>;
  /**
   * The encounter's latched subject. Used ONLY when nothing is live, which is
   * what keeps a finished encounter reviewable in the history pages.
   */
  fallbackMobId: number | null;
}

/**
 * A live mob holding hate on someone the meter is tracking. The `threat` guard
 * is deliberate belt-and-braces: both hosts always build the map (`baseEntity`
 * offline, the entity factory in `net/online.ts` for the mirror), but this walks
 * EVERY entity on every render and a throw here would blank the whole panel.
 */
function isEngaged(mob: ThreatSubjectMob, trackedPids: ReadonlySet<number>): boolean {
  if (mob.kind !== 'mob' || mob.dead || !mob.threat || mob.threat.size === 0) return false;
  for (const pid of mob.threat.keys()) if (trackedPids.has(pid)) return true;
  return false;
}

/**
 * The mob whose hate table the Threat tab should show, or null when there is
 * nothing to show at all.
 *
 * Order: the player's own target wins (a threat meter follows what you are
 * looking at), then the biggest engaged mob, then the latched encounter subject.
 * Ties break on the lowest entity id so the choice never flickers between two
 * identical mobs across renders.
 */
export function resolveThreatSubject(input: ThreatSubjectInput): number | null {
  const { entities, playerTargetId, trackedPids, fallbackMobId } = input;
  let best: ThreatSubjectMob | null = null;
  for (const mob of entities) {
    if (!isEngaged(mob, trackedPids)) continue;
    if (playerTargetId !== null && mob.id === playerTargetId) return mob.id;
    if (!best || mob.maxHp > best.maxHp || (mob.maxHp === best.maxHp && mob.id < best.id)) {
      best = mob;
    }
  }
  return best ? best.id : fallbackMobId;
}

// IWorld facet: seasonal events (src/sim/seasonal/). What event the world is
// running, the local player's trick-or-treat knocks for the day, and the knock
// itself. The event WINDOW is the server's (server/seasonal_calendar.ts); the
// client never decides it, it only mirrors the answer.
//
// Offline the Sim reads its own seasonal state (closed unless /dev season opens
// it); online ClientWorld mirrors the `season` and `tot` self keys and sends
// `trick_or_treat`, which the server re-validates in full (event open, range,
// the NPC answers knocks, not knocked today) before the sim rolls the outcome.

export interface IWorldSeasonal {
  /** The seasonal event running now (e.g. 'gourdlight_eve'), or null. */
  readonly activeSeasonalEvent: string | null;
  /** NPC template ids the local player already trick-or-treated this reset day, and
   *  `boo_<id>` for each townsperson they frightened today (the Boo! daily). */
  readonly trickOrTreatedToday: readonly string[];
  /** Stable pumpkin ids discovered by the local player this event edition. */
  readonly hauntedPumpkinsFound: readonly string[];
  /** Say "trick or treat" to an NPC entity, or with `boo` a costumed BOO (the Boo!
   *  daily). Feedback arrives as `seasonal` events. */
  trickOrTreat(npcId: number, boo?: boolean): void;
}

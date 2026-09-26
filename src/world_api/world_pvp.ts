// IWorld facet: World PvP, the /pvp flag (src/sim/pvp/world_pvp.ts) and the
// King of the Hill (src/sim/pvp/hill.ts). The self-scoped readouts the World
// PvP tab and the hill bar paint plus the one command that raises or lowers
// the flag. Whether ANOTHER player is flagged is not here: it rides the
// entity roster as `Entity.pvpFlag` (the `pvp` wire bit), which is what the
// nameplate and target-frame cores read, together with the zone policy of
// the ground under each player (src/sim/pvp/world_pvp_zones.ts).
//
// Offline the Sim answers from the primary player's own state; online
// ClientWorld mirrors the server's `wpvp` and `hill` self keys (delta-omitted:
// an absent key keeps the prior readout, null before the first snapshot).

export type WorldPvpZone = 'sanctuary' | 'contested' | 'ffa';

export interface WorldPvpInfo {
  /** Attackable by, and able to attack, other flagged players right now.
   *  Stays true through the whole disarm countdown. */
  flagged: boolean;
  /** Seconds until the flag drops after /pvp off, or null when it is not
   *  switching off (armed for good, or not flagged). */
  disarmRemaining: number | null;
  /** Career world kills paid to this character, and career deaths to other
   *  players in the open world. */
  kills: number;
  deaths: number;
  /** Below WORLD_PVP_MIN_LEVEL: the toggle is shown locked with the requirement. */
  levelLocked: boolean;
  /** What the ground under this player says: a sanctuary (no world PvP at
   *  all), contested (the mutual-flag rule), or free-for-all (everyone here is
   *  fair game, flag or not). */
  zone: WorldPvpZone;
  /** False on a realm whose kill switch is set (server env WORLD_PVP_DISABLED):
   *  no flag can be raised and no zone is free-for-all, so the client paints
   *  nobody hostile on the world arm. */
  enabled: boolean;
}

/** Who a side of the hill is, from the viewer's seat. */
export type HillSide = 'none' | 'you' | 'other';

/** 'warning': announced and marked on the ground, not yet contestable.
 *  'active': risen; the contest and the payouts run. */
export type HillPhaseInfo = 'warning' | 'active';

/** Whether the viewer counts on the hill: parties only, so a raid member
 *  does not. Any level counts. */
export type HillStandingInfo = 'counted' | 'raid';

/** The announced or standing hill (src/sim/pvp/hill.ts), from one viewer's
 *  seat. The geometry, the phase and the holder are realm facts; `inZone`,
 *  `inside`, `standing`, the counts and the contest clock are the viewer's.
 *  The live fields (counts, contest) are zero unless the viewer stands in the
 *  hill's zone while it is risen, so the self wire elides the readout for
 *  everyone else between crossings and holder changes. */
export interface HillInfo {
  zoneId: string;
  x: number;
  z: number;
  radius: number;
  phase: HillPhaseInfo;
  /** Whole minutes (rounded up) until the next phase change: the rise while
   *  warning, the fall while risen. */
  minutesLeft: number;
  standing: HillStandingInfo;
  /** The viewer stands in the hill's zone (the bar and the live fields are
   *  for them) and inside the circle itself. */
  inZone: boolean;
  inside: boolean;
  holder: HillSide;
  /** The holder's members standing inside right now. */
  holderCount: number;
  /** The viewer's own group's members standing inside right now. */
  yourCount: number;
  /** The leading challenger (the largest group inside that beats the
   *  holder's present count), and its members inside. */
  challenger: HillSide;
  challengerCount: number;
  /** Whole seconds of unbroken majority the challenger has banked, of
   *  HILL_CAPTURE_SECONDS; 0 when nobody is challenging. */
  contest: number;
}

export interface IWorldWorldPvp {
  worldPvpInfo: WorldPvpInfo | null;
  /** Raise (true) or lower (false) the flag; lowering starts the disarm
   *  countdown. The sim refuses and explains under level or when nothing
   *  changes; the bare /pvp chat command toggles through the same path. */
  setWorldPvpFlag(enabled: boolean): void;
  /** The announced or standing King of the Hill circle, or null while none
   *  is (between hills, or on a realm whose World PvP switch is set). */
  hillInfo: HillInfo | null;
}

// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground. The HUD reads
// `bgInfo` (queue state, the live match view, and the LIVE online ladder) and
// sends the queue commands plus the deliberate flag-action press. The persistent
// ALL-TIME ladder is served over REST (`GET /api/battleground/leaderboard`), not
// this facet; the live one rides `bgInfo.ladder` here, mirroring how the arena
// ships `ArenaInfo.ladders` inside its own snapshot key (world_api/duel_arena.ts).
import type { PlayerClass } from '../sim/types';

export interface BgFlagInfo {
  state: 'home' | 'carried' | 'dropped';
  carrierPid: number | null;
  carrierName: string | null;
  carrierTeam: number | null; // 0 = Crimson, 1 = Azure
}

export interface BgPlayerInfo {
  pid: number;
  name: string;
  cls: PlayerClass;
  team: number; // 0 = Crimson, 1 = Azure
  carrying: boolean;
  // Match-wide on purpose, and the one piece of enemy state that is. A
  // scoreboard whose rows go quiet on death is the classic readout, and the
  // wave clock already publishes the same fact to both sides: respawns land on
  // a fixed 10s cadence, so a defender counting bodies learns nothing they
  // could not derive from the clock. It is also what the mode's own release
  // and forfeit rules are read against. Live POSITION stays interest-scoped;
  // this is a tally, not a track.
  dead: boolean;
  // Match tallies for the expanded scoreboard. Scalar totals only:
  kills: number;
  deaths: number;
  captures: number;
  /** Killing blows helped land without finishing (the classic assist column). */
  assists: number;
  // Deliberately NO hp/mhp: the scoreboard reads dead/carrying and the
  // tallies only, and the bg self key is match-wide (never interest-scoped),
  // so shipping enemy health here would leak actionable state past the
  // interest rule. Health is the granular, moment-to-moment read that
  // decides whether to commit; alive-or-dead plus a public wave clock is not.
  // The property this preserves is enforced, not merely conventional: the
  // authoritative snapshot never SHIPS an enemy fighter's entity record
  // (position, facing, hp/mhp, resource, cast bar, auras) past the ordinary
  // open-world interest radii. The battleground's raised match-wide radius
  // covers only your own team plus the field's non-player entities (flags,
  // runes, props); see bgWideInterestApplies and BG_MATCH_INTEREST_RADIUS in
  // server/game.ts, with the per-arm pins in tests/battleground_wire.test.ts.
  // So an honest client cannot draw an enemy on the map or minimap from data
  // it was never sent, and this omission is the matching rule for the one
  // match-wide payload.
}

export interface BgMatchInfo {
  // 'ended': the post-match hold, a frozen result screen over the field
  // before everyone is sent home (combat is off; countdown carries the hold).
  state: 'countdown' | 'active' | 'ended';
  myTeam: number; // 0 = Crimson, 1 = Azure
  capsToWin: number;
  scores: [number, number]; // [Crimson, Azure]
  flags: [BgFlagInfo, BgFlagInfo]; // indexed by home team
  players: BgPlayerInfo[];
  countdown: number; // whole seconds left in the form-up gate or the end hold
  timeLeft: number; // whole seconds until the match cap resolves on score
  waveIn: [number, number]; // whole seconds to each team's next respawn wave
  respawnIn: number; // = waveIn[myTeam] while you wait as a released ghost, else 0
  winner: number | null; // ended only: the winning team, null for a draw
}

/** One row of the LIVE online battleground ladder: rated champions currently
 *  connected, best first. The exact shape of the arena's `ArenaLadderEntry`
 *  (world_api/duel_arena.ts), because it is the exact same readout for the
 *  other ranked mode; the all-time REST board carries a `level` this one does
 *  not, since a live row is drawn from the connected roster, not a stored one. */
export interface BgLadderEntry {
  pid: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
}

/** A live queue-pop offer as the local player sees it. Anonymous by design. */
export interface BgProposalInfo {
  id: number;
  size: number; // fighters the offer needs (always both teams in full)
  accepted: number; // fighters who have accepted so far
  myResponse: 'pending' | 'accepted';
  remaining: number; // whole seconds left to answer
}

export interface BgInfo {
  rating: number;
  wins: number;
  losses: number;
  captures: number; // career flag captures
  queued: boolean;
  queueSize: number; // champions waiting across all groups
  queuedParty: number; // size of your own queued group
  /** The first-win-of-the-day Honor bonus is still unclaimed for this character
   *  (src/sim/pvp/honor.ts `bgFirstWinBonusAvailable`). Drives the available-bonus
   *  chip on the Thornhollow Fields tab; goes false the moment a win claims it,
   *  and back true on the UTC rollover. Rides the `bg` key's own refresh cadence:
   *  the chip is an invitation, never actionable in-match information. */
  firstWinBonusReady: boolean;
  /** The live queue-pop offer awaiting my answer, or null. Counts only, never
   *  names: the ten have not been introduced, and a decline must not leak who
   *  was on the other side (the Dungeon Finder proposal makes the same promise). */
  proposal: BgProposalInfo | null;
  /** Whole seconds until I may queue again after failing to answer an offer
   *  (0 = clear). Silence is what this exists to price; see
   *  `BG_PROPOSAL_LOCKOUT_SECONDS`. */
  requeueIn: number;
  match: BgMatchInfo | null;
  // Live standings of the rated champions currently online, best first, capped
  // at BG_LADDER_SIZE. Rides INSIDE this key rather than a facet member of its
  // own, exactly as the arena ships its live ladders inside `arenaInfo`: the
  // ClientWorld mirror is then free (the whole key is assigned from the wire).
  // Cadence: the `bg` key refreshes at BG_WIRE_HZ (server/game.ts) plus the
  // BG_WIRE_RESET_EVENTS that force a send. A ladder row only ever MOVES at
  // endBgMatch, and `bgEnd` is one of those reset events, so the ten fighters
  // whose ratings just changed see the new order on the very next snapshot;
  // every other viewer picks it up on their own 1 Hz poll, which is the same
  // staleness the queue-size and match clocks already carry.
  ladder: BgLadderEntry[];
}

export interface IWorldBattleground {
  bgInfo: BgInfo | null;
  bgQueueJoin(): void;
  bgQueueLeave(): void;
  /** Answer the live queue-pop offer. Declining, or letting it lapse, leaves the
   *  queue and books the short requeue lockout. */
  bgRespond(accept: boolean): void;
  /** The deliberate battleground action press: pick up a grabbable flag within reach. */
  bgFlagAction(): void;
}

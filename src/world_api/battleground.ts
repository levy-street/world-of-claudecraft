// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground. The HUD reads
// `bgInfo` (queue state + the live match view) and sends the queue commands
// plus the deliberate flag-action press. The persistent ladder is served over
// REST (`GET /api/battleground/leaderboard`), not this facet.
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
  // Deliberately NO hp/mhp: the scoreboard reads dead/carrying and the
  // tallies only, and the bg self key is match-wide (never interest-scoped),
  // so shipping enemy health here would leak actionable state past the
  // ~120yd interest rule. Health is the granular, moment-to-moment read that
  // decides whether to commit; alive-or-dead plus a public wave clock is not.
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

export interface BgInfo {
  rating: number;
  wins: number;
  losses: number;
  captures: number; // career flag captures
  queued: boolean;
  queueSize: number; // champions waiting across all groups
  queuedParty: number; // size of your own queued group
  match: BgMatchInfo | null;
}

export interface IWorldBattleground {
  bgInfo: BgInfo | null;
  bgQueueJoin(): void;
  bgQueueLeave(): void;
  /** The deliberate battleground action press: pick up a grabbable flag within reach. */
  bgFlagAction(): void;
}

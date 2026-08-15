// Pure, host-agnostic view model for the in-match Thornhollow Fields scoreboard strip:
// both team scores, the two flag states, the team roster pips,
// the match clock, and the personal wave-respawn / spawn-protection readouts.
// Snapshot-driven from bgInfo.match so it self-heals on reconnect; the one-shot
// juice (banners, cues) rides the bg SimEvents in hud.handleEvents, never this
// model (the vale_cup_hud_view.ts contract).
//
// Fairness invariant: while a match is visible the whole strip paints on every
// graphics tier, driven from the same model for every player (flag states and
// the carrier marker are actionable information).
//
// DOM-free and i18n-free: states are raw tokens the painter localizes, and
// `sig` is the STRUCTURAL identity (roster + my team), excluding the per-second
// clock / score / flag states, which the painter writes through elided slots.

import type { BgInfo } from '../../../world_api';

/** One expanded-board row (hover/tap on the strip). Raw class id: painter localizes. */
export interface BgBoardRow {
  pid: number;
  name: string;
  cls: string;
  team: number;
  me: boolean;
  dead: boolean;
  carrying: boolean;
  kills: number;
  deaths: number;
  captures: number;
  assists: number;
}

export interface BgScoreboardView {
  active: boolean;
  state: 'countdown' | 'active' | 'ended';
  myTeam: number;
  scoreCrimson: number;
  scoreAzure: number;
  capsToWin: number;
  /** Form-up seconds remaining ('countdown') or the frozen result screen's
   *  leave-in seconds ('ended'), else 0. */
  countdown: number;
  /** ended only: 'win' | 'loss' | 'draw' from MY side, else null. */
  result: 'win' | 'loss' | 'draw' | null;
  /** Remaining match time, split for the painter's clock key. */
  minutes: number;
  seconds: number;
  /** Flag states by home team (0 = Crimson, 1 = Azure). Deliberately state ONLY:
   *  the strip names no player (owner direction), so the carrier NAMES the wire
   *  ships on `flags[].carrierName` are not modelled here. The carrier is read on
   *  the board instead, off the roster's own `carrying` flag. */
  flagStates: ['home' | 'carried' | 'dropped', 'home' | 'carried' | 'dropped'];
  /** Both rosters in team order for the expanded board; stats ride elided
   *  writer slots (stable row identity = the structural sig). */
  board: BgBoardRow[];
  /** Seconds until my team's wave raises me (>0 only while I wait as a
   *  released ghost in the graveyard; a corpse shows nothing). */
  respawnIn: number;
  /** Structural identity: rebuild the skeleton only when this changes. */
  sig: string;
}

const INACTIVE: BgScoreboardView = {
  active: false,
  state: 'countdown',
  myTeam: 0,
  scoreCrimson: 0,
  scoreAzure: 0,
  capsToWin: 0,
  countdown: 0,
  result: null,
  minutes: 0,
  seconds: 0,
  flagStates: ['home', 'home'],
  board: [],
  respawnIn: 0,
  sig: 'off',
};

export function buildBgScoreboardView(info: BgInfo | null, myPid: number): BgScoreboardView {
  const m = info?.match ?? null;
  if (!m) return INACTIVE;
  const left = Math.max(0, Math.floor(m.timeLeft));
  const crimson = m.players.filter((p) => p.team === 0);
  const azure = m.players.filter((p) => p.team === 1);
  return {
    active: true,
    state: m.state,
    myTeam: m.myTeam,
    scoreCrimson: m.scores[0],
    scoreAzure: m.scores[1],
    capsToWin: m.capsToWin,
    countdown: Math.max(0, Math.ceil(m.countdown)),
    result:
      m.state !== 'ended'
        ? null
        : m.winner === null
          ? 'draw'
          : m.winner === m.myTeam
            ? 'win'
            : 'loss',
    minutes: Math.floor(left / 60),
    seconds: left % 60,
    flagStates: [m.flags[0].state, m.flags[1].state],
    board: [...crimson, ...azure].map((p) => ({
      pid: p.pid,
      name: p.name,
      cls: p.cls,
      team: p.team,
      me: p.pid === myPid,
      dead: p.dead,
      carrying: p.carrying,
      kills: p.kills,
      deaths: p.deaths,
      captures: p.captures,
      assists: p.assists,
    })),
    respawnIn: m.respawnIn,
    sig: `${m.myTeam}|${crimson.map((p) => p.pid).join(',')}|${azure.map((p) => p.pid).join(',')}`,
  };
}

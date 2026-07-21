// Pure, host-agnostic view model for the Vale Cup spectator BETTING banner + card
// (docs/prd/vale-cup.md). A walk-up spectator standing at the Sowfield with a
// match in its briefing window sees a compact banner (team vs team, live pool
// split, prize pool, countdown) that expands to a full card (per-team rosters
// with past form, the parimutuel pool with live odds, and the wager controls).
//
// Snapshot-driven from cupInfo.spectate (the sim only fills it for a nearby
// non-participant), so it self-heals on reconnect and never shows for a player
// who is actually in the match (they read the odds on the briefing overlay).
//
// DOM-free and i18n-free. Following the vale_cup_briefing_view split, the
// STRUCTURAL `sig` is the match identity + rosters, so the card skeleton rebuilds
// only when WHO is playing changes; the pools, odds, percentages, countdown, and
// my-wager all move every tick and ride the painter's elided writers instead.

import type { SportRole, VcNationId } from '../sim/types';
import type { CupInfo, VcBetRecord, VcPhase } from '../world_api';

/** One fighter's line on the betting card, with lifetime form for the punter. */
export interface VcupBettingPlayer {
  name: string;
  role: SportRole;
  bot: boolean;
  wins: number;
  losses: number;
}

export interface VcupBettingView {
  /** True only when I am a nearby spectator (cupInfo.spectate) and betting is relevant. */
  visible: boolean;
  matchId: number;
  phase: VcPhase;
  nationA: VcNationId;
  nationB: VcNationId;
  awayPalette: boolean;
  teamA: VcupBettingPlayer[];
  teamB: VcupBettingPlayer[];
  /** Live pool totals (copper). */
  poolA: number;
  poolB: number;
  prizePool: number;
  /** Share of the pool on each side, 0..100 (an empty pool reads 50/50). */
  pctA: number;
  pctB: number;
  /** Decimal payout per copper staked if that side wins (null when its pool is empty). */
  oddsA: number | null;
  oddsB: number | null;
  /** Betting still accepted (the briefing window is open). */
  open: boolean;
  /**
   * Stake controls locked per side: every control once the window closes, and
   * the OTHER side once I have backed one (a parimutuel wager is one-sided).
   * The painter applies these as real `disabled` attributes plus the `.locked`
   * visual, and its click handlers refuse a locked side.
   */
  lockA: boolean;
  lockB: boolean;
  /** Whole seconds left to wager (0 once the window closes). */
  countdown: number;
  bettors: number;
  /** My current wager. */
  myStake: number;
  mySide: 'A' | 'B' | null;
  /** My lifetime betting record (shown on the card). */
  record: VcBetRecord;
  /** Structural identity: the card skeleton rebuilds only when this changes. */
  sig: string;
}

const INACTIVE: VcupBettingView = {
  visible: false,
  matchId: 0,
  phase: 'over',
  nationA: 'vale',
  nationB: 'vale',
  awayPalette: false,
  teamA: [],
  teamB: [],
  poolA: 0,
  poolB: 0,
  prizePool: 0,
  pctA: 50,
  pctB: 50,
  oddsA: null,
  oddsB: null,
  open: false,
  lockA: true,
  lockB: true,
  countdown: 0,
  bettors: 0,
  myStake: 0,
  mySide: null,
  record: { wins: 0, losses: 0, net: 0 },
  sig: 'off',
};

function mapPlayers(
  players: { name: string; role: SportRole; bot: boolean; wins: number; losses: number }[],
): VcupBettingPlayer[] {
  return players.map((p) => ({
    name: p.name,
    role: p.role,
    bot: p.bot,
    wins: p.wins,
    losses: p.losses,
  }));
}

export function buildVcupBettingView(info: CupInfo | null): VcupBettingView {
  const m = info?.spectate ?? null;
  // Show through the whole pre-kickoff window and hold briefly into the match so
  // the "betting closed / good luck" state is legible; hide once play is well
  // underway or the match is over.
  if (!m || (m.phase !== 'briefing' && m.phase !== 'countdown')) return INACTIVE;

  const teamA = mapPlayers(m.teamA);
  const teamB = mapPlayers(m.teamB);
  const poolA = m.bets.poolA;
  const poolB = m.bets.poolB;
  const total = poolA + poolB;
  const pctA = total > 0 ? (poolA / total) * 100 : 50;
  const pctB = total > 0 ? 100 - pctA : 50;
  const oddsA = poolA > 0 ? total / poolA : null;
  const oddsB = poolB > 0 ? total / poolB : null;

  // Structural identity: match id, nations, and the roster skeleton (name/role/
  // bot per fighter). The live pool/odds/countdown/my-wager are excluded so they
  // ride elided writes rather than forcing a card rebuild every tick.
  const skel = (players: VcupBettingPlayer[]): unknown[] =>
    players.map((p) => [p.name, p.role, p.bot ? 1 : 0]);
  const sig = JSON.stringify([
    m.id,
    m.nationA,
    m.nationB,
    m.awayPalette ? 1 : 0,
    skel(teamA),
    skel(teamB),
  ]);

  return {
    visible: true,
    matchId: m.id,
    phase: m.phase,
    nationA: m.nationA,
    nationB: m.nationB,
    awayPalette: m.awayPalette,
    teamA,
    teamB,
    poolA,
    poolB,
    prizePool: total,
    pctA,
    pctB,
    oddsA,
    oddsB,
    open: m.bets.open,
    lockA: !m.bets.open || m.bets.mySide === 'B',
    lockB: !m.bets.open || m.bets.mySide === 'A',
    countdown: Math.max(0, Math.ceil(m.briefingLeft)),
    bettors: m.bets.count,
    myStake: m.bets.myStake,
    mySide: m.bets.mySide,
    record: info?.betRecord ?? { wins: 0, losses: 0, net: 0 },
    sig,
  };
}

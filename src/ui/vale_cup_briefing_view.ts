// Pure, host-agnostic view model for the Vale Cup pre-match BRIEFING overlay
// (docs/prd/vale-cup.md): the full-screen rules-and-kit card shown after
// matchmaking places and kits the fighters, while everyone readies up (bots
// auto-ready) before the kickoff countdown. Snapshot-driven from
// cupInfo.match while phase === 'briefing', so it self-heals on reconnect.
//
// DOM-free and i18n-free: the kit carries raw ability ids the painter localizes
// through tEntity(); nations/roles are raw ids resolved to flags/names in the
// painter. The split mirrors vale_cup_hud_view.ts precisely:
//  - the STRUCTURAL `sig` is the roster identity (nations, my side/role, and the
//    per-fighter pid/name/role/me/bot), so the skeleton rebuilds only when WHO
//    is on the team sheet (or my role) changes;
//  - the per-tick fields that move every second (`briefingLeft`), and the
//    per-fighter `ready` flags + my own `iAmReady`, are DELIBERATELY OUT of the
//    sig: the painter rides them through the PainterHost elided writers (a row
//    checkmark toggle, the countdown text, the ready-button state) so the
//    second-by-second tick never rebuilds DOM.

import { SPORT_KITS } from '../sim/content/vale_cup';
import type { SportRole, VcNationId } from '../sim/types';
import type { CupInfo } from '../world_api';

/** One fighter's line on the briefing team sheet (structure + live ready flag). */
export interface VcupBriefingPlayer {
  name: string;
  role: SportRole;
  me: boolean;
  bot: boolean;
  /** Live: ridden through an elided class toggle, NOT part of the structural sig. */
  ready: boolean;
}

export interface VcupBriefingView {
  /** True only while cupInfo.match.phase === 'briefing'. */
  visible: boolean;
  nationA: VcNationId;
  nationB: VcNationId;
  awayPalette: boolean;
  myTeam: 'A' | 'B' | null;
  /** The viewer's sport role (from the me===true roster entry), null if unresolved. */
  myRole: SportRole | null;
  /** The four abilities of my role kit (or the all-rounder kit when role is null). */
  kit: { abilityId: string }[];
  teamA: VcupBriefingPlayer[];
  teamB: VcupBriefingPlayer[];
  /** I have readied up: drives the ready-button state (elided, not in the sig). */
  iAmReady: boolean;
  /** Whole seconds until auto-ready (elided countdown text, not in the sig). */
  briefingLeft: number;
  /** Live spectator wager pools (copper), so fighters watch the odds come in
   *  during the ready-up window. Elided (not in the sig). */
  poolA: number;
  poolB: number;
  bettors: number;
  /** Team size (the larger side), for the "{n}v{n}" format line. */
  format: number;
  /** Structural identity: the skeleton rebuilds only when this changes. */
  sig: string;
}

const INACTIVE: VcupBriefingView = {
  visible: false,
  nationA: 'vale',
  nationB: 'vale',
  awayPalette: false,
  myTeam: null,
  myRole: null,
  kit: [],
  teamA: [],
  teamB: [],
  iAmReady: false,
  briefingLeft: 0,
  poolA: 0,
  poolB: 0,
  bettors: 0,
  format: 0,
  sig: 'off',
};

function mapPlayers(
  players: { name: string; role: SportRole; me: boolean; bot: boolean; ready: boolean }[],
): VcupBriefingPlayer[] {
  return players.map((p) => ({
    name: p.name,
    role: p.role,
    me: p.me,
    bot: p.bot,
    ready: p.ready,
  }));
}

export function buildVcupBriefingView(info: CupInfo | null): VcupBriefingView {
  const m = info?.match ?? null;
  if (!m || m.phase !== 'briefing') return INACTIVE;

  const teamA = mapPlayers(m.teamA);
  const teamB = mapPlayers(m.teamB);
  const mine = [...m.teamA, ...m.teamB].find((p) => p.me) ?? null;
  const myRole = mine ? mine.role : null;
  const kit = SPORT_KITS[myRole ?? 'allrounder'].map((abilityId) => ({ abilityId }));
  const format = Math.max(teamA.length, teamB.length);

  // Structural, language-independent identity: nations, my side/role, and the
  // per-fighter pid/name/role/me/bot. The moving parts (briefingLeft, every
  // `ready` flag, iAmReady) are intentionally excluded so they ride elided
  // writes instead of forcing a skeleton rebuild.
  const skel = (players: typeof m.teamA): unknown[] =>
    players.map((p) => [p.pid, p.name, p.role, p.me ? 1 : 0, p.bot ? 1 : 0]);
  const sig = JSON.stringify([
    m.nationA,
    m.nationB,
    m.awayPalette ? 1 : 0,
    m.team ?? '-',
    myRole ?? '-',
    format,
    skel(m.teamA),
    skel(m.teamB),
  ]);

  return {
    visible: true,
    nationA: m.nationA,
    nationB: m.nationB,
    awayPalette: m.awayPalette,
    myTeam: m.team,
    myRole,
    kit,
    teamA,
    teamB,
    iAmReady: m.iAmReady,
    briefingLeft: Math.max(0, Math.ceil(m.briefingLeft)),
    poolA: m.bets.poolA,
    poolB: m.bets.poolB,
    bettors: m.bets.count,
    format,
    sig,
  };
}

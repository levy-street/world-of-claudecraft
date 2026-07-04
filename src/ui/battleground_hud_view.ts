// Pure, host-agnostic view model for the Gravemarch in-match HUD: the top
// strip (kills : timer : kills, structure pips, Knell status), the countdown
// banner, the respawn overlay, and the aftermath outcome banner
// (docs/prd/battlegrounds.md "In-match HUD").
//
// Snapshot-driven from bgInfo.match so it self-heals on reconnect; one-shot
// juice (banners, audio, kill feed) rides the SimEvents in hud.handleEvents,
// never this model. DOM-free and i18n-free: raw seconds / team ids / counts
// only, formatted by the painter (battleground_hud.ts). Every sub-block
// carries a text-independent sig so the painter's innerHTML rebuilds stay
// change-only at the mediumHud cadence.

import type { BgMatchInfo, BgTeamId } from '../world_api';

/** One structure pip on the strip (per team, base-to-front order). */
export interface BgStructurePip {
  kind: 'warstone' | 'bulwark';
  alive: boolean;
}

export type BgKnellStatus =
  | { kind: 'up' }
  | { kind: 'spawns'; seconds: number }
  | { kind: 'silenced'; team: BgTeamId; seconds: number };

export interface BgHudStrip {
  myTeam: BgTeamId;
  killsA: number;
  killsB: number;
  /** Whole seconds until the match cap resolves it (counts DOWN). */
  timeLeft: number;
  pipsA: BgStructurePip[];
  pipsB: BgStructurePip[];
  knell: BgKnellStatus;
  sig: string;
}

export type BgHudView =
  | { kind: 'hidden' }
  | {
      kind: 'match';
      strip: BgHudStrip;
      /** Seconds until the fight starts; null outside the countdown state. */
      countdown: number | null;
      /** Seconds until I revive; null while alive (or before the fight). */
      respawn: number | null;
      /** Post-match outcome; null until the match resolves. */
      aftermath: { outcome: 'win' | 'loss' | 'draw'; returnIn: number } | null;
    };

const HIDDEN: BgHudView = { kind: 'hidden' };

/** Structure pips for one team: warstone first, then bulwarks in listed order. */
function teamPips(match: BgMatchInfo, team: BgTeamId): BgStructurePip[] {
  const own = match.structures.filter((s) => s.team === team);
  const warstones = own.filter((s) => s.kind === 'warstone');
  const bulwarks = own.filter((s) => s.kind === 'bulwark');
  return [...warstones, ...bulwarks].map((s) => ({ kind: s.kind, alive: s.alive }));
}

function knellStatus(match: BgMatchInfo): BgKnellStatus {
  if (match.knellSilencedBy !== null && match.knellSilencedFor > 0) {
    return { kind: 'silenced', team: match.knellSilencedBy, seconds: match.knellSilencedFor };
  }
  if (match.knell.alive) return { kind: 'up' };
  return { kind: 'spawns', seconds: match.knell.spawnsIn };
}

/**
 * Build the in-match HUD view from the snapshot. Returns the hidden state when
 * there is no match (bgInfo null, or not in a match). Reads only the
 * IWorld-mirrored BgMatchInfo, so the offline Sim and the online ClientWorld
 * mirror produce identical output.
 */
export function buildBgHudView(match: BgMatchInfo | null): BgHudView {
  if (!match) return HIDDEN;
  const pipsA = teamPips(match, 'A');
  const pipsB = teamPips(match, 'B');
  const knell = knellStatus(match);
  const pipSig = (pips: BgStructurePip[]) =>
    pips.map((p) => `${p.kind === 'warstone' ? 'w' : 'b'}${p.alive ? '1' : '0'}`).join('');
  const knellSig =
    knell.kind === 'up'
      ? 'u'
      : knell.kind === 'spawns'
        ? `s${knell.seconds}`
        : `x${knell.team}${knell.seconds}`;
  const strip: BgHudStrip = {
    myTeam: match.team,
    killsA: match.killsA,
    killsB: match.killsB,
    timeLeft: match.timeLeft,
    pipsA,
    pipsB,
    knell,
    sig: `${match.team}|${match.killsA}|${match.killsB}|${match.timeLeft}|${pipSig(pipsA)}|${pipSig(pipsB)}|${knellSig}`,
  };
  return {
    kind: 'match',
    strip,
    countdown: match.state === 'countdown' ? match.countdown : null,
    respawn: match.state === 'active' && match.down ? match.respawnIn : null,
    aftermath:
      match.state === 'over'
        ? { outcome: match.outcome ?? 'draw', returnIn: match.returnIn ?? 0 }
        : null,
  };
}

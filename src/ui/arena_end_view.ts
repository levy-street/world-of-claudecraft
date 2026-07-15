// Pure view-core for the end-of-match scoreboard ("VICTORY / DEFEAT" summation shown
// when a 1v1, 2v2, Fiesta, or Yumi battleground ends). DOM-free and i18n-free: it maps
// the arenaEnd event payload to a render model (the result, the sorted scoreboard rows
// tagged ally/enemy/me, the local rating change, and the honor earned); the painter
// localizes headers, class names, and the banner. Deterministic same-input-same-output.
import type { ArenaEndRow, ArenaFormat } from '../sim/types';

export interface ArenaEndInput {
  format: ArenaFormat;
  won: boolean;
  draw: boolean;
  ratingBefore: number;
  ratingAfter: number;
  scoreboard: ArenaEndRow[];
  myTeam: 'A' | 'B';
  honor: number;
  localPid: number;
}

export interface ArenaEndDisplayRow extends ArenaEndRow {
  me: boolean;
  ally: boolean;
}

export interface ArenaEndView {
  result: 'win' | 'loss' | 'draw';
  ranked: boolean; // 1v1 / 2v2 move the ladder; fiesta / yumi do not
  format: ArenaFormat;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number; // signed (may be 0 for unranked)
  honor: number;
  rows: ArenaEndDisplayRow[];
}

export function buildArenaEndView(input: ArenaEndInput): ArenaEndView {
  const ranked = input.format === '1v1' || input.format === '2v2';
  const rows: ArenaEndDisplayRow[] = input.scoreboard.map((r) => ({
    ...r,
    me: r.pid === input.localPid,
    ally: r.team === input.myTeam,
  }));
  // Your team first, then by damage done (descending), then a stable pid tiebreak so
  // the ordering is deterministic across hosts.
  rows.sort((a, b) => {
    if (a.ally !== b.ally) return a.ally ? -1 : 1;
    if (a.damageDone !== b.damageDone) return b.damageDone - a.damageDone;
    return a.pid - b.pid;
  });
  return {
    result: input.draw ? 'draw' : input.won ? 'win' : 'loss',
    ranked,
    format: input.format,
    ratingBefore: input.ratingBefore,
    ratingAfter: input.ratingAfter,
    ratingChange: input.ratingAfter - input.ratingBefore,
    honor: input.honor,
    rows,
  };
}

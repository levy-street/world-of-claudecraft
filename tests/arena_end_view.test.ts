import { describe, expect, it } from 'vitest';
import type { ArenaEndRow } from '../src/sim/types';
import { buildArenaEndView } from '../src/ui/arena_end_view';

const row = (over: Partial<ArenaEndRow> & { pid: number; team: 'A' | 'B' }): ArenaEndRow => ({
  name: `p${over.pid}`,
  cls: 'warrior',
  level: 20,
  killingBlows: 0,
  damageDone: 0,
  healingDone: 0,
  ratingBefore: 1500,
  ratingAfter: 1500,
  ratingChange: 0,
  ...over,
});

describe('buildArenaEndView', () => {
  it('marks ranked brackets and computes the local rating change', () => {
    const view = buildArenaEndView({
      format: '2v2',
      won: true,
      draw: false,
      ratingBefore: 1500,
      ratingAfter: 1516,
      scoreboard: [row({ pid: 1, team: 'A' }), row({ pid: 2, team: 'B' })],
      myTeam: 'A',
      honor: 40,
      localPid: 1,
    });
    expect(view.result).toBe('win');
    expect(view.ranked).toBe(true);
    expect(view.ratingChange).toBe(16);
    expect(view.honor).toBe(40);
  });

  it('treats fiesta and yumi as unranked', () => {
    for (const format of ['fiesta', 'yumi3', 'yumi5'] as const) {
      const view = buildArenaEndView({
        format,
        won: false,
        draw: false,
        ratingBefore: 1500,
        ratingAfter: 1500,
        scoreboard: [row({ pid: 1, team: 'A' })],
        myTeam: 'A',
        honor: 0,
        localPid: 1,
      });
      expect(view.ranked).toBe(false);
      expect(view.result).toBe('loss');
    }
  });

  it('reports a draw when neither side won', () => {
    const view = buildArenaEndView({
      format: '1v1',
      won: false,
      draw: true,
      ratingBefore: 1500,
      ratingAfter: 1500,
      scoreboard: [row({ pid: 1, team: 'A' }), row({ pid: 9, team: 'B' })],
      myTeam: 'A',
      honor: 0,
      localPid: 1,
    });
    expect(view.result).toBe('draw');
  });

  it('sorts allies before enemies, then by damage, tagging me/ally', () => {
    const view = buildArenaEndView({
      format: '2v2',
      won: true,
      draw: false,
      ratingBefore: 1500,
      ratingAfter: 1520,
      scoreboard: [
        row({ pid: 3, team: 'B', damageDone: 9000 }),
        row({ pid: 1, team: 'A', damageDone: 100 }),
        row({ pid: 2, team: 'A', damageDone: 5000 }),
        row({ pid: 4, team: 'B', damageDone: 200 }),
      ],
      myTeam: 'A',
      honor: 40,
      localPid: 1,
    });
    // Allies (team A) first, ordered by damage desc: pid 2 (5000) then pid 1 (100);
    // then enemies by damage desc: pid 3 (9000) then pid 4 (200).
    expect(view.rows.map((r) => r.pid)).toEqual([2, 1, 3, 4]);
    expect(view.rows.map((r) => r.ally)).toEqual([true, true, false, false]);
    expect(view.rows.find((r) => r.pid === 1)?.me).toBe(true);
    expect(view.rows.find((r) => r.pid === 2)?.me).toBe(false);
  });
});

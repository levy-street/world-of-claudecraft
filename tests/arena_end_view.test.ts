import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// Source-scan pins on the Hud wiring (the focus suites pin pure trap math only,
// so the per-modal contract is pinned here, next to the window's own tests):
// the end-screen modal must trap keyboard focus like every sibling modal, and
// release the trap on close. Same style as the fxTier() scan in
// tests/ui_tier_knobs.test.ts.
describe('arena end screen focus trap wiring (hud.ts source scan)', () => {
  const hudSrc = readFileSync(fileURLToPath(new URL('../src/ui/hud.ts', import.meta.url)), 'utf8');
  const methodBody = (name: string): string | null => {
    const m = hudSrc.match(
      new RegExp(`private\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*void\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`),
    );
    return m ? m[1] : null;
  };

  it('openArenaEndScreen opens the shared focus trap on the modal root', () => {
    const body = methodBody('openArenaEndScreen');
    expect(body).not.toBeNull();
    expect(body).toMatch(/this\.arenaEndTrap = this\.focusManager\.open\(/);
  });

  it('closeArenaEndScreen releases the trap (return-to-opener)', () => {
    const body = methodBody('closeArenaEndScreen');
    expect(body).not.toBeNull();
    expect(body).toMatch(/this\.arenaEndTrap\?\.release\(\)/);
    expect(body).toMatch(/this\.arenaEndTrap = null/);
  });

  it('the arenaStart event closes a scoreboard left open from the last match', () => {
    const m = hudSrc.match(/case 'arenaStart':([\s\S]*?)break;/);
    expect(m).not.toBeNull();
    expect(m?.[1] ?? '').toMatch(/this\.closeArenaEndScreen\(\)/);
  });
});

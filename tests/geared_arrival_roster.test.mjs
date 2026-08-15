import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GEARED_ARRIVAL_OBSERVER,
  GearedArrivalRoster,
  gearedArrivalPosition,
} from '../scripts/profiler/geared_arrival_roster.mjs';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

describe('geared arrival roster geometry', () => {
  it('places every fixture deterministically inside the observer interest area', () => {
    const first = Array.from({ length: 40 }, (_, index) => gearedArrivalPosition(index));
    const second = Array.from({ length: 40 }, (_, index) => gearedArrivalPosition(index));
    expect(second).toEqual(first);
    expect(
      first.every(
        (position) =>
          Math.hypot(
            position.x - GEARED_ARRIVAL_OBSERVER.x,
            position.z - GEARED_ARRIVAL_OBSERVER.z,
          ) <= 9,
      ),
    ).toBe(true);
    expect(new Set(first.map(({ x, z }) => `${x.toFixed(5)}:${z.toFixed(5)}`)).size).toBe(40);
  });

  it('bounds the roster and spreads registration identities across subnets', () => {
    const roster = new GearedArrivalRoster({
      serverUrl: 'http://127.0.0.1:8787',
      databaseUrl: 'postgres://user:password@127.0.0.1:5432/woc',
      count: 40,
      runId: 'fixture-run',
    });
    expect(new Set(roster.bots.map((bot) => bot.ip.split('.').slice(0, 3).join('.'))).size).toBe(
      40,
    );
    expect(roster.observerUsername).toBe('gpu_cam_ixturearun');
    expect(
      () =>
        new GearedArrivalRoster({
          serverUrl: 'http://127.0.0.1:8787',
          databaseUrl: 'postgres://user:password@127.0.0.1:5432/woc',
          count: 41,
        }),
    ).toThrow(/1 to 40/);
  });

  it('records the center the crowd was actually placed around', () => {
    const roster = new GearedArrivalRoster({
      serverUrl: 'http://127.0.0.1:8787',
      databaseUrl: 'postgres://user:password@127.0.0.1:5432/woc',
      count: 4,
      runId: 'fixture-run',
    });
    expect(roster.evidence().center).toEqual(GEARED_ARRIVAL_OBSERVER);

    // --observer moves the crowd, and fixture evidence naming the default spot
    // would describe a crowd that is not the one measured. placeAll is the
    // reachable half of the same assignment prepare() makes (prepare needs a
    // live server and database); the bots' own teleport goes over a socket, so
    // the placement each bot is given is captured instead.
    const moved = { x: 1_100, z: -240 };
    const placed = [];
    for (const bot of roster.bots) bot.place = (center) => placed.push(center);
    roster.placeAll(moved);

    expect(placed).toEqual([moved, moved, moved, moved]);
    expect(roster.evidence().center).toEqual(moved);
    expect(roster.evidence()).toMatchObject({ kind: 'geared-arrival-v1', count: 4 });
  });

  it('bounds direct database work and tears down exact fixture accounts', () => {
    // Full-line // comments are stripped first, the same rule
    // tests/loopback_guard.test.ts applies: this module explains its own
    // timeouts and teardown in prose right beside them, so a raw-text scan
    // would be satisfied by a commented-out or merely described setting.
    const source = codeWithoutLineComments(
      readFileSync(
        new URL('../scripts/profiler/geared_arrival_roster.mjs', import.meta.url),
        'utf8',
      ),
    );
    expect(source).toContain('connectionTimeoutMillis: 5_000');
    expect(source).toContain('query_timeout: DB_TIMEOUT_MS');
    expect(source).toContain('statement_timeout: DB_TIMEOUT_MS');
    expect(source).toContain("options: '-c lock_timeout=5000'");
    expect(source).toContain('INSERT INTO auth_tokens');
    expect(source).toContain('INSERT INTO characters (account_id, name, class, state, appearance)');
    expect(source).toContain("this.command({ cmd: 'set_helm', hidden: this.fixture.helmHidden })");
    expect(source).toContain('DELETE FROM accounts WHERE username = ANY($1::text[])');
  });
});

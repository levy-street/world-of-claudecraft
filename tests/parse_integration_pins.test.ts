// Cross-file pins for the parse subsystem's integration seams: things no unit
// test can see because they live in wiring, SQL text, compose files, or the
// sim's state-string vocabulary.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CENSUS_SQL, toCensusRecord } from '../server/parse/census_db';
import type { RiftInstanceOutcome } from '../src/sim/rift/types';
import type { ArenaMatch } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';

const root = path.join(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

describe('tick-loop hook ordering', () => {
  test('parseCapture.observe sits between the drain and routeEvents', () => {
    const source = read('server/game.ts');
    const drain = source.indexOf('const events = this.sim.tick();');
    const observe = source.indexOf('this.parseCapture.observe(events);');
    const route = source.indexOf('this.routeEvents(events);');

    expect(drain).toBeGreaterThan(-1);
    expect(observe).toBeGreaterThan(drain);
    expect(route).toBeGreaterThan(observe);
  });

  test('main.ts stops the parse subsystem before the chat log and pool', () => {
    const source = read('server/main.ts');
    const parseStop = source.indexOf('await game.parseCapture.stop();');
    const chatStop = source.indexOf('await game.chatLog.stop();');
    const poolEnd = source.indexOf('await pool.end();');

    expect(parseStop).toBeGreaterThan(-1);
    expect(chatStop).toBeGreaterThan(parseStop);
    expect(poolEnd).toBeGreaterThan(chatStop);
  });
});

describe('compose env passthrough', () => {
  test('every PARSE env var the subsystem reads is passed through compose', () => {
    const compose = read('docker-compose.yml');
    const flagSources = read('server/parse/flags.ts') + read('server/parse/build_version.ts');
    const keys = new Set(flagSources.match(/\b(?:PARSE_[A-Z_]+|WOC_BUILD_VERSION)\b/g) ?? []);

    expect(keys.size).toBeGreaterThanOrEqual(9);
    for (const key of keys) {
      expect(compose.includes(key), `${key} missing from docker-compose.yml`).toBe(true);
    }
  });
});

describe('census PII discipline (source pins)', () => {
  test('the census SQL never touches accounts or session network columns', () => {
    expect(CENSUS_SQL).not.toMatch(/\baccounts\b/i);
    expect(CENSUS_SQL).not.toMatch(/\.ip\b/);
    expect(CENSUS_SQL).not.toMatch(/\.ua\b/);
    expect(CENSUS_SQL).toContain('is_gm = FALSE');
    expect(CENSUS_SQL).toContain('LEAST(GREATEST(');
  });

  test('the census read is keyset-batched, projected, and rollup-aware', () => {
    // Review pins: batches on c.id (never one unbounded statement), projects
    // only the state sub-paths the mapper reads (never the whole blob), and
    // adds the play_session_totals rollup term so lifetime playtime survives
    // the retention sweep folding old sessions forward.
    expect(CENSUS_SQL).toContain('c.id > $2');
    expect(CENSUS_SQL).toContain('LIMIT $3');
    expect(CENSUS_SQL).toContain('jsonb_build_object');
    expect(CENSUS_SQL).not.toMatch(/c\.state[,\s]/);
    expect(CENSUS_SQL).toContain('play_session_totals');
  });

  test('the fight participant snapshot stays minimized (never the whole state)', () => {
    // The census side has its projection pinned above; this is the fight-side
    // equivalent: resolveParseParticipant must build the seven-field snapshot,
    // never ship serializeCharacter wholesale to the external service.
    const source = read('server/game.ts');
    const start = source.indexOf('private resolveParseParticipant');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n  }', start));
    expect(body).not.toMatch(/snapshot:\s*state\b/);
    for (const field of [
      'level:',
      'lifetimeXp:',
      'prestigeRank:',
      'talents:',
      'equipment:',
      'arena1v1Rating:',
      'arena2v2Rating:',
    ]) {
      expect(body, `snapshot field ${field}`).toContain(field);
    }
  });

  test('toCensusRecord allowlists counters and never forwards unknown ones', () => {
    const record = toCensusRecord(
      {
        id: '42',
        name: 'Auria',
        class: 'mage',
        level: 20,
        state: {
          lifetimeXp: 500000,
          prestigeRank: 2,
          talents: { spec: 'frost', ranks: { icy: 2 }, choices: {} },
          equipment: { chest: { id: 'tunic' } },
          deedStats: {
            counters: { kills: 10, damageDealt: 999, secretInternalCounter: 7 },
          },
          arena2v2Rating: 1540,
          arenaWins: 3,
        },
        created_at: '2026-01-01',
        last_login: '2026-08-04',
        playtime: '3600',
        sessions: 12,
      },
      '2026-08-05',
    );

    expect(record.counters).toEqual({ kills: 10, damageDealt: 999 });
    expect(record.spec).toBe('frost');
    expect(record.prestigeRank).toBe(2);
    expect(record.arena).toEqual({ wins: 3, rating_2v2: 1540 });
    expect(record.playtimeSeconds).toBe(3600);
    // vlevel never reports below the character's own level.
    expect(record.vlevel).toBeGreaterThanOrEqual(record.level);
  });
});

describe('sim state-string vocabulary (type-level pins)', () => {
  test('the segmenter literals are assignable to the sim state unions', () => {
    // A rename of any of these in the sim breaks this file at compile time,
    // which is exactly the loud failure the runtime segmenters cannot give.
    const arenaStates: ArenaMatch['state'][] = ['countdown', 'active', 'over'];
    const bgStates: BgMatch['state'][] = ['countdown', 'active', 'ended'];
    const riftOutcomes: RiftInstanceOutcome[] = ['active', 'won', 'lost', 'abandoned'];

    expect(arenaStates).toHaveLength(3);
    expect(bgStates).toHaveLength(3);
    expect(riftOutcomes).toHaveLength(4);
  });
});

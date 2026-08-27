// The ONE character UPDATE statement builder (server/character_save_statement.ts),
// extracted from server/db.ts at the Masterwrought phase 13 QA. Pins the three
// fence shapes as LITERAL SQL fragments (the load-bearing predicates, never the
// constant compared against itself) and the parameter order each fence takes,
// so a dropped or inverted fence predicate reds here rather than shipping as a
// silently unfenced write. The size signal's behavior is owned by
// tests/character_blob_size.test.ts; this file only proves the builder still
// reaches it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as blobSize from '../../server/character_blob_size';
import {
  CHARACTER_SAVE_LEASED_LINE,
  characterUpdateStatement,
} from '../../server/character_save_statement';

const STATE_JSON = '{"level":3}';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('characterUpdateStatement: the three fence shapes', () => {
  it('none: the unconditional write, three parameters, no lease predicate', () => {
    const stmt = characterUpdateStatement(7, 3, STATE_JSON, { kind: 'none' });
    expect(stmt.text).toBe(
      'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
    );
    expect(stmt.values).toEqual([7, 3, STATE_JSON]);
    expect(stmt.text).not.toContain('character_leases');
  });

  it('nonce: the live-session fence on holder AND nonce, in that parameter order', () => {
    const stmt = characterUpdateStatement(7, 3, STATE_JSON, {
      kind: 'nonce',
      holder: 'realm#proc',
      nonce: 'join-nonce',
    });
    expect(stmt.text).toContain('UPDATE characters SET level = $2, state = $3, updated_at = now()');
    expect(stmt.text).toContain('WHERE id = $1');
    expect(stmt.text).toContain('AND EXISTS (');
    expect(stmt.text).toContain('SELECT 1 FROM character_leases');
    expect(stmt.text).toContain('WHERE character_id = $1 AND holder = $4 AND nonce = $5');
    expect(stmt.text).not.toContain('NOT EXISTS');
    expect(stmt.values).toEqual([7, 3, STATE_JSON, 'realm#proc', 'join-nonce']);
  });

  it('unleased: the OFFLINE writer fence on the ABSENCE of a live lease', () => {
    // The phase 13 QA login-race closure: the handshake acquires the lease
    // before it re-reads the blob, so a fresh login that could hold the
    // pre-write state has a live lease by the time this runs, and the
    // predicate makes the UPDATE touch nothing. Expiry is the ONLY
    // qualifier: a crashed process's orphan lease blocks the write until it
    // lapses, and a holder or nonce match must NOT let a same-process write
    // through (the offline writer has no session of its own).
    const stmt = characterUpdateStatement(7, 3, STATE_JSON, { kind: 'unleased' });
    expect(stmt.text).toContain('UPDATE characters SET level = $2, state = $3, updated_at = now()');
    expect(stmt.text).toContain('WHERE id = $1');
    expect(stmt.text).toContain('AND NOT EXISTS (');
    expect(stmt.text).toContain('SELECT 1 FROM character_leases');
    expect(stmt.text).toContain('WHERE character_id = $1 AND expires_at > now()');
    expect(stmt.text).not.toContain('holder');
    expect(stmt.text).not.toContain('nonce');
    expect(stmt.values).toEqual([7, 3, STATE_JSON]);
  });

  it('every shape routes through the size signal chokepoint with the real byte length', () => {
    const report = vi.spyOn(blobSize, 'reportCharacterBlobSize').mockReturnValue(null);
    const wide = `{"pad":"${'é'.repeat(10)}"}`;
    for (const fence of [
      { kind: 'none' },
      { kind: 'nonce', holder: 'h', nonce: 'n' },
      { kind: 'unleased' },
    ] as const) {
      report.mockClear();
      characterUpdateStatement(9, 1, wide, fence);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][0]).toBe(9);
      expect(report.mock.calls[0][1]).toBe(Buffer.byteLength(wide, 'utf8'));
    }
  });

  it('pins the offline refusal line the endpoint surfaces', () => {
    expect(CHARACTER_SAVE_LEASED_LINE).toBe(
      'character holds a live session lease; kick them (or wait out the lease) and retry',
    );
  });
});

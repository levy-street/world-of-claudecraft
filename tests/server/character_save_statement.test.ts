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
  CHARACTER_SAVE_PREIMAGE_SELECT,
  CHARACTER_SAVE_ROW_LOCK_SQL,
  characterPreimageUpdateStatement,
  characterUpdateStatement,
  readCharacterSavePreimage,
  runFencedCharacterSave,
  runPreimageCharacterSave,
} from '../../server/character_save_statement';
import { REALM } from '../../server/realm';

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

  it('nonce: the live-session fence on holder, nonce AND an unexpired lease', () => {
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
    // qr-19-nonce-fence-expiry-term: the nonce fence gained the expiry qualifier
    // its unleased sibling already carried. A POSITIVE assertion, because the
    // holder/nonce toContain above stays green over an appended term and would
    // not catch a mutant that drops it. The statement built here is the nonce arm
    // alone, so this is decisive for that arm.
    expect(stmt.text).toContain('AND expires_at > now()');
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
    // The realm qualifier (the Phase 17 security review): the offline writer
    // takes a bare character id from an admin route, so the statement itself
    // refuses a cross-realm id rather than relying on caller pre-checks.
    const stmt = characterUpdateStatement(7, 3, STATE_JSON, { kind: 'unleased', realm: 'main' });
    expect(stmt.text).toContain('UPDATE characters SET level = $2, state = $3, updated_at = now()');
    expect(stmt.text).toContain('WHERE id = $1 AND realm = $4');
    expect(stmt.text).toContain('AND NOT EXISTS (');
    expect(stmt.text).toContain('SELECT 1 FROM character_leases');
    expect(stmt.text).toContain('WHERE character_id = $1 AND expires_at > now()');
    expect(stmt.text).not.toContain('holder');
    expect(stmt.text).not.toContain('nonce');
    expect(stmt.values).toEqual([7, 3, STATE_JSON, 'main']);
  });

  it('every shape routes through the size signal chokepoint with the real byte length', () => {
    const report = vi.spyOn(blobSize, 'reportCharacterBlobSize').mockReturnValue(null);
    const wide = `{"pad":"${'é'.repeat(10)}"}`;
    for (const fence of [
      { kind: 'none' },
      { kind: 'nonce', holder: 'h', nonce: 'n' },
      { kind: 'unleased', realm: 'main' },
    ] as const) {
      report.mockClear();
      characterUpdateStatement(9, 1, wide, fence);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][0]).toBe(9);
      expect(report.mock.calls[0][1]).toBe(Buffer.byteLength(wide, 'utf8'));
    }
    // The pre-image shape is a SECOND builder, so it has to reach the same
    // chokepoint or it would be the blind spot the chokepoint exists to prevent.
    for (const fence of [{ kind: 'none' }, { kind: 'nonce', holder: 'h', nonce: 'n' }] as const) {
      report.mockClear();
      characterPreimageUpdateStatement(9, 1, wide, fence);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][1]).toBe(Buffer.byteLength(wide, 'utf8'));
    }
  });

  it('an oversized blob queues its warn line off the builder call, never writes it inline', async () => {
    // The statement is built inside open transactions holding row locks, so
    // the line must not hit stdout synchronously; it rides the queue whose
    // shutdown drain is flushQueuedCharacterBlobWarnings (server/main.ts).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = vi.spyOn(blobSize, 'queueCharacterBlobWarning');
    const oversized = `{"pad":"${'x'.repeat(blobSize.CHARACTER_BLOB_WARN_BYTES + 1)}"}`;
    characterUpdateStatement(11, 1, oversized, { kind: 'none' });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(String(queue.mock.calls[0][0])).toContain('character 11');
    expect(warn).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('pins the offline refusal line the endpoint surfaces', () => {
    expect(CHARACTER_SAVE_LEASED_LINE).toBe(
      'character holds a live session lease; kick them (or wait out the lease) and retry',
    );
  });

  it('pins the live row-lock SQL: FOR NO KEY UPDATE, realm-scoped (D145)', () => {
    // The load-bearing lock the three direct live save paths take before the
    // fenced UPDATE (qr-19-live-nonce-fence-write-loss). Pinned as a literal so a
    // dropped realm predicate or a switch to the offline arm's FOR UPDATE (which
    // would stall every FK-child insert of the character on the ~33-saves-a-second
    // path, and buys nothing for the takeover case) reds here rather than shipping.
    // Its projection is the source journal's pre-image, read under the lock that
    // already had to be taken rather than as a second statement.
    expect(CHARACTER_SAVE_ROW_LOCK_SQL).toBe(
      'SELECT ' +
        CHARACTER_SAVE_PREIMAGE_SELECT +
        ' FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE',
    );
    expect(CHARACTER_SAVE_PREIMAGE_SELECT).toContain(
      "state->'bank' AS before_bank, state->'vault' AS before_vault",
    );
    // Exactly two correlated PK probes ride the existing locked-row query. They
    // use the row's actual realm, and add no statement or round trip.
    expect(CHARACTER_SAVE_PREIMAGE_SELECT.match(/EXISTS [(]/g)).toHaveLength(2);
    expect(CHARACTER_SAVE_PREIMAGE_SELECT.match(/FROM material_source_containers/g)).toHaveLength(
      2,
    );
    expect(CHARACTER_SAVE_PREIMAGE_SELECT).toContain(
      'WHERE material_source_containers.realm = characters.realm',
    );
    expect(
      CHARACTER_SAVE_PREIMAGE_SELECT.match(
        /material_source_containers[.]realm = characters[.]realm/g,
      ),
    ).toHaveLength(2);
    expect(CHARACTER_SAVE_PREIMAGE_SELECT).toContain(
      "AND material_source_containers.container = 'personal'",
    );
    expect(CHARACTER_SAVE_PREIMAGE_SELECT).toContain(
      'AND material_source_containers.owner_id = characters.id',
    );
    expect(
      CHARACTER_SAVE_PREIMAGE_SELECT.match(
        /material_source_containers[.]owner_id = characters[.]id/g,
      ),
    ).toHaveLength(2);
    expect(CHARACTER_SAVE_PREIMAGE_SELECT).toContain(
      "AND material_source_containers.container = 'vault'",
    );
  });
});

describe('characterPreimageUpdateStatement: the single-statement pre-image save', () => {
  it('locks in a MATERIALIZED CTE, joins it, and returns subtrees and anchor proofs', () => {
    const stmt = characterPreimageUpdateStatement(7, 3, STATE_JSON, { kind: 'none' });
    // MATERIALIZED is the load-bearing word: without it the locking read can be
    // folded into the UPDATE's own scan and stops being a separate locked read.
    expect(stmt.text).toContain('WITH previous AS MATERIALIZED (');
    expect(stmt.text).toContain("SELECT id, state->'bank' AS before_bank");
    expect(stmt.text).toContain('FROM characters WHERE id = $1 FOR NO KEY UPDATE');
    expect(stmt.text).toContain('UPDATE characters AS c');
    expect(stmt.text).toContain('SET level = $2, state = $3, updated_at = now()');
    expect(stmt.text).toContain('WHERE c.id = previous.id');
    expect(stmt.text).toContain('RETURNING previous.before_bank AS before_bank');
    expect(stmt.text).toContain('previous.before_vault AS before_vault');
    expect(stmt.text).toContain('previous.personal_anchor_exists AS personal_anchor_exists');
    expect(stmt.text).toContain('previous.vault_anchor_exists AS vault_anchor_exists');
    // The unconditional write keeps its exact row scope: id alone, no fence.
    expect(stmt.text).not.toContain('character_leases');
    expect(stmt.values).toEqual([7, 3, STATE_JSON]);
  });

  it('carries the SAME nonce fence as the plain statement, values and all', () => {
    const stmt = characterPreimageUpdateStatement(7, 3, STATE_JSON, {
      kind: 'nonce',
      holder: 'realm#proc',
      nonce: 'join-nonce',
    });
    expect(stmt.text).toContain('AND EXISTS (');
    expect(stmt.text).toContain('SELECT 1 FROM character_leases');
    expect(stmt.text).toContain('WHERE character_id = $1 AND holder = $4 AND nonce = $5');
    expect(stmt.text).toContain('AND expires_at > now()');
    expect(stmt.text).not.toContain('NOT EXISTS');
    expect(stmt.values).toEqual([7, 3, STATE_JSON, 'realm#proc', 'join-nonce']);
  });

  it('REFUSES the offline unleased fence rather than silently re-fencing it', () => {
    // The offline writers own their own FOR UPDATE lock and their absence-of-lease
    // fence; routing one here would swap the exclusion it depends on.
    expect(() =>
      characterPreimageUpdateStatement(7, 3, STATE_JSON, { kind: 'unleased', realm: 'main' }),
    ).toThrow('unleased offline fence');
  });
});

describe('the two runners: statement count and where the pre-image comes from', () => {
  // Each answer is distinct, so a runner that read the WRONG statement's row
  // (the update's instead of the lock's) fails rather than coincidentally passing.
  const LOCK_ROW = {
    before_bank: { inventory: ['locked'] },
    before_vault: null,
    personal_anchor_exists: true,
    vault_anchor_exists: false,
  };
  const UPDATE_ROW = {
    before_bank: { inventory: ['returned'] },
    before_vault: null,
    personal_anchor_exists: false,
    vault_anchor_exists: true,
  };

  function fakeTx(rowsPerCall: Record<string, unknown>[][]) {
    const calls: { text: string; values: unknown[] }[] = [];
    let call = 0;
    return {
      calls,
      query: (text: string, values?: unknown[]) => {
        calls.push({ text, values: values ?? [] });
        const rows = rowsPerCall[call++] ?? [];
        return Promise.resolve({ rows, rowCount: rows.length } as never);
      },
    };
  }

  it('nonce: locks FIRST in its own statement and takes the pre-image from the LOCK', async () => {
    const tx = fakeTx([[LOCK_ROW], [UPDATE_ROW]]);
    const saved = await runFencedCharacterSave(tx, 7, 3, STATE_JSON, {
      kind: 'nonce',
      holder: 'h',
      nonce: 'n',
    });
    expect(tx.calls).toHaveLength(2);
    expect(tx.calls[0].text).toBe(CHARACTER_SAVE_ROW_LOCK_SQL);
    expect(tx.calls[0].values).toEqual([7, REALM]);
    expect(tx.calls[1].text).toContain('UPDATE characters SET');
    expect(tx.calls[1].text).not.toContain('MATERIALIZED');
    expect(saved.before).toEqual({
      bank: { inventory: ['locked'] },
      vault: null,
      personalAnchorExists: true,
      vaultAnchorExists: false,
    });
    expect(saved.result.rowCount).toBe(1);
  });

  it('none: ONE statement, pre-image from its own RETURNING', async () => {
    const tx = fakeTx([[UPDATE_ROW]]);
    const saved = await runFencedCharacterSave(tx, 7, 3, STATE_JSON, { kind: 'none' });
    expect(tx.calls).toHaveLength(1);
    expect(tx.calls[0].text).toContain('MATERIALIZED');
    expect(saved.before).toEqual({
      bank: { inventory: ['returned'] },
      vault: null,
      personalAnchorExists: false,
      vaultAnchorExists: true,
    });
  });

  it('a fence miss returns zero rows AND no pre-image, never an empty one', async () => {
    const tx = fakeTx([[]]);
    const saved = await runPreimageCharacterSave(tx, 7, 3, STATE_JSON, {
      kind: 'nonce',
      holder: 'h',
      nonce: 'n',
    });
    expect(tx.calls).toHaveLength(1);
    expect(saved.result.rowCount).toBe(0);
    expect(saved.before).toBeNull();
  });

  it('refuses to run an offline unleased fence through either runner', async () => {
    const tx = fakeTx([]);
    const fence = { kind: 'unleased', realm: 'main' } as const;
    await expect(runFencedCharacterSave(tx, 7, 3, STATE_JSON, fence)).rejects.toThrow(
      'unleased offline fence',
    );
    await expect(runPreimageCharacterSave(tx, 7, 3, STATE_JSON, fence)).rejects.toThrow(
      'unleased offline fence',
    );
    expect(tx.calls).toHaveLength(0);
  });
});

describe('readCharacterSavePreimage: what counts as a pre-image', () => {
  it('reads a row that answers the projection, SQL nulls included', () => {
    expect(readCharacterSavePreimage({ before_bank: null, before_vault: null })).toEqual({
      bank: null,
      vault: null,
      personalAnchorExists: false,
      vaultAnchorExists: false,
    });
    const bank = { inventory: [] };
    expect(
      readCharacterSavePreimage({
        before_bank: bank,
        before_vault: undefined,
        personal_anchor_exists: true,
        vault_anchor_exists: true,
      }),
    ).toEqual({ bank, vault: undefined, personalAnchorExists: true, vaultAnchorExists: true });
  });

  it('trusts only literal true anchor proofs; absent, null and malformed values are false', () => {
    for (const value of [undefined, null, false, 1, 'true', {}, []]) {
      expect(
        readCharacterSavePreimage({
          before_bank: null,
          before_vault: null,
          personal_anchor_exists: value,
          vault_anchor_exists: value,
        }),
      ).toEqual({
        bank: null,
        vault: null,
        personalAnchorExists: false,
        vaultAnchorExists: false,
      });
    }
  });

  it('reads a MISSING row, or one that does not answer, as no pre-image at all', () => {
    // Never an empty container: an invented empty opening would journal a whole
    // bank as a deposit the first time a fenced save landed.
    expect(readCharacterSavePreimage(undefined)).toBeNull();
    expect(readCharacterSavePreimage({})).toBeNull();
    expect(readCharacterSavePreimage({ before_bank: null })).toBeNull();
    expect(readCharacterSavePreimage({ before_vault: null })).toBeNull();
  });
});

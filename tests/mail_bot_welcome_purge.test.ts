// The bot welcome letter purge (issue #3560): the pure book transform behind
// scripts/migrate_mail_bot_welcome_purge.ts. A ravenpost_welcome letter
// survives only when its recipient resolves to a real character, by the
// (id, current name) pair or the legacy name-key; everything that is not a
// welcome letter is untouchable regardless of addressee.

import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  type CharacterRow,
  type MailBotWelcomePurgeRuntime,
  type MailLetterLike,
  parseArgs,
  purgeBotWelcomeLetters,
  runMailBotWelcomePurgeMigration,
  WELCOME_LETTER_ID,
} from '../scripts/mail_bot_welcome_purge_migration';

const CHARACTERS: CharacterRow[] = [
  { id: 10774, name: 'PhoneBoy' },
  { id: 20001, name: 'Old Hobb' },
];

function welcome(recipientKey: string, recipientName: string): MailLetterLike {
  return { id: 1, letterId: WELCOME_LETTER_ID, kind: 'system', recipientKey, recipientName };
}

describe('purgeBotWelcomeLetters', () => {
  it('removes a welcome letter addressed to a reaped bot pid', () => {
    const book = { mail: [welcome('987654', 'Reeve Marlow')], nextMailId: 5 };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.changed).toBe(true);
    expect(result.removed).toBe(1);
    expect((result.value.mail as unknown[]).length).toBe(0);
    // The rest of the book shape rides along unchanged.
    expect(result.value.nextMailId).toBe(5);
  });

  it('keeps a real character welcome letter (id and current name match)', () => {
    const book = { mail: [welcome('10774', 'PhoneBoy')] };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.changed).toBe(false);
    expect(result.kept).toBe(1);
    expect(result.value).toBe(book);
  });

  it('removes a bot letter whose pid collides with a real character id', () => {
    // The bot letter is keyed to character 10774 but carries the bot roster
    // name, so the pair mismatch identifies it even though the key is live.
    const book = { mail: [welcome('10774', 'Tally Cooper'), welcome('10774', 'PhoneBoy')] };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.removed).toBe(1);
    expect((result.value.mail as MailLetterLike[])[0].recipientName).toBe('PhoneBoy');
  });

  it('keeps a legacy name-keyed welcome letter', () => {
    const book = { mail: [welcome('PhoneBoy', 'PhoneBoy')] };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.changed).toBe(false);
    expect(result.kept).toBe(1);
  });

  it('keeps a welcome letter for a real character who shares a bot roster name', () => {
    const book = { mail: [welcome('20001', 'Old Hobb')] };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.changed).toBe(false);
    expect(result.kept).toBe(1);
  });

  it('never touches non-welcome letters, whoever they are addressed to', () => {
    const book = {
      mail: [
        {
          id: 2,
          letterId: 'letter_q_wolves',
          kind: 'npc',
          recipientKey: '555',
          recipientName: 'Gone',
        },
        { id: 3, kind: 'player', recipientKey: '987654', recipientName: 'Reeve Marlow' },
      ],
    };
    const result = purgeBotWelcomeLetters(book, CHARACTERS);
    expect(result.changed).toBe(false);
    expect(result.kept).toBe(2);
  });

  it('handles a malformed book without throwing', () => {
    const result = purgeBotWelcomeLetters({ mail: undefined }, CHARACTERS);
    expect(result.changed).toBe(false);
    expect(result.removed).toBe(0);
  });
});

describe('parseArgs', () => {
  it('parses both realm forms and apply', () => {
    expect(parseArgs([])).toEqual({ apply: false, realm: undefined });
    expect(parseArgs(['--apply', '--realm', 'Claudemoon'])).toEqual({
      apply: true,
      realm: 'Claudemoon',
    });
    expect(parseArgs(['--realm=Claudemoon'])).toEqual({ apply: false, realm: 'Claudemoon' });
  });

  it('throws instead of widening a destructive run on a valueless --realm', () => {
    // A bare trailing --realm used to silently mean all realms; --realm --apply
    // used to consume the flag as the realm name and silently disable apply.
    expect(() => parseArgs(['--apply', '--realm'])).toThrow('--realm requires a realm name');
    expect(() => parseArgs(['--realm', '--apply'])).toThrow('--realm requires a realm name');
    expect(() => parseArgs(['--realm='])).toThrow('--realm requires a realm name');
    expect(() => parseArgs(['--wat'])).toThrow('Unknown argument');
  });
});

// ---------------------------------------------------------------------------
// Runner arm: fake pinned-client pool (the rift forge rollback harness idiom).
// ---------------------------------------------------------------------------

interface HarnessOptions {
  liveLeases?: string;
  mailRows?: Array<{ key: string; data: unknown; updated_at?: string; age_seconds?: number }>;
  characters?: CharacterRow[];
  updateRowCount?: number;
}

function queryResult(rows: unknown[] = []) {
  return { rows, rowCount: rows.length };
}

const STALE_ROW = { updated_at: '2026-08-22 01:00:00.123456+00', age_seconds: 3600, bytes: 4096 };

function purgeHarness(options: HarnessOptions = {}) {
  const statements: string[] = [];
  const querySpy = vi.fn(async (text: string, _values?: unknown[]) => {
    statements.push(text);
    if (text.includes('age_seconds')) {
      return queryResult((options.mailRows ?? []).map((r) => ({ ...STALE_ROW, ...r })));
    }
    if (text.includes('count(*)') && text.includes('character_leases')) {
      return queryResult([{ count: options.liveLeases ?? '0' }]);
    }
    if (text.includes('SELECT id, name FROM characters')) {
      return queryResult(options.characters ?? []);
    }
    if (text.startsWith('UPDATE world_state')) {
      return { rows: [], rowCount: options.updateRowCount ?? 1 };
    }
    return queryResult();
  });
  const release = vi.fn();
  const client = {
    query: querySpy as unknown as PoolClient['query'],
    release,
  } as unknown as PoolClient;
  const poolQuery = vi.fn(() => {
    throw new Error('runner must not use pool.query: the transaction needs one pinned client');
  });
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    query: poolQuery,
  } as unknown as Pool;
  const runtime: MailBotWelcomePurgeRuntime = {
    loadEnvFile: vi.fn(),
    databaseUrl: () => 'postgres://unit.test/mail',
    createPool: vi.fn(() => pool),
  };
  return { statements, querySpy, release, runtime };
}

const BOT_BOOK = {
  key: 'mail:Claudemoon',
  data: { mail: [welcome('987654', 'Reeve Marlow'), welcome('10774', 'PhoneBoy')], nextMailId: 9 },
};

describe('runMailBotWelcomePurgeMigration', () => {
  it('dry run rolls back, takes no lease lock, and never writes', async () => {
    const h = purgeHarness({ mailRows: [BOT_BOOK], characters: CHARACTERS });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runMailBotWelcomePurgeMigration([], h.runtime);
    } finally {
      log.mockRestore();
    }
    expect(h.statements[0]).toBe('BEGIN');
    expect(h.statements.at(-1)).toBe('ROLLBACK');
    expect(h.statements.some((s) => s.startsWith('UPDATE world_state'))).toBe(false);
    expect(h.statements.some((s) => s.startsWith('LOCK TABLE'))).toBe(false);
    expect(h.release).toHaveBeenCalled();
  });

  it('apply locks leases, reaps expired ones, writes the purged row, and commits', async () => {
    const h = purgeHarness({ mailRows: [BOT_BOOK], characters: CHARACTERS });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runMailBotWelcomePurgeMigration(['--apply'], h.runtime);
    } finally {
      log.mockRestore();
    }
    expect(h.statements[0]).toBe('BEGIN');
    expect(h.statements[1]).toBe('LOCK TABLE character_leases IN SHARE MODE');
    expect(h.statements[2]).toBe('DELETE FROM character_leases WHERE expires_at <= now()');
    expect(h.statements.some((s) => s.startsWith('UPDATE world_state'))).toBe(true);
    expect(h.statements.at(-1)).toBe('COMMIT');
    // The written blob keeps the real letter and the book shape.
    const update = h.querySpy.mock.calls.find(([text]) => text.startsWith('UPDATE world_state'));
    if (!update) throw new Error('no world_state UPDATE was issued');
    const written = JSON.parse((update[1] as string[])[0]);
    expect(written.mail).toHaveLength(1);
    expect(written.mail[0].recipientName).toBe('PhoneBoy');
    expect(written.nextMailId).toBe(9);
    // The CAS predicate itself is load-bearing SQL for a destructive prod
    // script: pin the literal and that $3 is the exact updated_at the SELECT
    // returned, so dropping either turns this red (proven by mutation).
    expect(update[0]).toContain('AND updated_at::text = $3');
    expect((update[1] as string[])[2]).toBe(STALE_ROW.updated_at);
  });

  it('apply refuses while the realm holds a live lease and rolls back', async () => {
    const h = purgeHarness({ mailRows: [BOT_BOOK], characters: CHARACTERS, liveLeases: '1' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMailBotWelcomePurgeMigration(['--apply'], h.runtime)).rejects.toThrow(
        'still holds live character leases',
      );
    } finally {
      log.mockRestore();
    }
    expect(h.statements.at(-1)).toBe('ROLLBACK');
    expect(h.statements.some((s) => s.startsWith('UPDATE world_state'))).toBe(false);
  });

  it('apply refuses a mail row fresher than the autosave window (idle server still running)', async () => {
    // Character leases cannot prove the stop: an idle realm holds zero leases
    // while flushPeriodicSaves still rewrites the book every 30s. Freshness can.
    const h = purgeHarness({
      mailRows: [{ ...BOT_BOOK, age_seconds: 12 }],
      characters: CHARACTERS,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMailBotWelcomePurgeMigration(['--apply'], h.runtime)).rejects.toThrow(
        'game server is still running',
      );
    } finally {
      log.mockRestore();
    }
    expect(h.statements.some((s) => s.startsWith('UPDATE world_state'))).toBe(false);
    expect(h.statements.at(-1)).toBe('ROLLBACK');
  });

  it('apply aborts loudly when the CAS write misses (concurrent autosave)', async () => {
    const h = purgeHarness({ mailRows: [BOT_BOOK], characters: CHARACTERS, updateRowCount: 0 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMailBotWelcomePurgeMigration(['--apply'], h.runtime)).rejects.toThrow(
        'Concurrent write detected',
      );
    } finally {
      log.mockRestore();
    }
    expect(h.statements.at(-1)).toBe('ROLLBACK');
  });

  it('a --realm that matches no mail row throws instead of reporting empty success', async () => {
    const h = purgeHarness({ mailRows: [] });
    await expect(
      runMailBotWelcomePurgeMigration(['--realm', 'Cluademoon'], h.runtime),
    ).rejects.toThrow('No mail row exists for realm "Cluademoon"');
  });
});

// Unit test for the partitioned Ravenpost mail backfill
// (server/mail_partition_backfill.ts, #3561). Postgres is a plain recording
// fake, the same idiom as tests/server/market_backfill.test.ts: every call
// records { text, params } and returns a scripted rows array, so every path
// is deterministic with no live database. Unlike the market backfill, this
// migration is single-realm (mail was always realm-scoped) so there is no
// cross-realm seller resolution to script.
import { describe, expect, it, vi } from 'vitest';
import {
  mailPartitionMarkerKey,
  mailRecipientKey,
  mailStateKey,
  partitionMailByRecipient,
  runMailPartitionBackfill,
  verifyMailPartitionConservation,
} from '../../server/mail_partition_backfill';
import type { MailSave } from '../../src/sim/sim';

type Letter = MailSave['mail'][number];

function mkLetter(over: Partial<Letter> = {}): Letter {
  return {
    id: 1,
    recipientKey: 'alice',
    recipientName: 'Alice',
    senderName: 'System',
    kind: 'system',
    subject: 'Hi',
    body: '',
    copper: 0,
    items: [],
    deliverIn: 0,
    secondsLeft: -1,
    read: false,
    ...over,
  };
}

interface ClientScript {
  marker?: unknown[];
  legacy?: unknown[];
}

function makeClient(script: ClientScript = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = vi.fn((text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    const p = params ?? [];
    calls.push({ text, params: p });
    if (text.includes('FOR UPDATE')) return Promise.resolve({ rows: script.legacy ?? [] });
    if (text.startsWith('SELECT') && text.includes('world_state')) {
      return Promise.resolve({ rows: script.marker ?? [] });
    }
    return Promise.resolve({ rows: [] }); // INSERT ... world_state
  });
  return { query, calls };
}

describe('key builders', () => {
  it('mailStateKey and mailRecipientKey are realm-scoped and never collide', () => {
    expect(mailStateKey('Home')).toBe('mail:Home');
    expect(mailRecipientKey('Home', 'alice')).toBe('mail:Home:r:alice');
    expect(mailRecipientKey('Home', 'alice')).not.toBe(mailRecipientKey('Away', 'alice'));
    expect(mailRecipientKey('Home', 'alice')).not.toBe(mailStateKey('Home'));
  });

  it('mailPartitionMarkerKey is realm-scoped: one realm backfilling never marks another done', () => {
    expect(mailPartitionMarkerKey('Home')).toBe('mail_partition_done:Home');
    expect(mailPartitionMarkerKey('Home')).not.toBe(mailPartitionMarkerKey('Away'));
  });
});

describe('partitionMailByRecipient', () => {
  it('groups letters by recipientKey, preserving book order within each bucket', () => {
    const a1 = mkLetter({ id: 1, recipientKey: 'alice' });
    const b1 = mkLetter({ id: 2, recipientKey: 'bob' });
    const a2 = mkLetter({ id: 3, recipientKey: 'alice' });
    const plan = partitionMailByRecipient([a1, b1, a2]);
    expect([...plan.byRecipient.keys()]).toEqual(['alice', 'bob']);
    expect(plan.byRecipient.get('alice')).toEqual([a1, a2]);
    expect(plan.byRecipient.get('bob')).toEqual([b1]);
    expect(plan.kept).toEqual([a1, b1, a2]);
    expect(plan.droppedCount).toBe(0);
  });

  it('drops a letter with a non-string recipientKey (a corrupt row) rather than throwing, and counts it', () => {
    const good = mkLetter({ id: 1, recipientKey: 'alice' });
    const corrupt = { ...mkLetter({ id: 2 }), recipientKey: null } as unknown as Letter;
    const plan = partitionMailByRecipient([good, corrupt]);
    expect([...plan.byRecipient.keys()]).toEqual(['alice']);
    expect(plan.byRecipient.get('alice')).toEqual([good]);
    expect(plan.kept).toEqual([good]);
    expect(plan.droppedCount).toBe(1);
  });

  it('an empty or undefined mail array yields an empty plan', () => {
    expect(partitionMailByRecipient([]).byRecipient.size).toBe(0);
    expect(partitionMailByRecipient(undefined as unknown as Letter[]).byRecipient.size).toBe(0);
  });
});

describe('verifyMailPartitionConservation', () => {
  it('passes when the partition union exactly reproduces the kept letters', () => {
    const a = mkLetter({
      id: 1,
      recipientKey: 'alice',
      copper: 50,
      items: [{ itemId: 'x', count: 2 }],
    });
    const b = mkLetter({ id: 2, recipientKey: 'bob', copper: 10 });
    const plan = partitionMailByRecipient([a, b]);
    const result = verifyMailPartitionConservation(plan.kept, plan.byRecipient);
    expect(result.ok).toBe(true);
    expect(result.expected).toEqual({ letterCount: 2, escrowCopper: 60, escrowItemCount: 2 });
    expect(result.actual).toEqual(result.expected);
  });

  it('fails when a partition bucket is missing a letter the kept list has', () => {
    const a = mkLetter({ id: 1, recipientKey: 'alice', copper: 50 });
    const plan = partitionMailByRecipient([a]);
    const tampered = new Map(plan.byRecipient);
    tampered.set('alice', []); // simulate a dropped bucket entry
    const result = verifyMailPartitionConservation(plan.kept, tampered);
    expect(result.ok).toBe(false);
    expect(result.actual.letterCount).toBe(0);
    expect(result.expected.letterCount).toBe(1);
  });
});

describe('runMailPartitionBackfill', () => {
  it('is a no-op issuing exactly one query when this realm marker already exists', async () => {
    const client = makeClient({ marker: [{ data: { legacyRowFound: true } }] });
    const res = await runMailPartitionBackfill({ client, realm: 'Home' });

    expect(res).toEqual({
      ran: false,
      legacyRowFound: false,
      recipientCount: 0,
      letterCount: 0,
      droppedCount: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.calls[0].params[0]).toBe('mail_partition_done:Home');
  });

  it("claims THIS realm's legacy row FOR UPDATE, never another realm's", async () => {
    const legacy: MailSave = { mail: [mkLetter()], nextMailId: 2 };
    const client = makeClient({ legacy: [{ data: legacy }] });
    await runMailPartitionBackfill({ client, realm: 'Home', log: () => {} });

    const forUpdate = client.calls.find((c) => c.text.includes('FOR UPDATE'));
    expect(forUpdate).toBeDefined();
    expect(forUpdate?.text).toContain('SELECT data FROM world_state');
    expect(forUpdate?.params[0]).toBe('mail:Home');
  });

  it('records the marker with legacyRowFound false and writes no partition row on a fresh realm', async () => {
    const client = makeClient({ marker: [], legacy: [] });
    const res = await runMailPartitionBackfill({ client, realm: 'Home', log: () => {} });

    expect(res).toEqual({
      ran: true,
      legacyRowFound: false,
      recipientCount: 0,
      letterCount: 0,
      droppedCount: 0,
    });
    const partitionUpserts = client.calls.filter((c) => /UNNEST/i.test(c.text));
    expect(partitionUpserts).toHaveLength(0);
    const marker = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === 'mail_partition_done:Home',
    );
    expect(marker).toBeDefined();
    expect(JSON.parse(String(marker?.params[1]))).toEqual({
      legacyRowFound: false,
      recipientCount: 0,
      letterCount: 0,
      droppedCount: 0,
    });
  });

  it('partitions the legacy row per recipient and records accurate counts in the marker', async () => {
    const legacy: MailSave = {
      mail: [
        mkLetter({ id: 1, recipientKey: 'alice' }),
        mkLetter({ id: 2, recipientKey: 'bob' }),
        mkLetter({ id: 3, recipientKey: 'alice' }),
      ],
      nextMailId: 4,
    };
    const client = makeClient({ legacy: [{ data: legacy }] });
    const res = await runMailPartitionBackfill({ client, realm: 'Home', log: () => {} });

    expect(res).toMatchObject({
      ran: true,
      legacyRowFound: true,
      recipientCount: 2,
      letterCount: 3,
      droppedCount: 0,
    });
    // ONE batched multi-row UPSERT, never one query per recipient.
    const partitionUpserts = client.calls.filter((c) => /UNNEST/i.test(c.text));
    expect(partitionUpserts).toHaveLength(1);
    const [keys, datas] = partitionUpserts[0].params as [string[], string[]];
    expect([...keys].sort()).toEqual(['mail:Home:r:alice', 'mail:Home:r:bob']);
    const aliceRow = JSON.parse(datas[keys.indexOf('mail:Home:r:alice')]) as { mail: Letter[] };
    expect(aliceRow.mail.map((m) => m.id)).toEqual([1, 3]);
    const bobRow = JSON.parse(datas[keys.indexOf('mail:Home:r:bob')]) as { mail: Letter[] };
    expect(bobRow.mail.map((m) => m.id)).toEqual([2]);
    // Legacy retention: no DELETE anywhere, and the legacy key is never
    // re-written by this migration (the rollback artifact stays byte-exact).
    for (const c of client.calls) {
      expect(c.text).not.toContain('DELETE');
      if (c.text.startsWith('INSERT') && !/UNNEST/i.test(c.text)) {
        expect(c.params[0]).not.toBe('mail:Home');
      }
    }
  });

  it('resolves to the SAME key format URI-encoded recipient keys use in production (encodeURIComponent)', async () => {
    const legacy: MailSave = {
      mail: [mkLetter({ id: 1, recipientKey: 'weird:name' })],
      nextMailId: 2,
    };
    const client = makeClient({ legacy: [{ data: legacy }] });
    await runMailPartitionBackfill({ client, realm: 'Home', log: () => {} });

    const partitionUpserts = client.calls.filter((c) => /UNNEST/i.test(c.text));
    const [keys] = partitionUpserts[0].params as [string[], string[]];
    expect(keys).toEqual(['mail:Home:r:weird%3Aname']);
  });

  it('pins the load-bearing SQL fragments to literal text', async () => {
    const legacy: MailSave = { mail: [mkLetter()], nextMailId: 2 };
    const client = makeClient({ legacy: [{ data: legacy }] });
    await runMailPartitionBackfill({ client, realm: 'Home', log: () => {} });

    const forUpdate = client.calls.find((c) => c.text.includes('FOR UPDATE'));
    expect(forUpdate?.text).toContain('FOR UPDATE');
    const upsert = client.calls.find((c) => c.text.startsWith('INSERT'));
    expect(upsert?.text).toContain('INSERT INTO world_state');
    expect(upsert?.text).toContain('ON CONFLICT (key) DO UPDATE');
    const markerWrite = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === 'mail_partition_done:Home',
    );
    expect(markerWrite).toBeDefined();
  });
});

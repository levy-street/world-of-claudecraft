// Opt-in REAL-Postgres proof for the custody parcel overlay: the table DDL
// through the real ensureSchema (pinning the db.ts registration), the
// insert/merge/bake lifecycle against a REAL Sim post office, and the
// crash-then-clean-shutdown story end to end. The mocked-pool suite
// (tests/server/mail_custody_overlay.test.ts) pins shapes and set
// semantics; this one proves the SQL and the durability claim.
//
// Gated on TEST_DATABASE_URL like every other *_integration.test.ts:
// without it the file skips green and CI's DB-free floor is unchanged.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { takeMailPartitionsForCharacterSave } from '../server/mail_partition_rearm';
import { materialSourceConnection } from '../server/material_source_connection';
import { handleVaultMailTake, VaultMailTakeGuard } from '../server/vault_mail_take_guard';
import { type CharacterState, type MailSave, type MarketSave, Sim } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_mail_custody_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('mail custody overlay (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let overlay: typeof import('../server/mail_custody_overlay');
  let nextSeq = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    // Upgrade proof: a populated pre-copper overlay must survive ensureSchema.
    const legacy = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 1 });
    try {
      await legacy.query(`CREATE TABLE mail_custody_parcels (
        custody_ref TEXT PRIMARY KEY, realm TEXT NOT NULL, recipient_key TEXT NOT NULL,
        recipient_name TEXT NOT NULL, letter TEXT NOT NULL, items JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await legacy.query(`INSERT INTO mail_custody_parcels
        (custody_ref, realm, recipient_key, recipient_name, letter, items)
        VALUES ('legacy:1', 'unused-legacy-realm', '1', 'Legacy', 'delivery', '[]'::jsonb)`);
    } finally {
      await legacy.end();
    }

    db = await import('../server/db');
    overlay = await import('../server/mail_custody_overlay');

    // The REAL boot path: proves the mail_custody_parcels registration in
    // ensureSchema, not just the DDL string.
    await db.ensureSchema();

    pool = new Pool({ ...materialSourceConnection(verifyUrl(ADMIN_URL as string)), max: 4 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  const REF = 'settlement:pg:1';

  it('migrates a populated pre-copper parcel row without losing it', async () => {
    const row = await pool.query(
      `SELECT custody_ref, copper FROM mail_custody_parcels WHERE custody_ref = 'legacy:1'`,
    );
    expect(row.rows).toEqual([{ custody_ref: 'legacy:1', copper: '0' }]);
  });
  const ROW = {
    custodyRef: REF,
    recipient: { key: '4242', name: 'Buyer' },
    letter: 'delivery' as const,
    items: [{ itemId: 'rusty_hatchet', count: 1 }],
  };
  const MARKET = { listings: [], collections: {} } as unknown as MarketSave;
  const STATE = {
    level: 1,
    questLog: [],
    questsDone: [],
    inventory: [],
  } as unknown as CharacterState;

  async function makeSaveCharacter(): Promise<number> {
    const account = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`mailcustody_${++nextSeq}`],
    );
    const character = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [
        Number(account.rows[0].id),
        `MailCustody${nextSeq}`,
        (await import('../server/realm')).REALM,
      ],
    );
    return Number(character.rows[0].id);
  }

  function allMailPartitions(sim: Sim): { recipientKey: string; letters: MailSave['mail'] }[] {
    const byRecipient = new Map<string, MailSave['mail']>();
    for (const letter of sim.serializeMail().mail) {
      const bucket = byRecipient.get(letter.recipientKey) ?? [];
      bucket.push(letter);
      byRecipient.set(letter.recipientKey, bucket);
    }
    return [...byRecipient].map(([recipientKey, letters]) => ({ recipientKey, letters }));
  }

  async function saveCurrentMailBook(characterId: number, sim: Sim): Promise<void> {
    const partitions = allMailPartitions(sim);
    expect(partitions.length).toBeGreaterThan(0);
    expect(await db.saveCharacterAndMarketState(characterId, 1, STATE, MARKET, partitions)).toBe(
      true,
    );
  }

  it('atomically saves a vault recipient and character without writing the Market', async () => {
    const characterId = await makeSaveCharacter();
    const realm = (await import('../server/realm')).REALM;
    const recipientKey = String(characterId);
    const letter = { ...ROW, custodyRef: `vault:pg:${characterId}` };
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    expect(
      sim.mailSystemParcel(
        { key: recipientKey, name: `MailCustody${nextSeq}` },
        overlay.CUSTODY_PARCEL_LETTERS.vault_reward,
        letter.items,
        letter.custodyRef,
      ),
    ).toBe(true);
    const state = { ...STATE, copper: 73 } as CharacterState;
    await pool.query(`CREATE FUNCTION test_reject_market_write() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.key LIKE 'market:%' THEN RAISE EXCEPTION 'market write forbidden in vault mail save'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER test_vault_mail_market_guard
      BEFORE INSERT OR UPDATE ON world_state
      FOR EACH ROW EXECUTE FUNCTION test_reject_market_write()`);
    try {
      expect(
        await db.saveCharacterAndMarketState(characterId, 1, state, null, [
          { recipientKey, letters: sim.serializeMail().mail },
        ]),
      ).toBe(true);
    } finally {
      await pool.query('DROP TRIGGER test_vault_mail_market_guard ON world_state');
      await pool.query('DROP FUNCTION test_reject_market_write()');
    }
    const [character, mailbox] = await Promise.all([
      pool.query('SELECT state FROM characters WHERE id = $1', [characterId]),
      pool.query('SELECT data FROM world_state WHERE key = $1', [
        `mail:${realm}:r:${recipientKey}`,
      ]),
    ]);
    expect(character.rows[0].state.copper).toBe(73);
    expect(mailbox.rows[0].data.mail).toHaveLength(1);
  });

  it('retains a 31-day-old unbaked vault parcel through the residue sweep and replays it', async () => {
    const recipientKey = String(await makeSaveCharacter());
    const vaultRef = `vault:retention:${recipientKey}`;
    const staleRef = `delivery:retention:${recipientKey}`;
    const recipient = { key: recipientKey, name: `MailCustody${nextSeq}` };
    await overlay.persistCustodyParcelRow({
      custodyRef: vaultRef,
      recipient,
      letter: 'vault_reward',
      items: ROW.items,
      copper: 17,
    });
    await overlay.persistCustodyParcelRow({
      custodyRef: staleRef,
      recipient,
      letter: 'delivery',
      items: ROW.items,
    });
    await pool.query(
      `UPDATE mail_custody_parcels SET created_at = now() - interval '31 days'
       WHERE custody_ref = ANY($1::text[])`,
      [[vaultRef, staleRef]],
    );
    await overlay.pruneMailCustodyParcelsBatch(100);
    const survivors = await pool.query(
      'SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = ANY($1::text[])',
      [[vaultRef, staleRef]],
    );
    expect(survivors.rows).toEqual([{ custody_ref: vaultRef }]);
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    await overlay.mergeCustodyParcelOverlay(sim);
    expect(sim.serializeMail().mail.some((mail) => mail.custodyRef === vaultRef)).toBe(true);
    await db.saveMailPartitions(
      sim.takeDirtyMailPartitions().filter((partition) => partition.recipientKey === recipientKey),
    );
  });

  it('carries a parcel through crash replay, then bakes it into a clean book write', async () => {
    const characterId = await makeSaveCharacter();
    overlay.resetCustodyParcelOverlayForTests();

    // Book + persist the row (the parcel path; the book itself is the live
    // sim's and is deliberately NOT written here).
    const sim1 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    expect(
      sim1.mailSystemParcel(ROW.recipient, overlay.CUSTODY_PARCEL_LETTERS.delivery, ROW.items, REF),
    ).toBe(true);
    await overlay.persistCustodyParcelRow(ROW);
    // Idempotent re-insert (the retry arm).
    await overlay.persistCustodyParcelRow(ROW);
    const stored = await pool.query(
      `SELECT custody_ref, letter FROM mail_custody_parcels WHERE custody_ref = $1`,
      [REF],
    );
    expect(stored.rows).toEqual([{ custody_ref: REF, letter: 'delivery' }]);

    // CRASH: the process dies before any full-book write. A new process
    // loads a book WITHOUT the parcel and merges the overlay.
    overlay.resetCustodyParcelOverlayForTests();
    const sim2 = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const merged = await overlay.mergeCustodyParcelOverlay(sim2);
    expect(merged).toEqual({ replayed: 1, present: 0, refused: 0, stale: 0, ok: true });
    expect(sim2.hasCustodyParcel(REF)).toBe(true);

    // CLEAN SHUTDOWN: the next committed partition write carries the parcel
    // and bakes its own overlay row. A partial write must not advance a
    // realm-wide watermark for recipients that it did not write.
    await saveCurrentMailBook(characterId, sim2);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM mail_custody_parcels WHERE custody_ref = $1`,
      [REF],
    );
    expect(after.rows[0].n).toBe(0);
    const wmBorn = await pool.query(`SELECT realm FROM mail_custody_watermark`);
    expect(wmBorn.rows).toEqual([]);

    // Next boot: the parcel now arrives from the blob itself, no overlay
    // rows left to replay, and the book-once state is intact.
    const sim3 = new Sim({ seed: 44, playerClass: 'warrior', noPlayer: true });
    sim3.loadMail(await db.loadMailState());
    expect(sim3.hasCustodyParcel(REF)).toBe(true);
    const remerge = await overlay.mergeCustodyParcelOverlay(sim3);
    expect(remerge).toEqual({ replayed: 0, present: 0, refused: 0, stale: 0, ok: true });

    // Even repeated partial writes cannot certify unrelated recipients.
    await saveCurrentMailBook(characterId, sim3);
    const wm = await pool.query(`SELECT realm FROM mail_custody_watermark`);
    expect(wm.rows).toEqual([]);
  });

  it('does not replay a collected parcel after partition saves and a restart', async () => {
    const ref = 'settlement:pg:claimed';
    const recipient = { key: '5555', name: 'MailProbe' };
    const parcel = { ...ROW, custodyRef: ref, recipient };
    overlay.resetCustodyParcelOverlayForTests();
    const sim = new Sim({ seed: 46, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', recipient.name, {
      characterId: 5555,
      tutorialGreetingSent: true,
    });
    expect(
      sim.mailSystemParcel(recipient, overlay.CUSTODY_PARCEL_LETTERS.delivery, ROW.items, ref),
    ).toBe(true);
    await overlay.persistCustodyParcelRow(parcel);
    await db.saveMailPartitions(sim.takeDirtyMailPartitions());
    const baked = await pool.query(
      'SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1',
      [ref],
    );
    expect(baked.rows).toEqual([]);

    const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
    const player = sim.entities.get(pid);
    if (!mailbox || !player) throw new Error('mailbox or player missing');
    player.pos = { ...mailbox.pos };
    player.prevPos = { ...mailbox.pos };
    sim.rebucket(player);
    const letter = sim.postOffice.mail.find((mail) => mail.custodyRef === ref);
    if (!letter) throw new Error('custody letter missing');
    sim.mailTake(letter.id, pid);
    expect(sim.players.get(pid)?.inventory.some((slot) => slot.itemId === 'rusty_hatchet')).toBe(
      true,
    );
    sim.mailDelete(letter.id, pid);
    await db.saveMailPartitions(sim.takeDirtyMailPartitions());

    overlay.resetCustodyParcelOverlayForTests();
    const reboot = new Sim({ seed: 47, playerClass: 'warrior', noPlayer: true });
    reboot.loadMail(await db.loadMailState());
    expect((await overlay.mergeCustodyParcelOverlay(reboot)).replayed).toBe(0);
    expect(reboot.hasCustodyParcel(ref)).toBe(false);
  });

  it('keeps recipient B pending when only recipient A is saved', async () => {
    const a = {
      ...ROW,
      custodyRef: 'settlement:pg:partition-a',
      recipient: { key: '6666', name: 'A' },
    };
    const b = {
      ...ROW,
      custodyRef: 'settlement:pg:partition-b',
      recipient: { key: '7777', name: 'B' },
    };
    overlay.resetCustodyParcelOverlayForTests();
    const sim = new Sim({ seed: 48, playerClass: 'warrior', noPlayer: true });
    for (const parcel of [a, b]) {
      expect(
        sim.mailSystemParcel(
          parcel.recipient,
          overlay.CUSTODY_PARCEL_LETTERS.delivery,
          parcel.items,
          parcel.custodyRef,
        ),
      ).toBe(true);
      await overlay.persistCustodyParcelRow(parcel);
    }
    const partitions = sim.takeDirtyMailPartitions();
    await db.saveMailPartitions(
      partitions.filter((partition) => partition.recipientKey === a.recipient.key),
    );
    const rows = await pool.query(
      'SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = ANY($1::text[]) ORDER BY custody_ref',
      [[a.custodyRef, b.custodyRef]],
    );
    expect(rows.rows.map((row) => row.custody_ref)).toEqual([b.custodyRef]);

    overlay.resetCustodyParcelOverlayForTests();
    const reboot = new Sim({ seed: 49, playerClass: 'warrior', noPlayer: true });
    reboot.loadMail(await db.loadMailState());
    expect(reboot.hasCustodyParcel(a.custodyRef)).toBe(true);
    expect((await overlay.mergeCustodyParcelOverlay(reboot)).replayed).toBe(1);
    expect(reboot.hasCustodyParcel(b.custodyRef)).toBe(true);
    await db.saveMailPartitions(reboot.takeDirtyMailPartitions());
    const after = await pool.query(
      'SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1',
      [b.custodyRef],
    );
    expect(after.rows).toEqual([]);
  });

  it('refuses a duplicate custody ref for a different recipient without baking the original', async () => {
    const a = {
      ...ROW,
      custodyRef: 'settlement:pg:collision',
      recipient: { key: '8888', name: 'A' },
    };
    const b = { ...a, recipient: { key: '9999', name: 'B' } };
    overlay.resetCustodyParcelOverlayForTests();
    await overlay.persistCustodyParcelRow(a);
    await overlay.persistCustodyParcelRow(a); // identical retry, including JSONB equality
    await expect(overlay.persistCustodyParcelRow(b)).rejects.toThrow('Conflicting');
    expect(overlay.snapshotPendingCustodyRefs([a.recipient.key])).toEqual([a.custodyRef]);
    expect(overlay.snapshotPendingCustodyRefs([b.recipient.key])).toEqual([]);
    const stored = await pool.query(
      'SELECT recipient_key FROM mail_custody_parcels WHERE custody_ref = $1',
      [a.custodyRef],
    );
    expect(stored.rows).toEqual([{ recipient_key: a.recipient.key }]);
  });

  it('recovers a failed vault mail take across disconnect and pays exactly once', async () => {
    const { REALM } = await import('../server/realm');
    const { VaultMailTakeRecovery } = await import('../server/vault_mail_take_recovery');
    const { loadVaultMailRecovery } = await import('../server/vault_mail_recovery_db');
    const characterId = await makeSaveCharacter();
    const recipient = { key: String(characterId), name: `MailCustody${nextSeq}` };
    const custodyRef = `vault:pg:take:${characterId}`;
    const items = [{ itemId: 'thorium_ore', count: 2 }];
    overlay.resetCustodyParcelOverlayForTests();

    function moveToMailbox(sim: Sim, pid: number): void {
      const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
      const player = sim.entities.get(pid);
      if (!mailbox || !player) throw new Error('mailbox or player missing');
      player.pos = { ...mailbox.pos };
      player.prevPos = { ...mailbox.pos };
      sim.rebucket(player);
    }

    const live = new Sim({ seed: 51, playerClass: 'warrior', noPlayer: true });
    const oldPid = live.addPlayer('warrior', recipient.name, {
      characterId,
      tutorialGreetingSent: true,
    });
    const initial = live.serializeCharacter(oldPid);
    if (!initial) throw new Error('initial character state missing');
    expect(
      await db.saveCharacterAndMarketState(characterId, initial.level, initial, null, []),
    ).toBe(true);
    expect(
      live.mailSystemParcel(
        recipient,
        { ...overlay.CUSTODY_PARCEL_LETTERS.vault_reward, copper: 19 },
        items,
        custodyRef,
      ),
    ).toBe(true);
    await overlay.persistCustodyParcelRow({
      custodyRef,
      recipient,
      letter: 'vault_reward',
      items,
      copper: 19,
    });
    moveToMailbox(live, oldPid);
    const oldLetter = live.postOffice.mail.find((mail) => mail.custodyRef === custodyRef);
    if (!oldLetter) throw new Error('vault letter missing');
    const guard = new VaultMailTakeGuard();
    let failedSave: unknown;
    handleVaultMailTake(
      guard,
      live,
      characterId,
      oldPid,
      oldLetter.id,
      async () => {
        const state = live.serializeCharacter(oldPid);
        if (!state) throw new Error('taken character state missing');
        return db.saveCharacterAndMarketState(
          characterId,
          state.level,
          state,
          null,
          takeMailPartitionsForCharacterSave(live, characterId, guard.blocked, true),
          'wrong-lease-nonce',
        );
      },
      (error) => {
        failedSave = error;
      },
    );
    await vi.waitFor(() => expect(failedSave).toBeTruthy());
    expect(guard.isLocked(characterId)).toBe(true);
    expect(live.serializeCharacter(oldPid)?.copper).toBe(initial.copper + 19);
    live.removePlayer(oldPid);

    const row = await pool.query('SELECT state FROM characters WHERE id = $1', [characterId]);
    const durableBefore = row.rows[0].state as CharacterState;
    expect(durableBefore.copper).toBe(initial.copper);
    const rejoined = new Sim({ seed: 52, playerClass: 'warrior', noPlayer: true });
    rejoined.loadMail(await db.loadMailState());
    await overlay.mergeCustodyParcelOverlay(rejoined);
    const newPid = rejoined.addPlayer('warrior', recipient.name, {
      characterId,
      state: durableBefore,
      tutorialGreetingSent: true,
    });
    moveToMailbox(rejoined, newPid);
    const recovery = new VaultMailTakeRecovery(
      guard,
      () => rejoined,
      (run) => run(),
      (id, ref) => loadVaultMailRecovery(db.pool, REALM, id, ref),
    );
    expect(recovery.joinError(characterId)).toMatch(/recovering/);
    await vi.waitFor(() => expect(guard.isLocked(characterId)).toBe(false));
    const restored = rejoined.postOffice.mail.find((mail) => mail.custodyRef === custodyRef);
    expect(restored?.copper).toBe(19);
    expect(restored?.items).toEqual(items);

    let paidSave: boolean | undefined;
    handleVaultMailTake(guard, rejoined, characterId, newPid, restored?.id ?? -1, async () => {
      const state = rejoined.serializeCharacter(newPid);
      if (!state) throw new Error('rejoined character state missing');
      const partitions = takeMailPartitionsForCharacterSave(
        rejoined,
        characterId,
        guard.blocked,
        true,
      );
      const generation = guard.capture(characterId, newPid, partitions);
      paidSave = await db.saveCharacterAndMarketState(
        characterId,
        state.level,
        state,
        null,
        partitions,
      );
      if (paidSave) guard.committed(characterId, generation);
      return paidSave;
    });
    await vi.waitFor(() => expect(paidSave).toBe(true));
    expect(guard.isLocked(characterId)).toBe(false);
    expect(rejoined.serializeCharacter(newPid)?.copper).toBe(initial.copper + 19);
    expect(rejoined.serializeCharacter(newPid)?.inventory).toContainEqual(
      expect.objectContaining({ itemId: 'thorium_ore', count: 2 }),
    );

    const after = await pool.query('SELECT state FROM characters WHERE id = $1', [characterId]);
    expect(after.rows[0].state.copper).toBe(initial.copper + 19);
    expect(after.rows[0].state.inventory).toContainEqual(
      expect.objectContaining({ itemId: 'thorium_ore', count: 2 }),
    );
    const book = await pool.query('SELECT data FROM world_state WHERE key = $1', [
      `mail:${REALM}:r:${recipient.key}`,
    ]);
    const savedLetter = (book.rows[0].data as MailSave).mail.find(
      (mail) => mail.custodyRef === custodyRef,
    );
    expect(savedLetter?.items).toEqual([]);
    expect(savedLetter?.copper).toBe(0);
    expect(
      (
        await pool.query('SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1', [
          custodyRef,
        ])
      ).rowCount,
    ).toBe(0);
    const reboot = new Sim({ seed: 53, playerClass: 'warrior', noPlayer: true });
    reboot.loadMail(await db.loadMailState());
    await overlay.mergeCustodyParcelOverlay(reboot);
    expect(reboot.postOffice.mail.find((mail) => mail.custodyRef === custodyRef)?.items).toEqual(
      [],
    );
    expect(reboot.postOffice.mail.find((mail) => mail.custodyRef === custodyRef)?.copper).toBe(0);
    const savedAfterReboot = (
      await pool.query('SELECT state FROM characters WHERE id = $1', [characterId])
    ).rows[0].state as CharacterState;
    const rebootPid = reboot.addPlayer('warrior', recipient.name, {
      characterId,
      state: savedAfterReboot,
      tutorialGreetingSent: true,
    });
    expect(reboot.serializeCharacter(rebootPid)?.copper).toBe(initial.copper + 19);
    expect(reboot.serializeCharacter(rebootPid)?.inventory).toContainEqual(
      expect.objectContaining({ itemId: 'thorium_ore', count: 2 }),
    );
  });
});

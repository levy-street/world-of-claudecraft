import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { loadVaultMailRecovery } from '../server/vault_mail_recovery_db';
import { handleVaultMailTake, VaultMailTakeGuard } from '../server/vault_mail_take_guard';
import { BOT_REPORT_REWARD_LETTER } from '../src/sim/content/letters';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

const REF = 'report_reward:123';
const world = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world });
function atMailbox(sim: Sim, pid: number): void {
  const player = sim.entities.get(pid)!;
  player.pos = { ...sim.entities.get(sim.postOffice.mailboxIds[0])!.pos };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
}
function book(sim: Sim, pid: number): number {
  atMailbox(sim, pid);
  expect(
    sim.mailSystemParcel(
      { key: '77', name: 'Reporter' },
      { ...BOT_REPORT_REWARD_LETTER, copper: 50_000 },
      [],
      REF,
    ),
  ).toBe(true);
  return sim.mailInfoFor(pid)!.messages.find((mail) => mail.letterId === 'bot_report_reward')!.id;
}

describe('bot report reward collection', () => {
  it('delivers the current thank-you letter without money or items, including after restart', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Reporter', { characterId: 77 });
    atMailbox(sim, pid);
    const before = sim.meta(pid)!.copper;
    expect(
      sim.mailSystemParcel({ key: '77', name: 'Reporter' }, BOT_REPORT_REWARD_LETTER, [], REF),
    ).toBe(true);
    const letter = sim
      .mailInfoFor(pid)!
      .messages.find((mail) => mail.letterId === 'bot_report_reward')!;
    expect(letter).toMatchObject({
      subject: 'An account you reported has been banned',
      copper: 0,
      items: [],
    });
    expect(letter.body).toContain('Thank you for helping us keep the game fair.');
    sim.mailTake(letter.id, pid);
    expect(sim.meta(pid)!.copper).toBe(before);
    const next = makeSim();
    next.loadMail(JSON.parse(JSON.stringify(sim.serializeMail())));
    const nextPid = next.addPlayer('warrior', 'Reporter', {
      characterId: 77,
      state: sim.serializeCharacter(pid)!,
    });
    atMailbox(next, nextPid);
    expect(next.mailInfoFor(nextPid)!.messages.find((mail) => mail.id === letter.id)).toMatchObject(
      {
        copper: 0,
        items: [],
      },
    );
    next.mailTake(letter.id, nextPid);
    expect(next.meta(nextPid)!.copper).toBe(before);
  });

  it('pairs legacy report gold with the emptied letter and keeps repeated takes fenced until commit and across restart', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Reporter', { characterId: 77 });
    const meta = sim.meta(pid)!;
    const before = meta.copper;
    const caskets = meta.clueCasketsOpened ?? 0;
    const id = book(sim, pid);
    const guard = new VaultMailTakeGuard();
    const save = vi.fn();
    expect(guard.take(sim, 77, pid, id, save)).toBe(true);
    expect(meta.copper - before).toBe(50_000);
    expect(meta.clueCasketsOpened ?? 0).toBe(caskets);
    expect(guard.recoveryRef(77)).toBe(REF);
    expect(guard.take(sim, 77, pid, id, save)).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(meta.copper - before).toBe(50_000);
    expect(guard.blocked.has('77')).toBe(true);
    expect(guard.capture(77, pid, [{ recipientKey: '88' }])).toBeUndefined();
    guard.committed(77);
    expect(guard.isLocked(77)).toBe(true);
    const paired = JSON.parse(
      JSON.stringify({ character: sim.serializeCharacter(pid), mail: sim.serializeMail() }),
    );
    const generation = guard.capture(77, pid, [{ recipientKey: '77' }]);
    guard.committed(77, generation);
    expect(guard.isLocked(77)).toBe(false);
    const next = makeSim();
    next.loadMail(paired.mail);
    const nextPid = next.addPlayer('warrior', 'Reporter', {
      characterId: 77,
      state: paired.character,
    });
    atMailbox(next, nextPid);
    expect(next.vaultCustodyRefFor(id, nextPid)).toBe(REF);
    next.mailTake(id, nextPid);
    expect(next.meta(nextPid)!.copper - before).toBe(50_000);
    expect(next.meta(nextPid)!.clueCasketsOpened ?? 0).toBe(caskets);
    expect(
      next.mailSystemParcel({ key: '77', name: 'Reporter' }, BOT_REPORT_REWARD_LETTER, [], REF),
    ).toBe(false);
  });

  it('restores a legacy report letter after a failed paired save and grants only its durable missing gold', async () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Reporter', { characterId: 77 });
    const id = book(sim, pid);
    const before = sim.meta(pid)!.copper;
    const guard = new VaultMailTakeGuard();
    const failed = vi.fn();
    handleVaultMailTake(guard, sim, 77, pid, id, async () => false, failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(guard.isLocked(77)).toBe(true);
    // A fresh character load uses the pre-take durable coin snapshot.
    sim.meta(pid)!.copper = before;
    expect(
      sim.restoreVaultLetter('77', REF, {
        letterId: 'bot_report_reward',
        recipientName: 'Reporter',
        copper: 50_000,
        items: [],
        read: false,
      }),
    ).toBe(true);
    guard.recovered(77, REF);
    const restored = sim.mailInfoFor(pid)!.messages.find((mail) => mail.id === id)!;
    expect(restored.letterId).toBe('bot_report_reward');
    expect(restored.subject).toBe(BOT_REPORT_REWARD_LETTER.subject);
    expect(restored.body).toBe(BOT_REPORT_REWARD_LETTER.body);
    expect(guard.take(sim, 77, pid, id, () => {})).toBe(true);
    expect(sim.meta(pid)!.copper - before).toBe(50_000);
    expect(sim.meta(pid)!.clueCasketsOpened ?? 0).toBe(0);
    expect(
      sim.restoreVaultLetter('77', REF, {
        letterId: 'hoard_vault_reward',
        recipientName: 'Reporter',
        copper: 50_000,
        items: [],
        read: false,
      }),
    ).toBe(false);
    // Boot recovery can also restore a missing live letter using the proper template.
    const empty = makeSim();
    expect(
      empty.restoreVaultLetter('77', REF, {
        letterId: 'bot_report_reward',
        recipientName: 'Reporter',
        copper: 50_000,
        items: [],
        read: false,
      }),
    ).toBe(true);
    expect(empty.serializeMail().mail[0]).toMatchObject({
      letterId: 'bot_report_reward',
      custodyRef: REF,
      copper: 50_000,
    });
  });

  it('locks the character before recovery reads and selects only the report overlay kind', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id')) return { rowCount: 1, rows: [{ id: 77 }] };
      if (sql.includes('FROM mail_custody_parcels'))
        return { rowCount: 1, rows: [{ recipient_name: 'Reporter', copper: '50000', items: [] }] };
      return { rowCount: 0, rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as Pick<Pool, 'connect'>;
    expect(await loadVaultMailRecovery(pool, 'test', 77, REF)).toEqual({
      letterId: 'bot_report_reward',
      recipientName: 'Reporter',
      copper: 50_000,
      items: [],
      read: false,
    });
    const sqls = query.mock.calls.map(([sql]) => sql);
    expect(sqls.findIndex((sql) => sql.includes('FOR UPDATE'))).toBeLessThan(
      sqls.findIndex((sql) => sql.includes('FROM world_state')),
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND letter = $4'), [
      'test',
      '77',
      REF,
      'report_reward',
    ]);
    expect(release).toHaveBeenCalledOnce();
    await expect(
      loadVaultMailRecovery(pool, 'test', 77, 'report_reward:invalid'),
    ).rejects.toThrow();
  });

  it('treats an emptied durable report letter as committed and rejects a ref assigned to a vault letter', async () => {
    const saved = {
      recipientKey: '77',
      recipientName: 'Reporter',
      custodyRef: REF,
      letterId: 'bot_report_reward',
      copper: 0,
      items: [],
      read: true,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id')) return { rowCount: 1, rows: [{ id: 77 }] };
      if (sql.includes('FROM world_state'))
        return { rowCount: 1, rows: [{ data: { mail: [saved] } }] };
      return { rowCount: 0, rows: [] };
    });
    const pool = { connect: async () => ({ query, release: () => {} }) } as unknown as Pick<
      Pool,
      'connect'
    >;
    expect(await loadVaultMailRecovery(pool, 'test', 77, REF)).toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM mail_custody_parcels'))).toBe(false);
    saved.letterId = 'hoard_vault_reward';
    saved.copper = 50_000;
    await expect(loadVaultMailRecovery(pool, 'test', 77, REF)).rejects.toThrow(
      'letter type mismatch',
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});

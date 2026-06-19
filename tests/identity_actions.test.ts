// Exercises server/identity_actions.ts — the prepare (validate + price) and apply
// (perform) logic behind the $WOC identity quote/confirm flow. The DB layer is
// mocked; the real name validators (server/auth.ts) and injected game hooks run
// so we cover the actual gating: force_rename stays free, reservations are
// honored, and guild rename is leader-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/db', () => ({
  getCharacter: vi.fn(),
  renameCharacter: vi.fn(),
  reserveName: vi.fn(),
  activeReservationHolder: vi.fn(async () => null),
  countActiveReservations: vi.fn(async () => 0),
}));

import * as db from '../server/db';
import { makeIdentityActions, type IdentityGameHooks } from '../server/identity_actions';

const charRow = (over: Partial<any> = {}) => ({
  id: 1, account_id: 10, name: 'Oldname', class: 'warrior', level: 5, state: null, is_gm: false, force_rename: false, ...over,
});

function hooks(over: Partial<IdentityGameHooks> = {}): IdentityGameHooks {
  return {
    isCharacterOnline: () => false,
    guildLeaderInfo: async () => ({ guildId: 7, name: 'Knights', isLeader: true }),
    renameGuildAsLeader: async () => ({ ok: true as const, guildId: 7, oldName: 'Knights', name: 'Paladins' }),
    validateGuildName: (raw: string) => {
      const t = String(raw ?? '').trim();
      return /^[A-Za-z][A-Za-z ]*[A-Za-z]$/.test(t) && t.length >= 3 && t.length <= 24 && !/\s{2,}/.test(t) ? t : null;
    },
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(db.getCharacter).mockResolvedValue(charRow() as any);
  vi.mocked(db.activeReservationHolder).mockResolvedValue(null);
  vi.mocked(db.countActiveReservations).mockResolvedValue(0);
});

describe('prepare: rename_character', () => {
  it('prices a valid voluntary rename', async () => {
    const a = makeIdentityActions(hooks());
    const r = await a.prepare(10, 'rename_character', { characterId: 1, name: 'Aragorn' });
    expect(r).toMatchObject({ ok: true, priceKey: 'rename_character', payload: { characterId: 1, name: 'Aragorn' } });
  });

  it('refuses a moderator-required (force_rename) character — that path is free', async () => {
    vi.mocked(db.getCharacter).mockResolvedValue(charRow({ force_rename: true }) as any);
    const a = makeIdentityActions(hooks());
    const r = await a.prepare(10, 'rename_character', { characterId: 1, name: 'Aragorn' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/free/i);
  });

  it('rejects an offensive name', async () => {
    const a = makeIdentityActions(hooks());
    const r = await a.prepare(10, 'rename_character', { characterId: 1, name: 'Fuckface' });
    expect(r.ok).toBe(false);
  });

  it('rejects a character that is currently online', async () => {
    const a = makeIdentityActions(hooks({ isCharacterOnline: () => true }));
    const r = await a.prepare(10, 'rename_character', { characterId: 1, name: 'Aragorn' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("blocks a name reserved by someone else, allows the reserver's own", async () => {
    const a = makeIdentityActions(hooks());
    vi.mocked(db.activeReservationHolder).mockResolvedValue(99);
    expect((await a.prepare(10, 'rename_character', { characterId: 1, name: 'Aragorn' })).ok).toBe(false);
    vi.mocked(db.activeReservationHolder).mockResolvedValue(10);
    expect((await a.prepare(10, 'rename_character', { characterId: 1, name: 'Aragorn' })).ok).toBe(true);
  });
});

describe('apply: rename_character', () => {
  it('renames and returns the row', async () => {
    vi.mocked(db.renameCharacter).mockResolvedValue(charRow({ name: 'Aragorn' }) as any);
    const a = makeIdentityActions(hooks());
    const r = await a.apply(10, 'rename_character', { characterId: 1, name: 'Aragorn' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Aragorn' });
  });

  it('maps a unique-violation to 409 name taken', async () => {
    vi.mocked(db.renameCharacter).mockRejectedValue({ code: '23505' });
    const a = makeIdentityActions(hooks());
    const r = await a.apply(10, 'rename_character', { characterId: 1, name: 'Aragorn' });
    expect(r.status).toBe(409);
  });
});

describe('rename_guild', () => {
  it('refuses a non-leader at prepare', async () => {
    const a = makeIdentityActions(hooks({ guildLeaderInfo: async () => ({ guildId: 7, name: 'Knights', isLeader: false }) }));
    const r = await a.prepare(10, 'rename_guild', { characterId: 1, name: 'Paladins' });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('prices a leader rename and applies via the hook', async () => {
    const renameGuildAsLeader = vi.fn(async () => ({ ok: true as const, guildId: 7, oldName: 'Knights', name: 'Paladins' }));
    const a = makeIdentityActions(hooks({ renameGuildAsLeader }));
    expect((await a.prepare(10, 'rename_guild', { characterId: 1, name: 'Paladins' })).ok).toBe(true);
    const r = await a.apply(10, 'rename_guild', { characterId: 1, name: 'Paladins' });
    expect(r.status).toBe(200);
    expect(renameGuildAsLeader).toHaveBeenCalledWith(1, 'Paladins');
  });
});

describe('reserve_name', () => {
  it('enforces the per-account reservation cap', async () => {
    vi.mocked(db.countActiveReservations).mockResolvedValue(10);
    const a = makeIdentityActions(hooks());
    const r = await a.prepare(10, 'reserve_name', { name: 'Aragorn' });
    expect(r).toMatchObject({ ok: false, status: 429 });
  });

  it('rejects an already-reserved name', async () => {
    vi.mocked(db.activeReservationHolder).mockResolvedValue(42);
    const a = makeIdentityActions(hooks());
    const r = await a.prepare(10, 'reserve_name', { name: 'Aragorn' });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('reserves on apply', async () => {
    vi.mocked(db.reserveName).mockResolvedValue({ id: 5, account_id: 10, name: 'Aragorn', kind: 'character', expires_at: null } as any);
    const a = makeIdentityActions(hooks());
    const r = await a.apply(10, 'reserve_name', { name: 'Aragorn', kind: 'character' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Aragorn' });
  });
});

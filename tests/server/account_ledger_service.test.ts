// AccountLedgerService (server/account_ledger_service.ts): the live fan-out of
// one character's deed earn or relic find to the account's OTHER live
// sessions. Drives the service over a fake host (the account_cosmetics_service
// test idiom): no GameServer, no sockets.
import { describe, expect, it } from 'vitest';
import {
  type AccountLedgerHost,
  AccountLedgerService,
  type LedgerSession,
  SIBLING_GRANT_OPTS,
} from '../../server/account_ledger_service';
import {
  type AccountLedger,
  freshAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../../src/sim/account_ledger';
import { isHorizonsTitleDeed } from '../../src/sim/reliquary';

function rig() {
  const ledgers = new Map<number, AccountLedger>();
  const sessions: LedgerSession[] = [];
  const add = (pid: number, accountId: number, characterId: number): LedgerSession => {
    ledgers.set(pid, freshAccountLedger());
    const s: LedgerSession = { pid, accountId, characterId, selfHeavyDirty: false };
    sessions.push(s);
    return s;
  };
  const synced: number[] = [];
  const host: AccountLedgerHost = {
    sim: () => ({
      meta: (pid: number) => {
        const accountLedger = ledgers.get(pid);
        return accountLedger ? { accountLedger } : null;
      },
    }),
    sessions: () => sessions,
    // Every sync must carry the retro flag (the one-celebration rule); a
    // host that dropped it would marquee the finder's find under the
    // sibling's name, so the flag is pinned per call, not per suite.
    syncGrants: (pid, opts) => {
      expect(opts).toBe(SIBLING_GRANT_OPTS);
      expect(opts.retro).toBe(true);
      synced.push(pid);
    },
  };
  return { service: new AccountLedgerService(host), ledgers, add, synced };
}

const DAY = '2026-09-10';

describe('AccountLedgerService', () => {
  it('copies the actor entry to same-account siblings only, marking each heavy-dirty', () => {
    const { service, ledgers, add, synced } = rig();
    const actor = add(1, 7, 42);
    const alt = add(2, 7, 43);
    const stranger = add(3, 8, 99);
    // The sim already appended the actor to its OWN ledger; the service copies
    // that exact entry (same day stamp, no second derivation).
    recordAccountDeed(ledgers.get(1)!, 'prog_first_steps', {
      characterId: 42,
      name: 'Hilda',
      cls: 'warrior',
      day: DAY,
    });
    expect(service.noteDeedEarned(actor, 'prog_first_steps')).toBe(1);
    expect(ledgers.get(2)!.deeds.get('prog_first_steps')).toEqual([
      { characterId: 42, name: 'Hilda', cls: 'warrior', day: DAY },
    ]);
    expect(ledgers.get(3)!.deeds.size).toBe(0);
    expect(alt.selfHeavyDirty).toBe(true);
    expect(stranger.selfHeavyDirty).toBe(false);
    // The actor's own session is never re-marked (its ledger already has it).
    expect(actor.selfHeavyDirty).toBe(false);
    // A kill / quest / craft / level deed cannot move a Reliquary read, so the
    // grant syncs do NOT run for it (see the Horizons title case below).
    expect(synced).toEqual([]);
  });

  it('re-runs the grant syncs for a relic find and for a Horizons title deed, never for any other deed', () => {
    // The sibling's rank and completion reads can only move when the union
    // gained something catalogRankOwned scores: a relic, or a title deed on
    // the Horizons titles page. Every other deed growth skips the sync, which
    // would otherwise cost each online sibling an inventory + bank scan and a
    // catalog walk per deed any character earns.
    const { service, ledgers, add, synced } = rig();
    const actor = add(1, 7, 42);
    const alt = add(2, 7, 43);
    const earner = { characterId: 42, name: 'Hilda', cls: 'warrior' as const, day: DAY };
    // The premise, pinned against the live catalog: one id off the Horizons
    // titles page, one on it (a rank bridge is itself a Horizons title).
    expect(isHorizonsTitleDeed('prog_first_steps')).toBe(false);
    expect(isHorizonsTitleDeed('col_reliquary_rank_2')).toBe(true);
    recordAccountDeed(ledgers.get(1)!, 'prog_first_steps', earner);
    expect(service.noteDeedEarned(actor, 'prog_first_steps')).toBe(1);
    expect(alt.selfHeavyDirty).toBe(true); // the ledger still fans out...
    expect(synced).toEqual([]); // ...but nothing to re-score
    recordAccountDeed(ledgers.get(1)!, 'col_reliquary_rank_2', earner);
    expect(service.noteDeedEarned(actor, 'col_reliquary_rank_2')).toBe(1);
    expect(synced).toEqual([2]); // a Horizons title scores rank: sync
    recordAccountRelic(ledgers.get(1)!, 'item:cryptbone_helm', earner);
    expect(service.noteRelicFound(actor, 'item:cryptbone_helm')).toBe(1);
    expect(synced).toEqual([2, 2]); // a relic always syncs
  });

  it('is idempotent: a repeat changes no sibling and re-marks nobody', () => {
    const { service, ledgers, add, synced } = rig();
    const actor = add(1, 7, 42);
    const alt = add(2, 7, 43);
    recordAccountRelic(ledgers.get(1)!, 'item:cryptbone_helm', {
      characterId: 42,
      name: 'Hilda',
      cls: 'warrior',
      day: DAY,
    });
    expect(service.noteRelicFound(actor, 'item:cryptbone_helm')).toBe(1);
    alt.selfHeavyDirty = false;
    expect(service.noteRelicFound(actor, 'item:cryptbone_helm')).toBe(0);
    expect(alt.selfHeavyDirty).toBe(false);
    expect(ledgers.get(2)!.relics.get('item:cryptbone_helm')).toHaveLength(1);
    // One sync per real growth, never per repeat.
    expect(synced).toEqual([2]);
  });

  it('copies nothing when the actor ledger has no entry for that key or character', () => {
    const { service, ledgers, add } = rig();
    const actor = add(1, 7, 42);
    add(2, 7, 43);
    // An entry by a DIFFERENT character on the actor's ledger is not the
    // actor's earn: nothing to fan out.
    recordAccountDeed(ledgers.get(1)!, 'prog_first_steps', {
      characterId: 43,
      name: 'Alt',
      cls: 'mage',
      day: DAY,
    });
    expect(service.noteDeedEarned(actor, 'prog_first_steps')).toBe(0);
    expect(service.noteDeedEarned(actor, 'never_recorded')).toBe(0);
    expect(service.noteRelicFound(actor, 'item:nothing')).toBe(0);
    expect(ledgers.get(2)!.deeds.size).toBe(0);
  });

  it('skips a sibling whose sim meta is gone (a leave racing the tick)', () => {
    const { service, ledgers, add } = rig();
    const actor = add(1, 7, 42);
    const alt = add(2, 7, 43);
    ledgers.delete(2);
    recordAccountDeed(ledgers.get(1)!, 'd', {
      characterId: 42,
      name: 'H',
      cls: 'warrior',
      day: DAY,
    });
    expect(service.noteDeedEarned(actor, 'd')).toBe(0);
    expect(alt.selfHeavyDirty).toBe(false);
  });
});

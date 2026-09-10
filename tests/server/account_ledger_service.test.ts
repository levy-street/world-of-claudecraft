// AccountLedgerService (server/account_ledger_service.ts): the live fan-out of
// one character's deed earn or relic find to the account's OTHER live
// sessions. Drives the service over a fake host (the account_cosmetics_service
// test idiom): no GameServer, no sockets.
import { describe, expect, it } from 'vitest';
import {
  type AccountLedgerHost,
  AccountLedgerService,
  type LedgerSession,
} from '../../server/account_ledger_service';
import {
  type AccountLedger,
  freshAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../../src/sim/account_ledger';

function rig() {
  const ledgers = new Map<number, AccountLedger>();
  const sessions: LedgerSession[] = [];
  const add = (pid: number, accountId: number, characterId: number): LedgerSession => {
    ledgers.set(pid, freshAccountLedger());
    const s: LedgerSession = { pid, accountId, characterId, selfHeavyDirty: false };
    sessions.push(s);
    return s;
  };
  const host: AccountLedgerHost = {
    sim: () => ({
      meta: (pid: number) => {
        const accountLedger = ledgers.get(pid);
        return accountLedger ? { accountLedger } : null;
      },
    }),
    sessions: () => sessions,
  };
  return { service: new AccountLedgerService(host), ledgers, add };
}

const DAY = '2026-09-10';

describe('AccountLedgerService', () => {
  it('copies the actor entry to same-account siblings only, marking each heavy-dirty', () => {
    const { service, ledgers, add } = rig();
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
  });

  it('is idempotent: a repeat changes no sibling and re-marks nobody', () => {
    const { service, ledgers, add } = rig();
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

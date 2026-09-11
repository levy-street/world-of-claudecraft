// The account ledger pure module (src/sim/account_ledger.ts): record /
// dedupe / order, the change counter, the merge, the `acct` wire round-trip
// and its untrusted-decode arms, and the union reads the display lane
// consumes. Sim integration lives in tests/account_ledger_sim.test.ts.
import { describe, expect, it } from 'vitest';
import {
  type AccountEarner,
  type AccountLedger,
  accountDeedLookup,
  accountEarnedDays,
  accountLedgerRev,
  accountLedgerWireJson,
  accountRelicKey,
  accountRelicLookup,
  earnedByCharacter,
  freshAccountLedger,
  isKnownAccountDeedId,
  isKnownAccountRelicKey,
  mergeAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
  restoreAccountLedger,
  selfEarner,
  serializeAccountLedger,
} from '../src/sim/account_ledger';

const ALICE: AccountEarner = { characterId: 1, name: 'Alice', cls: 'warrior', day: '2026-09-01' };
const BOB: AccountEarner = { characterId: 2, name: 'Bob', cls: 'mage', day: '2026-09-05' };

describe('recording', () => {
  it('starts empty with a zero change counter', () => {
    const ledger = freshAccountLedger();
    expect(ledger.deeds.size).toBe(0);
    expect(ledger.relics.size).toBe(0);
    expect(accountLedgerRev(ledger)).toBe(0);
  });

  it('appends earners in order, dedupes per character, keeps the first day, and bumps the rev only on a new entry', () => {
    const ledger = freshAccountLedger();
    expect(recordAccountDeed(ledger, 'prog_first_steps', ALICE)).toBe(true);
    expect(recordAccountDeed(ledger, 'prog_first_steps', BOB)).toBe(true);
    expect(accountLedgerRev(ledger)).toBe(2);
    // A repeat by the same character (a later day) is a no-op that keeps the
    // recorded day and moves nothing.
    expect(recordAccountDeed(ledger, 'prog_first_steps', { ...ALICE, day: '2026-09-09' })).toBe(
      false,
    );
    expect(accountLedgerRev(ledger)).toBe(2);
    expect(ledger.deeds.get('prog_first_steps')).toEqual([ALICE, BOB]);
  });

  it('records relics under the kind-prefixed key so an item id and a mount key never collide', () => {
    const ledger = freshAccountLedger();
    expect(accountRelicKey('item', 'x')).toBe('item:x');
    expect(accountRelicKey('mark', 'x')).toBe('mark:x');
    expect(accountRelicKey('mount', 'x')).toBe('mount:x');
    expect(recordAccountRelic(ledger, accountRelicKey('item', 'x'), ALICE)).toBe(true);
    expect(recordAccountRelic(ledger, accountRelicKey('mount', 'x'), BOB)).toBe(true);
    expect(recordAccountRelic(ledger, accountRelicKey('item', 'x'), ALICE)).toBe(false);
    expect(ledger.relics.get('item:x')).toEqual([ALICE]);
    expect(ledger.relics.get('mount:x')).toEqual([BOB]);
    expect(accountLedgerRev(ledger)).toBe(2);
  });

  it('selfEarner reads the meta identity and lands characterId 0 for the offline sandbox', () => {
    expect(selfEarner({ name: 'Solo', cls: 'rogue' }, '2026-09-10')).toEqual({
      characterId: 0,
      name: 'Solo',
      cls: 'rogue',
      day: '2026-09-10',
    });
    expect(selfEarner({ characterId: 42, name: 'Hilda', cls: 'warrior' }, '').characterId).toBe(42);
  });

  it('merge folds every entry, dedupes per character, keeps existing earners first, and bumps once', () => {
    const into = freshAccountLedger();
    recordAccountDeed(into, 'd1', ALICE);
    recordAccountRelic(into, 'item:x', ALICE);
    const from = freshAccountLedger();
    recordAccountDeed(from, 'd1', BOB);
    recordAccountDeed(from, 'd1', ALICE); // duplicate
    recordAccountDeed(from, 'd2', BOB);
    recordAccountRelic(from, 'mark:m', BOB);
    const before = accountLedgerRev(into);
    mergeAccountLedger(into, from);
    expect(into.deeds.get('d1')).toEqual([ALICE, BOB]);
    expect(into.deeds.get('d2')).toEqual([BOB]);
    expect(into.relics.get('item:x')).toEqual([ALICE]);
    expect(into.relics.get('mark:m')).toEqual([BOB]);
    expect(accountLedgerRev(into)).toBe(before + 1);
    // Nothing new: no bump.
    mergeAccountLedger(into, from);
    expect(accountLedgerRev(into)).toBe(before + 1);
  });
});

describe('wire', () => {
  function scripted(): AccountLedger {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, 'prog_first_steps', ALICE);
    recordAccountDeed(ledger, 'prog_first_steps', BOB);
    recordAccountRelic(ledger, 'item:cryptbone_helm', BOB);
    recordAccountRelic(ledger, 'mount:valorsteed', ALICE);
    return ledger;
  }

  it('serializes to compact tuples and restores byte-for-byte equal maps', () => {
    const ledger = scripted();
    const wire = serializeAccountLedger(ledger);
    expect(wire).toEqual({
      d: {
        prog_first_steps: [
          [1, 'Alice', 'warrior', '2026-09-01'],
          [2, 'Bob', 'mage', '2026-09-05'],
        ],
      },
      r: {
        'item:cryptbone_helm': [[2, 'Bob', 'mage', '2026-09-05']],
        'mount:valorsteed': [[1, 'Alice', 'warrior', '2026-09-01']],
      },
    });
    const restored = restoreAccountLedger(JSON.parse(JSON.stringify(wire)));
    expect(restored.deeds).toEqual(ledger.deeds);
    expect(restored.relics).toEqual(ledger.relics);
  });

  it('memoizes the JSON per revision: identical string identity on a quiet re-read, a rebuild after an append', () => {
    const ledger = scripted();
    const a = accountLedgerWireJson(ledger);
    const b = accountLedgerWireJson(ledger);
    expect(b).toBe(a);
    expect(a).toBe(JSON.stringify(serializeAccountLedger(ledger)));
    recordAccountDeed(ledger, 'soc_meet_bursar', BOB);
    const c = accountLedgerWireJson(ledger);
    expect(c).not.toBe(a);
    expect(c).toContain('soc_meet_bursar');
  });

  it('degrades malformed wire to empty and drops bad tuples, prototype keys, and duplicate characters', () => {
    expect(restoreAccountLedger(null).deeds.size).toBe(0);
    expect(restoreAccountLedger('nope').relics.size).toBe(0);
    expect(restoreAccountLedger({ d: 7, r: [] }).deeds.size).toBe(0);
    const restored = restoreAccountLedger({
      d: {
        prog_first_steps: [
          [1, 'Alice', 'warrior', '2026-09-01'],
          [1, 'Alice again', 'warrior', '2026-09-02'], // duplicate character
          ['1', 'Bad', 'mage', ''], // non-numeric id
          [3, 'Short'], // too short
          'garbage',
        ],
        soc_meet_bursar: [['x']],
      },
      r: Object.create({ inherited: [[9, 'Ghost', 'mage', '']] }),
    });
    expect(restored.deeds.get('prog_first_steps')).toEqual([ALICE]);
    expect(restored.deeds.has('soc_meet_bursar')).toBe(false);
    expect(restored.relics.has('inherited')).toBe(false);
  });

  it('is catalog-bounded on decode (the PR #3933 rule): unknown deeds and relics drop, known kinds stay', () => {
    const e = [[1, 'Alice', 'warrior', '']];
    const restored = restoreAccountLedger({
      d: { not_a_deed: e, prog_first_steps: e },
      r: {
        'item:not_an_item': e,
        'item:cryptbone_helm': e,
        'mark:gather_event:pristine_vein': e,
        'mount:valorsteed': e,
        'mount:not_a_mount': e,
        'skin:anything': e,
        nocolon: e,
      },
    });
    expect([...restored.deeds.keys()]).toEqual(['prog_first_steps']);
    expect([...restored.relics.keys()].sort()).toEqual(
      ['item:cryptbone_helm', 'mark:gather_event:pristine_vein', 'mount:valorsteed'].sort(),
    );
    expect(isKnownAccountDeedId('__proto__')).toBe(false);
    expect(isKnownAccountRelicKey('item:')).toBe(false);
  });
});

describe('union reads', () => {
  it('accountRelicLookup answers own OR ledger, per kind, live', () => {
    const own = new Set(['a']);
    const ledger = freshAccountLedger();
    recordAccountRelic(ledger, 'item:b', BOB);
    recordAccountRelic(ledger, 'mount:c', BOB);
    const items = accountRelicLookup(own, ledger, 'item');
    expect(items.has('a')).toBe(true);
    expect(items.has('b')).toBe(true);
    expect(items.has('c')).toBe(false); // a MOUNT record never fills an item slot
    expect(accountRelicLookup(new Set(), ledger, 'mount').has('c')).toBe(true);
    // Live: a later append is visible without rebuilding the lookup.
    recordAccountRelic(ledger, 'item:d', ALICE);
    expect(items.has('d')).toBe(true);
  });

  it('accountDeedLookup answers own OR ledger', () => {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, 'alt_only', BOB);
    const lookup = accountDeedLookup(new Map([['own_only', '2026-09-01']]), ledger);
    expect(lookup.has('own_only')).toBe(true);
    expect(lookup.has('alt_only')).toBe(true);
    expect(lookup.has('nobody')).toBe(false);
  });

  it('accountEarnedDays keeps own days and own order first, then alt-only deeds with the first earner day', () => {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, 'shared', BOB); // alt earned it earlier than own day below
    recordAccountDeed(ledger, 'alt_only', BOB);
    recordAccountDeed(ledger, 'alt_only', ALICE);
    const own = new Map([
      ['own_only', '2026-09-08'],
      ['shared', '2026-09-09'],
    ]);
    const days = accountEarnedDays(own, ledger);
    expect([...days.entries()]).toEqual([
      ['own_only', '2026-09-08'],
      ['shared', '2026-09-09'], // own day wins for a deed this character earned
      ['alt_only', '2026-09-05'], // first ledger earner's day
    ]);
  });

  it('earnedByCharacter is a plain membership read', () => {
    expect(earnedByCharacter([ALICE, BOB], 2)).toBe(true);
    expect(earnedByCharacter([ALICE], 2)).toBe(false);
    expect(earnedByCharacter(undefined, 1)).toBe(false);
  });
});

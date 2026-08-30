// The doctrine tripwire for docs/claudium-store.md: a chargeback never
// un-grants slots. A player's purchasedSlots ladder position only ever GROWS
// while the character is resident (src/sim/bank.ts bankPurchasedSlotsFor
// documents the property and the store's fit gate rests on it), so every
// write to `purchasedSlots` across the sim and server must be either an
// increment (`+=`) or one of the exact allowlisted statements below: the two
// load-normalization floors (which run at join, before any reader exists) and
// the guild gold CAS pair (the guild BOOK is the documented exception whose
// escrow revert legitimately decreases). Any new write shape fails here and
// must argue its case against docs/claudium-store.md.
//
// Source-scan guard on the COMMENT-STRIPPED tree (tests/helpers): recursive
// (ts_files_under, so a module moved into a subdirectory never leaves the
// scan), and self-auditing: the census must keep finding the known increment
// sites, and every allowlist entry must still be consumed, so a refactor that
// moves or retires a sanctioned write shows up as drift here instead of
// leaving a stale exemption behind.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

interface PurchasedSlotsWrite {
  /** Scan-root-relative path prefixed with its root (e.g. 'src/sim/bank.ts'). */
  readonly file: string;
  /** The whole statement, whitespace-stripped for stable comparison. */
  readonly statement: string;
  /** The matched operator token. */
  readonly op: string;
}

// The exact non-increment statements the doctrine sanctions, keyed by file.
// Whitespace-stripped so formatting cannot dodge or break the pin.
const ALLOWLIST: readonly { file: string; statement: string }[] = [
  // The personal-bank load floor (sanitizeBankState): runs at join before any
  // reader exists, clamps a tampered blob, and cannot lower a legitimate
  // value (the clamp ceiling and the grant ceiling are the same table).
  {
    file: 'src/sim/bank.ts',
    statement:
      'letpurchasedSlots=Math.max(0,Math.min(BANK_PURCHASED_SLOTS_MAX,Math.floor(Number(r.purchasedSlots))||0),);',
  },
  {
    file: 'src/sim/bank.ts',
    statement: 'purchasedSlots-=purchasedSlots%BANK_EXPANSION_SLOTS;',
  },
  // The guild-book load floor (sanitizeGuildBankBook): the same join-time rule.
  {
    file: 'src/sim/guild_bank.ts',
    statement:
      'letpurchasedSlots=Math.max(0,Math.min(maxPurchased,Math.floor(Number(r.purchasedSlots))||0),);',
  },
  {
    file: 'src/sim/guild_bank.ts',
    statement: 'purchasedSlots=GUILD_BANK_LADDER_POSITIONS[guildBankRungsBought(purchasedSlots)];',
  },
  // The guild gold CAS pair: apply and compare-and-swap revert on the guild
  // BOOK, the one documented decrease (escrow revert), never the personal bank.
  {
    file: 'src/sim/guild_bank.ts',
    statement: 'book.purchasedSlots=d.purchasedSlotsAfter;',
  },
  {
    file: 'src/sim/guild_bank.ts',
    statement: 'book.purchasedSlots=d.purchasedSlotsBefore;',
  },
];

// `purchasedSlots` as the EXACT property/identifier (never purchasedSlotsAfter
// or purchasedSlotsBefore), followed by a mutating operator. `=(?!=)` keeps
// equality comparisons out; `<=`, `>=`, `!==` never start with a matching
// token. Increments (`+=`) are the doctrine's one universally legal shape.
const WRITE_RE =
  /purchasedSlots(?![A-Za-z0-9_$])\s*(\+\+|--|\+=|-=|\*=|\/=|%=|\*\*=|&&=|\|\|=|\?\?=|=(?!=))/g;

function statementAround(source: string, matchIndex: number): string {
  let start = matchIndex;
  while (start > 0 && !';{}'.includes(source[start - 1])) start--;
  let end = source.indexOf(';', matchIndex);
  if (end === -1) end = source.length - 1;
  return source.slice(start, end + 1);
}

function collectWrites(): PurchasedSlotsWrite[] {
  const writes: PurchasedSlotsWrite[] = [];
  for (const root of ['src/sim', 'server'] as const) {
    for (const entry of tsFilesUnder(path.resolve(process.cwd(), root))) {
      const source = stripComments(readFileSync(entry.full, 'utf8'));
      for (const match of source.matchAll(WRITE_RE)) {
        writes.push({
          file: `${root}/${entry.file}`,
          statement: statementAround(source, match.index).replace(/\s+/g, ''),
          op: match[1],
        });
      }
    }
  }
  return writes;
}

describe('storage grants are monotonic: purchasedSlots never decreases', () => {
  const writes = collectWrites();

  it('every write is an increment or an exact allowlisted statement', () => {
    const offenders = writes.filter(
      (write) =>
        write.op !== '+=' &&
        !ALLOWLIST.some(
          (allowed) => allowed.file === write.file && allowed.statement === write.statement,
        ),
    );
    expect(
      offenders,
      'a new purchasedSlots write shape landed. A chargeback never un-grants slots ' +
        '(docs/claudium-store.md; src/sim/bank.ts bankPurchasedSlotsFor documents the ' +
        'monotonicity the store fit gate rests on). Make it an increment, or argue the ' +
        'exception here beside the load floors and the guild CAS pair.',
    ).toEqual([]);
  });

  it('self-audit: the census still sees the known writers and no allowlist row is stale', () => {
    // The two personal-bank grant rails plus the two guild rung buys: if the
    // census stops finding increments, the scanner (not the code) broke.
    const increments = writes.filter((write) => write.op === '+=');
    expect(increments.map((w) => w.file)).toContain('src/sim/bank.ts');
    expect(increments.map((w) => w.file)).toContain('src/sim/guild_bank.ts');
    expect(increments.length).toBeGreaterThanOrEqual(4);

    // Every allowlisted statement must still exist verbatim: a moved or
    // reworded sanctioned write retires its row in the same change, so the
    // list can never accumulate dead exemptions a future write could hide in.
    for (const allowed of ALLOWLIST) {
      expect(
        writes.some(
          (write) => write.file === allowed.file && write.statement === allowed.statement,
        ),
        `stale allowlist row for ${allowed.file}: ${allowed.statement}`,
      ).toBe(true);
    }
  });
});

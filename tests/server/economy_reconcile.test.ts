// Conservation-check pins (server/economy_reconcile.ts).
//
// The interesting half of this suite is the STAGED DUPE scenarios: each one
// builds the ledger evidence a known duplication race would leave behind and
// asserts the reconciler names it. They are hand-built fixtures rather than
// live races on purpose. A real race needs two connections, a scheduler, and
// luck, so it is flaky by construction and tests nothing on the run where the
// race does not fire; the evidence it LEAVES is deterministic, and the evidence
// is what the reconciler's job is to read.
//
// The other half pins the reconciler's restraint: a clean window must produce
// nothing at all, and a window the writer admits it lost rows in must degrade
// to a warning instead of accusing anyone. An operator who is paged for a
// non-incident stops reading the next page.

import { describe, expect, it } from 'vitest';
import {
  checkChain,
  checkPersistedBalance,
  checkSupply,
  checkTransferSymmetry,
  type EconomyAlert,
  type ReconcileRow,
  reconcileWindow,
  totalFlows,
} from '../../server/economy_reconcile';

let nextId = 1;
function row(over: Partial<ReconcileRow> = {}): ReconcileRow {
  // Ids are auto-assigned unless the case pins one, so a fixture only states
  // the fields its assertion is about.
  const { id: overrideId, ...rest } = over;
  return {
    id: overrideId ?? nextId++,
    characterId: 1,
    kind: 'vendor_sell',
    holder: 'purse',
    amount: 0,
    balanceAfter: 0,
    prevLedgerId: null,
    counterpartyKind: null,
    counterpartyId: null,
    simTick: 100,
    ...rest,
  };
}

// Build a well-formed chain for one character from a list of deltas, so a test
// only has to state the movement it cares about and can then corrupt one row.
function chainOf(
  characterId: number,
  steps: { kind: ReconcileRow['kind']; amount: number; simTick?: number }[],
  startBalance = 0,
): ReconcileRow[] {
  let balance = startBalance;
  let prevId: number | null = null;
  const out: ReconcileRow[] = [];
  for (const s of steps) {
    balance += s.amount;
    const r = row({
      characterId,
      kind: s.kind,
      amount: s.amount,
      balanceAfter: balance,
      prevLedgerId: prevId,
      simTick: s.simTick ?? 100,
    });
    prevId = r.id;
    out.push(r);
  }
  return out;
}

const kinds = (alerts: EconomyAlert[]) => alerts.map((a) => a.kind);

describe('a clean window reports nothing', () => {
  it('stays silent on an internally consistent chain that matches the save', () => {
    const rows = chainOf(1, [
      { kind: 'mob_loot', amount: 500 },
      { kind: 'vendor_buy', amount: -120 },
      { kind: 'quest_reward', amount: 250 },
    ]);
    expect(checkChain(rows)).toEqual([]);
    expect(checkPersistedBalance(1, 630, 630)).toEqual([]);
    const flows = totalFlows(rows);
    expect(flows).toEqual({ minted: 750, burned: 120 });
    expect(
      checkSupply(
        0,
        { purses: 630, bankVaults: 0, guildTreasuries: 0, unclaimedMailCoin: 0, marketEscrow: 0 },
        flows,
        { droppedWrites: 0 },
      ),
    ).toEqual([]);
  });
});

describe('balance_after chaining detects a bypassed mutation', () => {
  it('flags a row whose balance does not follow from the previous one', () => {
    const rows = chainOf(1, [
      { kind: 'mob_loot', amount: 100 },
      { kind: 'mob_loot', amount: 100 },
    ]);
    // A mutation happened between the two rows without writing one: the purse
    // jumped by 5000 that no row explains.
    rows[1].balanceAfter = (rows[1].balanceAfter ?? 0) + 5000;
    const alerts = checkChain(rows);
    expect(kinds(alerts)).toEqual(['balance_mismatch']);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].delta).toBe(5000);
  });

  it('reports a missing row as a chain break, and does not also cry mismatch', () => {
    const rows = chainOf(1, [
      { kind: 'mob_loot', amount: 100 },
      { kind: 'mob_loot', amount: 100 },
    ]);
    // A dropped write: the link is broken and the arithmetic disagrees for the
    // very same reason. One finding, not two, or the operator is paged twice
    // for one incident.
    rows[1].prevLedgerId = 9999;
    expect(kinds(checkChain(rows))).toEqual(['chain_break']);
  });
});

describe('staged dupe scenarios', () => {
  it('catches a mail claim/cancel race: the coin is claimed and returned', () => {
    // The claimant's purse gains the coin (mail_claim credit) but the escrow
    // release half never lands because the cancel path also returned it, so
    // the tick nets non-zero.
    const rows: ReconcileRow[] = [
      row({ characterId: 1, kind: 'mail_claim', amount: 1000, balanceAfter: 1000, simTick: 400 }),
      // The pool half is MISSING: no matching -1000.
    ];
    const alerts = checkTransferSymmetry(rows);
    expect(kinds(alerts)).toEqual(['orphaned_transfer']);
    expect(alerts[0].delta).toBe(1000);
  });

  it('catches a trade acceptance race: both sides credited', () => {
    // A trade must net zero across its two rows. A race that ran the swap twice
    // for one side leaves both parties up.
    const rows: ReconcileRow[] = [
      row({ characterId: 1, kind: 'trade', amount: 500, balanceAfter: 500, simTick: 500 }),
      row({ characterId: 2, kind: 'trade', amount: 500, balanceAfter: 500, simTick: 500 }),
    ];
    const alerts = checkTransferSymmetry(rows);
    expect(kinds(alerts)).toEqual(['orphaned_transfer']);
    expect(alerts[0].delta).toBe(1000);
  });

  it('stays silent on a legitimate trade', () => {
    const rows: ReconcileRow[] = [
      row({ characterId: 1, kind: 'trade', amount: 500, balanceAfter: 500, simTick: 500 }),
      row({ characterId: 2, kind: 'trade', amount: -500, balanceAfter: 0, simTick: 500 }),
    ];
    expect(checkTransferSymmetry(rows)).toEqual([]);
  });

  it('catches a market list/cancel/buy race: paid once, escrowed twice', () => {
    // The buyer paid 1000 once, but the cancel racing the buy filled the
    // seller's box twice. Purchase and hold share a tick and a magnitude, so
    // the bucket nets the surplus hold.
    const rows: ReconcileRow[] = [
      row({
        characterId: 1,
        kind: 'market_purchase',
        amount: -1000,
        balanceAfter: 0,
        simTick: 600,
      }),
      row({
        characterId: 1,
        kind: 'market_escrow_hold',
        amount: 1000,
        balanceAfter: 1000,
        simTick: 600,
      }),
      row({
        characterId: 1,
        kind: 'market_escrow_hold',
        amount: 1000,
        balanceAfter: 2000,
        simTick: 600,
      }),
    ];
    const alerts = checkTransferSymmetry(rows);
    expect(kinds(alerts)).toEqual(['orphaned_transfer']);
    expect(alerts[0].delta).toBe(1000);
  });

  it('catches a guild bank deposit/withdraw race: treasury credited twice', () => {
    const rows: ReconcileRow[] = [
      row({
        characterId: 1,
        kind: 'guild_bank_deposit',
        amount: -300,
        balanceAfter: 0,
        simTick: 700,
      }),
      row({
        characterId: 1,
        kind: 'guild_bank_deposit',
        amount: 300,
        balanceAfter: 300,
        simTick: 700,
      }),
      row({
        characterId: 1,
        kind: 'guild_bank_deposit',
        amount: 300,
        balanceAfter: 600,
        simTick: 700,
      }),
    ];
    expect(kinds(checkTransferSymmetry(rows))).toEqual(['orphaned_transfer']);
  });

  it('catches a save-timer rollback: coin mailed out, then the persist dropped', () => {
    // The ledger says the purse ended at 200 (they mailed 800 away), but the
    // save that landed still carries the pre-mail 1000: the mailed coin now
    // exists in the letter AND in the restored purse.
    const alerts = checkPersistedBalance(1, 200, 1000);
    expect(kinds(alerts)).toEqual(['balance_mismatch']);
    expect(alerts[0].severity).toBe('critical');
    // Positive delta is the duplication direction: the world holds more than
    // the ledger can explain.
    expect(alerts[0].delta).toBe(800);
  });
});

describe('global supply identity', () => {
  it('flags coin that exists with no faucet behind it', () => {
    const alerts = checkSupply(
      1000,
      { purses: 6000, bankVaults: 0, guildTreasuries: 0, unclaimedMailCoin: 0, marketEscrow: 0 },
      { minted: 500, burned: 0 },
      { droppedWrites: 0 },
    );
    expect(kinds(alerts)).toEqual(['supply_mismatch']);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].delta).toBe(4500);
  });

  it('counts every pool, not just purses', () => {
    // 1000 opening, 500 minted, and the coin sitting in vaults, treasuries,
    // mail, and escrow all still counts as existing.
    expect(
      checkSupply(
        1000,
        {
          purses: 300,
          bankVaults: 500,
          guildTreasuries: 400,
          unclaimedMailCoin: 200,
          marketEscrow: 100,
        },
        { minted: 500, burned: 0 },
        { droppedWrites: 0 },
      ),
    ).toEqual([]);
  });

  it('excludes transfers from the flow totals', () => {
    // A busy trading window mints and burns nothing; counting transfers would
    // make the identity drift by the realm's entire trade volume.
    const rows: ReconcileRow[] = [
      row({ kind: 'trade', amount: 5000, balanceAfter: 5000 }),
      row({ kind: 'trade', amount: -5000, balanceAfter: 0 }),
      row({ kind: 'market_sale', amount: 900, balanceAfter: 900 }),
    ];
    expect(totalFlows(rows)).toEqual({ minted: 0, burned: 0 });
  });

  it('degrades to a warning when the writer admits it dropped rows', () => {
    const alerts = checkSupply(
      0,
      { purses: 9999, bankVaults: 0, guildTreasuries: 0, unclaimedMailCoin: 0, marketEscrow: 0 },
      { minted: 0, burned: 0 },
      { droppedWrites: 12 },
    );
    // Same arithmetic, different claim: rows the writer never wrote cannot be
    // told apart from rows a thief prevented, so this must not page anyone.
    expect(kinds(alerts)).toEqual(['evidence_incomplete']);
    expect(alerts[0].severity).toBe('warning');
  });
});

describe('reconcileWindow', () => {
  it('sorts findings most severe first', () => {
    const rows = chainOf(1, [
      { kind: 'mob_loot', amount: 100 },
      { kind: 'mob_loot', amount: 100 },
    ]);
    rows[1].prevLedgerId = 9999; // a warning
    const alerts = reconcileWindow({
      rowsByCharacter: new Map([[1, rows]]),
      openingSupply: 0,
      // A critical: the world holds coin no faucet in this window minted.
      closingSupply: {
        purses: 99999,
        bankVaults: 0,
        guildTreasuries: 0,
        unclaimedMailCoin: 0,
        marketEscrow: 0,
      },
      droppedWrites: 0,
    });
    expect(alerts[0].severity).toBe('critical');
    expect(alerts.some((a) => a.kind === 'chain_break')).toBe(true);
  });

  it('leaves the save comparison to the job, which asks it globally', () => {
    const rows = chainOf(7, [{ kind: 'mob_loot', amount: 100 }]);
    const alerts = reconcileWindow({
      rowsByCharacter: new Map([[7, rows]]),
      openingSupply: 0,
      closingSupply: {
        purses: 100,
        bankVaults: 0,
        guildTreasuries: 0,
        unclaimedMailCoin: 0,
        marketEscrow: 0,
      },
      droppedWrites: 0,
    });
    // A window is the wrong place to ask whether a save agrees with the ledger:
    // the character who was robbed may never move another coin, and one window
    // later they would be out of view. See economy_reconcile_job.ts.
    expect(alerts).toEqual([]);
  });
});

describe('pool rows are attributed to the actor without joining their chain', () => {
  // The exact evidence one market buy leaves: the buyer's purse debit, then the
  // seller's collection box filling, then the Merchant's cut burning. All three
  // carry the BUYER's character id, because the buyer is who moved the coin.
  function marketBuy(characterId: number, purseBefore: number) {
    const purchase = row({
      characterId,
      kind: 'market_purchase',
      amount: -1000,
      balanceAfter: purseBefore - 1000,
      counterpartyKind: 'pool',
      counterpartyId: 'market_escrow',
    });
    return [
      purchase,
      // The FULL price, matching the debit: the escrow briefly holds all of it
      // and the cut comes out on the next row. A hold booked at the post-cut
      // 950 would sit in a different (tick, magnitude) bucket from the -1000
      // debit and both halves would read as orphans on every market buy.
      row({
        characterId,
        kind: 'market_escrow_hold',
        holder: 'pool',
        amount: 1000,
        balanceAfter: 1000,
        counterpartyKind: 'character',
        counterpartyId: '77',
      }),
      // The burn names no counterparty at all, which is why `holder` and not
      // the counterparty column is what keeps it out of the chain.
      row({ characterId, kind: 'market_fee', holder: 'pool', amount: -50, balanceAfter: 950 }),
    ];
  }

  it('pairs the two halves of a real 5%-cut buy instead of calling both orphans', () => {
    // The regression this shape exists for: the cut makes the debit and the
    // hold differ, and a symmetry check that pairs on magnitude alone reports
    // TWO criticals per market buy on a healthy realm.
    expect(checkTransferSymmetry(marketBuy(3, 5000))).toEqual([]);
  });

  it('stays silent on a market buy instead of crying balance_mismatch', () => {
    const buy = marketBuy(3, 5000);
    // The buyer's next purse movement chains onto the debit, skipping the two
    // pool rows physically between them.
    const next = row({
      characterId: 3,
      kind: 'vendor_buy',
      amount: -400,
      balanceAfter: 3600,
      prevLedgerId: buy[0].id,
    });
    expect(checkChain([...buy, next])).toEqual([]);
  });

  it('closes the supply identity across a market buy, cut and all', () => {
    const buy = marketBuy(3, 5000);
    const alerts = reconcileWindow({
      rowsByCharacter: new Map([[3, buy]]),
      openingSupply: 5000,
      closingSupply: {
        purses: 4000,
        bankVaults: 0,
        guildTreasuries: 0,
        unclaimedMailCoin: 0,
        marketEscrow: 950,
        // 5000 - 50 burned = 4950, and the world holds 4000 + 950.
      },
      droppedWrites: 0,
    });
    expect(alerts).toEqual([]);
  });

  it('still counts a pool-side burn as a sink, or the identity would not close', () => {
    // The Merchant's cut is only ever booked on a pool row. A totalFlows that
    // skipped pool rows would leave the buyer's debit unexplained.
    expect(totalFlows(marketBuy(3, 5000))).toEqual({ minted: 0, burned: 50 });
  });
});

describe('unsaved character state degrades supply findings without blinding them', () => {
  const held = (purses: number) => ({
    purses,
    bankVaults: 0,
    guildTreasuries: 0,
    unclaimedMailCoin: 0,
    marketEscrow: 0,
  });

  it('excuses a gap the unsaved purses can account for', () => {
    // Faucets predict 1000, the saves add up to 1300, and characters whose save
    // has not caught up to their ledger disagree by 400. The gap is inside the
    // lag, so it is a warning an operator can ignore, not a page.
    const alerts = checkSupply(
      0,
      held(1300),
      { minted: 1000, burned: 0 },
      {
        droppedWrites: 0,
        unsettledCopper: 400,
      },
    );
    expect(kinds(alerts)).toEqual(['evidence_incomplete']);
    expect(alerts[0].severity).toBe('warning');
  });

  it('still pages when the gap is bigger than the lag can explain', () => {
    // Same window, but the drift only covers 100 of the 300. The remaining 200
    // is coin no amount of save lag can produce, so it pages. This is what
    // keeps the check alive on a realm that is never idle.
    const alerts = checkSupply(
      0,
      held(1300),
      { minted: 1000, burned: 0 },
      {
        droppedWrites: 0,
        unsettledCopper: 100,
      },
    );
    expect(kinds(alerts)).toEqual(['supply_mismatch']);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].delta).toBe(300);
  });

  it('lets a dropped write outrank the lag bound, because its size is unknown', () => {
    // A row the writer never wrote has an unknown amount, so it can explain any
    // gap; no bound applies and the finding degrades whatever the lag says.
    const alerts = checkSupply(
      0,
      held(9999),
      { minted: 0, burned: 0 },
      {
        droppedWrites: 1,
        unsettledCopper: 0,
      },
    );
    expect(kinds(alerts)).toEqual(['evidence_incomplete']);
  });
});

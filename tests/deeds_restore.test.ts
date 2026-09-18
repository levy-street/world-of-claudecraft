// The Book of Deeds' two join-time passes (src/sim/deeds_restore.ts), driven
// DIRECTLY rather than through Sim.addPlayer: the extraction's point was that
// a Vitest can import them. Pins the load-order facts the module comment
// states (days verbatim, renown recomputed, a stale title lands null, an
// alt-earned title survives because the ledger was handed in first) and the
// self seed that ends the retro pass (own deeds with their blob day, own
// relics undated).
import { describe, expect, it } from 'vitest';
import {
  type AccountEarner,
  freshAccountLedger,
  recordAccountDeed,
} from '../src/sim/account_ledger';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { restoreBookOfDeeds, runBookOfDeedsJoinRetro } from '../src/sim/deeds_restore';
import { type CharacterState, Sim } from '../src/sim/sim';

const CATALOGUE_RELIC = 'cryptbone_helm';
const TITLE_DEED = DEED_ORDER.find((id) => DEEDS[id].reward?.kind === 'title')!;
const ALT: AccountEarner = { characterId: 99, name: 'Bram', cls: 'mage', day: '2026-09-01' };

/** A fresh warrior sandbox plus its own serialized save as the restore input. */
function rig() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
  const pid = sim.playerId;
  const meta = sim.players.get(pid)!;
  const player = sim.entities.get(pid)!;
  const state: CharacterState = sim.serializeCharacter(pid)!;
  return { sim, meta, player, state };
}

function renownOf(deedIds: Iterable<string>): number {
  let total = 0;
  for (const id of deedIds) total += DEEDS[id]?.renown ?? 0;
  return total;
}

describe('restoreBookOfDeeds (driven directly)', () => {
  it('loads earned days verbatim, recomputes renown from the earned set, and lands a stale title as none', () => {
    const { meta, player, state } = rig();
    restoreBookOfDeeds(meta, player, {
      ...state,
      deeds: { soc_meet_bursar: '2026-08-01' },
      renown: 9999, // the saved number only feeds a SQL sort index
      activeTitle: 'no_such_deed',
    });
    expect(meta.deedsEarned.get('soc_meet_bursar')).toBe('2026-08-01');
    expect(meta.renown).not.toBe(9999);
    expect(meta.renown).toBe(renownOf(meta.deedsEarned.keys()));
    expect(meta.activeTitle).toBeNull();
  });

  it('keeps a title an ALT earned when the ledger was handed in before the restore', () => {
    const { meta, player, state } = rig();
    recordAccountDeed(meta.accountLedger, TITLE_DEED, ALT);
    restoreBookOfDeeds(meta, player, { ...state, activeTitle: TITLE_DEED });
    // Not this character's own earn, yet the validator accepts the union.
    expect(meta.deedsEarned.has(TITLE_DEED)).toBe(false);
    expect(meta.activeTitle).toBe(TITLE_DEED);
    // The same save with no ledger entry lands untitled: the ledger is what
    // carried it, not the saved id.
    const bare = rig();
    expect(bare.meta.accountLedger.deeds.size).toBe(0);
    restoreBookOfDeeds(bare.meta, bare.player, { ...bare.state, activeTitle: TITLE_DEED });
    expect(bare.meta.activeTitle).toBeNull();
  });
});

describe('runBookOfDeedsJoinRetro (driven directly)', () => {
  it('ends with the self seed: own deeds carry their blob day, own relics are undated, and the pass is retro-only', () => {
    const { sim, meta, player, state } = rig();
    meta.accountLedger = freshAccountLedger();
    restoreBookOfDeeds(meta, player, {
      ...state,
      deeds: { soc_meet_bursar: '2026-08-01' },
      deedStats: { itemsDiscovered: [CATALOGUE_RELIC] },
    });
    sim.drainEvents();
    runBookOfDeedsJoinRetro(sim.ctx, meta, player);
    expect(meta.accountLedger.deeds.get('soc_meet_bursar')).toEqual([
      { characterId: 0, name: meta.name, cls: 'warrior', day: '2026-08-01' },
    ]);
    expect(meta.accountLedger.relics.get(`item:${CATALOGUE_RELIC}`)).toEqual([
      { characterId: 0, name: meta.name, cls: 'warrior', day: '' },
    ]);
    // Every unlock the pass emitted is retro-flagged (silent on the client,
    // never fanned out by the server), and the dirty marks are cleared.
    const events = sim.drainEvents();
    for (const ev of events) {
      if (
        ev.type === 'deedUnlocked' ||
        ev.type === 'reliquaryUnlock' ||
        ev.type === 'relicRecorded'
      ) {
        expect(ev.retro, `${ev.type} from the join pass must be retro`).toBe(true);
      }
    }
    expect(sim.ctx.deedDirtyPids.has(player.id)).toBe(false);
    // Idempotent: a second pass appends nothing to the ledger.
    const deedsBefore = meta.accountLedger.deeds.size;
    const relicsBefore = meta.accountLedger.relics.size;
    runBookOfDeedsJoinRetro(sim.ctx, meta, player);
    expect(meta.accountLedger.deeds.size).toBe(deedsBefore);
    expect(meta.accountLedger.relics.size).toBe(relicsBefore);
  });
});

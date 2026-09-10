// The account ledger inside the sim (src/sim/account_ledger.ts wired through
// deeds.ts, reliquary.ts, and sim.ts): the grant paths append the acting
// character, the relicRecorded event fires once per (relic, character), the
// title/border validators accept an alt's deed, the display-lane reads union
// the ledger while the GRANT lane stays character-scoped, and the join seed
// lists the restored character for what its blob proves.
import { describe, expect, it } from 'vitest';
import {
  type AccountEarner,
  accountRelicKey,
  freshAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../src/sim/account_ledger';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { RELIQUARY_HORIZON_MOUNTS } from '../src/sim/content/reliquary';
import { grantDeed, markItemDiscovered, setActiveBorder, setActiveTitle } from '../src/sim/deeds';
import { mountItemId } from '../src/sim/mounts';
import {
  accountReliquaryOwnership,
  CURATOR_RANK_DEFS,
  catalogRankOwned,
  characterReliquaryOwnership,
  curatorRankFromOwned,
  noteReliquaryMark,
  RELIQUARY_COMPLETION_DEED_IDS,
  RELIQUARY_PAGES_BY_ID,
  seedAccountLedgerSelf,
  selfRelicKeys,
} from '../src/sim/reliquary';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const CATALOGUE_RELIC = 'cryptbone_helm';
const PAGE_ID = 'conquerors_hollow_crypt';
const MARK_ID = 'gather_event:pristine_vein';
const MOUNT_KEY = RELIQUARY_HORIZON_MOUNTS[0];
const TITLE_DEED = DEED_ORDER.find((id) => DEEDS[id].reward?.kind === 'title')!;
const BORDER_DEED = DEED_ORDER.find((id) => DEEDS[id].reward?.kind === 'border')!;

const ALT: AccountEarner = { characterId: 99, name: 'Bram', cls: 'mage', day: '2026-09-01' };

/** A complete, restorable CharacterState (a fresh warrior's save) with a patch
 *  spread over it: the restore path expects every array present. */
function fullState(patch: Partial<CharacterState>): CharacterState {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
  const base = sim.serializeCharacter(sim.playerId)!;
  return { ...base, ...patch };
}

function makeSim(opts?: {
  state?: CharacterState;
  ledger?: ReturnType<typeof freshAccountLedger>;
}) {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  if (opts?.state || opts?.ledger) {
    // A second, explicitly configured player beside the sandbox primary.
    const pid = sim.addPlayer('warrior', 'Second', {
      state: opts.state,
      characterId: 42,
      accountLedger: opts.ledger,
      autoEquip: false,
    });
    return { sim, meta: sim.players.get(pid)!, e: sim.entities.get(pid)!, pid };
  }
  const pid = sim.playerId;
  return { sim, meta: sim.players.get(pid)!, e: sim.entities.get(pid)!, pid };
}

function relicEvents(evs: SimEvent[]): Extract<SimEvent, { type: 'relicRecorded' }>[] {
  return evs.filter(
    (ev): ev is Extract<SimEvent, { type: 'relicRecorded' }> => ev.type === 'relicRecorded',
  );
}

describe('grant paths append the acting character', () => {
  it('grantDeed records the earner with the host utcDay, once', () => {
    const { sim, meta } = makeSim();
    sim.utcDay = '2026-09-10';
    expect(grantDeed(sim.ctx, meta, 'soc_meet_bursar')).toBe(true);
    const earners = meta.accountLedger.deeds.get('soc_meet_bursar');
    expect(earners).toEqual([
      { characterId: 0, name: meta.name, cls: 'warrior', day: '2026-09-10' },
    ]);
    expect(grantDeed(sim.ctx, meta, 'soc_meet_bursar')).toBe(false);
    expect(meta.accountLedger.deeds.get('soc_meet_bursar')).toHaveLength(1);
  });

  it('a catalogued item discover records item:<id> and emits relicRecorded once; a non-relic item records nothing', () => {
    const { sim, meta } = makeSim();
    sim.tick(); // drain the join
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    markItemDiscovered(sim.ctx, meta, 'bone_fragments');
    const evs = relicEvents(sim.tick());
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      key: accountRelicKey('item', CATALOGUE_RELIC),
      pid: meta.entityId,
    });
    expect(evs[0].retro).toBeUndefined();
    expect(meta.accountLedger.relics.has('item:cryptbone_helm')).toBe(true);
    expect(meta.accountLedger.relics.has('item:bone_fragments')).toBe(false);
  });

  it('a retro discover carries the retro flag on its record event', () => {
    const { sim, meta } = makeSim();
    sim.tick();
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC, undefined, { retro: true });
    const evs = relicEvents(sim.tick());
    expect(evs).toHaveLength(1);
    expect(evs[0].retro).toBe(true);
  });

  it('an authored mark records mark:<id>; mount reins record mount:<key>', () => {
    const { sim, meta, pid } = makeSim();
    sim.tick();
    expect(noteReliquaryMark(sim.ctx, meta, MARK_ID)).toBe(true);
    const reins = mountItemId(MOUNT_KEY);
    expect(reins).not.toBeNull();
    sim.addItem(reins!, 1, pid);
    const keys = relicEvents(sim.tick()).map((ev) => ev.key);
    expect(keys).toContain(`mark:${MARK_ID}`);
    expect(keys).toContain(`mount:${MOUNT_KEY}`);
    expect(meta.accountLedger.relics.get(`mount:${MOUNT_KEY}`)?.[0].characterId).toBe(0);
  });
});

describe('the cosmetic validators are account-wide', () => {
  it('setActiveTitle / setActiveBorder accept a deed only an alt earned, still refuse unearned ones', () => {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, TITLE_DEED, ALT);
    recordAccountDeed(ledger, BORDER_DEED, ALT);
    const { meta, e } = makeSim({ ledger });
    expect(meta.deedsEarned.has(TITLE_DEED)).toBe(false);
    setActiveTitle(meta, e, TITLE_DEED);
    expect(meta.activeTitle).toBe(TITLE_DEED);
    expect(e.title).toBe(TITLE_DEED);
    setActiveBorder(meta, e, BORDER_DEED);
    expect(meta.activeBorder).toBe(BORDER_DEED);
    // A kind mismatch through the ledger is refused exactly like an own earn.
    setActiveTitle(meta, e, BORDER_DEED);
    expect(meta.activeTitle).toBe(TITLE_DEED);
    // Nobody on the account earned this one.
    const { meta: bare, e: bareE } = makeSim();
    setActiveTitle(bare, bareE, TITLE_DEED);
    expect(bare.activeTitle).toBeNull();
  });

  it('a saved title an alt earned survives the restore-time re-apply when the ledger rides the join', () => {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, TITLE_DEED, ALT);
    const state = fullState({ activeTitle: TITLE_DEED });
    const withLedger = makeSim({ state, ledger });
    expect(withLedger.meta.activeTitle).toBe(TITLE_DEED);
    const without = makeSim({ state });
    expect(without.meta.activeTitle).toBeNull();
  });
});

describe('display lane unions the ledger, grant lane stays character-scoped', () => {
  it('Sim facet completion counts an alt-found relic; the character-scoped rank surface does not', () => {
    const { sim, meta } = makeSim();
    expect(sim.reliquaryPageCompletion(PAGE_ID)?.owned).toBe(0);
    recordAccountRelic(meta.accountLedger, accountRelicKey('item', CATALOGUE_RELIC), ALT);
    expect(sim.reliquaryPageCompletion(PAGE_ID)?.owned).toBe(1);
    expect(sim.reliquaryCuratorRank()).toBe(1);
    expect(sim.reliquaryAccountFinds.get('item:cryptbone_helm')).toEqual([ALT]);
    // The character's own surfaces are untouched: no invented discovery.
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(0);
    expect(catalogRankOwned(accountReliquaryOwnership(meta))).toBe(1);
  });

  it('an alt filling the whole Hollow Crypt page shows it complete here without granting this character its rank or illumination deeds', () => {
    const { sim, meta } = makeSim();
    for (const relic of RELIQUARY_PAGES_BY_ID[PAGE_ID].relics) {
      if (relic.kind === 'item') {
        recordAccountRelic(meta.accountLedger, accountRelicKey('item', relic.itemId), ALT);
      }
    }
    const page = sim.reliquaryPageCompletion(PAGE_ID)!;
    expect(page.complete).toBe(true);
    expect(page.owned).toBe(page.total);
    const accountRank = curatorRankFromOwned(catalogRankOwned(accountReliquaryOwnership(meta)));
    expect(sim.reliquaryCuratorRank()).toBe(accountRank);
    expect(accountRank).toBeGreaterThanOrEqual(1);
    sim.tick();
    // The grant lane is character-scoped: this character found nothing, so no
    // rank bridge and no completion-ladder deed lands on it (the alt's own
    // grants are listed under the alt in the account's Book).
    for (const def of CURATOR_RANK_DEFS) {
      if (def.deedId) expect(meta.deedsEarned.has(def.deedId), def.deedId).toBe(false);
    }
    for (const id of RELIQUARY_COMPLETION_DEED_IDS) {
      expect(meta.deedsEarned.has(id), id).toBe(false);
    }
  });

  it('accountDeeds exposes the ledger deed half and marks/mounts union through the account surfaces', () => {
    const { sim, meta } = makeSim();
    recordAccountDeed(meta.accountLedger, 'soc_meet_bursar', ALT);
    recordAccountRelic(meta.accountLedger, accountRelicKey('mark', MARK_ID), ALT);
    recordAccountRelic(meta.accountLedger, accountRelicKey('mount', MOUNT_KEY), ALT);
    expect(sim.accountDeeds.get('soc_meet_bursar')).toEqual([ALT]);
    expect(sim.deedsEarned.has('soc_meet_bursar')).toBe(false);
    const own = accountReliquaryOwnership(meta);
    expect(own.marks.has(MARK_ID)).toBe(true);
    expect(own.ownedMounts.has(MOUNT_KEY)).toBe(true);
    expect(own.deedsEarned.has('soc_meet_bursar')).toBe(true);
    expect(meta.reliquary.marks.has(MARK_ID)).toBe(false);
  });
});

describe('join seed', () => {
  it('selfRelicKeys lists catalogued discoveries, every mark, and owned mounts, nothing else', () => {
    const { sim, meta, pid } = makeSim();
    meta.deedStats.itemsDiscovered.add(CATALOGUE_RELIC);
    meta.deedStats.itemsDiscovered.add('bone_fragments');
    meta.reliquary.marks.add(MARK_ID);
    sim.addItem(mountItemId(MOUNT_KEY)!, 1, pid);
    const keys = selfRelicKeys(meta);
    expect(keys).toContain(`item:${CATALOGUE_RELIC}`);
    expect(keys).toContain(`mark:${MARK_ID}`);
    expect(keys).toContain(`mount:${MOUNT_KEY}`);
    expect(keys.some((k) => k.includes('bone_fragments'))).toBe(false);
  });

  it('a restored blob lists the character for its own deeds (own day kept) and relics, folded over the loaded ledger', () => {
    const ledger = freshAccountLedger();
    recordAccountDeed(ledger, 'soc_meet_bursar', ALT);
    const state = fullState({
      deeds: { soc_meet_bursar: '2026-08-01', col_glimmerfin: '2026-08-02' },
      deedStats: { itemsDiscovered: [CATALOGUE_RELIC] },
    });
    const { meta } = makeSim({ state, ledger });
    // The alt stays first (loaded rows precede the seed); self follows with
    // its OWN earned day, not the join day.
    expect(
      meta.accountLedger.deeds.get('soc_meet_bursar')?.map((e) => [e.characterId, e.day]),
    ).toEqual([
      [99, '2026-09-01'],
      [42, '2026-08-01'],
    ]);
    expect(meta.accountLedger.deeds.get('col_glimmerfin')?.[0]).toMatchObject({
      characterId: 42,
      day: '2026-08-02',
    });
    expect(meta.accountLedger.relics.get(`item:${CATALOGUE_RELIC}`)?.[0].characterId).toBe(42);
    // Re-seeding is a no-op.
    const { sim } = makeSim();
    expect(seedAccountLedgerSelf(sim.ctx, meta)).toBe(0);
  });
});

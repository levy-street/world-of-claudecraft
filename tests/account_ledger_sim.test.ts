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
  noteReliquaryMark,
  pageCompletion,
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
// The flagship page whose full illumination grants a completion-ladder deed
// (RELIQUARY_ILLUMINATION_DEED_PAGES); its relics are all items.
const FLAGSHIP_DEED = 'col_reliquary_illum_thunzharr';
const FLAGSHIP_PAGE = 'conquerors_thunzharr';
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

describe('both lanes read the account union: display, and the Reliquary-derived grants', () => {
  it('Sim facet completion counts an alt-found relic, and so does the grant-lane ownership read', () => {
    const { sim, meta } = makeSim();
    expect(sim.reliquaryPageCompletion(PAGE_ID)?.owned).toBe(0);
    recordAccountRelic(meta.accountLedger, accountRelicKey('item', CATALOGUE_RELIC), ALT);
    expect(sim.reliquaryPageCompletion(PAGE_ID)?.owned).toBe(1);
    expect(sim.reliquaryCuratorRank()).toBe(1);
    expect(sim.reliquaryAccountFinds.get('item:cryptbone_helm')).toEqual([ALT]);
    // The character's own discovery set is untouched: the union, never a copy.
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
    // Both ownership reads are the same union now (the maintainer ruling).
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(1);
    expect(catalogRankOwned(accountReliquaryOwnership(meta))).toBe(1);
  });

  it('an alt logging in receives the deeds the account already qualifies for, retro-flagged and recorded under its own name', () => {
    // The alt (Bram) found every Thunzharr relic; this character (id 42)
    // joins with that ledger and has found nothing itself.
    const ledger = freshAccountLedger();
    for (const relic of RELIQUARY_PAGES_BY_ID[FLAGSHIP_PAGE].relics) {
      if (relic.kind === 'item') {
        recordAccountRelic(ledger, accountRelicKey('item', relic.itemId), ALT);
      }
    }
    recordAccountDeed(ledger, FLAGSHIP_DEED, ALT);
    const { sim, meta } = makeSim({ ledger });
    // The union (this second player's grant-lane read, not the sandbox
    // primary's facet) completes the page.
    const page = pageCompletion(
      RELIQUARY_PAGES_BY_ID[FLAGSHIP_PAGE],
      characterReliquaryOwnership(meta),
    );
    expect(page.complete).toBe(true);
    // The join retro granted the Illumination deed to this character too, and
    // the ledger now lists BOTH characters as earners, the alt first.
    expect(meta.deedsEarned.has(FLAGSHIP_DEED)).toBe(true);
    expect(meta.accountLedger.deeds.get(FLAGSHIP_DEED)?.map((e) => e.characterId)).toEqual([
      99, 42,
    ]);
    // The Illumination title is a catalogued fill: nine relics plus it is ten
    // owned, so the rank 2 bridge lands in the same pass (recorded too) and
    // nothing above it is invented. The own discovery set stays empty of relics.
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(meta.accountLedger.deeds.get('col_reliquary_rank_2')?.map((e) => e.characterId)).toEqual(
      [42],
    );
    for (const def of CURATOR_RANK_DEFS) {
      if (def.rank >= 3 && def.deedId) {
        expect(meta.deedsEarned.has(def.deedId), def.deedId).toBe(false);
      }
    }
    const relics = RELIQUARY_PAGES_BY_ID[FLAGSHIP_PAGE].relics;
    expect(
      relics.some((r) => r.kind === 'item' && meta.deedStats.itemsDiscovered.has(r.itemId)),
    ).toBe(false);
    // The retro grant drained as a retro event (no live banner).
    const evs = sim
      .tick()
      .filter(
        (ev): ev is Extract<SimEvent, { type: 'deedUnlocked' }> =>
          ev.type === 'deedUnlocked' && ev.deedId === FLAGSHIP_DEED,
      );
    expect(evs).toHaveLength(1);
    expect(evs[0].retro).toBe(true);
  });

  it('a fill on THIS character that completes a flagship page through the union grants the illumination deed, with this character recorded', () => {
    const { sim, meta } = makeSim();
    sim.tick();
    const relics = RELIQUARY_PAGES_BY_ID[FLAGSHIP_PAGE].relics.filter((r) => r.kind === 'item');
    expect(relics.length).toBeGreaterThan(2);
    const last = relics[relics.length - 1];
    if (last.kind !== 'item') throw new Error('flagship page ends in a non-item relic');
    for (const relic of relics.slice(0, -1)) {
      if (relic.kind === 'item') {
        recordAccountRelic(meta.accountLedger, accountRelicKey('item', relic.itemId), ALT);
      }
    }
    expect(sim.reliquaryPageCompletion(FLAGSHIP_PAGE)?.complete).toBe(false);
    expect(meta.deedsEarned.has(FLAGSHIP_DEED)).toBe(false);
    markItemDiscovered(sim.ctx, meta, last.itemId);
    // The fill chain read the union: the page completed and the Illumination
    // deed landed on the finder, live (not retro), recorded under its name.
    expect(sim.reliquaryPageCompletion(FLAGSHIP_PAGE)?.complete).toBe(true);
    expect(meta.deedsEarned.has(FLAGSHIP_DEED)).toBe(true);
    expect(meta.accountLedger.deeds.get(FLAGSHIP_DEED)?.map((e) => e.characterId)).toEqual([0]);
    const evs = sim
      .tick()
      .filter((ev) => ev.type === 'deedUnlocked' && ev.deedId === FLAGSHIP_DEED);
    expect(evs).toHaveLength(1);
    expect((evs[0] as { retro?: boolean }).retro).toBeUndefined();
  });

  it('a relic an alt already holds does not fake a rank crossing when this character finds it too', () => {
    // Eight alt-found relics (the page one short of complete, so no ladder
    // title moves the count) put the account at Curator rank 1; this
    // character finding one of the SAME eight moves no count, so no rank-up
    // rides the unlock event and no deed lands.
    const { sim, meta } = makeSim();
    sim.tick();
    const relics = RELIQUARY_PAGES_BY_ID[FLAGSHIP_PAGE].relics.slice(0, -1);
    for (const relic of relics) {
      if (relic.kind === 'item') {
        recordAccountRelic(meta.accountLedger, accountRelicKey('item', relic.itemId), ALT);
      }
    }
    const first = relics[0];
    if (first.kind !== 'item') throw new Error('expected an item relic');
    const before = catalogRankOwned(characterReliquaryOwnership(meta));
    expect(before).toBe(relics.length);
    const deedsBefore = meta.deedsEarned.size;
    markItemDiscovered(sim.ctx, meta, first.itemId);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(before);
    expect(meta.deedsEarned.size).toBe(deedsBefore);
    // This character is now the relic's SECOND finder on the ledger.
    expect(
      meta.accountLedger.relics
        .get(accountRelicKey('item', first.itemId))
        ?.map((e) => e.characterId),
    ).toEqual([99, 0]);
    const unlock = sim
      .tick()
      .find((ev) => ev.type === 'reliquaryUnlock' && ev.itemId === first.itemId) as
      | { curatorRank?: number }
      | undefined;
    expect(unlock).toBeDefined();
    expect(unlock?.curatorRank).toBeUndefined();
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

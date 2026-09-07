// The account-bound Reliquary: the pure ledger module (src/sim/reliquary_account.ts),
// the union every completion read applies (withAccountRelics), the shared host reads
// (src/sim/reliquary_reads.ts), the PlayerMeta stamp through Sim.addPlayer, the
// cosmetics wire decode, and online/offline parity for a ledger-only fill.
import { describe, expect, it } from 'vitest';
import { normalizeAccountCosmetics } from '../src/net/account_cosmetics_wire';
import {
  RELIQUARY_HORIZON_MOUNTS,
  RELIQUARY_HORIZON_TITLES,
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_MARK_IDS,
  RELIQUARY_PAGES,
} from '../src/sim/content/reliquary';
import {
  CURATOR_RANK_DEFS,
  catalogCharacterCompletion,
  catalogRankOwned,
  characterReliquaryOwnership,
  curatorRankFromOwned,
  withAccountRelics,
} from '../src/sim/reliquary';
import {
  accountReliquaryLedgerFromOwnership,
  accountReliquaryLedgerSize,
  emptyAccountReliquaryLedger,
  isAccountReliquaryLedgerEmpty,
  mergeAccountReliquaryLedger,
  mergeOptionalAccountReliquaryLedgers,
  normalizeAccountReliquaryLedger,
} from '../src/sim/reliquary_account';
import { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

const RELIC = 'cryptbone_helm';
const MARK = [...RELIQUARY_MARK_IDS][0];
const MOUNT = RELIQUARY_HORIZON_MOUNTS[0];
const TITLE = RELIQUARY_HORIZON_TITLES[0];
const PAGE_OF_RELIC = RELIQUARY_ITEM_TO_PAGES.get(RELIC)?.[0] as string;

/** Catalogued item ids on SCORING pages only (an excludeFromCompletion page's
 *  relics fill their page but never the pair or the rank). */
function cataloguedItemIds(): string[] {
  return [
    ...new Set(
      RELIQUARY_PAGES.filter((p) => !p.excludeFromCompletion).flatMap((p) =>
        p.relics.flatMap((r) => (r.kind === 'item' ? [r.itemId] : [])),
      ),
    ),
  ];
}

/** Stamp a ledger the way the server does: onto the primary meta (the grant
 *  paths) AND onto the cosmetics facet (the IWorld reads, same carrier the
 *  online mirror decodes from the `cosmetics` self key). */
function stampPrimary(sim: Sim, ledger: Parameters<typeof withAccountRelics>[1]) {
  const meta = sim.players.get(sim.playerId)!;
  if (ledger) {
    meta.accountRelics = ledger;
    sim.accountCosmetics = { ...sim.accountCosmetics, reliquary: ledger };
  }
  return meta;
}

function newSim(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
}

describe('normalizeAccountReliquaryLedger', () => {
  it('keeps only catalogued ids per kind, sorted and de-duped; junk decodes to empty', () => {
    expect(RELIQUARY_ITEM_TO_PAGES.has(RELIC)).toBe(true);
    const out = normalizeAccountReliquaryLedger({
      items: [RELIC, 'not_a_relic', RELIC, 7, 'aaa_not_catalogued'],
      marks: [MARK, 'slain:nobody'],
      mounts: [MOUNT, 'not_a_mount'],
      titles: [TITLE, 'not_a_title'],
      extra: ['ignored'],
    });
    expect(out).toEqual({ items: [RELIC], marks: [MARK], mounts: [MOUNT], titles: [TITLE] });
    expect(normalizeAccountReliquaryLedger(undefined)).toEqual(emptyAccountReliquaryLedger());
    expect(normalizeAccountReliquaryLedger([RELIC])).toEqual(emptyAccountReliquaryLedger());
    expect(normalizeAccountReliquaryLedger({ items: 'x', marks: null })).toEqual(
      emptyAccountReliquaryLedger(),
    );
    // A mark id is not an item id and vice versa: kinds never cross.
    expect(normalizeAccountReliquaryLedger({ items: [MARK], marks: [RELIC] })).toEqual(
      emptyAccountReliquaryLedger(),
    );
  });

  it('sorts so equal ledgers are byte-stable', () => {
    const ids = cataloguedItemIds().slice(0, 3);
    const a = normalizeAccountReliquaryLedger({ items: [...ids].reverse() });
    const b = normalizeAccountReliquaryLedger({ items: ids });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.items).toEqual([...ids].sort());
  });
});

describe('ledger helpers', () => {
  it('sizes and emptiness read across every kind', () => {
    expect(isAccountReliquaryLedgerEmpty(undefined)).toBe(true);
    expect(isAccountReliquaryLedgerEmpty(emptyAccountReliquaryLedger())).toBe(true);
    const l = { items: [RELIC], marks: [], mounts: [MOUNT], titles: [] };
    expect(isAccountReliquaryLedgerEmpty(l)).toBe(false);
    expect(accountReliquaryLedgerSize(l)).toBe(2);
    expect(accountReliquaryLedgerSize(undefined)).toBe(0);
  });

  it('accountReliquaryLedgerFromOwnership picks the catalogued ids each surface owns', () => {
    const ledger = accountReliquaryLedgerFromOwnership({
      itemsDiscovered: new Set([RELIC, 'linen_cloth']),
      marks: new Set([MARK]),
      ownedMounts: new Set([MOUNT]),
      deedsEarned: new Set([TITLE, 'prog_not_a_title_relic']),
    });
    expect(ledger).toEqual({ items: [RELIC], marks: [MARK], mounts: [MOUNT], titles: [TITLE] });
  });

  it('merge reports growth and returns the base object itself when nothing is new', () => {
    const base = { items: [RELIC], marks: [], mounts: [], titles: [] };
    const same = mergeAccountReliquaryLedger(base, {
      items: [RELIC],
      marks: [],
      mounts: [],
      titles: [],
    });
    expect(same.grew).toBe(false);
    expect(same.ledger).toBe(base);
    const other = cataloguedItemIds().find((id) => id !== RELIC) as string;
    const grown = mergeAccountReliquaryLedger(base, {
      items: [other, RELIC],
      marks: [MARK],
      mounts: [],
      titles: [],
    });
    expect(grown.grew).toBe(true);
    expect(grown.added).toEqual({ items: [other], marks: [MARK], mounts: [], titles: [] });
    expect(grown.ledger.items).toEqual([RELIC, other].sort());
    expect(grown.ledger.marks).toEqual([MARK]);
    // The base was not mutated (a held live ledger is replaced, never edited).
    expect(base.items).toEqual([RELIC]);
  });

  it('mergeOptionalAccountReliquaryLedgers keeps the pre-ledger shape when both are absent', () => {
    expect(mergeOptionalAccountReliquaryLedgers(undefined, undefined)).toBeUndefined();
    const l = { items: [RELIC], marks: [], mounts: [], titles: [] };
    expect(mergeOptionalAccountReliquaryLedgers(l, undefined)).toBe(l);
    expect(mergeOptionalAccountReliquaryLedgers(undefined, l)).toBe(l);
    expect(
      mergeOptionalAccountReliquaryLedgers(l, { items: [], marks: [MARK], mounts: [], titles: [] }),
    ).toEqual({ items: [RELIC], marks: [MARK], mounts: [], titles: [] });
  });
});

describe('withAccountRelics', () => {
  it('returns the very same surfaces object for an absent or empty ledger', () => {
    const surfaces = { itemsDiscovered: new Set<string>(), marks: new Set<string>() };
    expect(withAccountRelics(surfaces, undefined)).toBe(surfaces);
    expect(withAccountRelics(surfaces, emptyAccountReliquaryLedger())).toBe(surfaces);
  });

  it('answers own OR ledger on every kind but weapon skins', () => {
    const skins = new Set(['skin_x']);
    const out = withAccountRelics(
      {
        itemsDiscovered: new Set(['own_item']),
        marks: new Set(['own_mark']),
        ownedMounts: new Set(['own_mount']),
        weaponSkins: skins,
        deedsEarned: new Set(['own_deed']),
      },
      { items: [RELIC], marks: [MARK], mounts: [MOUNT], titles: [TITLE] },
    );
    expect(out.itemsDiscovered.has('own_item')).toBe(true);
    expect(out.itemsDiscovered.has(RELIC)).toBe(true);
    expect(out.itemsDiscovered.has('other')).toBe(false);
    expect(out.marks?.has('own_mark')).toBe(true);
    expect(out.marks?.has(MARK)).toBe(true);
    expect(out.ownedMounts?.has(MOUNT)).toBe(true);
    expect(out.deedsEarned?.has(TITLE)).toBe(true);
    expect(out.deedsEarned?.has('own_deed')).toBe(true);
    expect(out.weaponSkins).toBe(skins);
  });

  it('fills a missing surface from the ledger alone (a host that passes no marks)', () => {
    const out = withAccountRelics(
      { itemsDiscovered: new Set<string>() } as {
        itemsDiscovered: Set<string>;
        marks?: Set<string>;
        ownedMounts?: Set<string>;
      },
      { items: [], marks: [MARK], mounts: [], titles: [] },
    );
    expect(out.marks?.has(MARK)).toBe(true);
    expect(out.ownedMounts?.has(MOUNT)).toBe(false);
  });
});

describe('Sim: the account ledger is a live-only stamp every completion read unions', () => {
  it('fills a page, the catalog pair, and the rank from the ledger alone', () => {
    const sim = newSim();
    const meta = stampPrimary(sim, {
      items: [RELIC],
      marks: [MARK],
      mounts: [MOUNT],
      titles: [TITLE],
    });
    // The character itself owns none of it.
    expect(meta.deedStats.itemsDiscovered.has(RELIC)).toBe(false);
    expect(meta.reliquary.marks.has(MARK)).toBe(false);
    expect(meta.deedsEarned.has(TITLE)).toBe(false);
    expect(sim.reliquaryPageCompletion(PAGE_OF_RELIC)?.owned).toBeGreaterThanOrEqual(1);
    // Four ledger fills, each on a distinct kind, all count once.
    expect(sim.reliquaryCatalogCompletion().owned).toBe(4);
    expect(sim.reliquaryCuratorRank()).toBe(1);
    // The grant-path union (characterReliquaryOwnership) agrees with the facet.
    expect(catalogCharacterCompletion(characterReliquaryOwnership(meta)).owned).toBe(4);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(4);
  });

  it('defaults to an empty ledger offline and answers exactly as before', () => {
    const sim = newSim();
    const meta = sim.players.get(sim.playerId)!;
    expect(meta.accountRelics).toEqual(emptyAccountReliquaryLedger());
    expect(sim.reliquaryCatalogCompletion().owned).toBe(0);
    expect(sim.reliquaryCuratorRank()).toBe(0);
  });

  it('never serializes the stamp onto the character', () => {
    const sim = newSim();
    const pid = sim.addPlayer('warrior', 'Alt', {
      accountRelics: { items: [RELIC], marks: [], mounts: [], titles: [] },
    });
    const json = JSON.stringify(sim.serializeCharacter(pid));
    expect(json).not.toContain('accountRelics');
    // Ownership authority stays the character's own discovery set: a ledger
    // fill is not written into itemsDiscovered.
    expect(json).not.toContain(RELIC);
  });

  it('addPlayer stamps the ledger the server hands it (the join path)', () => {
    const sim = newSim();
    const pid = sim.addPlayer('warrior', 'Alt', {
      accountRelics: { items: [RELIC], marks: [], mounts: [], titles: [] },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.accountRelics.items).toEqual([RELIC]);
    expect(characterReliquaryOwnership(meta).itemsDiscovered.has(RELIC)).toBe(true);
  });

  it('grants the rank deed bridges on join from account-wide ownership', () => {
    const rank2 = CURATOR_RANK_DEFS.find((d) => d.rank === 2)!;
    const items = cataloguedItemIds().slice(0, rank2.threshold);
    expect(items.length).toBe(rank2.threshold);
    const sim = newSim();
    const pid = sim.addPlayer('warrior', 'Alt', {
      accountRelics: { items, marks: [], mounts: [], titles: [] },
    });
    const meta = sim.players.get(pid)!;
    expect(curatorRankFromOwned(catalogRankOwned(characterReliquaryOwnership(meta)))).toBe(2);
    expect(meta.deedsEarned.has(rank2.deedId as string)).toBe(true);
  });
});

describe('cosmetics wire decode', () => {
  it('keeps the pre-ledger shape when the payload carries no ledger', () => {
    const out = normalizeAccountCosmetics({ weaponSkinIds: ['a'] });
    expect('reliquary' in out).toBe(false);
  });

  it('decodes and catalog-bounds a ledger when present', () => {
    const out = normalizeAccountCosmetics({
      reliquary: { items: [RELIC, 'junk'], marks: [MARK], mounts: 3, titles: [TITLE] },
    });
    expect(out.reliquary).toEqual({ items: [RELIC], marks: [MARK], mounts: [], titles: [TITLE] });
  });
});

describe('online / offline parity for a ledger-only fill', () => {
  it('ClientWorld answers the same completion reads as Sim from the cosmetics ledger', () => {
    const ledger = { items: [RELIC], marks: [MARK], mounts: [MOUNT], titles: [TITLE] };
    const sim = newSim();
    stampPrimary(sim, ledger);
    const client = bareClient(sim.playerId);
    // biome-ignore lint/suspicious/noExplicitAny: bareClient idiom
    (client as any).accountCosmetics = normalizeAccountCosmetics({ reliquary: ledger });
    for (const page of RELIQUARY_PAGES) {
      expect(client.reliquaryPageCompletion(page.id), page.id).toEqual(
        sim.reliquaryPageCompletion(page.id),
      );
    }
    expect(client.reliquaryCatalogCompletion()).toEqual(sim.reliquaryCatalogCompletion());
    expect(client.reliquaryCuratorRank()).toBe(sim.reliquaryCuratorRank());
    expect(client.reliquaryCuratorRank()).toBe(1);
  });
});

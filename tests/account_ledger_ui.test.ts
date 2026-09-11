// The account ledger on the presentation side: the Book of Deeds view core
// (earned union, earners, account Renown, the picker, the repaint digest), the
// Reliquary view core (finders on owned cells), the tracker signature, the
// character-sheet Reliquary pair, and the painter source pins for the two
// "who earned / found this" lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AccountEarner,
  accountRelicKey,
  freshAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../src/sim/account_ledger';
import type { ReliquaryPageDef } from '../src/sim/content/reliquary';
import type { DeedDef } from '../src/sim/types';
import { accountDeedsDigest, buildDeedsView, deedsRefreshSig } from '../src/ui/deeds_view';
import { buildReliquarySheetModel } from '../src/ui/reliquary_sheet_view';
import { reliquaryTrackerOwnershipSig } from '../src/ui/reliquary_tracker_view';
import {
  accountLedgerDigest,
  buildReliquaryPageCells,
  buildReliquaryView,
} from '../src/ui/reliquary_view';
import { stripComments } from './helpers/strip_comments';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const ALT: AccountEarner = { characterId: 99, name: 'Bram', cls: 'mage', day: '2026-09-01' };
const SELF: AccountEarner = { characterId: 42, name: 'Hilda', cls: 'warrior', day: '2026-09-08' };

const TEST_DEEDS: Record<string, DeedDef> = {
  cmb_counter: {
    id: 'cmb_counter',
    name: 'Slayer',
    desc: 'Defeat 10 enemies.',
    category: 'combat',
    renown: 10,
    trigger: { kind: 'stat', stat: 'kills', count: 10 },
  },
  cmb_title: {
    id: 'cmb_title',
    name: 'Peakbreaker Task',
    desc: 'A mechanical triumph.',
    category: 'combat',
    renown: 25,
    trigger: { kind: 'manual' },
    reward: { kind: 'title', text: 'Peakbreaker' },
  },
  hid_secret: {
    id: 'hid_secret',
    name: 'Secret',
    desc: 'Hidden until earned.',
    category: 'combat',
    renown: 5,
    hidden: true,
    trigger: { kind: 'manual' },
  },
};
const ORDER = Object.keys(TEST_DEEDS);

function stats() {
  return {
    counters: { kills: 0 } as never,
    itemsDiscovered: new Set<string>(),
    visited: new Set<string>(),
    dungeonClears: {},
  };
}

function view(opts: {
  own?: Map<string, string>;
  account?: Map<string, readonly AccountEarner[]>;
  renown?: number;
}) {
  return buildDeedsView({
    deedsEarned: opts.own ?? new Map(),
    accountDeeds: opts.account,
    deedStats: stats() as never,
    renown: opts.renown ?? 0,
    activeTitle: null,
    activeBorder: null,
    deeds: TEST_DEEDS,
    order: ORDER,
    category: 'combat',
    filter: 'all',
    search: '',
    watched: new Set(),
    searchText: () => '',
  });
}

describe('Book of Deeds view core over the account ledger', () => {
  it('a deed only an alt earned reads as earned, names the earner, takes the first account day, and reveals a hidden deed', () => {
    const account = new Map<string, readonly AccountEarner[]>([
      ['cmb_title', [ALT]],
      ['hid_secret', [ALT]],
    ]);
    const model = view({ account });
    const title = model.entries.find((e) => e.id === 'cmb_title')!;
    expect(title.earned).toBe(true);
    expect(title.earnedDay).toBe('2026-09-01');
    expect(title.earners).toEqual([ALT]);
    // Watch stays keyed on own progress: alt-earned is still watchable here.
    expect(title.watchable).toBe(true);
    expect(model.entries.find((e) => e.id === 'hid_secret')?.earned).toBe(true);
    // Header pair, category count, title picker all count the union.
    expect(model.summary.earned).toBe(2);
    expect(model.categories.find((c) => c.category === 'combat')?.earned).toBe(2);
    expect(model.titles.map((o) => o.id)).toEqual([null, 'cmb_title']);
  });

  it('own earns keep their own day and list every earner; unearned entries carry no earners', () => {
    const account = new Map<string, readonly AccountEarner[]>([['cmb_title', [ALT, SELF]]]);
    const model = view({ own: new Map([['cmb_title', '2026-09-08']]), account });
    const title = model.entries.find((e) => e.id === 'cmb_title')!;
    expect(title.earnedDay).toBe('2026-09-08');
    expect(title.earners).toEqual([ALT, SELF]);
    expect(model.entries.find((e) => e.id === 'cmb_counter')?.earners).toEqual([]);
  });

  it('account Renown adds only the deeds this character did not earn itself, and equals the own sum with no ledger', () => {
    const account = new Map<string, readonly AccountEarner[]>([
      ['cmb_title', [ALT, SELF]], // own too: already inside input.renown
      ['hid_secret', [ALT]], // alt only: +5
    ]);
    expect(view({ own: new Map([['cmb_title', 'x']]), renown: 25, account }).summary.renown).toBe(
      30,
    );
    expect(view({ own: new Map([['cmb_title', 'x']]), renown: 25 }).summary.renown).toBe(25);
  });

  it('the recent strip includes an alt-only earn in the day fallback', () => {
    const account = new Map<string, readonly AccountEarner[]>([['hid_secret', [ALT]]]);
    const model = view({ account });
    expect(model.summary.recent.map((r) => r.id)).toEqual(['hid_secret']);
    expect(model.summary.recent[0].earnedDay).toBe('2026-09-01');
  });

  it('accountDeedsDigest moves on a new deed AND a new earner, and rides the refresh signature', () => {
    const ledger = freshAccountLedger();
    const base = {
      renown: 0,
      earnedCount: 0,
      activeTitle: null,
      activeBorder: null,
      filter: 'all' as const,
      search: '',
      category: 'combat' as const,
      watchRev: 0,
      statsDigest: 0,
    };
    const sig0 = deedsRefreshSig({ ...base, accountDigest: accountDeedsDigest(ledger.deeds) });
    recordAccountDeed(ledger, 'cmb_title', ALT);
    const sig1 = deedsRefreshSig({ ...base, accountDigest: accountDeedsDigest(ledger.deeds) });
    recordAccountDeed(ledger, 'cmb_title', SELF);
    const sig2 = deedsRefreshSig({ ...base, accountDigest: accountDeedsDigest(ledger.deeds) });
    expect(new Set([sig0, sig1, sig2]).size).toBe(3);
    // A host with no ledger signs exactly as before the field existed.
    expect(deedsRefreshSig(base)).toBe(sig0);
  });
});

const PAGE: ReliquaryPageDef = {
  id: 'p',
  shelf: 'conquerors',
  name: 'P',
  relics: [
    { kind: 'item', itemId: 'relic_a' },
    { kind: 'mark', markId: 'mark_a' },
    { kind: 'mount', mountId: 'steed_a' },
    { kind: 'weapon_skin', skinId: 'skin_a' },
  ],
};

describe('Reliquary view core over the account ledger', () => {
  it('names finders on owned item / mark / mount cells only, never on a missing cell or a skin', () => {
    const finds = new Map<string, readonly AccountEarner[]>([
      [accountRelicKey('item', 'relic_a'), [ALT]],
      [accountRelicKey('mark', 'mark_a'), [ALT, SELF]],
      [accountRelicKey('mount', 'steed_a'), [ALT]],
    ]);
    const cells = buildReliquaryPageCells(PAGE, {
      itemsDiscovered: new Set(['relic_a']),
      marks: new Set(['mark_a']),
      ownedMounts: new Set<string>(), // the mount is NOT owned here: no finders line
      weaponSkins: new Set(['skin_a']),
      accountFinds: finds,
    });
    expect(cells.find((c) => c.id === 'relic_a')?.finders).toEqual([ALT]);
    expect(cells.find((c) => c.id === 'mark_a')?.finders).toEqual([ALT, SELF]);
    expect(cells.find((c) => c.id === 'steed_a')?.owned).toBe(false);
    expect(cells.find((c) => c.id === 'steed_a')?.finders).toBeUndefined();
    expect(cells.find((c) => c.id === 'skin_a')?.owned).toBe(true);
    expect(cells.find((c) => c.id === 'skin_a')?.finders).toBeUndefined();
  });

  it('the page detail threads accountFinds through buildReliquaryView', () => {
    const finds = new Map<string, readonly AccountEarner[]>([
      [accountRelicKey('item', 'relic_a'), [ALT]],
    ]);
    const model = buildReliquaryView({
      pages: [PAGE],
      itemsDiscovered: new Set(['relic_a']),
      marks: new Set(),
      recent: [],
      nav: 'conquerors',
      pageId: 'p',
      accountFinds: finds,
    });
    expect(model.pageDetail?.cells.find((c) => c.id === 'relic_a')?.finders).toEqual([ALT]);
  });

  it('accountLedgerDigest and the tracker signature move when an alt finds or earns', () => {
    const ledger = freshAccountLedger();
    const d0 = accountLedgerDigest(ledger.relics, ledger.deeds);
    recordAccountRelic(ledger, 'item:x', ALT);
    const d1 = accountLedgerDigest(ledger.relics, ledger.deeds);
    recordAccountDeed(ledger, 'd', ALT);
    const d2 = accountLedgerDigest(ledger.relics, ledger.deeds);
    expect(d0).toBe(0);
    expect(d1).toBe(1);
    expect(d2).toBe(2);
    const base = { itemsDiscovered: 1, marks: 0, deedsEarned: 0, mounts: 0, weaponSkins: 0 };
    const s0 = reliquaryTrackerOwnershipSig(base);
    expect(reliquaryTrackerOwnershipSig({ ...base, accountFinds: 0, accountDeeds: 0 })).toBe(s0);
    expect(reliquaryTrackerOwnershipSig({ ...base, accountFinds: 1, accountDeeds: 0 })).not.toBe(
      s0,
    );
    expect(reliquaryTrackerOwnershipSig({ ...base, accountFinds: 0, accountDeeds: 1 })).not.toBe(
      s0,
    );
  });

  it('the character-sheet pair counts an alt-found real relic and ranks from the union', () => {
    const world = {
      deedStats: { itemsDiscovered: new Set<string>() },
      reliquaryMarks: new Set<string>(),
      ownedMounts: () => [] as string[],
      deedsEarned: new Map<string, string>(),
    };
    expect(buildReliquarySheetModel(world)).toMatchObject({ owned: 0, curatorRank: 0 });
    const finds = new Map<string, readonly AccountEarner[]>([
      [accountRelicKey('item', 'cryptbone_helm'), [ALT]],
    ]);
    const model = buildReliquarySheetModel({ ...world, reliquaryAccountFinds: finds });
    expect(model.owned).toBe(1);
    expect(model.curatorRank).toBe(1);
  });
});

describe('painter source pins', () => {
  it('the deed card foot lists earners through the two catalog keys and formatList', () => {
    const painter = stripComments(read('../src/ui/deeds_window.ts'));
    expect(painter).toContain("t('hudChrome.deeds.earnedBy', { names: formatList(names) })");
    expect(painter).toContain("t('hudChrome.deeds.earnerWithDate', {");
    expect(painter).toContain("t('hudChrome.deeds.accountScopeNote')");
    expect(painter).toContain('accountDigest: accountDeedsDigest(world.accountDeeds)');
  });

  it('the relic tooltip lists finders through the two catalog keys, on both tooltip arms', () => {
    const painter = stripComments(read('../src/ui/reliquary_window.ts'));
    expect(painter).toContain("t('hudChrome.reliquary.foundBy', { names: formatList(names) })");
    expect(painter).toContain("t('hudChrome.reliquary.finderWithDate', {");
    expect(painter).toContain("t('hudChrome.reliquary.sharedScopeNote')");
    expect(painter.match(/this\.foundByLineHtml\(cell\)/g)).toHaveLength(2);
  });
});

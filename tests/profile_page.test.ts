// The /c/<name> SSR profile page's Book of Deeds title line plus the Reliquary
// pair and Curator rank lines. Drives the REAL handleProfilePage with the db
// layer mocked (the social_frames partial-mock pattern): a titled character
// renders the English title under the <h1>, an untitled or stale-titled one
// renders no line at all, and the page never leaks the raw deed id. The
// Reliquary block always renders both the owned/total pair and the Curator
// line (rank 0 gets the explicit Unranked fallback, never a hidden slot).
// English is correct here BY DESIGN (the page is lang="en" throughout); every
// localized surface resolves ids client-side.
import { describe, expect, it, vi } from 'vitest';
import { RELIQUARY_MARK_ENGLISH, SHEET_RECENT_RELICS } from '../server/character_sheet';
import { ITEMS } from '../src/sim/data';
import { catalogCharacterCompletion, RELIQUARY_PAGES } from '../src/sim/reliquary';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const mockGetCharacterById = vi.fn();

vi.mock('../server/db', () => ({
  findCharacterReportTargetByName: vi.fn(async (name: string) =>
    name === 'Hilda' ? { characterId: 42 } : null,
  ),
  getCharacterById: (...args: unknown[]) => mockGetCharacterById(...args),
  guildNameForCharacter: vi.fn(async () => null),
  lifetimeXpRankForCharacter: vi.fn(async () => null),
  listCharacterNamesForSitemap: vi.fn(async () => []),
}));

import {
  findCharacterReportTargetByName,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
} from '../server/db';
import { handleProfilePage } from '../server/profile_page';

function charRow(state: Record<string, unknown>) {
  return {
    id: 42,
    account_id: 7,
    name: 'Hilda',
    class: 'warrior',
    level: 12,
    realm: 'Claudemoon',
    state,
    is_gm: false,
    force_rename: false,
  };
}

async function renderProfile(state: Record<string, unknown>): Promise<string> {
  mockGetCharacterById.mockResolvedValueOnce(charRow(state));
  const req = {
    url: '/c/Hilda',
    headers: { host: 'worldofclaudecraft.com' },
    socket: { remoteAddress: `10.1.2.${Math.floor(Math.random() * 250)}` },
  } as never;
  let body = '';
  let status = 0;
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk?: string) => {
      body += chunk ?? '';
    },
  } as never;
  await handleProfilePage(req, res);
  expect(status).toBe(200);
  return body;
}

describe('profile page db read budget', () => {
  it('reads each source EXACTLY ONCE per render (the strip added no new read)', async () => {
    // The recent-finds strip is derived from the state blob the page already
    // loaded, never from a second lookup. That acceptance criterion held only by
    // inspection until this pin: four reads, one each, per rendered page.
    // Counts are cleared first because renderProfile runs in every sibling
    // describe and the module-level mocks accumulate across a file.
    vi.clearAllMocks();
    await renderProfile({
      level: 12,
      deedStats: { itemsDiscovered: ['cryptbone_helm'] },
      reliquary: { marks: ['masterwork:first'], recent: ['cryptbone_helm', 'masterwork:first'] },
    });
    expect(findCharacterReportTargetByName).toHaveBeenCalledTimes(1);
    expect(mockGetCharacterById).toHaveBeenCalledTimes(1);
    expect(guildNameForCharacter).toHaveBeenCalledTimes(1);
    expect(lifetimeXpRankForCharacter).toHaveBeenCalledTimes(1);
  });
});

describe('profile page arena record', () => {
  // The public profile is the fourth surface carrying an arena record, after
  // the arena window, the leaderboard and the character sheet. It printed only
  // W/L, so a drawn match vanished here while reading correctly in game: the
  // same data loss this change exists to remove, one surface further out.
  it('prints the draw as the third figure of the record', async () => {
    const html = await renderProfile({
      level: 20,
      arena1v1Rating: 1712,
      arena1v1Wins: 10,
      arena1v1Losses: 4,
      arena1v1Draws: 2,
    });
    expect(html).toContain('10W / 4L / 2D');
  });

  it('reads a legacy save with no draws key as zero, not as a missing figure', async () => {
    // Decisive against rendering `undefined` or dropping the leg entirely for
    // every character who was saved before the field existed.
    const html = await renderProfile({
      level: 20,
      arena1v1Rating: 1600,
      arena1v1Wins: 7,
      arena1v1Losses: 3,
    });
    expect(html).toContain('7W / 3L / 0D');
    expect(html).not.toContain('undefined');
  });
});

describe('profile page Book of Deeds title line', () => {
  it('renders the English title under the name for an earned selection', async () => {
    const html = await renderProfile({
      level: 12,
      deeds: { prog_veteran: '2026-07-08' },
      renown: 25,
      activeTitle: 'prog_veteran',
    });
    expect(html).toContain('<h1>Hilda</h1>');
    expect(html).toContain('<p class="deed-title">Veteran</p>');
    // the raw deed id never reaches the page
    expect(html).not.toContain('prog_veteran');
  });

  it('renders no title line for an untitled character (element absent, not empty)', async () => {
    const html = await renderProfile({ level: 12 });
    expect(html).toContain('<h1>Hilda</h1>');
    // the stylesheet rule stays; the ELEMENT never renders
    expect(html).not.toContain('<p class="deed-title">');
  });

  it('degrades a stale/content-drifted id to no line, never a crash or raw id', async () => {
    const html = await renderProfile({ level: 12, activeTitle: 'removed_deed' });
    expect(html).toContain('<h1>Hilda</h1>');
    expect(html).not.toContain('<p class="deed-title">');
    expect(html).not.toContain('removed_deed');
  });

  it('escapes the title text through the page escaper (uniform-style guard)', async () => {
    // Authored titles are plain English today; the pin is that the render
    // path routes through escapeHtml like every other dynamic value.
    const html = await renderProfile({
      level: 12,
      deeds: { hid_saul_footnote: '2026-07-08' },
      activeTitle: 'hid_saul_footnote',
    });
    expect(html).toContain('<p class="deed-title">the Footnote</p>');
  });
});

describe('profile page Reliquary pair + Curator rank lines', () => {
  // The character-scoped total comes from the LIVE catalog (src/sim/reliquary),
  // never from the page code under test. Vacuity floor: Curator rank 5 sits at
  // 100 owned relics, so a live catalog below that means the derivation died.
  const catalogTotal = catalogCharacterCompletion({ itemsDiscovered: new Set() }).total;

  it('pins the interpolated total to the live-catalog literal', () => {
    // catalogTotal comes from the same catalogCharacterCompletion the page
    // calls, so the pair assertions below would follow a drifted derivation;
    // the literal anchors them. Literal: update when catalog content lands
    // (311 base + the Bonebound Rickshaw's horizons_mounts slot + the 40
    // Crucible raid relics and the raid's flawless title; Forgebreaker left
    // the pages for its crafting chain).
    expect(catalogTotal).toBe(357);
  });

  it('renders the owned/total pair and the English rank name for a ranked character', async () => {
    expect(catalogTotal).toBeGreaterThan(100);
    // Two catalogued discoveries: owned 2, past the rank 1 threshold (1 owned).
    const html = await renderProfile({
      level: 12,
      deedStats: { itemsDiscovered: ['boundstone_helm', 'cryptbone_helm'] },
    });
    expect(html).toContain(`<li>Reliquary: <strong>2/${catalogTotal}</strong></li>`);
    expect(html).toContain('<li>Curator: <strong>Apprentice Curator</strong></li>');
    expect(html).not.toContain('Unranked');
  });

  it('renders the zero pair and the Unranked fallback for a fresh character', async () => {
    const html = await renderProfile({ level: 12 });
    expect(html).toContain(`<li>Reliquary: <strong>0/${catalogTotal}</strong></li>`);
    // Rank 0 renders the explicit fallback line; the <li> never disappears.
    expect(html).toContain('<li>Curator: <strong>Unranked</strong></li>');
    expect(html).not.toContain('Apprentice Curator');
  });
});

// The Phase 20 recent-finds strip. The sheet JSON carries ids + kinds; the
// page resolves ENGLISH names (it is lang="en" throughout, like the Curator
// rank line above) and a raw relic id must never reach the HTML.
describe('profile page recent-finds strip', () => {
  it('renders the ring newest-first as English names, never raw ids', async () => {
    // Fixture-guard the literals against the live content tables, so a rename
    // reds here saying what it is instead of drifting silently.
    expect(ITEMS.cryptbone_helm.name).toBe('Cryptbone Helm');
    const html = await renderProfile({
      level: 12,
      deedStats: { itemsDiscovered: ['cryptbone_helm'] },
      // Stored oldest-first, so the mark is the newest find.
      reliquary: { marks: ['masterwork:first'], recent: ['cryptbone_helm', 'masterwork:first'] },
    });
    expect(html).toContain(
      '<li>Recent finds: <strong>First Masterwork · Cryptbone Helm</strong></li>',
    );
    expect(html).not.toContain('cryptbone_helm');
    expect(html).not.toContain('masterwork:first');
  });

  it('separates with a middot so a comma-carrying relic name stays ONE find', async () => {
    // A catalogued name with a comma in it, fixture-guarded: if the item
    // renames, this test must say so rather than silently losing its point. A
    // comma join would render these two finds as three. (Two catalogued names
    // carry commas since the Rift page landed: this one and voidsong_dirk;
    // the U+00B7 sweep below fixtures both.)
    expect(ITEMS.kingsbane_last_oath.name).toBe('Thronebane, Last Oath of Thornpeak');
    const html = await renderProfile({
      level: 12,
      reliquary: { recent: ['cryptbone_helm', 'kingsbane_last_oath'] },
    });
    expect(html).toContain(
      '<li>Recent finds: <strong>Thronebane, Last Oath of Thornpeak · Cryptbone Helm</strong></li>',
    );
  });

  it('renders at most the sheet bound, dropping the oldest', async () => {
    // Drives the page with a ring one longer than the bound: the page renders
    // the SHEET's strip, so the oldest name must be absent from the HTML.
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((page) =>
          page.relics.flatMap((relic) => (relic.kind === 'item' ? [relic.itemId] : [])),
        ),
      ),
    ].slice(0, SHEET_RECENT_RELICS + 1);
    // The literal beside the symbolic bounds, so this file stands on its own if
    // the constant ever drifts: every assertion below is written against
    // SHEET_RECENT_RELICS, and a bound that silently became 1 or 50 would keep
    // all of them green while the rendered strip changed shape entirely.
    expect(SHEET_RECENT_RELICS).toBe(5);
    expect(ids.length).toBe(SHEET_RECENT_RELICS + 1);
    const html = await renderProfile({ level: 12, reliquary: { recent: ids } });
    const strip = /<li>Recent finds: <strong>([^<]*)<\/strong><\/li>/.exec(html);
    if (!strip) throw new Error('recent-finds line missing from the rendered page');
    const names = strip[1].split(' · ');
    expect(names.length).toBe(SHEET_RECENT_RELICS);
    // The last name in the strip is the OLDEST survivor (newest-first), and
    // the dropped one is absent entirely. This fixture deliberately reads a
    // name that needs no escaping, so it pins ORDER and not the escaper (the
    // sibling test below owns that).
    expect(ITEMS[ids[1]].name).not.toMatch(/['&<>"]/);
    expect(names.at(-1)).toBe(ITEMS[ids[1]].name);
    expect(html).not.toContain(ITEMS[ids[0]].name);
  });

  it('escapes a relic name through the page escaper', async () => {
    // A real catalogued relic whose English name carries an apostrophe, so the
    // escaping is load-bearing here rather than a style guard.
    expect(ITEMS.morthens_cryptforged_hauberk.name).toBe("Morthen's Cryptforged Hauberk");
    const html = await renderProfile({
      level: 12,
      reliquary: { recent: ['morthens_cryptforged_hauberk'] },
    });
    expect(html).toContain('Morthen&#39;s Cryptforged Hauberk');
    expect(html).not.toContain("Morthen's Cryptforged Hauberk");
  });

  it('renders no strip line for a fresh character or an all-drifted ring', async () => {
    const fresh = await renderProfile({ level: 12 });
    expect(fresh).not.toContain('Recent finds:');
    // An id the live catalog does not know fails closed at the sheet, so the
    // whole line disappears rather than printing an empty strong tag.
    const drifted = await renderProfile({ level: 12, reliquary: { recent: ['gone_relic'] } });
    expect(drifted).not.toContain('Recent finds:');
    expect(drifted).not.toContain('gone_relic');
  });
});

// The /c/ recent-finds strip and the inspect card's meta line join their
// entries with ' U+00B7 ' precisely because authored names may carry commas,
// so the separator character itself must never appear INSIDE an authored
// English string: a middot in a name would make one find read as two, the
// inverse of the comma hazard the join exists to solve. Polarity note: a bare
// not.toContain of a never-present token proves nothing (it stays green when
// the sweep walks the wrong corpus), so this suite counts occurrences over
// size-floored corpora of non-empty strings and proves the counter live on a
// doctored positive.
describe('U+00B7 stays out of every middot-joined English surface', () => {
  const MIDDOT = '·';
  const middotCount = (value: string) => value.split(MIDDOT).length - 1;

  it('the occurrence counter fires on a doctored positive', () => {
    // The control that keeps the zero-count sweep below falsifiable: the
    // exact counter used there sees a planted middot.
    expect(middotCount(`Slain: Old${MIDDOT}Greyjaw`)).toBe(1);
    expect(middotCount(`a${MIDDOT}b${MIDDOT}c`)).toBe(2);
    expect(middotCount('Slain: Old Greyjaw')).toBe(0);
  });

  it('the comma-carrying names that motivate the join sit inside the swept corpus', () => {
    // Both catalogued comma names, fixture-guarded (a rename must fail loudly
    // here, not quietly drop the fixture's point), and both proved to be item
    // relics on live pages, so the sweep below demonstrably walks the strings
    // the middot join was built for.
    expect(ITEMS.kingsbane_last_oath.name).toBe('Thronebane, Last Oath of Thornpeak');
    expect(ITEMS.voidsong_dirk.name).toBe('Voidsong, Dirk of the Sundered Veil');
    const cataloguedItemIds = new Set(
      RELIQUARY_PAGES.flatMap((page) =>
        page.relics.flatMap((relic) => (relic.kind === 'item' ? [relic.itemId] : [])),
      ),
    );
    expect(cataloguedItemIds.has('kingsbane_last_oath')).toBe(true);
    expect(cataloguedItemIds.has('voidsong_dirk')).toBe(true);
  });

  it('no relic item name, mark English, markFind value, or page name contains U+00B7', () => {
    // Collected offenders print the offending string on failure instead of a
    // bare false. Every swept string must also be non-empty: an empty name
    // would pass a zero-count check vacuously while breaking the strip.
    const offenders: string[] = [];
    const sweep = (label: string, value: string) => {
      expect(value, `${label} is empty`).not.toBe('');
      if (middotCount(value) > 0) offenders.push(`${label}: ${value}`);
    };
    let itemSlots = 0;
    for (const page of RELIQUARY_PAGES) {
      sweep(`page name ${page.id}`, page.name);
      for (const relic of page.relics) {
        if (relic.kind !== 'item') continue;
        itemSlots += 1;
        sweep(`item ${relic.itemId}`, ITEMS[relic.itemId]?.name ?? '');
      }
    }
    for (const [markId, english] of RELIQUARY_MARK_ENGLISH) {
      sweep(`mark English ${markId}`, english);
    }
    const markFind = hudChromeStrings.reliquary.markFind as Record<string, string>;
    for (const [key, value] of Object.entries(markFind)) {
      sweep(`markFind ${key}`, value);
    }
    // Non-vacuity floors at today's measured sizes (exact literals live in
    // the shape pins of tests/reliquary_content.test.ts and the mark
    // cross-pins of tests/character_sheet.test.ts; these only guard against
    // an empty or misrouted corpus, so they are floors, not equalities).
    expect(RELIQUARY_PAGES.length).toBeGreaterThanOrEqual(35);
    expect(itemSlots).toBeGreaterThanOrEqual(265);
    expect(RELIQUARY_MARK_ENGLISH.size).toBeGreaterThanOrEqual(29);
    expect(Object.keys(markFind).length).toBeGreaterThanOrEqual(29);
    expect(offenders).toEqual([]);
  });
});

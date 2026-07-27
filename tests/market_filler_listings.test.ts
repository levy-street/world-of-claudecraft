// The filler-listing allocator the World Market evidence scripts seed their busy
// market from (scripts/lib/market_filler_listings.mjs), the pure core behind
// #2475. Tested directly, plus one integration case over a real Sim that pins the
// claim the band exists to make: nothing the sim issues later in the same session
// can reuse a filler id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FillerListingInput } from '../scripts/lib/market_filler_listings.mjs';
import * as fillerModule from '../scripts/lib/market_filler_listings.mjs';
import {
  buildFillerListings,
  fillerListingIdBase,
  MARKET_FILLER_LISTING_ID_BASE,
  summarizeListingIds,
} from '../scripts/lib/market_filler_listings.mjs';
import { ITEMS } from '../src/sim/data';
import { isListingId, MARKET_PLAYER_LISTING_ID_BASE } from '../src/sim/market_listing_ids';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOT_SCRIPT = 'scripts/market_listing_count_shot.mjs';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

// stand a player right on the Merchant so the proximity gate passes
function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = sim.entities.get(pid)!;
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function bookIds(sim: Sim): number[] {
  return sim.marketListings.map((l) => l.id);
}

// Everything the script mentions in prose is irrelevant to these pins; only the
// code is. Full-line comments are stripped (a trailing `//` strip would eat the
// `http://` inside the script's own URL template).
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('MARKET_FILLER_LISTING_ID_BASE', () => {
  it('is pinned to its literal value, far above the band the sim issues from', () => {
    // Deliberately a literal: every other assertion here is written against the
    // constant, so lowering it to MARKET_PLAYER_LISTING_ID_BASE + 1 would leave
    // them all green while destroying the entire point of the band.
    expect(MARKET_FILLER_LISTING_ID_BASE).toBe(1_000_000);

    // And the headroom is a magnitude, not an inequality. The sim walks the player
    // band one listing at a time from MARKET_PLAYER_LISTING_ID_BASE, so "above the
    // player base" would also be satisfied by a base of 1001, which a scripted
    // list-and-cancel loop could reach inside a single session.
    expect(MARKET_PLAYER_LISTING_ID_BASE * 100).toBeLessThanOrEqual(MARKET_FILLER_LISTING_ID_BASE);
  });
});

describe('fillerListingIdBase', () => {
  it('starts at the reserved base whatever the sim has already issued', () => {
    expect(fillerListingIdBase([])).toBe(MARKET_FILLER_LISTING_ID_BASE);
    // the real shape of a seeded book: the 23-row house band plus a dozen player
    // listings, all of it far below the filler band
    expect(fillerListingIdBase([1, 2, 3, 23, 1000, 1011])).toBe(MARKET_FILLER_LISTING_ID_BASE);
    expect(fillerListingIdBase([MARKET_FILLER_LISTING_ID_BASE - 1])).toBe(
      MARKET_FILLER_LISTING_ID_BASE,
    );
  });

  it('steps past an id sitting ON the base, never onto it', () => {
    expect(fillerListingIdBase([MARKET_FILLER_LISTING_ID_BASE])).toBe(
      MARKET_FILLER_LISTING_ID_BASE + 1,
    );
  });

  it('clears a book that already holds ids inside the filler band', () => {
    // the re-entrant case: the same page ran a filler pass already
    const past = MARKET_FILLER_LISTING_ID_BASE + 199;
    expect(fillerListingIdBase([1, past, 1000])).toBe(past + 1);
  });

  it('ignores malformed ids instead of poisoning the base', () => {
    const malformed = [NaN, Infinity, -Infinity, -1, 0, 1.5, '1000001', null, undefined, {}];
    expect(fillerListingIdBase(malformed as number[])).toBe(MARKET_FILLER_LISTING_ID_BASE);

    // The three shapes above that a bare `id >= base` comparison would let through,
    // asserted one at a time so trimming the table cannot leave the filter unpinned.
    // A numeric string is the worst of them: `'1000001' >= 1_000_000` coerces to true
    // and `'1000001' + 1` then CONCATENATES to '10000011', so every row would carry a
    // string id that no `l.id === listingId` lookup in the sim can ever match, which
    // is #2475's unreachable-row failure by another route.
    for (const v of [Infinity, '1000001', MARKET_FILLER_LISTING_ID_BASE + 0.5]) {
      expect(fillerListingIdBase([v] as unknown as number[])).toBe(MARKET_FILLER_LISTING_ID_BASE);
    }
  });

  it('still honours a real high id mixed in with malformed ones', () => {
    const past = MARKET_FILLER_LISTING_ID_BASE + 7;
    expect(fillerListingIdBase([NaN, past, Infinity] as number[])).toBe(past + 1);
  });
});

describe('buildFillerListings', () => {
  it('gives all 200 rows distinct, usable, contiguous ids', () => {
    const rows = buildFillerListings({ count: 200, takenIds: [1, 23, 1000, 1011], now: 0 });
    expect(rows.length).toBe(200);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isSafeInteger(id) && id >= 1)).toBe(true);
    expect(Math.min(...ids)).toBe(MARKET_FILLER_LISTING_ID_BASE);
    expect(Math.max(...ids)).toBe(MARKET_FILLER_LISTING_ID_BASE + 199);
  });

  it('shapes every row like a live player listing', () => {
    const rows = buildFillerListings({ count: 4, now: 12_345 });
    expect(rows.every((r) => r.house === false)).toBe(true);
    expect(rows.every((r) => r.count === 1)).toBe(true);
    expect(rows.every((r) => r.price >= 1 && Number.isSafeInteger(r.price))).toBe(true);
    // distinct sellers, so the block models a busy market rather than one seller
    // sitting on the 12-listing cap
    expect(new Set(rows.map((r) => r.sellerKey)).size).toBe(rows.length);
    expect(rows.every((r) => r.sellerName === r.sellerKey)).toBe(true);
    // Expiry is anchored to the sim clock the caller read out of the page, pinned to
    // the exact lifetime: a units slip (seconds read as ticks, say) would leave every
    // row expiring inside the seconds the capture takes, and the market sweep would
    // empty the book before the screenshot with nothing raised.
    expect(rows[0].expiresAt).toBe(12_345 + 1000);
    expect(rows.every((r) => r.expiresAt === rows[0].expiresAt)).toBe(true);
  });

  it('fills with a real item whose name sorts ahead of the goods being buried', () => {
    const [row] = buildFillerListings({ count: 1, now: 0 });
    // An id absent from ITEMS is filtered out of the browse list entirely
    // (marketItemMatches), so the shot would capture an empty market.
    const filler = ITEMS[row.itemId];
    expect(filler).toBeDefined();
    // Browse sorts by item NAME first and only then by price, so the filler name
    // is what pushes the seller's own wolf fangs past the wire limit, which is
    // the state the evidence shot exists to capture.
    expect(filler.name.localeCompare(ITEMS.wolf_fang.name)).toBeLessThan(0);
  });

  it('varies the asking price across the block', () => {
    const prices = buildFillerListings({ count: 200, now: 0 }).map((r) => r.price);
    expect(new Set(prices).size).toBeGreaterThan(1);
  });

  it('builds nothing for a count of zero', () => {
    expect(buildFillerListings({ count: 0, now: 0 })).toEqual([]);
  });

  it('refuses a count that is not a non-negative safe integer', () => {
    for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '200']) {
      expect(() => buildFillerListings({ count, now: 0 } as unknown as FillerListingInput)).toThrow(
        /non-negative safe integer/,
      );
    }
  });

  it('refuses a non-finite sim clock, and an omitted one', () => {
    for (const now of [NaN, Infinity, -Infinity]) {
      expect(() => buildFillerListings({ count: 1, now })).toThrow(/finite sim time/);
    }
    // Omitted rather than defaulted to 0: at a default of 0 the rows expire at the
    // fixed lifetime, so a caller in a session past that point would seed a block the
    // next market sweep culls and capture an empty market with nothing raised.
    expect(() => buildFillerListings({ count: 1 } as unknown as FillerListingInput)).toThrow(
      /finite sim time/,
    );
  });

  it('refuses a band that would run off the safe-integer range', () => {
    // Unreachable from a real book, but a band past the ceiling would mint ids this
    // module's own predicate rejects, which is the failure it exists to prevent.
    expect(() =>
      buildFillerListings({ count: 5, takenIds: [Number.MAX_SAFE_INTEGER], now: 0 }),
    ).toThrow(/not representable/);

    // The rounding arm: with the guard written `base + count - 1` the sum is formed
    // FIRST and rounds up past the ceiling, then the subtraction brings it back to
    // exactly MAX_SAFE_INTEGER, so the guard passed and the loop still emitted 2 ** 53.
    const near = Number.MAX_SAFE_INTEGER - 4;
    expect(() => buildFillerListings({ count: 5, takenIds: [near], now: 0 })).toThrow(
      /not representable/,
    );
  });
});

describe('summarizeListingIds', () => {
  it('reports a healthy book as healthy', () => {
    expect(summarizeListingIds([1, 23, 1000, 1_000_000])).toEqual({
      total: 4,
      unique: 4,
      unusable: 0,
      duplicated: 0,
    });
  });

  it('reports the #2475 book: 200 rows, one unusable id between them', () => {
    const ids = Array.from({ length: 200 }, () => NaN);
    expect(summarizeListingIds(ids)).toEqual({
      total: 200,
      unique: 1, // a Set collapses every NaN into one
      unusable: 200,
      duplicated: 199,
    });
  });

  it('counts a plain duplicate without calling it unusable', () => {
    expect(summarizeListingIds([1000, 1000, 1001])).toEqual({
      total: 3,
      unique: 2,
      unusable: 0,
      duplicated: 1,
    });
  });

  it('agrees with the isListingId predicate in the sim on every id shape', () => {
    // The script layer cannot import the TS source, so the predicate is copied.
    // This pins the copy against the original so it cannot drift.
    const table = [
      1,
      23,
      1000,
      MARKET_FILLER_LISTING_ID_BASE,
      Number.MAX_SAFE_INTEGER,
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '7',
      null,
      undefined,
      {},
    ];
    for (const v of table) {
      expect(summarizeListingIds([v]).unusable).toBe(isListingId(v) ? 0 : 1);
    }
  });
});

describe('the filler band against a real Sim', () => {
  it('leaves every row in the book reachable by its own id', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Strider');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 12, seller);
    for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 200 + i, seller);
    expect(sim.marketInfoFor(seller)?.myListingCount).toBe(12);

    const before = sim.marketListings.length;
    sim.marketListings.push(
      ...buildFillerListings({ count: 200, takenIds: bookIds(sim), now: sim.time }),
    );
    // The block really landed: without this the two health assertions below also hold
    // over the 35-row pre-push book, so a filler pass contributing nothing would pass.
    expect(sim.marketListings.length).toBe(before + 200);

    const health = summarizeListingIds(bookIds(sim));
    expect(health.total).toBe(sim.marketListings.length);
    expect(health.unusable).toBe(0);
    expect(health.duplicated).toBe(0);
    // And none of the 200 is attributed to the viewer, or the Sell caption the whole
    // capture exists to show would read 212 / 12 instead of 12 / 12.
    expect(sim.marketInfoFor(seller)?.myListingCount).toBe(12);
  });

  it('cannot be reused by a listing the sim issues afterwards', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Strider');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 12, seller);
    for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 200 + i, seller);

    const fillers = buildFillerListings({ count: 200, takenIds: bookIds(sim), now: sim.time });
    sim.marketListings.push(...fillers);
    const fillerIds = new Set(fillers.map((r) => r.id));

    // a second seller, because the first is sitting on the 12-listing cap
    const other = sim.addPlayer('warrior', 'Bystander');
    standAtMerchant(sim, other);
    sim.addItem('wolf_fang', 1, other);
    sim.marketList('wolf_fang', 1, 500, other);

    const issued = sim.marketListings.find((l) => l.sellerName === 'Bystander');
    expect(issued).toBeDefined();
    // The counter was untouched by the push: pushing onto the book does not feed
    // the allocator (only loadMarket does, and that is server-only), so the sim
    // keeps issuing from the player band far below the filler band.
    expect(issued?.id).toBeLessThan(MARKET_FILLER_LISTING_ID_BASE);
    expect(fillerIds.has(issued?.id as number)).toBe(false);
    expect(summarizeListingIds(bookIds(sim)).duplicated).toBe(0);
  });

  it('exposes no listing-id counter for a script to read off Sim', () => {
    // #2475's ruling: the counter stays `private` on Market and the fix belongs in
    // the script. The broken script read `sim.nextListingId`, got undefined, and
    // stamped NaN on all 200 rows. If a public counter is ever added here, this
    // goes red so the band above can be reconsidered rather than silently orphaned.
    const sim = makeWorld();
    // Typed as `number` so the increment below compiles; at runtime the property is
    // absent, which is exactly the claim.
    let counter = (sim as unknown as Record<string, number>).nextListingId;
    expect(counter).toBeUndefined();
    // Routed through the real property rather than asserted of NaN directly, so this
    // goes red the moment Sim grows a readable counter instead of staying vacuous.
    expect(Number.isNaN(counter++)).toBe(true);
  });
});

describe('the evidence script and its declared types', () => {
  it('allocates through the shared helper and never off the sim', () => {
    const code = codeOf(readFileSync(join(ROOT, SHOT_SCRIPT), 'utf8'));
    // positive first, so the negative below cannot be satisfied by deleting the
    // filler block outright
    expect(code).toContain("from './lib/market_filler_listings.mjs'");
    expect(code).toContain('buildFillerListings(');
    expect(code).toContain('summarizeListingIds(');
    expect(code).not.toMatch(/nextListingId/);
  });

  it('keeps the shared entry flow and the real Sell tab button', () => {
    // The same rot class as #2475, and the other two defects this change fixed: a dev
    // script naming a member that no longer exists. Hand-rolling the entry flow leaves
    // the intro cinematic up, and it sets #ui to display:none, which zeroes the window
    // clip; `hud.marketTab` / `hud.renderMarket()` went away with the market window
    // extraction and threw in-page, aborting before the Sell capture.
    const code = codeOf(readFileSync(join(ROOT, SHOT_SCRIPT), 'utf8'));
    expect(code).toContain('enterOfflineGame(page');
    expect(code).toContain('[data-tab="sell"]');
    expect(code).not.toMatch(/marketTab|renderMarket\(/);
  });

  it('declares every runtime export in the hand-written .d.mts', () => {
    const dts = readFileSync(join(ROOT, 'scripts/lib/market_filler_listings.d.mts'), 'utf8');
    const names = Object.keys(fillerModule).sort();
    expect(names).toEqual([
      'MARKET_FILLER_LISTING_ID_BASE',
      'buildFillerListings',
      'fillerListingIdBase',
      'summarizeListingIds',
    ]);
    // Anchored at line start: unanchored, a commented-out `// export declare ...`
    // satisfies the match. Compared as a SET so the sweep runs both ways, and a
    // declaration left behind by a rename fails too.
    const declared = [...dts.matchAll(/^export declare (?:function|const) (\w+)/gm)]
      .map((m) => m[1])
      .sort();
    expect(declared).toEqual(names);
  });
});

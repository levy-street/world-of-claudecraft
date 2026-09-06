import { describe, expect, it } from 'vitest';
import {
  chargeGuildRosterPage,
  GUILD_ROSTER_BASE_MEMBERS,
  GUILD_ROSTER_GROWTH_DENOMINATOR,
  GUILD_ROSTER_GROWTH_NUMERATOR,
  GUILD_ROSTER_MAX_MEMBERS,
  GUILD_ROSTER_MAX_PAGES,
  GUILD_ROSTER_PAGE_BASE_COPPER,
  GUILD_ROSTER_PAGE_PRICES,
  GUILD_ROSTER_PAGE_SEATS,
  GUILD_ROSTER_RAMP_PAGES,
  GUILD_ROSTER_RAMP_STEP_COPPER,
  guildRosterCap,
  guildRosterNextPagePrice,
  guildRosterPagesBought,
  refundGuildRosterPage,
} from '../src/sim/guild_roster';
import { Sim } from '../src/sim/sim';

const GOLD = 10_000;

function freshSim(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
}

const meta = (sim: Sim) => {
  const m = sim.players.get(sim.playerId);
  if (!m) throw new Error('missing meta');
  return m;
};

describe('guild roster ladder (data-as-code pins)', () => {
  it('pins the base roster, the page size, and the 1,000-seat hard cap', () => {
    expect(GUILD_ROSTER_BASE_MEMBERS).toBe(100);
    expect(GUILD_ROSTER_PAGE_SEATS).toBe(20);
    expect(GUILD_ROSTER_MAX_PAGES).toBe(45);
    expect(GUILD_ROSTER_MAX_MEMBERS).toBe(1000);
  });

  it('ramps 40g by 80g a page to page 5, then grows 30% a page, whole gold, rising', () => {
    expect(GUILD_ROSTER_PAGE_BASE_COPPER).toBe(40 * GOLD);
    expect(GUILD_ROSTER_RAMP_STEP_COPPER).toBe(80 * GOLD);
    expect(GUILD_ROSTER_RAMP_PAGES).toBe(5);
    expect(GUILD_ROSTER_GROWTH_NUMERATOR).toBe(13);
    expect(GUILD_ROSTER_GROWTH_DENOMINATOR).toBe(10);
    GUILD_ROSTER_PAGE_PRICES.forEach((price, i) => {
      const page = i + 1;
      if (page <= GUILD_ROSTER_RAMP_PAGES) {
        expect(price, `ramp page ${page}`).toBe(
          GUILD_ROSTER_PAGE_BASE_COPPER + GUILD_ROSTER_RAMP_STEP_COPPER * i,
        );
      } else {
        // The previous page's whole-gold price times 13/10, rounded half up.
        const prevGold = GUILD_ROSTER_PAGE_PRICES[i - 1] / GOLD;
        expect(price, `grown page ${page}`).toBe(Math.floor((prevGold * 13 + 5) / 10) * GOLD);
      }
      expect(price % GOLD, `page ${page} is whole gold`).toBe(0);
      if (i > 0) expect(price).toBeGreaterThan(GUILD_ROSTER_PAGE_PRICES[i - 1]);
    });
  });

  it('pins the headline prices: 40g first, 360g fifth, 18,409g for page 20, 12,990,618g last', () => {
    expect(GUILD_ROSTER_PAGE_PRICES[0]).toBe(40 * GOLD);
    expect(GUILD_ROSTER_PAGE_PRICES[1]).toBe(120 * GOLD);
    expect(GUILD_ROSTER_PAGE_PRICES[4]).toBe(360 * GOLD);
    expect(GUILD_ROSTER_PAGE_PRICES[5]).toBe(468 * GOLD);
    expect(GUILD_ROSTER_PAGE_PRICES[19]).toBe(18_409 * GOLD);
    expect(GUILD_ROSTER_PAGE_PRICES[GUILD_ROSTER_MAX_PAGES - 1]).toBe(12_990_618 * GOLD);
  });

  it('pins the totals: 200 seats for 1,000g, 500 for 79,214g, 600 for 295,638g', () => {
    // The owner's bars (2026-09-05): a 40 gold first page, about 1,000 gold
    // for the first hundred extra seats, rapid scaling after that, and nothing
    // meaningfully past 500 seats reachable with the realm's whole gold supply
    // (on the order of 150,000 gold when this shipped). 600 seats costing
    // twice that is the proof; the 1,000-seat hard cap is an engineering bound
    // the curve never reaches.
    const totalThrough = (pages: number): number =>
      GUILD_ROSTER_PAGE_PRICES.slice(0, pages).reduce((sum, p) => sum + p, 0);
    expect(totalThrough(GUILD_ROSTER_RAMP_PAGES), '200 seats').toBe(1_000 * GOLD);
    expect(totalThrough(10), '300 seats').toBe(5_228 * GOLD);
    expect(totalThrough(20), '500 seats').toBe(79_214 * GOLD);
    expect(totalThrough(25), '600 seats').toBe(295_638 * GOLD);
    expect(totalThrough(GUILD_ROSTER_MAX_PAGES), '1,000 seats').toBe(56_292_114 * GOLD);
    // Every single page price is what chargeGuildRosterPage gates on
    // (Number.isSafeInteger): a growth bump that pushed one past the bound
    // would otherwise refuse as a confusing cannotAfford. The sum is bounded
    // by the same check on the purse.
    for (const price of GUILD_ROSTER_PAGE_PRICES) expect(Number.isSafeInteger(price)).toBe(true);
  });
});

describe('guildRosterPagesBought (the one load path)', () => {
  it('floors junk, negative, and fractional counts to zero pages', () => {
    expect(guildRosterPagesBought(undefined)).toBe(0);
    expect(guildRosterPagesBought(null)).toBe(0);
    expect(guildRosterPagesBought('3')).toBe(0);
    expect(guildRosterPagesBought(Number.NaN)).toBe(0);
    expect(guildRosterPagesBought(-1)).toBe(0);
    expect(guildRosterPagesBought(1.5)).toBe(0);
    expect(guildRosterPagesBought(0)).toBe(0);
  });

  it('passes in-range counts through and caps a count past the ladder', () => {
    expect(guildRosterPagesBought(1)).toBe(1);
    expect(guildRosterPagesBought(GUILD_ROSTER_MAX_PAGES)).toBe(GUILD_ROSTER_MAX_PAGES);
    expect(guildRosterPagesBought(GUILD_ROSTER_MAX_PAGES + 7)).toBe(GUILD_ROSTER_MAX_PAGES);
  });
});

describe('guildRosterCap / guildRosterNextPagePrice', () => {
  it('grows the cap by one page of seats per bought page up to the ceiling', () => {
    expect(guildRosterCap(0)).toBe(100);
    expect(guildRosterCap(1)).toBe(120);
    expect(guildRosterCap(5)).toBe(200);
    expect(guildRosterCap(GUILD_ROSTER_MAX_PAGES)).toBe(GUILD_ROSTER_MAX_MEMBERS);
    expect(guildRosterCap(GUILD_ROSTER_MAX_PAGES + 1)).toBe(GUILD_ROSTER_MAX_MEMBERS);
    expect(guildRosterCap(-3)).toBe(100);
  });

  it('looks the next price up by pages bought and goes null once the ladder is done', () => {
    expect(guildRosterNextPagePrice(0)).toBe(40 * GOLD);
    expect(guildRosterNextPagePrice(1)).toBe(120 * GOLD);
    expect(guildRosterNextPagePrice(19)).toBe(18_409 * GOLD);
    expect(guildRosterNextPagePrice(GUILD_ROSTER_MAX_PAGES - 1)).toBe(12_990_618 * GOLD);
    expect(guildRosterNextPagePrice(GUILD_ROSTER_MAX_PAGES)).toBeNull();
    expect(guildRosterNextPagePrice(GUILD_ROSTER_MAX_PAGES + 4)).toBeNull();
  });
});

describe('chargeGuildRosterPage / refundGuildRosterPage (the purse half)', () => {
  it('charges exactly the price when the purse covers it', () => {
    const sim = freshSim();
    meta(sim).copper = 50 * GOLD;
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, 20 * GOLD)).toBe(20 * GOLD);
    expect(meta(sim).copper).toBe(30 * GOLD);
  });

  it('charges only what the purse holds when it is short (the caller refunds and refuses)', () => {
    const sim = freshSim();
    meta(sim).copper = 12 * GOLD;
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, 20 * GOLD)).toBe(12 * GOLD);
    expect(meta(sim).copper).toBe(0);
  });

  it('charges nothing for an empty purse, a bad price, or an unknown pid', () => {
    const sim = freshSim();
    meta(sim).copper = 0;
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, 20 * GOLD)).toBe(0);
    meta(sim).copper = 5 * GOLD;
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, 0)).toBe(0);
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, -1)).toBe(0);
    expect(chargeGuildRosterPage(sim.ctx, sim.playerId, Number.NaN)).toBe(0);
    expect(chargeGuildRosterPage(sim.ctx, 999_999, 20 * GOLD)).toBe(0);
    expect(meta(sim).copper).toBe(5 * GOLD);
  });

  it('refunds a reserved charge back to the purse, exactly once per call', () => {
    const sim = freshSim();
    meta(sim).copper = 30 * GOLD;
    const charged = chargeGuildRosterPage(sim.ctx, sim.playerId, 20 * GOLD);
    expect(refundGuildRosterPage(sim.ctx, sim.playerId, charged)).toBe(20 * GOLD);
    expect(meta(sim).copper).toBe(30 * GOLD);
  });

  it('refunds nothing for a bad amount or an unknown pid, and clamps at the safe bound', () => {
    const sim = freshSim();
    meta(sim).copper = 10;
    expect(refundGuildRosterPage(sim.ctx, sim.playerId, 0)).toBe(0);
    expect(refundGuildRosterPage(sim.ctx, sim.playerId, -5)).toBe(0);
    expect(refundGuildRosterPage(sim.ctx, 999_999, 5)).toBe(0);
    expect(meta(sim).copper).toBe(10);
    meta(sim).copper = Number.MAX_SAFE_INTEGER - 3;
    expect(refundGuildRosterPage(sim.ctx, sim.playerId, 10)).toBe(3);
    expect(meta(sim).copper).toBe(Number.MAX_SAFE_INTEGER);
  });
});

// The marketplace disclosures that spell a server rule in plain words (the
// anti-snipe window, the Buy Now hold and its cooldowns, the strike ladder)
// are pinned to the constants they describe: a rule retune must reword the
// English (and its five non-Latin fills) in the same change, or this reds.
// Those figures are not on the /status wire, which is exactly why the source
// pin exists: the copy is the client's only statement of them. The BOND
// schedule and payment window are the exception: /status now ships them and
// the copy resolves placeholders instead of prose figures, so their pins
// below guard the WIRE mirror (a silent retune must red here too, because
// the deploy-coupled service mirrors the same rule).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  strikeSuspensionMs,
  WOC_MARKET_ANTI_SNIPE_CAP_SECONDS,
  WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS,
  WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS,
  WOC_MARKET_BOND_MAX_CENTS,
  WOC_MARKET_BOND_MIN_CENTS,
  WOC_MARKET_BOND_PENDING_TTL_SECONDS,
  WOC_MARKET_BOND_RATE_BPS,
  WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR,
  WOC_MARKET_BUY_NOW_LOCK_SECONDS,
  WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS,
} from '../server/woc_market_rules';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const market = hudChromeStrings.wocMarket;
const DAY_MS = 86_400_000;

describe('marketplace copy names the live rule figures', () => {
  it('bidCloseNote spells the anti-snipe window, extension and cap', () => {
    expect(WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS).toBe(120);
    expect(WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS).toBe(120);
    expect(WOC_MARKET_ANTI_SNIPE_CAP_SECONDS).toBe(1800);
    expect(market.bidCloseNote).toContain('last 2 minutes');
    expect(market.bidCloseNote).toContain('2 minutes after that bid');
    expect(market.bidCloseNote).toContain('30 minutes past the listed end');
  });

  it('buyNowNote spells the hold, the per-listing cooldown and the hourly cap', () => {
    // 270 seconds: "about four and a half minutes" is the honest rounding.
    expect(WOC_MARKET_BUY_NOW_LOCK_SECONDS).toBe(270);
    expect(WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS).toBe(1800);
    expect(WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR).toBe(3);
    expect(WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS).toBe(3600);
    expect(market.buyNowNote).toContain('four and a half minutes');
    expect(market.buyNowNote).toContain('30 minutes');
    expect(market.buyNowNote).toContain('three unpaid Buy Nows within an hour');
  });

  it('strikesTip spells the suspension ladder', () => {
    // No suspension on the first strike, then 3, 14, 90 days, then a year.
    expect(strikeSuspensionMs(1)).toBe(0);
    expect(strikeSuspensionMs(2)).toBe(3 * DAY_MS);
    expect(strikeSuspensionMs(3)).toBe(14 * DAY_MS);
    expect(strikeSuspensionMs(4)).toBe(90 * DAY_MS);
    expect(strikeSuspensionMs(5)).toBe(365 * DAY_MS);
    expect(market.strikesTip).toContain('After the first');
    expect(market.strikesTip).toContain('3 days, then 14, then 90, then a year');
  });

  it('the bond schedule and payment window ride /status as these exact figures', () => {
    // 5 percent, $1 to $50, a 5-minute payment window: the mirror the wire
    // ships and the resolved copy renders. The deploy coupling keeps the
    // service's own schedule in lockstep (DEPLOY.md), so a retune here is a
    // cross-repo change, never a silent constant edit.
    expect(WOC_MARKET_BOND_RATE_BPS).toBe(500);
    expect(WOC_MARKET_BOND_MIN_CENTS).toBe(100);
    expect(WOC_MARKET_BOND_MAX_CENTS).toBe(5000);
    expect(WOC_MARKET_BOND_PENDING_TTL_SECONDS).toBe(300);
    // The copy carries PLACEHOLDERS, never digits: the figures land at render
    // time from /status, so the English can never contradict a future wire.
    expect(market.bidBondSchedule).toContain('{rate}');
    expect(market.bidBondSchedule).toContain('{min}');
    expect(market.bidBondSchedule).toContain('{max}');
    expect(market.bidBondSchedule).not.toMatch(/\d/);
    expect(market.bidBondPayWindow).toContain('{duration}');
    expect(market.bidBondPayWindow).not.toMatch(/\d/);
    // The resolved sell caption resolves the floor the same way.
    expect(market.sellEmptyFloor).toContain('{floor}');
  });

  it('the fee note names no percentage (the schedule is service configuration, off the wire)', () => {
    // A retuned service must not be contradicted by the client's English; the
    // resolved fee for a typed price renders beside the note from the estimate.
    expect(market.sellFeeNote).not.toMatch(/\d+ percent|\d+%/);
    expect(market.sellFeeNote).toContain('shown here');
  });

  it('the pause and suspension banners name every refused action', () => {
    for (const text of [market.pausedBanner, market.activitySuspended]) {
      expect(text).toContain('listings');
      expect(text).toContain('bids');
    }
    expect(market.pausedBanner).not.toContain('pricing');
    expect(market.activitySuspended).toContain('$WOC trades');
  });

  it('the six resolved-figure keys keep all five non-Latin fills with exact placeholder parity', () => {
    // The digit-derived check below cannot see these keys (their figures
    // arrive as PLACEHOLDERS, not digits), and the release-tier pending scan
    // cannot see a DROPPED fill row either until release: this is the
    // PR-tier pin that each fill exists and spells every token the English
    // resolves.
    const KEYS: Array<[string, string]> = [
      ['hudChrome.wocMarket.bidBondSchedule', market.bidBondSchedule],
      ['hudChrome.wocMarket.bidBondPayWindow', market.bidBondPayWindow],
      ['hudChrome.wocMarket.sellEmptyFloor', market.sellEmptyFloor],
      ['hudChrome.wocMarket.sellCollectiblesBoth', market.sellCollectiblesBoth],
      ['hudChrome.wocMarket.sellCollectiblesMounts', market.sellCollectiblesMounts],
      ['hudChrome.wocMarket.sellCollectiblesChromas', market.sellCollectiblesChromas],
    ];
    for (const locale of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']) {
      const src = readFileSync(`src/ui/i18n.locales/${locale}.ts`, 'utf8');
      for (const [key, english] of KEYS) {
        const at = src.indexOf(`'${key}':`);
        expect(at, `${locale} carries a fill for ${key}`).toBeGreaterThan(-1);
        const end = src.indexOf("\n  '", at + 1);
        expect(end, `${locale} ${key} is followed by another row`).toBeGreaterThan(at);
        const value = src.slice(at, end);
        for (const token of english.match(/\{[a-zA-Z]+\}/g) ?? []) {
          expect(value, `${locale} ${key} spells ${token}`).toContain(token);
        }
      }
    }
  });

  it('the five non-Latin fills carry the same figures as the English source', () => {
    // The header's claim, made real: reading only hudChromeStrings would let a
    // rule retune reword the English and leave a stale figure standing in every
    // fill, which is the one place a player of that locale would read it. The
    // digits survive translation (they are digits in all five), so each fill is
    // checked for the numbers its English twin spells.
    // The expected figures are DERIVED from the English value, never a second
    // hard-coded copy: with a literal list here, a rule retune that updates
    // the constants and the English would leave this test green over five
    // stale fills (each still contains the OLD digit). Deriving means the
    // fills red until they are refilled to match the new English.
    const FILLS: Array<[string, readonly string[]]> = (
      [
        ['hudChrome.wocMarket.bidCloseNote', market.bidCloseNote],
        ['hudChrome.wocMarket.buyNowNote', market.buyNowNote],
        ['hudChrome.wocMarket.strikesTip', market.strikesTip],
      ] as const
    ).map(([key, english]) => {
      const figures = [...new Set(english.match(/\d+/g) ?? [])];
      expect(figures.length, `${key}'s English spells at least one digit figure`).toBeGreaterThan(
        0,
      );
      return [key, figures];
    });
    for (const locale of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']) {
      const src = readFileSync(`src/ui/i18n.locales/${locale}.ts`, 'utf8');
      for (const [key, figures] of FILLS) {
        const at = src.indexOf(`'${key}':`);
        expect(at, `${locale} carries a fill for ${key}`).toBeGreaterThan(-1);
        // The value runs to the next quoted key at this indent, which is where
        // the overlay's flat rows end. The end has to be FOUND: for the last
        // row in a file, indexOf returns -1 and slice(at, -1) would hand back
        // the rest of the file, so a figure anywhere later would satisfy the
        // check and the pin would be quietly vacuous.
        const end = src.indexOf("\n  '", at + 1);
        expect(end, `${locale} ${key} is followed by another row`).toBeGreaterThan(at);
        const value = src.slice(at, end);
        for (const figure of figures) {
          // Digit-boundary containment, not substring: after a 2-to-3 retune
          // a stale fill's '30' must not satisfy '3'. ASCII digits in these
          // figure-bearing fills are the established contract of all five
          // locales (CJK game UI convention); a fill moving to native number
          // words would need this check revisited deliberately.
          expect(
            new RegExp(`(?<![0-9])${figure}(?![0-9])`).test(value),
            `${locale} ${key} still spells ${figure}`,
          ).toBe(true);
        }
      }
    }
  });

  it('the capture rigs seed the LOWEST graphics preset before the document loads', () => {
    // The standing capture rule: window shots are evidence about the DOM, and
    // tier 1 is what SwiftShader should pay for on a shared box. graphicsPreset 1
    // is PRESET_LOW; graphicsDefaultApplied keeps the first-run probe from
    // persisting its own tier over the seed. No rig may boot ?gfx=ultra.
    for (const rig of [
      'scripts/woc_market_shot.mjs',
      'scripts/woc_trade_mobile_shot.mjs',
      'scripts/trade_money_shot.mjs',
    ]) {
      const src = readFileSync(rig, 'utf8');
      expect(src, `${rig} seeds the low preset`).toContain('evaluateOnNewDocument');
      expect(src, `${rig} seeds graphicsPreset = 1`).toContain('s.graphicsPreset = 1');
      expect(src, `${rig} pins the default-applied flag`).toContain(
        's.graphicsDefaultApplied = true',
      );
      expect(src, `${rig} must not force a high tier`).not.toContain('gfx=ultra');
    }
  });
});

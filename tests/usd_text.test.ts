// The shared USD spelling (src/ui/usd_text.ts): Intl currency bound to the
// active locale, never a hardcoded "$" prefix. The sweep at the bottom is the
// review's grep-proof made durable: no client module under src/ui, src/game,
// or src/net may concatenate a dollar sign (or a currency code) around a
// localized number again.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/ui/i18n';
import { usdDollarsText, usdText } from '../src/ui/usd_text';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

afterEach(() => {
  setLanguage('en');
});

describe('formatting', () => {
  it('renders cents as symbol-correct currency in English', () => {
    setLanguage('en');
    expect(usdText(100)).toBe('$1.00');
    expect(usdText(2500)).toBe('$25.00');
    // Sub-dollar and zero keep their two fraction digits.
    expect(usdText(5)).toBe('$0.05');
    expect(usdText(0)).toBe('$0.00');
  });

  it('handles negatives through Intl, which a "$" prefix concat never did', () => {
    setLanguage('en');
    // "-$1.00", never the "$-1.00" a `$${n}` template produces.
    expect(usdText(-100)).toBe('-$1.00');
  });

  it('follows a suffix-currency locale instead of forcing a leading dollar', () => {
    setLanguage('fr_FR');
    const line = usdText(100);
    // French places the currency AFTER the amount ("1,00 $US"): the exact
    // token varies by ICU version, so pin the property, not the byte string.
    expect(line.startsWith('$'), line).toBe(false);
    expect(line).toContain('1,00');
  });

  it('the dollar-unit twin agrees with the cents form', () => {
    setLanguage('en');
    expect(usdDollarsText(25)).toBe(usdText(2500));
  });
});

describe('the grep-proof: zero hardcoded currency or ticker spellings in src/ui, src/game, src/net', () => {
  // The shapes the sweep hunts. Each is a literal currency glued to a
  // localized number, which Intl exists to spell: a template `$${...}`, a
  // quoted "$" concatenated on either side (any spacing), and a currency
  // code appended after an interpolation.
  // The last shape covers the token tickers too: a ` SOL` / ` USDC` / ` WOC` /
  // ` $WOC` glued after an interpolation is the same defect with a unit Intl
  // cannot spell (the Claudium pack labels used to), so the unit rides a
  // catalog template token instead.
  // Longest ticker first, and a letter lookahead after it: USD before USDC
  // would stop the match one letter short and the lookahead would then reject
  // USDC entirely, while the lookahead alone is what keeps USDT or SOLID from
  // matching as USD or SOL. The ticker may sit after the interpolation at any
  // position in the template (not only right before the closing backtick), or
  // glued in front of one.
  const TICKER = '(?:USDC|USD|SOL|\\$?WOC)';
  const SHAPES: readonly RegExp[] = [
    /`[^`]*\$\$\{/,
    /['"]\$['"]\s*\+|\+\s*['"]\$['"]/,
    new RegExp(`\\$\\{[^}]*\\}\\s*${TICKER}(?![A-Za-z])`),
    // Prefix glue: the ticker may open the template (the optional group) and
    // may touch the interpolation with no space at all (\\s*), or the most
    // direct forms of the defect pass while only the mid-template one is
    // caught.
    new RegExp(`\`(?:[^\`]*[^A-Za-z\`])?${TICKER}\\s*\\$\\{`),
  ];
  const offends = (src: string): boolean => SHAPES.some((re) => re.test(src));

  it('no client presentation module concatenates a literal dollar or currency code', () => {
    // The `$${...}` template shape IS the defect class the review named
    // (wocUsdText, the Claudium pack labels, the daily-rewards prize lines):
    // a literal "$" glued to a localized number. Catalog English (translatable
    // copy) does not match these shapes. Swept over src/ui, src/game, and
    // src/net on COMMENT-STRIPPED source (the shared single-pass stripper: a
    // block-first strip treats a bare slash-star inside a line comment as an
    // opener and hides real code from the sweep), so a money surface moving
    // directories or a commented example cannot skew it.
    const offenders: string[] = [];
    for (const dir of ['src/ui', 'src/game', 'src/net']) {
      for (const file of tsFilesUnder(dir)) {
        const src = stripComments(readFileSync(file.full, 'utf8'));
        if (offends(src)) offenders.push(`${dir}/${file.file}`);
      }
    }
    expect(offenders, 'hardcoded currency spellings (use usd_text.ts / t() keys)').toEqual([]);
  });

  it('positive control: the scanner sees every shape it hunts, and not the clean forms', () => {
    expect(offends('const x = `$${amount}`;')).toBe(true);
    expect(offends("const x = '$' + amount;")).toBe(true);
    expect(offends('const x = "$"+amount;')).toBe(true);
    expect(offends("const x = amount + '$';")).toBe(true);
    expect(offends('const x = `${amount} USD`;')).toBe(true);
    expect(offends('const x = `${amount} SOL`;')).toBe(true);
    expect(offends('const x = `${amount} USDC`;')).toBe(true);
    expect(offends('const x = `${amount} WOC`;')).toBe(true);
    expect(offends('const x = `${tokens} $WOC`;')).toBe(true);
    // The mid-template and prefix glues: the same defect away from the
    // template's end, and the unit in front of the number.
    expect(offends('const x = `${amount} SOL each`;')).toBe(true);
    expect(offends('const x = `pay ${amount} USD now`;')).toBe(true);
    expect(offends('const x = `about WOC ${amount}`;')).toBe(true);
    expect(offends('const x = `WOC ${amount}`;')).toBe(true);
    expect(offends('const x = `pay WOC${amount}`;')).toBe(true);
    // Ticker-shaped identifiers and longer tickers stay clean: the lookahead
    // rejects a letter after the ticker, and USDC matches as itself.
    expect(offends('const x = `${amount} USDT`;')).toBe(false);
    expect(offends('const x = `${amount} SOLID plan`;')).toBe(false);
    expect(offends('const x = `${amountUSD}`;')).toBe(false);
    expect(offends('const x = `${amount}`;')).toBe(false);
    expect(offends("t('hudChrome.claudium.priceSol', { amount })")).toBe(false);
    expect(offends('const x = usdText(cents);')).toBe(false);
    expect(offends("t('hudChrome.trade.woc.moneyUsd', { usd })")).toBe(false);
  });

  it('walks the corpus through the shared walker only', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});

// @vitest-environment jsdom
// The bank's bonus-slot breakdown footer, EXECUTED.
//
// Four of these claims used to be regexes over src/ui/bank_window.ts's raw text
// (tests/bank_window.test.ts's "bonus-slot breakdown footer" block), which is the
// right tool for a layout ORDER contract and the wrong one for a projection: a
// source pin can say the tokens were present, and it cannot say an unknown source
// id is actually dropped or that the referral row actually chooses its progress
// line. Bank Storage phase 17 moved the code into src/ui/bank_bonus_view.ts and
// the four claims came here, where they are asserted through the real function.
//
// jsdom is used for exactly one thing: mounting the emitted markup so the round
// trip through innerHTML can be asserted on the RENDERED text. Everything else
// runs against the string.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BANK_BONUS_SOURCE_KEYS,
  bankBonusRowHtml,
  bankBonusSectionHtml,
} from '../src/ui/bank_bonus_view';
import type { BankBonusModel, BankBonusRowModel } from '../src/ui/bank_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

// Resolved off the runner's root rather than import.meta.url: this file runs in
// jsdom, where import.meta.url is not a file: URL. The positive control in the
// escaping arm is what stops a wrong path turning the negatives vacuous.
//
// COMMENTS STRIPPED, line comments before block comments (a `//` inside a `/* */`
// would otherwise leave a dangling close). The module's own header discusses the
// shapes this scans for, and an unstripped read finds them there rather than in
// the markup. Two known limits of a strip this cheap, both stated so the exact
// count below is what notices them: no string literal in that file may contain
// `//`, and no `/** */` doc block may contain one either, because the line pass
// would eat that block's close and the block pass would then run on to the NEXT
// `*/`, deleting real code from `source`. Either shape changes the esc() count.
const source = readFileSync(resolve(process.cwd(), 'src/ui/bank_bonus_view.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function row(over: Partial<BankBonusRowModel> = {}): BankBonusRowModel {
  return { id: 'email', slots: 2, maxSlots: 2, earned: true, ...over };
}

function model(over: Partial<BankBonusModel> = {}): BankBonusModel {
  return { show: true, total: 6, rows: [row()], ...over };
}

/** Mount the markup and read it back as a DOM subtree, which is how the painter
 *  uses it (`scroll.insertAdjacentHTML('beforeend', ...)`). */
function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

beforeEach(() => setLanguage('en'));

describe('bankBonusSectionHtml: the section, the header, and the hidden state', () => {
  it('is the EMPTY STRING when the model says hide, which is a no-op at the mount call', () => {
    // Offline `bonusSources` is always [], so `show` is false and the whole
    // section must be absent rather than an empty labelled group.
    expect(bankBonusSectionHtml(model({ show: false }))).toBe('');
    // Asserted at the painter's altitude too: mounting it adds no node at all.
    const host = mount('');
    host.insertAdjacentHTML('beforeend', bankBonusSectionHtml(model({ show: false })));
    expect(host.childElementCount).toBe(0);
  });

  it('builds ONE labelled group carrying the title and the earned total', () => {
    const host = mount(bankBonusSectionHtml(model({ total: 6 })));
    const section = host.querySelector('.bank-bonus');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('role')).toBe('group');
    expect(section?.getAttribute('aria-label')).toBe(t('hudChrome.bank.bonusSectionAria'));
    expect(host.querySelector('.bank-bonus-title')?.textContent).toBe(
      t('hudChrome.bank.bonusTitle'),
    );
    expect(host.querySelector('.bank-bonus-total')?.textContent).toBe(
      t('hudChrome.bank.bonusEarned', { count: '6' }),
    );
    // ONE section, not one per row: a wrapper mistake would otherwise be invisible.
    expect(host.querySelectorAll('.bank-bonus').length).toBe(1);
  });

  it('SKIPS an unknown source id, rendering neither a raw key nor an English fallback', () => {
    // The forward-compat rule the source map exists for: a future X / Twitch row
    // arrives as a new SERVER id and may land before its label ships.
    const html = bankBonusSectionHtml(
      model({ rows: [row({ id: 'email' }), row({ id: 'twitch' }), row({ id: 'discord' })] }),
    );
    const host = mount(html);
    expect(host.querySelectorAll('.bank-bonus-row').length).toBe(2);
    // The id itself never reaches the markup, so a raw key cannot leak through it.
    expect(html).not.toContain('twitch');
    // And the two KNOWN neighbours still rendered, so the skip is not a bail-out
    // that drops the rest of the list.
    const labels = [...host.querySelectorAll('.bank-bonus-label')].map((el) => el.textContent);
    expect(labels).toEqual([
      t('hudChrome.bank.bonusSourceEmail'),
      t('hudChrome.bank.bonusSourceDiscord'),
    ]);
  });

  it('every KNOWN id in the map renders, so the skip arm above cannot pass by dropping everything', () => {
    // The positive control for the skip: without it, a core that returned '' for
    // every row would satisfy the unknown-id claim perfectly.
    const ids = Object.keys(BANK_BONUS_SOURCE_KEYS);
    expect(ids.length).toBeGreaterThan(0);
    const host = mount(bankBonusSectionHtml(model({ rows: ids.map((id) => row({ id })) })));
    expect(host.querySelectorAll('.bank-bonus-row').length).toBe(ids.length);
  });
});

describe('bankBonusRowHtml: the three-way status choice', () => {
  it('a source carrying progress numbers shows {count}/{cap} and its explainer detail', () => {
    const host = mount(
      bankBonusRowHtml(
        row({ id: 'referral', earned: false, slots: 0, count: 3, cap: 5 }),
        BANK_BONUS_SOURCE_KEYS.referral,
      ),
    );
    expect(host.querySelector('.bank-bonus-status')?.textContent).toBe(
      t('hudChrome.bank.bonusReferralProgress', { count: '3', cap: '5' }),
    );
    // The detail line is the always-on explainer, and it is the row's `advert`.
    expect(host.querySelector('.bank-bonus-detail')?.textContent).toBe(
      t('hudChrome.bank.bonusReferralExplainer'),
    );
  });

  it('progress WINS over earned, which is the ordering the referral row depends on', () => {
    // Referral rows are earned AND carry progress. If the earned arm were tested
    // first the player would see '+N' and never the {count}/{cap} they are working
    // toward, and every other arm here would still pass.
    const host = mount(
      bankBonusRowHtml(
        row({ id: 'referral', earned: true, slots: 2, count: 3, cap: 5 }),
        BANK_BONUS_SOURCE_KEYS.referral,
      ),
    );
    expect(host.querySelector('.bank-bonus-status')?.textContent).toBe(
      t('hudChrome.bank.bonusReferralProgress', { count: '3', cap: '5' }),
    );
  });

  it('a HALF-specified progress pair is NOT progress: both count and cap are required', () => {
    // `hasProgress` reads both fields. One alone must fall through to the
    // earned/advert arms rather than render a hole in the sentence.
    for (const partial of [{ count: 3 }, { cap: 5 }]) {
      const host = mount(
        bankBonusRowHtml(
          row({ id: 'referral', earned: true, slots: 2, ...partial }),
          BANK_BONUS_SOURCE_KEYS.referral,
        ),
      );
      expect(host.querySelector('.bank-bonus-status')?.textContent).toBe(
        t('hudChrome.bank.bonusStatusEarned', { count: '2' }),
      );
      expect(host.querySelector('.bank-bonus-detail')).toBeNull();
    }
  });

  it('a ZERO count is still progress, because zero referrals is a real state', () => {
    // The reachable boundary: `count: 0` is falsy, so a truthiness test instead of
    // an `undefined` test would show a brand new player '+0' rather than 0/5.
    const host = mount(
      bankBonusRowHtml(
        row({ id: 'referral', earned: false, slots: 0, count: 0, cap: 5 }),
        BANK_BONUS_SOURCE_KEYS.referral,
      ),
    );
    expect(host.querySelector('.bank-bonus-status')?.textContent).toBe(
      t('hudChrome.bank.bonusReferralProgress', { count: '0', cap: '5' }),
    );
  });

  it('an EARNED link source shows +N and carries the earned class; an unearned one adverts', () => {
    const earned = mount(bankBonusRowHtml(row({ slots: 2 }), BANK_BONUS_SOURCE_KEYS.email));
    expect(earned.querySelector('.bank-bonus-row')?.className).toContain('earned');
    expect(earned.querySelector('.bank-bonus-status')?.textContent).toBe(
      t('hudChrome.bank.bonusStatusEarned', { count: '2' }),
    );
    expect(earned.querySelector('.bank-bonus-detail')).toBeNull();

    const unearned = mount(
      bankBonusRowHtml(row({ earned: false, slots: 0 }), BANK_BONUS_SOURCE_KEYS.email),
    );
    expect(unearned.querySelector('.bank-bonus-row')?.className).not.toContain('earned');
    expect(unearned.querySelector('.bank-bonus-status')?.textContent).toBe(
      t('hudChrome.bank.bonusAdvertEmail'),
    );
  });

  it('the source map points at exactly the thirteen catalog keys, BY LITERAL', () => {
    // The by-literal arm that came out of tests/bank_window.test.ts with the code,
    // and it is the only thing in the tree that names three of these keys at all.
    // Without it, re-pointing bonusAdvertWallet at some other existing, distinct
    // catalog key leaves every behavioural arm below green: they compare rendered
    // text against t(meta.advert), built through the same meta the code uses, so
    // they cannot see a wrong key, only a wrong SHAPE.
    expect(BANK_BONUS_SOURCE_KEYS).toEqual({
      email: {
        label: 'hudChrome.bank.bonusSourceEmail',
        advert: 'hudChrome.bank.bonusAdvertEmail',
      },
      discord: {
        label: 'hudChrome.bank.bonusSourceDiscord',
        advert: 'hudChrome.bank.bonusAdvertDiscord',
      },
      wallet: {
        label: 'hudChrome.bank.bonusSourceWallet',
        advert: 'hudChrome.bank.bonusAdvertWallet',
      },
      referral: {
        label: 'hudChrome.bank.bonusSourceReferral',
        advert: 'hudChrome.bank.bonusReferralExplainer',
      },
    });
    // The section's own five keys, which no row carries.
    for (const key of [
      'hudChrome.bank.bonusSectionAria',
      'hudChrome.bank.bonusTitle',
      'hudChrome.bank.bonusEarned',
      'hudChrome.bank.bonusStatusEarned',
      'hudChrome.bank.bonusReferralProgress',
    ] as const) {
      // Resolves rather than throwing, which is what t() does for an unknown key
      // outside a release build: a renamed catalog entry reds HERE.
      expect(() => t(key), key).not.toThrow();
      expect(source, `${key} is referenced by the core`).toContain(key);
    }
  });

  it('the label is the source map label, and each known id maps to its OWN pair', () => {
    // Walked over the real map rather than a hand-written expectation, so a copy
    // and paste that pointed two sources at one label reds here.
    const seen = new Map<string, string>();
    for (const [id, meta] of Object.entries(BANK_BONUS_SOURCE_KEYS)) {
      const host = mount(bankBonusRowHtml(row({ id, earned: false, slots: 0 }), meta));
      expect(host.querySelector('.bank-bonus-label')?.textContent).toBe(t(meta.label));
      expect(seen.has(meta.label), `${id} reuses label ${meta.label}`).toBe(false);
      seen.set(meta.label, id);
    }
    expect(seen.size).toBe(Object.keys(BANK_BONUS_SOURCE_KEYS).length);
  });
});

describe('the section is localized, and the markup form did not cost that', () => {
  it('relocalizes: the SAME model produces different text after a language switch', async () => {
    // The core resolves t() at CALL time and stores no sentence, which is what
    // keeps a bank painted in one language from keeping an English row after a
    // switch (the bankRungNotice rule, one module over).
    const before = bankBonusSectionHtml(model());
    // LOADED, not merely selected: setLanguage alone leaves t() on the English
    // fallback table, and then the two strings compare EQUAL and the arm passes
    // while proving nothing. Asserting the fixture moved is what keeps it honest.
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const jaTitle = t('hudChrome.bank.bonusTitle');
    const after = bankBonusSectionHtml(model());
    // Read the localized fixture BEFORE switching back: t() answers for whatever
    // language is current at the moment it is CALLED, which is the whole property
    // under test and also the easiest way to write an arm that reads the wrong one.
    setLanguage('en');
    expect(jaTitle).not.toBe(t('hudChrome.bank.bonusTitle'));
    expect(after).not.toBe(before);
    expect(after).toContain(jaTitle);
    // ...and switching back restores it, so nothing was cached into the module.
    expect(bankBonusSectionHtml(model())).toBe(before);
  });

  it('no resolved text reaches the markup unescaped', () => {
    // MECHANICAL half, and its reach is stated rather than implied. Nothing in this
    // module has a REACHABLE html-significant input: every visible string is a t()
    // value from the shipped catalog and every number goes through formatCount, and
    // t() throws on a key it does not know, so no test can feed a '<' in from
    // outside. The escaping is therefore a tripwire for a future locale value, not
    // an injection boundary, and a source pin is the only instrument that reaches
    // it. What it scans for are the three shapes that would actually occur: a t()
    // call, a formatted number, or the resolved status string interpolated raw.
    expect(source).not.toMatch(/\$\{\s*t\(/);
    expect(source).not.toMatch(/\$\{\s*formatCount\(/);
    expect(source).not.toMatch(/\$\{\s*status\s*\}/);
    // Positive control, without which the three negatives above pass over an empty
    // read, a renamed file, or a rewrite that emits no interpolation at all. EXACT
    // rather than a floor, because it is doing a second job: it is also what
    // notices the comment-strip limits named at the top of this file, which a
    // >= bound cannot, since a partial over-consume leaves plenty of esc sites.
    expect((source.match(/\$\{esc\(/g) ?? []).length).toBe(6);
    // And the module really is the one under test: a path that resolved to some
    // other file would satisfy everything above.
    expect(source).toContain('export function bankBonusSectionHtml');
  });

  it('round trips through innerHTML with the resolved text intact', () => {
    // BEHAVIOURAL half of the same claim: the markup the painter mounts renders
    // back to exactly the strings t() resolved, entity-mangling included.
    const host = mount(
      bankBonusSectionHtml(
        model({ rows: [row({ id: 'referral', earned: false, slots: 0, count: 3, cap: 5 })] }),
      ),
    );
    expect(host.textContent).toBe(
      t('hudChrome.bank.bonusTitle') +
        t('hudChrome.bank.bonusEarned', { count: '6' }) +
        t('hudChrome.bank.bonusSourceReferral') +
        t('hudChrome.bank.bonusReferralProgress', { count: '3', cap: '5' }) +
        t('hudChrome.bank.bonusReferralExplainer'),
    );
  });
});

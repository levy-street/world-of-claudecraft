// The professions-FAQ question roster (Phase 18): the QUESTION keys are a named
// static list beside FAQ_ANSWER_KEYS instead of a positional `faq.q${n}`
// template. An indexed template re-points every following question when a row
// is inserted mid-list, silently pairing questions with the wrong answers; two
// named rosters walked in lockstep cannot shift apart. This suite pins the
// roster literally, proves the renderer walks it in order, and scans the page
// module's source so the positional template cannot quietly return.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAQ_ANSWER_KEYS,
  FAQ_QUESTION_KEYS,
  faqDetailHtml,
  PROF_FAQ_COUNT,
} from '../src/guide/pages/professions_faq';
import { esc } from '../src/ui/esc';
import { setLanguage, t } from '../src/ui/i18n';

describe('professions FAQ question keys are a named roster', () => {
  it('pins the roster literally, in lockstep with the answers', () => {
    // The LITERAL list, not a derivation: the roster agreeing with itself is
    // exactly the failure this pin exists to catch (same doctrine as the
    // FAQ_ANSWER_KEYS pin in tests/guide.test.ts).
    expect(FAQ_QUESTION_KEYS).toEqual([
      'guide.profPages.faq.q1',
      'guide.profPages.faq.q2',
      'guide.profPages.faq.q3',
      'guide.profPages.faq.q4',
      'guide.profPages.faq.q5',
      'guide.profPages.faq.q6',
      'guide.profPages.faq.q7',
      'guide.profPages.faq.q8',
      'guide.profPages.faq.q9',
      'guide.profPages.faq.q10',
      'guide.profPages.faq.q11',
    ]);
    expect(FAQ_QUESTION_KEYS).toHaveLength(PROF_FAQ_COUNT);
    expect(FAQ_ANSWER_KEYS).toHaveLength(PROF_FAQ_COUNT);
  });

  it('renders every question from the roster, in roster order', () => {
    setLanguage('en');
    const html = faqDetailHtml();
    let cursor = -1;
    for (const key of FAQ_QUESTION_KEYS) {
      const text = t(key);
      expect(text.length, key).toBeGreaterThan(0);
      const at = html.indexOf(`<summary>${esc(text)}</summary>`, cursor + 1);
      expect(at, `${key} must render after its predecessor`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('the page module no longer builds a positional faq.q template', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/guide/pages/professions_faq.ts'),
      'utf8',
    );
    // Concatenated so this guard can never match its own source.
    expect(src.includes('faq.q$' + '{')).toBe(false);
  });
});

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
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_GATHERING,
  GUIDE_PROF_STATIONS,
} from '../src/guide/content.generated';
import {
  capGroups,
  engineeringStarterRecipes,
  FAQ_ANSWER_KEYS,
  FAQ_QUESTION_KEYS,
  FREE_CEILING_TIER,
  faqAnchor,
  faqAnswerHtml,
  faqDetailHtml,
  landToolWieldLadder,
  PROF_FAQ_COUNT,
  toolLadders,
} from '../src/guide/pages/professions_faq';
import { buildIndex } from '../src/guide/search';
import { QUESTS } from '../src/sim/data';
import { JACK_CEILING_TIER } from '../src/sim/professions/archetype';
import { esc } from '../src/ui/esc';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

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
      'guide.profPages.faq.q12',
      'guide.profPages.faq.q13',
      'guide.profPages.faq.q14',
      'guide.profPages.faq.q15',
      'guide.profPages.faq.q16',
      'guide.profPages.faq.q17',
      'guide.profPages.faq.q18',
      'guide.profPages.faq.q19',
      'guide.profPages.faq.q20',
      'guide.profPages.faq.q21',
      'guide.profPages.faq.q22',
      'guide.profPages.faq.q23',
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

// The most-asked profession questions from live chat (rows 12 on). Their
// answers are filled from generated data, so these pins check the facts each
// SENTENCE leans on, not just that a key resolves.
describe('professions FAQ: the most-asked chat questions', () => {
  const NEW_ROWS = FAQ_ANSWER_KEYS.slice(11);

  it('renders every new answer with no unfilled placeholder, in English and Japanese', async () => {
    expect(NEW_ROWS).toHaveLength(12);
    for (const lang of ['en', 'ja_JP'] as const) {
      if (lang !== 'en') await ensureLocaleLoaded(lang);
      setLanguage(lang);
      try {
        for (const key of NEW_ROWS) {
          const html = faqAnswerHtml(key);
          expect(html.length, `${lang} ${key}`).toBeGreaterThan(40);
          expect(html, `${lang} ${key} left a placeholder`).not.toMatch(/\{[a-zA-Z]+\}/);
          expect(html, `${lang} ${key} rendered a raw key`).not.toContain('guide.profPages');
        }
      } finally {
        setLanguage('en');
      }
    }
  });

  it('gives every question its own anchor, and the search lands on it', () => {
    setLanguage('en');
    const html = faqDetailHtml();
    const index = buildIndex();
    FAQ_QUESTION_KEYS.forEach((key, i) => {
      expect(html, key).toContain(`id="${faqAnchor(i + 1)}"`);
      const hit = index.find((e) => e.label === t(key));
      expect(hit?.href, key).toBe(`/wiki/professions/faq#${faqAnchor(i + 1)}`);
    });
  });

  it('speaks for all three land tools with one wield ladder because they share it', () => {
    const mining = landToolWieldLadder('mining');
    expect(mining.length).toBeGreaterThan(0);
    expect(landToolWieldLadder('herbalism')).toEqual(mining);
    expect(landToolWieldLadder('logging')).toEqual(mining);
  });

  it('names the masters who really teach the charm, Jewelcrafting and Inscription rows', () => {
    // a14 says the toolworks teaches the charms, the forge Jewelcrafting, and
    // the apothecary Inscription; every trainer row of each craft must agree.
    const stationsOf = (craftId: string) =>
      new Set(
        (GUIDE_PROF_CRAFTS.find((c) => c.id === craftId)?.recipes ?? [])
          .filter((r) => r.acquisition === 'trainer')
          .map((r) => r.station),
      );
    expect(stationsOf('enchanting')).toEqual(new Set(['toolworks']));
    expect(stationsOf('jewelcrafting')).toEqual(new Set(['forge']));
    expect(stationsOf('inscription')).toEqual(new Set(['apothecary']));
    for (const type of ['toolworks', 'forge', 'apothecary']) {
      expect(GUIDE_PROF_STATIONS.stations.find((s) => s.type === type)?.master, type).toBeDefined();
    }
  });

  it('starts Engineering where a20 says, with the toolworks master giving the Bombardier quest', () => {
    // The overview used to call Engineering the one holdout with no rung below
    // the rare tier; the trainer now teaches from skill 0. If the low rungs are
    // ever removed, a20 and whatBodyAllTen are wrong again and this reds.
    expect(FREE_CEILING_TIER).toBe(JACK_CEILING_TIER);
    const starters = engineeringStarterRecipes();
    expect(starters.length).toBeGreaterThan(0);
    expect(starters[0].skill).toBe(0);
    const quest = QUESTS.q_prof_attune_bombardier;
    expect(quest?.giverNpcId).toBe('tinker_gizzel');
    const toolworks = GUIDE_PROF_STATIONS.stations.find((s) => s.type === 'toolworks');
    expect(toolworks?.master?.name).toBe('Tinker Gizzel');
    setLanguage('en');
    const overview = t('guide.professions.whatBodyAllTen');
    expect(overview).not.toMatch(/holdout|nine of the ten/i);
    expect(t('guide.profPages.faq.a18')).not.toMatch(/nine of the ten/i);
  });

  it('lists every skill cap and every tool ladder the data has', () => {
    const capped = capGroups().flatMap((g) => g.names);
    expect(capped).toHaveLength(10 + GUIDE_PROF_GATHERING.length);
    const ladders = toolLadders();
    expect(ladders.map((l) => l.profession).sort()).toEqual(
      GUIDE_PROF_GATHERING.map((g) => g.id).sort(),
    );
    for (const l of ladders) expect(l.craftTier, l.profession).toBeGreaterThan(l.vendorTier);
  });
});

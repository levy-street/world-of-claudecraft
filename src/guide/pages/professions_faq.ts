// Professions FAQ (/wiki/professions/faq): the recurring crafter questions,
// answered with the exact numbers the other professions pages publish (the
// transparency policy). Mirrors the sitewide FAQ page's
// details/summary structure; questions and answers are guide.profPages.faq.*
// t() keys, English-only at PR tier.
//
// Questions 12 on are the most-asked profession questions in live chat, ranked
// from the 2026-07-06 to 2026-09-28 chat log. Every number, NPC, and town in
// their answers is filled from the generated data (FAQ_ANSWER_EXTRAS), so an
// answer cannot drift from the game. Each question carries its own anchor
// (faqAnchor) so the wiki search can land on it, and the app opens a
// <details> it lands on.

import { esc } from '../../ui/esc';
import { formatList, formatNumber, type TranslationKey, t } from '../../ui/i18n';
import {
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_CURVE,
  GUIDE_PROF_ENCHANTING,
  GUIDE_PROF_GATHERING,
  GUIDE_PROF_RING,
  GUIDE_PROF_STATIONS,
  type GuideProfStation,
} from '../content.generated';
import { hrefFor } from '../routes';
import { craftLabel, stationLabel } from './professions_craft';
import { gatheringLabel } from './professions_gathering';
import { paras, related } from './ui';

export const PROF_FAQ_COUNT = 23;

/** The in-page anchor of FAQ row n (1-based), shared with the search index. */
export function faqAnchor(n: number): string {
  return `prof-faq-${n}`;
}

/**
 * The answer key per row, NAMED rather than built from the index.
 *
 * WHY THIS IS A LIST AND NOT A TEMPLATE LITERAL (Phase 11i QA). A key built as
 * `faq.a${n}` cannot be RETIRED AND RE-KEYED, and retiring a key is the only
 * mechanism this repo has that forces a `pending` row in every locale when an
 * English value stops being true. Rewording in place leaves every already
 * translated overlay `translated` and wrong, with no gate that can see it, and
 * a7 spent this phase telling fifteen locales a fishing gain curve the sim
 * retired. Naming the keys costs one line each and makes every row of this page
 * fixable the same way the fishing prose was.
 *
 * The QUESTION keys are named too (Phase 18): a question cannot go stale the
 * way an answer can, but an index-built `faq.qN` key still re-points every
 * following question when a row is inserted mid-list, silently pairing each
 * question with the wrong answer. Two named rosters walk in lockstep instead
 * (pinned by tests/guide_prof_faq_keys.test.ts).
 */
export const FAQ_QUESTION_KEYS: readonly TranslationKey[] = [
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
];

export const FAQ_ANSWER_KEYS: readonly TranslationKey[] = [
  'guide.profPages.faq.a1',
  'guide.profPages.faq.a2',
  'guide.profPages.faq.a3',
  'guide.profPages.faq.a4',
  'guide.profPages.faq.a5',
  'guide.profPages.faq.a6ThreeRods',
  'guide.profPages.faq.a7RetunedTaper',
  'guide.profPages.faq.a8',
  'guide.profPages.faq.a9',
  'guide.profPages.faq.a10',
  'guide.profPages.faq.a11Promotion',
  'guide.profPages.faq.a12',
  'guide.profPages.faq.a13',
  'guide.profPages.faq.a14',
  'guide.profPages.faq.a15',
  'guide.profPages.faq.a16',
  'guide.profPages.faq.a17',
  'guide.profPages.faq.a18',
  'guide.profPages.faq.a19',
  'guide.profPages.faq.a20',
  'guide.profPages.faq.a21',
  'guide.profPages.faq.a22',
  'guide.profPages.faq.a23',
];

const qualityLabel = (q: string): string => t(`itemUi.quality.${q}` as TranslationKey);

/** The rare tier, the highest an unattuned craft advances through
 *  (src/sim/professions/archetype.ts RARE_CEILING_TIER, exported there as
 *  JACK_CEILING_TIER; tests/guide_prof_materials.test.ts pins the two equal). */
export const FREE_CEILING_TIER = 2;

/** Engineering's trainer rungs an unattuned character can learn: every
 *  trainer recipe at or below the rare tier, lowest first. */
export function engineeringStarterRecipes(): { name: string; skill: number }[] {
  const eng = GUIDE_PROF_CRAFTS.find((c) => c.id === 'engineering');
  return (eng?.recipes ?? [])
    .filter((r) => r.acquisition === 'trainer' && r.tier <= FREE_CEILING_TIER)
    .sort((a, b) => a.skillReq - b.skillReq || a.name.localeCompare(b.name))
    .map((r) => ({ name: r.name, skill: r.skillReq }));
}
const LAND_TOOL_PROFESSIONS = ['mining', 'herbalism', 'logging'] as const;

function stationOf(type: string): GuideProfStation | undefined {
  return GUIDE_PROF_STATIONS.stations.find((s) => s.type === type);
}

/** The proficiency each land-tool tier needs before it works ("tier 2 at
 *  40"), read off the Mining ladder. Exported for the test that pins the
 *  three land trades to one shared ladder, which is what lets one sentence
 *  speak for the pick, the sickle, and the axe. */
export function landToolWieldLadder(professionId = 'mining'): { tier: number; skill: number }[] {
  const g = GUIDE_PROF_GATHERING.find((x) => x.id === professionId);
  return (g?.tools ?? [])
    .filter((tool) => (tool.wieldProficiency ?? 0) > 0)
    .map((tool) => ({ tier: tool.tier, skill: tool.wieldProficiency ?? 0 }));
}

/** Skill caps grouped by value, crafts then gathering trades. */
export function capGroups(): { names: string[]; cap: number }[] {
  const groups = new Map<number, string[]>();
  const add = (cap: number, name: string) => groups.set(cap, [...(groups.get(cap) ?? []), name]);
  for (const c of GUIDE_PROF_RING) add(c.maxSkill, craftLabel(c.id));
  for (const g of GUIDE_PROF_GATHERING) add(g.maxSkill, gatheringLabel(g.id));
  return [...groups.entries()].map(([cap, names]) => ({ names, cap }));
}

/** Per gathering trade: the highest tier a vendor stocks and the lowest tier
 *  Engineering crafts, read off the generated tool ladders. */
export function toolLadders(): { profession: string; vendorTier: number; craftTier: number }[] {
  return GUIDE_PROF_GATHERING.flatMap((g) => {
    const vendorTiers = g.tools.filter((tool) => tool.vendors.length > 0).map((tool) => tool.tier);
    const craftTiers = g.tools.filter((tool) => tool.craftedBy).map((tool) => tool.tier);
    if (vendorTiers.length === 0 || craftTiers.length === 0) return [];
    return [
      {
        profession: g.id,
        vendorTier: Math.max(...vendorTiers),
        craftTier: Math.min(...craftTiers),
      },
    ];
  });
}

/** The vendors that stock tools across the most gathering trades, top three. */
function mainToolVendors(): string[] {
  const counts = new Map<string, { name: string; hub: string; n: number }>();
  for (const g of GUIDE_PROF_GATHERING) {
    for (const tool of g.tools) {
      for (const v of tool.vendors) {
        const key = `${v.name}@${v.hub}`;
        const row = counts.get(key) ?? { name: v.name, hub: v.hub, n: 0 };
        row.n += 1;
        counts.set(key, row);
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((v) => t('guide.profPages.faq.npcInTownFmt', { name: v.name, town: v.hub }));
}

interface FaqExtra {
  values?: () => Record<string, string>;
  list?: () => string[];
  /** Render the list above the answer text instead of below it. */
  listFirst?: boolean;
}

/** The generated values and lists the data-driven answers read. Exported so
 *  the tests can check every placeholder is filled. */
export const FAQ_ANSWER_EXTRAS: Partial<Record<TranslationKey, FaqExtra>> = {
  'guide.profPages.faq.a13': {
    values: () => ({
      wieldLadder: formatList(
        landToolWieldLadder().map((step) =>
          t('guide.profPages.faq.wieldStepFmt', {
            tier: formatNumber(step.tier),
            skill: formatNumber(step.skill),
          }),
        ),
      ),
    }),
  },
  'guide.profPages.faq.a14': {
    values: () => ({
      toolworksMaster: stationOf('toolworks')?.master?.name ?? '',
      toolworksHub: stationOf('toolworks')?.hub ?? '',
      forgeMaster: stationOf('forge')?.master?.name ?? '',
      forgeHub: stationOf('forge')?.hub ?? '',
      apothecaryMaster: stationOf('apothecary')?.master?.name ?? '',
      apothecaryHub: stationOf('apothecary')?.hub ?? '',
    }),
  },
  'guide.profPages.faq.a16': {
    values: () => {
      const byMaterial = new Map<string, string[]>();
      for (const row of GUIDE_PROF_ENCHANTING.disenchantByQuality) {
        byMaterial.set(row.material, [
          ...(byMaterial.get(row.material) ?? []),
          qualityLabel(row.quality),
        ]);
      }
      return {
        yields: formatList(
          [...byMaterial.entries()].map(([material, qualities]) =>
            t('guide.profPages.faq.disenchantYieldFmt', {
              material,
              quality: formatList(qualities),
            }),
          ),
        ),
      };
    },
  },
  'guide.profPages.faq.a17': {
    listFirst: true,
    list: () =>
      capGroups().map((g) =>
        t('guide.profPages.faq.capGroupFmt', {
          names: formatList(g.names),
          cap: formatNumber(g.cap),
        }),
      ),
  },
  'guide.profPages.faq.a19': {
    listFirst: true,
    values: () => ({ vendors: formatList(mainToolVendors()) }),
    list: () =>
      toolLadders().map((l) =>
        t('guide.profPages.faq.toolLadderFmt', {
          profession: gatheringLabel(l.profession),
          vendorTier: formatNumber(l.vendorTier),
          craftTier: formatNumber(l.craftTier),
        }),
      ),
  },
  'guide.profPages.faq.a20': {
    values: () => ({
      starters: formatList(
        engineeringStarterRecipes().map((r) =>
          t('guide.profPages.faq.recipeAtSkillFmt', {
            name: r.name,
            skill: formatNumber(r.skill),
          }),
        ),
      ),
      freeCeiling: formatNumber((FREE_CEILING_TIER + 1) * GUIDE_PROF_CURVE.tierStep - 1),
      master: stationOf('toolworks')?.master?.name ?? '',
      hub: stationOf('toolworks')?.hub ?? '',
    }),
  },
  'guide.profPages.faq.a21': {
    values: () => ({ radius: formatNumber(GUIDE_PROF_STATIONS.radius) }),
    list: () =>
      GUIDE_PROF_STATIONS.stations.map((st) =>
        t('guide.profPages.faq.stationFmt', {
          station: stationLabel(st.type),
          master: st.master?.name ?? '',
          hub: st.hub,
        }),
      ),
  },
  'guide.profPages.faq.a23': {
    values: () => {
      const fishing = GUIDE_PROF_GATHERING.find((g) => g.id === 'fishing')?.fishing;
      return {
        biteMin: formatNumber(fishing?.biteMinSec ?? 0),
        biteMax: formatNumber(fishing?.biteMaxSec ?? 0),
        reelWindow: formatNumber(fishing?.reelWindowSec ?? 0, { maximumFractionDigits: 1 }),
      };
    },
  },
};

/** One answer's HTML: its paragraphs with any generated values, plus its
 *  generated list. Exported for the tests. */
export function faqAnswerHtml(key: TranslationKey): string {
  const extra = FAQ_ANSWER_EXTRAS[key];
  const text = paras(key, extra?.values?.());
  const items = extra?.list?.() ?? [];
  if (items.length === 0) return text;
  const list = `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  return extra?.listFirst ? list + text : text + list;
}

export function faqDetailHtml(): string {
  const items: string[] = [];
  for (let n = 1; n <= PROF_FAQ_COUNT; n += 1) {
    const q = t(FAQ_QUESTION_KEYS[n - 1]);
    const a = faqAnswerHtml(FAQ_ANSWER_KEYS[n - 1]);
    items.push(
      `<details class="guide-faq-item" id="${faqAnchor(n)}"><summary>${esc(q)}</summary>${a}</details>`,
    );
  }
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(t('guide.profPages.faq.title'))}</h1>
      <p class="guide-lead">${esc(t('guide.profPages.faq.intro'))}</p>
      <div class="guide-faq">${items.join('')}</div>
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('professions/materials'), key: 'guide.profPages.mat.title' },
        { href: hrefFor('npcs'), key: 'guide.nav.npcs' },
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
        { href: hrefFor('faq'), key: 'guide.nav.faq' },
      ])}
    </article>`;
}

// @vitest-environment happy-dom

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Every guide.* key the render sweep below actually resolved. The i18n module is wrapped
// (not replaced) so t()/tOptional() behave exactly as in production and only record what
// they were asked for.
const seen = new Set<string>();

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const realT = actual.t as (k: string, v?: unknown) => string;
  const realTOptional = actual.tOptional as (k: string, v?: unknown) => string | undefined;
  return {
    ...actual,
    t: (k: string, v?: unknown) => {
      seen.add(k);
      return realT(k, v);
    },
    tOptional: (k: string, v?: unknown) => {
      seen.add(k);
      return realTOptional(k, v);
    },
  };
});

// The same inert 2D context tests/guide_route_render.test.ts uses: happy-dom ships no
// canvas backend and the procedural icon painter throws without one. Nothing here reads a
// pixel; the claim under test is which KEYS were asked for.
function inertContext2d(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      switch (prop) {
        case 'measureText':
          return () => ({ width: 0 });
        case 'createLinearGradient':
        case 'createRadialGradient':
        case 'createConicGradient':
          return () => gradient;
        case 'createPattern':
          return () => null;
        case 'getImageData':
          return (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
            width: w,
            height: h,
          });
        case 'canvas':
          return { width: 0, height: 0 };
        default:
          return () => undefined;
      }
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * Keys kept in the catalog on purpose with NO live consumer left in the code.
 *
 * The catalog cannot simply drop them: every locale overlay under src/ui/i18n.locales/
 * still carries a reviewed translation for each one, and the maintainer's release fill
 * works from the catalog. Deleting the English source would orphan 21 locale rows and
 * (for the placeholder migrations below) throw away prose a human already reviewed.
 *
 * Nothing distinguished a deliberately retired key from a key a page stopped rendering by
 * accident until this list existed. Retiring a key is now an explicit, reviewed act: add
 * it here WITH ITS REASON, or the sweep at the bottom of this file fails.
 *
 * The rule that keeps this list honest: a retired key must have NO reference left in
 * src/. The `has no live reference` test below proves it, so this list can never be used
 * to silence a key that a page really does try to render.
 */
const RETIRED_KEYS: string[] = [
  // -- Placeholder migrations. A {placeholder} may never be added to an already-translated
  // key: it breaks interpolation parity in all 21 locales. Each of these was replaced by a
  // NEW *Count key carrying the token, and the original stays behind, untouched.
  'guide.faqPage.a6', // -> guide.faqPage.a6Count ({zones})
  'guide.home.faq.a4', // -> guide.home.faq.a4Count ({zones})
  'guide.home.world.sub', // -> guide.home.world.subCount ({zones})
  'guide.progression.journeyBody', // -> guide.progression.journeyBodyCount ({zones})

  // -- Reworded successors. The replacement says something materially different, so the
  // old value is not a stale translation to fix but a claim the game no longer makes.
  'guide.gear.soulboundBody', // -> guide.gear.soulboundBodyBound (bind-on-trade rules)
  'guide.profPages.ench.enchantsNote', // -> guide.profPages.ench.enchantsNoteOffhand
  'guide.profPages.specimenBody', // -> guide.profPages.specimenBodyFamilies
  'guide.professions.focusBody', // -> guide.professions.focusBodyTiers
  'guide.professions.harvestBodyChoice', // folded into the harvest section's body copy

  // -- Content the game no longer has, so the wiki must not define it.
  // The glossary defined Augment as a draft pick in a two-on-two Fiesta match.
  // Fiesta is retired and is not among the tabs the PvP window offers, so the term
  // described content no player can reach.
  'guide.glossary.augmentTerm',
  'guide.glossary.augmentDef',
  'guide.bestiary.flavor.mirejaw_frenzy', // summon-only encounter add, filtered from the bestiary
  'guide.footer.communityWiki', // the standalone MediaWiki redirect this SPA replaced

  // -- Superseded by generated content. These were hand-written dungeon facts before
  // GUIDE_DUNGEONS carried the roster; the page now renders names and level bands from
  // the sim, so a hardcoded name here could only ever drift.
  'guide.dungeonsPage.bastionName',
  'guide.dungeonsPage.hollowName',
  'guide.dungeonsPage.sanctumName',
  'guide.dungeonsPage.templeName',
  'guide.dungeonsPage.levelAround',
  'guide.dungeonsPage.raidSize',

  // -- Label variants a redesign dropped. The information still reaches the reader; only
  // this presentation of it is gone.
  'guide.classPage.roleLabel', // role and resource are hero badges now, using the
  'guide.classPage.resourceLabel', // shared classDetails.labels.* keys
  'guide.delvesPage.affixesLabel', // the affix pills sit under affixesHeading instead
  'guide.professions.craftHowTitle', // the crafting-window section was folded into craftBody
  'guide.nav.onThisPage', // the in-page TOC is labelled by guide.toc.heading
  'guide.nav.reference', // the sidebar heading comes from guide.groups.reference
  'guide.nav.backToGame', // the guide links out with guide.nav.playNow
  'guide.brandShort', // every surface renders the full guide.brand
  'guide.loading', // the SPA shell paints its own skeleton, never a loading string
  'guide.models.count', // the models page heads its grid without a running count

  // -- Orphaned by a computed key whose input set moved.
  // guide.groups.<GuideGroup>: 'compendium' was the single pre-split bucket, and is no
  // longer a GuideGroup (see the split comment in src/guide/routes.ts).
  'guide.groups.compendium',
  // guide.classHook.<classId>: the one-line class teaser. The class chooser renders the
  // curated feel tags from src/guide/class_meta.ts instead, so nothing calls it any more.
  'guide.classHook.druid',
  'guide.classHook.hunter',
  'guide.classHook.mage',
  'guide.classHook.paladin',
  'guide.classHook.priest',
  'guide.classHook.rogue',
  'guide.classHook.shaman',
  'guide.classHook.warlock',
  'guide.classHook.warrior',
  // guide.abilityHook.<abilityId>: rendered by class_view.ts for the abilities in a class's
  // GENERATED signature kit (plus 'thorns', which src/ui/talent_i18n.ts resolves). These
  // nine are mage abilities that are no longer in that kit, so no page asks for them.
  'guide.abilityHook.blizzard',
  'guide.abilityHook.brain_freeze',
  'guide.abilityHook.conjure_food',
  'guide.abilityHook.fingers_of_frost',
  'guide.abilityHook.fireball_form',
  'guide.abilityHook.flurry',
  'guide.abilityHook.frozen_orb',
  'guide.abilityHook.ice_lance',
  'guide.abilityHook.shatter',
];

/**
 * Keys with a LIVE consumer that this file's static render sweep structurally cannot
 * reach: a DOM event handler, a lazily imported module, or a data branch today's
 * generated content never takes. They are not retired, and deleting one would break real
 * code.
 *
 * The rule that keeps this list honest is the mirror of the one above: every entry must
 * still have a real reference in src/. The `still has a live reference` test proves it, so
 * this list cannot be used to park a key that has quietly become dead.
 */
const LIVE_OFF_SWEEP_KEYS: string[] = [
  // Event handlers: only reached after a click or keystroke.
  'guide.chooser.results', // class-chooser filter count (src/guide/pages/classes.ts)
  'guide.nav.closeMenu', // mobile menu toggle's open-state label (src/guide/chrome.ts)
  'guide.search.noResults', // empty search panel (src/guide/search.ts)

  // The app shell, which owns document.title rather than any page's markup.
  'guide.docTitle', // src/guide/app.ts

  // The lazy 3D model viewer: a separate chunk that pulls in three.js, mounted only on
  // demand so the main guide bundle stays free of it (src/guide/viewer/).
  'guide.viewer.canvasLabel',
  'guide.viewer.error',
  'guide.viewer.loading',

  // Fallback branches in the gathering-tool Source cell. Every tool the generator emits
  // today is either crafted with a Marks price or vendor-stocked, so these two arms are
  // live defensive code that current content never selects
  // (src/guide/pages/professions_gathering.ts).
  'guide.profPages.toolCrafted',
  'guide.profPages.toolUnavailable',
];

/** Flatten the catalog to the dotted guide.* leaf paths a reader could be shown. */
function flattenCatalog(obj: unknown, prefix: string, out: string[]): void {
  if (typeof obj === 'string') {
    out.push(prefix);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flattenCatalog(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

const SRC = path.resolve(__dirname, '../src');

/** Every .ts file under src/, minus the catalog itself and the generated/overlay i18n data. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'i18n.locales' || e.name === 'i18n.resolved.generated') continue;
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      if (full.endsWith(path.join('i18n.catalog', 'guide.ts'))) continue;
      if (e.name === 'translation_keys.generated.ts') continue;
      out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/**
 * Real (non-comment) references to a key anywhere in src/.
 *
 * The trailing guard matters: a plain substring search for 'guide.faqPage.a6' also matches
 * 'guide.faqPage.a6Count', which is exactly the successor key that made a6 retired, so an
 * unguarded scan would report every placeholder migration as still live. Comment lines are
 * skipped because several retirements are documented by name in the source they left.
 */
function liveReferences(key: string, files: string[]): string[] {
  const re = new RegExp(`${key.replace(/\./g, '\\.')}(?![A-Za-z0-9_])`);
  const hits: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (re.test(line)) hits.push(`${path.relative(SRC, file)}:${i + 1}`);
    });
  }
  return hits;
}

/**
 * Every guide.* key the whole SPA renders, gathered by driving each surface the way the
 * app drives it: every route, both parameterized detail families, the nav chrome, the head
 * metadata, the search index, the breadcrumb/prev-next aids, the in-page TOC, and the two
 * fallback pages.
 *
 * A key nothing here asks for is one no reader can see, which is the whole point: the
 * previous refresh left nine keys stranded and nothing failed, because a stranded key is
 * invisible (it costs a locale row, not a broken page). Tests that render pages catch the
 * opposite defect, a key that IS asked for and does not resolve.
 */
describe('Guide key coverage', () => {
  const catalogKeys: string[] = [];
  let files: string[] = [];

  beforeAll(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (kind: string) => (kind === '2d' ? inertContext2d() : null) as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');

    const { setLanguage } = await import('../src/ui/i18n');
    const { GUIDE_ROUTES } = await import('../src/guide/routes');
    const { pageFor, placeholderHtml, notFoundHtml } = await import('../src/guide/pages');
    const { buildChrome } = await import('../src/guide/chrome');
    const { applyRouteHead } = await import('../src/guide/head');
    const { buildIndex } = await import('../src/guide/search');
    const { breadcrumbHtml, mountToc, sequenceHtml } = await import('../src/guide/nav_aids');
    const { GUIDE_CLASSES, GUIDE_PROF_PAGES } = await import('../src/guide/content.generated');
    const { guideStrings } = await import('../src/ui/i18n.catalog/guide');

    setLanguage('en');

    for (const route of GUIDE_ROUTES) {
      pageFor(route.id)?.render({ params: [], sub: route.sub, titleKey: route.navKey });
      breadcrumbHtml(route, false, 'leaf');
      breadcrumbHtml(route, true, 'leaf');
      sequenceHtml(route);
      applyRouteHead({ route, sub: route.sub, title: 'title', detailId: null });
    }

    const classRoute = GUIDE_ROUTES.find((r) => r.id === 'classes');
    if (!classRoute) throw new Error('the classes route disappeared');
    for (const c of GUIDE_CLASSES) {
      pageFor('classes')?.render({
        params: [c.id],
        sub: 'classes',
        titleKey: 'guide.nav.classes',
      });
      applyRouteHead({ route: classRoute, sub: 'classes', title: 'title', detailId: c.id });
    }

    const profRoute = GUIDE_ROUTES.find((r) => r.id === 'professions');
    if (!profRoute) throw new Error('the professions route disappeared');
    for (const id of GUIDE_PROF_PAGES) {
      pageFor('professions')?.render({
        params: [id],
        sub: 'professions',
        titleKey: 'guide.nav.professions',
      });
      applyRouteHead({ route: profRoute, sub: 'professions', title: 'title', detailId: id });
    }

    placeholderHtml({ params: [], sub: '', titleKey: 'guide.nav.overview' });
    notFoundHtml();
    applyRouteHead({ route: null, sub: 'nope', title: 'title', detailId: null });
    buildIndex();

    // The in-page TOC mounts against a rendered article, so give it one with enough h2s
    // to clear its own three-heading floor.
    const main = document.createElement('div');
    main.innerHTML =
      pageFor('settings')?.render({
        params: [],
        sub: 'reference/settings',
        titleKey: 'guide.nav.settings',
      }) ?? '';
    document.body.appendChild(main);
    mountToc(main);

    buildChrome(
      document.createElement('div'),
      { onLanguageChange: () => {} },
      new AbortController().signal,
    );

    flattenCatalog(guideStrings, 'guide', catalogKeys);
    files = sourceFiles();
  });

  afterAll(() => vi.restoreAllMocks());

  it('renders every catalog key that is not explicitly retired or off-sweep', () => {
    const allowed = new Set([...RETIRED_KEYS, ...LIVE_OFF_SWEEP_KEYS]);
    const stranded = catalogKeys.filter((k) => !seen.has(k) && !allowed.has(k)).sort();
    expect(
      stranded,
      'these guide.* keys are in the catalog but no guide surface renders them. Either wire ' +
        'the key up, or retire it explicitly in RETIRED_KEYS / LIVE_OFF_SWEEP_KEYS with its reason.',
    ).toEqual([]);
  });

  it('has no retired key that is still referenced in src/', () => {
    const resurrected = RETIRED_KEYS.filter((k) => liveReferences(k, files).length > 0)
      .map((k) => `${k} <- ${liveReferences(k, files).join(', ')}`)
      .sort();
    expect(
      resurrected,
      'a key listed as retired still has a live reference. If it is rendered again, drop it ' +
        'from RETIRED_KEYS; the list must never hide a key a page really uses.',
    ).toEqual([]);
  });

  it('has a live reference for every off-sweep key', () => {
    const dead = LIVE_OFF_SWEEP_KEYS.filter((k) => liveReferences(k, files).length === 0).sort();
    expect(
      dead,
      'a key listed as off-sweep has no reference left in src/, so its consumer is gone. Move ' +
        'it to RETIRED_KEYS with a reason (this list is only for live code the sweep cannot reach).',
    ).toEqual([]);
  });

  it('keeps both allowlists disjoint and free of keys the catalog dropped', () => {
    const inCatalog = new Set(catalogKeys);
    const overlap = RETIRED_KEYS.filter((k) => LIVE_OFF_SWEEP_KEYS.includes(k));
    expect(overlap, 'a key is listed as both retired and off-sweep').toEqual([]);

    const dupes = [...RETIRED_KEYS, ...LIVE_OFF_SWEEP_KEYS].filter((k, i, a) => a.indexOf(k) !== i);
    expect(dupes, 'duplicate entry in an allowlist').toEqual([]);

    const ghosts = [...RETIRED_KEYS, ...LIVE_OFF_SWEEP_KEYS]
      .filter((k) => !inCatalog.has(k))
      .sort();
    expect(
      ghosts,
      'an allowlisted key is no longer in the catalog at all, so its entry is stale; delete it.',
    ).toEqual([]);
  });

  // Direction two. The sweep above cannot see a key inside a branch it never takes, and
  // tsc only checks a key that is written as a TranslationKey literal, so a typo in a
  // handler ('guide.search.noResult') compiles and ships as a page that throws the moment a
  // player searches. Every complete guide.* literal in the guide's own source must name a
  // real catalog key.
  it('references no guide.* key the catalog does not define', () => {
    const inCatalog = new Set(catalogKeys);
    const guideSrc = files.filter((f) => f.includes(`${path.sep}guide${path.sep}`));
    const bad: string[] = [];
    for (const file of guideSrc) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        // Quoted, fully-literal keys only: a template like `guide.abilityHook.${id}` is a
        // computed family this direction cannot resolve, and is covered by the sweep above.
        for (const m of line.matchAll(/['"](guide\.[a-zA-Z0-9_.]+)['"]/g)) {
          const key = m[1];
          if (key.endsWith('.')) continue;
          if (!inCatalog.has(key)) bad.push(`${path.relative(SRC, file)}:${i + 1} ${key}`);
        }
      });
    }
    expect(bad.sort(), 'these guide.* literals name no catalog key').toEqual([]);
  });
});

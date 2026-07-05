import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GUIDE_CLASSES,
  GUIDE_DELVES,
  GUIDE_FAMILIES,
  GUIDE_MODELS,
  GUIDE_WARLOCK_PETS,
} from '../src/guide/content.generated';
import { pageFor } from '../src/guide/pages';
import {
  GUIDE_BASE,
  GUIDE_ROUTES,
  groupedRoutes,
  hrefFor,
  matchRoute,
  topbarRoutes,
  toSub,
} from '../src/guide/routes';
import { MOBS } from '../src/sim/data';
import { setLanguage, t } from '../src/ui/i18n';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicPath = (url: string): string => resolve(repoRoot, 'public', url.replace(/^\//, ''));

const guideHtml = readFileSync(new URL('../guide.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const serverMain = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const sitemapXml = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const generatedSource = readFileSync(
  new URL('../src/guide/content.generated.ts', import.meta.url),
  'utf8',
);

describe('Guide routes', () => {
  it('treats the base and empty sub as the home route', () => {
    expect(matchRoute('/wiki')?.route.id).toBe('home');
    expect(matchRoute('/wiki/')?.route.id).toBe('home');
    expect(toSub('/wiki/classes/')).toBe('classes');
    expect(toSub('/wiki')).toBe('');
  });

  it('matches static section routes exactly', () => {
    expect(matchRoute('/wiki/classes')?.route.id).toBe('classes');
    expect(matchRoute('/wiki/how-to-play')?.route.id).toBe('how-to-play');
    expect(matchRoute('/wiki/reference/controls')?.route.id).toBe('controls');
  });

  it('claims deeper segments as params (class/creature detail pages)', () => {
    const m = matchRoute('/wiki/classes/warrior');
    expect(m?.route.id).toBe('classes');
    expect(m?.params).toEqual(['warrior']);
  });

  it('returns null for unknown paths so the app can render notFound', () => {
    expect(matchRoute('/wiki/nonexistent')).toBeNull();
  });

  it('ignores #hash and ?query when matching (skip link / in-page anchors)', () => {
    // Regression: the skip link href="#guide-main" must not route to notFound.
    expect(matchRoute('/wiki#guide-main')?.route.id).toBe('home');
    expect(matchRoute('/wiki/reference/controls#movement')?.route.id).toBe('controls');
    expect(matchRoute('/wiki/classes/warrior?from=home')?.params).toEqual(['warrior']);
    expect(toSub('/wiki/classes#kit')).toBe('classes');
  });

  it('derives nav from the single route list', () => {
    expect(topbarRoutes().some((r) => r.id === 'classes')).toBe(true);
    expect(topbarRoutes().some((r) => r.id === 'home')).toBe(false);
    const groups = groupedRoutes();
    expect(groups.map((g) => g.group)).toEqual(['start', 'compendium', 'reference']);
    expect(hrefFor('')).toBe(GUIDE_BASE);
    expect(hrefFor('classes')).toBe('/wiki/classes');
  });

  it('keeps every route nav label resolvable as an English t() key', () => {
    setLanguage('en');
    for (const r of GUIDE_ROUTES) {
      expect(typeof t(r.navKey)).toBe('string');
      expect(t(r.navKey).length).toBeGreaterThan(0);
    }
    expect(t('guide.nav.playNow')).toBe('Play Now');
    expect(t('guide.skipToContent')).toBe('Skip to main content');
  });
});

describe('Guide entry wiring', () => {
  it('registers the /wiki pretty URL in BOTH alias tables (kept in sync)', () => {
    expect(viteConfig).toContain("['/wiki', '/guide.html']");
    expect(serverMain).toContain("['/wiki', '/guide.html']");
  });

  it('falls back deep /wiki paths to the guide shell in dev and prod', () => {
    expect(viteConfig).toContain('isGuideSpaPath');
    expect(serverMain).toContain(
      "const isGuide = urlPath === '/wiki' || urlPath.startsWith('/wiki/');",
    );
    expect(serverMain).toContain("isGuide ? 'guide.html'");
  });

  it('ships the guide as its own Vite build entry', () => {
    expect(viteConfig).toContain("guide: fileURLToPath(new URL('guide.html', import.meta.url))");
  });

  it('lists the guide in the sitemap', () => {
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/wiki</loc>');
  });

  // A route with no registered page silently renders the placeholder; a route or class
  // page missing from the sitemap is invisible to crawlers. These gates fail the build
  // instead, so adding a page (like Delves) means wiring all of route + module + sitemap.
  it('registers a page module for every route', () => {
    for (const r of GUIDE_ROUTES) {
      expect(pageFor(r.id), `route "${r.id}" has no registered page module`).toBeTruthy();
    }
  });

  it('lists every route and class-detail page in the sitemap', () => {
    const origin = 'https://worldofclaudecraft.com';
    for (const r of GUIDE_ROUTES) {
      const loc = `${origin}${hrefFor(r.sub)}`;
      expect(sitemapXml, `sitemap missing route "${r.id}" (${loc})`).toContain(`<loc>${loc}</loc>`);
    }
    for (const c of GUIDE_CLASSES) {
      const loc = `${origin}${hrefFor(`classes/${c.id}`)}`;
      expect(sitemapXml, `sitemap missing class page "${c.id}" (${loc})`).toContain(
        `<loc>${loc}</loc>`,
      );
    }
  });
});

describe('guide.html shell', () => {
  it('allows pinch-zoom and user scaling (WCAG), unlike the locked game viewport', () => {
    expect(guideHtml).toContain('name="viewport"');
    expect(guideHtml).not.toContain('user-scalable=no');
    expect(guideHtml).not.toContain('maximum-scale=1.0');
  });

  it('ships crawlable canonical + social metadata for /wiki', () => {
    expect(guideHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/wiki" />',
    );
    expect(guideHtml).toContain(
      '<meta property="og:url" content="https://worldofclaudecraft.com/wiki" />',
    );
    expect(guideHtml).toContain('content="index, follow, max-image-preview:large"');
  });

  it('loads the guide client module and a noscript fallback', () => {
    expect(guideHtml).toContain('<script type="module" src="/src/guide/main.ts"></script>');
    expect(guideHtml).toContain('<noscript>');
  });
});

describe('Guide generated class content', () => {
  it('covers all nine classes with grounded data', () => {
    expect(GUIDE_CLASSES).toHaveLength(9);
    for (const c of GUIDE_CLASSES) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(['rage', 'mana', 'energy']).toContain(c.resource);
      expect(c.roles.length).toBeGreaterThan(0);
      expect(c.specs.length).toBeGreaterThan(0);
      expect(c.signatureAbilities.length).toBeGreaterThan(0);
      expect(c.abilities.length).toBeGreaterThanOrEqual(c.signatureAbilities.length);
      for (const s of c.specs) {
        expect(['tank', 'healer', 'dps']).toContain(s.role);
        expect(s.signature.length).toBeGreaterThan(0);
      }
      // every class nav name resolves
      expect(t(`classes.${c.id}` as never).length).toBeGreaterThan(0);
      // the class page uses the canonical character-creation description, not a guide-only blurb
      expect(t(`classDetails.lore.${c.id}` as never).length).toBeGreaterThan(0);
      // every signature ability has a spoiler-safe one-liner
      for (const a of c.signatureAbilities) {
        expect(t(`guide.abilityHook.${a.id}` as never).length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves the new class-page and chooser keys (cast keys are not tsc-checked)', () => {
    setLanguage('en');
    for (const k of [
      'guide.chooser.heading',
      'guide.chooser.results',
      'guide.tag.melee',
      'guide.tag.goodFirst',
      'guide.classPage.masteryLabel',
      'guide.classPage.fullKitHeading',
      'guide.classPage.petsHeading',
      'guide.nav.talents',
      'guide.nav.arena',
      'guide.nav.wishIKnew',
      'guide.related',
      'guide.talentsPage.heading',
      'guide.arenaPage.coliseumHeading',
      'guide.dungeonsPage.levelBand',
      'guide.worldPage.places',
      'guide.glossary.threatTerm',
      'guide.faqPage.q9',
    ]) {
      expect(t(k as never).length).toBeGreaterThan(0);
    }
    // the "things I wish I knew" page builds its item keys by index (cast keys)
    for (let n = 1; n <= 8; n += 1) {
      expect(t(`guide.wishPage.i${n}Title` as never).length).toBeGreaterThan(0);
      expect(t(`guide.wishPage.i${n}Body` as never).length).toBeGreaterThan(0);
    }
    // every warlock demon has a role one-liner
    for (const pet of GUIDE_WARLOCK_PETS) {
      expect(t(`guide.petHook.${pet.id}` as never).length).toBeGreaterThan(0);
    }
  });

  it('matches the sim (regenerating leaves the committed file unchanged)', () => {
    execFileSync('node', ['scripts/wiki/build_content.mjs'], {
      cwd: new URL('..', import.meta.url),
    });
    // No diff means the committed content is derived from the current sim data.
    expect(() =>
      execFileSync('git', ['diff', '--exit-code', '--', 'src/guide/content.generated.ts'], {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });
});

// The 3D viewer resolves every figure's model key into GUIDE_MODELS, then fetches that
// spec's GLB (plus any attachment GLB). A content change that left a figure pointing at a
// missing key, or a spec pointing at a deleted GLB, would silently blank that viewer at
// runtime. This guard fails the build instead, so model->asset integrity stays intact.
describe('Guide model viewer asset integrity', () => {
  it('resolves every class, warlock pet, and creature model key in GUIDE_MODELS', () => {
    const keys = new Set<string>();
    for (const c of GUIDE_CLASSES) if (c.model) keys.add(c.model);
    for (const p of GUIDE_WARLOCK_PETS) if (p.model) keys.add(p.model);
    for (const f of GUIDE_FAMILIES) for (const c of f.creatures) if (c.model) keys.add(c.model);
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(GUIDE_MODELS[key], `GUIDE_MODELS has no spec for model key "${key}"`).toBeDefined();
    }
  });

  it('ships a real GLB on disk for every model spec url and attachment', () => {
    const specs = Object.entries(GUIDE_MODELS);
    expect(specs.length).toBeGreaterThan(0);
    for (const [key, spec] of specs) {
      const urls = [spec.url, ...(spec.attach ?? []).map((a) => a.url)];
      for (const url of urls) {
        expect(existsSync(publicPath(url)), `missing GLB for "${key}": public asset "${url}"`).toBe(
          true,
        );
      }
    }
  });
});

// The Delves page renders entirely from GUIDE_DELVES, derived from the sim DELVE_LIST. The
// generic route/sitemap/freshness gates above cover the page's existence, but not the shape or
// spoiler-safety of the data: an empty or balance-leaking regeneration would render valid markup
// and pass every other gate. This block is the structural + spoiler guard, matching the bar set
// by the class-content test.
describe('Guide generated delve content', () => {
  it('emits at least one delve with grounded, spoiler-safe data', () => {
    expect(GUIDE_DELVES.length).toBeGreaterThan(0);
    for (const d of GUIDE_DELVES) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.theme.length).toBeGreaterThan(0);
      expect(typeof d.minLevel).toBe('number');
      expect(d.minLevel).toBeGreaterThan(0);
      expect(d.tiers.length).toBeGreaterThan(0);
      // The keeper/companion are display names only (spoiler-safe roster facts).
      if (d.keeper) expect(d.keeper.name.length).toBeGreaterThan(0);
      if (d.companion) expect(['tank', 'healer', 'dps']).toContain(d.companion.role);
      // Tier and affix labels are display NAMES, never balance numbers: a digit here would mean a
      // count/multiplier/level-bonus leaked into the public wiki.
      for (const label of [...d.tiers, ...d.affixes]) {
        expect(label, `delve "${d.id}" surfaces a number in "${label}"`).not.toMatch(/\d/);
      }
    }
  });

  it('resolves the delves nav + page keys in English', () => {
    setLanguage('en');
    for (const k of [
      'guide.nav.delves',
      'guide.delvesPage.heading',
      'guide.delvesPage.intro',
      'guide.delvesPage.keeperLabel',
      'guide.delvesPage.companionLabel',
      'guide.delvesPage.fromLevel',
    ]) {
      expect(t(k as never).length).toBeGreaterThan(0);
    }
  });

  it('joins the keeper and companion lines through translator-controlled format keys', () => {
    // GUIDE-2: the name + role / name + title lines must come from a format key, not a hardcoded
    // ", " concatenation, so the separator and punctuation stay translator-controlled.
    setLanguage('en');
    expect(t('guide.delvesPage.companionFmt' as never, { name: 'Vesh', role: 'Healer' })).toBe(
      'Vesh, Healer',
    );
    expect(
      t('guide.delvesPage.keeperFmt' as never, { name: 'Halven', title: 'Reliquary Keeper' }),
    ).toBe('Halven, Reliquary Keeper');
  });
});

// The bestiary now merges the raid zone's mobs (TEMPLE_MOBS) into its source, withholding elite
// and boss creatures with an inline filter. The guide's load-bearing spoiler invariant ("never the
// raid boss name; no instanced encounter creatures in the bestiary") is otherwise unguarded: a
// future change to that filter would silently publish the raid boss to the public wiki with no
// failing gate. This pins it.
describe('Guide bestiary spoiler safety', () => {
  it('exposes no elite or boss creature in the bestiary', () => {
    const leaked: string[] = [];
    for (const f of GUIDE_FAMILIES) {
      for (const c of f.creatures) {
        const tpl = MOBS[c.templateId];
        if (tpl && (tpl.elite || tpl.boss)) leaked.push(`${c.templateId} (${f.family})`);
      }
    }
    expect(
      leaked,
      `elite/boss creatures must stay out of the bestiary: ${leaked.join(', ')}`,
    ).toEqual([]);
  });

  it('never bakes a boss display name into the generated content', () => {
    const bossNames = Object.values(MOBS)
      .filter((m) => m.boss)
      .map((m) => m.name);
    expect(bossNames.length).toBeGreaterThan(0); // the raid boss exists; this guard is meaningful
    for (const name of bossNames) {
      expect(
        generatedSource.includes(name),
        `raid/boss name "${name}" leaked into content.generated.ts`,
      ).toBe(false);
    }
  });
});

// The bestiary, class, warlock, and gallery pages show a pre-rendered still
// (public/guide-stills) as the default image of each figure. The generator bakes a `still`
// URL for every figure with a model; these guards fail the build if a figure is missing its
// baked URL or its committed WebP (regenerate with `npm run wiki:content` + `npm run wiki:stills`).
describe('Guide model stills', () => {
  it('bakes a still url for every figure that has a model', () => {
    const missing: string[] = [];
    for (const c of GUIDE_CLASSES) if (c.model && !c.still) missing.push(`class ${c.id}`);
    for (const p of GUIDE_WARLOCK_PETS) if (p.model && !p.still) missing.push(`pet ${p.id}`);
    for (const f of GUIDE_FAMILIES) {
      for (const c of f.creatures)
        if (c.model && !c.still) missing.push(`creature ${c.templateId}`);
    }
    expect(missing, `figures with a model but no baked still: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships a committed WebP on disk for every baked still url', () => {
    const stills = new Set<string>();
    for (const c of GUIDE_CLASSES) if (c.still) stills.add(c.still);
    for (const p of GUIDE_WARLOCK_PETS) if (p.still) stills.add(p.still);
    for (const f of GUIDE_FAMILIES) for (const c of f.creatures) if (c.still) stills.add(c.still);
    expect(stills.size).toBeGreaterThan(0);
    for (const url of stills) {
      expect(
        existsSync(publicPath(url)),
        `missing still on disk: "${url}" (run \`npm run wiki:stills\`)`,
      ).toBe(true);
    }
  });

  it('has no orphan WebP (every committed still is referenced by a figure)', () => {
    const basename = (url: string): string => url.split('/').pop() ?? '';
    const referenced = new Set<string>();
    for (const c of GUIDE_CLASSES) if (c.still) referenced.add(basename(c.still));
    for (const p of GUIDE_WARLOCK_PETS) if (p.still) referenced.add(basename(p.still));
    for (const f of GUIDE_FAMILIES)
      for (const c of f.creatures) if (c.still) referenced.add(basename(c.still));
    const onDisk = readdirSync(resolve(repoRoot, 'public', 'guide-stills')).filter((f) =>
      f.endsWith('.webp'),
    );
    // A removed or retinted figure changes its still key and orphans the old file; the forward
    // guards above never catch that, so this keeps stale art from accumulating in public/.
    const orphans = onDisk.filter((f) => !referenced.has(f));
    expect(orphans, `orphan stills with no figure (delete them): ${orphans.join(', ')}`).toEqual(
      [],
    );
  });
});

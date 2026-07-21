import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertFamiliesKnown } from '../scripts/wiki/family_guard.mjs';
import { BIND_ACTIONS } from '../src/game/keybinds';
import {
  GUIDE_CLASSES,
  GUIDE_DEEDS,
  GUIDE_DELVES,
  GUIDE_DRUID_FORMS,
  GUIDE_DUNGEONS,
  GUIDE_FAMILIES,
  GUIDE_MODELS,
  GUIDE_WARLOCK_PETS,
  GUIDE_ZONES,
} from '../src/guide/content.generated';
import { pageFor } from '../src/guide/pages';
import { controls as controlsPage } from '../src/guide/pages/controls';
import { catalogSections, deeds as deedsPage } from '../src/guide/pages/deeds';
import { dungeons as dungeonsPage } from '../src/guide/pages/dungeons';
import { world as worldPage } from '../src/guide/pages/world';
import {
  GUIDE_BASE,
  GUIDE_ROUTES,
  groupedRoutes,
  hrefFor,
  matchRoute,
  topbarRoutes,
  toSub,
} from '../src/guide/routes';
import { buildIndex, rank } from '../src/guide/search';
import { DEEDS } from '../src/sim/content/deeds';
import { CAMPS, MOBS } from '../src/sim/data';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { guideStrings } from '../src/ui/i18n.catalog/guide';

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
    for (const d of GUIDE_DRUID_FORMS) if (d.model) keys.add(d.model);
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

// The bestiary walks a hand-listed union of mob tables, and CAMPS is itself a growing
// merge: a future zone or overworld mob file whose camps join CAMPS could be silently
// dropped from the wiki while the freshness gate stays green (the generated file would
// be "fresh" and just missing the creatures). These gates tie the published bestiary to
// the camp registry, so a camped creature a player can walk into is never unlisted.
// NOTE: the exclusion filters below (elite/boss, warlock_, vision, fixture) mirror the
// generator's own filters in scripts/wiki/build_content.mjs; the two lists must move
// together, or this completeness gate and the published set silently diverge.
describe('Guide bestiary completeness', () => {
  const published = new Set(GUIDE_FAMILIES.flatMap((f) => f.creatures.map((c) => c.templateId)));
  const isFixture = (m: { dummy?: boolean }) => !!m.dummy;

  it('keys the fixture exclusion off the sim dummy flag (pinned to the training dummy)', () => {
    // The generator excludes fixtures by the template's own dummy flag, so a zero-damage
    // real creature (caster- or hazard-only) can never silently vanish from the bestiary.
    expect(MOBS.training_dummy?.dummy).toBe(true);
    expect(published.has('training_dummy')).toBe(false);
  });

  it('fails loudly on a family with no FAMILY_ORDER slot (the generator guard throws)', () => {
    expect(() => assertFamiliesKnown({ beast: new Map() }, ['beast', 'spider'])).not.toThrow();
    expect(() => assertFamiliesKnown({ gryphon: new Map() }, ['beast', 'spider'])).toThrow(
      /gryphon/,
    );
  });

  it('publishes every camped, wild, non-fixture creature', () => {
    const missing: string[] = [];
    for (const camp of CAMPS) {
      const m = MOBS[camp.mobId];
      if (!m || m.elite || m.boss) continue;
      if (camp.mobId.startsWith('warlock_')) continue;
      if (/vision/i.test(camp.mobId) || /^Vision\b/.test(m.name)) continue;
      if (isFixture(m)) continue; // inert practice fixtures (the training dummy)
      if (!published.has(camp.mobId)) missing.push(`${camp.mobId} (${m.family})`);
    }
    expect(missing, `camped creatures missing from the bestiary: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('publishes no inert practice fixture as a creature', () => {
    const fixtures = [...published].filter((id) => MOBS[id] && isFixture(MOBS[id]));
    expect(fixtures, `inert fixtures leaked into the bestiary: ${fixtures.join(', ')}`).toEqual([]);
  });

  it('gives every zone a non-empty resident family list drawn from the bestiary', () => {
    const familyNames = new Set(GUIDE_FAMILIES.map((f) => f.family));
    for (const z of GUIDE_ZONES) {
      expect(z.families.length, `zone ${z.id} lists no resident families`).toBeGreaterThan(0);
      for (const fam of z.families) {
        expect(familyNames.has(fam), `zone ${z.id} lists unknown family ${fam}`).toBe(true);
      }
    }
  });

  // The decisive geography pin: burrowers' level band OVERLAPS the marsh's, but every
  // burrower camp sits outside the marsh z-band, so a regression from camp-geography
  // back to level-band overlap would re-list burrower here and fail this literal. The
  // full list is pinned so any silent derivation change surfaces as a reviewable diff.
  it('derives marsh residents from camp geography, never level-band overlap', () => {
    const marsh = GUIDE_ZONES.find((z) => z.id === 'mirefen_marsh');
    expect(marsh).toBeDefined();
    expect(marsh?.families).not.toContain('burrower');
    expect(marsh?.families).toEqual(['beast', 'spider', 'mudfin', 'humanoid', 'troll', 'undead']);
  });

  it('renders the residents cross-links into the bestiary on the world page', () => {
    setLanguage('en');
    const html = worldPage.render({ params: [], sub: 'world', titleKey: 'guide.nav.world' });
    // The marsh card links its troll residents to the bestiary's own family anchor,
    // with the localized family label as the link text.
    expect(html).toContain(`href="${hrefFor('bestiary')}#fam-troll"`);
    expect(html).toContain('>Trolls</a>');
    // And the geography fix holds at the render layer too: no burrower link on marsh.
    // (Burrowers still render for the zones that really camp them.)
    const marshCard = html.slice(html.indexOf('id="zone-marsh"'), html.indexOf('id="zone-peaks"'));
    expect(marshCard.length).toBeGreaterThan(0);
    expect(marshCard).not.toContain('#fam-burrower');
    expect(html).toContain('#fam-burrower');
  });
});

// The Book of Deeds page renders entirely from GUIDE_DEEDS, derived from the sim DEEDS table.
// Its load-bearing invariant is spoiler safety: hidden deeds must never reach the public wiki,
// and no criteria internals (the trigger, or the desc, which names instanced bosses and
// encounter mechanics) may be baked. These gates fail the build instead of silently leaking a
// secret if a future catalog edit or a generator change drops the hidden filter or emits desc.
describe('Guide deeds spoiler safety', () => {
  it('excludes every hidden deed from the generated content entirely', () => {
    // Iterate the SIM table (not the already-filtered guide list): if the generator's hidden
    // filter were deleted, a hidden deed's id and name would appear here and fail the assert.
    const hidden = Object.values(DEEDS).filter((d) => d.hidden);
    expect(hidden.length).toBeGreaterThan(0); // the catalog has hidden deeds; this guard is meaningful
    for (const d of hidden) {
      for (const needle of [d.id, d.name, d.desc]) {
        expect(
          generatedSource.includes(needle),
          `hidden deed "${d.id}" leaked "${needle}" into content.generated.ts`,
        ).toBe(false);
      }
    }
  });

  it('emits exactly the non-hidden deeds, each mapping back to a real def', () => {
    const expected = Object.values(DEEDS)
      .filter((d) => !d.hidden)
      .map((d) => d.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect([...GUIDE_DEEDS].map((d) => d.id).sort()).toEqual(expected);
    for (const gd of GUIDE_DEEDS) {
      const def = DEEDS[gd.id];
      expect(def, `GUIDE_DEEDS has an unknown deed id "${gd.id}"`).toBeDefined();
      expect(def.hidden, `hidden deed "${gd.id}" reached the public catalog`).toBeFalsy();
    }
  });

  it('bakes no trigger or desc field (criteria and internals stay off the wiki)', () => {
    // Exact field allowlist: ANY smuggled field (trigger, desc, the internal border slug,
    // or anything a future generator edit adds) fails here by name.
    const allowedFields = new Set([
      'id',
      'name',
      'category',
      'renown',
      'feat',
      'rewardTitle',
      'rewardBorder',
      // The painted-crest URL for art-backed deeds. Computed after the hidden filter and
      // pointing only at /ui/deeds art the game client already ships publicly.
      'crest',
    ]);
    for (const gd of GUIDE_DEEDS) {
      expect('trigger' in gd, `deed "${gd.id}" leaked its trigger`).toBe(false);
      expect('desc' in gd, `deed "${gd.id}" leaked its desc`).toBe(false);
      for (const k of Object.keys(gd)) {
        expect(allowedFields.has(k), `deed "${gd.id}" emitted unexpected field "${k}"`).toBe(true);
      }
    }
  });

  it('bakes a crest URL for exactly the art-backed public deeds', () => {
    for (const gd of GUIDE_DEEDS) {
      if (DEED_IMAGE_IDS.has(gd.id)) {
        expect(gd.crest, `art-backed deed "${gd.id}" is missing its crest`).toBe(
          `/ui/deeds/${gd.id}.webp`,
        );
      } else {
        expect(gd.crest, `artless deed "${gd.id}" grew a crest`).toBeUndefined();
      }
    }
    // The ledger actually lights up: a meaningful share of the roll carries art.
    expect(GUIDE_DEEDS.filter((d) => d.crest).length).toBeGreaterThan(100);
  });

  it("bakes no deed's desc text into the generated source, hidden or not", () => {
    // The stronger form of the desc-omission guard: NOT just hidden deeds. Public dungeon,
    // combat, and delve descs also name instanced bosses and per-encounter mechanics, which the
    // wiki withholds. If the generator ever emitted desc under any field name, a full desc
    // sentence would appear in the source text and fail here.
    for (const d of Object.values(DEEDS)) {
      expect(
        generatedSource.includes(d.desc),
        `deed "${d.id}" desc leaked into content.generated.ts`,
      ).toBe(false);
    }
  });

  it('maps the cosmetic reward to the sim value, not another field', () => {
    // A title deed carries its sim reward TEXT (not the kind or a slug); a border deed carries
    // rewardBorder:true and no title. Pins value correctness the freshness gate cannot (a
    // consistently-wrong mapping regenerates identically).
    const title = GUIDE_DEEDS.find((d) => d.id === 'prog_veteran');
    expect(DEEDS.prog_veteran.reward).toEqual({ kind: 'title', text: 'Veteran' });
    expect(title?.rewardTitle).toBe('Veteran');
    expect(title?.rewardBorder).toBeUndefined();

    const border = GUIDE_DEEDS.find((d) => d.id === 'prog_prestige_10');
    expect(DEEDS.prog_prestige_10.reward?.kind).toBe('border');
    expect(border?.rewardBorder).toBe(true);
    expect(border?.rewardTitle).toBeUndefined();
  });

  it('surfaces only grounded, cosmetic-safe fields for each deed', () => {
    const allowed = new Set([
      'progression',
      'combat',
      'dungeon',
      'delve',
      'chronicle',
      'collection',
      'pvp',
      'social',
      'exploration',
      'feat',
    ]);
    for (const gd of GUIDE_DEEDS) {
      expect(gd.name.length).toBeGreaterThan(0);
      expect(
        allowed.has(gd.category),
        `deed "${gd.id}" has off-list category "${gd.category}"`,
      ).toBe(true);
      expect(gd.category).not.toBe('hidden');
      expect([0, 5, 10, 25, 50]).toContain(gd.renown);
      expect(typeof gd.feat).toBe('boolean');
      // The reward is optional and cosmetic-only, and never both a title and a border at once.
      expect(gd.rewardTitle !== undefined && gd.rewardBorder !== undefined).toBe(false);
      if (gd.rewardTitle !== undefined) expect(gd.rewardTitle.length).toBeGreaterThan(0);
      if (gd.rewardBorder !== undefined) expect(gd.rewardBorder).toBe(true);
    }
    // Feats carry zero Renown by design; a non-zero feat here would be a content or mapping bug.
    for (const gd of GUIDE_DEEDS) if (gd.feat) expect(gd.renown).toBe(0);
    // Both a title reward and a border reward exist in the public set, so the mapping is exercised.
    expect(GUIDE_DEEDS.some((d) => d.rewardTitle)).toBe(true);
    expect(GUIDE_DEEDS.some((d) => d.rewardBorder)).toBe(true);
    expect(GUIDE_DEEDS.some((d) => d.feat)).toBe(true);
  });

  it('resolves the deeds nav + page keys in English', () => {
    setLanguage('en');
    for (const k of [
      'guide.nav.deeds',
      'guide.deedsPage.intro',
      'guide.deedsPage.howHeading',
      'guide.deedsPage.howBody',
      'guide.deedsPage.renownHeading',
      'guide.deedsPage.renownBody',
      'guide.deedsPage.rewardsHeading',
      'guide.deedsPage.rewardsBody',
      'guide.deedsPage.chroniclesHeading',
      'guide.deedsPage.chroniclesBody',
      'guide.deedsPage.featsHeading',
      'guide.deedsPage.featsBody',
      'guide.deedsPage.catalogHeading',
      'guide.deedsPage.catalogBody',
      'guide.deedsPage.standingsNote',
      'guide.deedsPage.colName',
      'guide.deedsPage.colRenown',
      'guide.deedsPage.colReward',
      'guide.deedsPage.featTag',
      'guide.deedsPage.rewardBorder',
      'guide.deedsPage.cat.progression',
      'guide.deedsPage.cat.combat',
      'guide.deedsPage.cat.dungeon',
      'guide.deedsPage.cat.delve',
      'guide.deedsPage.cat.chronicle',
      'guide.deedsPage.cat.collection',
      'guide.deedsPage.cat.pvp',
      'guide.deedsPage.cat.social',
      'guide.deedsPage.cat.exploration',
      'guide.deedsPage.cat.feat',
    ]) {
      expect(t(k as never).length).toBeGreaterThan(0);
    }
    // The first Chronicler is sanctioned flavor: the page names Saul.
    expect(t('guide.deedsPage.chroniclesBody' as never)).toContain('Saul');
    // The Renown standings live on the Leaderboard's Renown tab, NOT in the Book of
    // Deeds window; the corrected copy is pinned so the old misdirection cannot return.
    expect(t('guide.deedsPage.standingsNote' as never)).toContain('Leaderboard');
    expect(t('guide.deedsPage.standingsNote' as never)).not.toContain('Book of Deeds');
    expect(t('guide.glossary.renownDef' as never)).toContain('Leaderboard');
    // The Book, Renown, and titles are character-scoped; only the realm leaderboard
    // aggregates Renown across an account (each deed counted once). The old copy wrongly
    // said deeds are "shown across your whole account" and feed the "same collection", so
    // the corrected phrasing is pinned against the CATALOG source (the resolved English
    // table is regenerated centrally) so the account-wide misstatement cannot return.
    expect(guideStrings.deedsPage.howBody).not.toContain('across your whole account');
    expect(guideStrings.deedsPage.howBody).not.toContain('same collection');
    expect(guideStrings.deedsPage.howBody).toContain('builds a Book of their own');
    expect(guideStrings.deedsPage.howBody).toContain(
      'only the realm leaderboard gathers your Renown',
    );
    // The per-category heading is a translator-controlled format, not a hardcoded join.
    expect(t('guide.deedsPage.catHeading' as never, { label: 'Combat', count: '7' })).toBe(
      'Combat (7)',
    );
    // The two cell labels are pinned as English literals so the render test's
    // t()-on-both-sides checks stay anchored to real values, not just key resolution.
    expect(t('guide.deedsPage.rewardBorder' as never)).toBe('Border');
    expect(t('guide.deedsPage.featTag' as never)).toBe('Feat');
  });

  it('pins the deeds route wiring to literals', () => {
    const route = GUIDE_ROUTES.find((r) => r.id === 'deeds');
    expect(route?.sub).toBe('deeds');
    expect(route?.navKey).toBe('guide.nav.deeds');
    expect(route?.group).toBe('compendium');
  });

  it('renders the whole page: correct per-category counts, no hidden or boss leak', () => {
    setLanguage('en');
    // GuidePage.render requires a PageContext; this page renders the same for any ctx
    // (the route wiring itself is pinned in its own test above).
    const html = deedsPage.render({ params: [], sub: 'deeds', titleKey: 'guide.nav.deeds' });
    expect(html.length).toBeGreaterThan(0);
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
    // one row per public deed (the name cell renders exactly once per row)
    expect((html.match(/class="guide-deed-name"/g) ?? []).length).toBe(GUIDE_DEEDS.length);
    // every non-empty category renders its heading with a live count; this exercises the render
    // path and resolves all ten guide.deedsPage.cat.* keys (a missing one throws in test mode).
    for (const cat of [
      'progression',
      'combat',
      'dungeon',
      'delve',
      'chronicle',
      'collection',
      'pvp',
      'social',
      'exploration',
      'feat',
    ]) {
      const n = GUIDE_DEEDS.filter((d) => d.category === cat).length;
      expect(n, `category ${cat} unexpectedly empty`).toBeGreaterThan(0);
      const label = t(`guide.deedsPage.cat.${cat}` as never);
      expect(html, `heading for ${cat}`).toContain(`${label} (${n})`);
    }
    // the title-reward, border-reward, and feat-tag render paths are all exercised
    expect(html).toContain('Veteran');
    expect(html).toContain('guide-deed-feat');
    expect(html.includes(t('guide.deedsPage.rewardBorder'))).toBe(true);
    // sanctioned Chronicler flavor
    expect(html).toContain('Saul');
    // no hidden deed and no boss:true name reaches the rendered page
    for (const d of Object.values(DEEDS).filter((x) => x.hidden)) {
      for (const needle of [d.id, d.name, d.desc]) {
        expect(html.includes(needle), `hidden "${d.id}" leaked "${needle}"`).toBe(false);
      }
    }
    for (const name of Object.values(MOBS)
      .filter((m) => m.boss)
      .map((m) => m.name)) {
      expect(html.includes(name), `boss "${name}" leaked into the rendered page`).toBe(false);
    }
  });

  it('survives an empty catalog: sections self-omit, one category renders one section', () => {
    setLanguage('en');
    // Empty list => no catalog sections at all (the page then shows the explainer alone).
    expect(catalogSections([])).toBe('');
    // A single-category list renders exactly that one section, not the others.
    const [first] = GUIDE_DEEDS.filter((d) => d.category === 'progression');
    expect(first).toBeDefined();
    const one = catalogSections(first ? [first] : []);
    expect(one).toContain(`${t('guide.deedsPage.cat.progression')} (1)`);
    expect(one).not.toContain(t('guide.deedsPage.cat.combat'));
  });

  it('never leaks the boss display name or an encounter mechanic, case-insensitively', () => {
    // Hardening pin for a refuted spoiler finding: the raid boss display name and
    // its encounter mechanics never reach the generated wiki, but the scans above
    // are case-sensitive, so a future generator change that lower-cased or
    // title-cased one would slip past. The bare 'nythraxis' id-slug and its crest
    // path (/ui/deeds/dgn_nythraxis*.webp) are the recorded maintainer tolerance
    // (an id spoils nothing; see the module-graph containment test), so this scans
    // only the forms that DO spoil: the full display name (with its comma and
    // title, which no id-slug carries) and the two encounter mechanic strings.
    const haystack = generatedSource.toLowerCase();
    for (const secret of ['Nythraxis, Scourge of Thornpeak', 'Deathless Rage', 'Soul Rend']) {
      expect(
        haystack.includes(secret.toLowerCase()),
        `spoiler string "${secret}" leaked into content.generated.ts`,
      ).toBe(false);
    }
  });
});

// The site search folds the haystack and the needle through the ACTIVE locale, not
// a locale-agnostic toLowerCase, so a Turkish label that starts with the dotted
// capital I still matches a query typed in plain ASCII (the deeds-window pattern).
describe('Guide search locale-insensitive folding', () => {
  it('matches a Turkish label typed without the dotted capital I (tr_TR)', async () => {
    // 'Insansilar-with-dotted-capital-I'.toLowerCase() injects a combining dot
    // after the i, so a locale-agnostic fold never matches a typed plain 'insan'.
    await ensureLocaleLoaded('tr_TR');
    try {
      setLanguage('tr_TR');
      const humanoid = t('guide.family.humanoid.name' as never);
      // Guard the premise: the label really begins with the dotted capital I
      // (U+0130), the letter whose locale-agnostic lowercase breaks the match.
      expect(humanoid.charCodeAt(0)).toBe(0x0130);
      const hits = rank(buildIndex(), 'insan');
      expect(hits.some((e) => e.label === humanoid)).toBe(true);
    } finally {
      setLanguage('en');
    }
  });

  it('still finds an English entry after the fold change (regression)', () => {
    setLanguage('en');
    const hits = rank(buildIndex(), 'first steps');
    expect(hits.some((e) => e.label === 'First Steps')).toBe(true);
  });
});

// The gates above prove hidden deeds stay out of content.generated.ts, but the built wiki
// also serves every chunk its module graph produces: eager chunks are modulepreloaded from
// the guide entry, and a dynamic import() starts a lazy chunk that is still built, served,
// and one click away for a wiki reader. If the guide entry can reach
// src/sim/content/deeds.ts through value imports on EITHER kind of edge, Rollup bakes the
// whole catalog (hidden names, descs, criteria) into a chunk the public wiki serves. This
// walk pins the seam at the source level (the architecture.test.ts convention: scan
// sources, never run a build inside the suite).
describe('Guide module-graph spoiler containment', () => {
  const ASSET_SPEC_RE = /\.(css|json|webp|png|jpg|jpeg|svg|glsl|wasm|mjs)$/;

  const resolveRelative = (fromFile: string, spec: string): string | null => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    if (ASSET_SPEC_RE.test(spec)) return null;
    const base = resolve(dirname(fromFile), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
      if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
    }
    // A silent miss would shrink the walked graph and turn the guard vacuous.
    throw new Error(`guide graph walk cannot resolve "${spec}" from ${fromFile}`);
  };

  // Value imports, eager AND lazy: import ... from, bare side-effect imports,
  // export ... from, and dynamic import() with a literal spec. Type-only
  // statements (import type / export type) are erased at build time. A dynamic
  // import() does not color the entry's eager (modulepreloaded) graph, but its
  // lazy chunk is still built and served to wiki readers, so containment walks
  // it exactly like an eager edge; a computed spec would hide a chunk from the
  // walk, so it fails loudly instead of silently shrinking the graph.
  const valueImportSpecs = (source: string, fromFile: string): string[] => {
    // One alternation pass: a line comment consumes any "/*" inside it (a
    // path glob in prose) and a block comment consumes any "//", so neither
    // strip can eat real code between mismatched markers.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const specs: string[] = [];
    for (const re of [
      /^[ \t]*import\s+([^'";]*?from\s+)?['"]([^'"]+)['"]/gm,
      /^[ \t]*export\s+([^'";]*?)from\s+['"]([^'"]+)['"]/gm,
    ]) {
      for (const m of code.matchAll(re)) {
        if (/^type[\s{]/.test((m[1] ?? '').trim())) continue;
        specs.push(m[2]);
      }
    }
    for (const m of code.matchAll(/\bimport\s*\(\s*(['"]([^'"]+)['"]\s*\))?/g)) {
      if (m[1] === undefined) {
        throw new Error(
          `guide graph walk found a non-literal dynamic import() in ${fromFile}; ` +
            'use a string-literal spec so the containment walk can follow the lazy chunk',
        );
      }
      specs.push(m[2]);
    }
    return specs;
  };

  it('collects dynamic import() literals and refuses computed specs (lazy chunks are served too)', () => {
    expect(valueImportSpecs("const { X } = await import('./scene');", 'inline.ts')).toEqual([
      './scene',
    ]);
    expect(valueImportSpecs("import type { X } from './types_only';", 'inline.ts')).toEqual([]);
    expect(() => valueImportSpecs('const m = await import(specVar);', 'inline.ts')).toThrow(
      /non-literal dynamic import/,
    );
  });

  it('never reaches the deeds catalog from the guide entry (chunk-color containment)', () => {
    const entry = resolve(repoRoot, 'src/guide/main.ts');
    const forbidden = resolve(repoRoot, 'src/sim/content/deeds.ts');
    const parent = new Map<string, string>();
    const reached = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      for (const spec of valueImportSpecs(readFileSync(file, 'utf8'), file)) {
        const target = resolveRelative(file, spec);
        if (target === null || reached.has(target)) continue;
        reached.add(target);
        parent.set(target, file);
        queue.push(target);
      }
    }
    // Walker sanity: the graph is real, it still reaches the sim/data.ts
    // aggregate (via icons.ts and the entity localizers), and the lazy arm
    // actually walks: viewer/scene.ts is reachable ONLY through the dynamic
    // import in viewer/mount.ts (every static import of it is type-only), so
    // dropping the import() collection must red this line.
    expect(reached.size).toBeGreaterThan(50);
    expect(reached.has(resolve(repoRoot, 'src/sim/data.ts'))).toBe(true);
    expect(reached.has(resolve(repoRoot, 'src/guide/viewer/scene.ts'))).toBe(true);

    let chain = '';
    if (reached.has(forbidden)) {
      const hops: string[] = [forbidden];
      let cursor: string | undefined = forbidden;
      while (cursor !== undefined && cursor !== entry) {
        cursor = parent.get(cursor);
        if (cursor !== undefined) hops.unshift(cursor);
      }
      chain = hops.map((p) => p.slice(repoRoot.length)).join(' -> ');
    }
    expect(
      reached.has(forbidden),
      `src/sim/content/deeds.ts is reachable from the guide entry: ${chain}`,
    ).toBe(false);

    // And no hidden deed prose rides ANY module the guide graph reaches (a
    // future aggregate or a copied table would re-leak the secret without
    // touching content/deeds.ts). Bare ids are tolerated by maintainer
    // judgment: deed_image_ids.ts carries them for the committed crest art,
    // and an id alone spoils nothing.
    const hidden = Object.values(DEEDS).filter((d) => d.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    for (const file of reached) {
      const source = readFileSync(file, 'utf8');
      for (const d of hidden) {
        for (const needle of [d.name, d.desc]) {
          expect(
            source.includes(needle),
            `hidden deed "${d.id}" prose leaked into guide-reachable ${file.slice(repoRoot.length)}`,
          ).toBe(false);
        }
      }
    }
  });
});

// The Book of Deeds sits on two shared guide surfaces beyond its own page: the controls
// reference (the window bind) and the dungeons page's related links. The controls row mirrors
// the game's real default bind (src/game/keybinds.ts), so a changed shipped default reds this
// test instead of silently drifting the public reference.
describe('Guide deeds cross-page surfaces', () => {
  it('lists the Book of Deeds bind on the controls page, matching the in-game default', () => {
    setLanguage('en');
    const deedsBind = BIND_ACTIONS.find((a) => a.id === 'deeds');
    expect(deedsBind?.defaults).toEqual(['Shift+KeyZ']);
    expect(t('guide.controls.deeds')).toBe('Book of Deeds');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    // the key glyph and the label render inside one table row
    expect(html).toContain('<kbd>Shift+Z</kbd></td><td>Book of Deeds</td>');
  });

  it('cross-links the deeds catalog from the dungeons page', () => {
    setLanguage('en');
    const html = dungeonsPage.render({
      params: [],
      sub: 'dungeons',
      titleKey: 'guide.nav.dungeons',
    });
    expect(html).toContain(`href="${hrefFor('deeds')}"`);
  });

  it('documents heroic mode on the dungeons page with a search anchor per dungeon', () => {
    setLanguage('en');
    const html = dungeonsPage.render({
      params: [],
      sub: 'dungeons',
      titleKey: 'guide.nav.dungeons',
    });
    // The heroic explainer renders (difficulty, Marks economy, daily rhythm), and the
    // difficulty-transition escape hatch renders beside it (Reset All Instances).
    expect(html).toContain('Heroic mode');
    expect(html).toContain('Heroic Marks');
    expect(html).toContain('/dungeon heroic');
    expect(html).toContain('/dungeon reset');
    // Every generated dungeon card carries its deep-link anchor for site search.
    for (const d of GUIDE_DUNGEONS) {
      expect(html, `dungeon card missing anchor id "dungeon-${d.id}"`).toContain(
        `id="dungeon-${d.id}"`,
      );
    }
  });

  it('documents the new default binds on the controls page', () => {
    setLanguage('en');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    expect(html).toContain('<kbd>T</kbd></td><td>Crafting</td>');
    expect(html).toContain('<kbd>Y</kbd></td><td>Vale Cup</td>');
    expect(html).toContain('<kbd>I</kbd></td><td>Event Calendar</td>');
    expect(html).toContain('<kbd>U</kbd></td><td>Discord</td>');
    expect(html).toContain('<kbd>Ctrl+1</kbd> <kbd>Ctrl+5</kbd>');
  });

  it('keeps the documented binds in step with the game defaults', () => {
    const defaults = new Map(BIND_ACTIONS.map((a) => [a.id, a.defaults]));
    expect(defaults.get('crafting')).toEqual(['KeyT']);
    expect(defaults.get('valecup')).toEqual(['KeyY']);
    expect(defaults.get('calendar')).toEqual(['KeyI']);
    expect(defaults.get('discord')).toEqual(['KeyU']);
    expect(defaults.get('petAttack')).toEqual(['Ctrl+Digit1']);
    expect(defaults.get('petAggressive')).toEqual(['Ctrl+Digit5']);
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
    for (const d of GUIDE_DRUID_FORMS) if (d.model && !d.still) missing.push(`form ${d.id}`);
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
    for (const d of GUIDE_DRUID_FORMS) if (d.still) stills.add(d.still);
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
    for (const d of GUIDE_DRUID_FORMS) if (d.still) referenced.add(basename(d.still));
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

  it('publishes exactly the three named druid forms (the gallery label map mirrors this)', () => {
    // models.ts labels forms through its FORM_NAME literal map; a fourth form added in
    // the generator would silently render as "Druid Forms" unless this pin reds first.
    expect(GUIDE_DRUID_FORMS.map((d) => d.id)).toEqual(['form_bear', 'form_cat', 'form_travel']);
  });
});

// Content pins for corrections whose old, wrong copy every other gate would accept:
// key resolution and render tests only prove a string exists, not that it is true.
describe('Guide corrected-prose pins', () => {
  it('names the graveyard keeper by its in-game name on every death surface', () => {
    setLanguage('en');
    expect(t('guide.glossary.spiritHealerTerm' as never)).toBe('The Pale Keeper');
    for (const key of [
      'guide.combat.deathBody',
      'guide.howToPlay.deathBody',
      'guide.wishPage.i2Body',
    ]) {
      expect(t(key as never), key).toContain('Pale Keeper');
      expect(t(key as never), key).not.toContain('Spirit Healer');
    }
  });

  it('keeps the delve death exception on the combat death rules', () => {
    setLanguage('en');
    expect(t('guide.combat.deathBody' as never)).toContain('Delves are the exception');
  });
});

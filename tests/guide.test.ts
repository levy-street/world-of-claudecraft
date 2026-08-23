import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assertFamiliesKnown } from '../scripts/wiki/family_guard.mjs';
// The English the /c/ public sheet resolves a mark id to. Imported here so the
// generator's own hand table cannot drift away from what the sheet says.
import { RELIQUARY_MARK_ENGLISH } from '../server/character_sheet';
import { BIND_ACTIONS, keyLabel } from '../src/game/keybinds';
import {
  GUIDE_CLASSES,
  GUIDE_DEEDS,
  GUIDE_DELVES,
  GUIDE_DRUID_FORMS,
  GUIDE_DUNGEONS,
  GUIDE_FAMILIES,
  GUIDE_MODELS,
  GUIDE_PROF_ARCHETYPES,
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_CURVE,
  GUIDE_PROF_ECONOMY,
  GUIDE_PROF_ENCHANTING,
  GUIDE_PROF_GATHERING,
  GUIDE_PROF_MASTERWORK,
  GUIDE_PROF_PAGES,
  GUIDE_PROF_RING,
  GUIDE_PROF_STATIONS,
  GUIDE_RELIQUARY,
  GUIDE_WARLOCK_PETS,
  GUIDE_ZONES,
} from '../src/guide/content.generated';
import { pageFor } from '../src/guide/pages';
import { controls as controlsPage } from '../src/guide/pages/controls';
import { catalogSections, deeds as deedsPage } from '../src/guide/pages/deeds';
import { dungeons as dungeonsPage } from '../src/guide/pages/dungeons';
import { professions as professionsPage, ringCards } from '../src/guide/pages/professions';
import { craftDetailHtml, effectLines } from '../src/guide/pages/professions_craft';
import { gatheringDetailHtml } from '../src/guide/pages/professions_gathering';
import { reliquaryCatalogSections, reliquary as reliquaryPage } from '../src/guide/pages/reliquary';
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
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { ENCHANTS } from '../src/sim/content/enchants';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  CRAFT_RING,
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  PERK_THRESHOLDS,
  STATION_TYPE_BY_CRAFT,
  STATIONS,
} from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { RELIQUARY_PAGES } from '../src/sim/content/reliquary';
import {
  TIER2_TOOL_GATE_PROFICIENCY,
  TIER3_TOOL_GATE_PROFICIENCY,
} from '../src/sim/content/vendor_row_gates';
import { ABILITIES, CAMPS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { MARKET_CUT, MARKET_LISTING_DEPOSIT_COPPER } from '../src/sim/market';
import {
  WORK_ORDER_CADENCE_TICKS,
  WORK_ORDER_PAYOUT_FRACTION,
} from '../src/sim/professions/cadence';
import { UNBIND_FEE_BY_QUALITY_TIER } from '../src/sim/professions/commission';
import {
  ARMOR_SECONDARY_BY_TYPE,
  TIMBER_WEAPON_TYPES,
} from '../src/sim/professions/disenchant_reagents';
import { DISENCHANT_MATERIAL_BY_QUALITY } from '../src/sim/professions/enchanting';
import { FISHING_GAIN_SCHEDULE } from '../src/sim/professions/fishing';
import {
  GATHER_RARE_EVENT_CHANCE,
  GATHER_RARE_EVENT_YIELD_MULT,
} from '../src/sim/professions/gather_events';
import {
  GATHER_CAST_BAND_REDUCTION_SEC,
  GATHER_CAST_BASE_SEC,
  GATHER_CAST_FLOOR_SEC,
  GATHER_CAST_TOOL_TIER_REDUCTION_SEC,
  GATHER_GAIN_TIER_STEP,
} from '../src/sim/professions/gathering';
import {
  MASTERWORK_BASE_CHANCE,
  MASTERWORK_CHANCE_CAP,
  MASTERWORK_PER_TIER_ABOVE_CHANCE,
  MASTERWORK_SIGNED_CHANCE,
  MASTERWORK_SPECIALIZATION_CHANCE,
} from '../src/sim/professions/masterwork';
import { SALVAGE_MATERIAL_BY_QUALITY } from '../src/sim/professions/salvage';
import { TRAINING_FEE_BY_TIER, trainingFeeFor } from '../src/sim/professions/training';
import {
  TIER_SKILL_STEP,
  tierForSkill,
  tierProgressMultiplier,
} from '../src/sim/professions/wheel';
import {
  TIER4_TOOL_WIELD_PROFICIENCY,
  TIER5_TOOL_WIELD_PROFICIENCY,
  WIELD_REQUIREMENT_BY_TIER,
} from '../src/sim/professions/wield_gate';
import { FARM_RIFT_DROP_ITEM_IDS, RIFT_PATTERN_ITEM_IDS } from '../src/sim/rift/progression';
import { CONSUME_DURATION, type DeedDef } from '../src/sim/types';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { ensureLocaleLoaded, type SupportedLanguage, setLanguage, t } from '../src/ui/i18n';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { WELLFED_STAT_KEYS } from '../src/ui/wellfed_stat_keys';

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

// The player-facing prose that would spoil a hidden deed on any public surface: its name, its
// criteria, and (when it grants one) the title text the secret rewards. The title text is in
// scope because it spoils as much as the name and it is what actually leaked: the deeds arm
// filtered hidden defs, but a Reliquary title relic published the reward text anyway. Callers
// that also forbid the bare id prepend it; the module scan below deliberately does not.
const hiddenDeedProse = (d: DeedDef): string[] => [
  d.name,
  d.desc,
  ...(d.reward?.kind === 'title' ? [d.reward.text] : []),
];

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
    // The old single 'compendium' bucket reached seventeen entries once Rifts and Mounts
    // landed; it is split by what a reader came for. Every group must be non-empty (a
    // group with no routes is dropped by groupedRoutes, so a typo would silently vanish).
    expect(groups.map((g) => g.group)).toEqual([
      'start',
      'world',
      'character',
      'endgame',
      'compete',
      'reference',
    ]);
    for (const g of groups)
      expect(g.routes.length, `group "${g.group}" is empty`).toBeGreaterThan(0);
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

  // Registration only proves a module exists. tests/guide_route_render.test.ts renders
  // every route and checks it produces a readable page (one h1, no unresolved key, no
  // stray placeholder); it lives in its own file because the bestiary and models pages
  // paint procedural icons through a canvas and so need a DOM environment.

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
      expect(['rage', 'mana', 'energy', 'focus']).toContain(c.resource);
      expect(c.roles.length).toBeGreaterThan(0);
      expect(c.specs.length).toBeGreaterThan(0);
      expect(c.signatureAbilities.length).toBeGreaterThan(0);
      expect(c.abilities.length).toBeGreaterThanOrEqual(c.signatureAbilities.length);
      for (const ability of c.abilities) {
        expect(
          ABILITIES[ability.id]?.hiddenFromPlayer,
          `${c.id}.${ability.id} is hidden from players`,
        ).not.toBe(true);
      }
      for (const ability of c.signatureAbilities) {
        expect(
          ABILITIES[ability.id]?.hiddenFromPlayer,
          `${c.id}.${ability.id} signature is hidden from players`,
        ).not.toBe(true);
      }
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

// The bestiary walks the canonical MOBS registry, and CAMPS is itself a growing merge.
// These gates tie the published bestiary to the camp registry, so a camped creature a
// player can walk into is never unlisted even as new world columns and mob modules land.
// NOTE: the exclusion filters below (elite/boss, ambient, warlock_, vision, fixture) mirror the
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
      if (m.ambient) continue; // ambient decoration (stable horses), not a wild creature
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

  // The bug this pins actually shipped. The page keyed every curated string AND the card's
  // DOM id off z.biome, which is not unique: The Farshore renders in the vale biome, so it
  // inherited Eastbrook Vale's blurb, hub greeting, speaker and place notes, and minted a
  // second id="zone-vale" that broke the map anchor. world.ts now resolves a per-zone key
  // stem (ZONE_KEY_STEM, biome as the fallback). A stem collision is invisible by eye once
  // there are fourteen zones, so it is pinned here instead: one anchor per zone, all distinct.
  it('gives every zone its own card anchor, so no zone can inherit another zone copy', () => {
    setLanguage('en');
    const html = worldPage.render({ params: [], sub: 'world', titleKey: 'guide.nav.world' });
    const ids = [...html.matchAll(/id="(zone-[a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(ids.length, 'one card anchor per zone').toBe(GUIDE_ZONES.length);
    expect(new Set(ids).size, `duplicate zone anchor: ${ids.join(', ')}`).toBe(ids.length);
    // Every map band links to an anchor that exists on the page (a stem typo would
    // otherwise scroll nowhere).
    for (const href of [...html.matchAll(/href="#(zone-[a-z0-9_]+)"/g)].map((m) => m[1])) {
      expect(ids, `map band links to a missing anchor #${href}`).toContain(href);
    }
    // The two vale-biome zones are the regression case: distinct anchors, distinct blurbs.
    expect(ids).toContain('zone-vale');
    expect(ids).toContain('zone-farshore');
    const vale = html.slice(html.indexOf('id="zone-vale"'));
    const farshore = html.slice(html.indexOf('id="zone-farshore"'));
    const blurbOf = (s: string) => /class="guide-zone-blurb">([^<]*)</.exec(s)?.[1] ?? '';
    expect(blurbOf(vale)).not.toBe('');
    expect(blurbOf(farshore)).not.toBe('');
    expect(blurbOf(farshore)).not.toBe(blurbOf(vale));
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
    expect(
      hidden.some((d) => d.reward?.kind === 'title'),
      'the reward-text arm needs a live hidden title deed',
    ).toBe(true);
    for (const d of hidden) {
      for (const needle of [d.id, ...hiddenDeedProse(d)]) {
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
    // 'compendium' was retired when it grew to seventeen entries and split; the Book of
    // Deeds is endgame content, so it sits with the dungeons, delves and rifts.
    expect(route?.group).toBe('endgame');
  });
});

// The Reliquary wiki page: spoiler-safe catalog of pages and relic names only.
// Freshness of GUIDE_RELIQUARY is covered by the shared generator freshness gate;
// these pins lock field allowlist, catalog parity, and render wiring.
describe('Guide Reliquary spoiler-safe catalog', () => {
  it('emits exactly the live RELIQUARY_PAGES ids in catalog order', () => {
    expect(GUIDE_RELIQUARY.map((p) => p.id)).toEqual(RELIQUARY_PAGES.map((p) => p.id));
    expect(GUIDE_RELIQUARY.length).toBe(RELIQUARY_PAGES.length);
    expect(GUIDE_RELIQUARY.length).toBeGreaterThanOrEqual(28);
  });

  it('bakes only allowlisted fields (no progress, clears, firstFind, or sources)', () => {
    // excludeFromCompletion joined at Phase 21 QA: catalog data, not player
    // state, and rule 7 requires the wiki to LABEL an outside-completion page.
    const pageFields = new Set(['id', 'shelf', 'name', 'relics', 'excludeFromCompletion']);
    const relicFields = new Set(['kind', 'name']);
    for (const page of GUIDE_RELIQUARY) {
      for (const k of Object.keys(page)) {
        expect(pageFields.has(k), `page "${page.id}" unexpected field "${k}"`).toBe(true);
      }
      expect(page.relics.length, `page "${page.id}" empty`).toBeGreaterThan(0);
      for (const relic of page.relics) {
        for (const k of Object.keys(relic)) {
          expect(relicFields.has(k), `page "${page.id}" relic unexpected "${k}"`).toBe(true);
        }
        expect(relic.name.length).toBeGreaterThan(0);
      }
    }
    // Stronger: personal / progress tokens never appear as field names in the blob.
    const blob = JSON.stringify(GUIDE_RELIQUARY);
    for (const leak of [
      'firstFind',
      'clears',
      'owned',
      'recent',
      'clearSource',
      'itemId',
      'markId',
    ]) {
      expect(blob.includes(`"${leak}"`), `leaked field token ${leak}`).toBe(false);
    }
  });

  it('labels exactly the two outside-completion pages, and renders tag plus note for each', () => {
    // The generated blob carries the flag for exactly the live flagged set
    // (a third flagged page must surface here the moment it is authored)...
    expect(
      GUIDE_RELIQUARY.filter((p) => p.excludeFromCompletion !== undefined).map((p) => [
        p.id,
        p.excludeFromCompletion,
      ]),
    ).toEqual([
      ['horizons_vault_of_ages', 'retired'],
      ['horizons_riftbound', 'personal'],
    ]);
    // ...and the rendered catalog SHOWS the label: the tag beside the page
    // heading and the explanatory note, one pair per flagged page, resolved
    // through t() (never hardcoded English), with none on ordinary pages.
    const html = reliquaryCatalogSections(GUIDE_RELIQUARY);
    expect(html.match(/guide-reliquary-flag/g)?.length).toBe(2);
    expect(html.match(/guide-reliquary-note/g)?.length).toBe(2);
    expect(html).toContain(`(${t('guide.reliquaryPage.retiredTag')})`);
    expect(html).toContain(`(${t('guide.reliquaryPage.personalTag')})`);
    expect(html).toContain(t('guide.reliquaryPage.retiredNote'));
    expect(html).toContain(t('guide.reliquaryPage.personalNote'));
    // The note sits inside the flagged page's own section (reach, not mere
    // presence): the vault section carries the retired pair.
    const vault = html.match(
      /<section[^>]*id="reliquary-horizons_vault_of_ages"[\s\S]*?<\/section>/,
    )?.[0];
    expect(vault, 'vault section').toBeTruthy();
    expect(vault).toContain(t('guide.reliquaryPage.retiredTag'));
    expect(vault).toContain(t('guide.reliquaryPage.retiredNote'));
  });

  it('every generated mark name equals the shipped English the sheet resolves', () => {
    // The generator keeps its OWN hand table of mark names
    // (RELIQUARY_MARK_GUIDE_NAMES in scripts/wiki/build_content.mjs), so the
    // wiki could print a name the /c/ sheet never says. Anchor the two
    // together on RELIQUARY_MARK_ENGLISH, which the character-sheet cross-pin
    // already binds to the live MOBS display names: through that pin this
    // reaches MOBS transitively, without re-deriving it here.
    //
    // The generated relics carry {kind, name} only (no markId, by the field
    // allowlist above), so the id comes from the live catalog page at the SAME
    // index: the emit walks page.relics in order, which the id-order pin above
    // already holds.
    let checked = 0;
    const nonSlain: string[] = [];
    for (const guidePage of GUIDE_RELIQUARY) {
      const live = RELIQUARY_PAGES.find((p) => p.id === guidePage.id);
      expect(live, `live page for ${guidePage.id}`).toBeDefined();
      if (!live) continue;
      expect(guidePage.relics.length, `${guidePage.id} relic count`).toBe(live.relics.length);
      for (let i = 0; i < live.relics.length; i++) {
        const relic = live.relics[i];
        if (relic.kind !== 'mark') continue;
        const expected = RELIQUARY_MARK_ENGLISH.get(relic.markId);
        expect(expected, `${relic.markId} has shipped English`).toBeDefined();
        expect(guidePage.relics[i]?.name, `${guidePage.id}:${relic.markId}`).toBe(expected);
        checked += 1;
        if (!relic.markId.startsWith('slain:')) nonSlain.push(relic.markId);
      }
    }
    // Floor at today's measured catalog: 19 rare-slain proofs plus the 10
    // profession marks. A page that stopped emitting marks would otherwise
    // make every assertion above vacuous.
    expect(checked).toBeGreaterThanOrEqual(29);
    // And the sweep really spans the whole table FAMILY, not just the slain
    // namespace the Rares page contributes: masterwork and gather_event rows
    // are checked too, so a generator edit scoped to one family cannot hide.
    expect(nonSlain.some((id) => id.startsWith('masterwork:'))).toBe(true);
    expect(nonSlain.some((id) => id.startsWith('gather_event:'))).toBe(true);
  });

  it('pins the reliquary route wiring to literals', () => {
    const route = GUIDE_ROUTES.find((r) => r.id === 'reliquary');
    expect(route?.sub).toBe('reliquary');
    expect(route?.navKey).toBe('guide.nav.reliquary');
    // 'endgame' since the release's sidebar regroup retired the catch-all
    // compendium group: the page files beside deeds/dungeons/delves/rifts.
    expect(route?.group).toBe('endgame');
    expect(pageFor('reliquary')).toBe(reliquaryPage);
  });

  it('renders shelves and every page name without inventing player progress chrome', () => {
    setLanguage('en');
    const html = reliquaryPage.render({
      params: [],
      sub: 'reliquary',
      titleKey: 'guide.nav.reliquary',
    });
    expect(html).toContain(t('guide.nav.reliquary'));
    expect(html).toContain(t('guide.reliquaryPage.shelf.conquerors' as never));
    expect(html).toContain(t('guide.reliquaryPage.shelf.professions' as never));
    expect(html).toContain(t('guide.reliquaryPage.shelf.horizons' as never));
    for (const page of GUIDE_RELIQUARY) {
      expect(html).toContain(page.name);
    }
    // Pure catalog helper covers the same rows the page composes.
    const sections = reliquaryCatalogSections(GUIDE_RELIQUARY);
    // Exact class token (not the h3's guide-reliquary-page-h prefix).
    expect((sections.match(/class="guide-block guide-reliquary-page"/g) ?? []).length).toBe(
      GUIDE_RELIQUARY.length,
    );
  });
});

describe('Guide deeds page render (continued)', () => {
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
    const hidden = Object.values(DEEDS).filter((x) => x.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(
      hidden.some((d) => d.reward?.kind === 'title'),
      'the reward-text arm needs a live hidden title deed',
    ).toBe(true);
    for (const d of hidden) {
      for (const needle of [d.id, ...hiddenDeedProse(d)]) {
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
    // touching content/deeds.ts), reward titles included. Bare ids are
    // tolerated by maintainer judgment: deed_image_ids.ts carries them for the
    // committed crest art, and an id alone spoils nothing.
    const hidden = Object.values(DEEDS).filter((d) => d.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(
      hidden.some((d) => d.reward?.kind === 'title'),
      'the reward-text arm needs a live hidden title deed',
    ).toBe(true);
    for (const file of reached) {
      const source = readFileSync(file, 'utf8');
      for (const d of hidden) {
        for (const needle of hiddenDeedProse(d)) {
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

  it('lists The Reliquary bind on the controls page, matching the in-game default', () => {
    setLanguage('en');
    const reliquaryBind = BIND_ACTIONS.find((a) => a.id === 'reliquary');
    expect(reliquaryBind?.defaults).toEqual(['Shift+KeyX']);
    expect(t('guide.controls.reliquary')).toBe('The Reliquary');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    expect(html).toContain('<kbd>Shift+X</kbd></td><td>The Reliquary</td>');
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

  it('never leaks a boss personal name into the reliquary page PROSE', () => {
    // The same withhold-the-name standard, extended to the newest public
    // guide surface. The catalog sections legitimately carry some boss names
    // (the raid page IS 'Nythraxis Raid'; relic names like 'Fangknife of
    // Zulgar' name their boss), so the scan strips the embedded
    // reliquaryCatalogSections output verbatim and holds the REMAINDER (the
    // guide-authored prose, headings, and any future intro copy) to the
    // withhold-the-name rule for EVERY boss, no carve-out: a per-name
    // allowlist here would excuse exactly the prose the dungeons-page pin
    // below exists to protect.
    setLanguage('en');
    const html = reliquaryPage.render({
      params: [],
      sub: 'reliquary',
      titleKey: 'guide.nav.reliquary',
    });
    const catalogHtml = reliquaryCatalogSections(GUIDE_RELIQUARY);
    // Premise: the strip really removed the catalog block, so the prose
    // remainder is what is scanned (an embedding change would make the scan
    // silently re-cover catalog names and fail on the raid pages).
    expect(html.includes(catalogHtml)).toBe(true);
    const prose = html.replace(catalogHtml, '');
    for (const boss of Object.values(MOBS).filter((m) => m.boss)) {
      const personalName = boss.name.split(',')[0];
      expect(
        prose.includes(personalName),
        `boss personal name "${personalName}" leaked into the reliquary page prose`,
      ).toBe(false);
    }
  });

  it('never leaks a boss personal name into the dungeons page card copy', () => {
    // Regression pin: wildheartBody once named the Wildheart Basin boss outright
    // ("...to face Zulgar"), breaking with every sibling body's withhold-the-name
    // idiom (sanctumBody, raidBody, sagaPeaksBody). The full-name scan the deeds
    // page uses would have missed it (the leak was the bare personal name, not the
    // comma-joined title), so this checks the personal name segment on its own.
    setLanguage('en');
    const html = dungeonsPage.render({
      params: [],
      sub: 'dungeons',
      titleKey: 'guide.nav.dungeons',
    });
    for (const boss of Object.values(MOBS).filter((m) => m.boss)) {
      const personalName = boss.name.split(',')[0];
      expect(
        html.includes(personalName),
        `boss personal name "${personalName}" leaked into the dungeons page`,
      ).toBe(false);
    }
  });

  it('never leaks the Wildheart Basin boss name in a translated locale either', async () => {
    // Follow-up regression pin (review on PR #2903): the first fix only reworded the
    // English catalog value plus the eager en/en_CA/en_XA bundles, leaving every
    // translated overlay still naming the boss. Drive every translated locale that
    // carries this key, the same way a real translated visitor would
    // (ensureLocaleLoaded before render), and check for that LOCALE's own personal-name
    // form, not just the English "Zulgar": a second review round on this PR found the
    // first version of this test only covered 6 of the 17 fixed overlays and compared
    // every locale against the English name, so a translated overlay that leaked the
    // localized form (zh_CN "祖尔加", zh_TW "祖爾加", ja_JP "ズルガー", ko_KR "줄가르",
    // or the Cyrillic ru_RU "Зулгар") would have passed silently. The Latin-script
    // locales below (including inflected forms like cs_CZ "Zulgarovi" and pl_PL
    // "Zulgarowi") all still contain the "Zulgar" substring, so one shared check
    // covers them; the four non-Latin scripts get their own literal.
    const wildheartBoss = Object.values(MOBS).find((m) => m.id === 'wildheart_high_priest');
    expect(wildheartBoss, 'wildheart_high_priest mob missing from content').toBeTruthy();
    const personalName = (wildheartBoss?.name ?? '').split(',')[0];
    expect(personalName).toBe('Zulgar');
    const forbiddenByLocale: Partial<Record<SupportedLanguage, string>> = {
      cs_CZ: personalName,
      da_DK: personalName,
      de_DE: personalName,
      es: personalName,
      fr_FR: personalName,
      id_ID: personalName,
      it_IT: personalName,
      nl_NL: personalName,
      pl_PL: personalName,
      pt_BR: personalName,
      ru_RU: 'Зулгар',
      sv_SE: personalName,
      tr_TR: personalName,
      vi_VN: personalName,
      ja_JP: 'ズルガー',
      ko_KR: '줄가르',
      zh_CN: '祖尔加',
      zh_TW: '祖爾加',
    };
    for (const [locale, forbidden] of Object.entries(forbiddenByLocale) as [
      SupportedLanguage,
      string,
    ][]) {
      await ensureLocaleLoaded(locale);
      setLanguage(locale);
      const html = dungeonsPage.render({
        params: [],
        sub: 'dungeons',
        titleKey: 'guide.nav.dungeons',
      });
      expect(
        html.includes(forbidden),
        `boss personal name "${forbidden}" leaked into the ${locale} dungeons page`,
      ).toBe(false);
      // The reliquary page holds the same standard per locale (its English-only
      // sibling above records why prose-only): the catalog strip is recomputed
      // HERE because section headings localize, so the block differs per locale.
      const reliquaryHtml = reliquaryPage.render({
        params: [],
        sub: 'reliquary',
        titleKey: 'guide.nav.reliquary',
      });
      const localeCatalogHtml = reliquaryCatalogSections(GUIDE_RELIQUARY);
      expect(reliquaryHtml.includes(localeCatalogHtml), locale).toBe(true);
      expect(
        reliquaryHtml.replace(localeCatalogHtml, '').includes(forbidden),
        `boss personal name "${forbidden}" leaked into the ${locale} reliquary page prose`,
      ).toBe(false);
    }
    setLanguage('en');
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

// Five shipped keybound features (Professions, Target Buffs and Debuffs, Dungeon Finder,
// Mount/Dismount, Sheathe) were entirely absent from the controls reference table. Each row
// mirrors the game's real default bind (src/game/keybinds.ts), so a changed shipped default
// reds this test instead of silently drifting the public reference.
describe('Guide controls reference completeness', () => {
  it('documents Professions, Target Buffs/Debuffs, Dungeon Finder, Mount, and Sheathe', () => {
    setLanguage('en');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    expect(html).toContain('<kbd>Shift+P</kbd></td><td>Professions</td>');
    expect(html).toContain('<kbd>Shift+J</kbd></td><td>Target buffs and debuffs</td>');
    expect(html).toContain('<kbd>Shift+I</kbd></td><td>Dungeon Finder</td>');
    expect(html).toContain('<kbd>`</kbd></td><td>Mount / Dismount</td>');
    expect(html).toContain('<kbd>Z</kbd></td><td>Sheathe/Unsheathe Weapon</td>');
  });

  // Second wave of absent rows, found by auditing the whole table against BIND_ACTIONS:
  // swimming had no key at all, the battleground flag action was undocumented on a page
  // that describes flag play, damage meters were missing, and the Pet group showed five
  // of six binds. Same contract as above: a changed shipped default reds this test rather
  // than silently drifting the public reference.
  it('documents Swim Down, the arrow-key alternates, the flag action, meters, and Pet: Mark', () => {
    setLanguage('en');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    expect(html).toContain('<kbd>LCtrl</kbd></td><td>Swim down while you are in the water (hold)');
    expect(html).toContain('<kbd>Arrow Keys</kbd>');
    expect(html).toContain('<kbd>Shift+F</kbd></td><td>Take the enemy flag in Thornhollow Fields');
    expect(html).toContain('<kbd>Shift+H</kbd></td><td>Damage meters');
    expect(html).toContain('<kbd>Ctrl+6</kbd></td><td>Pet: Mark');
    expect(html).toContain('<kbd>Shift+Tab</kbd></td><td>Cycle target backward');
  });

  // Third wave, found by the farming Phase 8 QA: the Harvest Journal shipped a
  // defaulted window bind (Shift+K) with no controls row, exactly the drift
  // class the two waves above were written against. Same per-bind contract.
  it('documents the Harvest Journal bind and keeps it in step with the game default', () => {
    setLanguage('en');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    expect(html).toContain('<kbd>Shift+K</kbd></td><td>Harvest Journal</td>');
    expect(BIND_ACTIONS.find((a) => a.id === 'harvestJournal')?.defaults).toEqual(['Shift+KeyK']);
  });

  // The COMPLETENESS pin the three waves above were missing: every Interface
  // window bind's default keycap must appear in the controls reference, so
  // the next shipped bind reds here instead of drifting silently. Both halves
  // read the live tables (BIND_ACTIONS through the same keyLabel the options
  // panel prints, the page through its rendered <kbd> cells). A page-wide
  // keycap SET is enough here because tests/keybinds.test.ts pins that no two
  // shipped defaults share a code (the one sanctioned KeyA pair aside), so a
  // new Interface bind cannot borrow another action's keycap to pass: its
  // keycap is on the page only if a row was written for it.
  it('lists every Interface bind default on the controls page', () => {
    setLanguage('en');
    const html = controlsPage.render({
      params: [],
      sub: 'reference/controls',
      titleKey: 'guide.nav.controls',
    });
    const kbds = new Set([...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]));
    const missing = BIND_ACTIONS.filter(
      (a) => a.category === 'Interface' && !a.defaults.some((code) => kbds.has(keyLabel(code))),
    ).map((a) => a.id);
    expect(missing).toEqual([]);
    // Anti-vacuous: the scrape really read keycaps, and the two shifted rows
    // this pin was written for are among them.
    expect(kbds.has('Shift+P')).toBe(true);
    expect(kbds.has('Shift+K')).toBe(true);
  });

  it('keeps the second-wave binds in step with the game defaults', () => {
    const defaults = new Map(BIND_ACTIONS.map((a) => [a.id, a.defaults]));
    expect(defaults.get('dive')).toEqual(['ControlLeft']);
    expect(defaults.get('bgFlag')).toEqual(['Shift+KeyF']);
    expect(defaults.get('meters')).toEqual(['Shift+KeyH']);
    expect(defaults.get('targetPet')).toEqual(['Ctrl+Digit6']);
    expect(defaults.get('targetPrev')).toEqual(['Shift+Tab']);
    // The arrow keys are the SECOND default of the four movement actions, which is the
    // whole claim the Arrow Keys row makes.
    expect(defaults.get('forward')).toEqual(['KeyW', 'ArrowUp']);
    expect(defaults.get('back')).toEqual(['KeyS', 'ArrowDown']);
    expect(defaults.get('turnLeft')).toEqual(['KeyA', 'ArrowLeft']);
    expect(defaults.get('turnRight')).toEqual(['KeyD', 'ArrowRight']);
  });

  it('keeps those five binds in step with the game defaults', () => {
    const defaults = new Map(BIND_ACTIONS.map((a) => [a.id, a.defaults]));
    expect(defaults.get('professions')).toEqual(['Shift+KeyP']);
    expect(defaults.get('targetAuras')).toEqual(['Shift+KeyJ']);
    expect(defaults.get('dungeonFinder')).toEqual(['Shift+KeyI']);
    expect(defaults.get('mount')).toEqual(['Backquote']);
    expect(defaults.get('sheathe')).toEqual(['KeyZ']);
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

  it('ships a visible 320px WebP for the dedicated Duskmurk still', async () => {
    const gloomshade = GUIDE_WARLOCK_PETS.find((pet) => pet.id === 'gloomshade');
    expect(gloomshade?.model).toBe('mob_gloomshade');
    expect(gloomshade?.still).toBe('/guide-stills/mob_gloomshade.webp');
    const bytes = readFileSync(publicPath(gloomshade?.still ?? ''));
    expect(bytes.byteLength).toBeGreaterThan(2048);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 320, height: 320, channels: 4 });
    let visiblePixels = 0;
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      if (decoded.data[offset] > 0) visiblePixels++;
    }
    expect(visiblePixels).toBeGreaterThan(1000);
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

// ============================================================================
// Professions reference accuracy (Professions 2.0 wiki arm).
//
// NUMERIC-TRANSPARENCY CARVE-OUT (a maintainer ruling):
// the professions sections of the wiki publish EXACT numbers, skill
// requirements, gain-state boundaries, band thresholds, caps, fees,
// rare-event odds, and vendor prices, because a crafting reference that hides
// its numbers is useless. This carve-out is scoped to the GUIDE_PROF_*
// sections ONLY: the delve/bestiary no-digit spoiler guards above stay
// untouched and keep applying to their own sections, and narrative content
// remains spoiler-light everywhere. Every published number below maps back to
// the live sim def, so the wiki can never drift from the game.
// ============================================================================
describe('Guide professions generated content accuracy', () => {
  const EARNABLE_CRAFT_IDS = [
    'engineering',
    'alchemy',
    'cooking',
    'leatherworking',
    'tailoring',
    'inscription',
    'enchanting',
    'jewelcrafting',
    'weaponcrafting',
    'armorcrafting',
  ];

  it('covers the full ring, every seat content-bearing since the phase 06 catalog', () => {
    expect(GUIDE_PROF_RING.map((c) => c.id)).toEqual(CRAFT_RING.map((c) => c.id));
    for (const c of GUIDE_PROF_RING) {
      const def = CRAFT_RING.find((r) => r.id === c.id);
      expect(c.name).toBe(def?.name);
      expect(c.pole).toBe(def?.pole);
      expect(c.maxSkill).toBe(def?.maxSkill);
      expect(c.maxSkill).toBe(125); // every wave-one craft caps at 125
    }
    // Empty since the Masterwrought phase 06 inscription catalog: the pin
    // stays so a future content-empty seat is declared here, never silent.
    expect(GUIDE_PROF_RING.filter((c) => !c.hasContent).map((c) => c.id)).toEqual([]);
    expect(GUIDE_PROF_CRAFTS.map((c) => c.id)).toEqual(EARNABLE_CRAFT_IDS);
  });

  it('derives every hasContent flag independently from the live sim tables', () => {
    // With every live seat content-bearing, the empty-list pin above would
    // ALSO pass if the generator's craftHasContent were broken to answer
    // true unconditionally; recomputing the predicate here from the same
    // inputs (ALL_RECIPES, plus enchanting's action arm) reds that world.
    for (const c of GUIDE_PROF_RING) {
      const derived =
        c.id === 'enchanting'
          ? Object.keys(ENCHANTS).length > 0
          : ALL_RECIPES.some((r) => r.professionId === c.id);
      expect(c.hasContent, `${c.id} hasContent`).toBe(derived);
    }
    // Liveness for the recompute itself: a craft id outside the ring derives
    // false through the same expression.
    expect(ALL_RECIPES.some((r) => r.professionId === 'no_such_craft')).toBe(false);
  });

  it('still renders the content-empty ring card for a synthetic recipe-less seat', () => {
    // Unreachable from live data since phase 06 (every seat has content), so
    // the branch is driven directly: the empty card carries the coming-soon
    // copy and NO link, and the sibling content card links with no such copy.
    const emptyCard = ringCards([
      {
        id: 'inscription',
        name: 'Inscription',
        pole: 'Cross-cutting',
        maxSkill: 125,
        hasContent: false,
      },
    ]);
    expect(emptyCard).toContain('guide-prof-card-empty');
    expect(emptyCard).toContain(t('guide.professions.comingSoon'));
    expect(emptyCard).not.toContain('href=');
    const contentCard = ringCards([
      {
        id: 'inscription',
        name: 'Inscription',
        pole: 'Cross-cutting',
        maxSkill: 125,
        hasContent: true,
      },
    ]);
    expect(contentCard).toContain('href=');
    expect(contentCard).not.toContain(t('guide.professions.comingSoon'));
  });

  it('emits only allowlisted fields on every craft and recipe row (the GUIDE_DEEDS pattern)', () => {
    const craftFields = new Set([
      'id',
      'name',
      'pole',
      'maxSkill',
      'station',
      'masters',
      'specialization',
      'recipes',
    ]);
    const recipeFields = new Set([
      'id',
      'name',
      'skillReq',
      'tier',
      'station',
      'acquisition',
      'feeCopper',
      'materials',
      'output',
      'combo',
      'oncePerDay',
      'gain',
      // The consumable effect facts (C10): the foodHp restore and well-fed
      // boon values the craft page's effect sub-lines compose. Shape-pinned
      // in its own accuracy arm below.
      'effect',
    ]);
    for (const c of GUIDE_PROF_CRAFTS) {
      for (const k of Object.keys(c)) {
        expect(craftFields.has(k), `craft "${c.id}" emitted unexpected field "${k}"`).toBe(true);
      }
      for (const r of c.recipes) {
        for (const k of Object.keys(r)) {
          expect(recipeFields.has(k), `recipe "${r.id}" emitted unexpected field "${k}"`).toBe(
            true,
          );
        }
        for (const m of r.materials) expect(Object.keys(m).sort()).toEqual(['count', 'name']);
        expect(Object.keys(r.output).sort()).toEqual(['count', 'name', 'quality']);
        if (r.combo) expect(Object.keys(r.combo).sort()).toEqual(['crafts', 'minTier']);
        expect(Object.keys(r.gain).sort()).toEqual(['minimalAt', 'reducedAt', 'zeroAt']);
      }
    }
  });

  it('maps every recipe row back to the sim def with matching numbers', () => {
    for (const c of GUIDE_PROF_CRAFTS) {
      const simIds = ALL_RECIPES.filter((r) => r.professionId === c.id)
        .map((r) => r.id)
        .sort();
      expect(c.recipes.map((r) => r.id).sort()).toEqual(simIds);
      for (const row of c.recipes) {
        const def = ALL_RECIPES.find((r) => r.id === row.id);
        expect(def, `recipe row "${row.id}" has no sim def`).toBeDefined();
        if (!def) continue;
        expect(row.skillReq).toBe(def.skillReq);
        expect(row.tier).toBe(tierForSkill(def.skillReq));
        expect(row.station).toBe(def.stationType ?? null);
        // The channel split mirrors the generator's (phase 11, masterwrought R8, widened at
        // phase 11f): a drop-acquisition recipe whose teaching pattern is
        // stocked on the Heroic Quartermaster AND carried by a live drop table
        // renders as BOTH; one or the other alone renders as that one. The
        // drop side is derived from the tables themselves, the same way the
        // generator does it, so a channel added anywhere reaches this pin by
        // existing rather than by being listed.
        // Every pattern id a LIVE drop table carries: the normal mob loot
        // (which holds the raid channel), the heroic-only tables (the
        // five-man channel), and both rift pick lists. Derived rather than
        // listed, exactly as the generator derives it, so a channel added
        // anywhere reaches this pin by existing.
        const droppedPatternIds = new Set<string>([
          ...Object.values(MOBS).flatMap((m) =>
            (m.loot ?? []).flatMap((e) => (e.itemId ? [e.itemId] : [])),
          ),
          ...Object.values(HEROIC_BOSS_LOOT)
            .flat()
            .flatMap((e) => (e.itemId ? [e.itemId] : [])),
          ...RIFT_PATTERN_ITEM_IDS,
          ...FARM_RIFT_DROP_ITEM_IDS,
        ]);
        const patternId = `pattern_${def.resultItemId}`;
        const vendorTaught = HEROIC_VENDOR_STOCK.some((offer) => offer.itemId === patternId);
        const dropTaught = droppedPatternIds.has(patternId);
        expect(row.acquisition).toBe(
          def.acquisition?.includes('trainer')
            ? 'trainer'
            : def.acquisition?.includes('drop')
              ? vendorTaught && dropTaught
                ? 'dropAndVendor'
                : vendorTaught
                  ? 'vendor'
                  : 'drop'
              : 'known',
        );
        expect(row.feeCopper).toBe(def.acquisition?.includes('trainer') ? trainingFeeFor(def) : 0);
        expect(row.materials).toEqual(
          def.reagents.map((g) => ({ name: ITEMS[g.itemId].name, count: g.count })),
        );
        expect(row.output.name).toBe(ITEMS[def.resultItemId].name);
        expect(row.output.count).toBe(def.resultCount);
        expect(row.output.quality).toBe(ITEMS[def.resultItemId].quality ?? 'common');
        if (def.comboRequirement) {
          expect(row.combo).toEqual({
            crafts: [def.comboRequirement.craftA, def.comboRequirement.craftB],
            minTier: def.comboRequirement.minTier,
          });
        } else {
          expect(row.combo).toBeNull();
        }
        // The gain boundaries are DECISIVE against the real curve: one skill
        // point below each boundary still pays the higher rate, and the
        // boundary itself drops to exactly 0.5 / 0.25 / 0.
        const rTier = tierForSkill(def.skillReq);
        expect(tierProgressMultiplier(tierForSkill(row.gain.reducedAt - 1), rTier)).toBe(1);
        expect(tierProgressMultiplier(tierForSkill(row.gain.reducedAt), rTier)).toBe(0.5);
        expect(tierProgressMultiplier(tierForSkill(row.gain.minimalAt), rTier)).toBe(0.25);
        expect(tierProgressMultiplier(tierForSkill(row.gain.zeroAt), rTier)).toBe(0);
      }
    }
  });

  it('mirrors every consumable effect row against the live item def (C10)', () => {
    // The dish effect prose is composed from these VALUES, so the accuracy
    // guard binds them to the sim source both ways: every foodHp/wellfed
    // output carries the row with the def's own numbers, and a row never
    // appears on a non-consumable. Non-vacuity: the four buff dishes and at
    // least a dozen foodHp dishes exist, counted below.
    let foodRows = 0;
    let wellfedRows = 0;
    for (const c of GUIDE_PROF_CRAFTS) {
      for (const row of c.recipes) {
        const def = ALL_RECIPES.find((r) => r.id === row.id);
        if (!def) continue;
        const item = ITEMS[def.resultItemId];
        const itemWellfed = item.kind === 'food' ? item.wellFed : undefined;
        if (item.foodHp) {
          foodRows++;
          expect(row.effect?.food, `${row.id} foodHp row missing`).toEqual({
            amount: item.foodHp,
            seconds: CONSUME_DURATION,
          });
        } else {
          expect(row.effect?.food, `${row.id} phantom food effect`).toBeUndefined();
        }
        if (itemWellfed) {
          wellfedRows++;
          expect(row.effect?.wellfed, `${row.id} wellfed row missing`).toEqual({
            aura: itemWellfed.aura,
            kind: itemWellfed.kind,
            value: itemWellfed.value,
            minutes: itemWellfed.duration / 60,
          });
          // The LIVE_OFF_SWEEP exemption for effectWellFedAura rests on this
          // precondition: every SHIPPED wellfed kind is mapped, so the
          // aura-name fallback stays a degradation path and never renders.
          // The first dish with an unmapped kind reds here instead of
          // silently selecting the fallback prose on the wiki.
          expect(
            Object.keys(WELLFED_STAT_KEYS),
            `${row.id} ships an unmapped wellfed kind`,
          ).toContain(itemWellfed.kind);
        } else {
          expect(row.effect?.wellfed, `${row.id} phantom wellfed effect`).toBeUndefined();
        }
        if (!item.foodHp && !itemWellfed) {
          expect(row.effect, `${row.id} effect on a non-consumable`).toBeUndefined();
        }
      }
    }
    expect(foodRows).toBeGreaterThanOrEqual(12);
    // The whole unified well-fed family since 11c: the four farm dishes plus
    // the three apex role plates (the generator reads the one wellFed field,
    // so the plates gain their effect cells at the same regen).
    expect(wellfedRows).toBe(7);
  });

  it('the unmapped-kind fallback line renders (never a silent effect cell)', () => {
    // Synthetic row: no shipped dish carries an unmapped kind (asserted
    // above), so the fallback branch is driven directly. Its aura value is
    // the def's baked English proper noun, the page's GUIDE_DEEDS policy.
    const row = {
      effect: { wellfed: { aura: 'Test Boon', kind: 'buff_spellpower', value: 3, minutes: 10 } },
    } as unknown as Parameters<typeof effectLines>[0];
    const html = effectLines(row);
    expect(html).toContain('guide-prof-effect');
    expect(html).toContain('Test Boon');
    expect(html).toContain('10');
  });

  it('the cooking and alchemy materials prose names the farm as a supplier (Phase 11g)', () => {
    // THE ONLY GUARD OVER THIS HAND-AUTHORED PROSE, added by Phase 11g because
    // that phase is what made the old text false. content.generated.ts is
    // regenerated and diffed, but it cannot see a guide.* string at all, so
    // without an arm here the cooking page could go back to describing a
    // two-supplier pantry with the whole gate green. Same shape and same
    // reasoning as the farming anchors further down this file.
    setLanguage('en');
    const cooking = GUIDE_PROF_CRAFTS.find((c) => c.id === 'cooking');
    const alchemy = GUIDE_PROF_CRAFTS.find((c) => c.id === 'alchemy');
    expect(cooking, 'the cooking craft record').toBeDefined();
    expect(alchemy, 'the alchemy craft record').toBeDefined();
    const cookHtml = craftDetailHtml(cooking as (typeof GUIDE_PROF_CRAFTS)[number]);
    const alcHtml = craftDetailHtml(alchemy as (typeof GUIDE_PROF_CRAFTS)[number]);

    // EVERY ANCHOR EXISTS ONLY IN THE CORRECTED PROSE. Anchoring on a clause
    // the old text also carried is the exact trap the 11e QA blocked on and
    // the 11f QA hit again: the correction reverts and the guard stays green.
    // All of them are apostrophe-free, since the rendered page escapes to
    // &#39; and a possessive anchor would never match this HTML.
    expect(cookHtml).toContain('The third supplier is the garden bed');
    expect(cookHtml).toContain('never held up by the pantry');
    expect(alcHtml).toContain('The elixir line also takes a farm base');
    expect(alcHtml).toContain('loses nothing to the change');
    // THE APEX HALF (masterwrought Phase 11h). Both bodies enumerated the
    // garden's buyers and both enumerations stopped at rung 50, so both went
    // stale the moment produce reached 100 and 125. Same anchor rule as above:
    // every clause exists ONLY in the corrected prose and is apostrophe-free,
    // since the page escapes to &#39;.
    expect(cookHtml).toContain('The garden reaches the top of the kitchen too');
    // THE SUPERLATIVE IS TIED TO THE LIVE TABLE (Phase 11h QA), not just
    // anchored as a phrase. An anchor proves the sentence is PRESENT and says
    // nothing about whether it is TRUE, so an eighth-reagent bill would red the
    // derived maximum in tests/provisioning_supply_line_apex.test.ts, the author
    // would fix that arm, and this page would go on calling the hearth the
    // longest bill in the game with every suite green. Deriving it here means
    // the prose and the table cannot part company.
    const longestBill = Math.max(...ALL_RECIPES.map((r) => r.reagents.length));
    const longestRows = ALL_RECIPES.filter((r) => r.reagents.length === longestBill).map(
      (r) => r.id,
    );
    expect(longestRows, 'the page names the hearth as the sole longest bill').toEqual([
      'recipe_laden_hearth',
    ]);
    expect(cookHtml).toContain('the longest bill in the game');
    expect(alcHtml).toContain('The bench above the ladder asks for the garden too');
    expect(alcHtml).toContain('stand beside the herbs rather than in place of them');
    // The negative half for the claim 11h retires: the cooking page said the
    // crops sit in the TRAINER dishes, which was the whole story until this
    // phase and is now half of one. Without this, a reverted apex paragraph
    // would leave the page telling a player the garden stops at the trainer
    // ladder while the bills say otherwise, and every anchor above would pass.
    // ANCHORED ON A PHRASE UNIQUE TO THE NEW PARAGRAPH. The obvious anchor,
    // 'the three apex role dishes', also occurs in craftProse.cooking.identityBody,
    // which this phase never touched, so it would have stayed green through a
    // full revert of the apex paragraph. Measured, not assumed.
    expect(cookHtml).toContain('tells the three apex role dishes apart');
    expect(alcHtml).toContain('the Grand Cauldron at the very top');
    // THE GATE CLAUSE, pinned BOTH WAYS (Phase 11h QA, fix-round review). The
    // page shipped "all three ask Farming 50 and nothing more", which the plant
    // path refuses: it also wants a tier-3 hoe, and that hoe wields at Farming
    // 70, so a farmer at 50 who read this page was denied with reason 'tool'.
    // The correction was made with no pin at all, which is the same shape as the
    // qr-11G-BEDS hole one arm below: the surviving anchors sit in OTHER
    // sentences of the same paragraph, so a revert of just this clause would
    // have left every suite green. The positive half names the new clause; the
    // negative half is what stops a "supplement rather than replace" edit from
    // re-adding the false floor beside the true one.
    expect(cookHtml).toContain('growing your own means a Skysilver Hoe');
    expect(cookHtml, 'the retired Farming-50 floor must be gone, not supplemented').not.toContain(
      'ask Farming 50 and nothing more',
    );
    // The headings enumerated the suppliers too, so they went stale with the
    // bodies and are pinned with them.
    expect(cookHtml).toContain('A pantry fed by rod, knife, and furrow');
    expect(alcHtml).toContain('Herbs, glands, glass, and the garden');
    // The negative half: the two-supplier headings must be gone, not merely
    // supplemented. Without this a reverted heading would sit beside a
    // corrected body and both positive anchors above would still pass.
    expect(cookHtml).not.toContain('A pantry fed by rod and knife');
    expect(alcHtml).not.toContain('Herbs, glands, and glass');
    // And the craft blurb, which opened on the catch alone.
    expect(t('guide.profPages.craftIntro.cooking')).toContain(
      "the day's catch and the season's harvest",
    );
    // ...and the RENDERED half of it (qr-11G-INTRO, Phase 11g QA). The five
    // anchors above read the rendered HTML; this one alone read t(), so the one
    // string on this page whose render or escaping could regress was the one not
    // covered against it. craftDetailHtml puts it in the lead paragraph through
    // esc(), so the apostrophes arrive as &#39; and the anchor is written that
    // way rather than avoided.
    expect(cookHtml, 'the craft blurb renders, not just resolves').toContain(
      'the day&#39;s catch and the season&#39;s harvest',
    );

    // THE QUANTITY CLAIMS, DERIVED FROM THE LIVE BILLS rather than pinned as
    // literals, and this arm exists because a mutation proved the anchors above
    // cannot see a miscount. The prose shipped "a Frost Gourd" against a bill of
    // two; every anchor stayed green, because they all test WHICH clause is
    // present and none tests whether its number is true.
    //
    // The prose uses the article quantitatively throughout ("a Brook Carrot" is
    // exactly 1), so the count and the word are pinned together: change the bill
    // without changing the sentence and this reds, which is the only way the
    // page cannot quietly start lying about a number a player can count.
    const countWord: Record<number, string> = { 1: 'a', 2: 'two', 3: 'three', 4: 'four' };
    const reagentCount = (recipeId: string, itemId: string): number => {
      const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
      expect(recipe, `${recipeId} must exist`).toBeDefined();
      const entry = recipe?.reagents.find((g) => g.itemId === itemId);
      expect(entry, `${recipeId} must consume ${itemId}`).toBeDefined();
      return entry?.count ?? 0;
    };
    const body = t('guide.profPages.craftProse.cooking.materialsBody');
    const gourds = reagentCount('recipe_marlows_grand_roast', 'frost_gourd');
    const barley = reagentCount('recipe_marlows_grand_roast', 'highland_barley');
    const carrots = reagentCount('recipe_frostgill_chowder', 'brook_carrot');
    expect(gourds, 'the roast gourd count must have a word for it').toBeLessThanOrEqual(4);
    // THE ROAST ANCHORS CARRY THEIR OWN TAILS TOO (masterwrought Phase 11h).
    // They were unique phrases when Phase 11g wrote them; 11h's apex paragraph
    // introduced a second occurrence of both into the same body, which silently
    // weakened them: rewording the roast clause to 'three Highland Barley' while
    // the bill still shipped 2 would have stayed green off the apex sentence.
    // The tail restores what 11g's arm actually had.
    expect(body, `the roast takes ${gourds} frost gourd(s)`).toContain(
      `${countWord[gourds]} Frost Gourd${gourds === 1 ? '' : 's'} off the Highwatch terraces`,
    );
    expect(body, `the roast takes ${barley} highland barley`).toContain(
      `${countWord[barley]} Highland Barley and`,
    );
    expect(body, `the chowder takes ${carrots} brook carrot(s)`).toContain(
      `${countWord[carrots]} Brook Carrot${carrots === 1 ? '' : 's'}`,
    );

    // THE ALCHEMY BODY CARRIES THE SAME HAZARD and was left without the guard
    // (qr-11G-ALCPROSE, Phase 11g QA). It writes "a Frost Gourd in the Elixir of
    // the Serpent", the article used quantitatively exactly as the cooking body
    // uses it, against a bill of one. That is the identical shape as the defect
    // this arm was built for: the cooking page shipped "a Frost Gourd" against a
    // bill of TWO and every clause anchor stayed green, because an anchor tests
    // WHICH clause is present and never whether its number is true. Nothing above
    // reads the alchemy body's counts, so a later phase re-tiering the serpent's
    // gourd would leave the page quietly lying about a number a player can count.
    const alcBody = t('guide.profPages.craftProse.alchemy.materialsBody');
    const serpentGourds = reagentCount('recipe_elixir_of_the_serpent', 'frost_gourd');
    expect(serpentGourds, 'the serpent gourd count must have a word for it').toBeLessThanOrEqual(4);
    expect(alcBody, `the serpent takes ${serpentGourds} frost gourd(s)`).toContain(
      `${countWord[serpentGourds]} Frost Gourd${serpentGourds === 1 ? '' : 's'}`,
    );
    // The two unquantified alchemy crops are named without a number on purpose,
    // so pin the NAMES rather than a count: a re-tier that dropped either crop
    // off its bill would leave the sentence claiming a supplier it lost.
    expect(reagentCount('recipe_elixir_of_the_boar', 'vale_wheat')).toBeGreaterThan(0);
    expect(reagentCount('recipe_venomfire_elixir', 'bog_beet')).toBeGreaterThan(0);
    expect(alcBody).toContain('Vale Wheat in the Elixir of the Boar');
    expect(alcBody).toContain('Bog Beet in the Vipersear');

    // The same bound the gourd arm carries, stated for the other two cooking
    // counts as well: countWord only spells 1 to 4, and an unbounded count would
    // fail on an undefined lookup rather than on the claim under test.
    expect(barley, 'the roast barley count must have a word for it').toBeLessThanOrEqual(4);
    expect(carrots, 'the chowder carrot count must have a word for it').toBeLessThanOrEqual(4);

    // THE APEX QUANTITY CLAIMS (masterwrought Phase 11h), derived exactly like
    // the leveling ones above and for the same recorded reason: an anchor tests
    // WHICH clause is present and never whether its number is true, and this
    // page has already shipped one miscount that every anchor passed. Both new
    // paragraphs use the article and the number word quantitatively, so every
    // count they state is pinned to the live bill.
    // EACH ANCHOR CARRIES ITS CLAUSE TAIL, and that is not decoration: the bare
    // phrases 'two Frost Gourds' and 'two Highland Barley' each occur TWICE in
    // this one body, because the pre-existing Marlow's Grand Roast sentence
    // already uses both. Without the tail, changing the PROSE alone ('three
    // Frost Gourds into the Stonepot Stew') left the arm green off the roast's
    // occurrence, which is exactly the miscount class this arm exists for.
    const apexCounts: Array<[string, string, string, string]> = [
      ['recipe_stonepot_stew', 'frost_gourd', 'Frost Gourd', 's into the Stonepot Stew'],
      [
        'recipe_warspice_skewers',
        'highland_barley',
        'Highland Barley',
        ' onto the Warspice Skewers',
      ],
      [
        'recipe_sageleaf_chowder',
        'thornpeak_cabbage',
        'Thornpeak Cabbage',
        ' into the Sageleaf Chowder',
      ],
      [
        'recipe_laden_hearth',
        'evergarden_greens',
        'Evergarden Greens',
        ' and a Fine Evergarden Greens',
      ],
    ];
    for (const [recipeId, itemId, label, tail] of apexCounts) {
      const n = reagentCount(recipeId, itemId);
      expect(n, `${recipeId} ${itemId} count must have a word for it`).toBeLessThanOrEqual(4);
      expect(body, `${recipeId} takes ${n} ${itemId}`).toContain(`${countWord[n]} ${label}${tail}`);
    }
    // The cooking page also names the hearth's FINE twin without a number, so
    // pin the name against the live bill: a re-tier that dropped it would leave
    // the sentence claiming an ingredient the recipe lost.
    expect(reagentCount('recipe_laden_hearth', 'fine_evergarden_greens')).toBe(1);
    expect(body).toContain('a Fine Evergarden Greens');
    // The alchemy body's apex counts, same rule. The barley is stated once for
    // all three flasks, so the pin is that all three really agree.
    const flaskBarley = [
      'recipe_ironhusk_flask',
      'recipe_warboar_flask',
      'recipe_runewater_flask',
    ].map((id) => reagentCount(id, 'highland_barley'));
    expect(new Set(flaskBarley).size, 'the three flasks must agree, as the sentence says').toBe(1);
    expect(alcBody, `each flask steeps ${flaskBarley[0]} highland barley`).toContain(
      `steep ${countWord[flaskBarley[0]]} Highland Barley`,
    );
    const melons = reagentCount('recipe_grand_cauldron', 'gilded_sunmelon');
    expect(melons, 'the cauldron melon count must have a word for it').toBeLessThanOrEqual(4);
    expect(alcBody, `the cauldron takes ${melons} gilded sunmelon`).toContain(
      `${countWord[melons]} Gilded Sunmelon`,
    );
    expect(reagentCount('recipe_grand_cauldron', 'fine_gilded_sunmelon')).toBe(1);
    expect(alcBody).toContain('a Fine Gilded Sunmelon');
  });

  it('pins the spot literals a consistently-wrong regeneration would keep wrong', () => {
    // The rare-tier warblade: trainer-taught at the forge, 1 gold to learn,
    // gain fading at 75 / 100 / 125 (tier 2 recipe, TIER_SKILL_STEP 25).
    const wc = GUIDE_PROF_CRAFTS.find((c) => c.id === 'weaponcrafting');
    const warblade = wc?.recipes.find((r) => r.id === 'recipe_thorium_warblade');
    expect(warblade?.name).toBe('Osmium Warblade');
    expect(warblade?.skillReq).toBe(50);
    expect(warblade?.station).toBe('forge');
    expect(warblade?.acquisition).toBe('trainer');
    expect(warblade?.feeCopper).toBe(10000);
    expect(warblade?.gain).toEqual({ reducedAt: 75, minimalAt: 100, zeroAt: 125 });
    expect(TIER_SKILL_STEP).toBe(25);
    // A grandfathered tool recipe: known to everyone, no fee, tier 3.
    const eng = GUIDE_PROF_CRAFTS.find((c) => c.id === 'engineering');
    const pick = eng?.recipes.find((r) => r.id === 'recipe_thorium_mining_pick');
    expect(pick?.acquisition).toBe('known');
    expect(pick?.feeCopper).toBe(0);
    expect(pick?.gain).toEqual({ reducedAt: 100, minimalAt: 125, zeroAt: 150 });
    // A drop-taught apex row (Masterwrought phase 08, R8): the third
    // acquisition arm, never 'known' (the row must not claim a pattern-drop
    // recipe is known from the start), no trainer fee.
    const ac = GUIDE_PROF_CRAFTS.find((c) => c.id === 'armorcrafting');
    const apexLegs = ac?.recipes.find((r) => r.id === 'recipe_forgefold_legguards');
    expect(apexLegs?.acquisition).toBe('drop');
    expect(apexLegs?.feeCopper).toBe(0);
    expect(apexLegs?.skillReq).toBe(100);
    // A vendor-channel apex row (phase 11, R8's deterministic pillar): the
    // fourth acquisition arm, distinct from the found-pattern channel even
    // though the sim-side acquisition stays ['drop'] for the learn flow.
    const alc = GUIDE_PROF_CRAFTS.find((c) => c.id === 'alchemy');
    const apexFlask = alc?.recipes.find((r) => r.id === 'recipe_ironhusk_flask');
    expect(apexFlask?.acquisition).toBe('vendor');
    expect(apexFlask?.feeCopper).toBe(0);
    // Specialization: skill 75, 20 percent material discount, from content.
    for (const c of GUIDE_PROF_CRAFTS) {
      expect(c.specialization.at).toBe(PERK_THRESHOLDS[c.id].specializedSkillThreshold);
      expect(c.specialization.at).toBe(75);
      expect(c.specialization.materialDiscountPct).toBe(
        PERK_THRESHOLDS[c.id].materialDiscountPct * 100,
      );
      expect(c.specialization.materialDiscountPct).toBe(20);
    }
    // The jewelcrafting card derives its station from its unanimous forge-bound
    // recipes (the craft is absent from STATION_TYPE_BY_CRAFT by decision), so
    // the page names the forge and its master instead of "No station needed".
    const jc = GUIDE_PROF_CRAFTS.find((c) => c.id === 'jewelcrafting');
    expect(jc?.station).toBe('forge');
    expect(jc?.masters.map((m) => m.name)).toContain('Forgemistress Darva');
    // Enchanting keeps the null card by design: its recipe list is a sideline
    // (two toolworks charms) while enchanting itself needs no station.
    const ench = GUIDE_PROF_CRAFTS.find((c) => c.id === 'enchanting');
    expect(ench?.station).toBeNull();
    expect(ench?.masters).toEqual([]);
  });

  it('grounds each craft station and its resident masters in the sim tables', () => {
    // A craft card's station is its own STATION_TYPE_BY_CRAFT entry, or (for a
    // craft absent from that table, except enchanting) the unanimous
    // stationType across its recipes: the generator's stationTypeForCraftCard
    // rule, re-derived here from the same sim tables.
    const expectedStation = (id: string): string | null => {
      const own = STATION_TYPE_BY_CRAFT[id];
      if (own) return own;
      if (id === 'enchanting') return null;
      const recipes = ALL_RECIPES.filter((r) => r.professionId === id);
      const first = recipes[0]?.stationType ?? null;
      if (!first) return null;
      return recipes.every((r) => (r.stationType ?? null) === first) ? first : null;
    };
    for (const c of GUIDE_PROF_CRAFTS) {
      expect(c.station).toBe(expectedStation(c.id));
      const simMasters = STATIONS.filter((s) => s.type === c.station);
      expect(c.masters.length).toBe(c.station ? simMasters.length : 0);
      for (const m of c.masters) {
        const npc = Object.values(NPCS).find((n) => n.name === m.name);
        expect(npc, `master "${m.name}" is not a real NPC`).toBeDefined();
      }
    }
    // Enchanting has no station and no station masters (content fact).
    const ench = GUIDE_PROF_CRAFTS.find((c) => c.id === 'enchanting');
    expect(ench?.station).toBeNull();
    expect(ench?.masters).toEqual([]);
    // The stations block mirrors the sim table (six stations, radius 20).
    expect(GUIDE_PROF_STATIONS.radius).toBe(20);
    expect(GUIDE_PROF_STATIONS.stations.map((s) => s.id)).toEqual(STATIONS.map((s) => s.id));
    for (const s of GUIDE_PROF_STATIONS.stations) {
      const def = STATIONS.find((d) => d.id === s.id);
      expect(s.type).toBe(def?.type);
      const master = def ? NPCS[def.masterNpcId] : undefined;
      expect(s.master?.name).toBe(master?.name);
    }
  });

  it('lists the ten archetype pairs with ring-true craft ids', () => {
    expect(GUIDE_PROF_ARCHETYPES).toHaveLength(10);
    const ringIds = new Set(CRAFT_RING.map((c) => c.id));
    for (const a of GUIDE_PROF_ARCHETYPES) {
      expect(a.pairId).toBe(`${a.crafts[0]}+${a.crafts[1]}`);
      for (const id of a.crafts) expect(ringIds.has(id), `pair craft "${id}" off-ring`).toBe(true);
      // Every pair title resolves as a real localized key.
      expect(t(`hudChrome.archetypePair.${a.pairId}` as never).length).toBeGreaterThan(0);
    }
    expect(GUIDE_PROF_ARCHETYPES.some((a) => a.pairId === 'weaponcrafting+armorcrafting')).toBe(
      true,
    );
  });
});

describe('Guide professions gathering accuracy', () => {
  it('covers every gathering profession with grounded caps and bands', () => {
    // Literal list, not a mirror of GATHERING_PROFESSION_IDS: comparing the
    // generated ids against the same array the generator iterates cannot see a
    // trade that never reached the wiki. The mirror below still ties order.
    expect(GUIDE_PROF_GATHERING.map((g) => g.id)).toEqual([
      'mining',
      'logging',
      'herbalism',
      'fishing',
      'farming',
    ]);
    expect(GUIDE_PROF_GATHERING.map((g) => g.id)).toEqual([...GATHERING_PROFESSION_IDS]);
    for (const g of GUIDE_PROF_GATHERING) {
      expect(g.maxSkill).toBe(
        GATHERING_PROFESSIONS[g.id as keyof typeof GATHERING_PROFESSIONS].maxSkill,
      );
      expect(g.bands).toEqual([0, 100, 200]);
    }
    expect(GUIDE_PROF_GATHERING.find((g) => g.id === 'mining')?.maxSkill).toBe(100);
    expect(GUIDE_PROF_GATHERING.find((g) => g.id === 'fishing')?.maxSkill).toBe(200);
    expect(GUIDE_PROF_GATHERING.find((g) => g.id === 'farming')?.maxSkill).toBe(100);
  });

  // Both hub bodies used to spell the trade count into the prose ("four
  // gathering trades"), which made the wiki quietly lie the moment a fifth
  // trade was registered. They are count-free now, and the hub sentence names
  // every trade the sim ships, so a sixth one cannot land without an edit here.
  it('describes the gathering trades count-free and names every one of them', () => {
    setLanguage('en');
    const bodies = [
      ['guide.professions.whatBody', t('guide.professions.whatBody')],
      ['guide.professions.gatherHubBody', t('guide.professions.gatherHubBody')],
    ] as const;
    for (const [key, value] of bodies) {
      expect(value.length, key).toBeGreaterThan(0);
      expect(value, `${key} spells a gathering-trade count`).not.toMatch(/\b(four|five|[45])\b/i);
    }
    const gatherHubBody = t('guide.professions.gatherHubBody');
    for (const id of GATHERING_PROFESSION_IDS) {
      const name = GATHERING_PROFESSIONS[id].name;
      expect(gatherHubBody, `gatherHubBody never names ${name}`).toContain(name);
    }
    // Literal, so the loop above cannot pass vacuously on an empty id list.
    expect(gatherHubBody).toContain('Farming');
  });

  // The farming page once rendered "respawns for you 0 seconds" (the `?? 0`
  // fallback over an empty nodes array) and the full vendor-ladder prose over
  // an empty tools table: invented content on a public page that three data
  // pins and a full gate never saw, because data pins are not page pins. This
  // drives the REAL page render on both sides of the length guard. The Phase
  // 5 hoe ladder flipped farming's tools side: the section is DEMANDED now,
  // while the nodes side stays guarded off forever (farming has no
  // GATHER_NODES by design, fishing-shaped on land), and a synthetic toolless
  // record keeps the guard's absent side exercised.
  it('renders farming with its tool ladder, no node prose, and length-guards empty tables', () => {
    setLanguage('en');
    const farming = GUIDE_PROF_GATHERING.find((g) => g.id === 'farming');
    expect(farming).toBeDefined();
    const html = gatheringDetailHtml(farming as (typeof GUIDE_PROF_GATHERING)[number]);
    expect(html, 'the shipped hoe ladder must render its tools section').toContain(
      'id="prof-tools"',
    );
    expect(html).toContain('Garden Hoe');
    expect(html, 'nodes prose must not render for a nodeless trade').not.toContain(
      'id="prof-nodes"',
    );
    expect(html).toContain('id="prof-rhythm"');
    // The go-live planting-loop section: farming only, and it names the
    // front door and the timer surface a reader needs (both literals, so a
    // reword that drops either fails here rather than on the public page).
    expect(html, 'the farming page must carry its planting-loop section').toContain(
      'id="prof-farm-beds"',
    );
    // The Phase 13 beds-to-table section (the well-fed dishes, the shared
    // feast, the golden harvest): farming-only, like the beds section above.
    expect(html, 'the farming page must carry its beds-to-table section').toContain(
      'id="prof-farm-table"',
    );
    // The deeds ternary's farming branch renders the live farmingSown prose,
    // never the retired no-deeds-yet leaf.
    expect(html).toContain('its own shelf in the Book of Deeds');
    expect(html).not.toContain('keeps no deeds of its own yet');
    // THE (bo) DORMANCY DISCLOSURE, INVERTED at Phase 11e rather than deleted.
    // It used to require BOTH farming prose sections to carry the later-patch
    // idiom, because the tier 3/4 seed faucet was absent and advertising that
    // content as live would have been a lie no purchase-surface sweep could
    // see. GATE 1 shipped the faucet, so the disclosure became the lie, and
    // this pin now guards the other direction: neither section may still tell
    // a player the upper fields are a later patch.
    //
    // Kept as an assertion rather than dropped, for the same reason the deed
    // honesty arm was inverted rather than removed: deleting it would leave
    // nothing saying the prose has to track the faucet, and this is the ONLY
    // guard over hand-authored guide.* prose (tests regenerate and diff
    // content.generated.ts, which cannot see these strings at all).
    expect(
      html.split('comes within reach with a later patch').length - 1,
      'the faucet shipped: no farming section may still disclose dormancy',
    ).toBe(0);
    // ...and the positive half, ONE ANCHOR PER SECTION. The retired pin
    // counted the idiom .toBe(2), which implicitly required BOTH sections to
    // still carry prose; a single anchor would have let the table section be
    // gutted with both assertions still green, so the inversion keeps the
    // per-section coverage its predecessor had rather than only its intent.
    // farmingSown:
    expect(html).toContain('Every Furrow Filled');
    // farm.tableBody. Re-anchored at Phase 11f, which reworded this sentence.
    // The surviving clause is kept as the section's presence anchor...
    expect(html).toContain('leans on the mountain and parterre crops');
    // ...but it CANNOT be the disclosure anchor, and that is the 11e QA lesson
    // restated: it appears verbatim in the pre-11f text too, so the whole
    // correction could revert with this guard green. The anchors below are
    // clauses that exist ONLY in the corrected prose, one per fact 11f moved:
    // the recipes left the trainer, and they are bought with Marks instead.
    expect(html).toContain('no longer taught at any counter');
    expect(html).toContain('bought with Heroic Marks');
    // The same rule for farm.bedsBody's 11f half. Its 11e anchors below are
    // tied to the farmers; these two are tied to the channels 11f ADDED, which
    // nothing else on the page would keep honest if the sentence reverted.
    // Apostrophe-free on purpose: the rendered page escapes it to &#39;, so a
    // possessive anchor would never match the HTML this reads.
    expect(html).toContain('turn up in endgame drops');
    expect(html).toContain('and on the Heroic Quartermaster');
    // farm.bedsBody. THE SECTION THAT ACTUALLY WENT STALE, and until the 11e QA
    // the only section with no anchor tying it to the faucet: its two anchors
    // were Jessica alone, who has stocked the Vale pair since the growth engine
    // shipped, so the sentence GATE 1 rewrote (the one that used to say no
    // counter sells the Highwatch or Evergarden seeds) could have reverted with
    // this guard fully green. Anchored on both upper farmers now, by LIVE name.
    expect(html).toContain('Farmer Jessica');
    // Tied to the live NPC name so a rename cannot leave the page lying.
    expect(html).toContain(NPCS.farmer_jessica.name);
    // The prose names these two by bare first name (Jessica alone gets the
    // "Farmer" form), so tie the bare name to the live NPC name rather than
    // matching the full string: a rename that moves the word still reds.
    for (const [npcId, spoken] of [
      ['farmer_hollis', 'Hollis'],
      ['farmer_verbena', 'Verbena'],
    ] as const) {
      expect(NPCS[npcId].name, `${npcId} name must contain the word the prose uses`).toContain(
        spoken,
      );
      expect(html).toContain(spoken);
    }
    // ...and the prose is tied to the MECHANIC, not just to the names: both
    // counters must really stock the seeds the sentence sends a player to. This
    // is the half a name check cannot give, and the half that was missing.
    for (const npcId of ['farmer_hollis', 'farmer_verbena'] as const) {
      const stocked = NPCS[npcId].vendorItems ?? [];
      const seeds = stocked.filter((id) => id.endsWith('_seed'));
      expect(seeds.length, `${npcId} must stock the seeds bedsBody promises`).toBe(4);
    }
    expect(html).toContain('Harvest Journal');
    expect(html).toContain('withered husks');
    // farm.bedsBody's Phase 11g half, anchored on the ONE fact 11g moved: the
    // produce now has buyers outside farming's own recipes. Same rule as the
    // two 11f anchors above and for the same reason: the surviving clauses of
    // this sentence all appear verbatim in the pre-11g text, so anchoring on
    // any of them would let the correction revert with this guard green.
    // Apostrophe-free, since the rendered page escapes it to &#39;.
    expect(html).toContain('a buyer from the very first rung');
    expect(html).toContain('into the apothecary');
    // AND THE PHASE 11h HALF (added at the 11h QA). The sentence above was
    // still true after 11h and that is exactly why it needed a companion: it
    // enumerates where a farmer's season goes and it stopped at the trainer
    // ladder and the elixir line, both rung-50 surfaces, while 11h routed
    // produce into three cooking-100 plates, three alchemy-100 flasks and both
    // skill-125 capstones. A page that stops at rung 50 tells a farmer their
    // buyers stop there. Anchored on a clause unique to the new sentence, for
    // the reason the 11g anchor above records.
    expect(html).toContain('the last rung of both crafts is bought from a farmer too');
    expect(html).toContain('the Evergarden beds feed the two skill-125 capstone stations');
    // THE NEGATIVE HALF, which the two 11g anchors above lacked (qr-11G-BEDS,
    // Phase 11g QA). A full revert reds on them, but a "supplement rather than
    // replace" edit that re-adds the pre-11g clause beside the new one keeps
    // them green while the page tells a player both that produce only cooks
    // into dishes and that it feeds two trainer ladders. The cooking and
    // alchemy headings already carry their stale forms pinned ABSENT for
    // exactly this reason; this is the same treatment for the farm page.
    expect(html, 'the pre-11g clause must be gone, not merely supplemented').not.toContain(
      'the produce cooks into dishes at the kitchens',
    );
    // The guard itself stays honest on its absent side: a toolless record
    // still renders neither section, never prose over an empty table.
    const toolless = {
      ...(farming as (typeof GUIDE_PROF_GATHERING)[number]),
      tools: [],
      nodes: [],
    };
    const bareHtml = gatheringDetailHtml(toolless);
    expect(bareHtml, 'tools prose must not render for a toolless trade').not.toContain(
      'id="prof-tools"',
    );
    expect(bareHtml, 'nodes prose must not render for a nodeless trade').not.toContain(
      'id="prof-nodes"',
    );
    const mining = GUIDE_PROF_GATHERING.find((g) => g.id === 'mining');
    const miningHtml = gatheringDetailHtml(mining as (typeof GUIDE_PROF_GATHERING)[number]);
    expect(miningHtml, 'the guard is length-based: a full trade keeps tools').toContain(
      'id="prof-tools"',
    );
    expect(miningHtml, 'the guard is length-based: a full trade keeps nodes').toContain(
      'id="prof-nodes"',
    );
    expect(miningHtml, 'the planting loop is farming-only prose').not.toContain(
      'id="prof-farm-beds"',
    );
    expect(miningHtml, 'the beds-to-table section is farming-only prose').not.toContain(
      'id="prof-farm-table"',
    );
    // The deeds ternary's other branch: a non-farming trade still renders its
    // own gatherDeeds leaf.
    expect(miningHtml).toContain('Ore in the Blood');
    // The dormancy disclosure is farming-only prose: its phrase leaking into
    // another trade's page would mean the shared builder grew a wrong branch.
    expect(miningHtml).not.toContain('comes within reach with a later patch');
  });

  // Master Gatherer's trigger counts every registered trade (src/sim/deeds.ts
  // filters GATHERING_PROFESSION_IDS), so prose that enumerates the roster goes
  // stale the moment a trade joins. It went stale twice, on fishing and again
  // on farming, so the enumerating form is banned outright rather than patched
  // a third time. tests/deeds_content.test.ts owns the trigger itself; this
  // pins the player-visible strings that describe it.
  it('never enumerates the Master Gatherer roster in the deed prose', () => {
    setLanguage('en');
    for (const id of GATHERING_PROFESSION_IDS) {
      const body = t(`guide.profPages.gatherDeeds.${id}` as never);
      expect(body.length, id).toBeGreaterThan(0);
      expect(body, `gatherDeeds.${id} enumerates the gathering roster`).not.toMatch(
        /any three of/i,
      );
    }
    expect(DEEDS.prog_master_gatherer.desc).toBe(
      'Reach 100 proficiency in any three gathering trades.',
    );
  });

  it('aggregates every world node into its zone row (tool tier = node tier)', () => {
    const typeFor: Record<string, string> = { mining: 'ore', logging: 'wood', herbalism: 'herb' };
    for (const g of GUIDE_PROF_GATHERING) {
      if (g.id === 'fishing') continue;
      if (g.id === 'farming') {
        // Farming has no GATHER_NODES rows by design (fishing-shaped on land:
        // beds are patch content, never nodes), so the node aggregation stays
        // EMPTY on purpose and no respawn number ever publishes. The tool
        // ladder is the aggregation's real farming output since the Phase 5
        // hoes: the four rungs, rung 1 the only priced one (seated on the
        // tier-1 farmer NPC since the go-live; the row-by-row mirror below
        // owns the rest of the fields).
        expect(g.nodes).toEqual([]);
        expect((g.tools ?? []).map((tool) => [tool.name, tool.tier, tool.priceCopper])).toEqual([
          ['Garden Hoe', 1, 20],
          ['Bronze Hoe', 2, null],
          ['Skysilver Hoe', 3, null],
          ['Osmium Hoe', 4, null],
        ]);
        expect(g.respawnSeconds).toBeUndefined();
        continue;
      }
      const simNodes = GATHER_NODES.filter((n) => n.type === typeFor[g.id]);
      const total = (g.nodes ?? []).reduce((sum, row) => sum + row.count, 0);
      expect(total, `${g.id} node count drifted`).toBe(simNodes.length);
      for (const row of g.nodes ?? []) {
        expect(row.toolTier).toBe(row.tier);
        const zone = ZONES.find((z) => z.name === row.zone);
        expect(zone, `node row zone "${row.zone}" is not a real zone`).toBeDefined();
        const simCount = simNodes.filter(
          (n) => n.zoneId === zone?.id && n.tier === row.tier,
        ).length;
        expect(row.count).toBe(simCount);
      }
      // Re-minted from 120 alongside the node-count expansion: the wiki prints
      // this straight out of NODE_HARVEST_TABLE, and the two moved together so
      // the per-zone harvest ceiling stayed flat (gathering.ts).
      expect(g.respawnSeconds).toBe(240);
    }
    // Spot pin: Thornpeak ships two tier-3 nodes per gathering type. Was one,
    // and doubled with the respawn so a tier-3 gatherer's rate held; the number
    // matters here because tier 3 is the only tier that finishes the climb to
    // proficiency 100.
    const mining = GUIDE_PROF_GATHERING.find((g) => g.id === 'mining');
    const t3 = mining?.nodes?.find((n) => n.tier === 3);
    expect(t3).toEqual({
      zone: 'Thornpeak Heights',
      tier: 3,
      toolTier: 3,
      count: 2,
      material: 'Osmium Ore',
    });
  });

  it('mirrors the tool and rod ladders with live vendor prices', () => {
    // Every gatherTool ItemDef appears exactly once, in its own profession's
    // ladder, with the def's tier/quality/buyValue.
    for (const [itemId, def] of Object.entries(ITEMS)) {
      const use = def.use;
      if (use?.type !== 'gatherTool') continue;
      const ladder = GUIDE_PROF_GATHERING.find((g) => g.id === use.professionId);
      const rows = (ladder?.tools ?? []).filter((tool) => tool.name === def.name);
      expect(rows, `tool "${itemId}" missing from its ladder`).toHaveLength(1);
      expect(rows[0].tier).toBe(use.tier);
      expect(rows[0].quality).toBe(def.quality ?? 'common');
      expect(rows[0].priceCopper).toBe(def.buyValue ?? null);
      if (def.buyValue != null) {
        // Every vendor-priced tool has a counter, the farming garden hoe
        // included since the go-live seated it on the tier-1 farmer (the
        // priced-but-unstocked narrowing this branch used to carry is gone;
        // tests/professions_zone_rollout.test.ts pins the farmer stock).
        const stocked = Object.values(NPCS).some((n) => n.vendorItems?.includes(itemId));
        expect(stocked, `vendor tool "${itemId}" is stocked by no NPC`).toBe(true);
        expect(rows[0].vendors.length).toBeGreaterThan(0);
      } else {
        expect(rows[0].craftedBy).toBe(
          ALL_RECIPES.find((r) => r.resultItemId === itemId)?.professionId,
        );
      }
      // R22 wield column: land tools above tier 1 publish the frozen wield
      // requirement; tier 1 and every fishing rod publish none (rods are the
      // structural exemption, wield_gate.ts). This is a MIRROR (generator and
      // expectation both read the same constants); the absolute literal pins
      // live in tests/professions_tool_gate.test.ts (85/100) and
      // tests/delve_shop.test.ts (24/56 and every gate).
      if (use.professionId !== 'fishing' && use.tier >= 2) {
        expect(rows[0].wieldProficiency, `${itemId} wield requirement`).toBe(
          WIELD_REQUIREMENT_BY_TIER[use.tier],
        );
      } else {
        expect(rows[0].wieldProficiency, `${itemId} must publish no wield`).toBeUndefined();
      }
      // The Marks route publishes its clears gate exactly as the delve
      // counter enforces it, and the tier-4 rows all sit on clears:3, which
      // is what keeps the English "three delve clears" in
      // guide.profPages.toolCraftedOrMarks honest.
      const shopRows = Object.values(DELVE_SHOPS)
        .flat()
        .filter((e) => e.itemId === itemId);
      // First-match-wins on both sides (the generator's marksRowFor scans the
      // same way), so a tool stocked twice at different gates would agree
      // invisibly: require uniqueness before trusting the mirror.
      expect(shopRows.length, `${itemId} must appear on at most one delve counter`).toBeLessThan(2);
      const shopRow = shopRows[0];
      if (shopRow) {
        expect(rows[0].priceMarks, `${itemId} Marks price`).toBe(shopRow.marks);
        if (shopRow.gate === 'heroicClear') {
          expect(rows[0].marksHeroicClear, `${itemId} heroic gate`).toBe(true);
          expect(rows[0].marksClears).toBeUndefined();
        } else {
          expect(shopRow.gate, `${itemId} gate must be the pinned clears rung`).toBe('clears:3');
          expect(rows[0].marksClears, `${itemId} clears gate`).toBe(3);
          expect(rows[0].marksHeroicClear).toBeUndefined();
        }
      } else {
        expect(rows[0].priceMarks).toBeUndefined();
        expect(rows[0].marksClears).toBeUndefined();
        expect(rows[0].marksHeroicClear).toBeUndefined();
      }
    }
    // The rod ladder: simple pole tier 1, Ironreel t2 at 60c, Silverstream t3
    // at 150c, all bought; Stormreel t4 and Tidewrought t5 crafted, so they
    // carry no price at all.
    const fishing = GUIDE_PROF_GATHERING.find((g) => g.id === 'fishing');
    expect(fishing?.tools.map((tool) => [tool.name, tool.tier, tool.priceCopper])).toEqual([
      ['Simple Fishing Pole', 1, 20],
      ['Ironreel Fishing Rod', 2, 60],
      ['Silverstream Fishing Rod', 3, 150],
      ['Stormreel Fishing Rod', 4, null],
      ['Tidewrought Fishing Rod', 5, null],
    ]);
    // Every rung says where it comes from, and the two routes are exclusive:
    // a bought rod names a counter, a crafted one names the craft that makes
    // it. Before the crafted rods existed this loop demanded a vendor for
    // every row, which a crafted rod can never satisfy.
    let bought = 0;
    let crafted = 0;
    for (const rod of fishing?.tools ?? []) {
      if (rod.priceCopper === null) {
        expect(rod.vendors, `${rod.name} is crafted and must be on no counter`).toEqual([]);
        // The published row carries no item id, so the recipe is resolved
        // through the display name the row does carry.
        expect(rod.craftedBy, `${rod.name} must name its craft`).toBe(
          ALL_RECIPES.find((r) => ITEMS[r.resultItemId]?.name === rod.name)?.professionId,
        );
        expect(rod.craftedBy).toBe('engineering');
        crafted += 1;
      } else {
        expect(
          rod.vendors.some((v) => v.name === 'Trader Wilkes' || v.name === 'Fisherman Brandt'),
          `${rod.name} must name its stockist`,
        ).toBe(true);
        bought += 1;
      }
      // Each bought rung above the first is also sold in the zone whose water
      // asks for it, so no zone demands tackle no local counter carries.
      if (rod.tier === 2) {
        expect(
          rod.vendors.some((v) => v.name === 'Provisioner Hale'),
          'the marsh must stock the rod its own water takes',
        ).toBe(true);
      }
      if (rod.tier === 3) {
        expect(
          rod.vendors.some((v) => v.name === 'Quartermaster Bree'),
          'the peaks must stock the rod their own water takes',
        ).toBe(true);
      }
    }
    expect([bought, crafted]).toEqual([3, 2]);
  });

  it('publishes the tool-gate thresholds through placeholders in EVERY locale', () => {
    // The tools note states the two gate thresholds. It takes them as {tier2} /
    // {tier3} rather than as literals so a retune moves the published prose in
    // all 19 languages at once; a fill that dropped the tokens would republish
    // frozen numbers, and nothing else would notice, because the value would
    // still be present and translated.
    setLanguage('en');
    const en = t('guide.profPages.toolsNote', {
      tier2Prof: String(TIER2_TOOL_GATE_PROFICIENCY),
      tier3Prof: String(TIER3_TOOL_GATE_PROFICIENCY),
    });
    expect(en).toContain(String(TIER2_TOOL_GATE_PROFICIENCY));
    expect(en).toContain(String(TIER3_TOOL_GATE_PROFICIENCY));
    expect(en, 'no token left unspliced').not.toMatch(/\{[A-Za-z0-9_]+\}/);
    // The crafted rungs' thresholds ride the prose as ENGLISH LITERALS (the
    // long-translated key keeps its token set, R64), so pin the exact
    // crafted-rung clause to the frozen wield table: a retune fails here
    // instead of rotting in the prose, and the clause scope keeps an
    // unrelated 100 elsewhere in the note from ever satisfying this.
    expect(en).toContain(
      `${TIER4_TOOL_WIELD_PROFICIENCY} and ${TIER5_TOOL_WIELD_PROFICIENCY} for the two crafted rungs`,
    );
    // The Marks-route cells name their gates as English words, so tie the
    // wording to the live gate IN THE SAME BREATH: if the delve counter's
    // tier-4 rung ever leaves clears:3, this line reds together with the
    // wording below, not in a different test a fixer can satisfy alone.
    expect(
      Object.values(DELVE_SHOPS)
        .flat()
        .find((e) => e.itemId === 'thorium_mining_pick')?.gate,
    ).toBe('clears:3');
    // The delve name in the wording derives from the shipped delve, so a sim
    // rename reds this pin against the prose literal instead of rotting six
    // English strings plus five locale fills with a green suite (R66).
    const litany = GUIDE_DELVES.find((d) => d.id === 'drowned_litany')?.name.replace(/^The /, '');
    expect(litany, 'the Litany ships under its known name').toBe('Drowned Litany');
    expect(t('guide.profPages.toolCraftedOrMarks', { craft: 'X', marks: '24' })).toContain(
      `three ${litany} clears`,
    );
    expect(t('guide.profPages.toolCraftedOrMarksHeroic', { craft: 'X', marks: '56' })).toContain(
      `Heroic ${litany} clear`,
    );

    // Every shipped locale, read off the resolved bundles: both tokens present
    // AND neither threshold spelled out as a literal. The second half is what a
    // reword silently leaves behind, since the row stays "translated" and no
    // i18n gate ever marks it pending.
    const dir = resolve(process.cwd(), 'src/ui/i18n.resolved.generated');
    // Locale bundles only: the directory also holds the barrel, the lazy
    // loader map, and the pending slice.
    const INFRA = new Set(['index.ts', 'loaders.ts', 'pending.ts']);
    const locales = readdirSync(dir).filter((f) => f.endsWith('.ts') && !INFRA.has(f));
    expect(locales.length).toBeGreaterThan(15);
    for (const file of locales) {
      const source = readFileSync(`${dir}/${file}`, 'utf8');
      const at = source.indexOf('toolsNote');
      expect(at, `${file} carries toolsNote`).toBeGreaterThan(-1);
      // Bounded by the value's own line, not a magic width: a window wider
      // than the longest translation reaches into following keys, and the
      // direction of that looseness is a FALSE PASS.
      const lineEnd = source.slice(at).indexOf('\n');
      const value = source.slice(at, lineEnd === -1 ? undefined : at + lineEnd);
      expect(value, `${file} keeps {tier2Prof}`).toContain('{tier2Prof}');
      expect(value, `${file} keeps {tier3Prof}`).toContain('{tier3Prof}');
      // The half a placeholder check alone cannot see: a fill that spelled the
      // numbers out would keep the tokens elsewhere in the sentence and still
      // publish frozen values. Neither threshold may appear as a literal.
      const withoutTokens = value.replace(/\{[^}]*\}/g, '');
      // Whole-number match, not a substring: an unrelated figure that merely
      // CONTAINS the threshold digits (a 240-second respawn, say) must not trip
      // this, or a future prose edit fails for the wrong reason.
      for (const threshold of [TIER2_TOOL_GATE_PROFICIENCY, TIER3_TOOL_GATE_PROFICIENCY]) {
        expect(withoutTokens, `${file} spells out ${threshold}`).not.toMatch(
          new RegExp(`(^|[^0-9])${threshold}([^0-9]|$)`),
        );
      }
    }
  });

  it('publishes the exact fishing rhythm, gain schedule, and per-band tables', () => {
    const f = GUIDE_PROF_GATHERING.find((g) => g.id === 'fishing')?.fishing;
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.biteMinSec).toBe(3);
    expect(f.biteMaxSec).toBe(8);
    expect(f.rodBiteReductionSec).toBe(1.5);
    expect(f.reelWindowSec).toBe(2.5);
    expect(f.reelRodBonusSec).toBe(0.75);
    expect(f.sessionCapSec).toBe(15);
    // The biteBody prose quotes DERIVED figures (worst wait and reel window
    // per rod tier) as English literals; derive them here from the published
    // constants so a rhythm retune reds the prose too, not just the numbers
    // above (the QA lens found the derivations otherwise unpinned).
    setLanguage('en');
    const bite = t('guide.profPages.fish.biteBody', {
      min: '3',
      max: '8',
      reel: '2.5',
      cap: '15',
      rod: '1.5',
      reelRod: '0.75',
    });
    expect(bite).toContain(`down to ${f.biteMaxSec - f.rodBiteReductionSec} seconds`);
    expect(bite).toContain(`${f.reelWindowSec + f.reelRodBonusSec} second window`);
    expect(bite).toContain(`the Silverstream to ${f.biteMaxSec - 2 * f.rodBiteReductionSec} with`);
    expect(f.schedule).toEqual(
      FISHING_GAIN_SCHEDULE.map((row) => ({ below: row.belowProficiency, gain: row.gain })),
    );
    expect(f.schedule).toEqual([
      { below: 50, gain: 1 },
      { below: 100, gain: 0.5 },
      { below: 150, gain: 0.1 },
      { below: 200, gain: 0.02 },
    ]);
    expect(f.junkCutoff).toBe(100);
    expect(f.rareCatch).toBe('Sunglint Koi');
    // Band tables mirror the sim tables row for row; weights sum to exactly
    // 100 per table, so the published pct IS the real probability; band b
    // needs rod tier b + 1.
    expect(f.bandTables).toHaveLength(FISHING_TABLES_BY_BAND.length);
    for (const [band, byZone] of FISHING_TABLES_BY_BAND.entries()) {
      const pub = f.bandTables[band];
      expect(pub.rodTierRequired).toBe(band + 1);
      expect(pub.minProficiency).toBe([0, 100, 200][band]);
      for (const [zoneId, rows] of Object.entries(byZone)) {
        const zoneName = ZONES.find((z) => z.id === zoneId)?.name ?? zoneId;
        const pubZone = pub.zones.find((z) => z.zone === zoneName);
        expect(pubZone, `band ${band} missing zone ${zoneId}`).toBeDefined();
        expect(pubZone?.rows).toEqual(
          rows.map((r) => ({
            name: r.itemId ? ITEMS[r.itemId].name : null,
            pct: r.weight,
            quality: r.itemId ? (ITEMS[r.itemId].quality ?? 'common') : null,
          })),
        );
        expect(pubZone?.rows.reduce((sum, r) => sum + r.pct, 0)).toBe(100);
      }
    }
    // The koi odds are the one row that reads skill and nothing else: the same
    // 1 / 3 / 6 percent in every zone, rising with the band.
    let koiRowsChecked = 0;
    for (const [band, published] of f.bandTables.entries()) {
      for (const zone of published.zones) {
        const koi = zone.rows.find((r) => r.name === 'Sunglint Koi');
        expect(koi?.pct, `${zone.zone} band ${band}`).toBe([1, 3, 6][band]);
        koiRowsChecked += 1;
      }
    }
    expect(koiRowsChecked).toBe(9);
  });

  it('publishes the exact shared curve, cast, and rare-event numbers', () => {
    const c = GUIDE_PROF_CURVE;
    expect(c.tierStep).toBe(TIER_SKILL_STEP);
    expect(c.multipliers).toEqual({ full: 1, reduced: 0.5, minimal: 0.25, none: 0 });
    expect(c.gatherTierStep).toBe(GATHER_GAIN_TIER_STEP);
    expect(c.cast).toEqual({
      baseSec: GATHER_CAST_BASE_SEC,
      floorSec: GATHER_CAST_FLOOR_SEC,
      toolTierReductionSec: GATHER_CAST_TOOL_TIER_REDUCTION_SEC,
      bandReductionSec: GATHER_CAST_BAND_REDUCTION_SEC,
    });
    expect(c.cast).toEqual({
      baseSec: 2.5,
      floorSec: 1.5,
      toolTierReductionSec: 0.4,
      bandReductionSec: 0.15,
    });
    expect(c.rareEvent.oneIn).toBe(Math.round(1 / GATHER_RARE_EVENT_CHANCE));
    expect(c.rareEvent.oneIn).toBe(90);
    expect(c.rareEvent.yieldMult).toBe(GATHER_RARE_EVENT_YIELD_MULT);
    expect(c.rareEvent.yieldMult).toBe(5);
    expect(c.rareEvent.flavors).toEqual({
      ore: 'pristine_vein',
      wood: 'ancient_heartwood',
      herb: 'moonlit_bloom',
    });
    // The corpse specimen chance: the rare+ share of the corpse rarity roll
    // at its fixed baseline (40 * 0.4 / 100 = 16 percent).
    expect(c.specimenChancePct).toBe(16);
  });

  it('ties the gatherDeeds prose counts to the deed catalog (phase 24)', () => {
    // The two per-zone deed families the gatherDeeds prose counts. A new zone
    // that authors either deed (the zone-4 pass) moves the count here and must
    // reword the prose in the same change, or these arms go red.
    const firstCast = Object.values(DEEDS).filter(
      (d) => d.trigger.kind === 'visit' && d.trigger.markId.startsWith('fish:'),
    );
    const chronicles = Object.values(DEEDS).filter(
      (d) =>
        d.trigger.kind === 'visits' &&
        d.trigger.markIds.length > 0 &&
        d.trigger.markIds.every((m) => m.startsWith('gather:')),
    );
    const words: Record<number, string> = {
      5: 'five',
      6: 'six',
      7: 'seven',
      8: 'eight',
      12: 'twelve',
    };
    const castWord = words[firstCast.length];
    expect(castWord, `unmapped first-cast count ${firstCast.length}`).toBeDefined();
    expect(guideStrings.profPages.gatherDeeds.fishing).toContain(
      `each of ${castWord} zones' waters`,
    );
    const chronWord = words[chronicles.length];
    expect(chronWord, `unmapped gatherer-chronicle count ${chronicles.length}`).toBeDefined();
    const chronSentence = `${(chronWord as string)[0].toUpperCase()}${(chronWord as string).slice(1)} zones keep a gatherer's chronicle page apiece`;
    for (const trade of ['mining', 'logging', 'herbalism'] as const) {
      expect(guideStrings.profPages.gatherDeeds[trade]).toContain(chronSentence);
    }
  });
});

describe('Guide professions enchanting and economy accuracy', () => {
  it('mirrors the enchant table, tiered structurally from the reagents', () => {
    const e = GUIDE_PROF_ENCHANTING;
    expect(e.enchants.map((row) => row.id).sort()).toEqual(Object.keys(ENCHANTS).sort());
    for (const row of e.enchants) {
      const def = ENCHANTS[row.id];
      expect(row.name).toBe(def.name);
      expect(row.slot).toBe(def.itemSlot);
      expect(row.reagents).toEqual(
        def.reagents.map((g) => ({ name: ITEMS[g.itemId].name, count: g.count })),
      );
      expect(row.bonus).toEqual(
        Object.entries(def.statBonus).map(([stat, value]) => ({ stat, value })),
      );
      // Tier is structural, top down: lucent_reagent = Lucent (the apex tier,
      // whose enchants also carry a shard or dust from the tier below, so the
      // apex test has to come first), shard = Greater, typed secondary = Runed.
      const hasLucent = def.reagents.some((g) => g.itemId === 'lucent_reagent');
      const hasShard = def.reagents.some((g) => g.itemId === 'arcane_shard');
      expect(row.tier === 'lucent').toBe(hasLucent);
      expect(row.tier === 'greater').toBe(!hasLucent && hasShard);
    }
    // The five Runed consumer enchants (the only typed-secondary sink).
    expect(
      e.enchants
        .filter((row) => row.tier === 'runed')
        .map((row) => row.id)
        .sort(),
    ).toEqual([
      'enchant_chest_runeweave',
      'enchant_helmet_runed_links',
      'enchant_legs_runed_hide',
      'enchant_weapon_runed_edge',
      'enchant_weapon_runed_focus',
    ]);
    expect(e.enchants.filter((row) => row.tier === 'greater')).toHaveLength(6);
    // The five Lucent (apex) enchants: the phase 10 quartet plus the weapon
    // int twin the phase 10 QA D10-D1 ruling added at the head of phase 11.
    expect(
      e.enchants
        .filter((row) => row.tier === 'lucent')
        .map((row) => row.id)
        .sort(),
    ).toEqual([
      'enchant_chest_lucent_stamina',
      'enchant_feet_lucent_agility',
      'enchant_lucent_infusion',
      'enchant_weapon_lucent_might',
      'enchant_weapon_lucent_spellpower',
    ]);
  });

  it('mirrors the disenchant, typed-secondary, and salvage yield maps', () => {
    const e = GUIDE_PROF_ENCHANTING;
    expect(e.disenchantByQuality).toEqual(
      Object.entries(DISENCHANT_MATERIAL_BY_QUALITY).map(([quality, m]) => ({
        quality,
        material: ITEMS[m].name,
      })),
    );
    expect(e.disenchantByQuality).toEqual([
      { quality: 'common', material: 'Chime Dust' },
      { quality: 'uncommon', material: 'Chime Dust' },
      { quality: 'rare', material: 'Chime Essence' },
      { quality: 'epic', material: 'Chime Shard' },
      { quality: 'legendary', material: 'Chime Shard' },
    ]);
    expect(e.typedSecondaries.armor).toEqual(
      Object.entries(ARMOR_SECONDARY_BY_TYPE).map(([armorType, m]) => ({
        armorType,
        material: ITEMS[m].name,
      })),
    );
    expect(e.typedSecondaries.meleeWeapons).toBe(ITEMS.resonant_steel.name);
    expect(e.typedSecondaries.timberWeapons.material).toBe(ITEMS.resonant_timber.name);
    expect(e.typedSecondaries.timberWeapons.families).toEqual([...TIMBER_WEAPON_TYPES].sort());
    expect(e.typedSecondaries.counts).toEqual({ rare: 1, epicMin: 1, epicMax: 2 });
    expect(e.salvageByQuality).toEqual(
      Object.entries(SALVAGE_MATERIAL_BY_QUALITY).map(([quality, m]) => ({
        quality,
        material: ITEMS[m].name,
      })),
    );
  });

  it('publishes the exact fees, masterwork odds, and market cut', () => {
    const e = GUIDE_PROF_ECONOMY;
    expect(e.craftFeeCopperPerBudgetPoint).toBe(CRAFT_GOLD_SINK_COPPER_PER_BUDGET);
    expect(e.craftFeeCopperPerBudgetPoint).toBe(2);
    // Craft Cast System Phase 5: shared actionThrottle removed from guide data.
    expect('actionThrottle' in e).toBe(false);
    expect(e.marketCutPct).toBe(Math.round(MARKET_CUT * 100));
    expect(e.marketCutPct).toBe(5);
    expect(e.listingDepositCopper).toBe(MARKET_LISTING_DEPOSIT_COPPER);
    expect(e.listingDepositCopper).toBe(0);
    expect(e.trainingFeeCopperByTier).toEqual([...TRAINING_FEE_BY_TIER]);
    expect(e.trainingFeeCopperByTier).toEqual([0, 2500, 10000, 40000, 160000]);
    expect(e.unbindFeeCopper).toEqual({
      uncommon: UNBIND_FEE_BY_QUALITY_TIER[0],
      rare: UNBIND_FEE_BY_QUALITY_TIER[1],
      epic: UNBIND_FEE_BY_QUALITY_TIER[2],
    });
    expect(e.unbindFeeCopper).toEqual({ uncommon: 2500, rare: 10000, epic: 40000 });
    const mw = GUIDE_PROF_MASTERWORK;
    expect(mw.basePct).toBe(Math.round(MASTERWORK_BASE_CHANCE * 100));
    expect(mw.perTierAbovePct).toBe(Math.round(MASTERWORK_PER_TIER_ABOVE_CHANCE * 100));
    expect(mw.signedReagentPct).toBe(Math.round(MASTERWORK_SIGNED_CHANCE * 100));
    expect(mw.specializedPct).toBe(Math.round(MASTERWORK_SPECIALIZATION_CHANCE * 100));
    expect(mw.capPct).toBe(Math.round(MASTERWORK_CHANCE_CAP * 100));
    expect(mw).toEqual({
      basePct: 3,
      perTierAbovePct: 1,
      signedReagentPct: 2,
      specializedPct: 3,
      capPct: 15,
    });
  });

  it('lists every work order on the shared cadence, coin matching the payout formula', () => {
    const wo = GUIDE_PROF_ECONOMY.workOrders;
    expect(wo.cadenceMinutes).toBe(WORK_ORDER_CADENCE_TICKS / 20 / 60);
    expect(wo.cadenceMinutes).toBe(30);
    // Literal arm first so the constant-derived checks below are never
    // self-referential: the fraction itself is the pinned contract.
    expect(WORK_ORDER_PAYOUT_FRACTION).toBe(0.5);
    expect(wo.payoutPctOfVendorValue).toBe(WORK_ORDER_PAYOUT_FRACTION * 100);
    expect(wo.payoutPctOfVendorValue).toBe(50);
    const simOrders = Object.values(QUESTS).filter(
      (q) =>
        q.repeatCadenceTicks === WORK_ORDER_CADENCE_TICKS &&
        (q.objectives ?? []).length > 0 &&
        q.objectives.every((o) => o.type === 'collect'),
    );
    expect(simOrders.length).toBeGreaterThanOrEqual(6);
    expect(wo.orders.map((o) => o.id).sort()).toEqual(simOrders.map((q) => q.id).sort());
    for (const order of wo.orders) {
      const quest = QUESTS[order.id];
      const obj = quest.objectives[0];
      expect(obj.type).toBe('collect');
      if (obj.type !== 'collect') continue;
      expect(order.name).toBe(quest.name);
      expect(order.master).toBe(NPCS[quest.giverNpcId]?.name ?? '');
      expect(order.count).toBe(obj.count);
      expect(order.material).toBe(ITEMS[obj.itemId].name);
      // The payout formula, from the sim's own constant
      // (its 0.5 value is literal-pinned above).
      const vendorValue = (ITEMS[obj.itemId].sellValue ?? 0) * obj.count;
      expect(order.coinCopper, `work order "${order.id}" coin off-formula`).toBe(
        Math.floor(WORK_ORDER_PAYOUT_FRACTION * vendorValue),
      );
      expect(order.coinCopper).toBe(quest.copperReward ?? 0);
    }
  });
});

describe('Guide professions pages and routes', () => {
  const ctx = (params: string[]) => ({
    params,
    sub: 'professions',
    titleKey: 'guide.nav.professions' as const,
  });

  it('derives the detail-page list from the generated data', () => {
    expect(GUIDE_PROF_PAGES).toEqual([
      ...GUIDE_PROF_CRAFTS.map((c) => c.id),
      ...GUIDE_PROF_GATHERING.map((g) => g.id),
      'economy',
      'faq',
    ]);
  });

  it('renders every detail page with exactly one h1 and real generated tables', () => {
    setLanguage('en');
    for (const id of GUIDE_PROF_PAGES) {
      const html = professionsPage.render(ctx([id]));
      expect((html.match(/<h1>/g) ?? []).length, `page "${id}" h1 count`).toBe(1);
      expect(html).not.toContain('guide-notfound');
    }
    // The tool table's Use at column renders end to end: the header cell, the
    // wield numbers, the ungated fallback, and BOTH Marks-gate source cells
    // (the data-level mirror above cannot see a header/cell desync or a
    // swapped gate string; this can).
    const mining = professionsPage.render(ctx(['mining']));
    expect(mining).toContain(`<th scope="col">${t('guide.profPages.colWield')}</th>`);
    expect(mining).toContain(`<td>${t('guide.profPages.wieldNone')}</td>`);
    // Tie each gate WORDING to its own tool's row, not just to the page: a
    // swapped heroic/clears key pair in toolSource keeps both strings on the
    // page (mining has one tool at each gate) and only a per-row assertion
    // reds on the inversion.
    const rowFor = (name: string): string =>
      mining.match(
        new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`),
      )?.[0] ?? '';
    // Delve name derived as in the wording pin above: a sim rename must red
    // these rows rather than leave stale prose green.
    const litanyRow = GUIDE_DELVES.find((d) => d.id === 'drowned_litany')?.name.replace(
      /^The /,
      '',
    );
    expect(rowFor('Osmium Mining Pick'), 'tier-4 row names its clears gate').toContain(
      `three ${litanyRow} clears`,
    );
    expect(rowFor('Glyphsteel Mining Pick'), 'tier-5 row names its Heroic gate').toContain(
      `Heroic ${litanyRow} clear`,
    );
    // The rendered wield NUMBER in its own COLUMN, not just the artifact
    // field: the data mirror pins the corpus, so a page that renders the
    // wrong value in the cell would otherwise ship silently (the QA mutation
    // pass proved it), and a bare toContain would survive a column swap. The
    // Use at column is the fourth cell (Tool, Tier, Quality, Use at, ...).
    const wieldCell = (name: string): string =>
      rowFor(name).match(/<td[^>]*>[\s\S]*?<\/td>/g)?.[3] ?? '';
    expect(wieldCell('Osmium Mining Pick'), 'tier-4 wield column holds its number').toBe(
      `<td>${TIER4_TOOL_WIELD_PROFICIENCY}</td>`,
    );
    expect(wieldCell('Glyphsteel Mining Pick'), 'tier-5 wield column holds its number').toBe(
      `<td>${TIER5_TOOL_WIELD_PROFICIENCY}</td>`,
    );
    // Two guide-prof-tables render on the page (nodes first, tools second);
    // anchor on the Use at header so the parity check reads the TOOLS table.
    const toolsTable = mining
      .split('<table')
      .find((seg) => seg.includes(`<th scope="col">${t('guide.profPages.colWield')}</th>`));
    expect(toolsTable, 'tools table present').toBeDefined();
    const thCount = (toolsTable?.match(/<thead><tr>([\s\S]*?)<\/tr>/)?.[1].match(/<th[\s>]/g) ?? [])
      .length;
    expect(thCount, 'header column count').toBe(6);
    // EVERY body row, not just the first: a conditional cell in a later row
    // would slip past a first-row-only parity check.
    const bodyRows =
      toolsTable?.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    // Exact row count from the corpus, not a floor: a table collapsing to one
    // row must red, and the corpus mirror above pins the corpus to ITEMS.
    expect(bodyRows.length, 'tools table renders every ladder rung').toBe(
      GUIDE_PROF_GATHERING.find((g) => g.id === 'mining')?.tools.length,
    );
    for (const row of bodyRows) {
      expect((row.match(/<td/g) ?? []).length, 'body row column count agrees with header').toBe(6);
    }
    // The mobile min-width floor is a two-sided contract: the markup carries
    // the scoped class and the guide stylesheet declares a min-width for it.
    // src/guide/styles.css sits outside every src/styles CSS guard, so this
    // is its one pin (the fix round scoped the floor away from the shared
    // .guide-prof-table after it crushed narrow tables).
    expect(toolsTable, 'tools table carries its scoped width class').toContain('guide-tools-table');
    const guideCss = readFileSync(resolve(process.cwd(), 'src/guide/styles.css'), 'utf8');
    expect(guideCss).toMatch(/\.guide-tools-table\s*\{[^}]*min-width:/);
    // The craft page really renders its recipe rows.
    const weapon = professionsPage.render(ctx(['weaponcrafting']));
    expect(weapon).toContain('Osmium Warblade');
    expect((weapon.match(/class="guide-prof-recipe/g) ?? []).length).toBe(
      GUIDE_PROF_CRAFTS.find((c) => c.id === 'weaponcrafting')?.recipes.length,
    );
    // The MATERIAL entries carry the same two-sided contract as the tools table
    // above, and for a sharper reason (qr-11G-MATCELL, Phase 11g QA):
    // materialsCell joins its spans with NO separator at all, so the cell reads
    // glued unless the stylesheet separates them. That is the defect the
    // .guide-prof-combo comment in src/guide/styles.css records having shipped
    // once already, and this sheet sits outside every src/styles CSS guard, so
    // this is its only pin. Both sides asserted: the markup emits the scoped
    // class, and the sheet declares the adjacent-sibling separation.
    expect(weapon, 'recipe rows carry the scoped material class').toContain('guide-prof-mat');
    expect(guideCss, 'the joined material entries must be separated by the stylesheet').toMatch(
      /\.guide-prof-mat\s*\+\s*\.guide-prof-mat\s*\{[^}]*margin-inline-start:/,
    );
    // The RENDERED source cell for a drop-taught apex row (phase 08): the
    // data-level mirror pins 'drop' in the corpus, but only a render pin can
    // see sourceCell routing the value to the wrong string (the old two-arm
    // mapping shipped "Known from the start" for every drop row and stayed
    // green). Row-scoped so a page that renders the string elsewhere cannot
    // satisfy it; the trainer arm keeps its own row as the contrast.
    const armor = professionsPage.render(ctx(['armorcrafting']));
    const armorRowFor = (name: string): string =>
      armor.match(
        new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`),
      )?.[0] ?? '';
    expect(armorRowFor('Forgefold Legguards'), 'apex row renders the drop source string').toContain(
      t('guide.profPages.sourceDrop'),
    );
    expect(armorRowFor('Forgefold Legguards')).not.toContain(t('guide.profPages.sourceKnown'));
    // ...and it is really the DROP-ONLY string, not the both-channel one. The
    // toContain above cannot tell them apart on its own: sourceDrop is a proper
    // PREFIX of sourceDropAndVendor, so a generator that labelled every drop row
    // as both would satisfy it. This is the arm that says which.
    expect(
      armorRowFor('Forgefold Legguards'),
      'a drop-only row must not claim the marks counter too',
    ).not.toContain(t('guide.profPages.sourceDropAndVendor'));
    // The RENDERED source cell for the VENDOR channel (phase 11): the eight
    // APEX_CONSUMABLE patterns are sold by the Heroic Quartermaster, so the
    // generator maps their drop-acquisition rows to 'vendor' and sourceCell
    // must route them to the vendor string, never the drop or known arms (a
    // mapping that fell through to 'drop' would stay green under the
    // data-level corpus pin alone). Same row-scoped idiom as the armor pin;
    // the armor drop pin above stays as the drop channel's own contrast.
    const alch = professionsPage.render(ctx(['alchemy']));
    const alchRowFor = (name: string): string =>
      alch.match(
        new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`),
      )?.[0] ?? '';
    expect(
      alchRowFor('Ironhusk Flask'),
      'vendor-sold pattern row renders the quartermaster source string',
    ).toContain(t('guide.profPages.sourceVendor'));
    expect(alchRowFor('Ironhusk Flask')).not.toContain(t('guide.profPages.sourceDrop'));
    expect(alchRowFor('Ironhusk Flask')).not.toContain(t('guide.profPages.sourceKnown'));
    // The RENDERED source cell for BOTH channels at once (phase 11f), the
    // third case and the one with a real player cost: every farming pattern
    // is in a drop table AND on the marks counter, and until this phase the
    // generator's vendor arm won outright, so the wiki would have told a
    // reader "Sold by the Heroic Quartermaster" about a recipe that also
    // drops off the raid and they would never have looked in the raid. The
    // row must name both, and must not fall back to either single string.
    const cooking = professionsPage.render(ctx(['cooking']));
    const cookingRowFor = (name: string): string =>
      cooking.match(
        new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`),
      )?.[0] ?? '';
    const feastRow = cookingRowFor('Harvest Feast');
    expect(feastRow, 'the both-channel row must render at all').not.toBe('');
    expect(feastRow, 'a pattern that drops AND sells names both channels').toContain(
      t('guide.profPages.sourceDropAndVendor'),
    );
    expect(feastRow).not.toContain(t('guide.profPages.sourceKnown'));
    expect(feastRow).not.toContain(t('guide.profPages.sourceTrainerFree'));
    // And the three source strings really are distinct, so the arm above
    // cannot be satisfied by a string that merely contains another.
    expect(
      new Set([
        t('guide.profPages.sourceDrop'),
        t('guide.profPages.sourceVendor'),
        t('guide.profPages.sourceDropAndVendor'),
      ]).size,
    ).toBe(3);
    // A held trainer row on the SAME page is the contrast: the cooking page
    // renders both channels, so a sourceCell that collapsed every farm row to
    // one string would fail here rather than looking consistent.
    const bannockRow = cookingRowFor('Highwatch Barley Bannock');
    expect(bannockRow, 'the on-ramp row must render').not.toBe('');
    expect(bannockRow).not.toContain(t('guide.profPages.sourceDropAndVendor'));
    expect(bannockRow).not.toContain(t('guide.profPages.sourceDrop'));
    // The enchanting route rides the craft module with its own sections.
    const ench = professionsPage.render(ctx(['enchanting']));
    expect(ench).toContain('Enchant Weapon - Runed Edge');
    expect(ench).toContain('Chime Shard');
    expect(ench).toContain('id="prof-disenchant"');
    // The fishing page renders all three band tables and the koi.
    const fishing = professionsPage.render(ctx(['fishing']));
    expect(fishing).toContain('Sunglint Koi');
    expect(fishing).toContain('id="fish-band-2"');
    // The economy page renders the work orders.
    const econ = professionsPage.render(ctx(['economy']));
    expect(econ).toContain('Forge Work Order');
    // An unknown id renders the inline not-found, never a blank page.
    expect(professionsPage.render(ctx(['nonsense']))).toContain('guide-notfound');
  });

  it('rewrites the overview into the hub: ring cards, links, and honesty about empty crafts', () => {
    setLanguage('en');
    const html = professionsPage.render(ctx([]));
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
    for (const id of GUIDE_PROF_PAGES) {
      expect(html, `overview missing link to "${id}"`).toContain(
        `href="${hrefFor(`professions/${id}`)}"`,
      );
    }
    // Every ring craft links since the Masterwrought phase 06 inscription
    // catalog (jewelcrafting joined at phase 05, inscription at 06), so the
    // "coming soon" card copy renders nowhere on the overview.
    expect(html).toContain(`href="${hrefFor('professions/jewelcrafting')}"`);
    expect(html).toContain(`href="${hrefFor('professions/inscription')}"`);
    expect(html).not.toContain(t('guide.professions.comingSoon'));
    // All ten archetype pair titles render.
    for (const a of GUIDE_PROF_ARCHETYPES) {
      expect(html).toContain(t(`hudChrome.archetypePair.${a.pairId}` as never));
    }
  });

  it('lists every professions detail page in the sitemap', () => {
    const origin = 'https://worldofclaudecraft.com';
    for (const id of GUIDE_PROF_PAGES) {
      const loc = `${origin}${hrefFor(`professions/${id}`)}`;
      expect(sitemapXml, `sitemap missing professions page "${id}"`).toContain(`<loc>${loc}</loc>`);
    }
  });

  it('indexes the professions detail pages in site search', () => {
    setLanguage('en');
    const index = buildIndex();
    expect(index.some((e) => e.href === hrefFor('professions/weaponcrafting'))).toBe(true);
    expect(index.some((e) => e.href === hrefFor('professions/fishing'))).toBe(true);
    const hits = rank(index, 'weaponcrafting');
    expect(hits.some((e) => e.href === hrefFor('professions/weaponcrafting'))).toBe(true);
  });

  it('resolves the new professions keys in English', () => {
    setLanguage('en');
    for (const k of [
      'guide.professions.ringHeading',
      'guide.professions.ringWaveNote',
      'guide.professions.gatherHubHeading',
      'guide.professions.archetypesHeading',
      'guide.professions.curveHeading',
      'guide.professions.provenanceHeading',
      'guide.professions.stationsHeading',
      'guide.profPages.back',
      'guide.profPages.recipesHeading',
      'guide.profPages.masteryHeading',
      'guide.profPages.masterworkHeading',
      'guide.profPages.trainingHeading',
      'guide.profPages.specializationHeading',
      'guide.profPages.ench.disenchantHeading',
      'guide.profPages.ench.enchantsHeading',
      'guide.profPages.ench.salvageHeading',
      'guide.profPages.rhythmHeading',
      'guide.profPages.nodesHeading',
      'guide.profPages.toolsHeading',
      'guide.profPages.bandsHeading',
      'guide.profPages.rareHeading',
      'guide.profPages.fish.biteHeading',
      'guide.profPages.fish.tablesHeading',
      'guide.profPages.econ.title',
      'guide.profPages.econ.feesHeading',
      'guide.profPages.econ.workOrdersHeading',
      'guide.profPages.faq.title',
    ]) {
      expect(t(k as never).length, k).toBeGreaterThan(0);
    }
    for (const c of GUIDE_PROF_CRAFTS) {
      expect(t(`guide.profPages.craftIntro.${c.id}` as never).length).toBeGreaterThan(0);
    }
    for (const g of GUIDE_PROF_GATHERING) {
      expect(t(`guide.profPages.gatherIntro.${g.id}` as never).length).toBeGreaterThan(0);
    }
    for (let n = 1; n <= 8; n += 1) {
      expect(t(`guide.profPages.faq.q${n}` as never).length).toBeGreaterThan(0);
      expect(t(`guide.profPages.faq.a${n}` as never).length).toBeGreaterThan(0);
    }
    // Format keys stay translator-controlled, pinned as literals.
    expect(t('guide.profPages.matFmt' as never, { name: 'Copper Ore', count: '4' })).toBe(
      'Copper Ore x4',
    );
    expect(
      t('guide.profPages.gainFmt' as never, { reduced: '75', minimal: '100', zero: '125' }),
    ).toBe('75 / 100 / 125');
  });
});

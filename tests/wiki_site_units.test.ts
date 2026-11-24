// @vitest-environment happy-dom
// The static encyclopedia's building blocks (scripts/wiki_site/): page addresses, the
// SEO head, link rewriting and the sitemap. The whole-site audit is wiki_site_audit.test.ts.
import { describe, expect, it } from 'vitest';
import {
  clipDescription,
  describePage,
  documentTitle,
  headMarkup,
} from '../scripts/wiki_site/head.mjs';
import { hashTarget, rewriteView, staticHref } from '../scripts/wiki_site/links.mjs';
import {
  assignPaths,
  fileForPath,
  HOME_PATH,
  registryDrift,
  SECTIONS,
  sectionFor,
  slugify,
  stripQualifier,
} from '../scripts/wiki_site/paths.mjs';
import { sitemapXml } from '../scripts/wiki_site/sitemap.mjs';
import { GUIDE_ROUTES } from '../src/guide/routes';

const page = (title: string, categories: string[] = [], text = '') => ({
  title,
  categories,
  text,
});

describe('encyclopedia addresses', () => {
  it('slugs titles into lower case ASCII words', () => {
    expect(slugify("Varkhul's Forgebreaker: Engine of Ruin")).toBe(
      'varkhuls-forgebreaker-engine-of-ruin',
    );
    expect(slugify('Élan & Ember')).toBe('elan-and-ember');
    expect(slugify('***')).toBe('page');
    expect(stripQualifier('Wolf (Mob)')).toBe('Wolf');
    expect(stripQualifier('Wolf')).toBe('Wolf');
  });

  it('never starts with a Guide path, so no Guide route can be shadowed', () => {
    const guideHeads = new Set(GUIDE_ROUTES.map((route) => route.sub.split('/')[0]));
    for (const section of SECTIONS) expect(guideHeads.has(section)).toBe(false);
  });

  it('files a page by what it is', () => {
    expect(sectionFor(page('Main Page'))).toBe('encyclopedia');
    expect(sectionFor(page('Iron Sword', ['Items', 'Weapons']))).toBe('item');
    expect(sectionFor(page('Wolf (Mob)', ['Mobs']))).toBe('creature');
    expect(sectionFor(page('Weapons', ['Portals']))).toBe('browse');
    expect(sectionFor(page('Fishing', ['Systems']))).toBe('topic');
  });

  it('keeps published addresses and gives new pages a free one', () => {
    const pages = new Map(
      [
        page('Main Page'),
        page('Wolf (Mob)', ['Mobs']),
        page('Wolf (Mob, level 4)', ['Mobs']),
        page('Wolf (Mob, level 9)', ['Mobs']),
        page('Iron Sword', ['Items']),
        page('Moved Thing', ['Items']),
      ].map((p) => [p.title, p]),
    );
    const registry = {
      pages: { 'Iron Sword': '/wiki/item/the-old-iron-sword' },
      redirects: { '/wiki/item/moved-thing': 'Iron Sword' },
    };
    const { paths, added } = assignPaths(pages, registry);
    expect(paths.get('Main Page')).toBe(HOME_PATH);
    // Pinned wins over what the title would give today.
    expect(paths.get('Iron Sword')).toBe('/wiki/item/the-old-iron-sword');
    // A redirect source is never reused for a new page.
    expect(paths.get('Moved Thing')).toBe('/wiki/item/moved-thing-2');
    // The qualifier is dropped only where the short slug is unique in its section.
    expect(paths.get('Wolf (Mob)')).toBe('/wiki/creature/wolf-mob');
    expect(paths.get('Wolf (Mob, level 4)')).toBe('/wiki/creature/wolf-mob-level-4');
    expect(new Set(paths.values()).size).toBe(paths.size);
    expect(added).not.toContain('Iron Sword');
    expect(fileForPath('/wiki/item/iron-sword')).toBe('wiki/item/iron-sword/index.html');
  });

  it('reports pages that are new or gone against the registry', () => {
    const paths = new Map([['A', '/wiki/topic/a']]);
    expect(registryDrift(paths, { pages: { B: '/wiki/topic/b' }, redirects: {} })).toEqual({
      added: ['A'],
      missing: ['B'],
    });
  });
});

describe('link rewriting', () => {
  const paths = new Map([
    ['Iron Sword', '/wiki/item/iron-sword'],
    ['Wolf (Mob)', '/wiki/creature/wolf'],
  ]);

  it('maps reader hashes to static paths and sections to in-page anchors', () => {
    expect(hashTarget('#Iron%20Sword')).toEqual({ title: 'Iron Sword', section: '' });
    expect(staticHref('#Iron%20Sword', paths, 'X')).toBe('/wiki/item/iron-sword');
    expect(staticHref('#Iron%20Sword#loot', paths, 'Iron Sword')).toBe('#section-loot');
    expect(staticHref('#Wolf%20(Mob)#loot', paths, 'X')).toBe('/wiki/creature/wolf#section-loot');
    expect(staticHref('#Nowhere', paths, 'X')).toBeUndefined();
  });

  it('rewrites links and pictures, and turns a dead link into text', () => {
    document.body.innerHTML =
      '<main id="view"><h2 id="part-0">Weapons</h2>' +
      '<a href="#Iron%20Sword" class="tag">Iron Sword</a>' +
      '<a href="#Nowhere">Nowhere</a>' +
      '<a href="#Here" data-part="part-0">Weapons</a>' +
      '<a href="#view">Skip</a>' +
      '<img class="article-art" data-game-art="/ui/sword.webp" alt="" loading="lazy">' +
      '<img class="index-icon" data-game-art="/ui/x.webp" alt="" loading="lazy"></main>';
    const view = document.querySelector('#view') as HTMLElement;
    const broken = rewriteView(view, { paths, current: 'Here', title: 'Here' });
    expect(broken).toEqual(['Nowhere']);
    const links = [...view.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/wiki/item/iron-sword', '#part-0', '#view']);
    expect(view.querySelector('span')?.textContent).toBe('Nowhere');
    const [art, icon] = [...view.querySelectorAll('img')];
    expect(art.getAttribute('src')).toBe('/ui/sword.webp');
    expect(art.getAttribute('alt')).toBe('Here');
    expect(art.hasAttribute('loading')).toBe(false);
    expect(icon.getAttribute('loading')).toBe('lazy');
    expect(view.querySelector('[data-game-art]')).toBeNull();
  });
});

describe('page head', () => {
  it('uses the opening paragraph, clipped at a word, as the description', () => {
    const long = 'word '.repeat(60);
    const clipped = clipDescription(long);
    expect(clipped.length).toBeLessThanOrEqual(155);
    expect(clipped.endsWith('...')).toBe(true);
    expect(
      describePage({ title: 'X', lead: 'A long enough opening line about this sword.' }),
    ).toContain('X: reference page');
    expect(
      describePage({
        title: 'Iron Sword',
        lead: 'The Iron Sword is a one-handed blade sold by the Eastbrook smith.',
      }),
    ).toBe('The Iron Sword is a one-handed blade sold by the Eastbrook smith.');
  });

  it('writes the tags Lighthouse and social cards read', () => {
    const head = headMarkup({
      title: 'Iron "Sword"',
      description: 'A <sharp> blade.',
      path: '/wiki/item/iron-sword',
      image: '/ui/sword.webp',
      crumbs: [{ name: 'Encyclopedia', path: HOME_PATH }],
    });
    expect(head).toContain(`<title>${documentTitle('Iron &quot;Sword&quot;')}</title>`);
    expect(head).toContain('<meta name="description" content="A &lt;sharp&gt; blade.">');
    expect(head).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/wiki/item/iron-sword">',
    );
    expect(head).toContain('og:image" content="https://worldofclaudecraft.com/ui/sword.webp"');
    expect(head).not.toContain('noindex');
    const json = head.match(/<script type="application\/ld\+json">(.*)<\/script>/)?.[1] ?? '';
    expect(json).not.toContain('<');
    const data = JSON.parse(json);
    const trail = data['@graph'][1].itemListElement;
    expect(trail.map((c: { name: string }) => c.name)).toEqual(['Encyclopedia', 'Iron "Sword"']);
    expect(trail[1].item).toBe('https://worldofclaudecraft.com/wiki/item/iron-sword');
  });
});

describe('wiki sitemap', () => {
  it('lists absolute, escaped, sorted, unique URLs', () => {
    const xml = sitemapXml(['/wiki/b', '/wiki/a&b', '/wiki/b']);
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml.indexOf('a&amp;b')).toBeLessThan(xml.indexOf('/wiki/b<'));
    expect(xml).toContain('<loc>https://worldofclaudecraft.com/wiki/a&amp;b</loc>');
  });

  it('refuses to pass the protocol limit', () => {
    const many = Array.from({ length: 50001 }, (_, i) => `/wiki/topic/p${i}`);
    expect(() => sitemapXml(many)).toThrow(/limit/);
  });
});

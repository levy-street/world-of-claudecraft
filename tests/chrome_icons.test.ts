import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHROME_ART_IDS, chromeIconUrl, hasChromeIconArt } from '../src/ui/chrome_icon_art';
import { hasUiIcon, hydrateIcons, svgIcon, type UiIconName } from '../src/ui/ui_icons';
import { webpHasAlpha, webpSize } from './helpers/webp_header';

// Gate for the painted HUD-chrome launcher art (sibling of tests/deed_icons.test.ts and
// tests/item_icons.test.ts). Art under public/ui/chrome/<name>.webp is the source of truth
// (128px WebP with a real alpha matte, normalized by scripts/convert_chrome_icons_webp.mjs),
// served by hydrateIcons for the `[data-icon]` launchers in index.html / play.html.
//
// The guard is a bijection, a validity pass, a reachability pass, and a ROLE pass:
//   A)  CHROME_ART_IDS is exact set-equality with the committed .webp files, BOTH directions;
//   A2) every committed webp is a valid RIFF/WEBP that actually carries alpha (art keyed onto
//       an opaque rectangle would ship a visible box on the button, which is the exact defect
//       the magenta-key step in the converter exists to prevent);
//   A3) every committed webp is the served 128px square;
//   B)  only .webp art is committed under public/ui/chrome;
//   C)  every art id is a real UiIconName that KEEPS its inline SVG glyph (direct svgIcon()
//       callers, which sit inline beside text, must never lose their tintable glyph);
//   D)  every art id is reachable: it has a `[data-icon]` placeholder in BOTH entry documents,
//       since art for a name with no placeholder would never render;
//   E)  the role split of DESIGN.md section 6 holds: secondary controls and brand marks are
//       art-free, so the rail cannot drift into repainting close buttons or the Discord mark;
//   plus the resolution contract: hydrateIcons emits the painted <img> for an art id and the
// inline <svg> for everything else, both decorative.
// Filesystem + string markup only (a tiny hand-rolled fake DOM), so it runs in the default
// node env with no canvas and no jsdom.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeDir = path.join(repoRoot, 'public/ui/chrome');

const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');
const isMapping = (p: string): boolean => path.basename(p) === 'mapping.json';

type Mapping = { iconSize: number; entries: { icon: string; motif: string }[] };
const mapping = (): Mapping =>
  JSON.parse(readFileSync(path.join(chromeDir, 'mapping.json'), 'utf8')) as Mapping;

// A real WebP starts with a RIFF container whose form-type is "WEBP" (bytes 8..12).
function isValidWebp(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const n = readSync(fd, buf, 0, 12, 0);
    return (
      n === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    );
  } finally {
    closeSync(fd);
  }
}

// webpHeader / webpSize / webpHasAlpha moved to tests/helpers/webp_header.ts
// (shared with reliquary_cell_art's opacity-premise sweep; the move also
// fixed this file's VP8L alpha read, which masked a height bit).

const committedIds = (): string[] =>
  existsSync(chromeDir)
    ? readdirSync(chromeDir)
        .filter((f) => path.extname(f).toLowerCase() === '.webp')
        .map((f) => path.basename(f, '.webp'))
    : [];

const entryDocs = ['index.html', 'play.html'] as const;
const readEntry = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

// The role split this set exists to hold (DESIGN.md section 6). Pinned literally: the
// glyph registry is the sanctioned thin-line family for secondary controls, and a brand
// mark is reproduced for identification, so neither may ever gain painted art.
const SECONDARY_CONTROLS: UiIconName[] = [
  'attack',
  'autorun',
  'check',
  'close',
  'interact',
  'jump',
  'lock',
  'mail',
  'menu',
  'meters',
  'more',
  'music',
  'nameplates',
  'next',
  'prev',
  'skull',
  'sort',
  'swap',
  'target',
  'trash',
  'vibrate',
  'whisper',
  // The Wiki launcher: a help affordance kept as a thin-line glyph on purpose
  // (the rail tail and the More tray's utility entries are glyphs too); painting
  // it means moving it to CHROME_ART_IDS, a deliberate reclassification.
  'wiki',
];
const BRAND_MARKS: UiIconName[] = ['discord', 'kick', 'twitch', 'x', 'youtube'];

// Minimal DOM stand-ins: hydrateIcons walks [data-icon] hosts, prepends markup, and arms
// painted images for load failure. The fake image exposes decode() only as a tripwire: the
// launcher path must let the browser decode asynchronously instead of calling it itself.
class FakeIconImage {
  private readonly listeners = new Map<string, Array<{ callback: () => void; once: boolean }>>();
  decodeCalls = 0;

  constructor(private readonly replace: (markup: string) => void) {}

  addEventListener(
    type: string,
    callback: () => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, once: typeof options === 'object' && options.once === true });
    this.listeners.set(type, listeners);
  }

  decode(): Promise<void> {
    this.decodeCalls++;
    return Promise.resolve();
  }

  fire(type: 'load' | 'error'): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) listener.callback();
    this.listeners.set(
      type,
      listeners.filter((listener) => !listener.once),
    );
  }

  set outerHTML(markup: string) {
    this.replace(markup);
  }
}

class FakeIconHost {
  readonly dataset: { icon: string };
  html: string;
  image: FakeIconImage | null = null;

  constructor(icon: string, children = '') {
    this.dataset = { icon };
    this.html = children;
  }

  querySelector(selector: string): unknown {
    if (selector === ':scope > img.ui-icon-art') return this.image;
    return this.html.includes('class="ui-icon') ? (this.image ?? {}) : null;
  }

  insertAdjacentHTML(_pos: string, markup: string): void {
    this.html = markup + this.html;
    if (!markup.startsWith('<img')) return;
    this.image = new FakeIconImage((fallback) => {
      this.html = this.html.replace(markup, fallback);
      this.image = null;
    });
  }
}

function fakeHost(icon: string, children = ''): FakeIconHost {
  return new FakeIconHost(icon, children);
}
function hydrateOne(icon: string): string {
  const host = fakeHost(icon);
  hydrateIcons({
    querySelectorAll: () => [host],
  } as unknown as ParentNode);
  return host.html;
}

describe('painted HUD-chrome launcher icons', () => {
  it('has art ids wired (guards the fixture)', () => {
    expect(CHROME_ART_IDS.size).toBeGreaterThan(0);
  });

  it('A) CHROME_ART_IDS is an exact bijection with the committed .webp files', () => {
    const files = new Set(committedIds());
    const wired = new Set<string>(CHROME_ART_IDS);
    const missingFile = [...wired].filter((id) => !files.has(id)).sort();
    const unwiredFile = [...files].filter((id) => !wired.has(id)).sort();
    expect(
      missingFile,
      'wired chrome icons with no committed webp; re-run npm run assets:chrome',
    ).toEqual([]);
    expect(
      unwiredFile,
      'committed webp with no CHROME_ART_IDS entry (art that never renders)',
    ).toEqual([]);
    expect(files.size).toBe(wired.size);
  });

  it('A2) every committed webp is a valid RIFF/WEBP that carries alpha', () => {
    const broken: string[] = [];
    for (const id of CHROME_ART_IDS) {
      const file = path.join(chromeDir, `${id}.webp`);
      if (!existsSync(file)) {
        broken.push(`${id} (missing file)`);
        continue;
      }
      if (!isValidWebp(file)) broken.push(`${id} (not a valid webp: bad RIFF/WEBP header)`);
      else if (!webpHasAlpha(file)) broken.push(`${id} (opaque: the magenta key did not apply)`);
    }
    expect(broken).toEqual([]);
  });

  it('A3) every committed webp is the served 128px square', () => {
    const wrong: string[] = [];
    for (const id of CHROME_ART_IDS) {
      const size = webpSize(path.join(chromeDir, `${id}.webp`));
      if (size.width !== 128 || size.height !== 128)
        wrong.push(`${id} (${size.width}x${size.height})`);
    }
    expect(wrong).toEqual([]);
  });

  it('B) commits only .webp art (+ mapping.json) under public/ui/chrome', () => {
    const stray = existsSync(chromeDir)
      ? readdirSync(chromeDir)
          .filter(
            (f) => !isDotfile(f) && !isMapping(f) && path.extname(f).toLowerCase() !== '.webp',
          )
          .sort()
      : [];
    expect(stray, 'run npm run assets:chrome; only .webp art + mapping.json may live here').toEqual(
      [],
    );
  });

  it('B2) every committed icon has a provenance entry in mapping.json, and vice versa', () => {
    const declared = new Set(mapping().entries.map((e) => e.icon));
    const files = new Set(committedIds());
    expect(
      [...files].filter((id) => !declared.has(id)).sort(),
      'art without provenance: add its entry to mapping.json',
    ).toEqual([]);
    expect(
      [...declared].filter((id) => !files.has(id)).sort(),
      'mapping.json lists art that is not committed: drop the stale entry',
    ).toEqual([]);
    expect(mapping().iconSize).toBe(128);
    for (const entry of mapping().entries) expect(entry.motif.length).toBeGreaterThan(8);
  });

  it('C) every art id is a real UiIconName that keeps its inline SVG glyph', () => {
    for (const id of CHROME_ART_IDS) {
      expect(hasUiIcon(id), `${id} must be a real UiIconName`).toBe(true);
      // Direct svgIcon() callers (inline beside text) must still get the tintable glyph.
      const markup = svgIcon(id);
      expect(markup.startsWith('<svg'), `svgIcon('${id}') must stay vector`).toBe(true);
      expect(markup).toContain('fill="currentColor"');
      expect(markup.length, `svgIcon('${id}') must carry real path data`).toBeGreaterThan(120);
    }
  });

  it('D) every art id has a [data-icon] launcher in both entry documents', () => {
    for (const file of entryDocs) {
      const html = readEntry(file);
      const unreachable = [...CHROME_ART_IDS]
        .filter((id) => !html.includes(`data-icon="${id}"`))
        .sort();
      expect(unreachable, `${file} has no launcher for this painted art`).toEqual([]);
    }
  });

  it('E) secondary controls and brand marks stay art-free (the DESIGN.md role split)', () => {
    for (const id of SECONDARY_CONTROLS) {
      expect(hasUiIcon(id), `${id} must still exist as a glyph`).toBe(true);
      expect(hasChromeIconArt(id), `${id} is a secondary control; it must not ship art`).toBe(
        false,
      );
      expect(chromeIconUrl(id)).toBeNull();
    }
    for (const id of BRAND_MARKS) {
      expect(hasChromeIconArt(id), `${id} is a brand mark; it must never be repainted`).toBe(false);
      expect(chromeIconUrl(id)).toBeNull();
    }
  });

  it('resolves an art id to its WebP url and an artless id to null', () => {
    const id = [...CHROME_ART_IDS].sort()[0];
    expect(chromeIconUrl(id)).toBe(`/ui/chrome/${id}.webp`);
    expect(chromeIconUrl('close')).toBeNull();
    expect(chromeIconUrl('not-an-icon')).toBeNull();
    expect(hasChromeIconArt('not-an-icon')).toBe(false);
  });

  it('ships painted art for the Reliquary launcher (crown)', () => {
    // Phase 16 acceptance pin: the Reliquary is a primary destination, so its
    // launcher renders painted chrome art beside its siblings, never the bare
    // glyph. Guard A already ties the set to the committed webp; this pins the
    // membership itself so dropping the row is a red, not a silent downgrade.
    expect(hasChromeIconArt('crown')).toBe(true);
    expect(chromeIconUrl('crown')).toBe('/ui/chrome/crown.webp');
    // Guard D only proves SOME placeholder exists; tie the crown to the
    // RELIQUARY buttons specifically (the professions crosshair precedent), so
    // re-iconing the launcher cannot leave this green by accident.
    for (const doc of entryDocs) {
      const html = readEntry(doc);
      expect(html, `${doc} side rail`).toMatch(/id="mm-reliquary"[^>]*data-icon="crown"/);
      expect(html, `${doc} More tray`).toMatch(/id="mobile-reliquary"[^>]*data-icon="crown"/);
    }
  });

  it('keeps the crown webp in lockstep with its committed SVG source', () => {
    // The crown is the one chrome icon with an in-repo source
    // (scripts/assets/chrome_crown/, its siblings were generated externally),
    // so drift between the two is detectable and worth pinning: an SVG edit
    // that was never re-rendered, or a re-render never re-encoded, reds here.
    // To update BOTH legitimately: edit crown.svg, run
    // `node scripts/assets/chrome_crown/render_source.mjs` then
    // `npm run assets:chrome`, and re-pin both hashes in one commit.
    const sha = (rel: string) =>
      createHash('sha256')
        .update(readFileSync(path.join(repoRoot, rel)))
        .digest('hex');
    expect(sha('scripts/assets/chrome_crown/crown.svg')).toBe(
      '768004a53601a7a4c2ba90faa1f851fa0e74e66bd28df3f1fe5cb9bd7d969a45',
    );
    expect(sha('public/ui/chrome/crown.webp')).toBe(
      '139900a0f4ff72186d9d3ea0584ba418c499f4ef9e17d5e858b920ecacc7cf8c',
    );
  });

  it('hydrates an art id as a decorative <img> and everything else as inline <svg>', () => {
    const art = hydrateOne('character');
    expect(art.startsWith('<img')).toBe(true);
    expect(art).toContain('src="/ui/chrome/character.webp"');
    expect(art).toContain('class="ui-icon ui-icon-art"');
    // Decorative: the host button carries the accessible name, so a second one here would
    // double-announce. And a draggable image on a launcher ghost-drags instead of clicking.
    expect(art).toContain('aria-hidden="true"');
    expect(art).toContain('alt=""');
    expect(art).toContain('draggable="false"');
    expect(art).not.toContain('aria-label');

    const glyph = hydrateOne('close');
    expect(glyph.startsWith('<svg')).toBe(true);
    expect(glyph).toContain('aria-hidden="true"');
    expect(glyph).not.toContain('<img');

    // An unknown name hydrates to nothing at all (no broken img, no empty svg).
    expect(hydrateOne('not-an-icon')).toBe('');
  });

  it('keeps a successfully loaded painted launcher as the async-decoded image', () => {
    const caption = '<span class="mobile-label">Character</span>';
    const host = fakeHost('character', caption);
    hydrateIcons({ querySelectorAll: () => [host] } as unknown as ParentNode);
    const image = host.image;

    expect(image).not.toBeNull();
    expect(image?.decodeCalls).toBe(0);
    image?.fire('load');
    expect(host.image).toBe(image);
    expect(host.html).toContain('decoding="async"');
    expect(host.html.endsWith(caption)).toBe(true);
    expect(host.html.match(/class="ui-icon/g)).toHaveLength(1);
  });

  it('swaps a painted launcher decode error to its existing SVG without moving siblings', () => {
    const caption = '<span class="mobile-label">Character</span>';
    const host = fakeHost('character', caption);
    const root = { querySelectorAll: () => [host] } as unknown as ParentNode;
    hydrateIcons(root);
    const image = host.image;

    expect(image).not.toBeNull();
    image?.fire('error');
    expect(host.image).toBeNull();
    expect(host.html).toBe(`${svgIcon('character')}${caption}`);
    expect(host.html).not.toContain('<img');
    expect(host.html.match(/class="ui-icon/g)).toHaveLength(1);

    hydrateIcons(root);
    expect(host.html).toBe(`${svgIcon('character')}${caption}`);
  });

  it('hydrates each host once (a second pass never doubles the icon)', () => {
    const host = fakeHost('character');
    const root = { querySelectorAll: () => [host] } as unknown as ParentNode;
    hydrateIcons(root);
    const once = host.html;
    hydrateIcons(root);
    expect(host.html).toBe(once);
  });

  it('gives the Professions launcher its own glyph instead of borrowing the crosshair', () => {
    // Regression pin: both Professions buttons used data-icon="target", the same glyph the
    // mobile target-cycle control uses, so one concept read as two and one glyph meant two.
    for (const file of entryDocs) {
      const html = readEntry(file);
      expect(html).toMatch(/id="mm-professions"[^>]*data-icon="professions"/);
      expect(html).toMatch(/id="mobile-professions"[^>]*data-icon="professions"/);
      expect(html).toMatch(/id="mobile-target-cycle"[^>]*data-icon="target"/);
    }
    expect(hasUiIcon('professions')).toBe(true);
    expect(svgIcon('professions')).not.toBe(svgIcon('target'));
  });
});

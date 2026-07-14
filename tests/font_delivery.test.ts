import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const sharedFontTemplates = [
  'index.html',
  'play.html',
  'app.html',
  'community.html',
  'public/links.html',
  'public/merch.html',
  'public/press.html',
  'public/privacy.html',
  'public/cookies.html',
  'public/terms.html',
  'public/data-deletion.html',
  'public/support.html',
];
const fontCssPath = join(root, 'public', 'site', 'fonts-v1.css');
const fontCss = readFileSync(fontCssPath, 'utf8');
const guideHtml = readFileSync(join(root, 'guide.html'), 'utf8');
const guideMain = readFileSync(join(root, 'src', 'guide', 'main.ts'), 'utf8');
const guideCss = readFileSync(join(root, 'src', 'guide', 'styles.css'), 'utf8');

describe('self-hosted font delivery', () => {
  it('keeps every public template on its intended same-origin font path', () => {
    for (const template of sharedFontTemplates) {
      const html = readFileSync(join(root, template), 'utf8');
      expect(html, template).toContain('href="/site/fonts-v1.css"');
      expect(html, template).not.toContain('fonts.googleapis.com');
      expect(html, template).not.toContain('fonts.gstatic.com');
    }

    // The guide predates the shared marketing sheet and deliberately owns a
    // smaller route-specific font set in its bundled CSS. Loading fonts-v1.css
    // here as well would duplicate @font-face rules and expand the guide's font
    // payload, so protect that performance boundary rather than requiring the
    // marketing stylesheet on every entry point.
    expect(guideHtml).not.toContain('href="/site/fonts-v1.css"');
    expect(guideHtml).not.toContain('fonts.googleapis.com');
    expect(guideHtml).not.toContain('fonts.gstatic.com');
    expect(guideMain).toMatch(/import\s+['"]\.\/styles\.css['"]/);
    expect(guideCss).toContain('@font-face');
    expect(guideCss).not.toContain('https://');
  });

  it('ships every declared WOFF2 subset locally with swap and unicode ranges', () => {
    const urls = [...fontCss.matchAll(/url\(\.\/fonts\/([^)]+\.woff2)\)/g)].map(
      (match) => match[1],
    );
    expect(urls).toHaveLength(37);
    expect(new Set(urls).size).toBe(urls.length);
    expect(fontCss.match(/font-display:\s*swap/g)).toHaveLength(urls.length);
    expect(fontCss.match(/unicode-range:/g)).toHaveLength(urls.length);
    expect(fontCss).not.toContain('https://');

    for (const file of urls) {
      const path = join(root, 'public', 'site', 'fonts', file);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString('ascii'), file).toBe('wOF2');
    }
  });

  it('keeps the guide-owned font subsets local, ranged, and non-blocking', () => {
    const faces = guideCss.match(/@font-face\s*\{[^}]+\}/gs) ?? [];
    const urls = faces.flatMap((face) =>
      [...face.matchAll(/url\(["']?\/fonts\/([^)"']+\.woff2)["']?\)/g)].map((match) => match[1]),
    );

    expect(faces.length).toBeGreaterThan(0);
    expect(urls).toHaveLength(faces.length);
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toContain('unicode-range:');
    }

    for (const file of new Set(urls)) {
      const path = join(root, 'public', 'fonts', file);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString('ascii'), file).toBe('wOF2');
    }
  });
});

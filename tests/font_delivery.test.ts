import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const templates = [
  'index.html',
  'play.html',
  'app.html',
  'community.html',
  'guide.html',
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

describe('self-hosted font delivery', () => {
  it('uses one same-origin font stylesheet on every public template', () => {
    for (const template of templates) {
      const html = readFileSync(join(root, template), 'utf8');
      expect(html, template).toContain('href="/site/fonts-v1.css"');
      expect(html, template).not.toContain('fonts.googleapis.com');
      expect(html, template).not.toContain('fonts.gstatic.com');
    }
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
});

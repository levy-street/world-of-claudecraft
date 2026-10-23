import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentTypeFor } from '../server/static_content_type';

// The static file server's Content-Type by extension. The crawler files at the
// site root (robots.txt, llms.txt, the IndexNow key file, sitemap.xml) used to
// fall through to application/octet-stream.

describe('contentTypeFor', () => {
  it('serves the crawler text files as UTF-8 plain text', () => {
    for (const file of ['robots.txt', 'llms.txt', '8229a69237564e43bae74c07bff2ac88.txt']) {
      expect(contentTypeFor(`/srv/dist/${file}`)).toBe('text/plain; charset=utf-8');
    }
  });

  it('serves sitemaps as UTF-8 XML', () => {
    expect(contentTypeFor('/srv/dist/sitemap.xml')).toBe('application/xml; charset=utf-8');
  });

  it('keeps the existing types', () => {
    expect(contentTypeFor('/srv/dist/index.html')).toBe('text/html');
    expect(contentTypeFor('/srv/dist/assets/main-FDVzfzpz.js')).toBe('application/javascript');
    expect(contentTypeFor('/srv/dist/media/models/chars/knight.8f31c2aa91bd.glb')).toBe(
      'model/gltf-binary',
    );
    expect(contentTypeFor('/srv/dist/home-bg.webp')).toBe('image/webp');
    expect(contentTypeFor('/srv/dist/audio/main-theme.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('/srv/dist/media/env/vale_day_1k.3bd7220a9f01.hdr')).toBe(
      'application/octet-stream',
    );
  });

  it('falls back to octet-stream for an unknown extension', () => {
    expect(contentTypeFor('/srv/dist/archive.zip')).toBe('application/octet-stream');
    expect(contentTypeFor('/srv/dist/no-extension')).toBe('application/octet-stream');
  });

  it('is what the static file server sends', () => {
    const main = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("'Content-Type': contentTypeFor(file),");
    expect(main).not.toMatch(/const MIME\b/);
  });
});

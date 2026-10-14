import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  headStylesheetsBlockingBootSplash,
  moveHeadStylesheetsBehindBootSplash,
} from '../scripts/lib/boot_splash_stylesheets.mjs';

const FONTS =
  '<link href="https://fonts.googleapis.com/css2?family=Cinzel&display=swap" rel="stylesheet">';
const MAIN_CSS = '<link rel="stylesheet" crossorigin href="/assets/main-abc.css">';
const EXTRA_CSS = '<link rel="stylesheet" crossorigin href="/assets/main-def.css">';

function entry(bodyStart: string): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preload" as="image" href="/logo.png" />',
    FONTS,
    '<style>#boot-splash{position:fixed}</style>',
    '<script type="module" crossorigin src="/assets/main.js"></script>',
    `  ${MAIN_CSS}`,
    `  ${EXTRA_CSS}`,
    '</head>',
    `<body class="boot-pending">${bodyStart}`,
    '  <main id="start-screen"></main>',
    '</body>',
    '</html>',
  ].join('\n');
}

describe('moveHeadStylesheetsBehindBootSplash', () => {
  const html = entry('\n  <div id="boot-splash"></div>');
  const out = moveHeadStylesheetsBehindBootSplash(html);
  const head = out.slice(0, out.indexOf('</head>'));
  const bodyTail = out.slice(out.indexOf('<main id="start-screen">'), out.indexOf('</body>'));

  it('moves every head stylesheet link behind the page content, in order', () => {
    for (const link of [FONTS, MAIN_CSS, EXTRA_CSS]) {
      expect(head).not.toContain(link);
      expect(bodyTail).toContain(link);
    }
    expect(bodyTail.indexOf(FONTS)).toBeLessThan(bodyTail.indexOf(MAIN_CSS));
    expect(bodyTail.indexOf(MAIN_CSS)).toBeLessThan(bodyTail.indexOf(EXTRA_CSS));
  });

  it('leaves preconnects, preloads, inline styles and scripts in the head', () => {
    expect(head).toContain('rel="preconnect"');
    expect(head).toContain('rel="preload"');
    expect(head).toContain('<style>#boot-splash');
    expect(head).toContain('<script type="module"');
  });

  it('leaves an entry without the splash untouched', () => {
    const plain = entry('');
    expect(moveHeadStylesheetsBehindBootSplash(plain)).toBe(plain);
  });

  it('names the head stylesheets the build check refuses, and none once moved', () => {
    expect(headStylesheetsBlockingBootSplash(html)).toEqual([FONTS, MAIN_CSS, EXTRA_CSS]);
    expect(headStylesheetsBlockingBootSplash(out)).toEqual([]);
    expect(headStylesheetsBlockingBootSplash(entry(''))).toEqual([]);
  });

  it('is idempotent', () => {
    expect(moveHeadStylesheetsBehindBootSplash(out)).toBe(out);
  });
});

describe('the real entries', () => {
  for (const entry of ['index.html', 'play.html']) {
    it(`${entry}: every head stylesheet ends up after the start screen`, () => {
      const html = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
      const sourceHead = html.slice(0, html.indexOf('</head>'));
      const headLinks = sourceHead.match(/<link\b[^>]*rel=["']?stylesheet[^>]*>/g) ?? [];
      expect(headLinks.length).toBeGreaterThanOrEqual(2);
      const out = moveHeadStylesheetsBehindBootSplash(html);
      const head = out.slice(0, out.indexOf('</head>'));
      const bodyTail = out.slice(
        out.indexOf('<main id="start-screen">'),
        out.lastIndexOf('</body>'),
      );
      expect(head).not.toMatch(/rel=["']?stylesheet/);
      for (const link of headLinks) expect(bodyTail).toContain(link.trim());
    });
  }
});

describe('vite wiring', () => {
  it('runs the move as a post transform so the injected build CSS moves too', () => {
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8').replace(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(config).toMatch(
      /transformIndexHtml:\s*\{\s*order:\s*'post'[^}]*handler:\s*moveHeadStylesheetsBehindBootSplash/,
    );
    expect(config).toMatch(/plugins:\s*\[[\s\S]*?^\s*bootSplashStylesheetsPlugin\(\),$/m);
    expect(config).toMatch(/closeBundle\(\)[\s\S]*?headStylesheetsBlockingBootSplash\(/);
  });
});

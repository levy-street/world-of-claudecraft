import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headerMarkup } from '../src/ui/shared_marketing_header';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const headerCss = read('src/styles/site-header.css');
const sharedPlayHeader = headerMarkup('play');
const sharedCommunityHeader = headerMarkup('community');
const headerLeftSvg = read('public/site/header-left-assembly.svg');
const headerRightSvg = read('public/site/header-ribbon-cap.svg');
const headerLeftMobileSvg = read('public/site/header-left-mobile.svg');
const headerRightMobileSvg = read('public/site/header-ribbon-cap-mobile.svg');
const headerMusicPng = readFileSync(
  new URL('../public/site/header-music-note.png', import.meta.url),
);
const headerMenuSvg = read('public/site/header-menu-burger-v2.svg');
const headerCloseSvg = read('public/site/header-close.svg');
const headerControlFocusSvg = read('public/site/header-control-focus.svg');
const headerControlFrameSvg = read('public/site/header-control-frame.svg');
const headerCompactShellSvg = read('public/site/header-compact-shell.svg');

const navControls = (html: string): string[] =>
  html.match(/<(?:button|a)\b[^>]*class="[^"]*\bnav-link\b[^"]*"[^>]*>[\s\S]*?<\/(?:button|a)>/g) ??
  [];

const cssRule = (selector: RegExp): string =>
  headerCss.match(new RegExp(`${selector.source}\\s*\\{[^{}]*\\}`, selector.flags))?.[0] ?? '';

const slice = (start: string, end: string): string => {
  const from = headerCss.indexOf(start);
  const to = headerCss.indexOf(end, from + start.length);
  return from >= 0 && to > from ? headerCss.slice(from, to) : '';
};

describe('AAA site header visual contract', () => {
  it.each([
    ['play', sharedPlayHeader, 10],
    ['community', sharedCommunityHeader, 8],
  ])('%s gives every nav button a label and complete live SVG arc', (_name, html, count) => {
    expect(html.match(/class="visually-hidden site-nav-arc-defs"/g)).toHaveLength(1);
    expect(html).toContain('id="site-nav-arc-body-gradient"');
    expect(html).toContain('id="site-nav-arc-gradient"');
    expect(html).toContain(
      '<path id="site-nav-arc-path" d="M4 2.5 C39 16 121 16 156 2.5" pathLength="100"></path>',
    );

    const buttons = navControls(html);
    expect(buttons).toHaveLength(count);
    for (const button of buttons) {
      expect(button).toMatch(/<span class="nav-link-label" data-i18n="[^"]+">[^<]+<\/span>/);
      expect(button).toContain(
        '<svg class="nav-arc" viewBox="0 0 160 18" preserveAspectRatio="none" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">',
      );
      expect(button).toContain('<use class="nav-arc__under" href="#site-nav-arc-path"></use>');
      expect(button).toContain('<use class="nav-arc__core" href="#site-nav-arc-path"></use>');
      expect(button).toContain('<g class="nav-arc__spark">');
      expect(button).toContain('<circle class="nav-arc__spark-halo"');
      expect(button).toContain('<circle class="nav-arc__spark-core"');
      expect(button.match(/<path\b/g) ?? []).toHaveLength(0);
      expect(button.slice(0, button.indexOf('>') + 1)).not.toContain('data-i18n=');
    }
  });

  it.each([
    ['play', sharedPlayHeader],
    ['community', sharedCommunityHeader],
  ])('%s owns saturated body and core gradients without blur filters', (_name, html) => {
    const defs =
      html.match(/<svg class="visually-hidden site-nav-arc-defs"[\s\S]*?<\/svg>/)?.[0] ?? '';
    expect(defs).toMatch(
      /site-nav-arc-body-gradient[\s\S]*?#cf8210[\s\S]*?#efa91a[\s\S]*?#ffc52a[\s\S]*?#ffd846[\s\S]*?#ffc52a[\s\S]*?#efa91a[\s\S]*?#cf8210/,
    );
    expect(defs).toMatch(
      /site-nav-arc-gradient[\s\S]*?#df9415[\s\S]*?#f6b11d[\s\S]*?#ffca2b[\s\S]*?#ffe24b[\s\S]*?#ffca2b[\s\S]*?#f6b11d[\s\S]*?#df9415/,
    );
    expect(defs).not.toMatch(/<filter|feGaussianBlur/);
  });

  it('renders a responsive, filter-free open stroke and draws it start to end', () => {
    const arc = cssRule(/body \.homepage-header \.nav-arc/);
    const strokes = cssRule(
      /body \.homepage-header \.nav-arc__under,\s*body \.homepage-header \.nav-arc__core/,
    );
    const under = cssRule(/body \.homepage-header \.nav-arc__under/);
    const core =
      headerCss.match(
        /body \.homepage-header \.nav-arc__core\s*\{[^{}]*stroke: url\("#site-nav-arc-gradient"\);[^{}]*\}/,
      )?.[0] ?? '';
    const keyframes = slice(
      '@keyframes site-header-arc-draw',
      '@keyframes site-header-arc-spark-in',
    );

    expect(arc).toContain('inset-inline: 4px;');
    expect(arc).toContain('width: calc(100% - 8px);');
    expect(arc).toContain('height: 16px;');
    expect(`${arc}\n${strokes}\n${under}\n${core}`).not.toContain('filter:');
    expect(arc).toContain('transform: none;');
    expect(strokes).toContain('fill: none;');
    expect(strokes).toContain('stroke-linecap: round;');
    expect(strokes).toContain('stroke-dasharray: 100;');
    expect(strokes).toContain('stroke-dashoffset: 100;');
    expect(strokes).toContain('vector-effect: non-scaling-stroke;');
    expect(under).toContain('stroke: url("#site-nav-arc-body-gradient");');
    expect(under).toContain('stroke-width: 3.2px;');
    expect(core).toContain('stroke: url("#site-nav-arc-gradient");');
    expect(core).toContain('stroke-width: 1.35px;');
    expect(keyframes).toContain('stroke-dashoffset: 100;');
    expect(keyframes).toContain('stroke-dashoffset: 0;');
    expect(headerCss).not.toContain('url("/site/nav-crescent.svg")');
    expect(`${arc}\n${strokes}\n${under}\n${core}\n${keyframes}`).not.toMatch(
      /clip-path|scaleX\(|radial-gradient\(|feGaussianBlur/,
    );
  });

  it('uses exact hover, press, active, and leave timing without press snapping', () => {
    expect(headerCss).toContain('--site-header-hover: 160ms cubic-bezier(0.22, 0.61, 0.36, 1);');
    expect(headerCss).toContain('--site-header-press: 90ms cubic-bezier(0.2, 0, 0, 1);');
    expect(headerCss).toContain('--site-header-active: 220ms cubic-bezier(0.22, 0.61, 0.36, 1);');
    expect(headerCss).toContain('--site-header-leave: 105ms cubic-bezier(0.4, 0, 1, 1);');
    expect(headerCss).toMatch(
      /\.nav-link:hover:not\(\.active\):not\(\[aria-current\]\) \.nav-arc__under,[\s\S]*?\.nav-link:hover:not\(\.active\):not\(\[aria-current\]\) \.nav-arc__core\s*\{[\s\S]*?stroke-dashoffset: 0;[\s\S]*?transition:[\s\S]*?stroke-dashoffset var\(--site-header-hover\),/,
    );
    expect(headerCss).toMatch(
      /\.nav-link\.active \.nav-arc,[\s\S]*?\.nav-link\[aria-current\] \.nav-arc,[\s\S]*?\.nav-link:focus-visible \.nav-arc\s*\{[\s\S]*?opacity: 0 !important;/,
    );
    expect(headerCss).not.toContain('site-header-current-beacon');

    const press = cssRule(/body \.homepage-header \.nav-link:active/);
    const pressedUnder = cssRule(/body \.homepage-header \.nav-link:active \.nav-arc__under/);
    const pressedCore = cssRule(/body \.homepage-header \.nav-link:active \.nav-arc__core/);
    expect(press).toContain('transform: translateY(1px);');
    expect(press).toContain('transition-duration: 90ms;');
    expect(pressedUnder).toContain('stroke-width: 3.45px;');
    expect(pressedCore).toContain('stroke-width: 1.65px;');
    expect(`${pressedUnder}\n${pressedCore}`).not.toMatch(/stroke-dashoffset|animation:/);
  });

  it('uses unified end assets and one-pixel handoffs at every ribbon size', () => {
    for (const contract of [
      ['240px', '48px', '239px', '47px'],
      ['205px', '41px', '204px', '40px'],
      ['112px', '24px', '111px', '23px'],
    ]) {
      const [left, right, start, end] = contract;
      expect(headerCss).toMatch(
        new RegExp(
          `--site-header-left-plate-w: ${left};[\\s\\S]*?--site-header-right-cap-w: ${right};[\\s\\S]*?--site-header-main-start: ${start};[\\s\\S]*?--site-header-main-end: ${end};`,
        ),
      );
    }
    expect(headerCss).toMatch(
      /\.homepage-header\.homepage-header::before\s*\{[\s\S]*?width: var\(--site-header-left-plate-w\);[\s\S]*?url\("\/site\/header-left-assembly\.svg"\);/,
    );
    expect(headerCss).toMatch(
      /\.homepage-header\.homepage-header::after\s*\{[\s\S]*?width: var\(--site-header-right-cap-w\);[\s\S]*?url\("\/site\/header-ribbon-cap\.svg"\);/,
    );
    expect(headerCss).toMatch(
      /\.header-logo-container::after\s*\{[\s\S]*?content: none;[\s\S]*?display: none;/,
    );

    expect(headerLeftSvg).toContain('viewBox="0 0 240 112"');
    expect(headerLeftSvg).toContain('preserveAspectRatio="none"');
    expect(headerLeftSvg).toMatch(/d="M240 1H40[\s\S]*?H240Z"/);
    expect(headerLeftSvg).toContain('<path d="M215 22V90"');
    expect(headerLeftSvg).toContain('<path d="M214 22V90"');
    expect(headerRightSvg).toContain('viewBox="0 0 48 112"');
    expect(headerRightSvg).toMatch(/d="M0 1H12[\s\S]*?H0Z"/);

    expect(headerLeftMobileSvg).toContain('viewBox="0 0 112 72"');
    expect(headerLeftMobileSvg).toContain('preserveAspectRatio="none"');
    expect(headerLeftMobileSvg).toContain('M55 5 67 8 77.5 15.5');
    expect(headerLeftMobileSvg).toContain('d="M104 12V60"');
    expect(headerLeftMobileSvg).toContain('d="M111 1H112M111 71H112"');
    expect(headerRightMobileSvg).toContain('viewBox="0 0 24 72"');
    expect(headerRightMobileSvg).toMatch(/d="M0 1h6[\s\S]*?H0Z"/);

    for (const asset of [
      headerLeftSvg,
      headerRightSvg,
      headerLeftMobileSvg,
      headerRightMobileSvg,
    ]) {
      expect(asset).toMatch(/#0b1520[\s\S]*?#050a12[\s\S]*?#02050a/);
      expect(asset).toContain('<stop offset="0" stop-color="#f4dc99"/>');
      expect(asset).toContain('<stop offset="1" stop-color="#9a681f"/>');
    }
  });

  it('uses a symmetrical compact shell and purpose-built phone, tablet, and laptop menus', () => {
    const aaaStart = headerCss.indexOf('/* AAA compact navigation:');
    const aaaEnd = headerCss.indexOf('@media (prefers-reduced-motion: reduce)', aaaStart);
    const compact = headerCss.slice(aaaStart, aaaEnd);

    expect(sharedPlayHeader).toContain('<div class="header-menu-scrim" aria-hidden="true"></div>');
    expect(sharedCommunityHeader).toContain(
      '<div class="header-menu-scrim" aria-hidden="true"></div>',
    );
    expect(compact).toContain('@media (max-width: 1151px)');
    expect(compact).toContain('url("/site/header-compact-shell.svg")');
    expect(headerCss).toContain('@media (min-width: 1152px) and (max-width: 1399px)');
    expect(headerCss).toContain('grid-template-columns: 64px minmax(0, 1fr) 194px;');
    expect(compact).toContain('width: min(860px, calc(100vw - 32px));');
    expect(compact).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(compact).toContain('@media (min-width: 768px) and (max-width: 1024px)');
    expect(compact).toContain('width: min(420px, calc(100vw - 24px));');
    expect(compact).toContain('@media (max-width: 767px)');
    expect(compact).toContain('position: fixed;');
    expect(compact).toContain('grid-template-columns: 1fr;');
    expect(compact).toContain('min-height: 52px;');
    expect(compact).toContain('body.site-header-menu-open');
    expect(compact).toContain('overflow-y: auto;');
    expect(compact).toContain('body .homepage-header.menu-open + .header-menu-scrim');

    expect(headerCompactShellSvg).toContain('viewBox="0 0 1200 76"');
    expect(headerCompactShellSvg).toContain('preserveAspectRatio="none"');
    expect(headerCompactShellSvg).toContain('shape-rendering="geometricPrecision"');
    expect(headerCompactShellSvg).toContain('M12 1H1188L1199 12V64L1188 75H12L1 64V12Z');
    expect(headerCompactShellSvg).toMatch(/#0b1724[\s\S]*?#06101a[\s\S]*?#02060c/);
    expect(headerCompactShellSvg).toMatch(/#f4dc99[\s\S]*?#d8a343[\s\S]*?#9a681f/);
    expect(headerCompactShellSvg).not.toMatch(/<filter|feGaussianBlur|noise/i);
  });
  it('uses dedicated crisp artwork for every header control state', () => {
    expect(headerCss.match(/url\("\/site\/header-music-note\.png"\)/g)).toHaveLength(2);
    expect(headerCss).toContain('url("/site/header-menu-burger-v2.svg")');
    expect(headerCss).toContain('url("/site/header-close.svg")');
    expect(headerCss).toContain('url("/site/header-control-focus.svg")');
    expect(headerCss).toContain('url("/site/header-control-frame.svg")');
    expect(headerCss).toMatch(/\.homepage-music-btn\.is-muted::after\s*\{\s*content: "";/);
    expect(headerCss).toMatch(
      /\.homepage-music-btn::after,[\s\S]*?\.mobile-menu-toggle::after\s*\{[\s\S]*?inset: -4px;[\s\S]*?header-control-focus\.svg[\s\S]*?opacity: 0;/,
    );
    expect(headerCss).toMatch(
      /\.homepage-music-btn:focus-visible::after,[\s\S]*?\.mobile-menu-toggle:focus-visible::after\s*\{\s*opacity: 1;/,
    );
    expect(headerCss).toMatch(
      /@layer shell\s*\{[\s\S]*?\.homepage-music-btn:focus-visible,[\s\S]*?\.mobile-menu-toggle:focus-visible\s*\{[\s\S]*?outline: none !important;/,
    );

    for (const asset of [headerMenuSvg, headerCloseSvg]) {
      expect(asset).toContain('viewBox="0 0 32 32"');
      expect(asset).toContain('shape-rendering="geometricPrecision"');
      expect(asset).toMatch(/#fff3bd[\s\S]*?#f4c554[\s\S]*?#c98218/);
      expect(asset).not.toMatch(/<filter|feGaussianBlur/);
    }
    expect(headerMusicPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(headerMusicPng.readUInt32BE(16)).toBe(128);
    expect(headerMusicPng.readUInt32BE(20)).toBe(128);
    expect(headerMusicPng[25]).toBe(6);
    expect(headerCss).toContain('filter: opacity(0.58);');
    expect(headerMenuSvg).toContain('d="M7 7.5h18v4H7ZM7 14h18v4H7ZM7 20.5h18v4H7Z"');
    expect(headerCloseSvg).toContain('d="M7 7 25 25M25 7 7 25"');
    expect(headerControlFocusSvg).toContain('viewBox="0 0 64 64"');
    expect(headerControlFocusSvg).toContain('preserveAspectRatio="none"');
    expect(headerControlFocusSvg).toContain('shape-rendering="geometricPrecision"');
    expect(headerControlFocusSvg).toMatch(/#fff3bd[\s\S]*?#ffe499[\s\S]*?#c98218/);
    expect(headerControlFocusSvg.match(/fill-rule="evenodd"/g)).toHaveLength(2);
    expect(headerControlFocusSvg).not.toMatch(/<filter|feGaussianBlur/);
    expect(headerControlFrameSvg).toContain('viewBox="0 0 64 64"');
    expect(headerControlFrameSvg).toContain('preserveAspectRatio="none"');
    expect(headerControlFrameSvg).toContain('shape-rendering="geometricPrecision"');
    expect(headerControlFrameSvg).toContain('M11 2H53L62 11V53L53 62H11L2 53V11Z');
    expect(headerControlFrameSvg).toMatch(/#fff0b3[\s\S]*?#d8a343[\s\S]*?#9a681f[\s\S]*?#4d2f0e/);
    expect(headerControlFrameSvg).not.toMatch(/<filter|feGaussianBlur|noise/i);
  });

  it('uses a restrained glass selected plaque while reserving the arc for hover only', () => {
    expect(headerCss).toMatch(
      /\.nav-link::before\s*\{[\s\S]*?border: 1px solid rgba\(244, 215, 138, 0\.12\);[\s\S]*?border-radius: 4px;[\s\S]*?rgba\(11, 20, 30, 0\.9\)[\s\S]*?clip-path: none;[\s\S]*?translateY\(1px\) scale\(0\.96\);/,
    );
    expect(headerCss).toMatch(
      /\.nav-link\.active::before,[\s\S]*?\.nav-link\[aria-current\]::before\s*\{[\s\S]*?opacity: 1;[\s\S]*?site-header-selected-in 200ms/,
    );
    expect(headerCss).toMatch(
      /\.nav-link\.active \.nav-arc,[\s\S]*?\.nav-link\[aria-current\] \.nav-arc,[\s\S]*?\.nav-link:focus-visible \.nav-arc\s*\{[\s\S]*?opacity: 0 !important;/,
    );
    expect(headerCss).toMatch(
      /@keyframes site-header-selected-in[\s\S]*?translateY\(2px\) scale\(0\.96\)[\s\S]*?translateY\(0\) scale\(1\.015\)[\s\S]*?translateY\(0\) scale\(1\)/,
    );
    expect(headerCss).not.toContain('site-header-current-beacon');
    expect(headerCss).not.toMatch(/focus-visible:not\(\.active\).*?\.nav-arc/);
    expect(headerCss).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.nav-link:hover:not\(\.active\):not\(\[aria-current\]\) \.nav-arc/,
    );
  });
  it('uses opacity only for reduced motion and disables dash animation', () => {
    const reduced = slice(
      '@media (prefers-reduced-motion: reduce)',
      '@media (forced-colors: active)',
    );
    expect(reduced).toMatch(/\.nav-arc\s*\{\s*transition: opacity 100ms linear;/);
    expect(reduced).toMatch(
      /transition:\s*opacity 100ms linear,\s*visibility 0s linear 0s !important;/,
    );
    expect(reduced).toMatch(
      /\.nav-arc__under,[\s\S]*?\.nav-arc__core\s*\{[\s\S]*?animation: none !important;[\s\S]*?stroke-dashoffset: 0 !important;[\s\S]*?transition: none !important;/,
    );
    expect(reduced).toMatch(
      /\.nav-arc__spark\s*\{[\s\S]*?animation: none !important;[\s\S]*?transition: opacity 100ms linear;/,
    );
    expect(reduced).not.toContain('site-header-arc-draw var(');
  });
});

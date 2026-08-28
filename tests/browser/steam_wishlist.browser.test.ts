import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { resolveTheme, themeCssVars } from '../../src/ui/theme';
import '../../src/styles/index.css';

const originalViewport = { width: 1280, height: 800 };
const parchmentVars = themeCssVars(resolveTheme({ preset: 'parchment', custom: {} }));

afterEach(async () => {
  document.body.innerHTML = '';
  document.body.className = '';
  for (const name of Object.keys(parchmentVars))
    document.documentElement.style.removeProperty(name);
  await page.viewport(originalViewport.width, originalViewport.height);
});

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function required<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`missing ${label}`);
  return value;
}

function icon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ui-icon');
  return svg;
}

function mountHeader(labels: string[], desktopExit = false): HTMLElement {
  const header = element('header', 'homepage-header');
  const logo = element('div', 'header-logo-container');
  logo.appendChild(element('button', 'header-logo-btn'));
  const toggle = element('button', 'mobile-menu-toggle');
  const menu = element('div', 'header-menu-container');
  const nav = element('nav', 'homepage-nav');
  const list = element('ul', 'nav-list');
  for (const label of labels) {
    const item = element('li', 'nav-item');
    item.appendChild(element('button', 'nav-link', label));
    list.appendChild(item);
  }
  nav.appendChild(list);

  const actions = element('div', 'header-actions');
  actions.appendChild(element('button', 'homepage-music-btn'));
  if (desktopExit) actions.appendChild(element('button', 'desktop-login-exit', 'Spiel beenden'));
  const wishlist = element('a', 'steam-wishlist steam-wishlist-cta');
  wishlist.appendChild(icon());
  wishlist.appendChild(element('span', '', 'Auf Steam-Wunschliste setzen'));
  actions.appendChild(wishlist);
  const donate = element('a', 'donate-cta', 'Spenden');
  donate.prepend(icon());
  actions.appendChild(donate);
  menu.append(nav, actions);
  header.append(logo, toggle, menu);
  document.body.appendChild(header);
  return header;
}

function rgb(value: string): [number, number, number] {
  const channels = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels?.length !== 3) throw new Error(`not an RGB colour: ${value}`);
  return channels as [number, number, number];
}

function hex(value: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const linear = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Steam wishlist responsive shell', () => {
  it('collapses the localized menu through the 1120px boundary', async () => {
    await page.viewport(1120, 800);
    const header = mountHeader([
      'Spielen',
      'Bestenlisten',
      'Wiki',
      'Neuigkeiten',
      'Herunterladen',
      'Einloggen/Registrieren',
    ]);
    const menu = required(
      header.querySelector<HTMLElement>('.header-menu-container'),
      '.header-menu-container',
    );
    const toggle = required(
      header.querySelector<HTMLElement>('.mobile-menu-toggle'),
      '.mobile-menu-toggle',
    );
    expect(getComputedStyle(menu).display).toBe('none');
    expect(getComputedStyle(toggle).display).toBe('flex');
    expect(header.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('keeps long German actions inside the first 1121px desktop header', async () => {
    await page.viewport(1121, 800);
    const header = mountHeader([
      'Spielen',
      'Bestenlisten',
      'Wiki',
      'Neuigkeiten',
      'Herunterladen',
      'Einloggen/Registrieren',
    ]);
    const actions = required(
      header.querySelector<HTMLElement>('.header-actions'),
      '.header-actions',
    );
    const wishlist = required(
      header.querySelector<HTMLElement>('.steam-wishlist-cta'),
      '.steam-wishlist-cta',
    );
    expect(actions.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(wishlist.getBoundingClientRect().width).toBe(40);
    expect(
      getComputedStyle(required(wishlist.querySelector('span'), 'wishlist label')).display,
    ).toBe('none');
  });

  it.each([1121, 1200, 1281, 1366, 1440])(
    'keeps the borderless desktop Exit, wishlist, and Donate clear at %ipx',
    async (width) => {
      await page.viewport(width, 800);
      document.body.classList.add('desktop-app');
      const header = mountHeader(
        [
          'Spielen',
          'Bestenlisten',
          'Wiki',
          'Neuigkeiten',
          'Herunterladen',
          'Einloggen/Registrieren',
        ],
        true,
      );
      const nav = required(header.querySelector<HTMLElement>('.homepage-nav'), '.homepage-nav');
      const actions = required(
        header.querySelector<HTMLElement>('.header-actions'),
        '.header-actions',
      );
      const navBox = nav.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();

      expect(
        required(header.querySelector<HTMLButtonElement>('.desktop-login-exit'), 'Exit').hidden,
      ).toBe(false);
      expect(actionsBox.right).toBeLessThanOrEqual(window.innerWidth);
      expect(actionsBox.top).toBeGreaterThanOrEqual(navBox.bottom);
    },
  );

  it('returns the borderless German header to a non-overlapping row at 1441px', async () => {
    await page.viewport(1441, 800);
    document.body.classList.add('desktop-app');
    const header = mountHeader(
      ['Spielen', 'Bestenlisten', 'Wiki', 'Neuigkeiten', 'Herunterladen', 'Einloggen/Registrieren'],
      true,
    );
    const navBox = required(
      header.querySelector<HTMLElement>('.homepage-nav'),
      '.homepage-nav',
    ).getBoundingClientRect();
    const actionsBox = required(
      header.querySelector<HTMLElement>('.header-actions'),
      '.header-actions',
    ).getBoundingClientRect();

    expect(actionsBox.right).toBeLessThanOrEqual(window.innerWidth);
    expect(navBox.right).toBeLessThanOrEqual(actionsBox.left);
    expect(actionsBox.top).toBeLessThan(navBox.bottom);
  });

  it('keeps the wishlist suppressed in a borderless Steam build', async () => {
    await page.viewport(1121, 800);
    document.body.classList.add('desktop-app', 'steam-build');
    const header = mountHeader(['Spielen', 'Bestenlisten', 'Wiki'], true);
    const wishlist = required(
      header.querySelector<HTMLElement>('.steam-wishlist'),
      '.steam-wishlist',
    );
    const actionsBox = required(
      header.querySelector<HTMLElement>('.header-actions'),
      '.header-actions',
    ).getBoundingClientRect();

    expect(getComputedStyle(wishlist).display).toBe('none');
    expect(actionsBox.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('keeps every fixed dark wishlist plate above AA contrast on Parchment', () => {
    for (const [name, value] of Object.entries(parchmentVars)) {
      document.documentElement.style.setProperty(name, value);
    }
    const header = element('a', 'steam-wishlist-cta', 'Wishlist on Steam');
    const footer = element('a', 'social-link steam-wishlist-social', 'Wishlist on Steam');
    const chip = element('a', 'community-link steam-wishlist-chip', 'Wishlist on Steam');
    document.body.append(header, footer, chip);

    for (const [control, stops] of [
      [header, ['#1b1b26', '#0d0d14']],
      [footer, ['#1b1b26', '#0d0d14']],
      [chip, ['#2c2c3a', '#15151f']],
    ] as const) {
      const foreground = rgb(getComputedStyle(control).color);
      for (const stop of stops) expect(contrast(foreground, hex(stop))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

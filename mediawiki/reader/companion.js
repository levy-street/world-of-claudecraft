import chromeCss from './companion/woc-chrome.css?raw';
import premiumCss from './companion/woc-premium.css?raw';
import { COMPANION_FILES, CREST } from './companion_assets.js';

/** Repoint the unmodified family stylesheets at the same assets in either reader. */
export function mountCompanion(assetUrl = (path) => path) {
  const cssUrl = (path) => 'url(' + JSON.stringify(assetUrl(path)) + ')';
  const family = document.createElement('style');
  family.textContent = (chromeCss + '\n' + premiumCss).replace(
    /url\('([^']+)'\)/g,
    (original, url) => (COMPANION_FILES[url] ? cssUrl(COMPANION_FILES[url]) : original),
  );
  document.head.prepend(family);
  for (const logo of document.querySelectorAll('[data-companion-crest]'))
    logo.src = assetUrl(CREST);
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = assetUrl(CREST);
  document.head.append(icon);
  const root = document.documentElement;
  for (const kind of ['drakelands', 'galecrest', 'thornpeak']) {
    root.style.setProperty(
      '--wiki-' + kind,
      cssUrl(COMPANION_FILES['/website-card-' + kind + '.webp']),
    );
  }
  const theme = document.querySelector('.theme-toggle');
  const paint = (day) => {
    document.body.classList.toggle('day', day);
    theme.querySelector('.tool-label').textContent = day ? 'Day' : 'Night';
    theme.setAttribute('aria-label', day ? 'Switch to night theme' : 'Switch to day theme');
    theme.title = theme.getAttribute('aria-label');
  };
  let day = false;
  try {
    day = localStorage.getItem('woc-theme') === 'day';
  } catch {}
  paint(day);
  theme.addEventListener('click', () => {
    const next = !document.body.classList.contains('day');
    paint(next);
    try {
      localStorage.setItem('woc-theme', next ? 'day' : 'night');
    } catch {}
  });
  const switcher = document.querySelector('.site-switch');
  const toggle = switcher.querySelector('button');
  const pop = switcher.querySelector('.site-switch-pop');
  const show = (open) => {
    pop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => show(pop.hidden));
  document.addEventListener('click', (e) => {
    if (!switcher.contains(e.target)) show(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      show(false);
      toggle.focus();
    }
  });
  const refreshNav = () => {
    for (const a of document.querySelectorAll('.app-nav a')) {
      // The offline reader routes by #hash; the static site gives each page a path.
      const active = a.hash
        ? a.hash === (location.hash || '#Main%20Page')
        : a.pathname === location.pathname;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  document.querySelector('.skip-content').addEventListener('click', (event) => {
    event.preventDefault();
    const article = document.querySelector('#view');
    article.focus();
    article.scrollIntoView({ block: 'start' });
  });
  refreshNav();
  window.addEventListener('hashchange', refreshNav);
}

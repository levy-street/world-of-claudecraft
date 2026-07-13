// Project-wide localization E2E audit.
// Run with the Vite dev server available at GAME_URL or http://localhost:5173.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SCREENSHOT_DIR = path.resolve('tmp/localization-e2e');
const LOW_GFX = process.env.LOCALIZATION_E2E_GFX ?? 'low';
const WAIT_TIMEOUT = 45000;

const SUPPORTED_LOCALES = [
  'en',
  'es',
  'es_ES',
  'fr_FR',
  'fr_CA',
  'en_CA',
  'it_IT',
  'de_DE',
  'zh_CN',
  'zh_TW',
  'ko_KR',
  'ja_JP',
  'pt_BR',
  'ru_RU',
];

const DEEP_LOCALES = ['en', 'de_DE', 'fr_FR', 'ru_RU', 'ja_JP', 'zh_CN', 'zh_TW', 'ko_KR'];

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile-portrait', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'mobile-landscape', width: 844, height: 390, isMobile: true, hasTouch: true },
];

const MOBILE_AUDIT_ROOTS = [
  '#start-screen',
  '#offline-select',
  '#mobile-preflight',
  '#mobile-combat-controls',
  '#mobile-extra-controls',
  '#actionbar',
  '#options-menu',
  '#spellbook',
  '#quest-dialog',
  '#quest-log-window',
  '#vendor-window',
  '#market-window',
  '#social-window',
  '#trade-window',
  '#bags',
  '#chat-input',
];

const FOCUS_SELECTORS = [
  '.mobile-menu-toggle',
  '#header-logo-btn',
  '#lang-select',
  '#nav-btn-play',
  '#server-select-trigger',
  '#btn-play',
  '#btn-start-offline',
  '#actionbar .action-btn:not(.empty)',
  '#options-menu .btn',
  '#options-menu .x-btn',
  '#spellbook .spell-row',
  '#quest-dialog .qd-list-item',
  '#quest-log-window .ql-item',
  '#vendor-window .vendor-item',
  '#market-window .mkt-tab',
  '#market-window .mkt-btn',
  '#market-window .mkt-list-btn',
  '#social-window .soc-tab',
  '#social-window .soc-x',
  '#social-window .soc-name.soc-link',
  '#trade-window .trade-item.mine',
  '#trade-window .btn',
  '#trade-copper',
  '#bags .bag-item',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function languageTag(locale) {
  return locale.replace('_', '-');
}

function siteUrlForLocale(locale) {
  return locale === 'en'
    ? 'https://worldofclaudecraft.com/'
    : `https://worldofclaudecraft.com/?lang=${locale}`;
}

function localUrlForLocale(locale) {
  const url = new URL(BASE_URL);
  url.searchParams.set('lang', locale);
  if (!url.searchParams.has('gfx')) url.searchParams.set('gfx', LOW_GFX);
  return url.toString();
}

function isProjectStatsUrl(url) {
  try {
    return new URL(url).pathname.endsWith('/api/project-stats');
  } catch {
    return url.includes('/api/project-stats');
  }
}

function isAllowedBrowserError(text) {
  return (
    /Failed to fetch project stats|project-stats/i.test(text) ||
    (/Failed to load resource/i.test(text) && /502|Bad Gateway/i.test(text)) ||
    /fullscreen|screen\.orientation|orientation\.lock/i.test(text)
  );
}

function isAllowedNetworkIssue(url) {
  return isProjectStatsUrl(url);
}

async function waitForServer(url, timeoutMs = 20000) {
  const probe = new URL(url);
  probe.pathname = '/';
  probe.search = '';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(probe);
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`Timeout waiting for dev server at ${probe.toString()}`);
}

async function newAuditedPage(browser, viewport, label) {
  const page = await browser.newPage();
  const diagnostics = [];
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`PAGEERROR ${label}: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isAllowedBrowserError(text)) return;
    diagnostics.push(`CONSOLE ${label}: ${text}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400 || isAllowedNetworkIssue(response.url())) return;
    diagnostics.push(`RESPONSE ${label}: ${status} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    if (isAllowedNetworkIssue(request.url())) return;
    const failure = request.failure()?.errorText ?? 'request failed';
    diagnostics.push(`REQUEST ${label}: ${failure} ${request.url()}`);
  });
  return {
    page,
    assertNoDiagnostics() {
      if (diagnostics.length > 0) {
        throw new Error(
          `Browser diagnostics failed for ${label}:\n${diagnostics.slice(0, 8).join('\n')}`,
        );
      }
    },
  };
}

async function gotoLocale(page, locale) {
  await page.goto(localUrlForLocale(locale), {
    waitUntil: 'domcontentloaded',
    timeout: WAIT_TIMEOUT,
  });
  await page.waitForSelector('#lang-select', { timeout: WAIT_TIMEOUT });
  await sleep(250);
}

async function assertHomepageLocale(page, locale) {
  const expectedLang = languageTag(locale);
  const expectedSiteUrl = siteUrlForLocale(locale);
  const result = await page.evaluate(() => {
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const jsonLd = document.getElementById('structured-data');
    let parsedJsonLd = null;
    try {
      parsedJsonLd = jsonLd?.textContent ? JSON.parse(jsonLd.textContent) : null;
    } catch {
      parsedJsonLd = null;
    }
    return {
      htmlLang: document.documentElement.lang,
      selectedLanguage: document.querySelector('#lang-select')?.value ?? '',
      title: document.title,
      canonicalHref: canonical?.getAttribute('href') ?? '',
      ogUrl: ogUrl?.getAttribute('content') ?? '',
      jsonLdLanguage: parsedJsonLd?.inLanguage ?? '',
      jsonLdUrl: parsedJsonLd?.url ?? '',
      playText: document.querySelector('#nav-btn-play')?.textContent?.trim() ?? '',
    };
  });
  const currentUrl = new URL(page.url());
  check(
    result.htmlLang === expectedLang,
    `${locale}: expected html lang ${expectedLang}, got ${result.htmlLang}`,
  );
  check(result.selectedLanguage === locale, `${locale}: language selector did not keep ${locale}`);
  check(
    currentUrl.searchParams.get('lang') === locale,
    `${locale}: URL did not include lang=${locale}`,
  );
  check(result.title.length > 10, `${locale}: document title is missing`);
  check(
    result.canonicalHref === expectedSiteUrl,
    `${locale}: canonical URL mismatch: ${result.canonicalHref}`,
  );
  check(result.ogUrl === expectedSiteUrl, `${locale}: Open Graph URL mismatch: ${result.ogUrl}`);
  check(
    result.jsonLdLanguage === expectedLang,
    `${locale}: JSON-LD language mismatch: ${result.jsonLdLanguage}`,
  );
  check(
    result.jsonLdUrl === expectedSiteUrl,
    `${locale}: JSON-LD URL mismatch: ${result.jsonLdUrl}`,
  );
  check(result.playText.length > 0, `${locale}: play nav text is empty`);
}

async function switchLanguage(page, locale) {
  await page.select('#lang-select', locale);
  await page.waitForFunction(
    (expected) => {
      return (
        document.documentElement.lang === expected &&
        new URL(location.href).searchParams.get('lang') === expected.replace('-', '_')
      );
    },
    { timeout: WAIT_TIMEOUT },
    languageTag(locale),
  );
  await assertHomepageLocale(page, locale);
}

async function assertNoVisibleMarkers(page, label) {
  const failures = await page.evaluate(() => {
    const markerPattern = /\b(TODO|TBD|FIXME|PLACEHOLDER|TRANSLATE|LOREM)\b/i;
    const keyPattern =
      /\b(?:seo|hud|questUi|itemUi|abilityUi|worldContent|entities|mobilePreflight|auth|errors)\.[A-Za-z0-9_.]+/;
    const unresolvedPattern = /\{[A-Za-z][A-Za-z0-9_]*\}|\$[NCd]/;
    const isVisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return [...document.body.querySelectorAll('*')]
      .filter(isVisible)
      .map((el) => ({
        label: cssPath(el),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((entry) => entry.text.length > 0)
      .filter(
        (entry) =>
          markerPattern.test(entry.text) ||
          keyPattern.test(entry.text) ||
          unresolvedPattern.test(entry.text),
      )
      .slice(0, 12);

    function cssPath(el) {
      if (el.id) return `#${el.id}`;
      const classes = [...el.classList]
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${classes}`;
    }
  });
  check(
    failures.length === 0,
    `${label}: visible localization markers found:\n${failures.map((f) => `${f.label}: ${f.text}`).join('\n')}`,
  );
}

async function assertNoHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const openPanels = [...document.querySelectorAll('.window, .panel, #start-screen, #ui')]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.overflowX !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map((el) => describe(el, `${el.scrollWidth}px > ${el.clientWidth}px`))
      .slice(0, 10);
    return {
      pageOverflow: Math.max(doc.scrollWidth, body.scrollWidth) > window.innerWidth + 2,
      docWidth: doc.scrollWidth,
      bodyWidth: body.scrollWidth,
      viewportWidth: window.innerWidth,
      openPanels,
    };

    function describe(el, detail) {
      const id = el.id ? `#${el.id}` : '';
      const klass = [...el.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${klass} ${detail}`;
    }
  });
  check(
    !result.pageOverflow,
    `${label}: page has horizontal overflow (${result.docWidth}/${result.bodyWidth} > ${result.viewportWidth})`,
  );
  check(
    result.openPanels.length === 0,
    `${label}: open panels have horizontal overflow:\n${result.openPanels.join('\n')}`,
  );
}

async function assertNoClippedText(page, label) {
  const failures = await page.evaluate(() => {
    const selector = [
      'button',
      'input',
      'select',
      'textarea',
      '.panel-title',
      '.qd-text',
      '.qd-obj',
      '.ql-item',
      '.spell-name',
      '.spell-sub',
      '.vendor-item',
      '.bag-item',
      '.mkt-row',
      '.mkt-note',
      '#error-msg',
      '#banner',
    ].join(',');
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          rect.width <= 0 ||
          rect.height <= 0
        )
          return false;
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return false;
        return el.scrollWidth > el.clientWidth + 2;
      })
      .map((el) => {
        const id = el.id ? `#${el.id}` : '';
        const klass = [...el.classList]
          .slice(0, 3)
          .map((name) => `.${name}`)
          .join('');
        const text = (el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        return `${el.tagName.toLowerCase()}${id}${klass}: ${el.scrollWidth}px > ${el.clientWidth}px (${text.slice(0, 80)})`;
      })
      .slice(0, 12);
  });
  check(failures.length === 0, `${label}: clipped text candidates found:\n${failures.join('\n')}`);
}

async function assertAccessibleNames(page, label) {
  const failures = await page.evaluate(() => {
    const selector = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="tab"]',
      '[role="option"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const symbolOnly = new Set(['×', '✕', '...', '⋯', '☰', '◎', '✦', '✹', '▦', '◇']);
    return [...document.querySelectorAll(selector)]
      .filter((el) => isVisible(el) && !el.disabled && el.getAttribute('aria-hidden') !== 'true')
      .map((el) => {
        const aria = el.getAttribute('aria-label')?.trim() ?? '';
        const ariaLabelledBy = labelledBy(el);
        const label = nativeLabel(el);
        const title = el.getAttribute('title')?.trim() ?? '';
        const placeholder = el.getAttribute('placeholder')?.trim() ?? '';
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const value = ['button', 'submit', 'reset'].includes(el.getAttribute('type') ?? '')
          ? (el.getAttribute('value') ?? '')
          : '';
        const name = aria || ariaLabelledBy || label || title || placeholder || text || value;
        const hasSemanticName = Boolean(
          aria || ariaLabelledBy || label || title || placeholder || value,
        );
        return {
          label: describe(el),
          name,
          badSymbolName: !hasSemanticName && symbolOnly.has(text),
        };
      })
      .filter((entry) => entry.name.length === 0 || entry.badSymbolName)
      .slice(0, 12);

    function isVisible(el) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    }
    function labelledBy(el) {
      const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      return ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
    }
    function nativeLabel(el) {
      if (el.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit?.textContent?.trim()) return explicit.textContent.trim();
      }
      const parent = el.closest('label');
      return parent?.textContent?.trim() ?? '';
    }
    function describe(el) {
      const id = el.id ? `#${el.id}` : '';
      const klass = [...el.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${klass}`;
    }
  });
  check(
    failures.length === 0,
    `${label}: interactive elements missing accessible names:\n${failures.map((f) => f.label).join('\n')}`,
  );
}

async function assertMobileFormSizes(page, label) {
  const failures = await page.evaluate(() => {
    return [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${describe(el)} font-size ${getComputedStyle(el).fontSize}`)
      .slice(0, 12);

    function describe(el) {
      const id = el.id ? `#${el.id}` : '';
      const klass = [...el.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${klass}`;
    }
  });
  check(
    failures.length === 0,
    `${label}: visible mobile form controls below 16px:\n${failures.join('\n')}`,
  );
}

async function assertMobileTouchTargets(page, label, rootSelectors = MOBILE_AUDIT_ROOTS) {
  const failures = await page.evaluate((roots) => {
    const interactive =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="option"]';
    const results = [];
    for (const rootSelector of roots) {
      const root = document.querySelector(rootSelector);
      if (!root) continue;
      const rootStyle = getComputedStyle(root);
      const rootRect = root.getBoundingClientRect();
      if (
        rootStyle.display === 'none' ||
        rootStyle.visibility === 'hidden' ||
        rootRect.width <= 0 ||
        rootRect.height <= 0
      )
        continue;
      const candidates = root.matches(interactive)
        ? [root, ...root.querySelectorAll(interactive)]
        : [...root.querySelectorAll(interactive)];
      for (const el of candidates) {
        if (el.disabled || getComputedStyle(el).pointerEvents === 'none') continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          rect.width <= 0 ||
          rect.height <= 0
        )
          continue;
        if (rect.width < 39.5 || rect.height < 39.5) {
          results.push(`${describe(el)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }
    return [...new Set(results)].slice(0, 20);

    function describe(el) {
      const id = el.id ? `#${el.id}` : '';
      const klass = [...el.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${klass}`;
    }
  }, rootSelectors);
  check(
    failures.length === 0,
    `${label}: mobile touch targets below 40px:\n${failures.join('\n')}`,
  );
}

async function assertFocusVisible(page, label, selectors = FOCUS_SELECTORS) {
  await page.keyboard.press('Tab');
  const failures = await page.evaluate((candidateSelectors) => {
    const failed = [];
    for (const selector of candidateSelectors) {
      const el = [...document.querySelectorAll(selector)].find((candidate) => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0 &&
          !candidate.disabled
        );
      });
      if (!el || typeof el.focus !== 'function') continue;
      el.focus({ preventScroll: true });
      const style = getComputedStyle(el);
      const outlineWidth = parseFloat(style.outlineWidth) || 0;
      const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
      const hasShadow = style.boxShadow !== 'none';
      if (!hasOutline && !hasShadow) failed.push(selector);
    }
    return failed;
  }, selectors);
  check(
    failures.length === 0,
    `${label}: focused controls lack a visible outline or shadow:\n${failures.join('\n')}`,
  );
}

async function assertContrast(page, label) {
  const failures = await page.evaluate(() => {
    const selector = [
      'button',
      'a',
      'label',
      'input',
      'select',
      'textarea',
      '.panel-title',
      '.qd-text',
      '.qd-obj',
      '.ql-item',
      '.spell-name',
      '.spell-sub',
      '.vendor-item',
      '.bag-item',
      '.mkt-row',
      '.mkt-note',
      '#chatlog div',
      '#combatlog div',
      '#error-msg',
    ].join(',');
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const text = (
          el.textContent ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          ''
        ).trim();
        return (
          text.length > 0 &&
          !el.closest('.visually-hidden') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((el) => {
        const style = getComputedStyle(el);
        const fg = parseColor(style.color);
        const bg = effectiveBackground(el);
        const ratio = contrastRatio(fg, bg);
        const size = parseFloat(style.fontSize) || 12;
        const weight = Number(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
        const minRatio = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        return {
          label: describe(el),
          ratio,
          minRatio,
          text: (el.textContent || el.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60),
        };
      })
      .filter((entry) => entry.ratio + 0.01 < entry.minRatio)
      .map(
        (entry) =>
          `${entry.label} contrast ${entry.ratio.toFixed(2)} < ${entry.minRatio}: ${entry.text}`,
      )
      .slice(0, 12);

    function parseColor(value) {
      const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
      if (!match) return { r: 255, g: 255, b: 255, a: 1 };
      const parts = match[1].split(',').map((part) => part.trim());
      return {
        r: Number(parts[0]),
        g: Number(parts[1]),
        b: Number(parts[2]),
        a: parts[3] === undefined ? 1 : Number(parts[3]),
      };
    }
    function blend(fg, bg) {
      const alpha = fg.a + bg.a * (1 - fg.a);
      if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
        a: alpha,
      };
    }
    function effectiveBackground(el) {
      const chain = [];
      for (let node = el; node; node = node.parentElement) chain.push(node);
      let bg = { r: 8, g: 8, b: 13, a: 1 };
      for (let i = chain.length - 1; i >= 0; i--) {
        const color = parseColor(getComputedStyle(chain[i]).backgroundColor);
        if (color.a > 0) bg = blend(color, bg);
      }
      return bg;
    }
    function luminance(color) {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }
    function contrastRatio(a, b) {
      const light = Math.max(luminance(a), luminance(b));
      const dark = Math.min(luminance(a), luminance(b));
      return (light + 0.05) / (dark + 0.05);
    }
    function describe(el) {
      const id = el.id ? `#${el.id}` : '';
      const klass = [...el.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${klass}`;
    }
  });
  check(failures.length === 0, `${label}: WCAG contrast failures:\n${failures.join('\n')}`);
}

async function assertAuditBasics(page, label, options = {}) {
  await assertNoVisibleMarkers(page, label);
  await assertAccessibleNames(page, label);
  await assertNoHorizontalOverflow(page, label);
  await assertNoClippedText(page, label);
  await assertContrast(page, label);
  if (options.mobile) {
    await assertMobileFormSizes(page, label);
    await assertMobileTouchTargets(page, label);
  }
}

async function assertNonEnglishNotFallback(page, locale, selector, englishText, label) {
  if (locale === 'en' || locale === 'en_CA') return;
  const text = await page.$eval(selector, (el) =>
    (el.textContent ?? el.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim(),
  );
  check(
    !text.includes(englishText),
    `${label}: non-English surface still includes English fallback "${englishText}" in "${text}"`,
  );
}

// Presence zones in the social roster come from the server as canonical English
// (zoneAt().name / dungeon name); the client must re-localize them via
// localizeZone(). Guard both the visible .zone span and the status tooltip so a
// raw English zone name can never leak back into a translated social panel.
async function assertSocialZonesLocalized(page, locale, englishZones, label) {
  if (locale === 'en' || locale === 'en_CA') return;
  const texts = await page.$$eval(
    '#social-window .soc-row .zone, #social-window .soc-row [title]',
    (els) =>
      els.map((el) =>
        `${el.textContent ?? ''} ${el.getAttribute('title') ?? ''}`.replace(/\s+/g, ' ').trim(),
      ),
  );
  for (const english of englishZones) {
    check(
      !texts.some((tx) => tx.includes(english)),
      `${label}: social presence zone still shows English "${english}" in ${JSON.stringify(texts)}`,
    );
  }
}

async function runHomepageLocaleMatrix(browser) {
  const viewport = VIEWPORTS[0];
  const { page, assertNoDiagnostics } = await newAuditedPage(browser, viewport, 'homepage');
  try {
    await gotoLocale(page, 'en');
    await switchLanguage(page, 'es');
    await switchLanguage(page, 'ja_JP');
    for (const locale of SUPPORTED_LOCALES) {
      await gotoLocale(page, locale);
      await assertHomepageLocale(page, locale);
      await assertAuditBasics(page, `homepage ${locale}`);
    }
    assertNoDiagnostics();
    console.log(`OK homepage locale matrix: ${SUPPORTED_LOCALES.length} locales`);
  } finally {
    await page.close();
  }
}

async function runMobileHomepageAudit(page, locale, viewport) {
  await assertAuditBasics(page, `mobile homepage ${locale} ${viewport.name}`, { mobile: true });
  await assertFocusVisible(page, `mobile homepage focus ${locale} ${viewport.name}`, [
    '.mobile-menu-toggle',
    '#header-logo-btn',
    '#btn-offline',
    '#lang-select',
  ]);
  await page.click('.mobile-menu-toggle');
  await page.waitForFunction(
    () => {
      return document.querySelector('.homepage-header')?.classList.contains('menu-open');
    },
    { timeout: WAIT_TIMEOUT },
  );
  await assertAuditBasics(page, `mobile homepage menu ${locale} ${viewport.name}`, {
    mobile: true,
  });
  await assertFocusVisible(page, `mobile homepage menu focus ${locale} ${viewport.name}`, [
    '.mobile-menu-toggle',
    '#header-logo-btn',
    '#nav-btn-play',
    '#nav-btn-highscores',
    '#nav-btn-wiki',
    '#nav-btn-news',
    '#nav-btn-download',
    '#lang-select',
  ]);
  await page.click('.mobile-menu-toggle');
}

async function enterOfflineGame(page, locale, viewport) {
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await page.waitForSelector('#offline-select:not([hidden])', { timeout: WAIT_TIMEOUT });
  await page.click('#btn-start-offline');
  await page.waitForFunction(
    () => {
      const error = document.querySelector('#offline-error');
      const input = document.querySelector('#char-name');
      return (
        error?.textContent?.trim().length > 0 && input?.getAttribute('aria-invalid') === 'true'
      );
    },
    { timeout: WAIT_TIMEOUT },
  );
  await assertAuditBasics(page, `offline validation ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });

  await page.evaluate(() => {
    const input = document.querySelector('#char-name');
    if (input) input.value = '';
  });
  await page.type('#char-name', 'Nara');
  await page.click('#offline-select .mini-class[data-class="mage"]');
  await page.click('#btn-start-offline');

  if (viewport.isMobile) {
    await page.waitForFunction(
      () => {
        const prompt = document.querySelector('#mobile-preflight');
        return (
          prompt &&
          getComputedStyle(prompt).display !== 'none' &&
          prompt.classList.contains('visible') &&
          document.body.classList.contains('mobile-touch')
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    await assertAuditBasics(page, `mobile preflight ${locale} ${viewport.name}`, { mobile: true });
    await page.click('#mobile-preflight-continue');
  }

  await page.waitForFunction(
    () => {
      return Boolean(window.__game?.sim?.player && document.body.classList.contains('game-active'));
    },
    { timeout: 60000, polling: 250 },
  );
  await sleep(800);
  await assertAuditBasics(page, `game entry ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
}

async function setupGameScene(page) {
  const scene = await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    sim.setPlayerLevel(10);
    const player = sim.player;
    player.hp = player.maxHp;
    player.resource = player.maxResource;
    for (const itemId of ['baked_bread', 'spring_water', 'oiled_boots', 'keen_dirk', 'wolf_fang']) {
      sim.addItem(itemId, itemId === 'wolf_fang' ? 3 : 1);
    }
    const entities = [...sim.entities.values()];
    const questNpc = entities.find(
      (entity) => entity.kind === 'npc' && (entity.questIds?.length ?? 0) > 0,
    );
    const vendorNpc = entities.find(
      (entity) => entity.kind === 'npc' && (entity.vendorItems?.length ?? 0) > 0,
    );
    const merchant = entities.find(
      (entity) => entity.kind === 'npc' && entity.templateId === 'the_merchant',
    );
    const wolf =
      entities.find(
        (entity) => entity.kind === 'mob' && entity.templateId === 'forest_wolf' && !entity.dead,
      ) ?? entities.find((entity) => entity.kind === 'mob' && !entity.dead);
    if (questNpc) {
      const pos = sim.groundPos(questNpc.pos.x, questNpc.pos.z - 3);
      player.pos = pos;
      player.prevPos = { ...pos };
      player.facing = 0;
      player.prevFacing = 0;
    }
    return {
      questNpcId: questNpc?.id ?? null,
      vendorNpcId: vendorNpc?.id ?? null,
      merchantId: merchant?.id ?? null,
      wolfId: wolf?.id ?? null,
    };
  });
  check(scene.questNpcId !== null, 'No quest NPC found for localization E2E');
  check(scene.vendorNpcId !== null, 'No vendor NPC found for localization E2E');
  check(scene.merchantId !== null, 'No market NPC found for localization E2E');
  check(scene.wolfId !== null, 'No combat target found for localization E2E');
  return scene;
}

async function runChatAndCombat(page, scene, locale, viewport) {
  await page.evaluate(() => {
    const input = document.querySelector('#chat-input');
    if (input) {
      input.style.display = 'block';
      input.focus();
    }
  });
  await page.type('#chat-input', '42');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('#chatlog div')].some((row) => row.textContent?.includes('42')),
    { timeout: WAIT_TIMEOUT },
  );

  await page.evaluate((wolfId) => {
    const g = window.__game;
    const sim = g.sim;
    const player = sim.player;
    const wolf = sim.entities.get(wolfId);
    if (!wolf) return;
    player.hp = player.maxHp;
    player.resource = player.maxResource;
    const pos = sim.groundPos(wolf.pos.x + 9, wolf.pos.z);
    player.pos = pos;
    player.prevPos = { ...pos };
    player.facing = Math.atan2(wolf.pos.x - player.pos.x, wolf.pos.z - player.pos.z);
    player.prevFacing = player.facing;
    g.input.camYaw = player.facing;
    sim.targetEntity(wolf.id);
    sim.castAbility('fire_blast');
  }, scene.wolfId);
  await page.evaluate(() => document.querySelector('[data-tab="combat"]')?.click());
  await page.waitForFunction(() => document.querySelectorAll('#combatlog div').length > 0, {
    timeout: WAIT_TIMEOUT,
  });
  await assertAuditBasics(page, `chat and combat ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
}

async function runHudOptions(page, locale, viewport) {
  await page.evaluate(() => {
    window.__game.hud.closeAll();
    window.__game.hud.toggleOptionsMenu();
  });
  await page.waitForSelector('#options-menu .opt-btn', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#options-menu .panel-title span',
    'Game Menu',
    `options ${locale} ${viewport.name}`,
  );
  await assertAuditBasics(page, `options ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await page.evaluate(() => window.__game.hud.closeAll());
}

async function runSpellbookAndActions(page, locale, viewport) {
  await page.evaluate(() => {
    window.__game.hud.closeAll();
    window.__game.hud.toggleSpellbook();
  });
  await page.waitForSelector('#spellbook .spell-row', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#spellbook .panel-title span',
    'Spellbook',
    `spellbook ${locale} ${viewport.name}`,
  );
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#actionbar .action-btn[aria-label]',
    'Attack',
    `action bar ${locale} ${viewport.name}`,
  );
  await assertAuditBasics(page, `spellbook and action bar ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await page.evaluate(() => window.__game.hud.closeAll());
}

async function runQuestSurfaces(page, scene, locale, viewport) {
  await page.evaluate((npcId) => {
    const sim = window.__game.sim;
    const npc = sim.entities.get(npcId);
    if (npc) {
      const player = sim.player;
      const pos = sim.groundPos(npc.pos.x, npc.pos.z - 3);
      player.pos = pos;
      player.prevPos = { ...pos };
    }
    window.__game.hud.closeAll();
    window.__game.hud.openQuestDialog(npcId);
  }, scene.questNpcId);
  await page.waitForSelector('#quest-dialog .qd-list-item', { timeout: WAIT_TIMEOUT });
  await assertAuditBasics(page, `npc dialogue ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await page.evaluate(() =>
    document.querySelector('#quest-dialog .qd-list-item[data-quest]')?.click(),
  );
  await sleep(250);
  await page.evaluate(() => document.querySelector('#quest-dialog .btn')?.click());
  await sleep(250);
  await page.evaluate((npcId) => {
    const sim = window.__game.sim;
    if (sim.questLog.size > 0) return;
    const npc = sim.entities.get(npcId);
    const questId = npc?.questIds?.find((id) => sim.questState(id) === 'available');
    if (questId) sim.acceptQuest(questId);
  }, scene.questNpcId);
  await page.evaluate(() => {
    window.__game.hud.closeAll();
    window.__game.hud.toggleQuestLog();
  });
  await page.waitForSelector('#quest-log-window .ql-item', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#quest-log-title',
    'Quest Log',
    `quest log ${locale} ${viewport.name}`,
  );
  await assertAuditBasics(page, `quest log ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await page.evaluate(() => window.__game.hud.closeAll());
}

async function runItemVendorMarket(page, scene, locale, viewport) {
  await page.evaluate((npcId) => {
    window.__game.hud.closeAll();
    window.__game.hud.openVendor(npcId);
  }, scene.vendorNpcId);
  await page.waitForSelector('#vendor-window .vendor-item', { timeout: WAIT_TIMEOUT });
  await page.waitForSelector('#bags .bag-item', { timeout: WAIT_TIMEOUT });
  await assertAuditBasics(page, `inventory and vendor ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });

  await page.evaluate(() => {
    window.__game.hud.closeAll();
    window.__game.hud.openMarket();
  });
  await page.waitForSelector('#market-window [data-tab="sell"]', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#market-window .panel-title span',
    'World Market',
    `market ${locale} ${viewport.name}`,
  );
  await page.evaluate(() => document.querySelector('#market-window [data-tab="sell"]')?.click());
  await page.waitForFunction(
    () => {
      return (
        document.querySelector('#market-window [data-tab="sell"]')?.getAttribute('aria-pressed') ===
        'true'
      );
    },
    { timeout: WAIT_TIMEOUT },
  );
  await page.evaluate(() => document.querySelector('#bags .bag-item')?.click());
  await page.waitForSelector('#mkt-c', { timeout: WAIT_TIMEOUT });
  await page.evaluate(() => {
    for (const id of ['mkt-g', 'mkt-s', 'mkt-c']) {
      const input = document.getElementById(id);
      if (input) input.value = '0';
    }
  });
  await page.evaluate(() => document.querySelector('#market-body .mkt-list-btn')?.click());
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#error-msg')?.textContent?.trim() ?? '';
      return text.length > 0;
    },
    { timeout: WAIT_TIMEOUT },
  );
  await assertAuditBasics(page, `market and error state ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
}

async function runSocialAndTradeSurfaces(page, locale, viewport) {
  await page.evaluate(() => {
    const g = window.__game;
    const player = g.sim.player;
    g.sim.realm = 'Eastbrook';
    g.sim.socialInfo = {
      friends: [
        {
          id: 801,
          name: 'Boro',
          cls: 'warrior',
          level: 12,
          realm: 'Eastbrook',
          online: true,
          zone: 'Eastbrook Vale',
          status: 'online',
        },
      ],
      blocks: [{ id: 802, name: 'Rook' }],
      guild: {
        id: 21,
        name: 'Dawn Wardens',
        rank: 'leader',
        members: [
          {
            id: player.id,
            name: player.name,
            cls: 'mage',
            level: player.level,
            realm: 'Eastbrook',
            online: true,
            zone: 'Eastbrook Vale',
            status: 'online',
            rank: 'leader',
          },
          {
            id: 803,
            name: 'Ilyra',
            cls: 'priest',
            level: 14,
            realm: 'Eastbrook',
            online: true,
            zone: 'Mirefen Marsh',
            status: 'dungeon',
            rank: 'officer',
          },
        ],
      },
    };
    g.hud.closeAll();
    g.hud.toggleSocial();
  });
  await page.waitForSelector('#social-window.open .soc-tab', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#social-window .panel-title span',
    'Social',
    `social ${locale} ${viewport.name}`,
  );
  await assertAuditBasics(page, `social friends ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await assertSocialZonesLocalized(
    page,
    locale,
    ['Eastbrook Vale'],
    `social friends ${locale} ${viewport.name}`,
  );
  await page.click('#social-window .soc-tab[data-tab="guild"]');
  await assertAuditBasics(page, `social guild ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });
  await assertSocialZonesLocalized(
    page,
    locale,
    ['Eastbrook Vale', 'Mirefen Marsh'],
    `social guild ${locale} ${viewport.name}`,
  );
  await page.click('#social-window .soc-tab[data-tab="ignore"]');
  await assertAuditBasics(page, `social ignore ${locale} ${viewport.name}`, {
    mobile: viewport.isMobile,
  });

  await page.evaluate(() => {
    const g = window.__game;
    const tradeInfo = {
      otherPid: 803,
      otherName: 'Ilyra',
      myOffer: { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 17 },
      theirOffer: { items: [{ itemId: 'baked_bread', count: 1 }], copper: 25 },
      myAccepted: false,
      theirAccepted: true,
    };
    Object.defineProperty(g.sim, 'tradeInfo', { configurable: true, get: () => tradeInfo });
    g.sim.tradeSetOffer = () => {};
    g.sim.tradeConfirm = () => {};
    g.sim.tradeCancel = () => {};
    g.hud.closeAll();
    g.hud.updateTradeWindow();
  });
  await page.waitForSelector('#trade-window .trade-cols', { timeout: WAIT_TIMEOUT });
  await assertNonEnglishNotFallback(
    page,
    locale,
    '#trade-window .panel-title span',
    'Trade with',
    `trade ${locale} ${viewport.name}`,
  );
  await assertAuditBasics(page, `trade ${locale} ${viewport.name}`, { mobile: viewport.isMobile });
  await page.evaluate(() => {
    const g = window.__game;
    Object.defineProperty(g.sim, 'tradeInfo', { configurable: true, get: () => null });
    document.querySelector('#trade-window').style.display = 'none';
    document.querySelector('#bags').style.display = 'none';
    g.hud.closeAll();
  });
}

async function runDeepGameScenario(browser, locale, viewport) {
  const label = `${locale} ${viewport.name}`;
  const { page, assertNoDiagnostics } = await newAuditedPage(browser, viewport, label);
  try {
    await gotoLocale(page, locale);
    await assertHomepageLocale(page, locale);
    if (viewport.isMobile) await runMobileHomepageAudit(page, locale, viewport);
    await enterOfflineGame(page, locale, viewport);
    const scene = await setupGameScene(page);
    await runChatAndCombat(page, scene, locale, viewport);
    await runHudOptions(page, locale, viewport);
    await runSpellbookAndActions(page, locale, viewport);
    await runQuestSurfaces(page, scene, locale, viewport);
    await runItemVendorMarket(page, scene, locale, viewport);
    await runSocialAndTradeSurfaces(page, locale, viewport);
    await assertFocusVisible(page, `focus visibility ${label}`);
    await assertNoVisibleMarkers(page, `final visible markers ${label}`);
    await assertNoHorizontalOverflow(page, `final overflow ${label}`);
    const screenshotName = `${locale.replaceAll('_', '-')}-${viewport.name}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: false });
    assertNoDiagnostics();
    console.log(`OK deep locale scenario: ${label}`);
  } finally {
    await page.close();
  }
}

async function runDeepLocaleMatrix(browser) {
  for (const locale of DEEP_LOCALES) {
    for (const viewport of VIEWPORTS) {
      await runDeepGameScenario(browser, locale, viewport);
    }
  }
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log(`Waiting for dev server at ${BASE_URL}`);
  await waitForServer(BASE_URL);
  console.log(`Launching browser from: ${BROWSER_PATH}`);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      '--window-size=1366,900',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
    defaultViewport: { width: 1366, height: 900 },
  });
  try {
    await runHomepageLocaleMatrix(browser);
    await runDeepLocaleMatrix(browser);
    console.log(`Localization E2E completed successfully. Screenshots saved in ${SCREENSHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Localization E2E failed.');
  console.error(error);
  process.exit(1);
});

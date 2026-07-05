// E2E Verification Script: checks homepage layout, view switching, and localization.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      // ignore connection errors
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for server at ${url}`);
}

async function main() {
  console.log('Waiting for dev server and game server to be ready...');
  try {
    await waitForServer('http://localhost:5173');
    await waitForServer('http://127.0.0.1:8787/api/project-stats');
    console.log('Servers are ready.');
  } catch (err) {
    console.error(err.message);
  }

  console.log(`Launching browser from: ${BROWSER_PATH}`);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => {
    console.error(`Browser Page Error: ${e.message}`);
    pageErrors.push(e);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('502') || text.includes('Bad Gateway') || text.includes('project-stats')) {
        console.log(`Ignoring transient browser startup network error: ${text}`);
        return;
      }
      console.error(`Browser Console Error: ${text}`);
      pageErrors.push(new Error(text));
    }
  });

  try {
    console.log(`Navigating to ${URL}...`);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });

    // Verify Title and Meta Description
    const pageTitle = await page.title();
    console.log(`Page Title: "${pageTitle}"`);
    if (pageTitle !== 'World of ClaudeCraft: Classic-Style Web MMO') {
      throw new Error(`Unexpected page title: "${pageTitle}"`);
    }

    const metaDescription = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="description"]');
      return meta ? meta.getAttribute('content') : null;
    });
    console.log(`Meta Description: "${metaDescription}"`);
    if (!metaDescription || !metaDescription.includes('World of ClaudeCraft')) {
      throw new Error(`Unexpected or missing meta description: "${metaDescription}"`);
    }

    // Define views and their corresponding navigation buttons
    const views = [
      { id: '#hero-view', btn: '#nav-btn-play' },
      { id: '#highscores-view', btn: '#nav-btn-highscores' },
      { id: '#news-view', btn: '#nav-btn-news' },
      { id: '#download-view', btn: '#nav-btn-download' }
    ];

    // Helper to assert view visibility
    const assertActiveView = async (activeViewId) => {
      for (const view of views) {
        const isHidden = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return true;
          // check hidden attribute or display styling
          return el.hasAttribute('hidden') || el.style.display === 'none';
        }, view.id);

        const ariaHidden = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          return el ? el.getAttribute('aria-hidden') : null;
        }, view.id);

        if (view.id === activeViewId) {
          if (isHidden) {
            throw new Error(`Expected active view ${view.id} to be visible, but it is hidden.`);
          }
          if (ariaHidden !== 'false') {
            throw new Error(`Expected active view ${view.id} to have aria-hidden="false", got "${ariaHidden}".`);
          }
        } else {
          if (!isHidden) {
            throw new Error(`Expected inactive view ${view.id} to be hidden, but it is visible.`);
          }
          if (ariaHidden !== 'true') {
            throw new Error(`Expected inactive view ${view.id} to have aria-hidden="true", got "${ariaHidden}".`);
          }
        }
      }
    };

    // 1. Initial State Check (Hero view should be active by default)
    console.log('Verifying initial view state (Hero view active)...');
    await assertActiveView('#hero-view');

    // 2. Click through each navigation tab and assert section visibility
    for (const view of views) {
      if (view.id === '#hero-view') continue; // we already verified initial hero state, we'll click it later
      console.log(`Clicking ${view.btn} to open ${view.id}...`);
      await page.click(view.btn);
      // Wait a short time for transitions
      await new Promise((r) => setTimeout(r, 300));
      await assertActiveView(view.id);
    }

    // Go back to Hero view
    console.log('Clicking #nav-btn-play to return to Hero view...');
    await page.click('#nav-btn-play');
    await new Promise((r) => setTimeout(r, 300));
    await assertActiveView('#hero-view');

    // 3. Verify Dynamic Translation (English -> Spanish)
    console.log('Verifying dynamic localization switcher...');
    
    // Check initial English texts
    const engRealmStatusText = await page.evaluate(() => {
      const el = document.querySelector('#project-stats-panel h2');
      return el ? el.textContent.trim() : '';
    });
    console.log(`English Status Title: "${engRealmStatusText}"`);
    if (engRealmStatusText !== 'Realm Status') {
      throw new Error(`Expected English stats title to be "Realm Status", got "${engRealmStatusText}"`);
    }

    // Change language to Spanish (es)
    console.log('Switching language to Spanish (es)...');
    await page.evaluate(() => {
      const select = document.querySelector('#lang-select');
      if (select) {
        select.value = 'es';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Wait for client translation
    await new Promise((r) => setTimeout(r, 300));

    // Verify html lang attribute
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    console.log(`Document lang attribute: "${htmlLang}"`);
    if (htmlLang !== 'es') {
      throw new Error(`Expected html lang to be "es", got "${htmlLang}"`);
    }

    // Verify URL updates to include Spanish lang parameter
    const currentUrl = await page.url();
    console.log(`Current URL: "${currentUrl}"`);
    if (!currentUrl.includes('lang=es')) {
      throw new Error(`Expected URL to include "lang=es", got "${currentUrl}"`);
    }

    // Check Spanish translations
    const espRealmStatusText = await page.evaluate(() => {
      const el = document.querySelector('#project-stats-panel h2');
      return el ? el.textContent.trim() : '';
    });
    console.log(`Spanish Status Title: "${espRealmStatusText}"`);
    if (espRealmStatusText !== 'Estado del Reino') {
      throw new Error(`Expected Spanish stats title to be "Estado del Reino", got "${espRealmStatusText}"`);
    }


    // Switch back to English (en)
    console.log('Switching back to English (en)...');
    await page.evaluate(() => {
      const select = document.querySelector('#lang-select');
      if (select) {
        select.value = 'en';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 300));

    // Verify URL updates to include English lang parameter
    const englishUrl = await page.url();
    console.log(`English URL: "${englishUrl}"`);
    if (!englishUrl.includes('lang=en')) {
      throw new Error(`Expected URL to include "lang=en", got "${englishUrl}"`);
    }

    // Verify back in English
    const engStatusTitle = await page.evaluate(() => {
      const el = document.querySelector('#project-stats-panel h2');
      return el ? el.textContent.trim() : '';
    });
    console.log(`English Status Title restored: "${engStatusTitle}"`);
    if (engStatusTitle !== 'Realm Status') {
      throw new Error(`Expected English stats title to be "Realm Status", got "${engStatusTitle}"`);
    }

    // 4. Verify all new target languages from i18n via URL query parameters
    console.log('Verifying additional target languages via URL query parameters...');
    const langChecks = [
      { code: 'es_ES', expectedPlay: 'Jugar' },
      { code: 'fr_FR', expectedPlay: 'Jouer' },
      { code: 'fr_CA', expectedPlay: 'Jouer' },
      { code: 'en_CA', expectedPlay: 'Play' },
      { code: 'it_IT', expectedPlay: 'Gioca' },
      { code: 'de_DE', expectedPlay: 'Spielen' },
      { code: 'zh_CN', expectedPlay: '开始游戏' },
      { code: 'zh_TW', expectedPlay: '開始遊戲' },
      { code: 'ko_KR', expectedPlay: '플레이' },
      { code: 'ja_JP', expectedPlay: 'プレイ' },
      { code: 'pt_BR', expectedPlay: 'Jogar' },
      { code: 'ru_RU', expectedPlay: 'Играть' }
    ];

    for (const langCheck of langChecks) {
      console.log(`Checking language "${langCheck.code}"...`);
      const langUrl = `${URL}/?lang=${langCheck.code}`;
      await page.goto(langUrl, { waitUntil: 'networkidle0', timeout: 15000 });
      
      const currentHtmlLang = await page.evaluate(() => document.documentElement.lang);
      const expectedHtmlLang = langCheck.code.replace('_', '-');
      if (currentHtmlLang !== expectedHtmlLang) {
        throw new Error(`Expected html lang to be "${expectedHtmlLang}", got "${currentHtmlLang}"`);
      }

      const playText = await page.evaluate(() => {
        const el = document.querySelector('#nav-btn-play');
        return el ? el.textContent.trim() : '';
      });
      console.log(`  [${langCheck.code}] Play nav link text: "${playText}"`);
      if (playText !== langCheck.expectedPlay) {
        throw new Error(`Expected play nav link text for "${langCheck.code}" to be "${langCheck.expectedPlay}", got "${playText}"`);
      }
    }

    if (pageErrors.length > 0) {
      throw new Error(`Page encountered errors during test execution: ${pageErrors[0].message}`);
    }

    console.log('E2E Verification completed successfully! All checks passed.');
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error('E2E Verification Failed!', error);
    await browser.close();
    process.exit(1);
  }
}

main();

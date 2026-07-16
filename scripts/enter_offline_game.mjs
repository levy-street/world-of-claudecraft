// Shared pre-game entry for the mobile_* screenshot / E2E harnesses.
//
// The V16 client shows a single Play CTA and keeps #btn-offline as a HIDDEN legacy
// automation hook, so page.click('#btn-offline') (which needs a visible clickable point)
// throws "Node is either not clickable or not an Element". Firing the element's own
// click() in-page works regardless of visibility. Keeping the one canonical entry flow
// here means a future pre-game UI change is a one-line fix, not a sweep across ~20 scripts.
//
// The caller owns the browser, page, viewport, and navigation: it must page.goto the game
// URL before calling this. This drives Play Offline -> name -> class -> Enter World and
// resolves once the world has had settleMs to load. Post-entry concerns (forcing
// body.mobile-touch in headless, dismissing the mobile preflight, opening a window, the
// screenshot itself) stay in each script.
//
// Before returning, this also dismisses the three overlays that must never appear in a
// captured screenshot (repo-wide rule): the first-spawn intro cinematic/logo, the
// new-adventurer tutorial overlay, and the camera-mode-choice prompt. Every screenshot
// script that calls enterOfflineGame gets this for free.
//
// opts:
//   charClass  data-class of the class card to pick (default 'warrior')
//   charName   name typed into #char-name when that field is present (default 'Adventurer')
//   settleMs   pause after Enter World for the world to load (default 2500; 0 to skip)
export async function enterOfflineGame(page, opts = {}) {
  const { charClass = 'warrior', charName = 'Adventurer', settleMs = 2500 } = opts;
  const card = `#offline-select .mini-class[data-class="${charClass}"]`;
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  // Hidden legacy hook: fire its handler in-page rather than page.click (no clickable point).
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForSelector(card, { visible: true, timeout: 15000 });
  // Drive name / class / Enter World in-page too: on small touch viewports these can fail
  // puppeteer's clickable-point check, the same reason #btn-offline does.
  await page.evaluate((name) => {
    const n = document.querySelector('#char-name');
    if (n) {
      n.value = name;
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, charName);
  await page.evaluate((sel) => document.querySelector(sel)?.click(), card);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  // On touch viewports a mobile preflight ("tap to continue") gates the world; dismiss it
  // so the world actually boots. No-op on desktop, where the preflight never appears.
  await page
    .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 5000 })
    .catch(() => {});
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  // Wait for the world to actually boot (the window.__game debug hook appears post-start)
  // rather than guessing with a fixed delay, so post-entry code that reads window.__game.sim
  // does not race the loader. Falls back to the settle delay if the hook never shows.
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 30000 }).catch(() => {});
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));

  await dismissEntryOverlays(page);
}

// Skip the first-spawn intro cinematic (Escape is its documented skip gesture), click any
// "skip tutorial" button, and confirm the camera-mode-choice prompt. Polls a few rounds
// since the intro cinematic's own listeners can attach a beat after the world boots.
async function dismissEntryOverlays(page) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 5; i++) {
    const state = await page
      .evaluate(() => {
        const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
        const introLogo = document.getElementById('intro-logo');
        const skipBtn = [...document.querySelectorAll('button.tut-skip')][0];
        return {
          introUp: visible(introLogo) || document.getElementById('ui')?.style.display === 'none',
          tutorialUp: visible(skipBtn),
          cameraPromptUp: visible(document.querySelector('.camera-prompt-backdrop')),
        };
      })
      .catch(() => ({ introUp: false, tutorialUp: false, cameraPromptUp: false }));
    if (!state.introUp && !state.tutorialUp && !state.cameraPromptUp) return;
    if (state.introUp) await page.keyboard.press('Escape').catch(() => {});
    if (state.tutorialUp) {
      await page.evaluate(() => document.querySelector('button.tut-skip')?.click()).catch(() => {});
    }
    if (state.cameraPromptUp) {
      await page
        .evaluate(() => document.querySelector('.camera-prompt-confirm')?.click())
        .catch(() => {});
    }
    await sleep(400);
  }
}

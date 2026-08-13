// Local capture tool for the Class Power Tuner admin page (docs/balance/
// class-power-tuner.md and its PDF). Shoots the real Svelte dashboard against a
// REAL server serving the REAL GET/POST /admin/api/class-tuning endpoints, so
// every slider, value readout and badge in the documentation is what an
// operator actually sees rather than a mockup.
//
// The tour follows Shaman, Hunter and Priest, the three classes queued for
// redesign (levy-street/world-of-claudecraft PR #2218), plus the Weapons window.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - a Postgres the server can reach (npm run db:up, or a local cluster)
//   - a server started on SERVER_URL, with an account holding the `tuner` role:
//       node scripts/grant_admin.mjs <username> --roles tuner
//   - a vite dev client on GAME_URL with WOC_DEV_API_TARGET pointed at SERVER_URL
//
// Usage:
//   GAME_URL=http://127.0.0.1:5195 SERVER_URL=http://127.0.0.1:8791 \
//     ADMIN_USER=balancelead ADMIN_PASS='...' \
//     SHOTS_DIR=docs/screenshots/class-power-tuner \
//     node scripts/class_tuner_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const ADMIN_USER = process.env.ADMIN_USER ?? 'balancelead';
const ADMIN_PASS = process.env.ADMIN_PASS;
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/class-power-tuner';

// Fail before any browser or network work: a defaulted empty password only
// surfaces minutes later as a confusing login failure.
if (!ADMIN_PASS) {
  console.error('ADMIN_PASS is required (the admin account password for ADMIN_USER)');
  process.exit(1);
}

// This script mints an admin bearer into localStorage on GAME_URL and posts a
// tuning document, so both targets must be loopback (the mob_stall_repro.mjs
// policy shared by every account-touching capture script here).
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');

const DESKTOP = { width: 1600, height: 1200, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminToken() {
  const res = await fetch(`${SERVER_URL}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const body = await res.json();
  if (!body?.data?.token) throw new Error(`admin login failed: ${JSON.stringify(body)}`);
  return body.data.token;
}

/** Put the realm back to shipped numbers so a re-run starts from a clean page. */
async function resetTuning(token) {
  await fetch(`${SERVER_URL}/admin/api/class-tuning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      document: { version: 1, abilities: {}, weapons: {} },
      note: 'capture reset',
    }),
  });
}

async function shoot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`[shot] ${OUT}/${name}.png`);
}

async function openTuner(page, token, viewport) {
  await page.setViewport(viewport);
  await page.goto(`${GAME_URL}/admin.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('claudecraft_admin_token', t);
    localStorage.setItem('claudecraft_admin_name', 'balancelead');
  }, token);
  await page.goto(`${GAME_URL}/admin.html?page=class-tuning`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Class Power Tuner'), {
    timeout: 30_000,
  });
  await sleep(600);
}

/** Click the class tab whose label matches, then let the list settle. */
async function selectClass(page, className) {
  const clicked = await page.evaluate((name) => {
    const tab = [...document.querySelectorAll('button.class-tab')].find(
      (b) => b.textContent.trim().split(/\s+/)[0] === name,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, className);
  if (!clicked) throw new Error(`class tab not found: ${className}`);
  await sleep(500);
}

/** Open the Weapons window, the tab that sits after the nine class tabs. */
async function selectWeapons(page) {
  const clicked = await page.evaluate(() => {
    const tab = document.querySelector('button.weapons-tab');
    if (!tab) return false;
    tab.click();
    return true;
  });
  if (!clicked) throw new Error('weapons tab not found');
  await sleep(500);
}

/** Click a spec tab inside the open class window by its position (0 = All specs). */
async function selectSpec(page, index) {
  const label = await page.evaluate((i) => {
    const tabs = [...document.querySelectorAll('button.spec-tab')];
    if (!tabs[i]) return null;
    tabs[i].click();
    return tabs[i].textContent.trim();
  }, index);
  if (label === null) throw new Error(`spec tab ${index} not found`);
  await sleep(500);
  return label;
}

async function search(page, needle) {
  await page.evaluate((value) => {
    const input = document.querySelector('input[type="search"]');
    if (!input) throw new Error('search input missing');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, needle);
  await sleep(400);
}

/** Drag one slider by setting its value the way a real input event would. */
async function moveSlider(page, abilityId, channel, factor) {
  await page.evaluate(
    (id, ch, value) => {
      const input = document.getElementById(`slider-${id}-${ch}`);
      if (!input) throw new Error(`slider missing: ${id}/${ch}`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    abilityId,
    channel,
    factor,
  );
  await sleep(300);
}

async function main() {
  const token = await adminToken();
  await resetTuning(token);

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  try {
    // The capture follows the THREE REDESIGNED CLASSES (Shaman, Hunter, Priest),
    // whose owned-classes redesign has landed on this base, so every card below
    // is the redesigned kit rather than the one it replaced.

    // 1. The page as an operator first sees it, opened on Shaman.
    await openTuner(page, token, DESKTOP);
    await selectClass(page, 'Shaman');
    await shoot(page, '01-overview-shaman');

    // 2. Spiritmend (Restoration): the healer loop the redesign rebuilds.
    //    Cascading Mend, the spec signature, is the richest single card in the
    //    class.
    console.log(`[spec] shaman spec tab: ${await selectSpec(page, 3)}`);
    await search(page, 'cascading mend');
    await shoot(page, '02-shaman-spiritmend-cascading-mend');
    await moveSlider(page, 'chain_heal', 'heal_direct', 0.75);
    await moveSlider(page, 'chain_heal', 'targets', 1.5);
    await shoot(page, '03-shaman-cascading-mend-tuned');

    // 3. Thundercall (Elemental): a shock that carries a direct hit AND a DoT,
    //    each on its own slider.
    await selectSpec(page, 1);
    await search(page, 'cinder jolt');
    await shoot(page, '04-shaman-thundercall-cinder-jolt');

    // 4. Warspirit (Enhancement): the dual-wield melee spec.
    await selectSpec(page, 2);
    await search(page, '');
    await shoot(page, '05-shaman-warspirit-spec-filter');

    // 5. Hunter: Coldsight (Marksmanship), the ranged-shot spec.
    await selectClass(page, 'Hunter');
    console.log(`[spec] hunter spec tab: ${await selectSpec(page, 2)}`);
    await search(page, 'long draw');
    await shoot(page, '06-hunter-coldsight-long-draw');

    // 6. Hunter: a control shot, showing control duration as its own channel.
    await selectSpec(page, 0);
    await search(page, 'rattling');
    await shoot(page, '07-hunter-rattling-shot');

    // 7. Packlord (Beast Mastery): the pet spec's signature cooldown.
    await selectSpec(page, 1);
    await search(page, 'howling rage');
    await shoot(page, '08-hunter-packlord-signature');

    // 8. Priest: Doctrine (Discipline), where absorb is its own channel.
    await selectClass(page, 'Priest');
    console.log(`[spec] priest spec tab: ${await selectSpec(page, 1)}`);
    await search(page, 'psalm');
    await shoot(page, '09-priest-doctrine-psalm-of-warding');

    // 9. Vespers (Shadow): the damage side of the same class.
    await selectSpec(page, 3);
    await search(page, 'mindfracture');
    await shoot(page, '10-priest-vespers-mindfracture');

    // 10. Save, so the pending-restart badge and the audit trail are real.
    await page.evaluate(() => {
      const note = document.querySelector('input[type="text"]');
      if (!note) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(note, 'Trim Spiritmend Cascading Mend by 25%, widen its chain (capture)');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    await page.evaluate(() => {
      const save = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Save tuning',
      );
      save?.click();
    });
    await sleep(1500);
    await selectClass(page, 'Shaman');
    await search(page, 'cascading mend');
    await shoot(page, '11-saved-pending-restart');

    // 11. The change history, expanded.
    await page.evaluate(() => {
      const panel = [...document.querySelectorAll('details')].find((d) =>
        d.textContent.includes('Change history'),
      );
      if (panel) panel.open = true;
    });
    await sleep(500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(300);
    await shoot(page, '12-change-history');

    // 12. The Weapons window: auto-attack damage and swing timer per weapon.
    await selectWeapons(page);
    await shoot(page, '13-weapons-overview');
    await search(page, 'shortsword');
    await shoot(page, '14-weapon-shipped');
    await moveSlider(page, 'worn_sword', 'swing_damage', 1.6);
    await moveSlider(page, 'worn_sword', 'swing_speed', 1.3);
    await shoot(page, '15-weapon-tuned');
    // A hunter's Auto Shot swings off the CLASS ranged profile, not an item.
    await search(page, 'hunter');
    await shoot(page, '16-weapon-hunter-ranged');

    // 13. Mobile: the operator surface has to work on a phone too.
    await openTuner(page, token, MOBILE);
    await selectClass(page, 'Priest');
    await shoot(page, '17-mobile-overview');
    await search(page, 'psalm');
    await shoot(page, '18-mobile-ability-card');
  } finally {
    // Leave the realm as we found it even when a capture step throws: the
    // tour SAVES a real document mid-run, and an early exit would otherwise
    // strand it as the realm's pending tuning.
    await resetTuning(token).catch((err) => console.error('capture reset failed:', err));
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

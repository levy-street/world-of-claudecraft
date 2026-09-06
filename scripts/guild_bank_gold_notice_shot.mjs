// One-off local capture tool for the guild bank GOLD NOTICE: the guild-wide
// chat line every online member receives when an officer deposits into or
// withdraws from the guild treasury (server/guild_bank_gold_notice.ts).
// Sibling of scripts/guild_bank_log_shot.mjs, on the same recipe: a REAL
// online server, real facet commands, and the real chat frame painted from the
// real events frame. Two clients are needed because the line is about what the
// OTHER member sees, so this cannot be a scripts/pr_shot_targets.mjs entry.
//
// Dev-only, not wired into any npm script or CI gate. Needs a running server
// with ALLOW_DEV_COMMANDS=1 (dev_give / dev_teleport stock the scene) and a
// vite dev client pointed at it (WOC_DEV_API_TARGET); never production.
//
// Usage:
//   GAME_URL=http://localhost:5173 SHOTS_DIR=docs/screenshots/guild-bank-gold-notice \
//     SHOT_PREFIX=after node scripts/guild_bank_gold_notice_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-bank-gold-notice';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

const MOBILE_VIEWPORT = {
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function launchBrowser(mobile) {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 180000,
    userDataDir: `/tmp/claude-501/gbank-gold-shot-${uniq}-${Date.now()}-${Math.random()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: mobile
      ? MOBILE_VIEWPORT.viewport
      : { width: 1600, height: 900, deviceScaleFactor: 1 },
  });
}

async function newPage(browser, mobile) {
  const page = await browser.newPage();
  await suppressGpuNotice(page);
  // Standing capture rule: the LOWEST graphics preset, seeded before boot.
  await page.evaluateOnNewDocument(() => {
    try {
      const prev = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
      localStorage.setItem('woc_settings', JSON.stringify({ ...prev, graphicsPreset: 1 }));
    } catch {}
  });
  if (mobile) {
    await page.emulate(MOBILE_VIEWPORT);
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
  }
  return page;
}

async function dismissCameraPrompt(page) {
  for (let i = 0; i < 6; i++) {
    const dismissed = await page
      .evaluate(() => {
        const btn = document.querySelector('.camera-prompt-confirm');
        if (btn instanceof HTMLElement) {
          btn.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (dismissed) return;
    await sleep(300);
  }
}

// The proven online-login recipe (scripts/guild_bank_log_shot.mjs).
async function loginAndEnter(page, username, charName, cls, { mobile = false }) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  if (lastErr) throw lastErr;
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 45000 });
  let filled = false;
  for (let attempt = 0; attempt < 6 && !filled; attempt++) {
    filled = await page.evaluate(
      (u, p, mail) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        if (form.dataset.authMode !== 'register') toggle.click();
        const emailEl = document.querySelector('#login-email');
        userEl.value = u;
        passEl.value = p;
        if (emailEl) emailEl.value = mail;
        submit.click();
        return true;
      },
      username,
      'hunter22',
      `${username}@example.com`,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  await page.waitForSelector('#realm-list .realm-row', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('#realm-list .realm-row');
    (row instanceof HTMLElement ? row : null)?.click();
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  const onCreatePanel = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!onCreatePanel) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await page.waitForFunction(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
  }
  await page.evaluate(
    (name, cls2) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charcreate-panel .mini-class[data-class="${cls2}"]`)?.click();
      document.querySelector('#btn-create-char').click();
    },
    charName,
    cls,
  );
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 10000, polling: 200 },
  );
  await page.waitForSelector('#char-list .char-row', { timeout: 20000 });
  for (let i = 0; i < 30; i++) {
    const advanced = await page.evaluate(
      () =>
        document.querySelector('#charselect-panel')?.hasAttribute('hidden') ||
        document.body.classList.contains('mobile-preflight-open') ||
        typeof window.__game !== 'undefined',
    );
    if (advanced) break;
    await page.evaluate((name) => {
      window.confirm = () => true;
      const rows = [...document.querySelectorAll('#char-list .char-row')];
      const row =
        rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
      const btn = row?.querySelector('.enter-world-btn') ?? row?.querySelector('.take-over-btn');
      btn?.click();
    }, charName);
    await sleep(700);
  }
  if (mobile) {
    for (let i = 0; i < 60; i++) {
      const booted = await page.evaluate(() => typeof window.__game !== 'undefined');
      if (booted) break;
      await page
        .evaluate(() => document.querySelector('#mobile-preflight-continue')?.click())
        .catch(() => {});
      await sleep(1000);
    }
  }
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 90000,
    polling: 500,
  });
  await sleep(1200);
  await page.evaluate(() => document.querySelector('button.tut-skip')?.click()).catch(() => {});
  await page
    .evaluate(() => document.querySelector('#tutorial-greeting button')?.click())
    .catch(() => {});
  await dismissCameraPrompt(page);
}

// Fund the officer, found the guild, open the bank from the officer's purse.
async function fundAndFound(page) {
  await page.evaluate(() => {
    const cmd = (p) => window.__game.online.cmd(p);
    cmd({ cmd: 'dev_level', level: 20 });
    for (let i = 0; i < 10; i++) cmd({ cmd: 'dev_give', item: 'heart_of_the_rift', count: 1 });
    cmd({ cmd: 'dev_teleport', x: -17.8, z: -105 }); // Trader Wilkes (Eastbrook square)
  });
  await sleep(1200);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__game.world.sellItem('heart_of_the_rift', 1));
    await sleep(250);
  }
  await page
    .waitForFunction(() => window.__game.world.copper >= 400000, { timeout: 15000, polling: 300 })
    .catch(async (e) => {
      const diag = await page.evaluate(() => ({
        copper: window.__game.world.copper,
        inv: window.__game.world.inventory.filter(Boolean).map((s) => `${s.itemId}x${s.count}`),
        chat: [...document.querySelectorAll('#chatlog > *')].slice(-6).map((n) => n.textContent),
        npcs: [...window.__game.world.entities.values()]
          .filter((en) => en.kind === 'npc' || en.npc || en.vendor)
          .slice(0, 12)
          .map((en) => `${en.name}@${en.pos?.x?.toFixed(1)},${en.pos?.z?.toFixed(1)}`),
        me: window.__game.world.player?.pos ?? window.__game.world.playerPos,
      }));
      console.error('funding failed', JSON.stringify(diag, null, 1));
      throw e;
    });
  if (process.env.PROBE) throw new Error('probe done');
  await page.evaluate((name) => window.__game.world.guildCreate(name), `Gilded Vanguard ${alpha}`);
  await sleep(1500);
  await page.evaluate(() => window.__game.online.cmd({ cmd: 'dev_teleport', x: 8.5, z: -96 })); // Bursar Fernando
  await page.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
    timeout: 15000,
    polling: 300,
  });
  await page.evaluate(() => window.__game.world.guildBankBuySlots());
  await page.waitForFunction(() => (window.__game.world.guildBankInfo?.capacity ?? 0) > 0, {
    timeout: 10000,
    polling: 300,
  });
  await sleep(600);
}

async function inviteAndAccept(officer, member, memberName) {
  await officer.evaluate((n) => window.__game.world.guildInvite(n), memberName);
  // Accept through the REAL invite prompt (its first button is Join Guild), so
  // the dialog is gone from the frame the way it would be for a player.
  await member.waitForSelector('#prompt-stack .prompt button', { timeout: 15000 });
  await member.evaluate(() => document.querySelector('#prompt-stack .prompt button')?.click());
  await member.waitForFunction(() => !document.querySelector('#prompt-stack .prompt'), {
    timeout: 10000,
    polling: 300,
  });
  await sleep(1500);
}

async function moveGold(officer) {
  await officer.evaluate(() => window.__game.world.guildBankDepositGold(52003));
  await sleep(1500);
  // Less than the deposit: a withdrawal the treasury cannot cover is refused
  // and (correctly) announces nothing.
  await officer.evaluate(() => window.__game.world.guildBankWithdrawGold(20000));
  await sleep(2500);
}

async function shootChat(page, file, { fullFrame = false } = {}) {
  await dismissCameraPrompt(page);
  await page.evaluate(() => {
    const log = document.querySelector('#chatlog');
    if (log) log.scrollTop = log.scrollHeight;
  });
  await sleep(300);
  if (fullFrame) {
    await page.screenshot({ path: file });
    console.log('shot', file);
    return;
  }
  const region = await page.evaluate(() => {
    const el = document.querySelector('#chatlog-wrap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!region || region.width <= 0) {
    await page.screenshot({ path: file });
    console.log('shot (full frame fallback)', file);
    return;
  }
  const m = 12;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: region.width + m * 2,
      height: region.height + m * 2,
    },
  });
  console.log('shot', file);
}

async function run() {
  const officerBrowser = await launchBrowser(false);
  const officer = await newPage(officerBrowser, false);
  await loginAndEnter(officer, `gbgo_${uniq}`, `Verity${alpha}`, 'paladin', {});
  await fundAndFound(officer);

  // Desktop member: sees the two lines land in the chat frame.
  if (!process.env.MOBILE_ONLY) {
    const browser = await launchBrowser(false);
    const member = await newPage(browser, false);
    const name = `Rowan${alpha}`;
    await loginAndEnter(member, `gbgm_${uniq}`, name, 'hunter', {});
    await inviteAndAccept(officer, member, name);
    await moveGold(officer);
    await shootChat(member, `${OUT}/${PREFIX}-desktop-member-chat.png`);
    await shootChat(member, `${OUT}/${PREFIX}-desktop-member-chat-full.png`, { fullFrame: true });
    await browser.close();
  }

  // Mobile member: same scene, landscape phone metrics.
  {
    const browser = await launchBrowser(true);
    const member = await newPage(browser, true);
    const name = `Tamsin${alpha}`;
    await loginAndEnter(member, `gbgn_${uniq}`, name, 'mage', { mobile: true });
    await inviteAndAccept(officer, member, name);
    await moveGold(officer);
    // The mobile HUD keeps the chat frame behind the Chat button: a TAP
    // (pointerdown then pointerup, the events the control binds) opens it.
    await member.evaluate(() => {
      const btn = document.querySelector('#mobile-chat');
      const fire = (type) =>
        btn?.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch' }),
        );
      fire('pointerdown');
      setTimeout(() => fire('pointerup'), 80);
    });
    await member.waitForFunction(
      () =>
        document.body.classList.contains('mobile-chat-open') ||
        document.body.classList.contains('mobile-chatlog-peek'),
      { timeout: 8000, polling: 200 },
    );
    await sleep(800);
    await shootChat(member, `${OUT}/${PREFIX}-mobile-member-chat.png`, { fullFrame: true });
    await browser.close();
  }

  await officerBrowser.close();
}

await run();
console.log('done');

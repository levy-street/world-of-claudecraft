// Offline screenshot for the error-toast-to-chat-log PR. Boots the game
// headless, triggers a real error toast (the same showError() path used for
// e.g. "you cannot do that" / "out of range"), then captures both the
// fading center-screen banner (#error-msg) and the chat window showing the
// same message mirrored into the system channel so it does not just vanish.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Errolyn');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await page.waitForFunction(() => !!window.__game?.hud, { timeout: 180000 });
// Skip the new-character intro cinematic if it is still running (Escape is the
// documented skip gesture) so the toast/chat capture below is not racing it.
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 800));
// Clear the new-adventurer tutorial popover so it does not overlap the toast.
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Skip Tutorial',
  );
  skip?.click();
});
await new Promise((r) => setTimeout(r, 300));

// Trigger a real error toast through the same showError() path the game uses
// for "you cannot do that" / "target out of range" style messages.
await page.evaluate(() => {
  const g = window.__game;
  g.hud.showError('Target is out of range.');
});
await new Promise((r) => setTimeout(r, 150));

// Capture the full-screen scene with the fading center-screen banner visible.
const banner = await page.evaluate(() => document.querySelector('#error-msg')?.textContent);
console.log('toast banner:', JSON.stringify(banner));
await page.screenshot({ path: 'tmp/error_toast_banner.png' });

// Re-issue so the banner is at full opacity, then crop it tight for legibility.
await page.evaluate(() => window.__game.hud.showError('Target is out of range.'));
await new Promise((r) => setTimeout(r, 120));
const banner2Box = await page.evaluate(() => {
  const r = document.querySelector('#error-msg').getBoundingClientRect();
  return {
    x: Math.max(0, r.x - 40),
    y: Math.max(0, r.y - 20),
    width: Math.min(1600, r.width + 80),
    height: r.height + 40,
  };
});
await page.screenshot({ path: 'tmp/error_toast_banner_crop.png', clip: banner2Box });

// Confirm + capture the mirrored system line in the chat log.
const mirrored = await page.evaluate(() => {
  const lines = [...document.querySelectorAll('#chatlog > div')];
  const last = lines[lines.length - 1];
  return last ? { chan: last.dataset.chan, text: last.textContent } : null;
});
console.log('mirrored chat entry:', JSON.stringify(mirrored));
const chatBox = await page.evaluate(() => {
  const el = document.getElementById('chatlog-frame') ?? document.getElementById('chatlog');
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, r.x - 8),
    y: Math.max(0, r.y - 8),
    width: r.width + 16,
    height: r.height + 16,
  };
});
await page.screenshot({ path: 'tmp/error_toast_chat_log.png', clip: chatBox });

await browser.close();
console.log('saved tmp/error_toast_banner.png and tmp/error_toast_chat_log.png');

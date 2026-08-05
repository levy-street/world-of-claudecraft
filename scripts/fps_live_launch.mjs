// Boots two HEADED Chromium instances for the live FPS A/B: pbe2 (left) and
// local (right). The user logs in and enters the world in each manually;
// fps_live_monitor.mjs connects via the WS endpoints this writes and runs the
// synchronized tour. Keep this process alive for as long as the windows are
// needed. Usage: node scripts/fps_live_launch.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const TARGETS = [
  { label: 'pbe2', url: 'https://pbe2.worldofclaudecraft.com/', pos: '20,60' },
  { label: 'local', url: 'http://localhost:5173/', pos: '1480,60' },
];

fs.mkdirSync('tmp', { recursive: true });
for (const t of TARGETS) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: false,
    defaultViewport: null, // real window: the user drives login by hand
    userDataDir: `tmp/fps-live-profile-${t.label}`,
    args: [
      `--window-size=1440,810`,
      `--window-position=${t.pos}`,
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-webgl',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  fs.writeFileSync(`tmp/fps-live-${t.label}.ws`, browser.wsEndpoint());
  fs.writeFileSync(`tmp/fps-live-${t.label}.pid`, String(browser.process()?.pid ?? ''));
  console.log(`${t.label}: window up at ${t.url} (ws + pid written)`);
}
console.log('both windows up; log in and enter the world in each.');
await new Promise(() => {}); // hold the browsers open

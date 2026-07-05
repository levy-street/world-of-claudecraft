// Screenshot harness for the account-security feature (2FA + verified email
// change + data export). Runs against a single same-origin server that serves
// the built client (dist/) AND the REST API, so no dev proxy is needed:
//   DATABASE_URL=... PORT=8799 npm run server
//   CHROME_BIN=/usr/bin/chromium node scripts/account_security_shots.mjs
import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const BASE = process.env.BASE || 'http://localhost:8799/';
const OUT = process.env.OUT || 'pr-assets-2fa';
const user = process.env.WOC_USER || 'Aelwyn';
const pass = process.env.WOC_PASS || 'correct-horse';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('shot', name); };
const click = (sel) => page.click(sel).catch(() => {});
const type = (sel, v) => page.type(sel, v, { delay: 10 }).catch(() => {});

await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1200);

// ── Log in (the harness account is pre-registered via REST) ──
await click('#nav-btn-login');
await sleep(500);
await type('#login-user', user);
await type('#login-pass', pass);
await click('#btn-login');
await sleep(2500);

// Open the account portal.
await page.evaluate(() => document.querySelector('#nav-item-account')?.removeAttribute('hidden'));
await click('#nav-btn-account');
await sleep(1500);
await shot('01-account-security-overview');

// ── Two-factor enrolment wizard ──
await click('#account-2fa-setup-btn');
await sleep(300);
await type('#account-2fa-password', pass);
await shot('02-2fa-begin');
await click('#account-2fa-begin-form button[type=submit]');
await sleep(1200);
await shot('03-2fa-setup-key');

// Compute a live TOTP code from the displayed key so the enable step is real.
const code = await page.evaluate(async () => {
  const secret = document.querySelector('#account-2fa-secret').textContent.replace(/\s/g, '');
  // RFC 4648 base32 decode + RFC 6238 TOTP, inline (page has no crypto import).
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const ch of secret) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const key = new Uint8Array(out);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = new ArrayBuffer(8); const dv = new DataView(msg);
  dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg));
  const off = sig[sig.length - 1] & 0xf;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 1000000).padStart(6, '0');
});
await type('#account-2fa-code', code);
await click('#account-2fa-confirm-form button[type=submit]');
await sleep(1500);
await shot('04-2fa-recovery-codes');

// Done -> enabled state (disable form visible).
await click('#account-2fa-done');
await sleep(500);
await shot('05-2fa-enabled');

// ── Logged-out login screen with the 2FA step revealed ──
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1000);
await click('#nav-btn-login');
await sleep(500);
await type('#login-user', user);
await type('#login-pass', pass);
await click('#btn-login');
await sleep(1800); // server returns twoFactorRequired -> code field reveals
await shot('06-login-2fa-step');

console.log('DONE -> screenshots in', OUT);
await browser.close();

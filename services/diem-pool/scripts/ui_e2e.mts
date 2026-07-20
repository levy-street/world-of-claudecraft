// Browser UI E2E: drives the real dashboard pages in headless Chromium —
// provider connect/register/revoke (with an injected test wallet that signs
// with a real ed25519 key), admin login/kill-switch/pricing editor, and the
// public leaderboard. Run after (or instead of) e2e_smoke.mts against the
// same stack:
//
//   node scripts/mock_venice.mjs &
//   npm run build && npm run start &
//   npx tsx scripts/ui_e2e.mts
//
// Chromium path defaults to the Playwright-managed install; override with
// CHROMIUM_PATH.
process.loadEnvFile('.env');

import puppeteer, { type Page } from 'puppeteer-core';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Redis } from 'ioredis';

const BASE = 'http://127.0.0.1:3100';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
}

async function waitForText(page: Page, text: string, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (t: string) => document.body.innerText.includes(t),
      { timeout: timeoutMs },
      text,
    );
    return true;
  } catch {
    return false;
  }
}

async function clickButton(page: Page, label: string): Promise<boolean> {
  return page.evaluate((l: string) => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith(l),
    );
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, label);
}

/** Click a button and wait for the UI to show `expect`; retries cover the
 *  pre-hydration window where React hasn't attached listeners yet. */
async function clickAndExpect(page: Page, label: string, expect: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await clickButton(page, label))) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    if (await waitForText(page, expect, attempt === 2 ? 15_000 : 5_000)) return true;
  }
  return false;
}

/** Set a React-controlled input via the native setter so onChange fires. */
async function fillInput(page: Page, labelText: string, value: string): Promise<void> {
  await page.evaluate(
    (l: string, v: string) => {
      const label = [...document.querySelectorAll('label')].find((x) =>
        x.textContent?.includes(l),
      );
      const input = label?.querySelector('input');
      if (!input) throw new Error(`input not found for label: ${l}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    labelText,
    value,
  );
}

// Rate-limit windows persist in Redis across runs; this script owns its stack.
{
  const redis = new Redis(process.env.REDIS_URL!);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}

const browser = await puppeteer.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('dialog', (d) => void d.accept()); // revoke confirm()

// Injected test wallet: connect() yields a fresh Solana address; signMessage
// signs with the matching ed25519 key via a Node-side bridge — the page runs
// the exact same code path a real Phantom user exercises.
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
await page.exposeFunction('__signMessage', (msgB64: string) =>
  Array.from(nacl.sign.detached(new Uint8Array(Buffer.from(msgB64, 'base64')), kp.secretKey)),
);
// Injected as a raw string: tsx's esbuild transform decorates object-method
// functions with a __name helper that doesn't exist inside the page.
await page.evaluateOnNewDocument(`
  window.solana = {
    isPhantom: true,
    connect: async function () {
      return { publicKey: { toString: function () { return ${JSON.stringify(wallet)}; } } };
    },
    signMessage: async function (message) {
      var b64 = btoa(String.fromCharCode.apply(null, Array.from(message)));
      var arr = await window.__signMessage(b64);
      return { signature: new Uint8Array(arr) };
    },
  };
`);

console.log('— leaderboard page —');
await page.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle0' });
check('renders title', await waitForText(page, 'Compute Champions of the Realm'));
check(
  'shows ranked providers with truncated wallets',
  await page.evaluate(() => /…/.test(document.body.innerText)),
);

console.log('— provider dashboard: connect → register → stats → revoke —');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
check('connect wallet reveals the register form',
  await clickAndExpect(page, 'Connect wallet', 'Register a Venice API key'));
check('shows the connected wallet', await waitForText(page, wallet.slice(0, 8)));

await fillInput(page, 'Display name', 'UI Test Rig');
await fillInput(page, 'Venice API key', 'vn_ui_test_key_0123456789abcdef');
await fillInput(page, 'Staked DIEM', '12');
check('register flow completes (nonce → sign → validate → store)',
  await clickAndExpect(page, 'Sign & register', 'Registered — key …cdef'));
check('stats panel renders status and capacity',
  (await waitForText(page, 'ACTIVE')) && (await waitForText(page, 'consumed today (of $12.00 cap)')));
check('stats panel shows Claudium and streak tiles',
  (await waitForText(page, 'Claudium earned')) && (await waitForText(page, 'health streak (1.25× at 30d)')));

check('revoke wipes the key and updates status',
  await clickAndExpect(page, 'Revoke key', 'Key revoked and wiped.'));
check('status flips to REVOKED', await waitForText(page, 'REVOKED'));
check('revoked provider is offered the register form again',
  await waitForText(page, 'Register a Venice API key'));

console.log('— admin console —');
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' });
await fillInput(page, 'Admin token', 'wrong-token');
check('wrong token is rejected', await clickAndExpect(page, 'Load', 'bad admin token'));

await fillInput(page, 'Admin token', process.env.ADMIN_TOKEN!);
check('overview loads with routing live',
  await clickAndExpect(page, 'Load', 'pool spend today'));
check('provider table lists the UI test provider', await waitForText(page, 'UI Test Rig'));

check('kill switch pauses routing',
  await clickAndExpect(page, 'KILL SWITCH — pause all routing', 'PAUSED'));
check('resume restores routing', await clickAndExpect(page, 'Resume routing', 'live'));

await fillInput(page, 'Model id', 'ui-test-model');
await fillInput(page, 'Input $/1M tokens', '2');
await fillInput(page, 'Output $/1M tokens', '8');
check('pricing editor saves and lists the new model',
  await clickAndExpect(page, 'Save pricing', 'ui-test-model'));

await browser.close();
console.log(failures === 0 ? '\nALL UI CHECKS PASSED' : `\n${failures} UI CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);

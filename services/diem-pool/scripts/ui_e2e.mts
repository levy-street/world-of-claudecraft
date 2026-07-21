// Browser UI E2E: drives the real dashboard pages in headless Chromium -
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
  if (cond) console.log(`  [ok] ${name}`);
  else {
    failures++;
    console.error(`  [fail] ${name}`, detail ?? '');
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

/** Set a React-controlled <select> via the native setter so onChange fires. */
async function selectOption(page: Page, labelText: string, value: string): Promise<void> {
  await page.evaluate(
    (l: string, v: string) => {
      const label = [...document.querySelectorAll('label')].find((x) =>
        x.textContent?.includes(l),
      );
      const select = label?.querySelector('select');
      if (!select) throw new Error(`select not found for label: ${l}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, v);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    labelText,
    value,
  );
}

/** Click the button inside the first table row that has both `rowText` AND a
 *  button (skips button-less rows, e.g. a provider row naming the vendor). */
async function clickRowButton(page: Page, rowText: string): Promise<boolean> {
  return page.evaluate((t: string) => {
    const row = [...document.querySelectorAll('tr')].find(
      (r) => r.textContent?.includes(t) && r.querySelector('button'),
    );
    if (!row) return false;
    row.querySelector('button')!.click();
    return true;
  }, rowText);
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
// signs with the matching ed25519 key via a Node-side bridge - the page runs
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

console.log('- leaderboard page -');
await page.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle0' });
check('renders title', await waitForText(page, 'Compute Champions of the Realm'));
check(
  'shows ranked providers with truncated wallets',
  await page.evaluate(() => /…/.test(document.body.innerText)),
);

console.log('- provider dashboard: connect → register (venice + openai) → stats → revoke -');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
check('connect wallet reveals the attach-key form',
  await clickAndExpect(page, 'Connect wallet', 'Attach an API key'));
check('shows the connected wallet', await waitForText(page, wallet.slice(0, 8)));

await fillInput(page, 'Display name', 'UI Test Rig');
await fillInput(page, 'API key', 'vn_ui_test_key_0123456789abcdef');
await fillInput(page, 'Staked DIEM', '12');
check('venice register flow completes (nonce → sign → validate → store)',
  await clickAndExpect(page, 'Sign & register', 'Registered - venice key …cdef'));
check('key card renders status and capacity',
  (await waitForText(page, 'ACTIVE')) && (await waitForText(page, 'consumed today (of $12.00 cap)')));
check('key card shows Claudium and trust tier tiles',
  (await waitForText(page, 'Claudium earned')) && (await waitForText(page, 'health streak / trust tier')));

// The form auto-advances to the next open vendor; register an OpenAI key too.
check('vendor picker moved to a BYOK vendor', await waitForText(page, 'donation budget'));
await fillInput(page, 'Display name', 'UI OpenAI Rig');
await fillInput(page, 'API key', 'sk-oai-ui-good-0123456789abcdef');
await fillInput(page, 'Daily donation budget', '15');
check('openai register flow completes',
  await clickAndExpect(page, 'Sign & register', 'Registered - openai key …cdef'));
check('both key cards visible', (await waitForText(page, 'venice: UI Test Rig')) && (await waitForText(page, 'openai: UI OpenAI Rig')));
check('BYOK card shows the NEW trust tier', await waitForText(page, 'NEW'));

check('revoke wipes the venice key and updates status',
  await clickAndExpect(page, 'Revoke venice key', 'venice key revoked and wiped.'));
check('status flips to REVOKED', await waitForText(page, 'REVOKED'));
check('revoked vendor is offered for registration again',
  await waitForText(page, 'Attach an API key'));

console.log('- admin console -');
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' });
await fillInput(page, 'Admin token', 'wrong-token');
check('wrong token is rejected', await clickAndExpect(page, 'Load', 'bad admin token'));

await fillInput(page, 'Admin token', process.env.ADMIN_TOKEN!);
check('overview loads with routing live',
  await clickAndExpect(page, 'Load', 'pool spend today'));
check('provider table lists the UI test provider', await waitForText(page, 'UI Test Rig'));
// The vendors rows commit a beat after the overview does - wait for their
// buttons, not just the panel header, before clicking into them.
check('vendors panel renders all policies',
  (await waitForText(page, 'Trust ramp')) && (await waitForText(page, 'Disable')));

// Toggle the kimi vendor off and back on from its table row.
check('vendor kill switch disables kimi', await clickRowButton(page, 'kimi') && await waitForText(page, 'OFF'));
check('vendor re-enabled', await clickRowButton(page, 'kimi') && (await (async () => {
  await new Promise((r) => setTimeout(r, 500));
  return !(await page.evaluate(() =>
    [...document.querySelectorAll('tr')].some((r) => r.textContent?.includes('kimi') && r.textContent?.includes('OFF')),
  ));
})()));

check('kill switch pauses routing',
  await clickAndExpect(page, 'KILL SWITCH - pause all routing', 'PAUSED'));
check('resume restores routing', await clickAndExpect(page, 'Resume routing', 'live'));

await selectOption(page, 'Vendor', 'kimi');
await fillInput(page, 'Model id', 'ui-test-model');
await fillInput(page, 'Input $/1M tokens', '2');
await fillInput(page, 'Output $/1M tokens', '8');
check('pricing editor saves and lists the new model under its vendor',
  await clickAndExpect(page, 'Save pricing', 'ui-test-model'));

await browser.close();
console.log(failures === 0 ? '\nALL UI CHECKS PASSED' : `\n${failures} UI CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);

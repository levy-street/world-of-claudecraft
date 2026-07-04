// One-off visual proof for the minimap notifier-overlap fix (PR: fix/minimap-notifier-overlap).
// Renders the minimap bottom-left rim in the BEFORE state (raid-lockout and the
// mail indicator both absolutely positioned in the same corner, overlapping) and
// the AFTER state (both laid out in the #minimap-notifiers flex rail), writing
// two PNGs to docs/screenshots/. The CSS rules are copied verbatim from
// src/styles/hud.css so the render matches what ships.
//
// Run from the repo root: node scripts/minimap_notifier_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHARED = `
  body { margin: 0; background: #14141b; }
  #minimap-disc { position: relative; display: inline-block; line-height: 0; }
  #minimap {
    width: 162px; height: 162px; border-radius: 50%; box-sizing: border-box;
    background: radial-gradient(circle at 50% 40%, #3a4a2e, #1c2417);
    border: 3px solid #2a2a34;
  }
  #raid-lockout {
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    padding: 0; border-radius: 50%; background: radial-gradient(circle at 50% 30%, #2c2c3a, #15151f);
    border: 1px solid #c9a86a; box-shadow: 0 0 8px #c9a86a66, 0 1px 3px #000a; color: #ffd100;
  }
  #raid-lockout svg { width: 15px; height: 15px; display: block; }
  #mail-indicator {
    display: inline-flex; align-items: center; gap: 3px; padding: 3px 7px;
    background: #12100acc; border: 1px solid #cc9a3c88; border-radius: 12px; color: #ffd100;
  }
  .mail-indicator-count { font: 700 11px sans-serif; letter-spacing: 0.4px; }
`;

// BEFORE: the shipped-bug rules, both badges anchored to the same corner.
const BEFORE = `${SHARED}
  #raid-lockout { position: absolute; left: 10px; bottom: 10px; z-index: 3; }
  #mail-indicator { position: absolute; left: 4px; bottom: 4px; z-index: 3; }
`;

// AFTER: the fix, a flex rail wrapping both badges.
const AFTER = `${SHARED}
  #minimap-notifiers {
    position: absolute; left: 10px; bottom: 10px; z-index: 3;
    display: flex; align-items: center; gap: 6px; pointer-events: none;
  }
  #raid-lockout { pointer-events: auto; }
  #mail-indicator { pointer-events: auto; }
`;

const LOCK = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z"/></svg>';
const MAIL = '<span style="font-size:13px">&#9993;</span><span class="mail-indicator-count">1</span>';

const html = (css, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

const beforeBody = `<div id="minimap-disc"><div id="minimap"></div><button id="raid-lockout">${LOCK}</button><div id="mail-indicator">${MAIL}</div></div>`;
const afterBody = `<div id="minimap-disc"><div id="minimap"></div><div id="minimap-notifiers"><button id="raid-lockout">${LOCK}</button><div id="mail-indicator">${MAIL}</div></div></div>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 220, height: 220, deviceScaleFactor: 2 });
  for (const [css, body, out] of [
    [BEFORE, beforeBody, 'docs/screenshots/minimap-notifiers-before.png'],
    [AFTER, afterBody, 'docs/screenshots/minimap-notifiers-after.png'],
  ]) {
    await page.setContent(html(css, body), { waitUntil: 'load' });
    const disc = await page.$('#minimap-disc');
    const buf = await disc.screenshot();
    writeFileSync(out, buf);
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}

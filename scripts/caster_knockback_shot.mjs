// Visual proof for the caster 2-set knockback fix (PR: feature/caster-2set-fix).
// Top-down before/after of a caster hit by a boss knockback while casting:
// BEFORE the fix, 100% knockback resistance was bypassed by one caller, so the
// caster was shoved and the cast broke. AFTER, resistance is applied centrally,
// so the caster stays put and the cast completes. Renders to docs/screenshots/.
//
// Run from the repo root: node scripts/caster_knockback_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// panel: caster start at x=250; BEFORE shoves to x=330 (cast broken); AFTER stays.
const panel = (state) => {
  const shoved = state === 'before';
  const cx = shoved ? 330 : 250;
  return `
  <div class="panel">
    <div class="cap ${shoved ? 'bad' : 'good'}">${
      shoved
        ? 'Before: 100% resist bypassed, knocked back, cast interrupted'
        : 'After: 100% knockback resist honored, cast completes'
    }</div>
    <div class="scene">
      <div class="boss" title="boss">B</div>
      <div class="wave"></div>
      <div class="anchor" style="left:250px" ${shoved ? 'hidden' : ''}></div>
      <div class="caster" style="left:${cx}px">
        ${shoved ? '' : '<div class="shield"></div>'}
        <div class="dot"></div>
        <div class="castbar ${shoved ? 'broken' : 'ok'}">
          <div class="fill" style="width:${shoved ? 38 : 100}%"></div>
          <span>${shoved ? 'Interrupted' : 'Cast complete'}</span>
        </div>
      </div>
      ${shoved ? '<div class="ghost" style="left:250px"></div><div class="arrow"></div>' : ''}
    </div>
  </div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:16px; background:#0d0d12; font-family:'Trebuchet MS',system-ui,sans-serif; }
  .col { display:flex; flex-direction:column; gap:12px; width:440px; }
  .panel { background:#12100a; border:1px solid #4a3d1d; border-radius:8px; padding:10px 12px; }
  .cap { font-size:12px; font-weight:700; letter-spacing:.3px; margin-bottom:8px; }
  .cap.bad { color:#ff7a6b; } .cap.good { color:#7fdc55; }
  .scene { position:relative; height:120px; background:radial-gradient(circle at 30% 50%,#2a3320,#171d12); border-radius:6px; overflow:hidden; }
  .boss { position:absolute; left:18px; top:44px; width:34px; height:34px; border-radius:50%; background:radial-gradient(circle at 40% 30%,#a24b4b,#4a1414); color:#ffd7d7; font-weight:700; display:flex; align-items:center; justify-content:center; border:1px solid #d98; }
  .wave { position:absolute; left:36px; top:34px; width:60px; height:54px; border-right:3px solid #ffd10066; border-radius:50%; filter:blur(1px); }
  .anchor { position:absolute; top:40px; width:44px; height:44px; border-radius:50%; border:2px dashed #7fdc5588; }
  .caster { position:absolute; top:30px; transition:none; }
  .dot { width:22px; height:22px; border-radius:50%; background:radial-gradient(circle at 40% 30%,#8fb3ff,#26408c); border:1px solid #cfe; margin:12px auto 0; }
  .shield { position:absolute; left:-8px; top:2px; width:38px; height:38px; border-radius:50%; border:2px solid #ffd100; box-shadow:0 0 8px #ffd10088; }
  .castbar { position:relative; width:96px; height:14px; margin-top:6px; margin-left:-37px; background:#0009; border:1px solid #4a3d1d; border-radius:3px; overflow:hidden; }
  .castbar .fill { height:100%; }
  .castbar.ok .fill { background:linear-gradient(#ffe27a,#c9a86a); }
  .castbar.broken .fill { background:#a05046; }
  .castbar span { position:absolute; inset:0; font-size:9px; color:#fff; display:flex; align-items:center; justify-content:center; text-shadow:0 1px 1px #000; }
  .ghost { position:absolute; top:42px; width:22px; height:22px; border-radius:50%; border:1px dashed #8fb3ff88; }
  .arrow { position:absolute; left:280px; top:52px; width:44px; height:0; border-top:2px solid #ff7a6b; }
  .arrow::after { content:''; position:absolute; right:-1px; top:-4px; border-left:7px solid #ff7a6b; border-top:4px solid transparent; border-bottom:4px solid transparent; }
</style></head><body><div class="col">
  <div style="color:#cdbd8f;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Caster 2-set: knockback resistance</div>
  ${panel('before')}${panel('after')}
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 470, height: 340, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: 'load' });
  const col = await p.$('.col');
  writeFileSync('docs/screenshots/caster-2set-knockback.png', await col.screenshot());
  console.log('wrote docs/screenshots/caster-2set-knockback.png');
} finally {
  await browser.close();
}

// One visible browser, native display pacing, sequential AB/BA comparisons.

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';
import { valid } from './checks.mjs';
import { place, scenes, settle, sleep } from './helpers.mjs';
import { audit, enter } from './session.mjs';

const smoke = process.argv.includes('--smoke');
if (!smoke && process.platform !== 'win32')
  throw Error(
    'Full run requires the Windows review device; use --smoke to verify the harness elsewhere.',
  );
const stamp = new Date().toISOString().replaceAll(':', '-');
const directory = `tmp/scenery-review/${smoke ? 'smoke' : 'windows'}-${stamp}`;
fs.mkdirSync(directory, { recursive: true });
const expectedGpu = smoke ? /Metal|NVIDIA|AMD|Intel|Apple/ : /RTX\s*3060/i;
const data = {
  started: new Date().toISOString(),
  smoke,
  complete: false,
  method:
    'One visible browser; native display pacing; sequential existing/updated then updated/existing. Governor off, native tier settings with selected Low FXAA/coconut controls, three-band cel. Two 20-second windows. No new GPU timer instrumentation.',
  build: JSON.parse(fs.readFileSync('tmp/scenery-review/build-provenance.json')),
  hardware: {
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    uptimeSeconds: os.uptime(),
  },
  rows: [],
  runs: [],
  excluded: [],
  errors: [],
  consoleErrors: [],
};
const save = () => fs.writeFileSync(`${directory}/results.json`, JSON.stringify(data, null, 2));
const manifestHash = crypto
  .createHash('sha256')
  .update(fs.readFileSync('tmp/scenery-review/build/.vite/manifest.json'))
  .digest('hex');
if (manifestHash !== data.build.manifestSha256)
  throw Error('Build manifest differs from provenance');
if (process.platform === 'win32') {
  data.hardware.video = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json',
      ],
      { encoding: 'utf8' },
    ),
  );
  data.hardware.powerScheme = execFileSync('powercfg.exe', ['/getactivescheme'], {
    encoding: 'utf8',
  }).trim();
}
const origin = 'http://127.0.0.1:5250';
const serverLog = fs.openSync(`${directory}/preview.log`, 'wx');
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--outDir',
    'tmp/scenery-review/build',
    '--host',
    '127.0.0.1',
    '--port',
    '5250',
    '--strictPort',
  ],
  { stdio: ['ignore', serverLog, serverLog] },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw Error('Owned preview exited; inspect preview.log');
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw Error('Owned preview did not start');
  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: false,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  data.browser = await browser.version();
  const page = await browser.newPage();
  page.on('pageerror', (error) => {
    data.errors.push(String(error));
    save();
  });
  page.on('console', (message) => {
    if (message.type() === 'error') data.consoleErrors.push(message.text());
  });
  for (const tier of smoke ? ['medium'] : ['low', 'medium', 'high', 'ultra', 'insane']) {
    for (const [order, modes] of smoke
      ? [['forward', ['existing', 'updated']]]
      : [
          ['forward', ['existing', 'updated']],
          ['reverse', ['updated', 'existing']],
        ]) {
      data.runs.push({ tier, order, uptimeSeconds: os.uptime(), at: new Date().toISOString() });
      save();
      for (const mode of modes) {
        console.log('ENTER', tier, order, mode);
        await enter(page, origin, tier, mode === 'updated');
        for (const scene of smoke ? scenes.slice(0, 1) : scenes) {
          await place(page, scene);
          await settle([page]);
          const before = await audit(page);
          if (
            before.snapshot.tier !== tier ||
            before.detail?.pending ||
            (tier !== 'low' && before.identityFailures)
          )
            throw Error('Preparation or material invariant');
          if (
            mode === 'existing'
              ? before.detail !== null
              : !before.detail || (tier !== 'low' && !before.detail.emptyDrawGuard)
          )
            throw Error('Scenery setting invariant');
          let samples;
          for (let attempt = 0; attempt < 3; attempt++) {
            samples = [];
            for (let i = 0; i < 2; i++)
              samples.push(
                await page.evaluate((ms) => window.__celDecision.sample(ms), smoke ? 1000 : 20000),
              );
            if (samples.every((sample) => valid(sample, before.snapshot, expectedGpu))) break;
            data.excluded.push({ tier, order, mode, scene: scene.name, attempt, samples });
            save();
            samples = null;
            await settle([page]);
          }
          if (!samples) throw Error('No stable windows on expected GPU/buffer/quality');
          const after = await audit(page);
          if (
            after.detail?.pending ||
            (tier !== 'low' && after.identityFailures) ||
            data.errors.length
          )
            throw Error('Post-measurement invariant');
          data.rows.push({ tier, order, mode, scene: scene.name, before, after, samples });
          save();
          await page.screenshot({
            path: `${directory}/${tier}-${order}-${mode}-${scene.name}.webp`,
            type: 'webp',
          });
          console.log(
            'RESULT',
            tier,
            order,
            mode,
            scene.name,
            samples.map((sample) => ((1000 * sample.submitted) / sample.elapsedMs).toFixed(2)),
          );
        }
      }
    }
  }
  data.complete = true;
} catch (error) {
  data.error = String(error);
  throw error;
} finally {
  data.finished = new Date().toISOString();
  save();
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(serverLog);
  console.log(directory);
}

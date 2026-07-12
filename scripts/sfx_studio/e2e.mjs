// Real-browser SFX Studio smoke: catalog, waveform, context model, edits,
// selection, exact render, transport, and browser console health.

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const port = Number(process.env.SFX_STUDIO_E2E_PORT ?? 5182);
const workspaceRoot = mkdtempSync(join(realpathSync(tmpdir()), 'woc-sfx-studio-e2e-'));
const screenshotRoot = join(workspaceRoot, 'screenshots');
const downloadRoot = join(workspaceRoot, 'downloads');
const previousWorkspaceRoot = process.env.WOC_SFX_STUDIO_ROOT;
let server;
let browser;
try {
  mkdirSync(screenshotRoot);
  mkdirSync(downloadRoot);
  process.env.WOC_SFX_STUDIO_ROOT = workspaceRoot;
  // The workspace override must exist before this import initializes audio_io.mjs.
  const [{ startSfxStudio }, { STUDIO_ROOT }] = await Promise.all([
    import('./server.mjs'),
    import('./audio_io.mjs'),
  ]);
  if (resolve(STUDIO_ROOT) !== resolve(workspaceRoot)) {
    throw new Error('SFX Studio ignored the isolated E2E workspace override');
  }
  const running = await startSfxStudio({ port });
  server = running.server;
  const { url } = running;
  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadRoot });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  let renderRequests = 0;
  let exportRequests = 0;
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', async (response) => {
    if (response.status() < 400) return;
    const detail = await response.text().catch(() => 'unreadable response');
    errors.push(
      `response: ${response.request().method()} ${response.status()} ${response.url()} ${detail}`,
    );
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/render') {
      renderRequests++;
    }
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/export') {
      exportRequests++;
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => /^\d+ sampled cues,/.test(document.querySelector('#summary')?.textContent ?? ''),
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => document.querySelector('#cue-title')?.textContent === 'foot_grass',
    { timeout: 30_000 },
  );
  await page.screenshot({ path: join(screenshotRoot, 'studio-main.png') });

  const initial = await page.evaluate(() => ({
    summary: document.querySelector('#summary')?.textContent,
    title: document.querySelector('#cue-title')?.textContent,
    cueCount: document.querySelectorAll('.cue').length,
    waveformWidth: document.querySelector('#waveform')?.width,
    context: document.querySelector('#context-label')?.textContent,
    status: document.querySelector('#status')?.textContent,
    inspection: document.querySelector('#inspection')?.textContent,
  }));
  const catalogCount = Number.parseInt(initial.summary ?? '', 10);
  const catalogTracks = Number(
    initial.summary?.match(/^\d+ sampled cues, (\d+) published tracks/)?.[1],
  );
  if (!Number.isFinite(catalogCount) || catalogCount <= 0)
    throw new Error(`invalid catalog summary: ${initial.summary}`);
  if (!Number.isFinite(catalogTracks) || catalogTracks < catalogCount)
    throw new Error(`invalid catalog track summary: ${initial.summary}`);
  if (initial.cueCount !== catalogCount)
    throw new Error(`expected ${catalogCount} cue rows, got ${initial.cueCount}`);
  if (!initial.waveformWidth) throw new Error('waveform did not render');
  if (!initial.inspection?.includes('working source'))
    throw new Error('inspector did not identify the working source');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.click('#export-all');
  await page.waitForFunction(
    () => document.querySelector('#status')?.textContent?.startsWith('Downloaded '),
    { timeout: 30_000 },
  );
  let downloaded = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    downloaded = readdirSync(downloadRoot).filter((name) => name.endsWith('.zip'));
    if (downloaded.length === 1 && statSync(join(downloadRoot, downloaded[0])).size > 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (downloaded.length !== 1) throw new Error('Export All did not download exactly one ZIP');
  const exported = {
    filename: downloaded[0],
    bytes: statSync(join(downloadRoot, downloaded[0])).size,
    status: await page.$eval('#status', (element) => element.textContent),
  };
  if (!/^world-of-claudecraft-sfx-[a-f0-9]{16}\.zip$/.test(exported.filename)) {
    throw new Error(`unexpected export filename: ${exported.filename}`);
  }
  if (
    exported.bytes < 1_000_000 ||
    !exported.status?.includes(`${catalogCount} keys, ${catalogTracks} tracks`)
  ) {
    throw new Error('Export All metadata did not match the published catalog');
  }
  const successfulExportRequests = exportRequests;
  if (successfulExportRequests !== 1) {
    throw new Error(`expected one clean export request, got ${successfulExportRequests}`);
  }

  await page.$eval('[data-playback-path="keyTrimDb"]', (element) => {
    element.value = '-4';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const uploadInput = await page.$('#file');
  await uploadInput.uploadFile(resolve('public/audio/sfx/foot_grass.mp3'));
  await page.waitForFunction(
    () =>
      document.querySelector('#status')?.textContent === 'foot_grass ready' &&
      document.querySelector('#dirty')?.textContent === 'clean' &&
      document.querySelector('[data-playback-out="keyTrimDb"]')?.textContent === '-4.0 dB',
    { timeout: 30_000 },
  );

  await page.$eval('[data-playback-path="keyTrimDb"]', (element) => {
    element.value = '-6';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('[data-path="normalize.enabled"]', (element) => {
    element.checked = true;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const waveform = await page.$('#waveform');
  const bounds = await waveform.boundingBox();
  if (!bounds) throw new Error('waveform has no layout bounds');
  await page.mouse.move(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  const oneShotLoopDisabled = await page.$eval('#set-loop', (element) => element.disabled);
  if (!oneShotLoopDisabled) throw new Error('one-shot cue could be reclassified as a loop');
  await page.click('#keep-selection');
  const sourceSelection = await page.$eval('#selection-label', (element) => element.textContent);
  if (!sourceSelection?.includes('(0.259 s)')) throw new Error('source selection was not retained');
  await page.click('#render');
  await page.waitForFunction(
    () => document.querySelector('#status')?.textContent?.startsWith('Exact preview:'),
    { timeout: 30_000 },
  );
  await page.click('#play');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const edited = await page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent,
    dirty: document.querySelector('#dirty')?.textContent,
    selection: document.querySelector('#selection-label')?.textContent,
    audition: document.querySelector('#ab')?.textContent,
    gain: document.querySelector('[data-playback-out="resolvedGainDb"]')?.textContent,
    time: document.querySelector('#timecode')?.textContent,
    contextStatus: document.querySelector('#context-status')?.textContent,
    inspection: document.querySelector('#inspection')?.textContent,
  }));
  await page.screenshot({ path: join(screenshotRoot, 'studio-edited.png') });
  if (edited.audition !== 'C: exact + playback mix')
    throw new Error('exact A/B state was not selected');
  if (!edited.selection.includes('Exact output is read-only'))
    throw new Error('exact output timeline was not clearly read-only');
  if (!edited.inspection?.includes('exact rendered master'))
    throw new Error('inspector did not switch to exact-render metrics');

  const exactRenderRequests = renderRequests;
  await page.$eval('[data-playback-path="keyTrimDb"]', (element) => {
    element.value = '-5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('[data-playback-path="playbackRate"]', (element) => {
    element.value = '1.25';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const runtimeOnlyEdit = await page.evaluate(() => ({
    audition: document.querySelector('#ab')?.textContent,
    speed: document.querySelector('[data-playback-out="playbackRate"]')?.textContent,
    applyDisabled: document.querySelector('#publish-playback')?.disabled,
    inspection: document.querySelector('#inspection')?.textContent,
  }));
  if (runtimeOnlyEdit.audition !== 'C: exact + playback mix') {
    throw new Error('runtime-only edit discarded the exact render');
  }
  if (runtimeOnlyEdit.speed !== '1.25x' || runtimeOnlyEdit.applyDisabled) {
    throw new Error('runtime speed did not remain separate and publishable');
  }
  if (renderRequests !== exactRenderRequests) {
    throw new Error('runtime-only edit triggered another exact render');
  }
  await page.click('#export-all');
  await page.waitForFunction(
    () => document.querySelector('#status')?.textContent?.startsWith('Export blocked:'),
    { timeout: 10_000 },
  );
  if (exportRequests !== successfulExportRequests) {
    throw new Error('unapplied playback mix reached the export endpoint');
  }
  await page.evaluate(() => {
    const cue = [...document.querySelectorAll('.cue')].find(
      (element) => element.querySelector('.cue-key')?.textContent === 'amb_dungeon',
    );
    if (!(cue instanceof HTMLElement)) throw new Error('amb_dungeon catalog row is missing');
    cue.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('#cue-title')?.textContent === 'amb_dungeon' &&
      document.querySelector('#status')?.textContent === 'amb_dungeon ready',
    { timeout: 30_000 },
  );
  await page.$eval('[data-path="normalize.enabled"]', (element) => {
    element.checked = true;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const loopWaveform = await page.$('#waveform');
  const loopBounds = await loopWaveform.boundingBox();
  if (!loopBounds) throw new Error('loop waveform has no layout bounds');
  await page.mouse.move(
    loopBounds.x + loopBounds.width * 0.2,
    loopBounds.y + loopBounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    loopBounds.x + loopBounds.width * 0.7,
    loopBounds.y + loopBounds.height * 0.5,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await page.click('#set-loop');
  await page.$eval('[data-path="loop.crossfadeMs"]', (element) => {
    element.value = '60';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('[data-playback-path="playbackRate"]', (element) => {
    element.value = '2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#ab');
  const liveLoop = await page.evaluate(() => ({
    audition: document.querySelector('#ab')?.textContent,
    auditionTitle: document.querySelector('#ab')?.getAttribute('title'),
    region: document.querySelector('#loop-region-label')?.textContent,
    seam: document.querySelector('[data-out="loop.crossfadeMs"]')?.textContent,
    status: document.querySelector('#status')?.textContent,
    loopContract: {
      checked: document.querySelector('[data-path="loop.enabled"]')?.checked,
      disabled: document.querySelector('[data-path="loop.enabled"]')?.disabled,
      preservePitchControl: document.querySelector('[data-path="preservePitch"]'),
    },
  }));
  if (liveLoop.audition !== 'B: live + playback mix')
    throw new Error('live B audition was not clearly marked approximate');
  if (!liveLoop.auditionTitle?.includes('offline-only DSP'))
    throw new Error('live B audition did not identify offline-only DSP');
  if (!liveLoop.region?.includes('60 ms master seam, 30 ms in game'))
    throw new Error('effective loop crossfade was not reported');
  if (liveLoop.seam !== 'D = 60 ms') throw new Error('loop D output was inconsistent');
  if (!liveLoop.status?.includes('Rotated tail/head seam'))
    throw new Error('live B loop schedule was not described');
  if (!liveLoop.loopContract?.checked || !liveLoop.loopContract.disabled)
    throw new Error('catalog loop contract was not locked on');
  if (liveLoop.loopContract.preservePitchControl)
    throw new Error('obsolete preserve-pitch control is still present');

  await page.click('#play');
  await new Promise((resolve) => setTimeout(resolve, 140));
  await page.$eval('[data-playback-path="keyTrimDb"]', (element) => {
    element.value = '-1';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const stoppedAt = await page.$eval('#timecode', (element) => element.textContent);
  await new Promise((resolve) => setTimeout(resolve, 140));
  const stoppedLater = await page.$eval('#timecode', (element) => element.textContent);
  if (stoppedAt !== stoppedLater) throw new Error('project edit left stale live playback running');

  await page.click('#render');
  await page.waitForFunction(
    () => document.querySelector('#status')?.textContent?.startsWith('Exact preview:'),
    { timeout: 30_000 },
  );
  const loopEdited = await page.evaluate(() => ({
    title: document.querySelector('#cue-title')?.textContent,
    region: document.querySelector('#loop-region-label')?.textContent,
    seam: document.querySelector('[data-out="loop.crossfadeMs"]')?.textContent,
    audition: document.querySelector('#ab')?.textContent,
    loopAudition: document.querySelector('#loop-playback')?.checked,
    status: document.querySelector('#status')?.textContent,
  }));
  await page.screenshot({ path: join(screenshotRoot, 'studio-loop.png') });
  if (!loopEdited.region?.includes('60 ms master seam, 30 ms in game'))
    throw new Error('loop seam region was not applied');
  if (!loopEdited.loopAudition) throw new Error('loop audition was not enabled');
  if (loopEdited.audition !== 'C: exact + playback mix')
    throw new Error('loop exact render was not selected');
  if (
    !loopEdited.status?.includes('production conform') ||
    !loopEdited.status.includes('seam') ||
    !loopEdited.status.includes('verified')
  ) {
    throw new Error('decoded loop continuity QA was not reported');
  }

  await page.evaluate(() => {
    const cue = [...document.querySelectorAll('.cue')].find(
      (element) => element.querySelector('.cue-key')?.textContent === 'ui_quest_done',
    );
    if (!(cue instanceof HTMLElement)) throw new Error('ui_quest_done catalog row is missing');
    cue.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('#cue-title')?.textContent === 'ui_quest_done' &&
      document.querySelector('#status')?.textContent === 'ui_quest_done ready',
    { timeout: 30_000 },
  );
  const uiContext = await page.evaluate(() => ({
    mock: document.querySelector('#context-empty')?.textContent,
    status: document.querySelector('#context-status')?.textContent,
    animationHidden: document.querySelector('#context-clip')?.parentElement?.style.display,
  }));
  await page.screenshot({ path: join(screenshotRoot, 'studio-ui.png') });
  if (!uiContext.mock?.includes('Quest tracker') || !uiContext.mock.includes('quest done')) {
    throw new Error('UI cue did not render its associated interface context');
  }
  if (
    uiContext.status !== 'non-positional interface context' ||
    uiContext.animationHidden !== 'none'
  ) {
    throw new Error('UI context controls were misleading');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify(
      { initial, exported, edited, runtimeOnlyEdit, liveLoop, loopEdited, uiContext, errors },
      null,
      2,
    ),
  );
} finally {
  const closing = [];
  if (browser) closing.push(browser.close());
  if (server) {
    closing.push(new Promise((resolvePromise) => server.close(resolvePromise)));
  }
  await Promise.allSettled(closing);
  try {
    rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.WOC_SFX_STUDIO_ROOT;
    else process.env.WOC_SFX_STUDIO_ROOT = previousWorkspaceRoot;
  }
}

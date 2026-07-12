// Real-page audit for the mobile custom HUD layout editor.
// Needs `npm run dev`; drives the offline game through window.__game.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareRects,
  firstOverlappingPair,
  MOBILE_HUD_GEOMETRY_EPSILON,
  visualRectFromAuthorRect,
} from './lib/overlap_geometry.mjs';

const HELP = `Usage: node scripts/mobile_hud_editor_check.mjs [options]

Options:
  --url <url>     Offline game URL (default: http://localhost:5173/)
  --self-test     Run deterministic geometry helper checks without a browser
  --help          Show this help
`;

// The THREE BufferGeometryUtils merge noise is pre-existing renderer output on
// the v0.25 base (it fires on a bare offline page load with the editor never
// opened), so the editor audit does not own it and must not fail on it.
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats|THREE\.BufferGeometryUtils/i;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseMobileHudEditorCheckArgs(args) {
  return {
    help: args.includes('--help'),
    selfTest: args.includes('--self-test'),
    url: optionValue(args, '--url', process.env.URL || 'http://localhost:5173/'),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runMobileHudGeometrySelfTest() {
  const author = { left: 10, top: 20, right: 110, bottom: 60, w: 100, h: 40 };
  for (const uiScale of [0.85, 1, 1.4]) {
    const visual = visualRectFromAuthorRect(author, uiScale, { x: 23, y: 11 });
    assert(visual.left === 23 + 10 * uiScale, `author X conversion failed at ${uiScale}`);
    assert(visual.top === 11 + 20 * uiScale, `author Y conversion failed at ${uiScale}`);
    assert(visual.w === 100 * uiScale, `author width conversion failed at ${uiScale}`);
  }
  const withinEpsilon = compareRects(
    { left: 1.5, top: 2, right: 11, bottom: 12, w: 9.5, h: 10 },
    { left: 1, top: 2, right: 11, bottom: 12, w: 10, h: 10 },
  );
  assert(withinEpsilon.matches, '0.5px geometry tolerance rejected an exact boundary');
  const overlap = firstOverlappingPair([
    {
      id: 'action.a1',
      contextId: 'world.base',
      rect: { left: 0, top: 0, right: 48, bottom: 48, w: 48, h: 48 },
    },
    {
      id: 'frame.player',
      contextId: 'world.base',
      rect: { left: 40, top: 20, right: 140, bottom: 80, w: 100, h: 60 },
    },
  ]);
  assert(overlap?.reason === 'overlap', 'deliberate mixed-host overlap was not reported');
  assert(
    overlap?.surfaceIds.join(',') === 'action.a1,frame.player',
    'overlap did not preserve surface IDs',
  );
  assert(overlap?.contextId === 'world.base', 'overlap did not preserve context');
  return { epsilon: MOBILE_HUD_GEOMETRY_EPSILON, uiScales: [0.85, 1, 1.4], overlap };
}

async function collectRect(page, selector) {
  return page.evaluate((rootSelector) => {
    const element = document.querySelector(rootSelector);
    if (!element) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      w: rect.width,
      h: rect.height,
    };
  }, selector);
}

export async function runMobileHudEditorCheck(options) {
  const [{ default: puppeteer }, { BROWSER_PATH }, { enterOfflineGame }] = await Promise.all([
    import('puppeteer-core'),
    import('./browser_path.mjs'),
    import('./enter_offline_game.mjs'),
  ]);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    const skipIntroIfHidden = async () => {
      const hidden = await page.evaluate(
        () => document.querySelector('#mobile-controls')?.style.display === 'none',
      );
      if (hidden) await page.keyboard.press('Escape');
    };
    page.on('pageerror', (error) => errors.push(`pageerror: ${String(error).slice(0, 240)}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) {
        errors.push(`console error: ${message.text().slice(0, 240)}`);
      }
    });
    await page.setViewport({
      width: 740,
      height: 360,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const client = await page.createCDPSession();
    await client.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.evaluateOnNewDocument(() => {
      const settings = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
      localStorage.setItem('woc_settings', JSON.stringify({ ...settings, interfaceMode: 2 }));
      globalThis.__mobileHudAuditStorage = { writes: 0, rejectWrites: false };
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'woc_mobile_hud_layout_v1') {
          globalThis.__mobileHudAuditStorage.writes += 1;
          if (globalThis.__mobileHudAuditStorage.rejectWrites) {
            throw new DOMException('Injected mobile HUD write failure', 'QuotaExceededError');
          }
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'HudEditorAudit',
      settleMs: 1200,
    });
    await skipIntroIfHidden();
    await sleep(250);
    await page.evaluate(() => {
      document.querySelector('.tut-skip')?.click();
      document.body.classList.add('mobile-touch', 'game-active');
      window.dispatchEvent(new Event('resize'));
      window.__game?.hud?.update?.(0.05);
    });
    await page.waitForFunction(() => !!window.__game?.mobileHudLayoutDiagnostics, {
      timeout: 30000,
    });
    const snapshot = await page.evaluate(() => ({
      diagnostics: window.__game.mobileHudLayoutDiagnostics(),
      bodyClasses: [...document.body.classList],
    }));
    const diagnostics = snapshot.diagnostics;
    assert(diagnostics.audit, 'window.__game mobile HUD audit snapshot is missing');
    assert(diagnostics.audit.profileId === 'phone', '740x360 did not resolve the phone profile');
    assert(
      diagnostics.audit.contextId === 'world.base',
      'offline game did not resolve World context',
    );
    const checked = [];
    for (const surface of diagnostics.audit.surfaces) {
      if (!['action.attack', 'frame.player'].includes(surface.id)) continue;
      const actual = await collectRect(page, surface.rootSelector);
      if (!actual) {
        const diagnostic = await page.evaluate((rootSelector) => {
          const element = document.querySelector(rootSelector);
          const describe = (candidate) => {
            if (!candidate) return null;
            const style = getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            return {
              id: candidate.id,
              className: candidate.className,
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              position: style.position,
              left: style.left,
              top: style.top,
              width: style.width,
              height: style.height,
              transform: style.transform,
              translate: style.translate,
              scale: style.scale,
              inlineStyle: candidate.getAttribute('style'),
              customWidth: style.getPropertyValue('--mobile-hud-action-attack-width'),
              customX: style.getPropertyValue('--mobile-hud-action-attack-x'),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          };
          return {
            bodyClasses: [...document.body.classList],
            element: describe(element),
            parent: describe(element?.parentElement),
            grandparent: describe(element?.parentElement?.parentElement),
          };
        }, surface.rootSelector);
        throw new Error(
          `${surface.id} is not measurable in the real page: ${JSON.stringify(diagnostic)}`,
        );
      }
      const expected = {
        left: surface.canonicalRect.x,
        top: surface.canonicalRect.y,
        right: surface.canonicalRect.x + surface.canonicalRect.width,
        bottom: surface.canonicalRect.y + surface.canonicalRect.height,
        w: surface.canonicalRect.width,
        h: surface.canonicalRect.height,
      };
      const comparison = compareRects(actual, expected);
      assert(
        comparison.matches,
        `${surface.id} DOM geometry mismatch: ${JSON.stringify({ actual, expected, comparison })}`,
      );
      checked.push({ id: surface.id, coordinateHost: surface.coordinateHost });
    }
    assert(checked.length === 2, `expected two mixed-host surfaces, got ${checked.length}`);

    await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#options-menu')).display !== 'none',
    );
    const interfaceOpened = await page.evaluate(() => {
      const button = [...document.querySelectorAll('#options-menu .opt-btn')].find(
        (candidate) => candidate.textContent === 'Interface',
      );
      button?.click();
      return !!button;
    });
    assert(interfaceOpened, 'real Options menu did not expose Interface');
    await page.waitForSelector('[data-mobile-hud-action="open-editor"]', { visible: true });
    await page.click('[data-mobile-hud-action="open-editor"]');
    await page.waitForSelector('.mobile-hud-editor', { visible: true });
    const openedState = await page.evaluate(() => {
      const view = document.querySelector('#mobile-camera-joystick');
      const viewProxy = document.querySelector('[data-mobile-hud-surface-id="control.view"]');
      const previewRect = document
        .querySelector('.mobile-hud-editor-preview')
        ?.getBoundingClientRect();
      return {
        editorOpen: window.__game.mobileHudEditor.isOpen,
        previewActive: window.__game.mobileHudLayoutDiagnostics().previewActive,
        optionsDisplay: getComputedStyle(document.querySelector('#options-menu')).display,
        locked: window.__game.mobileHudEditor.draft?.locked,
        failures: window.__game.mobileHudEditor.draft?.failures ?? [],
        writes: globalThis.__mobileHudAuditStorage.writes,
        petProxy: !!document.querySelector('[data-mobile-hud-surface-id="pet.commands"]'),
        viewDisplay: getComputedStyle(view).display,
        viewPointerEvents: getComputedStyle(view).pointerEvents,
        viewVisual: view?.getAttribute('data-mobile-hud-editor-visual'),
        viewProxyLive: viewProxy?.getAttribute('data-mobile-hud-live-visual'),
        previewRect: previewRect
          ? {
              x: previewRect.x,
              y: previewRect.y,
              width: previewRect.width,
              height: previewRect.height,
            }
          : null,
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert(openedState.editorOpen, 'Options action did not open the real editor');
    assert(openedState.previewActive, 'opening did not start live preview');
    assert(openedState.optionsDisplay === 'none', 'Options remained open under the editor');
    assert(openedState.locked === true, 'editor did not open locked');
    assert(openedState.writes === 0, 'opening the editor wrote persistent storage');
    assert(!openedState.petProxy, 'non-pet class rendered a Pet Controls proxy');
    assert(
      openedState.viewDisplay !== 'none' &&
        openedState.viewPointerEvents === 'none' &&
        openedState.viewVisual === 'control.view' &&
        openedState.viewProxyLive === 'true',
      `View did not use the real inert joystick: ${JSON.stringify(openedState)}`,
    );
    assert(
      openedState.previewRect?.x === 0 &&
        openedState.previewRect?.y === 0 &&
        openedState.previewRect?.width === openedState.viewport.width &&
        openedState.previewRect?.height === openedState.viewport.height,
      `editor preview is not one-to-one with the viewport: ${JSON.stringify(openedState)}`,
    );
    assert(
      openedState.failures.length === 0,
      `default layout opened invalid: ${JSON.stringify(openedState.failures)}`,
    );

    const previewResult = await page.evaluate(() => {
      const editor = window.__game.mobileHudEditor;
      editor.setLocked(false);
      editor.selectSurface('action.attack');
      const before = editor.draft.document.profiles.phone['action.attack'];
      const beforeX = getComputedStyle(document.querySelector('#mobile-action-attack')).left;
      const stage = document.querySelector('.mobile-hud-editor-stage');
      const preview = document.querySelector('.mobile-hud-editor-preview');
      const attackProxy = document.querySelector('[data-mobile-hud-surface-id="action.attack"]');
      const a1Proxy = document.querySelector('[data-mobile-hud-surface-id="action.a1"]');
      const attackProxyFrame = attackProxy?.querySelector('.mobile-hud-editor-proxy-frame');
      const a1ProxyFrame = a1Proxy?.querySelector('.mobile-hud-editor-proxy-frame');
      const attackProxyRect = attackProxy?.getBoundingClientRect();
      const attackProxyFrameRect = attackProxyFrame?.getBoundingClientRect();
      const attackLiveRect = document
        .querySelector('#mobile-action-attack')
        ?.getBoundingClientRect();
      const hitAtProxyCenter =
        attackProxyRect &&
        document
          .elementFromPoint(
            attackProxyRect.left + attackProxyRect.width / 2,
            attackProxyRect.top + attackProxyRect.height / 2,
          )
          ?.closest?.('[data-mobile-hud-surface-id="action.attack"]')
          ?.getAttribute('data-mobile-hud-surface-id');
      const primaryAlignment = (surfaceId, visualSelector) => {
        const proxyRect = document
          .querySelector(
            `[data-mobile-hud-surface-id="${surfaceId}"] .mobile-hud-editor-proxy-frame`,
          )
          ?.getBoundingClientRect();
        const visualRect = document.querySelector(visualSelector)?.getBoundingClientRect();
        return proxyRect && visualRect
          ? {
              delta: {
                x: Math.abs(proxyRect.x - visualRect.x),
                y: Math.abs(proxyRect.y - visualRect.y),
                width: Math.abs(proxyRect.width - visualRect.width),
                height: Math.abs(proxyRect.height - visualRect.height),
              },
              proxy: {
                x: proxyRect.x,
                y: proxyRect.y,
                width: proxyRect.width,
                height: proxyRect.height,
              },
              visual: {
                x: visualRect.x,
                y: visualRect.y,
                width: visualRect.width,
                height: visualRect.height,
              },
            }
          : null;
      };
      const visual = {
        stageBackground: getComputedStyle(stage).backgroundColor,
        stageBackdrop: getComputedStyle(stage).backdropFilter,
        previewBackground: getComputedStyle(preview).backgroundColor,
        proxyBackground: getComputedStyle(attackProxy).backgroundColor,
        proxyPadding: getComputedStyle(attackProxy).paddingTop,
        selectedProxyBorder: getComputedStyle(attackProxyFrame).borderTopColor,
        selectedProxyOutline: getComputedStyle(attackProxyFrame).outlineStyle,
        selectedProxyLabelOpacity: getComputedStyle(
          attackProxy.querySelector('.mobile-hud-editor-proxy-label'),
        ).opacity,
        unselectedProxyBorder: getComputedStyle(a1ProxyFrame).borderTopColor,
        attackOpacity: getComputedStyle(document.querySelector('#mobile-action-attack')).opacity,
        attackOutline: getComputedStyle(document.querySelector('#mobile-action-attack'))
          .outlineStyle,
        a1Opacity: getComputedStyle(
          document.querySelector(
            '#mobile-action-ring > .mobile-action-slot[data-mobile-index="0"]',
          ),
        ).opacity,
        attackVisual: document
          .querySelector('#mobile-action-attack')
          ?.getAttribute('data-mobile-hud-editor-visual'),
        a1Visual: document
          .querySelector('#mobile-action-ring > .mobile-action-slot[data-mobile-index="0"]')
          ?.getAttribute('data-mobile-hud-editor-visual'),
        hitAtProxyCenter,
        primaryAlignments: {
          movement: primaryAlignment('control.movement', '#mobile-move-joystick'),
          view: primaryAlignment('control.view', '#mobile-camera-joystick'),
          minimap: primaryAlignment('minimap.cluster', '#minimap-disc'),
          consumables: primaryAlignment('utility.consumables', '#mobile-consumables-toggle'),
        },
        hitAlignment:
          attackProxyRect && attackLiveRect
            ? {
                x: Math.abs(attackProxyRect.x - attackLiveRect.x),
                y: Math.abs(attackProxyRect.y - attackLiveRect.y),
                width: Math.abs(attackProxyRect.width - attackLiveRect.width),
                height: Math.abs(attackProxyRect.height - attackLiveRect.height),
              }
            : null,
        paintedAlignment:
          attackProxyFrameRect && attackLiveRect
            ? {
                centerX: Math.abs(
                  attackProxyFrameRect.x +
                    attackProxyFrameRect.width / 2 -
                    (attackLiveRect.x + attackLiveRect.width / 2),
                ),
                centerY: Math.abs(
                  attackProxyFrameRect.y +
                    attackProxyFrameRect.height / 2 -
                    (attackLiveRect.y + attackLiveRect.height / 2),
                ),
                width: Math.abs(attackProxyFrameRect.width - 40),
                height: Math.abs(attackProxyFrameRect.height - 40),
              }
            : null,
      };
      document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const after = editor.draft.document.profiles.phone['action.attack'];
      const afterX = getComputedStyle(document.querySelector('#mobile-action-attack')).left;
      editor.setContext('arena.standard');
      editor.setContext('world.base');
      editor.setLocked(true);
      return {
        before,
        after,
        beforeX,
        afterX,
        visual,
        locked: editor.draft.locked,
        writes: globalThis.__mobileHudAuditStorage.writes,
        previewActive: window.__game.mobileHudLayoutDiagnostics().previewActive,
      };
    });
    assert(
      previewResult.visual.stageBackground === 'rgba(0, 0, 0, 0)',
      `mobile editor stage is dimming the runtime: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.stageBackdrop === 'none',
      `mobile editor stage has a backdrop filter: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.previewBackground === 'rgba(0, 0, 0, 0)',
      `mobile editor preview has a fill: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.proxyBackground === 'rgba(0, 0, 0, 0)' &&
        previewResult.visual.proxyPadding === '0px',
      `mobile editor proxy is still drawing a dark button box: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.unselectedProxyBorder === 'rgba(0, 0, 0, 0)',
      `mobile editor unselected proxy is still drawing a footprint border: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.selectedProxyBorder !== 'rgba(0, 0, 0, 0)' &&
        previewResult.visual.selectedProxyOutline === 'solid' &&
        previewResult.visual.selectedProxyLabelOpacity === '0',
      `mobile editor selected painted frame is missing: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.hitAlignment &&
        Object.values(previewResult.visual.hitAlignment).every((delta) => delta <= 1),
      `mobile editor hit target is misaligned with its live HUD root: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.paintedAlignment &&
        Object.values(previewResult.visual.paintedAlignment).every((delta) => delta <= 1),
      `mobile editor frame is misaligned with the painted Attack face: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      Object.values(previewResult.visual.primaryAlignments).every(
        (alignment) => alignment && Object.values(alignment.delta).every((delta) => delta <= 1),
      ),
      `primary HUD footprints are misaligned with live visuals: ${JSON.stringify(previewResult.visual.primaryAlignments)}`,
    );
    assert(
      previewResult.visual.attackOpacity === '1' && previewResult.visual.a1Opacity === '0.45',
      `mobile editor live opacity is wrong: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.attackOutline === 'none',
      `mobile editor drew selection on the transparent live hitbox: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.attackVisual === 'action.attack' &&
        previewResult.visual.a1Visual === 'action.a1',
      `mobile editor did not bind live HUD visuals: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.visual.hitAtProxyCenter === 'action.attack',
      `transparent proxy did not own hit testing: ${JSON.stringify(previewResult.visual)}`,
    );
    assert(
      previewResult.after.offsetX === previewResult.before.offsetX + 1,
      'nudge did not update the canonical draft',
    );
    assert(previewResult.beforeX !== previewResult.afterX, 'live HUD did not follow the draft');
    assert(previewResult.locked, 'Lock did not preserve and lock the preview');
    assert(previewResult.writes === 0, 'live preview wrote persistent storage');
    assert(previewResult.previewActive, 'scene switching or Lock ended preview');

    const dragPoints = await page.evaluate(() => {
      const editor = window.__game.mobileHudEditor;
      editor.setLocked(false);
      editor.selectSurface('action.attack');
      const attack = document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.getBoundingClientRect();
      const a1 = document
        .querySelector('[data-mobile-hud-surface-id="action.a1"]')
        ?.getBoundingClientRect();
      return attack && a1
        ? {
            from: { x: attack.left + attack.width / 2, y: attack.top + attack.height / 2 },
            to: { x: a1.left + a1.width / 2, y: a1.top + a1.height / 2 },
          }
        : null;
    });
    assert(dragPoints, 'real pointer drag surfaces were not measurable');
    await page.mouse.move(dragPoints.from.x, dragPoints.from.y);
    await page.mouse.down();
    await page.mouse.move(dragPoints.to.x, dragPoints.to.y, { steps: 6 });
    await sleep(50);
    const dragPreview = await page.evaluate(() => {
      const editor = window.__game.mobileHudEditor;
      const proxy = document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.getBoundingClientRect();
      const live = document.querySelector('#mobile-action-attack')?.getBoundingClientRect();
      return {
        failures: editor.draft?.failures ?? [],
        fallback: window.__game.mobileHudLayoutDiagnostics().audit.fallback,
        alignment:
          proxy && live
            ? {
                x: Math.abs(proxy.x - live.x),
                y: Math.abs(proxy.y - live.y),
                width: Math.abs(proxy.width - live.width),
                height: Math.abs(proxy.height - live.height),
              }
            : null,
      };
    });
    await page.mouse.up();
    assert(dragPreview.failures.length > 0, 'real pointer drag did not create an overlap failure');
    assert(!dragPreview.fallback, 'invalid ephemeral pointer drag fell back to built-in defaults');
    assert(
      dragPreview.alignment && Object.values(dragPreview.alignment).every((delta) => delta <= 1),
      `live HUD did not track the real pointer drag: ${JSON.stringify(dragPreview)}`,
    );

    await page.evaluate(() => {
      const editor = window.__game.mobileHudEditor;
      editor.setLocked(false);
      editor.selectSurface('action.attack');
      document.querySelector('[data-mobile-hud-control="reset-selected"]')?.click();
      document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      editor.setLocked(true);
    });

    const saved = await page.evaluate(async () => {
      const editor = window.__game.mobileHudEditor;
      const expected = editor.draft.document.profiles.phone['action.attack'];
      const ok = await editor.save();
      const serialized = localStorage.getItem('woc_mobile_hud_layout_v1');
      return {
        ok,
        expected,
        serialized,
        parsed: serialized ? JSON.parse(serialized) : null,
        writes: globalThis.__mobileHudAuditStorage.writes,
        editorOpen: editor.isOpen,
        previewActive: window.__game.mobileHudLayoutDiagnostics().previewActive,
      };
    });
    assert(saved.ok, 'valid preview did not save');
    assert(saved.writes === 1, `Save performed ${saved.writes} writes instead of one`);
    assert(saved.parsed?.enabled === true, 'first Save did not activate the custom document');
    assert(!saved.editorOpen && !saved.previewActive, 'successful Save did not close preview');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'HudEditorAudit',
      settleMs: 800,
    });
    await skipIntroIfHidden();
    await sleep(250);
    await page.waitForFunction(() => !!window.__game?.mobileHudLayoutDiagnostics, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      document.querySelector('.tut-skip')?.click();
      window.dispatchEvent(new Event('resize'));
    });
    const reloaded = await page.evaluate(() => ({
      diagnostics: window.__game.mobileHudLayoutDiagnostics(),
      attackLeft: getComputedStyle(document.querySelector('#mobile-action-attack')).left,
      stored: JSON.parse(localStorage.getItem('woc_mobile_hud_layout_v1')),
    }));
    assert(reloaded.diagnostics.audit.enabled, 'reload did not activate the saved document');
    assert(
      reloaded.stored.profiles.phone['action.attack'].offsetX === saved.expected.offsetX,
      'reload changed the canonical right-handed placement',
    );

    await page.setViewport({
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(300);
    const tabletProfile = await page.evaluate(
      () => window.__game.mobileHudLayoutDiagnostics().audit.profileId,
    );
    assert(tabletProfile === 'tablet', '1024x768 did not switch to the tablet profile');

    await page.setViewport({
      width: 740,
      height: 360,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
      localStorage.setItem('woc_settings', JSON.stringify({ ...settings, leftHandedTouch: true }));
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'HudEditorAudit',
      settleMs: 800,
    });
    await skipIntroIfHidden();
    await sleep(250);
    await page.waitForFunction(() => !!window.__game?.mobileHudLayoutDiagnostics, {
      timeout: 30000,
    });
    const leftHanded = await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      return {
        audit: window.__game.mobileHudLayoutDiagnostics().audit,
        attackLeft: getComputedStyle(document.querySelector('#mobile-action-attack')).left,
      };
    });
    assert(leftHanded.audit.handedness === 'left', 'saved layout did not derive left handedness');
    assert(leftHanded.attackLeft !== reloaded.attackLeft, 'left-handed placement was not mirrored');

    const rollback = await page.evaluate(() => {
      const editor = window.__game.mobileHudEditor;
      const before = getComputedStyle(document.querySelector('#mobile-action-attack')).left;
      const writesBefore = globalThis.__mobileHudAuditStorage.writes;
      editor.open();
      editor.setLocked(false);
      editor.selectSurface('action.attack');
      document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const preview = getComputedStyle(document.querySelector('#mobile-action-attack')).left;
      editor.cancel();
      return {
        before,
        preview,
        after: getComputedStyle(document.querySelector('#mobile-action-attack')).left,
        writes: globalThis.__mobileHudAuditStorage.writes - writesBefore,
      };
    });
    assert(rollback.preview !== rollback.before, 'Cancel case did not create a live edit');
    assert(rollback.after === rollback.before, 'Cancel did not restore exact entry geometry');
    assert(rollback.writes === 0, 'Cancel wrote storage');

    const failedWrite = await page.evaluate(async () => {
      const editor = window.__game.mobileHudEditor;
      editor.open();
      editor.setLocked(false);
      editor.selectSurface('action.attack');
      const draft = JSON.stringify(editor.draft.document);
      globalThis.__mobileHudAuditStorage.rejectWrites = true;
      const ok = await editor.save();
      globalThis.__mobileHudAuditStorage.rejectWrites = false;
      const result = {
        ok,
        open: editor.isOpen,
        previewActive: window.__game.mobileHudLayoutDiagnostics().previewActive,
        draftPreserved: JSON.stringify(editor.draft.document) === draft,
      };
      editor.cancel();
      return result;
    });
    assert(!failedWrite.ok, 'injected storage failure reported success');
    assert(failedWrite.open && failedWrite.previewActive, 'write failure closed live preview');
    assert(failedWrite.draftPreserved, 'write failure discarded the complete draft');

    const inputIsolation = await page.evaluate(async () => {
      const editor = window.__game.mobileHudEditor;
      const input = window.__game.input;
      const gamepad = window.__game.gamepad;
      const world = window.__game.world;
      let haptics = 0;
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: () => {
          haptics += 1;
          return true;
        },
      });
      const buttons = Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      buttons[0] = { pressed: true, touched: true, value: 1 };
      const fakePad = {
        id: 'Xbox Controller Audit',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: performance.now(),
        axes: [1, -1, 1, 1],
        buttons,
        vibrationActuator: null,
        hapticActuators: [],
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => [fakePad],
      });
      gamepad.start();
      editor.open();
      const yawBefore = input.camYaw;
      const targetBefore = world.targetId ?? world.targetEntityId ?? null;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      for (const code of ['Digit1', 'Tab', 'KeyF']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      }
      const canvas = document.querySelector('#game-canvas');
      const touchControl = (selector, pointerId = 80) => {
        const control = document.querySelector(selector);
        control?.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId,
            pointerType: 'touch',
            clientX: 20,
            clientY: 20,
            bubbles: true,
          }),
        );
        control?.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId,
            pointerType: 'touch',
            clientX: 20,
            clientY: 20,
            bubbles: true,
          }),
        );
      };
      const optionsVisible = () => {
        const options = document.querySelector('#options-menu');
        return !!options && getComputedStyle(options).display !== 'none';
      };
      const swipe = (pointerId, x, y) => {
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId,
            pointerType: 'touch',
            clientX: x + 60,
            clientY: y,
            bubbles: true,
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId,
            pointerType: 'touch',
            clientX: x + 60,
            clientY: y,
            bubbles: true,
          }),
        );
      };
      const viewRect = document
        .querySelector('[data-mobile-hud-surface-id="control.view"]')
        ?.getBoundingClientRect();
      const viewPoint = viewRect
        ? { x: viewRect.left + viewRect.width / 2, y: viewRect.top + viewRect.height / 2 }
        : null;
      swipe(71, 500, 180);
      if (viewPoint) swipe(72, viewPoint.x, viewPoint.y);
      const collapseBefore = document
        .querySelector('#mobile-menu-collapse-toggle')
        ?.getAttribute('aria-expanded');
      for (const selector of [
        '#mobile-move-zone',
        '#mobile-action-attack',
        '#mobile-target-cycle',
        '#mobile-jump',
        '#mobile-menu-collapse-toggle',
        '#mobile-menu',
      ]) {
        touchControl(selector);
      }
      const collapseBlocked =
        document.querySelector('#mobile-menu-collapse-toggle')?.getAttribute('aria-expanded') ===
        collapseBefore;
      const menuBlocked = !optionsVisible();
      gamepad.poll(1 / 60);
      const blocked = input.readMoveInput();
      const yawBlocked = input.camYaw;
      const targetBlocked = world.targetId ?? world.targetEntityId ?? null;
      const gamepadBlocked = input.readMoveInput();
      const hapticsWhileBlocked = haptics;
      editor.cancel();
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      fakePad.axes[0] = 0;
      fakePad.axes[1] = -1;
      fakePad.axes[2] = 0;
      fakePad.axes[3] = 0;
      buttons[0] = { pressed: false, touched: false, value: 0 };
      gamepad.poll(1 / 60);
      const gamepadRestored = input.readMoveInput();
      gamepad.stop();
      const jump = document.querySelector('#mobile-jump');
      jump?.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 91,
          pointerType: 'touch',
          clientX: 20,
          clientY: 20,
          bubbles: true,
        }),
      );
      const touchActionRestored = input.readMoveInput().jump;
      jump?.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 91,
          pointerType: 'touch',
          clientX: 20,
          clientY: 20,
          bubbles: true,
        }),
      );
      touchControl('#mobile-menu-collapse-toggle', 92);
      // The disclosure chip is optional chrome: the current menu cluster ships
      // the direct buttons with no collapse toggle, so a missing chip is N/A
      // (pass), not a regression.
      const collapseRestored = document.querySelector('#mobile-menu-collapse-toggle')
        ? document.querySelector('#mobile-menu-collapse-toggle').getAttribute('aria-expanded') !==
          collapseBefore
        : true;
      touchControl('#mobile-menu', 93);
      const menuRestored = optionsVisible();
      window.__game.hud.closeAll?.();
      const yawBeforeOutsideSwipe = input.camYaw;
      swipe(73, 500, 180);
      const cameraRestoredOutside = input.camYaw !== yawBeforeOutsideSwipe;
      const yawBeforeInsideSwipe = input.camYaw;
      if (viewPoint) swipe(74, viewPoint.x, viewPoint.y);
      const cameraRestoredInside = !!viewPoint && input.camYaw !== yawBeforeInsideSwipe;
      const view = document.querySelector('#mobile-camera-joystick');
      return {
        blocked,
        cameraBlocked: yawBefore === yawBlocked,
        targetBlocked: targetBefore === targetBlocked,
        hapticsBlocked: hapticsWhileBlocked === 0,
        gamepadBlocked,
        gamepadRestored,
        collapseBlocked,
        menuBlocked,
        touchActionRestored,
        collapseRestored,
        menuRestored,
        cameraRestoredOutside,
        cameraRestoredInside,
        viewDisplay: getComputedStyle(view).display,
        viewPointerEvents: getComputedStyle(view).pointerEvents,
      };
    });
    await page.keyboard.down('w');
    const restoredKeyboard = await page.evaluate(() => window.__game.input.readMoveInput());
    await page.keyboard.up('w');
    assert(
      !inputIsolation.blocked.forward && !inputIsolation.blocked.jump,
      'keyboard movement or jump leaked through the editor',
    );
    assert(inputIsolation.cameraBlocked, 'touch camera movement leaked through the editor');
    assert(inputIsolation.targetBlocked, 'target or interaction input leaked through the editor');
    assert(inputIsolation.hapticsBlocked, 'touch haptics leaked through the editor');
    assert(inputIsolation.collapseBlocked, 'mobile menu disclosure changed through the editor');
    assert(inputIsolation.menuBlocked, 'mobile game menu opened through the editor');
    assert(
      !inputIsolation.gamepadBlocked.forward && !inputIsolation.gamepadBlocked.jump,
      'gamepad movement or action leaked through the editor',
    );
    assert(inputIsolation.gamepadRestored.forward, 'gamepad movement did not return after close');
    assert(inputIsolation.touchActionRestored, 'mobile action input did not return after close');
    assert(inputIsolation.collapseRestored, 'mobile menu disclosure did not return after close');
    assert(inputIsolation.menuRestored, 'mobile game menu did not return after close');
    assert(
      inputIsolation.cameraRestoredOutside,
      'touch camera movement outside View did not return after close',
    );
    assert(
      inputIsolation.cameraRestoredInside,
      'touch camera movement inside the saved View footprint did not return after close',
    );
    assert(restoredKeyboard.forward, 'keyboard movement did not return after close');
    assert(
      inputIsolation.viewDisplay === 'none' || inputIsolation.viewPointerEvents === 'none',
      'disabled View created an interactive deadzone',
    );
    assert(errors.length === 0, errors.join('\n'));
    return {
      viewport: '740x360',
      contextId: diagnostics.audit.contextId,
      bodyClasses: snapshot.bodyClasses,
      checked,
      optionsEntry: true,
      livePreview: true,
      saveReload: true,
      cancelAndWriteFailure: true,
      keyboardTouchCameraIsolation: true,
      gamepadIsolation: true,
      reservedViewSemantics: true,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseMobileHudEditorCheckArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = options.selfTest
    ? runMobileHudGeometrySelfTest()
    : await runMobileHudEditorCheck(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) await main();

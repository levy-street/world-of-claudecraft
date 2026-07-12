import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  MobileHudCustomLayoutDomApplier,
  MobileHudCustomLayoutState,
} from '../../src/game/mobile_hud_layout_applier';
import { FocusManager } from '../../src/ui/focus_manager';
import { MobileHudEditor } from '../../src/ui/mobile_hud_editor';
import type {
  MobileHudLayoutDocumentV1,
  MobileHudValidationFailure,
} from '../../src/ui/mobile_hud_editor_types';
import { MOBILE_HUD_REGISTRY } from '../../src/ui/mobile_hud_registry';
import { cleanup } from './_harness';

afterEach(() => {
  cleanup();
  document.body.className = '';
});

function documentFixture(): MobileHudLayoutDocumentV1 {
  return {
    schemaVersion: 1,
    enabled: false,
    profiles: MOBILE_HUD_REGISTRY.defaults,
  };
}

async function waitForEditorGeometry(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function expectSameRect(actual: DOMRect | undefined, expected: DOMRect): void {
  expect(actual?.x).toBeCloseTo(expected.x, 1);
  expect(actual?.y).toBeCloseTo(expected.y, 1);
  expect(actual?.width).toBeCloseTo(expected.width, 1);
  expect(actual?.height).toBeCloseTo(expected.height, 1);
}

describe('mobile HUD editor real DOM and CSS', () => {
  it('makes Save visibly and functionally disabled while validation errors exist', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const storageSave = vi.fn(async () => undefined);
    const failure: MobileHudValidationFailure = {
      reason: 'overlap',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['action.attack', 'action.a1'],
    };
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      validateDraft: () => [failure],
      storage: { load: async () => null, save: storageSave },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const save = document.querySelector<HTMLButtonElement>('[data-mobile-hud-action="save"]');
    const style = getComputedStyle(save as HTMLButtonElement);

    expect(save?.disabled).toBe(true);
    expect(save?.getAttribute('aria-disabled')).toBe('true');
    expect(Number(style.opacity)).toBeLessThanOrEqual(0.45);
    expect(style.cursor).toBe('not-allowed');
    save?.click();
    await Promise.resolve();
    expect(storageSave).not.toHaveBeenCalled();

    editor.close();
  });

  it('renders real HUD fragments through opacity while proxies stay transparent', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ring = document.createElement('div');
    ring.id = 'mobile-action-ring';
    const action = document.createElement('button');
    action.className = 'mobile-action-slot';
    action.dataset.mobileIndex = '0';
    const attack = document.createElement('button');
    attack.id = 'mobile-action-attack';
    const cameraJoystick = document.createElement('div');
    cameraJoystick.id = 'mobile-camera-joystick';
    cameraJoystick.className = 'mobile-joystick';
    cameraJoystick.append(document.createElement('div'));
    const emptyBuffBar = document.createElement('div');
    emptyBuffBar.id = 'buff-bar';
    const arenaStatus = document.createElement('div');
    arenaStatus.id = 'arena-status';
    ring.append(action, attack);
    document.body.append(ring, cameraJoystick, emptyBuffBar, arenaStatus);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    editor.setLocked(false);
    editor.selectSurface('action.attack');

    const stage = document.querySelector<HTMLElement>('.mobile-hud-editor-stage');
    const preview = document.querySelector<HTMLElement>('.mobile-hud-editor-preview');
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="action.attack"]',
    );
    const unselectedProxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="action.a1"]',
    );
    const proxyLabel = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-label');
    const proxyFrame = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
    const unselectedProxyFrame = unselectedProxy?.querySelector<HTMLElement>(
      '.mobile-hud-editor-proxy-frame',
    );
    const emptyBuffProxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="auras.player_buffs"]',
    );
    const emptyBuffLabel = emptyBuffProxy?.querySelector<HTMLElement>(
      '.mobile-hud-editor-proxy-label',
    );
    const emptyBuffFrame = emptyBuffProxy?.querySelector<HTMLElement>(
      '.mobile-hud-editor-proxy-frame',
    );

    expect(getComputedStyle(stage as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(stage as HTMLElement).backdropFilter).toBe('none');
    expect(getComputedStyle(preview as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(preview?.getBoundingClientRect()).toMatchObject({ x: 0, y: 0, width: 740, height: 360 });
    expect(getComputedStyle(proxy as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(proxy as HTMLElement).paddingTop).toBe('0px');
    expect(getComputedStyle(proxy as HTMLElement).borderTopStyle).toBe('none');
    expect(getComputedStyle(proxy as HTMLElement).outlineStyle).toBe('none');
    expect(getComputedStyle(unselectedProxyFrame as HTMLElement).borderTopColor).toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(getComputedStyle(action).opacity).toBe('0.45');
    expect(getComputedStyle(attack).opacity).toBe('1');
    expect(getComputedStyle(attack).outlineStyle).toBe('none');
    expect(getComputedStyle(proxyFrame as HTMLElement).outlineStyle).toBe('solid');
    expect(getComputedStyle(proxyFrame as HTMLElement).outlineOffset).toBe('-3px');
    expect(getComputedStyle(proxyLabel as HTMLElement).opacity).toBe('0');
    expect(getComputedStyle(cameraJoystick).display).not.toBe('none');
    expect(getComputedStyle(cameraJoystick).pointerEvents).toBe('none');
    expect(emptyBuffProxy?.getAttribute('data-mobile-hud-live-visual')).toBe('false');
    expect(getComputedStyle(emptyBuffFrame as HTMLElement).borderTopColor).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(getComputedStyle(emptyBuffLabel as HTMLElement).opacity).toBe('1');
    emptyBuffProxy?.click();
    expect(emptyBuffProxy?.classList.contains('is-selected')).toBe(true);
    expect(getComputedStyle(emptyBuffFrame as HTMLElement).outlineStyle).toBe('solid');

    editor.setContext('arena.standard');
    const arenaProxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="status.arena.generic"]',
    );
    const arenaLabel = arenaProxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-label');
    expect(arenaProxy?.getAttribute('data-mobile-hud-placeholder')).toBe('when-empty');
    expect(arenaProxy?.getAttribute('data-mobile-hud-live-visual')).toBe('false');
    expect(arenaProxy?.getBoundingClientRect().width).toBeGreaterThan(200);
    expect(
      getComputedStyle(
        arenaProxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame') as HTMLElement,
      ).borderTopColor,
    ).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(arenaLabel as HTMLElement).opacity).toBe('1');

    editor.close();
  });

  it('portals only the center message above the editor and restores its HUD home', async () => {
    await page.viewport(740, 360);
    document.body.className =
      'mobile-touch game-active hud-mobile-compact mobile-center-message-visible';
    const ui = document.createElement('div');
    ui.id = 'ui';
    const sibling = document.createElement('div');
    sibling.id = 'banner-sibling';
    const banner = document.createElement('div');
    banner.id = 'banner';
    ui.append(banner, sibling);
    document.body.append(ui);
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const root = document.querySelector<HTMLElement>('.mobile-hud-editor');
    expect(banner.parentElement).toBe(document.body);
    expect(getComputedStyle(ui).zIndex).toBe('80');
    expect(getComputedStyle(banner).zIndex).toBe('1001');
    expect(getComputedStyle(root as HTMLElement).zIndex).toBe('1000');

    editor.close();
    expect(banner.parentElement).toBe(ui);
    expect(ui.children[0]).toBe(banner);
    expect(ui.children[1]).toBe(sibling);
  });

  it('fits a live Target proxy to its painted frame instead of the transparent root envelope', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ui = document.createElement('div');
    ui.id = 'ui';
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.className = 'unitframe';
    target.style.display = 'flex';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    const portraitFace = document.createElement('div');
    portraitFace.className = 'portrait';
    const level = document.createElement('div');
    level.className = 'level-chip';
    portrait.append(portraitFace, level);
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    const name = document.createElement('div');
    name.className = 'uf-name';
    const hp = document.createElement('div');
    hp.className = 'bar hp';
    const resource = document.createElement('div');
    resource.className = 'bar';
    resource.id = 'tf-resource';
    const castbar = document.createElement('div');
    castbar.id = 'tf-castbar';
    bars.append(name, hp, resource, castbar);
    const targetDebuffs = document.createElement('div');
    targetDebuffs.id = 'tf-debuffs';
    target.append(bars, portrait, targetDebuffs);
    ui.append(target);
    document.body.append(ui);
    const measurement = {
      geometry: {
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      uiScale: 1,
    } as const;
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    const apply = () =>
      applier.apply({
        profileId: 'phone',
        contextId: 'world.base',
        handedness: 'right',
        measurement,
        eligible: true,
      });

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => measurement.geometry,
      getHandedness: () => 'right',
      beginPreview: (document) => {
        state.beginPreview(document);
        apply();
      },
      updatePreview: (document) => {
        state.updatePreview(document);
        apply();
      },
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: () => {
        state.endPreview();
        apply();
      },
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.target"]',
    );
    const paintedRects = [bars, portraitFace, level]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const paintedRect = {
      x: Math.min(...paintedRects.map((rect) => rect.x)),
      y: Math.min(...paintedRects.map((rect) => rect.y)),
      width:
        Math.max(...paintedRects.map((rect) => rect.right)) -
        Math.min(...paintedRects.map((rect) => rect.x)),
      height:
        Math.max(...paintedRects.map((rect) => rect.bottom)) -
        Math.min(...paintedRects.map((rect) => rect.y)),
    };
    const proxyFrame = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
    const proxyRect = proxyFrame?.getBoundingClientRect();

    expect(proxyRect).toBeDefined();
    expect(proxyRect?.x).toBeCloseTo(paintedRect.x, 1);
    expect(proxyRect?.y).toBeCloseTo(paintedRect.y, 1);
    expect(proxyRect?.width).toBeCloseTo(paintedRect.width, 1);
    expect(proxyRect?.height).toBeCloseTo(paintedRect.height, 1);
    expect(target.getBoundingClientRect()).toMatchObject({ width: 236, height: 68 });
    editor.close();
  });

  it('uses the exact Target fallback when the frame and its descendants are not rendered', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.className = 'unitframe';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    target.append(portrait, bars);
    document.body.append(target);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.target"]',
    );
    const frame = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');

    expect(target.getBoundingClientRect()).toMatchObject({ width: 0, height: 0 });
    expect(proxy?.getAttribute('data-mobile-hud-live-visual')).toBe('false');
    expect(frame?.getBoundingClientRect()).toMatchObject({ width: 239, height: 69 });
    editor.close();
  });

  it('remeasures dynamic aura content when editor geometry refreshes', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const buffBar = document.createElement('div');
    buffBar.id = 'buff-bar';
    buffBar.style.cssText =
      'display:flex;position:fixed;left:100px;top:80px;width:auto;height:auto;transform:none';
    document.body.append(buffBar);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="auras.player_buffs"]',
    );
    expect(proxy?.getAttribute('data-mobile-hud-live-visual')).toBe('false');

    const buff = document.createElement('div');
    buff.className = 'buff';
    buff.style.cssText = 'display:block;width:28px;height:28px;flex:none';
    buffBar.append(buff);
    await waitForEditorGeometry();

    const frame = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
    const buffRect = buff.getBoundingClientRect();
    expect(proxy?.getAttribute('data-mobile-hud-live-visual')).toBe('true');
    expect(frame?.getBoundingClientRect()).toMatchObject({
      x: buffRect.x,
      y: buffRect.y,
      width: buffRect.width,
      height: buffRect.height,
    });
    editor.close();
  });

  it('ignores non-geometric descendant style churn while observing live frame geometry', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.style.cssText =
      'display:block;position:fixed;left:120px;top:120px;width:180px;height:70px;transform:none';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    bars.style.cssText = 'display:block;width:180px;height:70px';
    const fill = document.createElement('div');
    fill.className = 'uf-hp-fill';
    fill.style.width = '100%';
    bars.append(fill);
    player.append(bars);
    document.body.append(player);
    const scheduled: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    });

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
      scheduleFrame,
      cancelFrame: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    fill.style.width = '50%';
    await Promise.resolve();
    expect(scheduleFrame).not.toHaveBeenCalled();

    bars.style.display = 'none';
    await Promise.resolve();
    expect(scheduleFrame).toHaveBeenCalledTimes(1);
    editor.close();
  });

  it('remeasures dependent Player bars when hidden and style state changes after open', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const visibilityRules = document.createElement('style');
    visibilityRules.textContent = `
      #castbar[hidden] { display: none !important; }
      #castbar:not([hidden]) { display: block !important; }
    `;
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.style.cssText =
      'display:block;position:fixed;left:120px;top:120px;width:180px;height:70px;transform:none';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    bars.style.cssText = 'display:block;width:180px;height:70px';
    player.append(bars);
    const castbar = document.createElement('div');
    castbar.id = 'castbar';
    castbar.hidden = true;
    castbar.style.cssText =
      'position:fixed;left:20px;top:24px;width:90px;height:14px;transform:none';
    const swingbar = document.createElement('div');
    swingbar.id = 'swingbar';
    swingbar.style.cssText =
      'display:none;position:fixed;left:520px;top:280px;width:80px;height:12px;transform:none';
    document.body.append(visibilityRules, player, castbar, swingbar);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const frame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.player"] .mobile-hud-editor-proxy-frame',
    );
    const initialRect = frame?.getBoundingClientRect();
    expect(initialRect).toBeDefined();

    castbar.hidden = false;
    await waitForEditorGeometry();
    expect(getComputedStyle(castbar).display).toBe('block');
    expect(frame?.getBoundingClientRect().x).toBeCloseTo(castbar.getBoundingClientRect().x, 1);

    castbar.hidden = true;
    await waitForEditorGeometry();
    expectSameRect(frame?.getBoundingClientRect(), initialRect as DOMRect);

    swingbar.style.display = 'block';
    await waitForEditorGeometry();
    const expandedRect = frame?.getBoundingClientRect();
    const swingRect = swingbar.getBoundingClientRect();
    expect(expandedRect?.right).toBeCloseTo(swingRect.right, 1);
    expect(expandedRect?.bottom).toBeCloseTo(swingRect.bottom, 1);

    swingbar.style.display = 'none';
    await waitForEditorGeometry();
    expectSameRect(frame?.getBoundingClientRect(), initialRect as DOMRect);
    editor.close();
  });

  it('remeasures Player and Target descendants after class-based show and hide changes', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const visibilityRules = document.createElement('style');
    visibilityRules.textContent = `
      #combo-row, #tf-castbar { display: none !important; }
      #combo-row.hud-test-expanded {
        display: block !important;
        width: 100% !important;
        height: 120px !important;
        margin: 0 !important;
      }
      #tf-castbar.hud-test-expanded {
        display: block !important;
        width: 100% !important;
        height: 80px !important;
        margin: 0 !important;
      }
    `;
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.style.cssText =
      'display:block;position:fixed;left:80px;top:90px;width:140px;height:auto;transform:none';
    const playerBars = document.createElement('div');
    playerBars.className = 'uf-bars';
    playerBars.style.cssText = 'display:block;width:140px;height:auto';
    const playerBase = document.createElement('div');
    playerBase.style.cssText = 'display:block;width:140px;height:24px';
    const combo = document.createElement('div');
    combo.id = 'combo-row';
    playerBars.append(playerBase, combo);
    player.append(playerBars);
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.style.cssText =
      'display:block;position:fixed;left:380px;top:70px;width:150px;height:auto;transform:none';
    const targetBars = document.createElement('div');
    targetBars.className = 'uf-bars';
    targetBars.style.cssText = 'display:block;width:150px;height:auto';
    const targetBase = document.createElement('div');
    targetBase.style.cssText = 'display:block;width:150px;height:26px';
    const targetCast = document.createElement('div');
    targetCast.id = 'tf-castbar';
    targetBars.append(targetBase, targetCast);
    target.append(targetBars);
    document.body.append(visibilityRules, player, target);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const playerFrame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.player"] .mobile-hud-editor-proxy-frame',
    );
    const targetFrame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.target"] .mobile-hud-editor-proxy-frame',
    );
    const initialPlayerRect = playerFrame?.getBoundingClientRect();
    const initialTargetRect = targetFrame?.getBoundingClientRect();
    expect(initialPlayerRect).toBeDefined();
    expect(initialTargetRect).toBeDefined();

    combo.classList.add('hud-test-expanded');
    await waitForEditorGeometry();
    expect(playerFrame?.getBoundingClientRect().bottom).toBeCloseTo(
      playerBars.getBoundingClientRect().bottom,
      1,
    );
    combo.classList.remove('hud-test-expanded');
    await waitForEditorGeometry();
    expectSameRect(playerFrame?.getBoundingClientRect(), initialPlayerRect as DOMRect);

    targetCast.classList.add('hud-test-expanded');
    await waitForEditorGeometry();
    expect(targetFrame?.getBoundingClientRect().bottom).toBeCloseTo(
      targetBars.getBoundingClientRect().bottom,
      1,
    );
    targetCast.classList.remove('hud-test-expanded');
    await waitForEditorGeometry();
    expectSameRect(targetFrame?.getBoundingClientRect(), initialTargetRect as DOMRect);
    editor.close();
  });

  it('keeps an exact aura outline inside a 48px editor touch target', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const buffBar = document.createElement('div');
    buffBar.id = 'buff-bar';
    buffBar.style.cssText =
      'display:flex;position:fixed;left:0;top:0;width:auto;height:auto;transform:none';
    const buff = document.createElement('div');
    buff.className = 'buff';
    buff.style.cssText = 'display:block;width:28px;height:28px;flex:none';
    buffBar.append(buff);
    document.body.append(buffBar);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="auras.player_buffs"]',
    );
    const outline = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
    const buffRect = buff.getBoundingClientRect();
    const proxyRect = proxy?.getBoundingClientRect();
    const outlineRect = outline?.getBoundingClientRect();
    const previewRect = document
      .querySelector<HTMLElement>('.mobile-hud-editor-preview')
      ?.getBoundingClientRect();
    const clippedWidth =
      proxyRect && previewRect
        ? Math.min(proxyRect.right, previewRect.right) - Math.max(proxyRect.left, previewRect.left)
        : 0;
    const clippedHeight =
      proxyRect && previewRect
        ? Math.min(proxyRect.bottom, previewRect.bottom) - Math.max(proxyRect.top, previewRect.top)
        : 0;

    expect(outline).not.toBeNull();
    expect(proxyRect?.width).toBeGreaterThanOrEqual(48);
    expect(proxyRect?.height).toBeGreaterThanOrEqual(48);
    expect(clippedWidth).toBeGreaterThanOrEqual(48);
    expect(clippedHeight).toBeGreaterThanOrEqual(48);
    expect(outlineRect?.x).toBeCloseTo(buffRect.x, 1);
    expect(outlineRect?.y).toBeCloseTo(buffRect.y, 1);
    expect(outlineRect?.width).toBeCloseTo(buffRect.width, 1);
    expect(outlineRect?.height).toBeCloseTo(buffRect.height, 1);
    editor.close();
  });

  it.each([
    ['phone', 'hud-mobile-compact', 40],
    ['tablet', 'hud-mobile-tablet', 46],
  ] as const)('outlines the painted Attack face instead of its transparent %s hitbox', async (profileId, tierClass, paintedSize) => {
    await page.viewport(profileId === 'phone' ? 740 : 1024, profileId === 'phone' ? 360 : 768);
    document.body.className = `mobile-touch game-active ${tierClass}`;
    const ring = document.createElement('div');
    ring.id = 'mobile-action-ring';
    const attack = document.createElement('button');
    attack.id = 'mobile-action-attack';
    ring.append(attack);
    document.body.append(ring);

    const width = profileId === 'phone' ? 740 : 1024;
    const height = profileId === 'phone' ? 360 : 768;
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => profileId,
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: `${width}x${height}`,
        width,
        height,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const proxy = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="action.attack"]',
    );
    const frame = proxy?.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
    const attackRect = attack.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();

    expect(proxy?.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
    expect(frameRect?.width).toBeCloseTo(paintedSize, 1);
    expect(frameRect?.height).toBeCloseTo(paintedSize, 1);
    expect(frameRect?.x).toBeCloseTo(attackRect.x + (attackRect.width - paintedSize) / 2, 1);
    expect(frameRect?.y).toBeCloseTo(attackRect.y + (attackRect.height - paintedSize) / 2, 1);
    editor.close();
  });

  it('includes the painted Player XP ring without outlining the transparent root tail', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ui = document.createElement('div');
    ui.id = 'ui';
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.className = 'unitframe';
    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'portrait-wrap';
    const portrait = document.createElement('div');
    portrait.className = 'portrait';
    const level = document.createElement('div');
    level.className = 'level-chip';
    portraitWrap.append(portrait, level);
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    const name = document.createElement('div');
    name.className = 'uf-name';
    const hp = document.createElement('div');
    hp.className = 'bar hp';
    const resource = document.createElement('div');
    resource.className = 'bar mana';
    bars.append(name, hp, resource);
    player.append(portraitWrap, bars);
    ui.append(player);
    document.body.append(ui);
    const measurement = {
      geometry: {
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      uiScale: 1,
    } as const;
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    const apply = () =>
      applier.apply({
        profileId: 'phone',
        contextId: 'world.base',
        handedness: 'right',
        measurement,
        eligible: true,
      });
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => measurement.geometry,
      getHandedness: () => 'right',
      beginPreview: (document) => {
        state.beginPreview(document);
        apply();
      },
      updatePreview: (document) => {
        state.updatePreview(document);
        apply();
      },
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: () => {
        state.endPreview();
        apply();
      },
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const playerRect = player.getBoundingClientRect();
    const frame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.player"] .mobile-hud-editor-proxy-frame',
    );
    const frameRect = frame?.getBoundingClientRect();

    expect(playerRect).toMatchObject({ width: 300, height: 68 });
    expect(frameRect).toMatchObject({
      x: playerRect.x - 5,
      y: playerRect.y - 5,
      width: 285,
      height: 74,
    });
    editor.close();
  });

  it('outlines painted Party and Pet icons instead of their transparent button hitboxes', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const party = document.createElement('div');
    party.id = 'party-frames';
    const partyChip = document.createElement('button');
    partyChip.id = 'party-chip';
    const partyIcon = document.createElement('span');
    partyIcon.className = 'ui-icon';
    partyChip.append(partyIcon);
    party.append(partyChip);
    const petbar = document.createElement('div');
    petbar.id = 'petbar';
    petbar.style.display = 'flex';
    const petGroup = document.createElement('div');
    petGroup.className = 'petbar-group';
    const petIcons: HTMLElement[] = [];
    for (let index = 0; index < 4; index += 1) {
      const button = document.createElement('button');
      button.className = 'pet-btn';
      const icon = document.createElement('span');
      icon.className = 'icon-label';
      button.append(icon);
      petGroup.append(button);
      petIcons.push(icon);
    }
    petbar.append(petGroup);
    document.body.append(party, petbar);

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const partyFrame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="party"] .mobile-hud-editor-proxy-frame',
    );
    const petFrame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="pet.commands"] .mobile-hud-editor-proxy-frame',
    );
    const partyRect = partyIcon.getBoundingClientRect();
    const petRects = petIcons.map((icon) => icon.getBoundingClientRect());
    const petLeft = Math.min(...petRects.map((rect) => rect.left));
    const petTop = Math.min(...petRects.map((rect) => rect.top));
    const petRight = Math.max(...petRects.map((rect) => rect.right));
    const petBottom = Math.max(...petRects.map((rect) => rect.bottom));

    expect(partyFrame?.getBoundingClientRect()).toMatchObject({
      x: partyRect.x,
      y: partyRect.y,
      width: partyRect.width,
      height: partyRect.height,
    });
    expect(petFrame?.getBoundingClientRect()).toMatchObject({
      x: petLeft,
      y: petTop,
      width: petRight - petLeft,
      height: petBottom - petTop,
    });
    editor.close();
  });

  it('uses live geometry for an equivalent matrix viewport whose diagnostic id differs', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.style.cssText =
      'display:block;position:fixed;left:73px;top:41px;width:220px;height:118px;transform:none';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    bars.style.cssText =
      'position:absolute;left:0;top:5px;width:174px;height:54px;margin:0;padding:0';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    portrait.style.cssText = 'position:absolute;left:156px;top:0;width:64px;height:64px';
    const portraitFace = document.createElement('div');
    portraitFace.className = 'portrait';
    portraitFace.style.cssText = 'display:block;width:64px;height:64px';
    portrait.append(portraitFace);
    target.append(bars, portrait);
    document.body.append(target);
    const failure: MobileHudValidationFailure = {
      reason: 'out-of-bounds',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['frame.target'],
      viewportId: 'phone-740x360',
      safeAreaFixtureId: 'side-none/bottom-0',
    };

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: 'runtime-740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      validateDraft: () => [failure],
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const frame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.target"] .mobile-hud-editor-proxy-frame',
    );
    const expectedLeft = Math.min(
      bars.getBoundingClientRect().left,
      portraitFace.getBoundingClientRect().left,
    );
    const expectedRight = Math.max(
      bars.getBoundingClientRect().right,
      portraitFace.getBoundingClientRect().right,
    );

    expect(frame?.getBoundingClientRect().x).toBeCloseTo(expectedLeft, 1);
    expect(frame?.getBoundingClientRect().width).toBeCloseTo(expectedRight - expectedLeft, 1);
    editor.close();
  });

  it('keeps live geometry one-to-one when reporting a failure from another viewport', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.style.cssText =
      'display:block;position:fixed;left:73px;top:41px;width:220px;height:118px;transform:none';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    bars.style.cssText =
      'position:absolute;left:0;top:5px;width:174px;height:54px;margin:0;padding:0';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    portrait.style.cssText = 'position:absolute;left:156px;top:0;width:64px;height:64px';
    target.append(bars, portrait);
    document.body.append(target);
    const failure: MobileHudValidationFailure = {
      reason: 'out-of-bounds',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['frame.target'],
      viewportId: 'phone-1280x720',
      safeAreaFixtureId: 'side-none/bottom-0',
    };

    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: 'runtime-740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      validateDraft: () => [failure],
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const frame = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="frame.target"] .mobile-hud-editor-proxy-frame',
    );
    expect(frame?.getBoundingClientRect().x).toBeCloseTo(bars.getBoundingClientRect().x, 1);
    expect(frame?.getBoundingClientRect().width).toBeCloseTo(bars.getBoundingClientRect().width, 1);
    editor.close();
  });

  it('does not compound frame settings with custom Player and Target placement scale', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ui = document.createElement('div');
    ui.id = 'ui';
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.className = 'unitframe';
    const playerPortraitWrap = document.createElement('div');
    playerPortraitWrap.className = 'portrait-wrap';
    const playerPortrait = document.createElement('div');
    playerPortrait.className = 'portrait';
    const playerLevel = document.createElement('div');
    playerLevel.className = 'level-chip';
    playerPortraitWrap.append(playerPortrait, playerLevel);
    const playerBars = document.createElement('div');
    playerBars.className = 'uf-bars';
    playerBars.append(document.createElement('div'));
    player.append(playerPortraitWrap, playerBars);
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.className = 'unitframe';
    target.style.display = 'flex';
    const targetPortraitWrap = document.createElement('div');
    targetPortraitWrap.className = 'portrait-wrap';
    const targetPortrait = document.createElement('div');
    targetPortrait.className = 'portrait';
    const targetLevel = document.createElement('div');
    targetLevel.className = 'level-chip';
    targetPortraitWrap.append(targetPortrait, targetLevel);
    const targetBars = document.createElement('div');
    targetBars.className = 'uf-bars';
    targetBars.append(document.createElement('div'));
    target.append(targetBars, targetPortraitWrap);
    ui.append(player, target);
    document.body.append(ui);
    const base = documentFixture();
    const playerPlacement = base.profiles.phone?.['frame.player'];
    const targetPlacement = base.profiles.phone?.['frame.target'];
    if (!playerPlacement || !targetPlacement) throw new Error('missing frame placement');
    const scaledDocument: MobileHudLayoutDocumentV1 = {
      ...base,
      profiles: {
        ...base.profiles,
        phone: {
          ...base.profiles.phone,
          'frame.player': { ...playerPlacement, scale: 1.2 },
          'frame.target': { ...targetPlacement, scale: 1.2 },
        },
      },
    };
    const measurement = {
      geometry: {
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      uiScale: 1,
    } as const;
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    const apply = () =>
      applier.apply({
        profileId: 'phone',
        contextId: 'world.base',
        handedness: 'right',
        measurement,
        eligible: true,
      });
    const makeEditor = () =>
      new MobileHudEditor({
        document,
        registry: MOBILE_HUD_REGISTRY,
        canOpen: () => true,
        getDocument: () => scaledDocument,
        getProfileId: () => 'phone',
        getSceneId: () => 'world',
        getContextId: () => 'world.base',
        getGeometry: () => measurement.geometry,
        getHandedness: () => 'right',
        beginPreview: (document) => {
          state.beginPreview(document);
          apply();
        },
        updatePreview: (document) => {
          state.updatePreview(document);
          apply();
        },
        storage: { load: async () => null, save: async () => undefined },
        commitValidatedDocument: vi.fn(),
        endPreview: () => {
          state.endPreview();
          apply();
        },
        focusManager: new FocusManager(),
        confirmDiscard: () => true,
        translate: (key) => String(key),
        onOpenChange: vi.fn(),
      });

    document.body.style.setProperty('--player-frame-scale', '1');
    document.body.style.setProperty('--target-frame-scale', '1');
    const baselineEditor = makeEditor();
    expect(baselineEditor.open()).toBe(true);
    const baselinePlayer = document
      .querySelector<HTMLElement>(
        '[data-mobile-hud-surface-id="frame.player"] .mobile-hud-editor-proxy-frame',
      )
      ?.getBoundingClientRect();
    const baselineTarget = document
      .querySelector<HTMLElement>(
        '[data-mobile-hud-surface-id="frame.target"] .mobile-hud-editor-proxy-frame',
      )
      ?.getBoundingClientRect();
    baselineEditor.close();

    document.body.style.setProperty('--player-frame-scale', '1.15');
    document.body.style.setProperty('--target-frame-scale', '1.15');
    const scaledEditor = makeEditor();
    expect(scaledEditor.open()).toBe(true);
    const scaledPlayer = document
      .querySelector<HTMLElement>(
        '[data-mobile-hud-surface-id="frame.player"] .mobile-hud-editor-proxy-frame',
      )
      ?.getBoundingClientRect();
    const scaledTarget = document
      .querySelector<HTMLElement>(
        '[data-mobile-hud-surface-id="frame.target"] .mobile-hud-editor-proxy-frame',
      )
      ?.getBoundingClientRect();

    expect(scaledPlayer?.width).toBeCloseTo(baselinePlayer?.width ?? 0, 1);
    expect(scaledPlayer?.height).toBeCloseTo(baselinePlayer?.height ?? 0, 1);
    expect(scaledTarget?.width).toBeCloseTo(baselineTarget?.width ?? 0, 1);
    expect(scaledTarget?.height).toBeCloseTo(baselineTarget?.height ?? 0, 1);
    scaledEditor.close();
    document.body.style.removeProperty('--player-frame-scale');
    document.body.style.removeProperty('--target-frame-scale');
  });

  it('keeps an overlapping informational proxy behind the Target action proxy', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const base = documentFixture();
    const overlapPlacement = {
      anchor: 'top-left' as const,
      offsetX: 100,
      offsetY: 100,
      scale: 1,
    };
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: () => ({
        ...base,
        profiles: {
          ...base.profiles,
          phone: {
            ...base.profiles.phone,
            'action.target': overlapPlacement,
            'auras.player_buffs': overlapPlacement,
          },
        },
      }),
      getProfileId: () => 'phone',
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview: vi.fn(),
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    editor.setLocked(false);
    const target = document.querySelector<HTMLElement>(
      '[data-mobile-hud-surface-id="action.target"]',
    );
    const rect = target?.getBoundingClientRect();
    const hit = rect
      ? document
          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest<HTMLElement>('[data-mobile-hud-surface-id]')
      : null;

    expect(hit?.dataset.mobileHudSurfaceId).toBe('action.target');
    editor.close();
  });

  it('paints mobile aura information above controls while passing taps through it', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active mobile-hud-custom-active';
    const target = document.createElement('button');
    target.id = 'mobile-target-cycle';
    target.style.cssText = 'position:fixed;left:100px;top:100px;width:48px;height:48px';
    const buffs = document.createElement('div');
    buffs.id = 'buff-bar';
    buffs.style.cssText = 'position:fixed;left:100px;top:100px;width:120px;height:48px';
    document.body.append(target, buffs);
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: {
        geometry: {
          id: '740x360',
          width: 740,
          height: 360,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        uiScale: 1,
      },
      eligible: true,
    });

    const buffStyle = getComputedStyle(buffs);
    const hit = document.elementFromPoint(124, 124);

    expect(buffStyle.pointerEvents).toBe('none');
    expect(buffStyle.zIndex).toBe('100');
    expect(hit).toBe(target);
  });

  it('removes legacy transforms and clamps before applying custom HUD geometry', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.className = 'unitframe';
    target.style.display = 'flex';
    const targetBars = document.createElement('div');
    targetBars.className = 'uf-bars';
    const targetPortrait = document.createElement('div');
    targetPortrait.className = 'portrait-wrap';
    target.append(targetBars, targetPortrait);
    const buffs = document.createElement('div');
    buffs.id = 'buff-bar';
    const buff = document.createElement('div');
    buff.className = 'buff';
    buff.style.cssText = 'width:28px;height:28px;flex:none';
    buffs.append(buff);
    const debuffs = document.createElement('div');
    debuffs.id = 'debuff-bar';
    const moveZone = document.createElement('div');
    moveZone.id = 'mobile-move-zone';
    const moveJoystick = document.createElement('div');
    moveJoystick.id = 'mobile-move-joystick';
    moveJoystick.className = 'mobile-joystick';
    const cameraJoystick = document.createElement('div');
    cameraJoystick.id = 'mobile-camera-joystick';
    cameraJoystick.className = 'mobile-joystick';
    document.body.append(target, buffs, debuffs, moveZone, moveJoystick, cameraJoystick);

    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: {
        geometry: {
          id: '740x360',
          width: 740,
          height: 360,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        uiScale: 1,
      },
      eligible: true,
    });

    expect(getComputedStyle(target).transform).toBe('none');
    expect(target.getBoundingClientRect()).toMatchObject({ width: 236, height: 68 });
    expect(getComputedStyle(buffs).transform).toBe('none');
    expect(getComputedStyle(buffs).maxWidth).toBe('none');
    expect(getComputedStyle(moveZone).maxWidth).toBe('none');
    expect(moveZone.getBoundingClientRect().width).toBe(134);
    expect(getComputedStyle(moveJoystick).transform).toBe('none');
    expect(getComputedStyle(cameraJoystick).transform).toBe('none');
  });

  it('moves visible cast and swing bars with the Player frame', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ui = document.createElement('div');
    ui.id = 'ui';
    const player = document.createElement('div');
    player.id = 'player-frame';
    player.className = 'unitframe';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    player.append(portrait, bars);
    const castbar = document.createElement('div');
    castbar.id = 'castbar';
    castbar.style.display = 'block';
    const swingbar = document.createElement('div');
    swingbar.id = 'swingbar';
    swingbar.style.display = 'block';
    ui.append(player, castbar, swingbar);
    document.body.append(ui);
    const measurement = {
      geometry: {
        id: '740x360',
        width: 740,
        height: 360,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      uiScale: 1,
    } as const;
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const applier = new MobileHudCustomLayoutDomApplier(document, MOBILE_HUD_REGISTRY, state);
    const apply = () =>
      applier.apply({
        profileId: 'phone',
        contextId: 'world.base',
        handedness: 'right',
        measurement,
        eligible: true,
      });
    apply();
    const before = [player, castbar, swingbar].map((element) => element.getBoundingClientRect());
    const entry = state.activeDocument();
    const basePlacement = entry.profiles.phone?.['frame.player'];
    if (!basePlacement) throw new Error('missing Player frame placement');
    state.beginPreview(entry);
    state.updatePreview({
      ...entry,
      profiles: {
        ...entry.profiles,
        phone: {
          ...entry.profiles.phone,
          'frame.player': {
            ...basePlacement,
            offsetX: basePlacement.offsetX + 50,
            offsetY: basePlacement.offsetY - 20,
          },
        },
      },
    });
    apply();
    const after = [player, castbar, swingbar].map((element) => element.getBoundingClientRect());

    for (let index = 0; index < after.length; index += 1) {
      expect(after[index].x - before[index].x).toBeCloseTo(50, 1);
      expect(after[index].y - before[index].y).toBeCloseTo(-20, 1);
    }
  });

  it('lets an open Consumables drawer paint and receive input above ordinary HUD frames', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact mobile-consumables-open';
    const controls = document.createElement('section');
    controls.id = 'mobile-controls';
    const consumables = document.createElement('div');
    consumables.id = 'mobile-consumables';
    const row = document.createElement('div');
    row.id = 'mobile-consumables-row';
    const potion = document.createElement('button');
    potion.className = 'mobile-consumable-slot';
    row.append(potion);
    consumables.append(row);
    controls.append(consumables);
    const ui = document.createElement('div');
    ui.id = 'ui';
    const player = document.createElement('div');
    player.id = 'player-frame';
    ui.append(player);
    document.body.append(controls, ui);

    expect(Number(getComputedStyle(controls).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(ui).zIndex),
    );
    expect(getComputedStyle(potion).pointerEvents).toBe('auto');
  });

  it.each([
    [740, 360, 'phone'],
    [1024, 768, 'tablet'],
  ] as const)('renders, unlocks, selects, and previews at %sx%s', async (width, height, profileId) => {
    await page.viewport(width, height);
    document.body.className = `mobile-touch game-active ${profileId === 'phone' ? 'hud-mobile-compact' : 'hud-mobile-tablet'}`;
    const updatePreview = vi.fn();
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: documentFixture,
      getProfileId: () => profileId,
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: `${width}x${height}`,
        width,
        height,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getHandedness: () => 'right',
      beginPreview: vi.fn(),
      updatePreview,
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: vi.fn(),
      endPreview: vi.fn(),
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: vi.fn(),
    });

    expect(editor.open()).toBe(true);
    const root = document.querySelector<HTMLElement>('.mobile-hud-editor');
    const preview = document.querySelector<HTMLElement>('.mobile-hud-editor-preview');
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(preview?.getBoundingClientRect().width).toBeGreaterThan(0);
    editor.setLocked(false);
    document
      .querySelector<HTMLButtonElement>('[data-mobile-hud-surface-id="action.attack"]')
      ?.click();
    document
      .querySelector<HTMLButtonElement>('[data-mobile-hud-control="scale-increase"]')
      ?.click();
    expect(updatePreview).toHaveBeenCalledTimes(1);
    expect(
      document
        .querySelector('[data-mobile-hud-surface-id="action.attack"]')
        ?.classList.contains('is-selected'),
    ).toBe(true);
    editor.cancel();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { setInterfaceMode } from '../src/game/mobile_controls';
import {
  applyMobileHudLayout,
  MobileHudCustomLayoutDomApplier,
  MobileHudCustomLayoutState,
  MobileHudFallbackWarningState,
  readMobileHudViewportGeometry,
  syncMobileMenuPlacement,
} from '../src/game/mobile_hud_layout_applier';
import type { MobileHudLayoutDocumentV1 } from '../src/ui/mobile_hud_editor_types';
import { buildMobileHudRegistry, MOBILE_HUD_REGISTRY } from '../src/ui/mobile_hud_registry';

// Hand-rolled fake DOM (the tests/CLAUDE.md idiom: no jsdom). Models only the
// contract applyMobileHudLayout touches: classList add/remove/contains and
// style.setProperty on document.body, plus innerWidth/innerHeight + matchMedia
// on window.
class FakeClassList {
  private values = new Set<string>();
  add(...names: string[]): void {
    for (const name of names) this.values.add(name);
  }
  remove(...names: string[]): void {
    for (const name of names) this.values.delete(name);
  }
  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeBody {
  classList = new FakeClassList();
  styleProps = new Map<string, string>();
  style = {
    setProperty: (name: string, value: string) => {
      this.styleProps.set(name, value);
    },
  };
  stableWidth = 0;
  stableHeight = 0;
  getBoundingClientRect(): DOMRect {
    return {
      width: this.stableWidth,
      height: this.stableHeight,
    } as DOMRect;
  }
}

class FakeElement {
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  focused = false;
  readonly styleProps = new Map<string, string>();
  readonly styleSetCalls: Array<readonly [string, string]> = [];
  readonly styleRemoveCalls: string[] = [];
  readonly style = {
    transform: 'legacy-transform',
    left: '17px',
    top: '22px',
    setProperty: (name: string, value: string) => {
      this.styleSetCalls.push([name, value]);
      this.styleProps.set(name, value);
    },
    removeProperty: (name: string) => {
      this.styleRemoveCalls.push(name);
      this.styleProps.delete(name);
    },
  };

  constructor(readonly id: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  insertBefore(node: FakeElement, before: FakeElement | null): FakeElement {
    if (node.parentElement) {
      const oldIndex = node.parentElement.children.indexOf(node);
      if (oldIndex >= 0) node.parentElement.children.splice(oldIndex, 1);
    }
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index >= 0 ? index : this.children.length, 0, node);
    node.parentElement = this;
    return node;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.insertBefore(node, null);
  }

  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  focus(): void {
    this.focused = true;
  }
}

function menuDocument() {
  const combat = new FakeElement('mobile-combat-controls');
  const extra = new FakeElement('mobile-extra-grid');
  const chat = new FakeElement('mobile-chat');
  const bags = new FakeElement('mobile-bags');
  const social = new FakeElement('mobile-social');
  const quest = new FakeElement('mobile-quest');
  const menu = new FakeElement('mobile-menu');
  const more = new FakeElement('mobile-more');
  combat.append(chat, bags, social, quest, menu, more);
  const elements = new Map(
    [combat, extra, chat, social, quest, menu, more, bags].map((el) => [el.id, el]),
  );
  const document = {
    activeElement: null,
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;
  return { document, combat, extra, social, menu, more };
}

function fakeWin(width: number, height: number, body: FakeBody) {
  return {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: false }),
    document: { body: body as unknown as HTMLElement, getElementById: () => null },
  } as unknown as Window;
}

const previousGlobalDocument = globalThis.document;

afterEach(() => {
  setInterfaceMode('auto');
  Object.defineProperty(globalThis, 'document', {
    value: previousGlobalDocument,
    configurable: true,
  });
});

describe('applyMobileHudLayout', () => {
  it('applies no tier class on desktop (touch mode off)', () => {
    setInterfaceMode('desktop');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-mobile-standard')).toBe(false);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
    expect(body.classList.contains('hud-mobile-tablet')).toBe(false);
  });

  it('applies the resolved tier class in touch mode', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1920, 1080, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(true);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
    expect(body.classList.contains('hud-mobile-standard')).toBe(false);
  });

  it('drops the old tier class when the tier changes across two calls', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1920, 1080, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(true);

    applyMobileHudLayout(fakeWin(844, 390, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(false);
    expect(body.classList.contains('hud-mobile-compact')).toBe(true);
  });

  it('keeps the active game tier on the stable root size while browser chrome resizes', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    body.classList.add('game-active', 'mobile-touch');
    body.stableWidth = 1280;
    body.stableHeight = 500;

    applyMobileHudLayout(fakeWin(1280, 460, body));

    expect(body.classList.contains('hud-mobile-standard')).toBe(true);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
  });

  it('mirrors mobile-window-open / mobile-chat-open into hud-menu-open / hud-chat-open', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    body.classList.add('mobile-window-open');
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-menu-open')).toBe(true);
    expect(body.classList.contains('hud-chat-open')).toBe(false);

    body.classList.remove('mobile-window-open');
    body.classList.add('mobile-chat-open');
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-menu-open')).toBe(false);
    expect(body.classList.contains('hud-chat-open')).toBe(true);
  });

  it('sets the safe-area css vars on body.style', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.styleProps.get('--mobile-hud-safe-top')).toBe('0px');
    expect(body.styleProps.get('--mobile-hud-safe-left')).toBe('0px');
  });

  it('applies a tier class inside the native app shell even when useTouchInterface is false', () => {
    // Desktop interface mode (or a desktop-shaped auto-detect) makes
    // useTouchInterface() false, but the packaged native app shell (see
    // isNativeAppShell in mobile_controls.ts) forces touch UI on top of that:
    // main.ts adds body.classList 'native-app' for the Capacitor build. The
    // applier must OR in isNativeAppShell(), same as MobileControls.start()/
    // refreshInterfaceMode() do, or the native shell gets the empty layout.
    setInterfaceMode('desktop');
    const body = new FakeBody();
    body.classList.add('native-app');
    // isNativeAppShell() reads the GLOBAL document (it runs unparameterized,
    // same as production main.ts/mobile_controls.ts call sites), so stub it
    // separately from the injected fakeWin used for viewport/body writes.
    Object.defineProperty(globalThis, 'document', {
      value: { body },
      configurable: true,
    });
    applyMobileHudLayout(fakeWin(390, 844, body));
    expect(body.classList.contains('hud-mobile-compact')).toBe(true);
  });
});

describe('readMobileHudViewportGeometry', () => {
  const measurementWindow = {
    innerWidth: 900,
    innerHeight: 420,
    visualViewport: { width: 844, height: 390, offsetLeft: 23, offsetTop: 11 },
    document: {},
  } as unknown as Window;

  it.each([0.85, 1, 1.4])('keeps visual geometry independent from UI Scale %s', (uiScale) => {
    const result = readMobileHudViewportGeometry(measurementWindow, {
      readSafeAreaInsets: () => ({ top: 3, right: 47, bottom: 24, left: 51 }),
      readUiScale: () => uiScale,
    });
    expect(result).toEqual({
      geometry: {
        id: 'runtime-844x390',
        width: 844,
        height: 390,
        visualOffsetX: 23,
        visualOffsetY: 11,
        safeAreaInsets: { top: 3, right: 47, bottom: 24, left: 51 },
      },
      uiScale,
    });
  });

  it('falls back to the layout viewport when visualViewport is unavailable', () => {
    const result = readMobileHudViewportGeometry(fakeWin(740, 360, new FakeBody()), {
      readSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      readUiScale: () => 1,
    });
    expect(result.geometry).toMatchObject({
      width: 740,
      height: 360,
      visualOffsetX: 0,
      visualOffsetY: 0,
    });
  });

  it('performs one safe-area and one UI Scale measurement per event call', () => {
    let safeReads = 0;
    let scaleReads = 0;
    const deps = {
      readSafeAreaInsets: () => {
        safeReads += 1;
        return { top: 0, right: 0, bottom: 0, left: 0 };
      },
      readUiScale: () => {
        scaleReads += 1;
        return 1;
      },
    };
    readMobileHudViewportGeometry(measurementWindow, deps);
    expect({ safeReads, scaleReads }).toEqual({ safeReads: 1, scaleReads: 1 });
    readMobileHudViewportGeometry(measurementWindow, deps);
    expect({ safeReads, scaleReads }).toEqual({ safeReads: 2, scaleReads: 2 });
  });
});

describe('MobileHudCustomLayoutState', () => {
  const document = (enabled: boolean, offsetX: number): MobileHudLayoutDocumentV1 => ({
    schemaVersion: 1,
    enabled,
    profiles: {
      phone: {
        ...MOBILE_HUD_REGISTRY.defaults.phone,
        'action.a1': { anchor: 'top-left', offsetX, offsetY: 20, scale: 1 },
      },
      tablet: MOBILE_HUD_REGISTRY.defaults.tablet,
    },
  });

  it('uses defaults for absent or disabled state and validated data only when enabled', () => {
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    expect(state.activeDocument().profiles).toEqual(MOBILE_HUD_REGISTRY.defaults);
    state.setValidatedDocument(document(false, 77));
    expect(state.activeDocument().profiles).toEqual(MOBILE_HUD_REGISTRY.defaults);
    state.setValidatedDocument(document(true, 77));
    expect(state.activeDocument().profiles.phone?.['action.a1']?.offsetX).toBe(77);
  });

  it('gives ephemeral preview priority without changing its enabled flag', () => {
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const entry = document(true, 30);
    const preview = document(false, 140);
    state.setValidatedDocument(entry);
    state.beginPreview(entry);
    state.updatePreview(preview);
    expect(state.activeDocument()).toBe(preview);
    expect(state.activeDocument().enabled).toBe(false);
    expect(entry.enabled).toBe(true);
  });

  it('ends preview by restoring the exact entry runtime document', () => {
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const entry = document(true, 30);
    state.setValidatedDocument(entry);
    state.beginPreview(entry);
    state.updatePreview(document(true, 200));
    state.endPreview();
    expect(state.activeDocument()).toBe(entry);
    expect(state.previewActive).toBe(false);
  });

  it('clears validated and preview properties back to defaults', () => {
    const state = new MobileHudCustomLayoutState(MOBILE_HUD_REGISTRY);
    const entry = document(true, 30);
    state.setValidatedDocument(entry);
    state.beginPreview(entry);
    state.updatePreview(document(true, 200));
    state.clear();
    expect(state.previewActive).toBe(false);
    expect(state.activeDocument().profiles).toEqual(MOBILE_HUD_REGISTRY.defaults);
  });
});

describe('MobileHudCustomLayoutDomApplier', () => {
  const requireDescriptor = (
    id: 'action.a1' | 'control.movement' | 'frame.target' | 'pet.commands' | 'utility.consumables',
  ) => {
    const descriptor = MOBILE_HUD_REGISTRY.getDescriptor(id);
    if (!descriptor?.binding) throw new Error(`missing DOM applier test binding: ${id}`);
    return { descriptor, rootSelector: descriptor.binding.rootSelector };
  };
  const actionFixture = requireDescriptor('action.a1');
  const targetFixture = requireDescriptor('frame.target');
  const contextRegistry = buildMobileHudRegistry({
    descriptors: [actionFixture.descriptor, targetFixture.descriptor],
    defaults: {
      phone: {
        'action.a1': { anchor: 'top-left', offsetX: 20, offsetY: 20, scale: 1 },
        'frame.target': { anchor: 'top-left', offsetX: 200, offsetY: 100, scale: 1 },
      },
      tablet: {
        'action.a1': { anchor: 'top-left', offsetX: 20, offsetY: 20, scale: 1 },
        'frame.target': { anchor: 'top-left', offsetX: 200, offsetY: 100, scale: 1 },
      },
    },
  });
  const makeDomApplier = () => {
    const action = new FakeElement('action');
    const target = new FakeElement('target');
    const selectors = new Map([
      [actionFixture.rootSelector, action],
      [targetFixture.rootSelector, target],
    ]);
    const body = new FakeBody();
    const doc = {
      body,
      querySelector: (selector: string) => selectors.get(selector) ?? null,
    };
    const state = new MobileHudCustomLayoutState(contextRegistry);
    const applier = new MobileHudCustomLayoutDomApplier(
      doc as unknown as Document,
      contextRegistry,
      state,
    );
    return { action, target, body, state, applier };
  };
  const measurement = (uiScale: number) => ({
    geometry: {
      id: 'runtime-500x300',
      width: 500,
      height: 300,
      visualOffsetX: 10,
      visualOffsetY: 5,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    uiScale,
  });

  it('annotates informational roots for click-through foreground CSS and clears the marker', () => {
    const descriptor = MOBILE_HUD_REGISTRY.getDescriptor('auras.player_buffs');
    if (!descriptor?.binding) throw new Error('missing player buffs DOM binding');
    const buffs = new FakeElement('buffs');
    const registry = buildMobileHudRegistry({
      descriptors: [descriptor],
      defaults: {
        phone: {
          'auras.player_buffs': { anchor: 'top-left', offsetX: 20, offsetY: 20, scale: 1 },
        },
        tablet: {
          'auras.player_buffs': { anchor: 'top-left', offsetX: 20, offsetY: 20, scale: 1 },
        },
      },
    });
    const body = new FakeBody();
    const state = new MobileHudCustomLayoutState(registry);
    const applier = new MobileHudCustomLayoutDomApplier(
      {
        body,
        querySelector: (selector: string) =>
          selector === descriptor.binding?.rootSelector ? buffs : null,
      } as unknown as Document,
      registry,
      state,
    );

    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: measurement(1),
      eligible: true,
    });
    expect(buffs.getAttribute('data-mobile-hud-overlap-policy')).toBe('informational-overlay');

    applier.clear();
    expect(buffs.getAttribute('data-mobile-hud-overlap-policy')).toBeNull();
  });

  it.each([0.85, 1, 1.4])('converts only ui-author properties at UI Scale %s', (uiScale) => {
    const { action, target, applier } = makeDomApplier();
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: measurement(uiScale),
      eligible: true,
    });
    expect(action.styleProps.get('--mobile-hud-action-a1-x')).toBe('30px');
    expect(target.styleProps.get('--mobile-hud-frame-target-x')).toBe(`${200 / uiScale}px`);
    expect(target.styleProps.get('--mobile-hud-frame-target-width')).toBe(`${236 / uiScale}px`);
    expect(target.styleProps.get('--mobile-hud-frame-target-height')).toBe(`${68 / uiScale}px`);
    expect(action.style.transform).toBe('legacy-transform');
    expect(action.style.left).toBe('17px');
    expect(action.style.top).toBe('22px');
  });

  it('mirrors visually without changing canonical right-handed data', () => {
    const { action, state, applier } = makeDomApplier();
    const stored = state.activeDocument().profiles.phone?.['action.a1'];
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'left',
      measurement: measurement(1),
      eligible: true,
    });
    expect(action.styleProps.get('--mobile-hud-action-a1-x')).toBe('442px');
    expect(state.activeDocument().profiles.phone?.['action.a1']).toBe(stored);
  });

  it('temporarily falls back on an unusual invalid viewport without mutating stored data', () => {
    const { action, state, applier } = makeDomApplier();
    const invalid = {
      schemaVersion: 1 as const,
      enabled: true,
      profiles: {
        phone: {
          ...contextRegistry.defaults.phone,
          'action.a1': { anchor: 'top-left' as const, offsetX: 9999, offsetY: 20, scale: 1 },
        },
      },
    };
    state.setValidatedDocument(invalid);
    const result = applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: measurement(1),
      eligible: true,
    });
    expect(result.fallback).toBe(true);
    expect(action.styleProps.get('--mobile-hud-action-a1-x')).toBe('30px');
    expect(invalid.profiles.phone['action.a1'].offsetX).toBe(9999);
  });

  it('keeps an invalid ephemeral editor preview live instead of falling back to defaults', () => {
    const { action, state, applier } = makeDomApplier();
    const entry = state.activeDocument();
    const invalidPreview = {
      schemaVersion: 1 as const,
      enabled: false,
      profiles: {
        phone: {
          ...contextRegistry.defaults.phone,
          'action.a1': { anchor: 'top-left' as const, offsetX: 9999, offsetY: 20, scale: 1 },
        },
      },
    };
    state.beginPreview(entry);
    state.updatePreview(invalidPreview);

    const result = applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: measurement(1),
      eligible: true,
    });

    expect(result.fallback).toBe(false);
    expect(result.failures.some((failure) => failure.reason === 'out-of-bounds')).toBe(true);
    expect(action.styleProps.get('--mobile-hud-action-a1-x')).toBe('10009px');
  });

  it('writes only changed CSS properties across consecutive preview drag frames', () => {
    const { action, target, state, applier } = makeDomApplier();
    const entry = state.activeDocument();
    state.beginPreview(entry);
    const options = {
      profileId: 'phone' as const,
      contextId: 'world.base' as const,
      handedness: 'right' as const,
      measurement: measurement(1),
      eligible: true,
    };
    applier.apply(options);
    action.styleSetCalls.length = 0;
    action.styleRemoveCalls.length = 0;
    target.styleSetCalls.length = 0;
    target.styleRemoveCalls.length = 0;

    state.updatePreview({
      ...entry,
      profiles: {
        ...entry.profiles,
        phone: {
          ...entry.profiles.phone,
          'action.a1': { anchor: 'top-left', offsetX: 24, offsetY: 20, scale: 1 },
        },
      },
    });
    applier.apply(options);

    expect(action.styleSetCalls).toEqual([['--mobile-hud-action-a1-x', '34px']]);
    expect(action.styleRemoveCalls).toEqual([]);
    expect(target.styleSetCalls).toEqual([]);
    expect(target.styleRemoveCalls).toEqual([]);
  });

  it('clears stale properties idempotently when custom layout is ineligible', () => {
    const { action, body, applier } = makeDomApplier();
    const options = {
      profileId: 'phone' as const,
      contextId: 'world.base' as const,
      handedness: 'right' as const,
      measurement: measurement(1),
      eligible: true,
    };
    applier.apply(options);
    expect(action.styleProps.size).toBeGreaterThan(0);
    expect(body.classList.contains('mobile-hud-custom-active')).toBe(true);
    applier.apply({ ...options, eligible: false });
    applier.apply({ ...options, eligible: false });
    expect(action.styleProps.size).toBe(0);
    expect(body.classList.contains('mobile-hud-custom-active')).toBe(false);
  });

  it('applies and clears custom properties on registered dependent roots', () => {
    const movementFixture = requireDescriptor('control.movement');
    const zone = new FakeElement('move-zone');
    const joystick = new FakeElement('move-joystick');
    const placement = {
      anchor: 'bottom-left' as const,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
    const registry = buildMobileHudRegistry({
      descriptors: [movementFixture.descriptor],
      defaults: {
        phone: { 'control.movement': placement },
        tablet: { 'control.movement': placement },
      },
    });
    const state = new MobileHudCustomLayoutState(registry);
    const applier = new MobileHudCustomLayoutDomApplier(
      {
        body: new FakeBody(),
        querySelector: (selector: string) => {
          if (selector === movementFixture.rootSelector) return zone;
          if (selector === '#mobile-move-joystick') return joystick;
          return null;
        },
      } as unknown as Document,
      registry,
      state,
    );
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: {
        geometry: {
          id: 'dependent-900x500',
          width: 900,
          height: 500,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        uiScale: 1,
      },
      eligible: true,
    });
    expect(zone.styleProps.get('--mobile-hud-control-movement-x')).toBe('0px');
    expect(joystick.styleProps.get('--mobile-hud-control-movement-x')).toBe('0px');
    applier.clear();
    expect(zone.styleProps.size).toBe(0);
    expect(joystick.styleProps.size).toBe(0);
  });

  it.each([
    ['horizontal', false, 'row'],
    ['horizontal', true, 'row-reverse'],
    ['vertical', false, 'column'],
    ['vertical', true, 'column-reverse'],
  ] as const)('writes the CSS-ready %s reverse=%s composite flow', (orientation, reverse, expectedFlow) => {
    const petFixture = requireDescriptor('pet.commands');
    const pet = new FakeElement('pet');
    const placement = {
      anchor: 'top-left' as const,
      offsetX: 20,
      offsetY: 20,
      scale: 1,
      orientation,
      reverse,
    };
    const registry = buildMobileHudRegistry({
      descriptors: [petFixture.descriptor],
      defaults: { phone: { 'pet.commands': placement }, tablet: { 'pet.commands': placement } },
    });
    const state = new MobileHudCustomLayoutState(registry);
    state.setValidatedDocument({
      schemaVersion: 1,
      enabled: true,
      profiles: { phone: { 'pet.commands': placement }, tablet: { 'pet.commands': placement } },
    });
    const applier = new MobileHudCustomLayoutDomApplier(
      {
        body: new FakeBody(),
        querySelector: (selector: string) => (selector === petFixture.rootSelector ? pet : null),
      } as unknown as Document,
      registry,
      state,
    );
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: {
        geometry: {
          id: 'dynamic-900x500',
          width: 900,
          height: 500,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        uiScale: 1,
      },
      eligible: true,
    });
    expect(pet.styleProps.get('--mobile-hud-pet-commands-flow')).toBe(expectedFlow);
  });

  it.each([
    [
      'right',
      {
        'toggle-left': '0',
        'toggle-right': 'auto',
        'toggle-top': 'auto',
        'toggle-bottom': '0',
        'row-left': '54px',
        'row-right': 'auto',
        'row-top': 'auto',
        'row-bottom': '0',
        'grid-columns': 'repeat(3, 48px)',
        'grid-rows': 'repeat(2, 48px)',
        'item-direction': 'ltr',
      },
    ],
    [
      'left',
      {
        'toggle-left': 'auto',
        'toggle-right': '0',
        'toggle-top': 'auto',
        'toggle-bottom': '0',
        'row-left': 'auto',
        'row-right': '54px',
        'row-top': 'auto',
        'row-bottom': '0',
        'grid-columns': 'repeat(3, 48px)',
        'grid-rows': 'repeat(2, 48px)',
        'item-direction': 'rtl',
      },
    ],
    [
      'up',
      {
        'toggle-left': '0',
        'toggle-right': 'auto',
        'toggle-top': 'auto',
        'toggle-bottom': '0',
        'row-left': '0',
        'row-right': 'auto',
        'row-top': 'auto',
        'row-bottom': '54px',
        'grid-columns': 'repeat(2, 48px)',
        'grid-rows': 'repeat(3, 48px)',
        'item-direction': 'ltr',
      },
    ],
    [
      'down',
      {
        'toggle-left': '0',
        'toggle-right': 'auto',
        'toggle-top': '0',
        'toggle-bottom': 'auto',
        'row-left': '0',
        'row-right': 'auto',
        'row-top': '54px',
        'row-bottom': 'auto',
        'grid-columns': 'repeat(2, 48px)',
        'grid-rows': 'repeat(3, 48px)',
        'item-direction': 'ltr',
      },
    ],
  ] as const)('writes the complete Consumables %s opening contract', (openingDirection, expected) => {
    const consumablesFixture = requireDescriptor('utility.consumables');
    const consumables = new FakeElement('consumables');
    const placement = {
      anchor: 'top-left' as const,
      offsetX: 300,
      offsetY: 100,
      scale: 1,
      openingDirection,
    };
    const registry = buildMobileHudRegistry({
      descriptors: [consumablesFixture.descriptor],
      defaults: {
        phone: { 'utility.consumables': placement },
        tablet: { 'utility.consumables': placement },
      },
    });
    const state = new MobileHudCustomLayoutState(registry);
    state.setValidatedDocument({
      schemaVersion: 1,
      enabled: true,
      profiles: {
        phone: { 'utility.consumables': placement },
        tablet: { 'utility.consumables': placement },
      },
    });
    const applier = new MobileHudCustomLayoutDomApplier(
      {
        body: new FakeBody(),
        querySelector: (selector: string) =>
          selector === consumablesFixture.rootSelector ? consumables : null,
      } as unknown as Document,
      registry,
      state,
    );
    applier.apply({
      profileId: 'phone',
      contextId: 'world.base',
      handedness: 'right',
      measurement: {
        geometry: {
          id: 'dynamic-900x500',
          width: 900,
          height: 500,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        uiScale: 1,
      },
      eligible: true,
    });
    for (const [suffix, value] of Object.entries(expected)) {
      expect(consumables.styleProps.get(`--mobile-hud-utility-consumables-${suffix}`)).toBe(value);
    }
  });
});

describe('MobileHudFallbackWarningState', () => {
  it('warns once per failing signature and rearms after recovery', () => {
    const state = new MobileHudFallbackWarningState();
    const first = {
      fallback: true,
      failures: [
        {
          reason: 'out-of-bounds' as const,
          profileId: 'phone' as const,
          contextId: 'world.base' as const,
          surfaceIds: ['action.a1' as const],
          viewportId: 'phone-740x360',
        },
      ],
    };
    const second = {
      fallback: true,
      failures: [
        {
          ...first.failures[0],
          viewportId: 'phone-844x390',
        },
      ],
    };

    expect(state.shouldWarn(first)).toBe(true);
    expect(state.shouldWarn(first)).toBe(false);
    expect(state.shouldWarn(second)).toBe(true);
    expect(state.shouldWarn({ fallback: false, failures: [] })).toBe(false);
    expect(state.shouldWarn(first)).toBe(true);
  });
});

describe('syncMobileMenuPlacement', () => {
  it('moves the same Social and Settings nodes to the start of More in compact mode', () => {
    const { document, combat, extra, social, menu } = menuDocument();

    syncMobileMenuPlacement(document, 'compact');

    expect(combat.children.map((el) => el.id)).toEqual([
      'mobile-chat',
      'mobile-bags',
      'mobile-quest',
      'mobile-more',
    ]);
    expect(extra.children.map((el) => el.id)).toEqual(['mobile-social', 'mobile-menu']);
    expect(extra.children[0]).toBe(social);
    expect(extra.children[1]).toBe(menu);
  });

  it('restores the full direct order and stays idempotent across repeated transitions', () => {
    const { document, combat, extra } = menuDocument();

    syncMobileMenuPlacement(document, 'compact');
    syncMobileMenuPlacement(document, 'compact');
    syncMobileMenuPlacement(document, 'full');
    syncMobileMenuPlacement(document, 'full');

    expect(combat.children.map((el) => el.id)).toEqual([
      'mobile-chat',
      'mobile-bags',
      'mobile-social',
      'mobile-quest',
      'mobile-menu',
      'mobile-more',
    ]);
    expect(extra.children.map((el) => el.id)).toEqual([]);
  });

  it('moves focus to More before compact placement hides a focused direct action', () => {
    const { document, social, more } = menuDocument();
    (document as unknown as { activeElement: FakeElement }).activeElement = social;

    syncMobileMenuPlacement(document, 'compact');

    expect(more.focused).toBe(true);
  });

  it('does nothing when a cached or partial shell omits one of the required nodes', () => {
    const document = { getElementById: () => null } as unknown as Document;
    expect(() => syncMobileMenuPlacement(document, 'compact')).not.toThrow();
  });
});

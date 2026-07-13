import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MobileHudEditor } from '../src/ui/mobile_hud_editor';
import {
  mirrorMobileHudPlacement,
  resolveMobileHudSurfaceGeometry,
} from '../src/ui/mobile_hud_editor_core';
import type {
  MobileHudLayoutDocumentV1,
  MobileHudLayoutStorage,
  MobileHudValidationFailure,
  MobileHudViewportGeometry,
} from '../src/ui/mobile_hud_editor_types';
import { MOBILE_HUD_REGISTRY } from '../src/ui/mobile_hud_registry';

const mobileHudCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

class FakeClassList {
  readonly values = new Set<string>();
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

class FakeElement {
  readonly classList = new FakeClassList();
  readonly style = { left: '', top: '', width: '', height: '', translate: '' };
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  parentElement: FakeElement | null = null;
  textContent = '';
  value = '';
  tabIndex = 0;
  disabled = false;
  inert = false;
  readonly #listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly #capturedPointers = new Set<number>();
  rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    readonly tagName: string,
    private readonly owner: FakeDocument,
  ) {}

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...children);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  click(): void {
    this.dispatch('click');
  }

  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event = new FakeEvent(init);
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
    return event;
  }

  setPointerCapture(pointerId: number): void {
    this.#capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.#capturedPointers.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.#capturedPointers.has(pointerId);
  }

  getBoundingClientRect(): typeof this.rect {
    if (
      this.classList.contains('mobile-hud-editor-preview') &&
      this.rect.width === 0 &&
      this.rect.height === 0
    ) {
      return { x: 0, y: 0, width: 740, height: 360 };
    }
    return this.rect;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  querySelector<T extends FakeElement>(selector: string): T | null {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return (
      (this.descendants().find((element) => element.classList.contains(className)) as T) ?? null
    );
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  findByAttribute(name: string, value: string): FakeElement | undefined {
    return this.descendants().find((element) => element.getAttribute(name) === value);
  }

  focus(): void {
    this.owner.activeElement = this;
  }
}

class FakeEvent {
  pointerId = 1;
  clientX = 0;
  clientY = 0;
  defaultPrevented = false;
  propagationStopped = false;
  key = '';

  constructor(init: Partial<FakeEvent>) {
    Object.assign(this, init);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeDocument {
  readonly body = new FakeElement('BODY', this);
  readonly selectorMatches = new Map<string, FakeElement[]>();
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase(), this);
  }

  querySelectorAll<T extends FakeElement>(selector: string): T[] {
    return (this.selectorMatches.get(selector) ?? []) as T[];
  }
}

const entryDocument = (): MobileHudLayoutDocumentV1 => ({
  schemaVersion: 1,
  enabled: false,
  profiles: {
    phone: MOBILE_HUD_REGISTRY.defaults.phone,
    tablet: MOBILE_HUD_REGISTRY.defaults.tablet,
  },
});

const geometry: MobileHudViewportGeometry = {
  id: 'editor-phone',
  width: 740,
  height: 360,
  visualOffsetX: 0,
  visualOffsetY: 0,
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
};

function actionA1DisplayedRect(layout: MobileHudLayoutDocumentV1, handedness: 'left' | 'right') {
  const descriptor = MOBILE_HUD_REGISTRY.getDescriptor('action.a1');
  const canonical = layout.profiles.phone?.['action.a1'];
  if (!descriptor || !canonical) throw new Error('action.a1 test fixture is incomplete');
  const placement =
    handedness === 'left'
      ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
      : canonical;
  return resolveMobileHudSurfaceGeometry(descriptor, 'phone', placement, geometry, 'world.base')
    .canonicalRect;
}

function setup(
  eligible = true,
  handedness: 'left' | 'right' = 'right',
  validateDraft: (
    document: MobileHudLayoutDocumentV1,
  ) => readonly MobileHudValidationFailure[] = () => [],
  saveShouldReject = false,
  sourceDocument: MobileHudLayoutDocumentV1 = entryDocument(),
  confirmDiscard = true,
  isSurfaceAvailable: (surfaceId: string) => boolean = () => true,
  validateCurrentDraft?: (
    document: MobileHudLayoutDocumentV1,
  ) => readonly MobileHudValidationFailure[],
  scheduleFrame?: (callback: FrameRequestCallback) => number,
  cancelFrame?: (handle: number) => void,
  translate: (key: string, values?: Readonly<Record<string, string | number>>) => string = (key) =>
    `translated:${key}`,
) {
  const document = new FakeDocument();
  const openChanges: boolean[] = [];
  const previewBegins: MobileHudLayoutDocumentV1[] = [];
  const previewUpdates: MobileHudLayoutDocumentV1[] = [];
  const previewEnds: number[] = [];
  const committedDocuments: MobileHudLayoutDocumentV1[] = [];
  const lifecycleEvents: string[] = [];
  const focusTrapEvents: string[] = [];
  const storageWrites: string[] = [];
  const discardPrompts: Array<Readonly<Record<string, string>>> = [];
  const storage: MobileHudLayoutStorage = {
    load: async () => null,
    save: async (serialized) => {
      storageWrites.push(serialized);
      if (saveShouldReject) throw new Error('test write failure');
    },
  };
  const editor = new MobileHudEditor({
    document: document as unknown as Document,
    registry: MOBILE_HUD_REGISTRY,
    canOpen: () => eligible,
    getDocument: () => sourceDocument,
    getProfileId: () => 'phone',
    getSceneId: () => 'world',
    getContextId: () => 'world.base',
    getGeometry: () => geometry,
    getHandedness: () => handedness,
    isSurfaceAvailable,
    beginPreview: (layout) => previewBegins.push(layout),
    updatePreview: (layout) => previewUpdates.push(layout),
    validateDraft,
    validateCurrentDraft,
    scheduleFrame,
    cancelFrame,
    validationMatrix: [],
    storage,
    commitValidatedDocument: (layout) => {
      lifecycleEvents.push('commit');
      committedDocuments.push(layout);
    },
    endPreview: () => {
      lifecycleEvents.push('end-preview');
      previewEnds.push(previewEnds.length + 1);
    },
    focusManager: {
      open: ({ root, returnFocusTo }) => ({
        focusFirst: () => {
          focusTrapEvents.push('focus-first');
          root()?.focus();
        },
        release: () => {
          focusTrapEvents.push('release');
          returnFocusTo?.focus();
        },
      }),
    },
    confirmDiscard: (copy) => {
      discardPrompts.push(copy);
      return confirmDiscard;
    },
    translate,
    onOpenChange: (open) => openChanges.push(open),
  });
  return {
    document,
    editor,
    openChanges,
    previewBegins,
    previewUpdates,
    previewEnds,
    committedDocuments,
    lifecycleEvents,
    focusTrapEvents,
    storageWrites,
    discardPrompts,
  };
}

describe('MobileHudEditor shell and lifecycle', () => {
  it('guards eligibility and creates only one translated modal dialog instance', () => {
    const blocked = setup(false);
    expect(blocked.editor.open()).toBe(false);
    expect(blocked.document.body.children).toHaveLength(0);
    expect(blocked.openChanges).toEqual([]);

    const { document, editor, openChanges } = setup();
    expect(editor.open()).toBe(true);
    expect(editor.open()).toBe(true);
    expect(document.body.children).toHaveLength(1);
    expect(openChanges).toEqual([true]);
    const root = document.body.children[0];
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-label')).toBe(
      'translated:hudChrome.mobileHudEditor.dialogLabel',
    );
    expect(root.classList.contains('mobile-hud-editor')).toBe(true);
    const dragHandle = root.findByAttribute('data-mobile-hud-editor-drag-handle', 'true');
    expect(dragHandle?.getAttribute('role')).toBe('group');
    expect(dragHandle?.getAttribute('aria-label')).toBe(
      'translated:hudChrome.mobileHudEditor.dragHandleLabel',
    );
    expect(dragHandle?.getAttribute('aria-label')).not.toBe(root.getAttribute('aria-label'));
    expect(dragHandle?.getAttribute('aria-keyshortcuts')).toBe(
      'ArrowUp ArrowDown ArrowLeft ArrowRight Home',
    );
    const hintId = dragHandle?.getAttribute('aria-describedby');
    expect(hintId).toBe('mobile-hud-editor-drag-hint');
    expect(root.findByAttribute('id', hintId ?? '')?.textContent).toBe(
      'translated:hudChrome.mobileHudEditor.dragHandleHint',
    );
    expect(dragHandle?.descendants().some((element) => element.tagName === 'H2')).toBe(false);
  });

  it('starts Locked with an isolated entry snapshot and the active profile only selected', () => {
    const { editor } = setup();
    editor.open();
    const draft = editor.draft;
    expect(draft?.locked).toBe(true);
    expect(draft?.activeProfileId).toBe('phone');
    expect(draft?.sceneId).toBe('world');
    expect(draft?.contextId).toBe('world.base');
    expect(draft?.document).toEqual(entryDocument());
    expect(draft?.document).not.toBe(draft?.entryDocument);
    expect(draft?.document.profiles.tablet).toEqual(entryDocument().profiles.tablet);
  });

  it('keeps proxy geometry applied when Lock or context rerenders the preview', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const position = () => {
      const proxy = root.findByAttribute('data-mobile-hud-surface-id', 'action.attack');
      return [proxy?.style.left, proxy?.style.top];
    };
    expect(position().every(Boolean)).toBe(true);
    editor.setLocked(false);
    expect(position().every(Boolean)).toBe(true);
    editor.setContext('arena.standard');
    expect(position().every(Boolean)).toBe(true);
  });

  it('keeps a primary proxy frame on the live HUD position when its hit wrapper is clamped', () => {
    const source = entryDocument();
    const movement = source.profiles.phone?.['control.movement'];
    if (!movement) throw new Error('movement editor fixture is incomplete');
    source.profiles.phone = {
      ...source.profiles.phone,
      'control.movement': { ...movement, offsetY: 80 },
    };
    const { document, editor } = setup(true, 'right', () => [], false, source);
    editor.open();
    const descriptor = MOBILE_HUD_REGISTRY.getDescriptor('control.movement');
    const placement = editor.draft?.document.profiles.phone?.['control.movement'];
    if (!descriptor || !placement) throw new Error('movement editor fixture is incomplete');
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor,
      'phone',
      placement,
      geometry,
      'world.base',
    );
    const proxy = document.body.children[0].findByAttribute(
      'data-mobile-hud-surface-id',
      'control.movement',
    );
    const frame = proxy?.querySelector<FakeElement>('.mobile-hud-editor-proxy-frame');
    const renderedX =
      Number.parseFloat(proxy?.style.left ?? '') + Number.parseFloat(frame?.style.left ?? '');
    const renderedY =
      Number.parseFloat(proxy?.style.top ?? '') + Number.parseFloat(frame?.style.top ?? '');

    expect(resolved.interactiveRect.y).not.toBe(resolved.previewRect.y);
    expect(renderedX).toBe(resolved.interactiveRect.x);
    expect(renderedY).toBe(resolved.interactiveRect.y);
  });

  it('owns body state, restores focus, and removes every lifecycle node and class on close', () => {
    const { document, editor, focusTrapEvents, openChanges } = setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    editor.open();
    expect(document.body.classList.contains('mobile-hud-editor-open')).toBe(true);
    expect(document.body.classList.contains('mobile-hud-context-world-base')).toBe(true);
    expect(document.activeElement).not.toBe(opener);

    editor.close();
    editor.close();
    expect(document.body.classList.contains('mobile-hud-editor-open')).toBe(false);
    expect(document.body.classList.contains('mobile-hud-context-world-base')).toBe(false);
    expect(document.body.children).toEqual([opener]);
    expect(document.activeElement).toBe(opener);
    expect(editor.draft).toBeNull();
    expect(openChanges).toEqual([true, false]);
    expect(focusTrapEvents).toEqual(['focus-first', 'release']);
  });

  it('makes the live HUD inert and ends preview exactly once even when close is called directly', () => {
    const { document, editor, previewEnds } = setup();
    const ui = document.createElement('div');
    const mobileControls = document.createElement('div');
    mobileControls.inert = true;
    document.selectorMatches.set('#ui', [ui]);
    document.selectorMatches.set('#mobile-controls', [mobileControls]);

    editor.open();
    expect(ui.inert).toBe(true);
    expect(mobileControls.inert).toBe(true);

    editor.close();
    editor.close();
    expect(ui.inert).toBe(false);
    expect(mobileControls.inert).toBe(true);
    expect(previewEnds).toHaveLength(1);
  });

  it('contains Escape inside the modal before requesting close', () => {
    const { document, editor } = setup();
    editor.open();
    const event = document.body.children[0].dispatch('keydown', { key: 'Escape' });
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(editor.isOpen).toBe(false);
  });
});

describe('MobileHudEditor scene preview', () => {
  it('omits pet controls when the current player class cannot use pets', () => {
    const { document, editor } = setup(
      true,
      'right',
      () => [],
      false,
      entryDocument(),
      true,
      (surfaceId) => surfaceId !== 'pet.commands',
    );

    editor.open();
    editor.setLocked(false);
    const root = document.body.children[0];

    expect(root.findByAttribute('data-mobile-hud-surface-id', 'pet.commands')).toBeUndefined();
    editor.selectSurface('pet.commands');
    expect(editor.draft?.selectedSurfaceId).toBeNull();
  });

  it('uses live HUD fragments as the visual layer and clears editor state on close', () => {
    const { document, editor } = setup();
    const actionA1 = document.createElement('button');
    const attack = document.createElement('button');
    const cameraRoot = document.createElement('div');
    const cameraJoystick = document.createElement('div');
    document.selectorMatches.set(
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="0"]',
      [actionA1],
    );
    document.selectorMatches.set('#mobile-action-attack', [attack]);
    document.selectorMatches.set('#mobile-controls', [cameraRoot]);
    document.selectorMatches.set('#mobile-camera-joystick', [cameraJoystick]);

    editor.open();

    expect(actionA1.getAttribute('data-mobile-hud-editor-visual')).toBe('action.a1');
    expect(actionA1.getAttribute('data-mobile-hud-editor-state')).toBe('unselected');
    expect(attack.getAttribute('data-mobile-hud-editor-state')).toBe('unselected');
    expect(cameraRoot.getAttribute('data-mobile-hud-editor-visual')).toBeNull();
    expect(cameraJoystick.getAttribute('data-mobile-hud-editor-visual')).toBe('control.view');

    editor.setLocked(false);
    editor.selectSurface('action.attack');

    expect(attack.getAttribute('data-mobile-hud-editor-state')).toBe('selected');
    expect(actionA1.getAttribute('data-mobile-hud-editor-state')).toBe('unselected');

    editor.close();

    for (const element of [actionA1, attack, cameraRoot, cameraJoystick]) {
      expect(element.getAttribute('data-mobile-hud-editor-visual')).toBeNull();
      expect(element.getAttribute('data-mobile-hud-editor-state')).toBeNull();
    }
  });

  it('renders exactly the active context surfaces with View and nonselectable protected ghosts', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const renderedIds = root
      .descendants()
      .map((element) => element.getAttribute('data-mobile-hud-surface-id'))
      .filter((id): id is string => id !== null);
    const expectedIds = MOBILE_HUD_REGISTRY.descriptors
      .filter((descriptor) => descriptor.visibleIn.includes('world.base'))
      .map((descriptor) => descriptor.id);

    expect(renderedIds).toEqual(expectedIds);
    expect(renderedIds).toContain('control.view');
    const movableProxy = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    expect(movableProxy?.getAttribute('aria-label')).toBe(
      'translated:hudChrome.mobileHudEditor.surface.actionA1',
    );
    expect(
      movableProxy?.querySelector('.mobile-hud-editor-proxy-frame')?.getAttribute('aria-hidden'),
    ).toBe('true');
    const protectedGhost = root.findByAttribute(
      'data-mobile-hud-surface-id',
      'protected.system.center_message',
    );
    expect(protectedGhost?.getAttribute('data-mobile-hud-surface-class')).toBe('protected');
    expect(protectedGhost?.getAttribute('role')).toBe('note');
    expect(protectedGhost?.getAttribute('aria-label')).toBe(
      'translated:hudChrome.mobileHudEditor.surface.protectedCenterMessage',
    );
    expect(protectedGhost?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows full empty placeholders and noninteractive envelopes for every hidden HUD footprint', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];

    const expectEnvelope = (
      surfaceId: 'control.movement' | 'minimap.cluster' | 'party' | 'auras.player_buffs',
      kind: 'interactive' | 'state-envelope',
    ) => {
      const descriptor = MOBILE_HUD_REGISTRY.getDescriptor(surfaceId);
      const placement = editor.draft?.document.profiles.phone?.[surfaceId];
      if (!descriptor || !placement) throw new Error(`${surfaceId} editor fixture is incomplete`);
      const resolved = resolveMobileHudSurfaceGeometry(
        descriptor,
        'phone',
        placement,
        geometry,
        'world.base',
      );
      const proxy = root.findByAttribute('data-mobile-hud-surface-id', surfaceId);
      const envelope = proxy?.querySelector<FakeElement>('.mobile-hud-editor-layout-envelope');
      const expected =
        kind === 'state-envelope' ? resolved.canonicalRect : resolved.interactiveRect;
      expect(envelope?.getAttribute('data-mobile-hud-envelope-kind')).toBe(kind);
      expect(Number.parseFloat(envelope?.style.width ?? '')).toBeCloseTo(expected.width);
      expect(Number.parseFloat(envelope?.style.height ?? '')).toBeCloseTo(expected.height);
      return { proxy, resolved };
    };

    expectEnvelope('control.movement', 'interactive');
    expectEnvelope('minimap.cluster', 'interactive');
    const party = expectEnvelope('party', 'state-envelope');
    const buffs = expectEnvelope('auras.player_buffs', 'interactive');

    expect(party.proxy?.getAttribute('data-mobile-hud-placeholder')).toBe('when-empty');
    expect(buffs.proxy?.getAttribute('data-mobile-hud-placeholder')).toBe('when-empty');
    expect(
      Number.parseFloat(
        party.proxy?.querySelector<FakeElement>('.mobile-hud-editor-proxy-frame')?.style.width ??
          '',
      ),
    ).toBeCloseTo(party.resolved.canonicalRect.width);
    expect(
      Number.parseFloat(
        buffs.proxy?.querySelector<FakeElement>('.mobile-hud-editor-proxy-frame')?.style.width ??
          '',
      ),
    ).toBeCloseTo(buffs.resolved.canonicalRect.width);
  });

  it('keeps every preview state in one compact dropdown', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const contextIds = [
      'world.base',
      'world.vale_cup_indicator',
      'arena.standard',
      'arena.fiesta.base',
      'arena.fiesta.pending',
      'arena.yumi.base',
      'vale_cup.match',
      'vale_cup.match.charge',
      'instance.delve',
    ] as const;

    const contextSelect = root.findByAttribute('data-mobile-hud-selector', 'context');
    expect(contextSelect?.tagName).toBe('SELECT');
    expect(root.descendants().filter((element) => element.tagName === 'SELECT')).toHaveLength(1);
    expect(
      root
        .descendants()
        .filter((element) => element.getAttribute('data-mobile-hud-context-id') !== null),
    ).toHaveLength(contextIds.length);
    for (const contextId of contextIds) {
      if (!contextSelect) throw new Error('context dropdown missing');
      contextSelect.value = contextId;
      contextSelect.dispatch('change');
      expect(editor.draft?.contextId).toBe(contextId);
      expect(
        document.body.classList.contains(`mobile-hud-context-${contextId.replaceAll('.', '-')}`),
      ).toBe(true);
    }

    if (!contextSelect) throw new Error('context dropdown missing');
    contextSelect.value = 'arena.fiesta.pending';
    contextSelect.dispatch('change');
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'status.arena.fiesta_pending'),
    ).toBeDefined();
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'protected.arena.fiesta_respawn'),
    ).toBeUndefined();
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'protected.arena.fiesta_offer'),
    ).toBeUndefined();

    contextSelect.value = 'arena.fiesta.respawn_offer';
    contextSelect.dispatch('change');
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'status.arena.fiesta_pending'),
    ).toBeUndefined();
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'protected.arena.fiesta_respawn'),
    ).toBeDefined();
    expect(
      root.findByAttribute('data-mobile-hud-surface-id', 'protected.arena.fiesta_offer'),
    ).toBeDefined();
  });

  it('opens the compact palette centered and moves it as one unit by its header', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const palette = root.findByAttribute('data-mobile-hud-editor-palette', 'true');
    const handle = root.findByAttribute('data-mobile-hud-editor-drag-handle', 'true');
    expect(palette).toBeDefined();
    expect(handle).toBeDefined();
    if (!palette || !handle) throw new Error('editor palette fixture missing');
    palette.rect = { x: 220, y: 90, width: 300, height: 180 };

    handle.dispatch('pointerdown', { pointerId: 17, clientX: 260, clientY: 110 });
    handle.dispatch('pointermove', { pointerId: 17, clientX: 300, clientY: 145 });

    expect(palette.style.left).toBe('260px');
    expect(palette.style.top).toBe('125px');
    expect(palette.style.translate).toBe('0 0');
    expect(handle.hasPointerCapture(17)).toBe(true);
    handle.dispatch('pointerup', { pointerId: 17, clientX: 300, clientY: 145 });
    expect(handle.hasPointerCapture(17)).toBe(false);
  });

  it('makes the palette handle keyboard movable and removes Locked proxies from Tab order', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const palette = root.findByAttribute('data-mobile-hud-editor-palette', 'true');
    const handle = root.findByAttribute('data-mobile-hud-editor-drag-handle', 'true');
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    if (!palette || !handle || !action) throw new Error('keyboard editor fixture missing');
    palette.rect = { x: 220, y: 90, width: 300, height: 180 };

    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('role')).toBe('group');
    expect(handle.getAttribute('aria-label')).toBe(
      'translated:hudChrome.mobileHudEditor.dragHandleLabel',
    );
    expect(handle.getAttribute('aria-describedby')).toBe('mobile-hud-editor-drag-hint');
    expect(action.tabIndex).toBe(-1);

    handle.dispatch('keydown', { key: 'ArrowRight' });
    expect(palette.style.left).toBe('230px');
    expect(palette.style.top).toBe('90px');
    handle.dispatch('keydown', { key: 'Home' });
    expect(palette.style.left).toBe('50%');
    expect(palette.style.top).toBe('calc(50% - 16px)');

    editor.setLocked(false);
    expect(root.findByAttribute('data-mobile-hud-surface-id', 'action.a1')?.tabIndex).toBe(0);
  });

  it('keeps the inspector compact because movement is owned by drag gestures', () => {
    const { document, editor } = setup();
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const root = document.body.children[0];
    const controls = () =>
      root
        .descendants()
        .map((element) => element.getAttribute('data-mobile-hud-control'))
        .filter((control): control is string => control !== null);

    editor.selectSurface('action.a1');
    expect(controls()).toEqual(['scale-decrease', 'scale-increase', 'reset-selected', 'reset-all']);
    expect(root.findByAttribute('data-mobile-hud-control', 'scale-decrease')?.textContent).toBe(
      '−',
    );
    expect(root.findByAttribute('data-mobile-hud-control', 'scale-increase')?.textContent).toBe(
      '+',
    );

    editor.selectSurface('pet.commands');
    expect(controls()).toEqual(['scale-decrease', 'scale-increase', 'reset-selected', 'reset-all']);

    editor.selectSurface('utility.consumables');
    expect(controls()).toEqual(['scale-decrease', 'scale-increase', 'reset-selected', 'reset-all']);

    editor.selectSurface('protected.system.center_message');
    expect(editor.draft?.selectedSurfaceId).toBe('utility.consumables');
  });

  it('Lock keeps the exact preview and enabled state while disabling movable proxies', () => {
    const { document, editor } = setup();
    editor.open();
    const root = document.body.children[0];
    const before = structuredClone(editor.draft?.document);
    const renderedBefore = root
      .descendants()
      .map((element) => element.getAttribute('data-mobile-hud-surface-id'))
      .filter((id): id is string => id !== null);

    editor.setLocked(false);
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'action.a1')
        ?.getAttribute('aria-disabled'),
    ).toBe('false');
    editor.setLocked(true);

    expect(editor.draft?.document).toEqual(before);
    expect(editor.draft?.document.enabled).toBe(false);
    expect(
      root
        .descendants()
        .map((element) => element.getAttribute('data-mobile-hud-surface-id'))
        .filter((id): id is string => id !== null),
    ).toEqual(renderedBefore);
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'action.a1')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('MobileHudEditor live manipulation', () => {
  it('coalesces repeated pointer moves to one live update per animation frame', () => {
    const scheduled: FrameRequestCallback[] = [];
    const { document, editor, previewUpdates } = setup(
      true,
      'right',
      () => [],
      false,
      entryDocument(),
      true,
      () => true,
      undefined,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    );
    editor.open();
    editor.setLocked(false);
    const action = document.body.children[0].findByAttribute(
      'data-mobile-hud-surface-id',
      'action.a1',
    );
    action?.dispatch('pointerdown', { pointerId: 6, clientX: 40, clientY: 40 });
    action?.dispatch('pointermove', { pointerId: 6, clientX: 45, clientY: 40 });
    action?.dispatch('pointermove', { pointerId: 6, clientX: 55, clientY: 40 });

    expect(previewUpdates).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    scheduled[0](0);
    expect(previewUpdates).toHaveLength(1);
  });

  it('validates only the current screen while dragging and the full matrix on release', () => {
    let fullValidationCalls = 0;
    let currentValidationCalls = 0;
    const { document, editor } = setup(
      true,
      'right',
      () => {
        fullValidationCalls += 1;
        return [];
      },
      false,
      entryDocument(),
      true,
      () => true,
      () => {
        currentValidationCalls += 1;
        return [];
      },
    );
    editor.open();
    editor.setLocked(false);
    const action = document.body.children[0].findByAttribute(
      'data-mobile-hud-surface-id',
      'action.a1',
    );

    action?.dispatch('pointerdown', { pointerId: 5, clientX: 40, clientY: 40 });
    action?.dispatch('pointermove', { pointerId: 5, clientX: 50, clientY: 45 });

    expect(fullValidationCalls).toBe(1);
    expect(currentValidationCalls).toBe(1);

    action?.dispatch('pointerup', { pointerId: 5, clientX: 50, clientY: 45 });
    expect(fullValidationCalls).toBe(2);
  });

  it('selects only while Unlocked with an accessible selected state and begins one preview', () => {
    const { document, editor, previewBegins, previewUpdates } = setup();
    editor.open();
    const root = document.body.children[0];
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    action?.click();
    expect(editor.draft?.selectedSurfaceId).toBeNull();

    editor.setLocked(false);
    const unlockedAction = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    unlockedAction?.click();

    expect(editor.draft?.selectedSurfaceId).toBe('action.a1');
    expect(unlockedAction?.classList.contains('is-selected')).toBe(true);
    expect(unlockedAction?.getAttribute('aria-pressed')).toBe('true');
    expect(previewBegins).toHaveLength(1);
    expect(previewBegins[0]).toEqual(entryDocument());
    expect(previewUpdates).toHaveLength(0);
  });

  it('inverse-scales drag deltas, updates ephemeral preview, and releases capture on cancel', () => {
    const { document, editor, previewUpdates } = setup();
    editor.open();
    editor.setLocked(false);
    const root = document.body.children[0];
    const preview = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-preview'));
    if (preview) preview.rect = { x: 0, y: 0, width: 370, height: 180 };
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    const beforeDocument = structuredClone(editor.draft?.document);

    action?.dispatch('pointerdown', { pointerId: 7, clientX: 100, clientY: 100 });
    const beforeProxyLeft = Number.parseFloat(action?.style.left ?? '0');
    action?.dispatch('pointermove', { pointerId: 7, clientX: 110, clientY: 95 });

    const beforeRect = actionA1DisplayedRect(beforeDocument as MobileHudLayoutDocumentV1, 'right');
    const afterRect = actionA1DisplayedRect(
      editor.draft?.document as MobileHudLayoutDocumentV1,
      'right',
    );
    expect(afterRect.x).toBe(beforeRect.x + 20);
    expect(afterRect.y).toBe(beforeRect.y - 10);
    expect(Number.parseFloat(action?.style.left ?? '0')).toBe(beforeProxyLeft + 10);
    expect(previewUpdates).toEqual([editor.draft?.document]);
    expect(action?.hasPointerCapture(7)).toBe(true);

    action?.dispatch('pointercancel', { pointerId: 7 });
    expect(action?.hasPointerCapture(7)).toBe(false);
    action?.dispatch('pointermove', { pointerId: 7, clientX: 130, clientY: 95 });
    expect(previewUpdates).toHaveLength(1);
  });

  it('inverse-mirrors a left-handed displayed drag into the canonical right-hand profile', () => {
    const { document, editor } = setup(true, 'left');
    editor.open();
    editor.setLocked(false);
    const root = document.body.children[0];
    const preview = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-preview'));
    if (preview) preview.rect = { x: 0, y: 0, width: 740, height: 360 };
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    const beforeDocument = structuredClone(editor.draft?.document);

    action?.dispatch('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 });
    action?.dispatch('pointermove', { pointerId: 2, clientX: 70, clientY: 50 });

    const beforeRect = actionA1DisplayedRect(beforeDocument as MobileHudLayoutDocumentV1, 'left');
    const afterRect = actionA1DisplayedRect(
      editor.draft?.document as MobileHudLayoutDocumentV1,
      'left',
    );
    expect(afterRect.x).toBe(beforeRect.x + 20);
    expect(afterRect.y).toBe(beforeRect.y);
  });

  it('keeps a Locked draft byte-identical when a proxy receives pointer events', () => {
    const { document, editor, previewUpdates } = setup();
    editor.open();
    const root = document.body.children[0];
    const preview = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-preview'));
    if (preview) preview.rect = { x: 0, y: 0, width: 740, height: 360 };
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    const before = JSON.stringify(editor.draft?.document);

    action?.dispatch('pointerdown', { pointerId: 9, clientX: 10, clientY: 10 });
    action?.dispatch('pointermove', { pointerId: 9, clientX: 100, clientY: 100 });

    expect(JSON.stringify(editor.draft?.document)).toBe(before);
    expect(action?.hasPointerCapture(9)).toBe(false);
    expect(previewUpdates).toHaveLength(0);
  });
});

describe('MobileHudEditor inspector edits', () => {
  it('keeps arrow-key nudging as a non-visual alternative and exposes compact scale controls', () => {
    const { document, editor, previewUpdates } = setup();
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const root = document.body.children[0];
    const before = editor.draft?.document.profiles.phone?.['action.a1'];

    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    action?.dispatch('keydown', { key: 'ArrowRight' });
    action?.dispatch('keydown', { key: 'ArrowUp' });
    root.findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();

    const after = editor.draft?.document.profiles.phone?.['action.a1'];
    expect(after?.offsetX).toBe((before?.offsetX ?? 0) + 1);
    expect(after?.offsetY).toBe((before?.offsetY ?? 0) - 1);
    expect(after?.scale).toBe((before?.scale ?? 1) + 0.1);
    expect(previewUpdates).toHaveLength(3);
    expect(previewUpdates.at(-1)).toBe(editor.draft?.document);
  });

  it('does not clutter the palette with advanced orientation or flow controls', () => {
    const { document, editor } = setup();
    editor.open();
    editor.setLocked(false);
    const root = document.body.children[0];

    editor.selectSurface('pet.commands');
    expect(root.findByAttribute('data-mobile-hud-control', 'orientation')).toBeUndefined();
    expect(root.findByAttribute('data-mobile-hud-control', 'reverse')).toBeUndefined();
    expect(root.findByAttribute('data-mobile-hud-control', 'opening-direction')).toBeUndefined();
  });

  it('holds scale limits and resets only the active profile', () => {
    const { document, editor } = setup();
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const root = document.body.children[0];
    const tabletBefore = structuredClone(editor.draft?.document.profiles.tablet);

    for (let index = 0; index < 20; index += 1) {
      root.findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();
    }
    expect(editor.draft?.document.profiles.phone?.['action.a1']?.scale).toBe(1.5);
    root.findByAttribute('data-mobile-hud-control', 'reset-selected')?.click();
    expect(editor.draft?.document.profiles.phone?.['action.a1']).toEqual(
      MOBILE_HUD_REGISTRY.defaults.phone?.['action.a1'],
    );

    root.findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();
    root.findByAttribute('data-mobile-hud-control', 'reset-all')?.click();
    expect(editor.draft?.document.profiles.phone).toEqual(MOBILE_HUD_REGISTRY.defaults.phone);
    expect(editor.draft?.document.profiles.tablet).toEqual(tabletBefore);
  });
});

describe('MobileHudEditor touch drag contract', () => {
  it('keeps the palette drag handle out of browser pan arbitration', () => {
    const genericTouchRule = mobileHudCss.lastIndexOf('.mobile-hud-editor [role="button"]');
    const handleOverride = mobileHudCss.lastIndexOf('.mobile-hud-editor-drag-handle');
    expect(genericTouchRule).toBeGreaterThan(-1);
    expect(handleOverride).toBeGreaterThan(genericTouchRule);
    const ruleEnd = mobileHudCss.indexOf('}', handleOverride);
    expect(ruleEnd).toBeGreaterThan(handleOverride);
    expect(mobileHudCss.slice(handleOverride, ruleEnd)).toContain('touch-action: none');
  });
});

describe('MobileHudEditor validation UI', () => {
  it('hides foreign-hand owned fragments without requiring a live-visual marker', () => {
    expect(mobileHudCss).toMatch(
      /body\.mobile-touch\.mobile-hud-editor-open\s+\[data-mobile-hud-editor-hidden="true"\]\s*\{[^}]*visibility:\s*hidden !important;[^}]*pointer-events:\s*none !important;/,
    );
  });

  it.each([
    'invalid-placement',
    'unsupported-capability',
    'scale-out-of-range',
    'target-too-small',
    'out-of-bounds',
    'overlap',
    'view-intrusion',
    'protected-overlap',
  ] as const)('blocks Save and exposes a non-color signal for %s', (reason) => {
    const failure: MobileHudValidationFailure = {
      reason,
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds:
        reason.includes('overlap') || reason === 'view-intrusion'
          ? ['action.a1', 'control.view']
          : ['action.a1'],
    };
    const { document, editor } = setup(true, 'right', () => [failure]);
    editor.open();
    const root = document.body.children[0];
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    const save = root.findByAttribute('data-mobile-hud-action', 'save');

    expect(editor.draft?.failures).toEqual([failure]);
    expect(action?.classList.contains('is-invalid')).toBe(true);
    expect(action?.getAttribute('aria-invalid')).toBe('true');
    expect(
      action
        ?.descendants()
        .some((element) => element.classList.contains('mobile-hud-editor-proxy-error')),
    ).toBe(true);
    const error = action
      ?.descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-proxy-error'));
    expect(error?.getAttribute('aria-hidden')).toBeNull();
    expect(error?.textContent).toContain(`translated:hudChrome.mobileHudEditor.failure.`);
    expect(save?.getAttribute('aria-disabled')).toBe('true');
    if (failure.surfaceIds.length === 2) {
      expect(
        root
          .findByAttribute('data-mobile-hud-surface-id', 'control.view')
          ?.classList.contains('is-invalid'),
      ).toBe(true);
    }
  });

  it('names the intruding control on both sides of a View collision', () => {
    const failure: MobileHudValidationFailure = {
      reason: 'view-intrusion',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['action.attack', 'control.view'],
    };
    const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
      key.endsWith('viewIntrusion')
        ? `${String(values?.surface)} overlaps the View area.`
        : key.endsWith('actionAttack')
          ? 'Attack'
          : key.endsWith('controlView')
            ? 'View'
            : `translated:${key}`;
    const { document, editor } = setup(
      true,
      'right',
      () => [failure],
      false,
      entryDocument(),
      true,
      () => true,
      undefined,
      undefined,
      undefined,
      translate,
    );

    editor.open();
    const root = document.body.children[0];
    for (const surfaceId of failure.surfaceIds) {
      const error = root
        .findByAttribute('data-mobile-hud-surface-id', surfaceId)
        ?.descendants()
        .find((element) => element.classList.contains('mobile-hud-editor-proxy-error'));
      expect(error?.textContent).toBe('Attack overlaps the View area.');
    }
  });

  it('shows the concrete colliding surface names in the central validation status', () => {
    const failure: MobileHudValidationFailure = {
      reason: 'overlap',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['pet.commands', 'action.a1'],
    };
    const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
      key.endsWith('failure.overlap')
        ? `${String(values?.surface)} overlaps ${String(values?.other)}.`
        : key.endsWith('petCommands')
          ? 'Pet commands'
          : key.endsWith('actionA1')
            ? 'Action A1'
            : `translated:${key}`;
    const { document, editor } = setup(
      true,
      'right',
      () => [failure],
      false,
      entryDocument(),
      true,
      () => true,
      undefined,
      undefined,
      undefined,
      translate,
    );

    editor.open();

    expect(
      document.body.children[0]
        .descendants()
        .find((element) => element.classList.contains('mobile-hud-editor-status'))?.textContent,
    ).toBe('Pet commands overlaps Action A1.');
  });

  it('names the exact protected surface instead of generic protected game UI', () => {
    const failure: MobileHudValidationFailure = {
      reason: 'protected-overlap',
      profileId: 'phone',
      contextId: 'arena.fiesta.respawn',
      surfaceIds: ['action.attack', 'protected.arena.fiesta_respawn'],
    };
    const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
      key.endsWith('protectedOverlap')
        ? `${String(values?.surface)} overlaps ${String(values?.other)}.`
        : key.endsWith('failureWithContext')
          ? `${String(values?.message)} [${String(values?.context)}]`
          : key.endsWith('actionAttack')
            ? 'Attack'
            : key.endsWith('protectedFiestaRespawn')
              ? 'Fiesta respawn prompt'
              : `translated:${key}`;
    const { document, editor } = setup(
      true,
      'right',
      () => [failure],
      false,
      entryDocument(),
      true,
      () => true,
      undefined,
      undefined,
      undefined,
      translate,
    );

    editor.open();

    expect(
      document.body.children[0]
        .descendants()
        .find((element) => element.classList.contains('mobile-hud-editor-status'))?.textContent,
    ).toBe(
      'Attack overlaps Fiesta respawn prompt. [translated:hudChrome.mobileHudEditor.context.arenaFiestaRespawn]',
    );
  });

  it('reports an off-device failure fixture without rescaling the physical stage', () => {
    const failure: MobileHudValidationFailure = {
      reason: 'out-of-bounds',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['frame.target'],
      viewportId: 'phone-1280x720',
      safeAreaFixtureId: 'side-none/bottom-0',
    };
    const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
      key.endsWith('failure.outOfBounds')
        ? `${String(values?.surface)} is outside.`
        : key.endsWith('failureWithFixture')
          ? `${String(values?.message)} [${String(values?.context)}; ${String(values?.profile)}; ${String(values?.viewport)}]`
          : key.endsWith('frameTarget')
            ? 'Target frame'
            : key.endsWith('worldBase')
              ? 'World'
              : key.endsWith('profilePhone')
                ? 'Phone'
                : `translated:${key}`;
    const { document, editor } = setup(
      true,
      'right',
      () => [failure],
      false,
      entryDocument(),
      true,
      () => true,
      undefined,
      undefined,
      undefined,
      translate,
    );

    editor.open();

    expect(
      document.body.children[0]
        .descendants()
        .find((element) => element.classList.contains('mobile-hud-editor-status'))?.textContent,
    ).toBe('Target frame is outside. [World; Phone; phone-1280x720 / side-none/bottom-0]');
  });

  it('opens on the context and geometry of the first off-context blocking failure', () => {
    const failure: MobileHudValidationFailure = {
      reason: 'overlap',
      profileId: 'phone',
      contextId: 'instance.delve',
      surfaceIds: ['action.a5', 'tracker.delve'],
      viewportId: 'phone-740x360/side-none/bottom-0',
      safeAreaFixtureId: 'side-none/bottom-0',
    };
    const { document, editor } = setup(true, 'right', () => [failure]);

    editor.open();

    expect(editor.draft?.contextId).toBe('instance.delve');
    expect(editor.draft?.activeFailureIndex).toBe(0);
    expect(
      document.body.children[0].findByAttribute('data-mobile-hud-selector', 'context')?.value,
    ).toBe('instance.delve');
    expect(document.body.classList.contains('mobile-hud-context-instance-delve')).toBe(true);
  });

  it('previews, edits, and diagnoses a failure in its handedness instead of the global setting', async () => {
    const source = entryDocument();
    source.profiles.phone = {
      ...source.profiles.phone,
      'action.a1': {
        anchor: 'top-left',
        offsetX: 55,
        offsetY: 110,
        scale: 1,
      },
    };
    const failure: MobileHudValidationFailure = {
      reason: 'overlap',
      profileId: 'phone',
      contextId: 'arena.yumi.base',
      surfaceIds: ['action.a1', 'status.arena.yumi'],
      handedness: 'left',
      viewportId: 'phone-740x360',
      safeAreaFixtureId: 'side-none/bottom-0',
    };
    const translate = (key: string, values?: Readonly<Record<string, string | number>>): string =>
      key.endsWith('failure.overlap')
        ? `${String(values?.surface)} overlaps ${String(values?.other)}.`
        : key.endsWith('failureWithFixture')
          ? `${String(values?.message)} [${String(values?.viewport)}]`
          : key.endsWith('actionA1')
            ? 'Action A1'
            : key.endsWith('statusYumi')
              ? 'Yumi status'
              : `translated:${key}`;
    const { document, editor } = setup(
      true,
      'right',
      (layout) => (layout.profiles.phone?.['action.a1']?.offsetX === 55 ? [failure] : []),
      false,
      source,
      true,
      () => true,
      undefined,
      undefined,
      undefined,
      translate,
    );
    const minimapSelectors = [
      '#minimap-wrap',
      '#zone-label',
      '#minimap-disc',
      '#minimap-clock',
      '#minimap-coords',
      '#compass',
      '#raid-lockout',
      '#mail-indicator',
      '#minimap-zoom',
    ] as const;
    const minimapElements = minimapSelectors.map((selector) => {
      const element = document.createElement('div');
      document.selectorMatches.set(selector, [element]);
      return element;
    });

    editor.open();

    const root = document.body.children[0];
    const preview = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-preview'));
    const action = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    const status = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-status'));
    const beforeDocument = structuredClone(editor.draft?.document) as MobileHudLayoutDocumentV1;
    const beforeRect = actionA1DisplayedRect(beforeDocument, 'left');

    expect(editor.draft?.contextId).toBe('arena.yumi.base');
    expect(preview?.getAttribute('data-mobile-hud-preview-handedness')).toBe('left');
    expect(Number.parseFloat(action?.style.left ?? '')).toBe(beforeRect.x);
    expect(Number.parseFloat(action?.style.top ?? '')).toBe(beforeRect.y);
    expect(action?.getAttribute('data-mobile-hud-live-visual')).toBe('false');
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'minimap.cluster')
        ?.getAttribute('data-mobile-hud-live-visual'),
    ).toBe('false');
    expect(
      minimapElements.every(
        (element) => element.getAttribute('data-mobile-hud-editor-hidden') === 'true',
      ),
    ).toBe(true);
    expect(status?.textContent).toContain(
      'translated:hudChrome.options.mobileLeftHanded: translated:hud.options.on',
    );
    expect(await editor.save()).toBe(false);
    expect(status?.textContent).toContain(
      'translated:hudChrome.options.mobileLeftHanded: translated:hud.options.on',
    );

    editor.setLocked(false);
    const unlockedAction = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    unlockedAction?.dispatch('pointerdown', { pointerId: 12, clientX: 50, clientY: 50 });
    unlockedAction?.dispatch('pointermove', { pointerId: 12, clientX: 70, clientY: 50 });

    const afterLeftRect = actionA1DisplayedRect(
      editor.draft?.document as MobileHudLayoutDocumentV1,
      'left',
    );
    expect(afterLeftRect.x).toBe(beforeRect.x + 20);
    expect(afterLeftRect.y).toBe(beforeRect.y);
    expect(unlockedAction?.hasPointerCapture(12)).toBe(true);
    expect(preview?.getAttribute('data-mobile-hud-preview-handedness')).toBe('left');

    unlockedAction?.dispatch('pointerup', { pointerId: 12, clientX: 70, clientY: 50 });

    const afterRightRect = actionA1DisplayedRect(
      editor.draft?.document as MobileHudLayoutDocumentV1,
      'right',
    );
    const runtimeHandAction = root.findByAttribute('data-mobile-hud-surface-id', 'action.a1');
    expect(unlockedAction?.hasPointerCapture(12)).toBe(false);
    expect(runtimeHandAction).not.toBe(unlockedAction);
    expect(preview?.getAttribute('data-mobile-hud-preview-handedness')).toBe('right');
    expect(Number.parseFloat(runtimeHandAction?.style.left ?? '')).toBe(afterRightRect.x);
    expect(Number.parseFloat(runtimeHandAction?.style.top ?? '')).toBe(afterRightRect.y);
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'minimap.cluster')
        ?.getAttribute('data-mobile-hud-live-visual'),
    ).toBe('true');
    expect(
      minimapElements.every(
        (element) => element.getAttribute('data-mobile-hud-editor-hidden') === null,
      ),
    ).toBe(true);
  });

  it('marks only failures from the context currently shown in the preview', () => {
    const failures: readonly MobileHudValidationFailure[] = [
      {
        reason: 'overlap',
        profileId: 'phone',
        contextId: 'instance.delve',
        surfaceIds: ['action.a5', 'tracker.delve'],
      },
      {
        reason: 'protected-overlap',
        profileId: 'phone',
        contextId: 'arena.fiesta.respawn',
        surfaceIds: ['action.attack', 'protected.arena.fiesta_respawn'],
      },
    ];
    const { document, editor } = setup(true, 'right', () => failures);

    editor.open();

    const root = document.body.children[0];
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'action.a5')
        ?.classList.contains('is-invalid'),
    ).toBe(true);
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'action.attack')
        ?.classList.contains('is-invalid'),
    ).toBe(false);
    expect(
      root.findByAttribute('data-mobile-hud-action', 'save')?.getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('re-enables Save immediately after an edit resolves the last failure', () => {
    const initialOffset = entryDocument().profiles.phone?.['action.a1']?.offsetX;
    const { document, editor } = setup(true, 'right', (layout) =>
      layout.profiles.phone?.['action.a1']?.offsetX === initialOffset
        ? [
            {
              reason: 'out-of-bounds',
              profileId: 'phone',
              contextId: 'world.base',
              surfaceIds: ['action.a1'],
            },
          ]
        : [],
    );
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const root = document.body.children[0];
    const save = root.findByAttribute('data-mobile-hud-action', 'save');
    expect(save?.getAttribute('aria-disabled')).toBe('true');

    root
      .findByAttribute('data-mobile-hud-surface-id', 'action.a1')
      ?.dispatch('keydown', { key: 'ArrowRight' });

    expect(editor.draft?.failures).toEqual([]);
    expect(save?.getAttribute('aria-disabled')).toBe('false');
    expect(
      root
        .findByAttribute('data-mobile-hud-surface-id', 'action.a1')
        ?.classList.contains('is-invalid'),
    ).toBe(false);
  });

  it('marks an invalid layout red automatically without a failing-layout button', () => {
    const initialScale = entryDocument().profiles.phone?.['action.a1']?.scale;
    const { document, editor } = setup(true, 'right', (layout) =>
      layout.profiles.phone?.['action.a1']?.scale === initialScale
        ? [
            {
              reason: 'out-of-bounds',
              profileId: 'phone',
              contextId: 'world.base',
              surfaceIds: ['action.a1'],
              viewportId: 'phone-740x360/side-none/bottom-0',
              safeAreaFixtureId: 'side-none/bottom-0',
            },
          ]
        : [],
    );
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const root = document.body.children[0];
    const preview = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-preview'));
    const status = root
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-status'));
    expect(root.findByAttribute('data-mobile-hud-action', 'show-failing-layout')).toBeUndefined();
    expect(preview?.classList.contains('is-failing-preview')).toBe(true);
    expect(status?.classList.contains('is-invalid')).toBe(true);

    root.findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();

    expect(editor.draft?.failures).toEqual([]);
    expect(editor.draft?.activeFailureIndex).toBeNull();
    expect(preview?.classList.contains('is-failing-preview')).toBe(false);
    expect(status?.classList.contains('is-invalid')).toBe(false);
  });
});

describe('MobileHudEditor transactional Save', () => {
  it('never calls storage for an invalid draft', async () => {
    const failure: MobileHudValidationFailure = {
      reason: 'overlap',
      profileId: 'phone',
      contextId: 'world.base',
      surfaceIds: ['action.a1', 'action.a2'],
    };
    const { editor, storageWrites, committedDocuments, previewEnds } = setup(true, 'right', () => [
      failure,
    ]);
    editor.open();

    expect(await editor.save()).toBe(false);
    expect(storageWrites).toEqual([]);
    expect(committedDocuments).toEqual([]);
    expect(previewEnds).toEqual([]);
    expect(editor.isOpen).toBe(true);
  });

  it('writes and promotes the already-previewed draft once before closing', async () => {
    const { editor, storageWrites, committedDocuments, lifecycleEvents, previewEnds, openChanges } =
      setup();
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    const beforeEnabled = editor.draft?.document.enabled;
    const expectedPlacement = structuredClone(editor.draft?.document.profiles.phone?.['action.a1']);

    expect(await editor.save()).toBe(true);

    expect(beforeEnabled).toBe(false);
    expect(storageWrites).toHaveLength(1);
    expect(JSON.parse(storageWrites[0]).enabled).toBe(true);
    expect(committedDocuments).toHaveLength(1);
    expect(committedDocuments[0].enabled).toBe(true);
    expect(committedDocuments[0].profiles.phone?.['action.a1']).toEqual(expectedPlacement);
    expect(lifecycleEvents).toEqual(['end-preview', 'commit']);
    expect(previewEnds).toEqual([1]);
    expect(editor.isOpen).toBe(false);
    expect(openChanges).toEqual([true, false]);
  });

  it('keeps the exact draft and preview open when storage rejects the write', async () => {
    const { document, editor, storageWrites, committedDocuments, previewEnds } = setup(
      true,
      'right',
      () => [],
      true,
    );
    editor.open();
    const before = JSON.stringify(editor.draft?.document);

    expect(await editor.save()).toBe(false);

    expect(storageWrites).toHaveLength(1);
    expect(committedDocuments).toEqual([]);
    expect(previewEnds).toEqual([]);
    expect(editor.isOpen).toBe(true);
    expect(JSON.stringify(editor.draft?.document)).toBe(before);
    const status = document.body.children[0]
      .descendants()
      .find((element) => element.classList.contains('mobile-hud-editor-status'));
    expect(status?.textContent).toBe('translated:hudChrome.mobileHudEditor.storageError');
  });
});

describe('MobileHudEditor Cancel and back handling', () => {
  it('closes a pristine draft without confirmation or storage writes', () => {
    const { editor, discardPrompts, previewEnds, storageWrites } = setup();
    editor.open();

    expect(editor.requestClose()).toBe(true);
    expect(discardPrompts).toEqual([]);
    expect(previewEnds).toEqual([1]);
    expect(storageWrites).toEqual([]);
    expect(editor.isOpen).toBe(false);
  });

  it('keeps a dirty draft exact when discard confirmation is rejected', () => {
    const { document, editor, discardPrompts, previewEnds, storageWrites } = setup(
      true,
      'right',
      () => [],
      false,
      entryDocument(),
      false,
    );
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    document.body.children[0].findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();
    const draftDocument = editor.draft?.document;

    expect(editor.requestClose()).toBe(false);
    expect(editor.draft?.document).toBe(draftDocument);
    expect(discardPrompts).toEqual([
      {
        title: 'translated:hudChrome.mobileHudEditor.discard.title',
        body: 'translated:hudChrome.mobileHudEditor.discard.body',
        confirm: 'translated:hudChrome.mobileHudEditor.discard.confirm',
        continueEditing: 'translated:hudChrome.mobileHudEditor.discard.continueEditing',
      },
    ]);
    expect(previewEnds).toEqual([]);
    expect(storageWrites).toEqual([]);
    expect(editor.isOpen).toBe(true);
  });

  it('accepts Escape discard and restores an exact enabled entry preview without writing', () => {
    const source = entryDocument();
    source.enabled = true;
    source.profiles.phone = {
      ...source.profiles.phone,
      'action.a1': { anchor: 'top-left', offsetX: 123, offsetY: 45, scale: 1.2 },
    };
    const { document, editor, previewBegins, previewEnds, storageWrites } = setup(
      true,
      'right',
      () => [],
      false,
      source,
      true,
    );
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.a1');
    document.body.children[0].findByAttribute('data-mobile-hud-control', 'scale-increase')?.click();

    document.body.children[0].dispatch('keydown', { key: 'Escape' });

    expect(previewBegins[0]).toEqual(source);
    expect(previewBegins[0].enabled).toBe(true);
    expect(previewEnds).toEqual([1]);
    expect(storageWrites).toEqual([]);
    expect(editor.isOpen).toBe(false);
  });
});

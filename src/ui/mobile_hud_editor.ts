import type { FocusTrapHandle } from './focus_manager';
import type { TranslationKey } from './i18n.catalog';
import {
  MOBILE_HUD_CONTEXTS,
  MOBILE_HUD_EDITOR_CONTEXTS,
  type MobileHudGeometryMatrixFixture,
  resolveMobileHudEditorContext,
} from './mobile_hud_context';
import {
  createMobileHudPreviewTransform,
  isMobileHudDraftDirty,
  type MobileHudPreviewTransform,
  mapMobileHudPreviewDeltaToCanonical,
  mapMobileHudVisualPointToPreview,
  mirrorMobileHudPlacement,
  reduceMobileHudDraft,
  resolveMobileHudSurfaceGeometry,
  validateMobileHudContext,
  validateMobileHudLayoutMatrix,
} from './mobile_hud_editor_core';
import type {
  MobileHudContextId,
  MobileHudDraft,
  MobileHudLayoutDocumentV1,
  MobileHudLayoutStorage,
  MobileHudProfileId,
  MobileHudPseudoGeometryBinding,
  MobileHudRect,
  MobileHudSceneId,
  MobileHudSurfaceDescriptor,
  MobileHudSurfaceId,
  MobileHudValidationFailure,
  MobileHudViewportGeometry,
} from './mobile_hud_editor_types';
import { saveMobileHudLayout } from './mobile_hud_layout_store';
import type { MobileHudRegistry } from './mobile_hud_registry';

const SURFACE_LABEL_KEYS = {
  'action.a1': 'hudChrome.mobileHudEditor.surface.actionA1',
  'action.a2': 'hudChrome.mobileHudEditor.surface.actionA2',
  'action.a3': 'hudChrome.mobileHudEditor.surface.actionA3',
  'action.a4': 'hudChrome.mobileHudEditor.surface.actionA4',
  'action.a5': 'hudChrome.mobileHudEditor.surface.actionA5',
  'action.attack': 'hudChrome.mobileHudEditor.surface.actionAttack',
  'action.target': 'hudChrome.mobileHudEditor.surface.actionTarget',
  'action.jump_use': 'hudChrome.mobileHudEditor.surface.actionJumpUse',
  'action.page': 'hudChrome.mobileHudEditor.surface.actionPage',
  'control.movement': 'hudChrome.mobileHudEditor.surface.controlMovement',
  'control.view': 'hudChrome.mobileHudEditor.surface.controlView',
  'utility.consumables': 'hudChrome.mobileHudEditor.surface.utilityConsumables',
  'pet.commands': 'hudChrome.mobileHudEditor.surface.petCommands',
  party: 'hudChrome.mobileHudEditor.surface.party',
  'menu.top': 'hudChrome.mobileHudEditor.surface.menuTop',
  'minimap.cluster': 'hudChrome.mobileHudEditor.surface.minimapCluster',
  'frame.target': 'hudChrome.mobileHudEditor.surface.frameTarget',
  'frame.player': 'hudChrome.mobileHudEditor.surface.framePlayer',
  'auras.player_buffs': 'hudChrome.mobileHudEditor.surface.playerBuffs',
  'auras.player_debuffs': 'hudChrome.mobileHudEditor.surface.playerDebuffs',
  'status.arena.generic': 'hudChrome.mobileHudEditor.surface.statusArenaGeneric',
  'status.arena.fiesta_score': 'hudChrome.mobileHudEditor.surface.statusFiestaScore',
  'status.arena.fiesta_pending': 'hudChrome.mobileHudEditor.surface.statusFiestaPending',
  'protected.arena.fiesta_respawn': 'hudChrome.mobileHudEditor.surface.protectedFiestaRespawn',
  'protected.arena.fiesta_offer': 'hudChrome.mobileHudEditor.surface.protectedFiestaOffer',
  'status.arena.yumi': 'hudChrome.mobileHudEditor.surface.statusYumi',
  'protected.arena.yumi_respawn': 'hudChrome.mobileHudEditor.surface.protectedYumiRespawn',
  'status.vale_cup.indicator': 'hudChrome.mobileHudEditor.surface.statusValeCupIndicator',
  'protected.vale_cup.briefing': 'hudChrome.mobileHudEditor.surface.protectedValeCupBriefing',
  'status.vale_cup.match': 'hudChrome.mobileHudEditor.surface.statusValeCupMatch',
  'status.vale_cup.charge': 'hudChrome.mobileHudEditor.surface.statusValeCupCharge',
  'protected.vale_cup.betting': 'hudChrome.mobileHudEditor.surface.protectedValeCupBetting',
  'tracker.delve': 'hudChrome.mobileHudEditor.surface.trackerDelve',
  'protected.system.center_message': 'hudChrome.mobileHudEditor.surface.protectedCenterMessage',
} as const satisfies Record<MobileHudSurfaceId, TranslationKey>;

const CONTEXT_LABEL_KEYS = {
  'world.base': 'hudChrome.mobileHudEditor.context.worldBase',
  'world.vale_cup_indicator': 'hudChrome.mobileHudEditor.context.worldValeCupIndicator',
  'arena.standard': 'hudChrome.mobileHudEditor.context.arenaStandard',
  'arena.fiesta.base': 'hudChrome.mobileHudEditor.context.arenaFiestaBase',
  'arena.fiesta.pending': 'hudChrome.mobileHudEditor.context.arenaFiestaPending',
  'arena.fiesta.respawn': 'hudChrome.mobileHudEditor.context.arenaFiestaRespawn',
  'arena.fiesta.offer': 'hudChrome.mobileHudEditor.context.arenaFiestaOffer',
  'arena.fiesta.respawn_offer': 'hudChrome.mobileHudEditor.context.arenaFiestaRespawnOffer',
  'arena.yumi.base': 'hudChrome.mobileHudEditor.context.arenaYumiBase',
  'arena.yumi.respawn': 'hudChrome.mobileHudEditor.context.arenaYumiRespawn',
  'arena.yumi.returning': 'hudChrome.mobileHudEditor.context.arenaYumiReturning',
  'vale_cup.briefing': 'hudChrome.mobileHudEditor.context.valeCupBriefing',
  'vale_cup.match': 'hudChrome.mobileHudEditor.context.valeCupMatch',
  'vale_cup.match.charge': 'hudChrome.mobileHudEditor.context.valeCupMatchCharge',
  'vale_cup.spectator.betting': 'hudChrome.mobileHudEditor.context.valeCupSpectatorBetting',
  'instance.delve': 'hudChrome.mobileHudEditor.context.instanceDelve',
} as const satisfies Record<MobileHudContextId, TranslationKey>;

const FAILURE_LABEL_KEYS = {
  'invalid-placement': 'hudChrome.mobileHudEditor.failure.invalidPlacement',
  'unsupported-capability': 'hudChrome.mobileHudEditor.failure.unsupportedCapability',
  'scale-out-of-range': 'hudChrome.mobileHudEditor.failure.scaleOutOfRange',
  'target-too-small': 'hudChrome.mobileHudEditor.failure.targetTooSmall',
  'out-of-bounds': 'hudChrome.mobileHudEditor.failure.outOfBounds',
  overlap: 'hudChrome.mobileHudEditor.failure.overlap',
  'view-intrusion': 'hudChrome.mobileHudEditor.failure.viewIntrusion',
  'protected-overlap': 'hudChrome.mobileHudEditor.failure.protectedOverlap',
} as const satisfies Record<MobileHudValidationFailure['reason'], TranslationKey>;

const EDITOR_TOUCH_TARGET_SIZE = 48;

interface MobileHudLivePseudoGeometry extends MobileHudPseudoGeometryBinding {
  element: HTMLElement;
}

function cssPixelValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cssBorderBoxSize(
  style: CSSStyleDeclaration,
  axis: 'width' | 'height',
): number | undefined {
  const size = cssPixelValue(style[axis]);
  if (size === undefined) return undefined;
  if (style.boxSizing === 'border-box') return size;
  if (axis === 'width') {
    return (
      size +
      (cssPixelValue(style.paddingLeft) ?? 0) +
      (cssPixelValue(style.paddingRight) ?? 0) +
      (cssPixelValue(style.borderLeftWidth) ?? 0) +
      (cssPixelValue(style.borderRightWidth) ?? 0)
    );
  }
  return (
    size +
    (cssPixelValue(style.paddingTop) ?? 0) +
    (cssPixelValue(style.paddingBottom) ?? 0) +
    (cssPixelValue(style.borderTopWidth) ?? 0) +
    (cssPixelValue(style.borderBottomWidth) ?? 0)
  );
}

function cssTransformMatrix(
  transform: string,
): readonly [number, number, number, number, number, number] | undefined {
  if (transform === 'none') return [1, 0, 0, 1, 0, 0];
  const matrix = /^matrix\(([^)]+)\)$/.exec(transform);
  if (matrix) {
    const values = matrix[1].split(',').map(Number);
    if (values.length === 6 && values.every(Number.isFinite)) {
      return values as unknown as readonly [number, number, number, number, number, number];
    }
  }
  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transform);
  if (matrix3d) {
    const values = matrix3d[1].split(',').map(Number);
    if (values.length === 16 && values.every(Number.isFinite)) {
      return [values[0], values[1], values[4], values[5], values[12], values[13]];
    }
  }
  return undefined;
}

type Translate = (
  key: TranslationKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

export interface MobileHudEditorDeps {
  document: Document;
  registry: MobileHudRegistry;
  canOpen(): boolean;
  getDocument(): MobileHudLayoutDocumentV1;
  getProfileId(): MobileHudProfileId;
  getSceneId(): MobileHudSceneId;
  getContextId(): MobileHudContextId;
  getGeometry(): MobileHudViewportGeometry;
  getHandedness(): 'left' | 'right';
  isSurfaceAvailable?(surfaceId: MobileHudSurfaceId): boolean;
  beginPreview(document: MobileHudLayoutDocumentV1): void;
  updatePreview(document: MobileHudLayoutDocumentV1): void;
  validateDraft?(document: MobileHudLayoutDocumentV1): readonly MobileHudValidationFailure[];
  validateCurrentDraft?(document: MobileHudLayoutDocumentV1): readonly MobileHudValidationFailure[];
  scheduleFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(handle: number): void;
  validationMatrix?: readonly MobileHudGeometryMatrixFixture[];
  storage: MobileHudLayoutStorage;
  commitValidatedDocument(document: MobileHudLayoutDocumentV1): void;
  endPreview(): void;
  focusManager: {
    open(options: {
      root(): HTMLElement | null;
      returnFocusTo?: HTMLElement | null;
    }): FocusTrapHandle;
  };
  confirmDiscard(
    copy: Readonly<Record<'title' | 'body' | 'confirm' | 'continueEditing', string>>,
  ): boolean;
  translate: Translate;
  onOpenChange(open: boolean): void;
}

interface MobileHudEditorDrag {
  surfaceId: MobileHudSurfaceId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTopLeft: { x: number; y: number };
  size: { width: number; height: number };
  geometry: MobileHudViewportGeometry;
  transform: MobileHudPreviewTransform;
}

interface MobileHudEditorPaletteDrag {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
}

function cloneLayoutDocument(document: MobileHudLayoutDocumentV1): MobileHudLayoutDocumentV1 {
  const profiles: MobileHudLayoutDocumentV1['profiles'] = {};
  for (const profileId of ['phone', 'tablet'] as const) {
    const source = document.profiles[profileId];
    if (!source) continue;
    const placements: Partial<
      Record<MobileHudSurfaceId, NonNullable<(typeof source)[MobileHudSurfaceId]>>
    > = {};
    for (const [surfaceId, placement] of Object.entries(source)) {
      if (placement) placements[surfaceId as MobileHudSurfaceId] = { ...placement };
    }
    profiles[profileId] = placements;
  }
  return { schemaVersion: 1, enabled: document.enabled, profiles };
}

export function mobileHudContextClass(contextId: MobileHudContextId): string {
  return `mobile-hud-context-${contextId.replaceAll('.', '-')}`;
}

export class MobileHudEditor {
  readonly #deps: MobileHudEditorDeps;
  #root: HTMLElement | null = null;
  #draft: MobileHudDraft | null = null;
  #opener: { focus(): void } | null = null;
  #focusTrap: FocusTrapHandle | null = null;
  #contextClass: string | null = null;
  #preview: HTMLElement | null = null;
  #contextSelector: HTMLSelectElement | null = null;
  #inspector: HTMLElement | null = null;
  #status: HTMLElement | null = null;
  #lockButton: HTMLButtonElement | null = null;
  #saveButton: HTMLButtonElement | null = null;
  readonly #proxies = new Map<MobileHudSurfaceId, HTMLElement>();
  readonly #liveVisualElements = new Map<MobileHudSurfaceId, Set<HTMLElement>>();
  readonly #liveGeometryElements = new Map<MobileHudSurfaceId, Set<HTMLElement>>();
  readonly #livePseudoGeometry = new Map<
    MobileHudSurfaceId,
    readonly MobileHudLivePseudoGeometry[]
  >();
  #drag: MobileHudEditorDrag | null = null;
  #paletteDrag: MobileHudEditorPaletteDrag | null = null;
  #pendingDragAction: Parameters<typeof reduceMobileHudDraft>[1] | null = null;
  #dragFrame: number | null = null;
  #liveTreeObserver: MutationObserver | null = null;
  #liveStateObserver: MutationObserver | null = null;
  #liveGeometryFrame: number | null = null;
  readonly #inertRoots = new Map<HTMLElement, boolean>();
  #centerMessageHome: { element: HTMLElement; parent: Node; nextSibling: ChildNode | null } | null =
    null;
  #previewEnded = true;
  #saving = false;

  #portalCenterMessage(): void {
    const element = this.#deps.document.querySelectorAll<HTMLElement>('#banner')[0];
    const parent = element?.parentNode;
    if (!element || !parent || parent === this.#deps.document.body) return;
    this.#centerMessageHome = { element, parent, nextSibling: element.nextSibling };
    this.#deps.document.body.append(element);
  }

  #restoreCenterMessage(): void {
    const home = this.#centerMessageHome;
    this.#centerMessageHome = null;
    if (!home) return;
    if (home.nextSibling?.parentNode === home.parent) {
      home.parent.insertBefore(home.element, home.nextSibling);
    } else {
      home.parent.appendChild(home.element);
    }
  }

  #setLiveHudInert(): void {
    this.#restoreLiveHudInert();
    for (const selector of ['#ui', '#mobile-controls']) {
      for (const element of this.#deps.document.querySelectorAll<HTMLElement>(selector)) {
        this.#inertRoots.set(element, element.inert);
        element.inert = true;
      }
    }
  }

  #restoreLiveHudInert(): void {
    for (const [element, inert] of this.#inertRoots) element.inert = inert;
    this.#inertRoots.clear();
  }

  #endPreviewOnce(): void {
    if (this.#previewEnded) return;
    this.#previewEnded = true;
    this.#deps.endPreview();
  }

  #isSurfaceAvailable(surfaceId: MobileHudSurfaceId): boolean {
    return this.#deps.isSurfaceAvailable?.(surfaceId) ?? true;
  }

  #isSurfaceVisible(descriptor: MobileHudSurfaceDescriptor): boolean {
    return (
      this.#isSurfaceAvailable(descriptor.id) &&
      descriptor.visibleIn.includes(this.#draft?.contextId ?? this.#deps.getContextId())
    );
  }

  #hasRenderableLiveVisual(
    descriptor: MobileHudSurfaceDescriptor,
    elements: ReadonlySet<HTMLElement>,
    pseudoGeometry: readonly MobileHudLivePseudoGeometry[],
  ): boolean {
    if (descriptor.binding?.editorVisibility === 'force-existing-root') return elements.size > 0;
    for (const element of elements) {
      const view = element.ownerDocument?.defaultView;
      if (!view) return true;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        return true;
      }
    }
    for (const source of pseudoGeometry) {
      if (this.#pseudoGeometryRect(source)) return true;
    }
    return false;
  }

  #pseudoGeometryRect(source: MobileHudLivePseudoGeometry): MobileHudRect | undefined {
    const view = source.element.ownerDocument?.defaultView;
    if (!view) return undefined;
    const hostRect = source.element.getBoundingClientRect();
    const hostWidth = source.element.offsetWidth;
    const hostHeight = source.element.offsetHeight;
    if (hostRect.width <= 0 || hostRect.height <= 0 || hostWidth <= 0 || hostHeight <= 0) {
      return undefined;
    }
    const style = view.getComputedStyle(source.element, source.pseudo);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.content === 'none' ||
      style.content === 'normal'
    ) {
      return undefined;
    }
    const width = cssBorderBoxSize(style, 'width');
    const height = cssBorderBoxSize(style, 'height');
    const matrix = cssTransformMatrix(style.transform);
    if (!width || !height || !matrix) return undefined;
    const right = cssPixelValue(style.right);
    const bottom = cssPixelValue(style.bottom);
    const left =
      cssPixelValue(style.left) ?? (right === undefined ? undefined : hostWidth - right - width);
    const top =
      cssPixelValue(style.top) ?? (bottom === undefined ? undefined : hostHeight - bottom - height);
    if (left === undefined || top === undefined) return undefined;
    const [a, b, c, d, e, f] = matrix;
    const origins = style.transformOrigin.split(/\s+/).map(cssPixelValue);
    const originX = origins[0] ?? width / 2;
    const originY = origins[1] ?? height / 2;
    const points = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ] as const;
    const transformed = points.map(([x, y]) => ({
      x: left + originX + a * (x - originX) + c * (y - originY) + e,
      y: top + originY + b * (x - originX) + d * (y - originY) + f,
    }));
    const minimumX = Math.min(...transformed.map((point) => point.x));
    const maximumX = Math.max(...transformed.map((point) => point.x));
    const minimumY = Math.min(...transformed.map((point) => point.y));
    const maximumY = Math.max(...transformed.map((point) => point.y));
    const scaleX = hostRect.width / hostWidth;
    const scaleY = hostRect.height / hostHeight;
    return {
      x: hostRect.x + minimumX * scaleX,
      y: hostRect.y + minimumY * scaleY,
      width: (maximumX - minimumX) * scaleX,
      height: (maximumY - minimumY) * scaleY,
    };
  }

  #liveVisualRect(surfaceId: MobileHudSurfaceId): MobileHudRect | undefined {
    const elements = this.#liveGeometryElements.get(surfaceId);
    const pseudoGeometry = this.#livePseudoGeometry.get(surfaceId) ?? [];
    if (!elements && pseudoGeometry.length === 0) return undefined;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    const includeRect = (rect: MobileHudRect): void => {
      if (rect.width <= 0 || rect.height <= 0) return;
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    };
    for (const element of elements ?? []) {
      const view = element.ownerDocument?.defaultView;
      if (view) {
        const style = view.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
      }
      const rect = element.getBoundingClientRect();
      includeRect(rect);
    }
    for (const source of pseudoGeometry) {
      const rect = this.#pseudoGeometryRect(source);
      if (rect) includeRect(rect);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return undefined;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  #clearLiveVisualState(): void {
    for (const elements of this.#liveVisualElements.values()) {
      for (const element of elements) {
        element.removeAttribute('data-mobile-hud-editor-visual');
        element.removeAttribute('data-mobile-hud-editor-state');
        element.removeAttribute('data-mobile-hud-editor-hidden');
      }
    }
    this.#liveVisualElements.clear();
    this.#liveGeometryElements.clear();
    this.#livePseudoGeometry.clear();
  }

  #scheduleLiveGeometryRefresh(): void {
    if (!this.#draft || !this.#preview || this.#liveGeometryFrame !== null) return;
    const view = this.#deps.document.defaultView;
    const schedule = this.#deps.scheduleFrame ?? view?.requestAnimationFrame.bind(view);
    const refresh = () => {
      this.#liveGeometryFrame = null;
      if (!this.#draft || !this.#preview) return;
      this.#syncLiveVisualState();
      this.#observeLiveStateRoots();
      this.#positionProxies();
    };
    if (!schedule) {
      refresh();
      return;
    }
    this.#liveGeometryFrame = schedule(refresh);
  }

  #observeLiveStateRoots(): void {
    this.#liveStateObserver?.disconnect();
    this.#liveTreeObserver?.disconnect();
    const MutationObserverCtor = this.#deps.document.defaultView?.MutationObserver;
    if (!MutationObserverCtor || !this.#draft) return;
    const roots = new Set<HTMLElement>();
    for (const descriptor of this.#deps.registry.descriptors) {
      const binding = descriptor.binding;
      if (!binding) continue;
      for (const selector of [binding.rootSelector, ...(binding.dependentRootSelectors ?? [])]) {
        for (const root of this.#deps.document.querySelectorAll<HTMLElement>(selector)) {
          roots.add(root);
        }
      }
    }
    const geometryTargets = new Set<HTMLElement>(roots);
    for (const elements of this.#liveGeometryElements.values()) {
      for (const element of elements) geometryTargets.add(element);
    }
    const hasElementChange = (record: MutationRecord): boolean =>
      record.type === 'childList' &&
      [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1);
    this.#liveStateObserver = new MutationObserverCtor((records) => {
      if (
        this.#drag ||
        !records.some(
          (record) =>
            hasElementChange(record) ||
            (record.type === 'attributes' &&
              (record.target === this.#deps.document.body ||
                geometryTargets.has(record.target as HTMLElement))),
        )
      ) {
        return;
      }
      this.#scheduleLiveGeometryRefresh();
    });
    this.#liveTreeObserver = new MutationObserverCtor((records) => {
      if (this.#drag || !records.some(hasElementChange)) return;
      this.#scheduleLiveGeometryRefresh();
    });
    this.#liveStateObserver.observe(this.#deps.document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
    const parents = new Set<HTMLElement>();
    for (const root of roots) {
      this.#liveStateObserver.observe(root, {
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style'],
        childList: true,
        subtree: true,
      });
      if (root.parentElement) parents.add(root.parentElement);
    }
    for (const parent of parents) {
      this.#liveTreeObserver.observe(parent, { childList: true });
    }
  }

  #observeLiveGeometry(): void {
    this.#disconnectLiveGeometryObservers();
    this.#observeLiveStateRoots();
  }

  #disconnectLiveGeometryObservers(): void {
    this.#liveTreeObserver?.disconnect();
    this.#liveTreeObserver = null;
    this.#liveStateObserver?.disconnect();
    this.#liveStateObserver = null;
    if (this.#liveGeometryFrame !== null) {
      const view = this.#deps.document.defaultView;
      const cancel = this.#deps.cancelFrame ?? view?.cancelAnimationFrame.bind(view);
      cancel?.(this.#liveGeometryFrame);
      this.#liveGeometryFrame = null;
    }
  }

  #syncLiveVisualState(): void {
    this.#clearLiveVisualState();
    if (!this.#draft) return;
    for (const proxy of this.#proxies.values()) {
      proxy.setAttribute('data-mobile-hud-live-visual', 'false');
    }
    for (const descriptor of this.#deps.registry.descriptors) {
      if (!this.#isSurfaceAvailable(descriptor.id)) continue;
      const binding = descriptor.binding;
      if (!binding || binding.editorVisibility === 'ghost-only') continue;
      const selectors = binding.editorVisualSelectors ?? [binding.rootSelector];
      const elements = new Set<HTMLElement>();
      for (const selector of selectors) {
        for (const element of this.#deps.document.querySelectorAll<HTMLElement>(selector)) {
          elements.add(element);
        }
      }
      if (elements.size === 0) continue;
      this.#liveVisualElements.set(descriptor.id, elements);
      const geometryElements = new Set<HTMLElement>();
      for (const selector of binding.editorGeometrySelectors ?? selectors) {
        for (const element of this.#deps.document.querySelectorAll<HTMLElement>(selector)) {
          geometryElements.add(element);
        }
      }
      this.#liveGeometryElements.set(descriptor.id, geometryElements);
      const pseudoGeometry = (binding.editorPseudoGeometry ?? []).flatMap((entry) =>
        [...this.#deps.document.querySelectorAll<HTMLElement>(entry.selector)].map((element) => ({
          ...entry,
          element,
        })),
      );
      this.#livePseudoGeometry.set(descriptor.id, pseudoGeometry);
      const visible = descriptor.visibleIn.includes(this.#draft.contextId);
      const selected = descriptor.id === this.#draft.selectedSurfaceId;
      const proxy = this.#proxies.get(descriptor.id);
      proxy?.setAttribute(
        'data-mobile-hud-live-visual',
        String(
          visible && this.#hasRenderableLiveVisual(descriptor, geometryElements, pseudoGeometry),
        ),
      );
      for (const element of elements) {
        element.setAttribute('data-mobile-hud-editor-visual', descriptor.id);
        element.setAttribute('data-mobile-hud-editor-state', selected ? 'selected' : 'unselected');
        if (!visible) element.setAttribute('data-mobile-hud-editor-hidden', 'true');
      }
    }
  }

  #syncLiveVisualSelection(): void {
    if (!this.#draft) return;
    for (const [surfaceId, elements] of this.#liveVisualElements) {
      const selected = surfaceId === this.#draft.selectedSurfaceId;
      for (const element of elements) {
        element.setAttribute('data-mobile-hud-editor-state', selected ? 'selected' : 'unselected');
      }
    }
  }

  #renderPreview(preview: HTMLElement): void {
    if (!this.#draft) return;
    preview.replaceChildren();
    this.#proxies.clear();
    for (const descriptor of this.#deps.registry.descriptors) {
      if (!this.#isSurfaceVisible(descriptor)) continue;
      const proxy = this.#deps.document.createElement(
        descriptor.class === 'movable' ? 'button' : 'div',
      );
      proxy.classList.add('mobile-hud-editor-proxy', `mobile-hud-editor-${descriptor.class}`);
      proxy.setAttribute('data-mobile-hud-surface-id', descriptor.id);
      proxy.setAttribute('data-mobile-hud-surface-class', descriptor.class);
      if (descriptor.overlapPolicy) {
        proxy.setAttribute('data-mobile-hud-overlap-policy', descriptor.overlapPolicy);
      }
      if (descriptor.binding?.editorPlaceholderWhenEmpty) {
        proxy.setAttribute('data-mobile-hud-placeholder', 'when-empty');
      }
      const translatedLabel = this.#deps.translate(SURFACE_LABEL_KEYS[descriptor.id]);
      proxy.setAttribute('aria-label', translatedLabel);
      const label = this.#deps.document.createElement('span');
      label.classList.add('mobile-hud-editor-proxy-label');
      label.textContent = translatedLabel;
      const error = this.#deps.document.createElement('span');
      error.classList.add('mobile-hud-editor-proxy-error');
      const frame = this.#deps.document.createElement('span');
      frame.classList.add('mobile-hud-editor-proxy-frame');
      frame.setAttribute('aria-hidden', 'true');
      frame.append(label, error);
      proxy.append(frame);
      if (descriptor.class === 'movable') {
        (proxy as HTMLButtonElement).type = 'button';
        proxy.tabIndex = this.#draft.locked ? -1 : 0;
        proxy.setAttribute('aria-disabled', this.#draft.locked ? 'true' : 'false');
        proxy.setAttribute('aria-pressed', String(descriptor.id === this.#draft.selectedSurfaceId));
        proxy.addEventListener('click', () => this.selectSurface(descriptor.id));
        proxy.addEventListener('pointerdown', (event) =>
          this.#startDrag(proxy, descriptor.id, event as PointerEvent),
        );
        proxy.addEventListener('pointermove', (event) => this.#moveDrag(event as PointerEvent));
        proxy.addEventListener('pointerup', (event) =>
          this.#endDrag(proxy, (event as PointerEvent).pointerId),
        );
        proxy.addEventListener('pointercancel', (event) =>
          this.#endDrag(proxy, (event as PointerEvent).pointerId),
        );
        proxy.addEventListener('keydown', (event) => {
          if (!this.#draft || this.#draft.locked) return;
          const delta =
            (event as KeyboardEvent).key === 'ArrowUp'
              ? { deltaX: 0, deltaY: -1 }
              : (event as KeyboardEvent).key === 'ArrowDown'
                ? { deltaX: 0, deltaY: 1 }
                : (event as KeyboardEvent).key === 'ArrowLeft'
                  ? { deltaX: -1, deltaY: 0 }
                  : (event as KeyboardEvent).key === 'ArrowRight'
                    ? { deltaX: 1, deltaY: 0 }
                    : null;
          if (!delta) return;
          event.preventDefault();
          event.stopPropagation();
          this.selectSurface(descriptor.id);
          this.#applyDraftEdit({
            type: 'nudge-selected',
            ...delta,
            handedness: this.#deps.getHandedness(),
          });
        });
      } else {
        proxy.setAttribute('role', 'note');
        proxy.setAttribute('aria-disabled', 'true');
      }
      this.#proxies.set(descriptor.id, proxy);
      preview.append(proxy);
    }
    this.#syncLiveVisualState();
    this.#syncProxySelection();
    this.#renderValidation();
  }

  #computeFailures(scope: 'current' | 'matrix' = 'matrix'): readonly MobileHudValidationFailure[] {
    if (!this.#draft) return [];
    if (scope === 'current' && this.#deps.validateCurrentDraft) {
      return this.#deps.validateCurrentDraft(this.#draft.document);
    }
    if (scope === 'matrix' && this.#deps.validateDraft) {
      return this.#deps.validateDraft(this.#draft.document);
    }
    const current = validateMobileHudContext({
      registry: this.#deps.registry,
      profileId: this.#draft.activeProfileId,
      placements: this.#draft.document.profiles[this.#draft.activeProfileId] ?? {},
      baselinePlacements: this.#deps.registry.defaults[this.#draft.activeProfileId],
      geometry: this.#deps.getGeometry(),
      contextId: this.#draft.contextId,
      isSurfaceAvailable: (surfaceId) => this.#isSurfaceAvailable(surfaceId),
    });
    if (scope === 'current') return current;
    const matrix = validateMobileHudLayoutMatrix({
      registry: this.#deps.registry,
      profiles: this.#draft.document.profiles,
      baselineProfiles: this.#deps.registry.defaults,
      isSurfaceAvailable: (surfaceId) => this.#isSurfaceAvailable(surfaceId),
    });
    const failures: MobileHudValidationFailure[] = [];
    const seen = new Set<string>();
    for (const failure of [...current, ...matrix]) {
      const key = JSON.stringify(failure);
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(failure);
    }
    return Object.freeze(failures);
  }

  #revalidate(scope: 'current' | 'matrix' = 'matrix', focusFailure = false): void {
    if (!this.#draft) return;
    const failures = this.#computeFailures(scope);
    let contextId = this.#draft.contextId;
    let sceneId = this.#draft.sceneId;
    let activeFailureIndex =
      this.#draft.activeFailureIndex !== null && this.#draft.activeFailureIndex < failures.length
        ? this.#draft.activeFailureIndex
        : null;
    if (focusFailure && failures.length > 0) {
      const currentContextFailureIndex = failures.findIndex(
        (failure) =>
          failure.profileId === this.#draft?.activeProfileId &&
          failure.contextId === this.#draft?.contextId,
      );
      activeFailureIndex = currentContextFailureIndex >= 0 ? currentContextFailureIndex : 0;
      const activeFailure = failures[activeFailureIndex];
      contextId = resolveMobileHudEditorContext(activeFailure.contextId);
      sceneId = MOBILE_HUD_CONTEXTS.find((context) => context.id === contextId)?.sceneId ?? sceneId;
    }
    this.#draft = {
      ...this.#draft,
      failures,
      contextId,
      sceneId,
      activeFailureIndex,
    };
  }

  #renderValidation(): void {
    if (!this.#draft) return;
    const visibleFailures = this.#draft.failures.filter(
      (failure) =>
        failure.profileId === this.#draft?.activeProfileId &&
        failure.contextId === this.#draft?.contextId,
    );
    const invalidSurfaceIds = new Set(
      visibleFailures.flatMap((failure) => [...failure.surfaceIds]),
    );
    for (const [surfaceId, proxy] of this.#proxies) {
      const invalid = invalidSurfaceIds.has(surfaceId);
      if (invalid) {
        proxy.classList.add('is-invalid');
        proxy.setAttribute('aria-invalid', 'true');
      } else {
        proxy.classList.remove('is-invalid');
        proxy.removeAttribute('aria-invalid');
      }
      const error = proxy.querySelector<HTMLElement>('.mobile-hud-editor-proxy-error');
      const surfaceFailure = visibleFailures.find((failure) =>
        failure.surfaceIds.includes(surfaceId),
      );
      if (error)
        error.textContent = surfaceFailure ? this.#failureMessage(surfaceFailure, surfaceId) : '';
    }
    if (this.#saveButton) {
      const disabled = this.#draft.failures.length > 0;
      this.#saveButton.disabled = disabled;
      this.#saveButton.setAttribute('aria-disabled', String(disabled));
    }
    if (this.#preview) {
      if (visibleFailures.length > 0) {
        this.#preview.classList.add('is-failing-preview');
      } else {
        this.#preview.classList.remove('is-failing-preview');
      }
    }
    if (this.#status) {
      if (this.#draft.failures.length > 0) {
        this.#status.classList.add('is-invalid');
        const activeFailure =
          this.#draft.activeFailureIndex === null
            ? undefined
            : this.#draft.failures[this.#draft.activeFailureIndex];
        const firstFailure = activeFailure ?? visibleFailures[0] ?? this.#draft.failures[0];
        const message = this.#failureMessage(firstFailure, firstFailure.surfaceIds[0]);
        const context = this.#deps.translate(CONTEXT_LABEL_KEYS[firstFailure.contextId]);
        this.#status.textContent = firstFailure.viewportId
          ? this.#deps.translate('hudChrome.mobileHudEditor.failureWithFixture', {
              message,
              context,
              profile: this.#deps.translate(
                firstFailure.profileId === 'tablet'
                  ? 'hudChrome.mobileHudEditor.profileTablet'
                  : 'hudChrome.mobileHudEditor.profilePhone',
              ),
              viewport: [firstFailure.viewportId, firstFailure.safeAreaFixtureId]
                .filter((value): value is string => Boolean(value))
                .join(' / '),
            })
          : firstFailure.contextId === this.#draft.contextId
            ? message
            : this.#deps.translate('hudChrome.mobileHudEditor.failureWithContext', {
                message,
                context,
              });
      } else {
        this.#status.classList.remove('is-invalid');
      }
    }
  }

  #failureMessage(failure: MobileHudValidationFailure, surfaceId: MobileHudSurfaceId): string {
    const subjectId =
      failure.reason === 'view-intrusion'
        ? (failure.surfaceIds.find((id) => id !== 'control.view') ?? surfaceId)
        : surfaceId;
    const otherId = failure.surfaceIds.find((id) => id !== subjectId);
    return this.#deps.translate(FAILURE_LABEL_KEYS[failure.reason], {
      surface: this.#deps.translate(SURFACE_LABEL_KEYS[subjectId]),
      other: otherId ? this.#deps.translate(SURFACE_LABEL_KEYS[otherId]) : '',
    });
  }

  #activeGeometry(): MobileHudViewportGeometry {
    return this.#deps.getGeometry();
  }

  #usesPhysicalPreviewGeometry(geometry: MobileHudViewportGeometry): boolean {
    if (!this.#draft || this.#draft.activeProfileId !== this.#deps.getProfileId()) return false;
    const physical = this.#deps.getGeometry();
    return (
      geometry.width === physical.width &&
      geometry.height === physical.height &&
      geometry.visualOffsetX === physical.visualOffsetX &&
      geometry.visualOffsetY === physical.visualOffsetY &&
      geometry.safeAreaInsets.top === physical.safeAreaInsets.top &&
      geometry.safeAreaInsets.right === physical.safeAreaInsets.right &&
      geometry.safeAreaInsets.bottom === physical.safeAreaInsets.bottom &&
      geometry.safeAreaInsets.left === physical.safeAreaInsets.left
    );
  }

  #syncProxySelection(): void {
    if (!this.#draft) return;
    for (const [surfaceId, proxy] of this.#proxies) {
      const selected = surfaceId === this.#draft.selectedSurfaceId;
      if (selected) proxy.classList.add('is-selected');
      else proxy.classList.remove('is-selected');
      if (proxy.getAttribute('data-mobile-hud-surface-class') === 'movable') {
        proxy.tabIndex = this.#draft.locked ? -1 : 0;
        proxy.setAttribute('aria-pressed', String(selected));
        proxy.setAttribute('aria-disabled', String(this.#draft.locked));
      }
    }
    this.#syncLiveVisualSelection();
  }

  #positionProxies(): void {
    if (!this.#draft || !this.#preview) return;
    const previewRect = this.#preview.getBoundingClientRect();
    if (previewRect.width <= 0 || previewRect.height <= 0) return;
    const geometry = this.#activeGeometry();
    const transform = createMobileHudPreviewTransform(geometry, previewRect);
    const useLiveGeometry = this.#usesPhysicalPreviewGeometry(geometry);
    for (const descriptor of this.#deps.registry.descriptors) {
      const proxy = this.#proxies.get(descriptor.id);
      if (!proxy || !this.#isSurfaceVisible(descriptor)) continue;
      let rect: MobileHudRect | undefined;
      if (descriptor.class === 'protected') {
        rect = descriptor.protectedFootprint?.(geometry);
      } else {
        const canonical =
          this.#draft.document.profiles[this.#draft.activeProfileId]?.[descriptor.id];
        if (!canonical) continue;
        const displayed =
          this.#deps.getHandedness() === 'left'
            ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
            : canonical;
        const resolved = resolveMobileHudSurfaceGeometry(
          descriptor,
          this.#draft.activeProfileId,
          displayed,
          geometry,
          this.#draft.contextId,
        );
        const liveRect =
          useLiveGeometry && proxy.getAttribute('data-mobile-hud-live-visual') === 'true'
            ? this.#liveVisualRect(descriptor.id)
            : undefined;
        rect =
          liveRect ??
          (descriptor.binding?.editorPlaceholderUsesLayoutFootprint &&
          proxy.getAttribute('data-mobile-hud-live-visual') === 'false' &&
          !descriptor.editorFallbackFootprint
            ? resolved.canonicalRect
            : resolved.editorFallbackRect);
      }
      if (!rect) continue;
      const point = mapMobileHudVisualPointToPreview({ x: rect.x, y: rect.y }, transform);
      const visualWidth = rect.width * transform.scale;
      const visualHeight = rect.height * transform.scale;
      const hitWidth =
        descriptor.class === 'movable'
          ? Math.max(EDITOR_TOUCH_TARGET_SIZE, visualWidth)
          : visualWidth;
      const hitHeight =
        descriptor.class === 'movable'
          ? Math.max(EDITOR_TOUCH_TARGET_SIZE, visualHeight)
          : visualHeight;
      const desiredHitLeft = point.x - (hitWidth - visualWidth) / 2;
      const desiredHitTop = point.y - (hitHeight - visualHeight) / 2;
      const hitLeft = Math.min(
        previewRect.x + previewRect.width - hitWidth,
        Math.max(previewRect.x, desiredHitLeft),
      );
      const hitTop = Math.min(
        previewRect.y + previewRect.height - hitHeight,
        Math.max(previewRect.y, desiredHitTop),
      );
      proxy.style.left = `${hitLeft - previewRect.x}px`;
      proxy.style.top = `${hitTop - previewRect.y}px`;
      proxy.style.width = `${hitWidth}px`;
      proxy.style.height = `${hitHeight}px`;
      const frame = proxy.querySelector<HTMLElement>('.mobile-hud-editor-proxy-frame');
      if (frame) {
        frame.style.left = `${point.x - hitLeft}px`;
        frame.style.top = `${point.y - hitTop}px`;
        frame.style.width = `${visualWidth}px`;
        frame.style.height = `${visualHeight}px`;
      }
    }
  }

  #startDrag(proxy: HTMLElement, surfaceId: MobileHudSurfaceId, event: PointerEvent): void {
    if (!this.#draft || this.#draft.locked || !this.#preview) return;
    this.#positionProxies();
    this.selectSurface(surfaceId);
    if (this.#draft.selectedSurfaceId !== surfaceId) return;
    const descriptor = this.#deps.registry.getDescriptor(surfaceId);
    const canonical = this.#draft.document.profiles[this.#draft.activeProfileId]?.[surfaceId];
    if (descriptor?.class !== 'movable' || !canonical) return;
    const geometry = this.#activeGeometry();
    const displayed =
      this.#deps.getHandedness() === 'left'
        ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
        : canonical;
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor,
      this.#draft.activeProfileId,
      displayed,
      geometry,
      this.#draft.contextId,
    );
    const previewRect = this.#preview.getBoundingClientRect();
    if (previewRect.width <= 0 || previewRect.height <= 0) return;
    event.preventDefault();
    proxy.setPointerCapture(event.pointerId);
    this.#drag = {
      surfaceId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTopLeft: { x: resolved.canonicalRect.x, y: resolved.canonicalRect.y },
      size: resolved.scaledSize,
      geometry,
      transform: createMobileHudPreviewTransform(geometry, previewRect),
    };
  }

  #moveDrag(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = mapMobileHudPreviewDeltaToCanonical(
      { x: event.clientX - drag.startClientX, y: event.clientY - drag.startClientY },
      drag.transform,
    );
    this.#scheduleDragEdit({
      type: 'move-selected',
      topLeft: { x: drag.startTopLeft.x + delta.x, y: drag.startTopLeft.y + delta.y },
      size: drag.size,
      geometry: drag.geometry,
      handedness: this.#deps.getHandedness(),
    });
  }

  #endDrag(proxy: HTMLElement, pointerId: number): void {
    if (!this.#drag || this.#drag.pointerId !== pointerId) return;
    this.#flushPendingDragEdit();
    if (proxy.hasPointerCapture(pointerId)) proxy.releasePointerCapture(pointerId);
    this.#drag = null;
    const previousContextId = this.#draft?.contextId;
    this.#revalidate('matrix', true);
    if (this.#draft && previousContextId !== this.#draft.contextId) {
      if (this.#contextClass) this.#deps.document.body.classList.remove(this.#contextClass);
      this.#contextClass = mobileHudContextClass(this.#draft.contextId);
      this.#deps.document.body.classList.add(this.#contextClass);
      this.#renderSelectors();
      if (this.#preview) this.#renderPreview(this.#preview);
      this.#positionProxies();
    }
    this.#renderInspector();
    this.#renderValidation();
  }

  #scheduleDragEdit(action: Parameters<typeof reduceMobileHudDraft>[1]): void {
    this.#pendingDragAction = action;
    if (this.#dragFrame !== null) return;
    const view = this.#deps.document.defaultView;
    const schedule = this.#deps.scheduleFrame ?? view?.requestAnimationFrame.bind(view);
    if (!schedule) {
      this.#flushPendingDragEdit();
      return;
    }
    this.#dragFrame = schedule(() => {
      this.#dragFrame = null;
      const pending = this.#pendingDragAction;
      this.#pendingDragAction = null;
      if (pending) this.#applyDraftEdit(pending);
    });
  }

  #flushPendingDragEdit(): void {
    if (this.#dragFrame !== null) {
      const view = this.#deps.document.defaultView;
      const cancel = this.#deps.cancelFrame ?? view?.cancelAnimationFrame.bind(view);
      cancel?.(this.#dragFrame);
      this.#dragFrame = null;
    }
    const pending = this.#pendingDragAction;
    this.#pendingDragAction = null;
    if (pending) this.#applyDraftEdit(pending);
  }

  #applyDraftEdit(action: Parameters<typeof reduceMobileHudDraft>[1]): void {
    if (!this.#draft) return;
    const previousContextId = this.#draft.contextId;
    const previousProfileId = this.#draft.activeProfileId;
    const previousFailureIndex = this.#draft.activeFailureIndex;
    const next = reduceMobileHudDraft(this.#draft, action, this.#deps);
    if (next === this.#draft) return;
    const documentChanged = next.document !== this.#draft.document;
    this.#draft = next;
    const scope = action.type === 'move-selected' && this.#drag ? 'current' : 'matrix';
    this.#revalidate(scope, scope === 'matrix');
    const presentationChanged =
      previousContextId !== this.#draft.contextId ||
      previousProfileId !== this.#draft.activeProfileId ||
      previousFailureIndex !== this.#draft.activeFailureIndex;
    if (presentationChanged) {
      if (this.#contextClass) this.#deps.document.body.classList.remove(this.#contextClass);
      this.#contextClass = mobileHudContextClass(this.#draft.contextId);
      this.#deps.document.body.classList.add(this.#contextClass);
      this.#renderSelectors();
      if (this.#preview) this.#renderPreview(this.#preview);
    }
    if (documentChanged) this.#deps.updatePreview(this.#draft.document);
    this.#syncProxySelection();
    this.#renderInspector();
    this.#renderValidation();
    if (documentChanged) {
      this.#positionProxies();
    }
  }

  #renderSelectors(): void {
    if (!this.#draft || !this.#contextSelector) return;
    this.#contextSelector.replaceChildren();
    for (const context of MOBILE_HUD_EDITOR_CONTEXTS) {
      const option = this.#deps.document.createElement('option');
      option.textContent = this.#deps.translate(CONTEXT_LABEL_KEYS[context.id]);
      option.setAttribute('value', context.id);
      option.setAttribute('data-mobile-hud-context-id', context.id);
      this.#contextSelector.append(option);
    }
    this.#contextSelector.value = this.#draft.contextId;
  }

  #appendInspectorControl(
    controlId: string,
    labelKey: TranslationKey,
    inspector: HTMLElement,
    action: Parameters<typeof reduceMobileHudDraft>[1],
    visibleLabel?: string,
  ): void {
    const button = this.#deps.document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-mobile-hud-control', controlId);
    const label = this.#deps.translate(labelKey);
    button.textContent = visibleLabel ?? label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => this.#applyDraftEdit(action));
    inspector.append(button);
  }

  #renderInspector(): void {
    if (!this.#draft || !this.#inspector || !this.#status) return;
    this.#inspector.replaceChildren();
    const descriptor = this.#draft.selectedSurfaceId
      ? this.#deps.registry.getDescriptor(this.#draft.selectedSurfaceId)
      : undefined;
    if (descriptor?.class !== 'movable') {
      this.#status.textContent = this.#deps.translate(
        'hudChrome.mobileHudEditor.status.noSelection',
      );
      return;
    }

    if (descriptor.capabilities.includes('scale')) {
      this.#appendInspectorControl(
        'scale-decrease',
        'hudChrome.mobileHudEditor.control.decreaseScale',
        this.#inspector,
        { type: 'scale-selected', steps: -1, handedness: this.#deps.getHandedness() },
        '−',
      );
      this.#appendInspectorControl(
        'scale-increase',
        'hudChrome.mobileHudEditor.control.increaseScale',
        this.#inspector,
        { type: 'scale-selected', steps: 1, handedness: this.#deps.getHandedness() },
        '+',
      );
    }
    this.#appendInspectorControl(
      'reset-selected',
      'hudChrome.mobileHudEditor.control.resetSelected',
      this.#inspector,
      { type: 'reset-selected' },
    );
    this.#appendInspectorControl(
      'reset-all',
      'hudChrome.mobileHudEditor.control.resetAll',
      this.#inspector,
      { type: 'reset-all' },
    );
    this.#status.textContent = this.#deps.translate('hudChrome.mobileHudEditor.status.selected', {
      surface: this.#deps.translate(SURFACE_LABEL_KEYS[descriptor.id]),
    });
  }

  #startPaletteDrag(palette: HTMLElement, handle: HTMLElement, event: PointerEvent): void {
    const rect = palette.getBoundingClientRect();
    this.#paletteDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.x,
      startTop: rect.y,
      width: rect.width,
      height: rect.height,
    };
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
  }

  #movePaletteDrag(palette: HTMLElement, event: PointerEvent): void {
    const drag = this.#paletteDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const geometry = this.#deps.getGeometry();
    const edge = 8;
    const minLeft = geometry.safeAreaInsets.left + edge;
    const minTop = geometry.safeAreaInsets.top + edge;
    const maxLeft = Math.max(
      minLeft,
      geometry.width - geometry.safeAreaInsets.right - edge - drag.width,
    );
    const maxTop = Math.max(
      minTop,
      geometry.height - geometry.safeAreaInsets.bottom - edge - drag.height,
    );
    palette.style.left = `${Math.min(maxLeft, Math.max(minLeft, drag.startLeft + event.clientX - drag.startClientX))}px`;
    palette.style.top = `${Math.min(maxTop, Math.max(minTop, drag.startTop + event.clientY - drag.startClientY))}px`;
    palette.style.translate = '0 0';
    event.preventDefault();
  }

  #movePaletteWithKeyboard(palette: HTMLElement, event: KeyboardEvent): void {
    if (event.key === 'Home') {
      palette.style.left = '50%';
      palette.style.top = 'calc(50% - 16px)';
      palette.style.translate = '-50% -50%';
      event.preventDefault();
      return;
    }
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -10, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: 10, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -10 }
            : event.key === 'ArrowDown'
              ? { x: 0, y: 10 }
              : null;
    if (!delta) return;
    const rect = palette.getBoundingClientRect();
    const geometry = this.#deps.getGeometry();
    const edge = 8;
    const minLeft = geometry.safeAreaInsets.left + edge;
    const minTop = geometry.safeAreaInsets.top + edge;
    const maxLeft = Math.max(
      minLeft,
      geometry.width - geometry.safeAreaInsets.right - edge - rect.width,
    );
    const maxTop = Math.max(
      minTop,
      geometry.height - geometry.safeAreaInsets.bottom - edge - rect.height,
    );
    palette.style.left = `${Math.min(maxLeft, Math.max(minLeft, rect.x + delta.x))}px`;
    palette.style.top = `${Math.min(maxTop, Math.max(minTop, rect.y + delta.y))}px`;
    palette.style.translate = '0 0';
    event.preventDefault();
  }

  #endPaletteDrag(handle: HTMLElement, pointerId: number): void {
    if (!this.#paletteDrag || this.#paletteDrag.pointerId !== pointerId) return;
    this.#paletteDrag = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  }

  #renderLock(): void {
    if (!this.#draft || !this.#lockButton) return;
    this.#lockButton.textContent = this.#deps.translate(
      this.#draft.locked
        ? 'hudChrome.mobileHudEditor.locked'
        : 'hudChrome.mobileHudEditor.unlocked',
    );
    this.#lockButton.setAttribute('aria-pressed', String(this.#draft.locked));
  }

  setContext(contextId: MobileHudContextId): void {
    if (!this.#draft) return;
    const next = reduceMobileHudDraft(this.#draft, { type: 'set-context', contextId }, this.#deps);
    if (next === this.#draft) return;
    this.#draft = next;
    if (this.#contextClass) this.#deps.document.body.classList.remove(this.#contextClass);
    this.#contextClass = mobileHudContextClass(next.contextId);
    this.#deps.document.body.classList.add(this.#contextClass);
    this.#renderSelectors();
    this.#revalidate();
    if (this.#preview) this.#renderPreview(this.#preview);
    this.#positionProxies();
    this.#renderInspector();
    this.#renderValidation();
  }

  setLocked(locked: boolean): void {
    if (!this.#draft) return;
    const next = reduceMobileHudDraft(this.#draft, { type: 'set-locked', locked }, this.#deps);
    if (next === this.#draft) return;
    this.#draft = next;
    this.#renderLock();
    if (this.#preview) this.#renderPreview(this.#preview);
    this.#positionProxies();
    this.#renderInspector();
    this.#renderValidation();
  }

  selectSurface(surfaceId: MobileHudSurfaceId): void {
    if (!this.#draft || !this.#isSurfaceAvailable(surfaceId)) return;
    const next = reduceMobileHudDraft(
      this.#draft,
      { type: 'select-surface', surfaceId },
      this.#deps,
    );
    if (next === this.#draft) return;
    this.#draft = next;
    this.#renderInspector();
    this.#syncProxySelection();
    this.#renderValidation();
  }

  async save(): Promise<boolean> {
    if (!this.#draft || this.#saving) return false;
    if (this.#draft.failures.length > 0) {
      if (this.#status) {
        const firstFailure = this.#draft.failures[0];
        this.#status.textContent = this.#failureMessage(firstFailure, firstFailure.surfaceIds[0]);
      }
      return false;
    }
    this.#saving = true;
    if (this.#saveButton) this.#saveButton.disabled = true;
    const result = await saveMobileHudLayout({
      storage: this.#deps.storage,
      registry: this.#deps.registry,
      matrix: this.#deps.validationMatrix,
      document: this.#draft.document,
      isSurfaceAvailable: (surfaceId) => this.#isSurfaceAvailable(surfaceId),
    });
    this.#saving = false;
    if (!result.ok) {
      if (result.reason === 'invalid-layout') {
        this.#draft = { ...this.#draft, failures: result.failures };
        this.#renderValidation();
      } else if (this.#status) {
        this.#status.textContent = this.#deps.translate('hudChrome.mobileHudEditor.storageError');
      }
      if (this.#saveButton) this.#saveButton.disabled = this.#draft.failures.length > 0;
      return false;
    }
    this.#endPreviewOnce();
    this.#deps.commitValidatedDocument(result.document);
    this.close();
    return true;
  }

  cancel(): void {
    if (!this.#draft) return;
    this.close();
  }

  requestClose(): boolean {
    if (!this.#draft) return true;
    if (
      isMobileHudDraftDirty(this.#draft) &&
      !this.#deps.confirmDiscard({
        title: this.#deps.translate('hudChrome.mobileHudEditor.discard.title'),
        body: this.#deps.translate('hudChrome.mobileHudEditor.discard.body'),
        confirm: this.#deps.translate('hudChrome.mobileHudEditor.discard.confirm'),
        continueEditing: this.#deps.translate('hudChrome.mobileHudEditor.discard.continueEditing'),
      })
    ) {
      return false;
    }
    this.cancel();
    return true;
  }

  refreshGeometry(): void {
    if (!this.#draft) return;
    const activeProfileId = this.#deps.getProfileId();
    if (activeProfileId !== this.#draft.activeProfileId) {
      this.#draft = { ...this.#draft, activeProfileId };
    }
    this.#revalidate('matrix', true);
    this.#syncLiveVisualState();
    this.#positionProxies();
    this.#renderInspector();
    this.#renderValidation();
  }

  constructor(deps: MobileHudEditorDeps) {
    this.#deps = deps;
  }

  get isOpen(): boolean {
    return this.#root !== null;
  }

  get draft(): MobileHudDraft | null {
    return this.#draft;
  }

  open(): boolean {
    if (this.#root) return true;
    if (!this.#deps.canOpen()) return false;

    const entryDocument = cloneLayoutDocument(this.#deps.getDocument());
    const entryContextId = resolveMobileHudEditorContext(this.#deps.getContextId());
    const entrySceneId =
      MOBILE_HUD_CONTEXTS.find((context) => context.id === entryContextId)?.sceneId ??
      this.#deps.getSceneId();
    this.#draft = {
      document: cloneLayoutDocument(entryDocument),
      entryDocument,
      activeProfileId: this.#deps.getProfileId(),
      sceneId: entrySceneId,
      contextId: entryContextId,
      selectedSurfaceId: null,
      locked: true,
      failures: [],
      activeFailureIndex: null,
    };
    this.#revalidate('matrix', true);
    this.#deps.beginPreview(this.#draft.entryDocument);
    this.#previewEnded = false;
    const activeElement = this.#deps.document.activeElement as { focus?: () => void } | null;
    this.#opener = activeElement?.focus ? (activeElement as { focus(): void }) : null;

    const root = this.#deps.document.createElement('section');
    root.classList.add('mobile-hud-editor');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', this.#deps.translate('hudChrome.mobileHudEditor.dialogLabel'));
    root.tabIndex = -1;
    root.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.requestClose();
    });

    const stage = this.#deps.document.createElement('div');
    stage.classList.add('mobile-hud-editor-stage');
    const preview = this.#deps.document.createElement('div');
    preview.classList.add('mobile-hud-editor-preview');
    this.#preview = preview;
    this.#renderPreview(preview);
    stage.append(preview);

    const dock = this.#deps.document.createElement('div');
    dock.classList.add('mobile-hud-editor-dock');
    dock.setAttribute('data-mobile-hud-editor-palette', 'true');
    const handle = this.#deps.document.createElement('div');
    handle.classList.add('mobile-hud-editor-drag-handle');
    handle.setAttribute('data-mobile-hud-editor-drag-handle', 'true');
    handle.setAttribute('role', 'button');
    handle.setAttribute(
      'aria-label',
      this.#deps.translate('hudChrome.mobileHudEditor.dialogLabel'),
    );
    handle.tabIndex = 0;
    handle.addEventListener('pointerdown', (event) =>
      this.#startPaletteDrag(dock, handle, event as PointerEvent),
    );
    handle.addEventListener('pointermove', (event) =>
      this.#movePaletteDrag(dock, event as PointerEvent),
    );
    handle.addEventListener('pointerup', (event) =>
      this.#endPaletteDrag(handle, (event as PointerEvent).pointerId),
    );
    handle.addEventListener('pointercancel', (event) =>
      this.#endPaletteDrag(handle, (event as PointerEvent).pointerId),
    );
    handle.addEventListener('keydown', (event) =>
      this.#movePaletteWithKeyboard(dock, event as KeyboardEvent),
    );

    const selectors = this.#deps.document.createElement('div');
    selectors.classList.add('mobile-hud-editor-selectors');
    const contextSelector = this.#deps.document.createElement('select');
    contextSelector.classList.add('mobile-hud-editor-contexts');
    contextSelector.setAttribute('data-mobile-hud-selector', 'context');
    contextSelector.setAttribute(
      'aria-label',
      this.#deps.translate('hudChrome.mobileHudEditor.contextLabel'),
    );
    contextSelector.addEventListener('change', () =>
      this.setContext(contextSelector.value as MobileHudContextId),
    );
    selectors.append(contextSelector);
    this.#contextSelector = contextSelector as HTMLSelectElement;
    this.#renderSelectors();

    const actions = this.#deps.document.createElement('div');
    actions.classList.add('mobile-hud-editor-actions');
    const lockStatus = this.#deps.document.createElement('button');
    lockStatus.type = 'button';
    lockStatus.addEventListener('click', () => this.setLocked(!this.#draft?.locked));
    this.#lockButton = lockStatus;
    this.#renderLock();
    const save = this.#deps.document.createElement('button');
    save.type = 'button';
    save.setAttribute('data-mobile-hud-action', 'save');
    save.textContent = this.#deps.translate('hudChrome.mobileHudEditor.save');
    save.addEventListener('click', () => void this.save());
    this.#saveButton = save;
    const cancel = this.#deps.document.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('data-mobile-hud-action', 'cancel');
    cancel.textContent = this.#deps.translate('hudChrome.mobileHudEditor.cancel');
    cancel.addEventListener('click', () => this.requestClose());
    actions.append(lockStatus, save, cancel);

    const inspector = this.#deps.document.createElement('div');
    inspector.classList.add('mobile-hud-editor-inspector');
    const status = this.#deps.document.createElement('div');
    status.classList.add('mobile-hud-editor-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    this.#inspector = inspector;
    this.#status = status;
    this.#renderInspector();
    this.#renderValidation();
    dock.append(handle, actions, selectors, inspector, status);
    root.append(stage, dock);

    this.#root = root;
    this.#contextClass = mobileHudContextClass(this.#draft.contextId);
    this.#deps.document.body.classList.add('mobile-hud-editor-open', this.#contextClass);
    this.#portalCenterMessage();
    this.#deps.document.body.append(root);
    this.#setLiveHudInert();
    this.#positionProxies();
    this.#observeLiveGeometry();
    this.#focusTrap = this.#deps.focusManager.open({
      root: () => this.#root,
      returnFocusTo: this.#opener as HTMLElement | null,
    });
    this.#focusTrap.focusFirst();
    this.#deps.onOpenChange(true);
    return true;
  }

  close(): void {
    if (!this.#root) return;
    this.#flushPendingDragEdit();
    this.#endPreviewOnce();
    this.#disconnectLiveGeometryObservers();
    const root = this.#root;
    this.#root = null;
    root.remove();
    this.#deps.document.body.classList.remove('mobile-hud-editor-open');
    if (this.#contextClass) this.#deps.document.body.classList.remove(this.#contextClass);
    this.#contextClass = null;
    this.#preview = null;
    this.#contextSelector = null;
    this.#inspector = null;
    this.#status = null;
    this.#lockButton = null;
    this.#saveButton = null;
    this.#proxies.clear();
    this.#clearLiveVisualState();
    this.#restoreLiveHudInert();
    this.#restoreCenterMessage();
    this.#drag = null;
    this.#paletteDrag = null;
    this.#saving = false;
    this.#draft = null;
    this.#focusTrap?.release();
    this.#focusTrap = null;
    this.#opener = null;
    this.#deps.onOpenChange(false);
  }
}

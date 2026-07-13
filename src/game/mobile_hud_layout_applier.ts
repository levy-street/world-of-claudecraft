// Thin DOM applier for the Phase 3 responsive mobile HUD layout: reads real
// viewport + mode state, calls the pure src/ui/mobile_hud_layout.ts core, and
// writes the result onto document.body. No decision logic lives here; this
// module only reads inputs and performs the DOM writes the core cannot do
// itself (it must stay host-agnostic for tests/architecture.test.ts).
//
// Safe-area insets: this reads 0 for all four and lets CSS own inset handling
// via env(safe-area-inset-*) directly in hud.mobile.css (the repo's existing
// idiom, see the ring/joystick rules there). The core still accepts insets as
// inputs (so a future JS-side need, e.g. combining an inset with a tier
// threshold, has a seam) but nothing here currently probes the real env()
// values from JS: doing so would need a throwaway probe element and a
// getComputedStyle read every call, which is unnecessary work when CSS already
// applies the same insets natively and unconditionally.

import {
  mirrorMobileHudPlacement,
  normalizeMobileHudPlacementForDescriptor,
  resolveMobileHudSurfaceGeometry,
  validateMobileHudContext,
} from '../ui/mobile_hud_editor_core';
import type {
  MobileHudContextId,
  MobileHudLayoutDocumentV1,
  MobileHudProfileId,
  MobileHudSafeAreaInsets,
  MobileHudSurfaceId,
  MobileHudValidationFailure,
  MobileHudViewportGeometry,
} from '../ui/mobile_hud_editor_types';
import { type MobileMenuPlacement, resolveMobileHudLayout } from '../ui/mobile_hud_layout';
import type { MobileHudRegistry } from '../ui/mobile_hud_registry';
import { getUiScale } from '../ui/ui_scale';
import { isNativeAppShell, useTouchInterface } from './mobile_controls';

const TIER_CLASSES = ['hud-mobile-compact', 'hud-mobile-standard', 'hud-mobile-tablet'];
const STATE_CLASSES = ['hud-menu-open', 'hud-chat-open'];
const ALL_LAYOUT_CLASSES = [...TIER_CLASSES, ...STATE_CLASSES];

let previousClasses: string[] = [];

export interface MobileHudViewportMeasurement {
  geometry: MobileHudViewportGeometry;
  uiScale: number;
}

export interface MobileHudViewportMeasurementDeps {
  readSafeAreaInsets(win: Window): MobileHudSafeAreaInsets;
  readUiScale(): number;
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSafeAreaInsets(win: Window): MobileHudSafeAreaInsets {
  const probe = win.document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)';
  win.document.body.appendChild(probe);
  const style = win.getComputedStyle(probe);
  const insets = {
    top: cssPixels(style.paddingTop),
    right: cssPixels(style.paddingRight),
    bottom: cssPixels(style.paddingBottom),
    left: cssPixels(style.paddingLeft),
  };
  probe.remove();
  return insets;
}

const DEFAULT_MEASUREMENT_DEPS: MobileHudViewportMeasurementDeps = {
  readSafeAreaInsets,
  readUiScale: getUiScale,
};

export function readMobileHudViewportGeometry(
  win: Window = window,
  deps: MobileHudViewportMeasurementDeps = DEFAULT_MEASUREMENT_DEPS,
): MobileHudViewportMeasurement {
  const viewport = win.visualViewport;
  const width = viewport?.width ?? win.innerWidth;
  const height = viewport?.height ?? win.innerHeight;
  return {
    geometry: {
      id: `runtime-${width}x${height}`,
      width,
      height,
      visualOffsetX: viewport?.offsetLeft ?? 0,
      visualOffsetY: viewport?.offsetTop ?? 0,
      safeAreaInsets: deps.readSafeAreaInsets(win),
    },
    uiScale: deps.readUiScale(),
  };
}

export class MobileHudCustomLayoutState {
  readonly #defaultDocument: MobileHudLayoutDocumentV1;

  #validatedDocument: MobileHudLayoutDocumentV1 | null = null;

  #previewDocument: MobileHudLayoutDocumentV1 | null = null;

  #previewEntryDocument: MobileHudLayoutDocumentV1 | null = null;

  constructor(registry: MobileHudRegistry) {
    this.#defaultDocument = {
      schemaVersion: 1,
      enabled: false,
      profiles: registry.defaults,
    };
  }

  get previewActive(): boolean {
    return this.#previewEntryDocument !== null;
  }

  setValidatedDocument(document: MobileHudLayoutDocumentV1 | null): void {
    this.#validatedDocument = document;
  }

  beginPreview(entryDocument: MobileHudLayoutDocumentV1): void {
    this.#previewEntryDocument = entryDocument;
    this.#previewDocument = entryDocument;
  }

  updatePreview(document: MobileHudLayoutDocumentV1): void {
    if (!this.previewActive) return;
    this.#previewDocument = document;
  }

  endPreview(): void {
    if (this.#previewEntryDocument) this.#validatedDocument = this.#previewEntryDocument;
    this.#previewDocument = null;
    this.#previewEntryDocument = null;
  }

  activeDocument(): MobileHudLayoutDocumentV1 {
    if (this.#previewDocument) return this.#previewDocument;
    if (this.#validatedDocument?.enabled) return this.#validatedDocument;
    return this.#defaultDocument;
  }

  clear(): void {
    this.#validatedDocument = null;
    this.#previewDocument = null;
    this.#previewEntryDocument = null;
  }
}

export interface ApplyMobileHudCustomLayoutOptions {
  profileId: MobileHudProfileId;
  contextId: MobileHudContextId;
  handedness: 'left' | 'right';
  measurement: MobileHudViewportMeasurement;
  eligible: boolean;
  isSurfaceAvailable?(surfaceId: MobileHudSurfaceId): boolean;
}

export interface ApplyMobileHudCustomLayoutResult {
  fallback: boolean;
  failures: readonly MobileHudValidationFailure[];
}

export class MobileHudFallbackWarningState {
  #signature: string | null = null;

  shouldWarn(result: ApplyMobileHudCustomLayoutResult): boolean {
    if (!result.fallback) {
      this.#signature = null;
      return false;
    }
    const signature = JSON.stringify(
      result.failures.map((failure) => [
        failure.reason,
        failure.profileId,
        failure.contextId,
        failure.surfaceIds,
        failure.viewportId,
        failure.safeAreaFixtureId,
        failure.handedness,
        failure.activeVariantIds,
      ]),
    );
    if (signature === this.#signature) return false;
    this.#signature = signature;
    return true;
  }
}

function resolveMobileHudFlexFlow(
  orientation: 'horizontal' | 'vertical' | undefined,
  reverse: boolean | undefined,
): string | undefined {
  if (!orientation) return undefined;
  const axis = orientation === 'horizontal' ? 'row' : 'column';
  return reverse ? `${axis}-reverse` : axis;
}

function resolveConsumablesOpeningProperties(
  prefix: string,
  openingDirection: 'left' | 'right' | 'up' | 'down' | undefined,
): Readonly<Record<string, string>> {
  if (!openingDirection) return {};
  const horizontal = openingDirection === 'left' || openingDirection === 'right';
  const opensBefore = openingDirection === 'left' || openingDirection === 'up';
  const inlineEnd = openingDirection === 'left';
  const blockEnd = openingDirection === 'up';
  return {
    [`${prefix}-toggle-left`]: inlineEnd ? 'auto' : '0',
    [`${prefix}-toggle-right`]: inlineEnd ? '0' : 'auto',
    [`${prefix}-toggle-top`]: blockEnd ? 'auto' : openingDirection === 'down' ? '0' : 'auto',
    [`${prefix}-toggle-bottom`]: blockEnd || horizontal ? '0' : 'auto',
    [`${prefix}-row-left`]: inlineEnd ? 'auto' : openingDirection === 'right' ? '54px' : '0',
    [`${prefix}-row-right`]: inlineEnd ? '54px' : 'auto',
    [`${prefix}-row-top`]: openingDirection === 'down' ? '54px' : 'auto',
    [`${prefix}-row-bottom`]: blockEnd ? '54px' : horizontal ? '0' : 'auto',
    [`${prefix}-grid-columns`]: horizontal ? 'repeat(3, 48px)' : 'repeat(2, 48px)',
    [`${prefix}-grid-rows`]: horizontal ? 'repeat(2, 48px)' : 'repeat(3, 48px)',
    [`${prefix}-item-direction`]: opensBefore && horizontal ? 'rtl' : 'ltr',
  };
}

function resolvePartyMemberViewportProperties(
  prefix: string,
  surfaceId: MobileHudSurfaceId,
  orientation: 'horizontal' | 'vertical' | undefined,
): Readonly<Record<string, string>> {
  if (surfaceId !== 'party') return {};
  const vertical = orientation === 'vertical';
  return {
    // A sparse party must shrink to its actual rows; only a populated raid
    // reaches these caps and starts scrolling. The editor's separate layout
    // envelope still advertises the full registered raid-capacity surface.
    [`${prefix}-members-width`]: vertical ? '68px' : 'max-content',
    [`${prefix}-members-height`]: vertical ? 'max-content' : '40px',
    [`${prefix}-members-max-width`]: `${vertical ? 68 : 284}px`,
    [`${prefix}-members-max-height`]: `${vertical ? 172 : 40}px`,
    [`${prefix}-members-overflow-x`]: vertical ? 'hidden' : 'auto',
    [`${prefix}-members-overflow-y`]: vertical ? 'auto' : 'hidden',
  };
}

function resolveAuraViewportProperties(
  prefix: string,
  surfaceId: MobileHudSurfaceId,
  orientation: 'horizontal' | 'vertical' | undefined,
): Readonly<Record<string, string>> {
  if (surfaceId !== 'auras.player_buffs' && surfaceId !== 'auras.player_debuffs') return {};
  const vertical = orientation === 'vertical';
  return {
    [`${prefix}-overflow-x`]: vertical ? 'hidden' : 'auto',
    [`${prefix}-overflow-y`]: vertical ? 'auto' : 'hidden',
    [`${prefix}-touch-action`]: vertical ? 'pan-y' : 'pan-x',
    [`${prefix}-duration-bottom`]: '0',
  };
}

function resolvePetViewportProperties(
  prefix: string,
  surfaceId: MobileHudSurfaceId,
  orientation: 'horizontal' | 'vertical' | undefined,
): Readonly<Record<string, string>> {
  if (surfaceId !== 'pet.commands') return {};
  const vertical = orientation === 'vertical';
  return {
    [`${prefix}-overflow-x`]: vertical ? 'hidden' : 'auto',
    [`${prefix}-overflow-y`]: vertical ? 'auto' : 'hidden',
    [`${prefix}-touch-action`]: vertical ? 'pan-y' : 'pan-x',
  };
}

export class MobileHudCustomLayoutDomApplier {
  readonly #applied = new Map<HTMLElement, ReadonlyMap<string, string>>();

  readonly #annotated = new Map<HTMLElement, string>();

  readonly #document: Document;

  readonly #registry: MobileHudRegistry;

  readonly #state: MobileHudCustomLayoutState;

  constructor(document: Document, registry: MobileHudRegistry, state: MobileHudCustomLayoutState) {
    this.#document = document;
    this.#registry = registry;
    this.#state = state;
  }

  clear(): void {
    if (this.#document.body.classList.contains('mobile-hud-custom-active')) {
      this.#document.body.classList.remove('mobile-hud-custom-active');
    }
    for (const [element, properties] of this.#applied) {
      for (const property of properties.keys()) element.style.removeProperty(property);
    }
    this.#applied.clear();
    for (const element of this.#annotated.keys()) {
      element.removeAttribute('data-mobile-hud-overlap-policy');
    }
    this.#annotated.clear();
  }

  #syncAppliedProperties(next: ReadonlyMap<HTMLElement, ReadonlyMap<string, string>>): void {
    for (const [element, previousProperties] of this.#applied) {
      const nextProperties = next.get(element);
      for (const property of previousProperties.keys()) {
        if (!nextProperties?.has(property)) element.style.removeProperty(property);
      }
    }
    for (const [element, nextProperties] of next) {
      const previousProperties = this.#applied.get(element);
      for (const [property, value] of nextProperties) {
        if (previousProperties?.get(property) !== value) element.style.setProperty(property, value);
      }
    }
    this.#applied.clear();
    for (const [element, properties] of next) this.#applied.set(element, properties);
  }

  #syncAnnotations(next: ReadonlyMap<HTMLElement, string>): void {
    for (const element of this.#annotated.keys()) {
      if (!next.has(element)) element.removeAttribute('data-mobile-hud-overlap-policy');
    }
    for (const [element, policy] of next) {
      if (this.#annotated.get(element) !== policy) {
        element.setAttribute('data-mobile-hud-overlap-policy', policy);
      }
    }
    this.#annotated.clear();
    for (const [element, policy] of next) this.#annotated.set(element, policy);
  }

  apply(options: ApplyMobileHudCustomLayoutOptions): ApplyMobileHudCustomLayoutResult {
    if (!options.eligible) {
      this.clear();
      return { fallback: false, failures: [] };
    }
    if (!this.#document.body.classList.contains('mobile-hud-custom-active')) {
      this.#document.body.classList.add('mobile-hud-custom-active');
    }

    const activeDocument = this.#state.activeDocument();
    const activePlacements = activeDocument.profiles[options.profileId] ?? {};
    const failures = validateMobileHudContext({
      registry: this.#registry,
      profileId: options.profileId,
      placements: activePlacements,
      geometry: options.measurement.geometry,
      contextId: options.contextId,
      handedness: options.handedness,
      isSurfaceAvailable: options.isSurfaceAvailable,
    });
    // Invalid persisted data must fall back safely, but an editor drag is
    // deliberately allowed to pass through invalid intermediate positions.
    // The editor paints those failures red and blocks Save while the live HUD
    // continues to follow the pointer.
    const fallback = !this.#state.previewActive && failures.length > 0;
    const placements = fallback
      ? (this.#registry.defaults[options.profileId] ?? {})
      : activePlacements;
    const nextApplied = new Map<HTMLElement, Map<string, string>>();
    const nextAnnotated = new Map<HTMLElement, string>();

    for (const descriptor of this.#registry.descriptors) {
      if (
        descriptor.class !== 'movable' ||
        (options.isSurfaceAvailable && !options.isSurfaceAvailable(descriptor.id)) ||
        !descriptor.validateIn.includes(options.contextId) ||
        !descriptor.binding
      ) {
        continue;
      }
      const storedCanonical = placements[descriptor.id];
      if (!storedCanonical) continue;
      const canonical = normalizeMobileHudPlacementForDescriptor(descriptor, storedCanonical);
      const placement =
        options.handedness === 'left'
          ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
          : canonical;
      const resolved = resolveMobileHudSurfaceGeometry(
        descriptor,
        options.profileId,
        placement,
        options.measurement.geometry,
        options.contextId,
      );
      const element = this.#document.querySelector<HTMLElement>(descriptor.binding.rootSelector);
      if (!element) continue;
      if (descriptor.overlapPolicy) {
        nextAnnotated.set(element, descriptor.overlapPolicy);
      }
      const authorScale =
        descriptor.coordinateHost === 'ui-author' ? options.measurement.uiScale : 1;
      // A ui-author root lives below #ui's global CSS zoom. Coordinates must be
      // written in author space, but the complete surface (including fixed-pixel
      // children, gaps, and touch targets) must remain in the registry's canonical
      // visual-pixel geometry. Counter-scale the root and keep its local dimensions
      // canonical; dividing only the outer box would leave its children zoomed and
      // make the validated footprint disagree with the real hit area.
      const appliedScale = placement.scale / authorScale;
      const originX =
        descriptor.coordinateHost === 'ui-author' ? options.measurement.geometry.visualOffsetX : 0;
      const originY =
        descriptor.coordinateHost === 'ui-author' ? options.measurement.geometry.visualOffsetY : 0;
      const prefix = descriptor.binding.cssPropertyPrefix;
      const flow = resolveMobileHudFlexFlow(placement.orientation, placement.reverse);
      const runtimeSizing = descriptor.binding.runtimeSizing ?? 'validation-footprint';
      const runtimeSize =
        runtimeSizing === 'base-footprint'
          ? (descriptor.profileSizes?.[options.profileId] ?? descriptor.defaultSize)
          : resolved.unscaledSize;
      const values: Readonly<Record<string, string>> = {
        [`${prefix}-x`]: `${(resolved.canonicalRect.x - originX) / authorScale}px`,
        [`${prefix}-y`]: `${(resolved.canonicalRect.y - originY) / authorScale}px`,
        ...(descriptor.primaryFootprint
          ? {
              [`${prefix}-interactive-x`]: `${
                (resolved.interactiveRect.x - originX) / authorScale
              }px`,
              [`${prefix}-interactive-y`]: `${
                (resolved.interactiveRect.y - originY) / authorScale
              }px`,
              [`${prefix}-interactive-width`]: `${
                resolved.interactiveRect.width / placement.scale
              }px`,
              [`${prefix}-interactive-height`]: `${
                resolved.interactiveRect.height / placement.scale
              }px`,
            }
          : {}),
        ...(runtimeSizing === 'intrinsic'
          ? {}
          : {
              [`${prefix}-width`]: `${runtimeSize.width}px`,
              [`${prefix}-height`]: `${runtimeSize.height}px`,
            }),
        [`${prefix}-scale`]: `${appliedScale}`,
        ...(placement.orientation ? { [`${prefix}-orientation`]: placement.orientation } : {}),
        ...(placement.reverse === undefined
          ? {}
          : { [`${prefix}-reverse`]: placement.reverse ? '1' : '0' }),
        ...(placement.openingDirection
          ? { [`${prefix}-opening-direction`]: placement.openingDirection }
          : {}),
        ...(flow ? { [`${prefix}-flow`]: flow } : {}),
        ...(descriptor.id === 'frame.player'
          ? {
              [`${prefix}-castbar-top-offset`]: `${8 / authorScale}px`,
              [`${prefix}-swingbar-top-offset`]: `${16 / authorScale}px`,
            }
          : {}),
        ...resolveConsumablesOpeningProperties(prefix, placement.openingDirection),
        ...resolvePartyMemberViewportProperties(prefix, descriptor.id, placement.orientation),
        ...resolveAuraViewportProperties(prefix, descriptor.id, placement.orientation),
        ...resolvePetViewportProperties(prefix, descriptor.id, placement.orientation),
      };
      const boundElements = new Set<HTMLElement>([element]);
      for (const selector of descriptor.binding.dependentRootSelectors ?? []) {
        const dependent = this.#document.querySelector<HTMLElement>(selector);
        if (dependent) boundElements.add(dependent);
      }
      for (const boundElement of boundElements) {
        const properties = nextApplied.get(boundElement) ?? new Map<string, string>();
        for (const [property, value] of Object.entries(values)) properties.set(property, value);
        nextApplied.set(boundElement, properties);
      }
    }
    this.#syncAppliedProperties(nextApplied);
    this.#syncAnnotations(nextAnnotated);
    return { fallback, failures };
  }
}

/** Move the existing Social and Settings nodes between the direct action row
 *  and More. Reparenting preserves their listeners, state, and unique ids. */
export function syncMobileMenuPlacement(doc: Document, placement: MobileMenuPlacement): void {
  const combat = doc.getElementById('mobile-combat-controls');
  const extra = doc.getElementById('mobile-extra-grid');
  const social = doc.getElementById('mobile-social');
  const quest = doc.getElementById('mobile-quest');
  const menu = doc.getElementById('mobile-menu');
  const more = doc.getElementById('mobile-more');
  if (!combat || !extra || !social || !quest || !menu || !more) return;

  if (placement === 'compact') {
    const active = doc.activeElement;
    if (
      active &&
      (social === active || social.contains(active) || menu === active || menu.contains(active))
    ) {
      more.focus();
    }
    extra.insertBefore(menu, extra.firstChild);
    extra.insertBefore(social, menu);
    return;
  }

  combat.insertBefore(social, quest);
  combat.insertBefore(menu, more);
}

/** Read the current viewport/mode state and apply the resolved mobile HUD
 *  layout classes + CSS vars to document.body. Call once at startup (after
 *  settings are applied) and right after every syncAppViewport() call so the
 *  tier stays in sync with resize/orientation/fullscreen changes. */
export function applyMobileHudLayout(win: Window = window): void {
  const doc = win.document;
  const body = doc.body;
  const stableGameRoot =
    body.classList.contains('game-active') && body.classList.contains('mobile-touch');
  const stableRect = stableGameRoot ? body.getBoundingClientRect() : null;
  const layout = resolveMobileHudLayout({
    width: stableRect?.width || win.innerWidth,
    height: stableRect?.height || win.innerHeight,
    safeAreaTop: 0,
    safeAreaRight: 0,
    safeAreaBottom: 0,
    safeAreaLeft: 0,
    touchMode: useTouchInterface(win) || isNativeAppShell(),
    menuOpen: body.classList.contains('mobile-window-open'),
    chatOpen: body.classList.contains('mobile-chat-open'),
  });
  syncMobileMenuPlacement(doc, layout.menuPlacement);

  for (const cls of previousClasses) {
    if (!layout.classes.includes(cls)) body.classList.remove(cls);
  }
  for (const cls of layout.classes) body.classList.add(cls);
  // Guard against a class from an unrelated caller lingering if it happens to
  // collide with our managed set (defensive; not expected in practice).
  for (const cls of ALL_LAYOUT_CLASSES) {
    if (!layout.classes.includes(cls)) body.classList.remove(cls);
  }
  previousClasses = layout.classes;

  for (const [name, value] of Object.entries(layout.cssVars)) {
    body.style.setProperty(name, value);
  }
}

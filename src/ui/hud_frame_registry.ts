import {
  additionalUnitDimensions,
  migratePetFrameSize,
  resourceBarFirstSeat,
} from './frame_dimensions';
import type { HudFrameGroups } from './hud_frame_groups';
import { frameGroupFor } from './hud_frame_groups';
import type { TranslationKey } from './i18n.catalog';
import { type InterfaceUnlock, makeUiRootDetacher } from './interface_unlock';
import { frameRowSettingKey, HUD_FRAME_SPECS, type HudFrameSpec } from './interface_unlock_core';
import type { FramesMenuSettingsHooks } from './interface_unlock_menu_core';
import { MovableFrame } from './movable_frame';
import { getUiScale } from './ui_scale';

/** The table-driven mover wiring; Hud supplies only its private state readers. */
export function registerHudFrames(deps: {
  document: Document;
  registry: InterfaceUnlock;
  groups: HudFrameGroups;
  isMobileLayout(): boolean;
  snapToGrid(): boolean;
  labelKey(spec: HudFrameSpec): TranslationKey;
  isActive(id: string): boolean;
  onPositioned(id: string, active: boolean): void;
  options(): FramesMenuSettingsHooks | null;
}): (force?: boolean) => void {
  const independentTarget = () => !!deps.options()?.settings.get('moveTargetOfTargetIndependently');
  const detachedResource = () => !!deps.options()?.settings.get('playerFrameResourceDetached');
  let petMover: MovableFrame | undefined;
  let petStorageKey: string | undefined;
  let petMigrated = false;
  let targetMover: MovableFrame | undefined;
  let resourceMover: MovableFrame | undefined;
  for (const spec of HUD_FRAME_SPECS) {
    const frame = deps.document.getElementById(spec.elementId);
    if (!frame) continue;
    const detach = makeUiRootDetacher(deps.document, spec, frame);
    const dimensions = additionalUnitDimensions(spec.id, deps.options);
    const mover = new MovableFrame({
      frame,
      storageKey: spec.storageKey,
      legacyStorageKeys: spec.legacyStorageKeys,
      snapToGrid: deps.snapToGrid,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
      frameLabelKey: () => deps.labelKey(spec),
      draggingBodyClass: 'hud-frame-dragging',
      fallbackSize: spec.fallbackSize,
      isMobileLayout: deps.isMobileLayout,
      scalable: spec.scalable ?? true,
      resizeMode: dimensions ? 'dimensions' : spec.resizeMode,
      dimensions,
      moveHandle: spec.id === 'damageMeter' ? '#meters-window' : undefined,
      resizeWhileLocked: spec.id === 'damageMeter',
      globalLockOnly: true,
      // The hill bar is shrink-to-fit and grows with its phase rows, so a seat
      // clamped while it was hidden re-clamps once it shows.
      observeSizeChanges: spec.id === 'menu' || spec.id === 'hillBar',
      preserveSavedSize: spec.id === 'petFrame',
      userHiddenOnlyWhenPositioned: spec.id === 'playerResource',
      maxScale: spec.maxScale,
      buttonOnlyWhenUnlocked: true,
      onPositioned: (active) => {
        if (!deps.groups.isCombinedMember(spec.id)) detach(active);
        deps.onPositioned(spec.id, active);
      },
    });
    if (spec.id === 'petFrame') {
      petMover = mover;
      petStorageKey = spec.storageKey;
    }
    if (spec.id === 'targetOfTarget') targetMover = mover;
    if (spec.id === 'playerResource') resourceMover = mover;
    const setting = frameRowSettingKey(spec.id);
    deps.registry.register({
      id: spec.id,
      mover,
      geometryActive: () =>
        deps.groups.isActive(spec.id) &&
        (spec.id !== 'targetOfTarget' || independentTarget()) &&
        (spec.id !== 'playerResource' || detachedResource()) &&
        (spec.id !== 'actionBarGroup' || deps.isActive('actionBarGroup')) &&
        (!['actionBar1', 'actionBar2', 'actionBar3'].includes(spec.id) ||
          !deps.isActive('actionBarGroup')),
      isActive: () =>
        deps.groups.isActive(spec.id) &&
        deps.isActive(spec.id) &&
        (spec.id !== 'targetOfTarget' || independentTarget()) &&
        (spec.id !== 'playerResource' || detachedResource()),
      ...(setting
        ? {
            rowOverride: {
              listed: () => true,
              value: () => !!deps.options()?.settings.get(setting),
              set: (checked: boolean) => {
                if (checked) mover.setUserHidden(false);
                deps.options()?.onSettingChange(setting, checked);
                deps.registry.refreshSettings();
              },
            },
          }
        : frameGroupFor(spec.id)
          ? {
              rowOverride: {
                listed: () => true,
                value: () => !mover.isUserHidden,
                set: (checked: boolean) => mover.setUserHidden(!checked),
              },
            }
          : {}),
    });
  }
  let independent: boolean | undefined;
  let resourceDetached: boolean | undefined;
  return (force = false) => {
    if (!deps.options()) return;
    if ((!petMigrated || force) && petMover && petStorageKey) {
      petMigrated = true;
      if (petMover.isUserHidden) {
        deps.options()!.onSettingChange('showPetFrame', false);
        petMover.setUserHidden(false);
      }
      try {
        if (migratePetFrameSize(localStorage, petStorageKey, deps.options))
          petMover.restoreSavedPosition();
      } catch {
        /* Storage unavailable. */
      }
    }
    const resource = detachedResource();
    if (resource !== resourceDetached || force) {
      resourceDetached = resource;
      syncResourceDetach(deps, resource, resourceMover, force);
    }
    const next = independentTarget();
    if (next === independent && !force) return;
    independent = next;
    if (next) {
      deps.registry.restoreSavedPosition('targetOfTarget');
      const target = deps.document.getElementById('target-frame')?.getBoundingClientRect();
      targetMover?.detachAtCurrentPosition({
        left: target && target.width > 0 ? target.right + 8 : 320,
        top: target && target.height > 0 ? target.top : 160,
      });
    } else deps.registry.clearAppliedGeometry('targetOfTarget');
  };
}

/**
 * Detach Resource Bar: on, the bar adopts its saved spot, or (the first time)
 * a seat just below the player frame at the size it had there, so the flip
 * neither covers the frame's hp bar nor changes the bar's size; off, its
 * applied geometry drops (the saved spot stays for the next flip) and it rides
 * the player frame again. A hide from the frames menu belongs to the DETACHED
 * frame only, so re-docking shows the bar again. The touch HUD owns its own
 * layout (the mover never applies a seat there), so nothing is measured or
 * stored from it.
 */
function syncResourceDetach(
  deps: {
    registry: InterfaceUnlock;
    document: Document;
    isMobileLayout(): boolean;
    options(): FramesMenuSettingsHooks | null;
  },
  detached: boolean,
  mover: MovableFrame | undefined,
  boot: boolean,
): void {
  if (!mover) return;
  if (detached) {
    deps.registry.restoreSavedPosition('playerResource');
    const wrap = deps.document.getElementById('pf-resource-frame');
    if (wrap && !wrap.classList.contains('hud-frame-detached') && !deps.isMobileLayout()) {
      const frame = deps.document.getElementById('player-frame')?.getBoundingClientRect();
      const first = resourceBarFirstSeat(wrap.getBoundingClientRect(), frame ?? null, getUiScale());
      const hooks = deps.options();
      // A live flip seeds the size from the docked bar; a boot with the option
      // already on keeps whatever size the player has stored.
      if (hooks && !boot) {
        hooks.onSettingChange(
          'playerFrameResourceWidth',
          hooks.settings.set('playerFrameResourceWidth', first.width),
        );
        hooks.onSettingChange(
          'playerFrameResourceHeight',
          hooks.settings.set('playerFrameResourceHeight', first.height),
        );
      }
      mover.detachAtPosition(first.seat);
    }
  } else {
    deps.registry.clearAppliedGeometry('playerResource');
    if (mover.isUserHidden) mover.setUserHidden(false);
  }
  deps.registry.refresh();
}

/** The edit preview replaces the live party rows while arranging frames. */
export function partyFrameGrid(
  frame: HTMLElement,
  columns: number,
): { cols: number; rows: number } {
  const scope = frame.querySelector('.tf-preview-party') ?? frame;
  const count = scope.querySelectorAll('.party-frame').length || 1;
  const cols = Math.max(1, Math.min(count, Math.round(columns)));
  return { cols, rows: Math.ceil(count / cols) };
}

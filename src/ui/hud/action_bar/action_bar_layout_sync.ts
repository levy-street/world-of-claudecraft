// Pure (DOM-free, host-agnostic) bridge between the localStorage key scheme the
// ActionBarController owns and the structured ActionBarLayout wire payload. It
// reads/writes a `Pick<Storage, ...>` handed in, so a Vitest drives it against a
// Map-backed fake; the browser passes real localStorage. The payload MODEL and
// its bounds validation live one layer down in `src/world_api/action_bar.ts`
// (shared with the server); this module only maps that model to and from the
// per-profile, per-form storage keys and decides the world-entry reconciliation.

import {
  ACTION_BAR_LAYOUT_FORMS,
  ACTION_BAR_LAYOUT_LEGACY_PROFILE,
  type ActionBarLayout,
  type ActionBarLayoutForm,
  type ActionBarLayoutProfile,
  type ActionBarLayoutRestore,
  actionBarLayoutIsEmpty,
  resolveActionBarLayoutProfile,
  sanitizeActionBarLayout,
} from '../../../world_api/action_bar';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  attackSlotStorageKey,
  encodeStoredHotbarAction,
  type HotbarAction,
  type HotbarStorage,
} from './hotbar';

/** The arrangement profile a device's interface resolves to at world entry: the
 *  touch interface (body.mobile-touch, the same signal every touch-gated HUD path
 *  reads) arranges the touch profile, everything else the desktop one. */
export function actionBarLayoutProfileForSurface(isTouch: boolean): ActionBarLayoutProfile {
  return isTouch ? 'touch' : ACTION_BAR_LAYOUT_LEGACY_PROFILE;
}

// The one source of truth for the action-bar localStorage key scheme. The
// controller delegates to these so the capture/apply round trip cannot drift
// from the keys the controller actually loads. The legacy (desktop) profile
// keeps the unsuffixed keys every existing device already holds; the other
// profiles suffix the profile name ahead of the form.
export function actionBarSlotMapKey(
  playerClass: string,
  playerName: string,
  profile: ActionBarLayoutProfile,
  form: ActionBarLayoutForm,
): string {
  const base = `woc_hotbar_${playerClass}_${playerName}`;
  const scoped = profile === ACTION_BAR_LAYOUT_LEGACY_PROFILE ? base : `${base}_${profile}`;
  return form === 'normal' ? scoped : `${scoped}_${form}`;
}

export function actionBarFormSeededKey(slotMapKey: string): string {
  return `${slotMapKey}_seeded`;
}

export function actionBarStealthInitializedKey(slotMapKey: string): string {
  return `${slotMapKey}_blank_v1`;
}

type ReadStorage = Pick<HotbarStorage, 'getItem'>;
type WriteStorage = Pick<HotbarStorage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Read one profile's full per-character layout out of storage into a bounded,
 * structured payload. Only forms that have a stored bar or attack key are
 * included; the result is passed through sanitizeActionBarLayout so it is
 * already in-bounds.
 */
export function captureActionBarLayout(
  storage: ReadStorage,
  playerClass: string,
  playerName: string,
  profile: ActionBarLayoutProfile,
): ActionBarLayout {
  const forms: Record<string, unknown> = {};
  for (const form of ACTION_BAR_LAYOUT_FORMS) {
    const key = actionBarSlotMapKey(playerClass, playerName, profile, form);
    let barRaw: string | null = null;
    let attackRaw: string | null = null;
    try {
      barRaw = storage.getItem(key);
      attackRaw = storage.getItem(attackSlotStorageKey(key));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    if (barRaw === null && attackRaw === null) continue;
    const formLayout: Record<string, unknown> = { bar: safeParseArray(barRaw) };
    if (attackRaw !== null) formLayout.attack = safeParse(attackRaw);
    forms[form] = formLayout;
  }
  return sanitizeActionBarLayout({ v: 1, forms }) ?? { v: 1, forms: {} };
}

/**
 * Overwrite one profile's local mirror with a layout (server wins, or a seed
 * from another profile). Only the forms present in the layout are touched; an
 * absent form leaves the device's state alone (version-tolerant, mirroring the
 * hotbar tail rule). Each written form also gets its seed/init markers set so
 * the controller treats the data as already-seeded and never auto-seeds a
 * default kit over it.
 */
export function applyActionBarLayout(
  storage: WriteStorage,
  playerClass: string,
  playerName: string,
  profile: ActionBarLayoutProfile,
  layout: ActionBarLayout,
): void {
  const clean = sanitizeActionBarLayout(layout);
  if (!clean) return;
  for (const form of ACTION_BAR_LAYOUT_FORMS) {
    const formLayout = clean.forms[form];
    if (!formLayout) continue;
    const key = actionBarSlotMapKey(playerClass, playerName, profile, form);
    const bar: HotbarAction[] = Array.from(
      { length: Math.min(formLayout.bar.length, ACTION_BAR_ABILITY_SLOTS) },
      (_, i) => formLayout.bar[i] ?? null,
    );
    try {
      storage.setItem(key, JSON.stringify(bar));
      const encodedAttack = encodeStoredHotbarAction((formLayout.attack ?? null) as HotbarAction);
      if (encodedAttack === null) storage.removeItem(attackSlotStorageKey(key));
      else storage.setItem(attackSlotStorageKey(key), encodedAttack);
      storage.setItem(actionBarFormSeededKey(key), '1');
      storage.setItem(actionBarStealthInitializedKey(key), '1');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }
}

// The world-entry reconciliation decision for ONE profile, as a pure function
// of the server's restore signal and (lazily) the device's captured local
// layouts. The locked merge rule, in order:
//   1. the server holds this profile -> it wins ('apply-server');
//   2. else the server holds another non-empty profile -> it seeds this one
//      locally, never uploaded, so the surface follows that bar until edited
//      here ('seed-profile', upload false);
//   3. else (no usable server copy) a non-empty local copy of this profile
//      seeds the first server copy ('seed-local');
//   4. else a non-desktop profile inherits the device's legacy (desktop) keys
//      once, so an upgrade never blanks a phone's bar ('seed-profile'); when
//      the server holds nothing at all that inherited bar also becomes the
//      first server copy (upload true), so a touch-only player's arrangement
//      is backed up without an edit;
//   5. else nothing (defaults stand).
// A 'noop' restore (offline, reconnect) keeps the local mirror authoritative
// and only runs rule 4, without an upload.
export type ActionBarRestorePlan =
  | { action: 'apply-server'; layout: ActionBarLayout }
  | { action: 'seed-profile'; layout: ActionBarLayout; upload: boolean }
  | { action: 'seed-local'; layout: ActionBarLayout }
  | { action: 'none' };

export function planActionBarRestore(
  restore: ActionBarLayoutRestore | undefined,
  profile: ActionBarLayoutProfile,
  captureLocal: (profile: ActionBarLayoutProfile) => ActionBarLayout,
): ActionBarRestorePlan {
  if (!restore || restore.source === 'noop') {
    return planLegacyLocalSeed(profile, captureLocal, false);
  }
  if (restore.source === 'server') {
    const resolved = resolveActionBarLayoutProfile(restore.profiles, profile);
    if (resolved?.profile === profile) return { action: 'apply-server', layout: resolved.layout };
    if (resolved) return { action: 'seed-profile', layout: resolved.layout, upload: false };
  }
  const local = captureLocal(profile);
  if (!actionBarLayoutIsEmpty(local)) return { action: 'seed-local', layout: local };
  return planLegacyLocalSeed(profile, captureLocal, true);
}

function planLegacyLocalSeed(
  profile: ActionBarLayoutProfile,
  captureLocal: (profile: ActionBarLayoutProfile) => ActionBarLayout,
  upload: boolean,
): ActionBarRestorePlan {
  if (profile === ACTION_BAR_LAYOUT_LEGACY_PROFILE) return { action: 'none' };
  if (!actionBarLayoutIsEmpty(captureLocal(profile))) return { action: 'none' };
  const legacy = captureLocal(ACTION_BAR_LAYOUT_LEGACY_PROFILE);
  if (actionBarLayoutIsEmpty(legacy)) return { action: 'none' };
  return { action: 'seed-profile', layout: legacy, upload };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeParseArray(raw: string | null): unknown[] {
  if (raw === null) return [];
  const parsed = safeParse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

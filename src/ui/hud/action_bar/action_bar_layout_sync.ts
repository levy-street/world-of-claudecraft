// Pure (DOM-free, host-agnostic) bridge between the localStorage key scheme the
// ActionBarController owns and the structured ActionBarLayout wire payload. It
// reads/writes a `Pick<Storage, ...>` handed in, so a Vitest drives it against a
// Map-backed fake; the browser passes real localStorage. The payload MODEL and
// its bounds validation live one layer down in `src/world_api/action_bar.ts`
// (shared with the server); this module only maps that model to and from the
// per-form storage keys and decides the login-time reconciliation.

import {
  ACTION_BAR_LAYOUT_FORMS,
  type ActionBarLayout,
  type ActionBarLayoutForm,
  type ActionBarLayoutRestore,
  actionBarLayoutIsEmpty,
  sanitizeActionBarLayout,
} from '../../../world_api/action_bar';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  attackSlotStorageKey,
  encodeStoredHotbarAction,
  type HotbarAction,
  type HotbarStorage,
} from './hotbar';

// The one source of truth for the action-bar localStorage key scheme. The
// controller delegates to these so the capture/apply round trip cannot drift
// from the keys the controller actually loads.
export function actionBarSlotMapKey(
  playerClass: string,
  playerName: string,
  form: ActionBarLayoutForm,
): string {
  const base = `woc_hotbar_${playerClass}_${playerName}`;
  return form === 'normal' ? base : `${base}_${form}`;
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
 * Read the full per-character layout out of storage into a bounded, structured
 * payload. Only forms that have a stored bar or attack key are included; the
 * result is passed through sanitizeActionBarLayout so it is already in-bounds.
 */
export function captureActionBarLayout(
  storage: ReadStorage,
  playerClass: string,
  playerName: string,
): ActionBarLayout {
  const forms: Record<string, unknown> = {};
  for (const form of ACTION_BAR_LAYOUT_FORMS) {
    const key = actionBarSlotMapKey(playerClass, playerName, form);
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
 * Overwrite the device's local mirror with the server layout (server wins). Only
 * the forms present in the layout are touched; an absent form leaves the
 * device's state alone (version-tolerant, mirroring the hotbar tail rule). Each
 * written form also gets its seed/init markers set so the controller treats the
 * server data as already-seeded and never auto-seeds a default kit over it.
 */
export function applyActionBarLayout(
  storage: WriteStorage,
  playerClass: string,
  playerName: string,
  layout: ActionBarLayout,
): void {
  const clean = sanitizeActionBarLayout(layout);
  if (!clean) return;
  for (const form of ACTION_BAR_LAYOUT_FORMS) {
    const formLayout = clean.forms[form];
    if (!formLayout) continue;
    const key = actionBarSlotMapKey(playerClass, playerName, form);
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

// The login-time reconciliation decision, as a pure function of the server's
// restore signal and (lazily) the device's captured local layout. This is the
// locked merge rule: server copy present -> server wins; server copy absent ->
// seed from a non-empty local layout; both absent -> nothing (defaults stand).
export type ActionBarRestorePlan =
  | { action: 'apply-server'; layout: ActionBarLayout }
  | { action: 'seed-local'; layout: ActionBarLayout }
  | { action: 'none' };

export function planActionBarRestore(
  restore: ActionBarLayoutRestore | undefined,
  captureLocal: () => ActionBarLayout,
): ActionBarRestorePlan {
  if (!restore) return { action: 'none' };
  if (restore.source === 'server') return { action: 'apply-server', layout: restore.layout };
  if (restore.source === 'seed') {
    const local = captureLocal();
    if (actionBarLayoutIsEmpty(local)) return { action: 'none' };
    return { action: 'seed-local', layout: local };
  }
  return { action: 'none' };
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

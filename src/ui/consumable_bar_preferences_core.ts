// Pure, storage-adapter-backed preferences for the six mobile Consumables slots.

import { CONSUMABLE_BAR_SLOTS, CONSUMABLE_KIND_ORDER } from './consumable_bar_view';

export type ConsumableBarLayout = (string | null)[];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConsumableItemInfo {
  kind: string;
}

export interface ConsumableBarPreferencesOptions {
  storage: StorageLike;
  scope: string;
  lookup: (itemId: string) => ConsumableItemInfo | undefined;
}

export interface ConsumableBarAssignmentResult {
  ok: boolean;
  saved: boolean;
  layout: ConsumableBarLayout | null;
}

export interface ConsumableBarPreferences {
  layout(): ConsumableBarLayout | null;
  assign(
    itemId: string,
    slotIndex: number,
    automaticSeed: readonly (string | null)[],
  ): ConsumableBarAssignmentResult;
  reset(): boolean;
}

const VERSION = 1;
const VALID_KINDS = new Set<string>(CONSUMABLE_KIND_ORDER);

export function consumableBarPreferenceKey(scope: string): string {
  return `woc.mobileConsumables.${scope}`;
}

function cloneLayout(layout: readonly (string | null)[]): ConsumableBarLayout {
  return Array.from({ length: CONSUMABLE_BAR_SLOTS }, (_, index) => layout[index] ?? null);
}

function isValidLayout(
  value: unknown,
  lookup: ConsumableBarPreferencesOptions['lookup'],
): value is ConsumableBarLayout {
  if (!Array.isArray(value) || value.length !== CONSUMABLE_BAR_SLOTS) return false;
  const seen = new Set<string>();
  for (const itemId of value) {
    if (itemId === null) continue;
    if (typeof itemId !== 'string' || seen.has(itemId)) return false;
    const item = lookup(itemId);
    if (!item || !VALID_KINDS.has(item.kind)) return false;
    seen.add(itemId);
  }
  return true;
}

function loadLayout(
  options: ConsumableBarPreferencesOptions,
  key: string,
): ConsumableBarLayout | null {
  try {
    const raw = options.storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; slots?: unknown };
    if (parsed.version !== VERSION || !isValidLayout(parsed.slots, options.lookup)) return null;
    return cloneLayout(parsed.slots);
  } catch {
    return null;
  }
}

export function createConsumableBarPreferences(
  options: ConsumableBarPreferencesOptions,
): ConsumableBarPreferences {
  const key = consumableBarPreferenceKey(options.scope);
  let customLayout = loadLayout(options, key);

  const save = (): boolean => {
    try {
      options.storage.setItem(key, JSON.stringify({ version: VERSION, slots: customLayout }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    layout: () => (customLayout ? [...customLayout] : null),
    assign: (itemId, slotIndex, automaticSeed) => {
      const item = options.lookup(itemId);
      if (
        !Number.isInteger(slotIndex) ||
        slotIndex < 0 ||
        slotIndex >= CONSUMABLE_BAR_SLOTS ||
        !item ||
        !VALID_KINDS.has(item.kind)
      ) {
        return { ok: false, saved: false, layout: customLayout ? [...customLayout] : null };
      }

      const next = cloneLayout(customLayout ?? automaticSeed);
      const currentIndex = next.indexOf(itemId);
      if (currentIndex === slotIndex) next[slotIndex] = null;
      else {
        if (currentIndex >= 0) next[currentIndex] = null;
        next[slotIndex] = itemId;
      }
      customLayout = next;
      return { ok: true, saved: save(), layout: [...next] };
    },
    reset: () => {
      if (!customLayout) return false;
      customLayout = null;
      try {
        options.storage.removeItem(key);
      } catch {
        // Automatic mode still applies for the current session.
      }
      return true;
    },
  };
}

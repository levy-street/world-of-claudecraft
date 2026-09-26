// The Cooldown Manager's per-character localStorage record. Every read runs
// through the sanitizers in cooldown_manager_config.ts, so a corrupted or
// hand-edited save degrades to defaults rather than throwing. Keyed per
// class:name like the Auras panel store, so an alt keeps its own groups.

import {
  type CooldownGroup,
  type CooldownManagerLayout,
  type CooldownManagerLayoutPatch,
  type CooldownSpellConfig,
  type CooldownSpellPatch,
  sanitizeCooldownGroups,
  sanitizeCooldownManagerLayout,
  sanitizeCooldownSpellConfig,
} from './cooldown_manager_config';

/** The localStorage key prefix. The full settings export carries every key
 *  under it (src/ui/settings_transfer_core.ts FULL_KEY_PREFIXES). */
export const COOLDOWN_MANAGER_STORE_PREFIX = 'woc_cooldown_manager:';

/** An aura seen on the player, remembered so the picker can offer it. */
export interface SeenCooldownAura {
  id: string;
  kind: string;
  /** The English name the sim minted it with (localized at paint time). */
  name: string;
}

/** Seen auras kept per character; the oldest drop first past this. */
export const SEEN_AURAS_MAX = 200;
const SEEN_ID_RE = /^[a-z0-9_]{1,64}$/;

export function sanitizeSeenAuras(raw: unknown): SeenCooldownAura[] {
  if (!Array.isArray(raw)) return [];
  const out: SeenCooldownAura[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, kind, name } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !SEEN_ID_RE.test(id) || out.some((seen) => seen.id === id)) {
      continue;
    }
    if (typeof kind !== 'string' || !SEEN_ID_RE.test(kind)) continue;
    out.push({ id, kind, name: typeof name === 'string' ? name.slice(0, 80) : id });
  }
  return out.slice(-SEEN_AURAS_MAX);
}

interface StoredCooldownManager {
  groups?: unknown;
  seen?: unknown;
  layout?: unknown;
  spells?: Record<string, unknown>;
}

export class CooldownManagerStore {
  private readonly key: string;
  private data: StoredCooldownManager;

  constructor(
    scope: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
  ) {
    this.key = `${COOLDOWN_MANAGER_STORE_PREFIX}${scope}`;
    this.data = this.load();
  }

  private load(): StoredCooldownManager {
    try {
      const raw: unknown = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as StoredCooldownManager)
        : {};
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data));
    } catch {
      // Storage can be unavailable in privacy modes. Session state still works.
    }
  }

  getGroups(): CooldownGroup[] {
    return sanitizeCooldownGroups(this.data.groups);
  }

  setGroups(groups: readonly CooldownGroup[]): CooldownGroup[] {
    const next = sanitizeCooldownGroups(groups);
    this.data = { ...this.data, groups: next };
    this.save();
    return next;
  }

  getSeen(): SeenCooldownAura[] {
    return sanitizeSeenAuras(this.data.seen);
  }

  /** Remember one more aura; returns the stored list (oldest dropped past the cap). */
  addSeen(aura: SeenCooldownAura): SeenCooldownAura[] {
    const next = sanitizeSeenAuras([...this.getSeen(), aura]);
    this.data = { ...this.data, seen: next };
    this.save();
    return next;
  }

  getLayout(): CooldownManagerLayout {
    return sanitizeCooldownManagerLayout(this.data.layout);
  }

  patchLayout(patch: CooldownManagerLayoutPatch): CooldownManagerLayout {
    const next = sanitizeCooldownManagerLayout({ ...this.getLayout(), ...patch });
    this.data = { ...this.data, layout: next };
    this.save();
    return { ...next };
  }

  getSpell(id: string): CooldownSpellConfig {
    return sanitizeCooldownSpellConfig(this.data.spells?.[id]);
  }

  patchSpell(id: string, patch: CooldownSpellPatch): CooldownSpellConfig {
    const next = sanitizeCooldownSpellConfig({ ...this.getSpell(id), ...patch });
    this.data = { ...this.data, spells: { ...(this.data.spells ?? {}), [id]: next } };
    this.save();
    return { ...next };
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

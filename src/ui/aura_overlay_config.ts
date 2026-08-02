import type { AuraOverlayProcId, MageProcId, WarriorProcId } from './aura_overlay_view';
import { auraOverlayDefaultMeta } from './aura_overlay_view';

export interface AuraOverlayConfig {
  enabled: boolean;
  showIcon: boolean;
  showArcs: boolean;
  showGroundRing: boolean;
  iconPosX: number;
  iconPosY: number;
  arcsPosX: number;
  arcsPosY: number;
  opacity: number;
  scale: number;
  arcsScale: number;
  groundScale: number;
  groundOrder: number;
  color: string;
}

export type AuraOverlayPatch = Partial<AuraOverlayConfig>;

export interface AuraOverlayLayoutConfig {
  crescentBlockScale: number;
  groundRingBlockScale: number;
}

export type AuraOverlayLayoutPatch = Partial<AuraOverlayLayoutConfig>;

export type AuraOverlayVisualSlot = Pick<AuraOverlayConfig, 'arcsScale' | 'groundOrder'>;

export function auraOverlayVisualSlot(config: AuraOverlayConfig): AuraOverlayVisualSlot {
  return {
    arcsScale: config.arcsScale,
    groundOrder: config.groundOrder,
  };
}

const STORE_PREFIX = 'woc_aura_overlays:';
const DEFAULT_ICON_Y = 0.7;
const DEFAULT_ICON_SCALE = 0.8;
const LAYOUT_VERSION = 8;
const DEFAULT_OVERLAY_LAYOUT: AuraOverlayLayoutConfig = {
  crescentBlockScale: 1,
  groundRingBlockScale: 1,
};

interface AuraOverlayDefaultLayout {
  arcsScale: number;
  color: string;
}

const DEFAULT_LAYOUT: Record<WarriorProcId, AuraOverlayDefaultLayout> = {
  revenge_free: { arcsScale: 0.8, color: '#ffe14d' },
  battle_trance: { arcsScale: 0.9, color: '#3dc7ff' },
  raised_guard: { arcsScale: 1, color: '#bd63ff' },
  iron_resolve: { arcsScale: 1.1, color: '#ffe14d' },
  overpower_charge: { arcsScale: 1.2, color: '#3dc7ff' },
  sudden_death: { arcsScale: 1.3, color: '#bd63ff' },
  victory_rush: { arcsScale: 1.4, color: '#ffe14d' },
  enrage: { arcsScale: 1.5, color: '#3dc7ff' },
};

const MAGE_DEFAULT_LAYOUT: Record<MageProcId, AuraOverlayDefaultLayout> = {
  heating_up: { arcsScale: 0.9, color: '#ff4b2b' },
  hot_streak: { arcsScale: 1.1, color: '#ffd43b' },
  fingers_of_frost: { arcsScale: 0.9, color: '#59d8ff' },
  brain_freeze: { arcsScale: 1.1, color: '#4d8dff' },
  arcane_charge: { arcsScale: 0.8, color: '#8b5cf6' },
  aether_rush: { arcsScale: 1, color: '#d946ef' },
  perfect_moment: { arcsScale: 1.2, color: '#6d28d9' },
};

const ALL_DEFAULT_LAYOUT: Readonly<Record<string, AuraOverlayDefaultLayout>> = {
  ...DEFAULT_LAYOUT,
  ...MAGE_DEFAULT_LAYOUT,
};

const WARRIOR_ICON_X: Readonly<Record<WarriorProcId, number>> = {
  revenge_free: 0.44,
  battle_trance: 0.44,
  raised_guard: 0.5,
  iron_resolve: 0.56,
  overpower_charge: 0.5,
  sudden_death: 0.56,
  victory_rush: 0.47,
  enrage: 0.53,
};
const MAGE_ICON_X: Readonly<Record<MageProcId, number>> = {
  heating_up: 0.47,
  hot_streak: 0.53,
  fingers_of_frost: 0.47,
  brain_freeze: 0.53,
  arcane_charge: 0.44,
  aether_rush: 0.5,
  perfect_moment: 0.56,
};
const WARRIOR_GROUND_ORDER = Object.fromEntries(
  (Object.keys(WARRIOR_ICON_X) as WarriorProcId[]).map((id, index) => [id, index]),
) as Readonly<Record<WarriorProcId, number>>;
const MAGE_GROUND_ORDER = Object.fromEntries(
  (Object.keys(MAGE_ICON_X) as MageProcId[]).map((id, index) => [id, index]),
) as Readonly<Record<MageProcId, number>>;
const GENERIC_ICON_X = [0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68] as const;
const GENERIC_PALETTES: Readonly<Record<string, readonly string[]>> = {
  paladin: ['#facc15', '#fff7cc', '#fde047', '#f59e0b', '#f8fafc', '#eab308', '#fff7cc'],
  hunter: ['#65a30d', '#22c55e', '#f5b942', '#84cc16', '#d97706', '#16a34a', '#facc15'],
  rogue: ['#facc15', '#ef4444', '#7c3aed', '#f97316', '#dc2626', '#a855f7', '#facc15'],
  priest: ['#fde68a', '#facc15', '#c4b5fd', '#a78bfa', '#f8fafc', '#e9d5ff', '#ffffff'],
  shaman: ['#22d3ee', '#a3e635', '#60a5fa', '#f97316', '#14b8a6', '#38bdf8', '#0ea5e9'],
  warlock: ['#84cc16', '#7c3aed', '#f97316', '#22c55e', '#c026d3', '#a855f7', '#65a30d'],
  druid: ['#22c55e', '#f59e0b', '#60a5fa', '#16a34a', '#84cc16', '#a78bfa', '#eab308'],
};

function genericDefaultLayout(id: AuraOverlayProcId): AuraOverlayDefaultLayout {
  const meta = auraOverlayDefaultMeta(id);
  if (!meta) return { arcsScale: 1, color: '#ffe14d' };
  const slot = Math.min(GENERIC_ICON_X.length - 1, Math.max(0, meta.slot));
  return {
    arcsScale: Math.round(Math.min(1.4, 0.8 + slot * 0.1) * 10) / 10,
    color: GENERIC_PALETTES[meta.playerClass]?.[slot] ?? '#ffe14d',
  };
}

function defaultLayout(id: AuraOverlayProcId): AuraOverlayDefaultLayout {
  return ALL_DEFAULT_LAYOUT[id] ?? genericDefaultLayout(id);
}

function defaultIconX(id: AuraOverlayProcId): number {
  const warriorX = WARRIOR_ICON_X[id as WarriorProcId];
  if (warriorX !== undefined) return warriorX;
  const mageX = MAGE_ICON_X[id as MageProcId];
  if (mageX !== undefined) return mageX;
  const slot = auraOverlayDefaultMeta(id)?.slot ?? 3;
  return GENERIC_ICON_X[Math.min(GENERIC_ICON_X.length - 1, Math.max(0, slot))];
}

function defaultGroundOrder(id: AuraOverlayProcId): number {
  const warriorOrder = WARRIOR_GROUND_ORDER[id as WarriorProcId];
  if (warriorOrder !== undefined) return warriorOrder;
  const mageOrder = MAGE_GROUND_ORDER[id as MageProcId];
  if (mageOrder !== undefined) return mageOrder;
  return auraOverlayDefaultMeta(id)?.slot ?? 0;
}

export function defaultAuraOverlayConfig(id: AuraOverlayProcId): AuraOverlayConfig {
  const layout = defaultLayout(id);
  return {
    enabled: false,
    showIcon: true,
    showArcs: false,
    showGroundRing: true,
    iconPosX: defaultIconX(id),
    iconPosY: DEFAULT_ICON_Y,
    arcsPosX: 0.5,
    arcsPosY: 0.56,
    opacity: 0.7,
    scale: DEFAULT_ICON_SCALE,
    arcsScale: layout.arcsScale,
    groundScale: 1,
    groundOrder: defaultGroundOrder(id),
    color: layout.color,
  };
}

function numberIn(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function colorOr(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

export function sanitizeAuraOverlayConfig(id: AuraOverlayProcId, raw: unknown): AuraOverlayConfig {
  const fallback = defaultAuraOverlayConfig(id);
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enabled: boolOr(value.enabled, fallback.enabled),
    showIcon: boolOr(value.showIcon, fallback.showIcon),
    showArcs: boolOr(value.showArcs, fallback.showArcs),
    showGroundRing: boolOr(value.showGroundRing, fallback.showGroundRing),
    iconPosX: numberIn(value.iconPosX, 0, 1, fallback.iconPosX),
    iconPosY: numberIn(value.iconPosY, 0, 1, fallback.iconPosY),
    arcsPosX: numberIn(value.arcsPosX, 0, 1, fallback.arcsPosX),
    arcsPosY: numberIn(value.arcsPosY, 0, 1, fallback.arcsPosY),
    opacity: numberIn(value.opacity, 0.25, 1, fallback.opacity),
    scale: numberIn(value.scale, 0.65, 1.6, fallback.scale),
    arcsScale: numberIn(value.arcsScale, 0.65, 1.6, fallback.arcsScale),
    groundScale: numberIn(value.groundScale, 0.65, 1.6, fallback.groundScale),
    groundOrder: Math.round(numberIn(value.groundOrder, 0, 100, fallback.groundOrder)),
    color: colorOr(value.color, fallback.color),
  };
}

type StoredConfigs = {
  [id: string]: AuraOverlayConfig | AuraOverlayLayoutConfig | number | undefined;
  __layoutVersion?: number;
  __layout?: AuraOverlayLayoutConfig;
};

export class AuraOverlayConfigStore {
  private readonly key: string;
  private configs: StoredConfigs;

  constructor(scope: string) {
    this.key = `${STORE_PREFIX}${scope}`;
    this.configs = this.load();
  }

  private load(): StoredConfigs {
    const fresh = (): StoredConfigs => {
      const next: StoredConfigs = { __layoutVersion: LAYOUT_VERSION };
      try {
        localStorage.setItem(this.key, JSON.stringify(next));
      } catch {
        // Storage can be unavailable in privacy modes. Session state still works.
      }
      return next;
    };
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(this.key) ?? 'null');
    } catch {
      return fresh();
    }
    if (!raw || typeof raw !== 'object') return fresh();
    const configs = raw as StoredConfigs;
    if (configs.__layoutVersion !== LAYOUT_VERSION) return fresh();
    return configs;
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.configs));
    } catch {
      // Storage can be unavailable in privacy modes. Session state still works.
    }
  }

  get(id: AuraOverlayProcId): AuraOverlayConfig {
    return sanitizeAuraOverlayConfig(id, this.configs[id]);
  }

  getLayout(): AuraOverlayLayoutConfig {
    const raw = this.configs.__layout;
    return {
      crescentBlockScale: numberIn(
        raw?.crescentBlockScale,
        0.65,
        1.6,
        DEFAULT_OVERLAY_LAYOUT.crescentBlockScale,
      ),
      groundRingBlockScale: numberIn(
        raw?.groundRingBlockScale,
        0.65,
        1.6,
        DEFAULT_OVERLAY_LAYOUT.groundRingBlockScale,
      ),
    };
  }

  patchLayout(patch: AuraOverlayLayoutPatch): AuraOverlayLayoutConfig {
    const current = this.getLayout();
    const next = {
      crescentBlockScale: numberIn(patch.crescentBlockScale, 0.65, 1.6, current.crescentBlockScale),
      groundRingBlockScale: numberIn(
        patch.groundRingBlockScale,
        0.65,
        1.6,
        current.groundRingBlockScale,
      ),
    };
    this.configs = { ...this.configs, __layout: next };
    this.save();
    return { ...next };
  }

  patch(id: AuraOverlayProcId, patch: AuraOverlayPatch): AuraOverlayConfig {
    const next = sanitizeAuraOverlayConfig(id, { ...this.get(id), ...patch });
    this.configs = { ...this.configs, [id]: next };
    this.save();
    return { ...next };
  }

  reset(id: AuraOverlayProcId): AuraOverlayConfig {
    const next = defaultAuraOverlayConfig(id);
    this.configs = { ...this.configs, [id]: next };
    this.save();
    return { ...next };
  }

  resetPosition(id: AuraOverlayProcId): AuraOverlayConfig {
    const defaults = defaultAuraOverlayConfig(id);
    return this.patch(id, {
      iconPosX: defaults.iconPosX,
      iconPosY: defaults.iconPosY,
      arcsPosX: defaults.arcsPosX,
      arcsPosY: defaults.arcsPosY,
      groundOrder: defaults.groundOrder,
    });
  }
}

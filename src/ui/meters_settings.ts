// Player preferences, typography, profiles, and display customization for combat meters.
// Supports full Details!-style customization: window appearance, bar heights,
// fonts, textures, animation smoothing, number formatting, profile import/export, and presets.

export type MeterDensity = 'standard' | 'compact';
export type MeterOpacity = 'glass' | 'solid' | 'minimal' | 'transparent';
export type MeterNumberFormat = 'compact' | 'detailed' | 'damage_dps';
export type MeterBarTexture = 'smooth' | 'specular' | 'gradient';
export type MeterThemePreset =
  | 'custom'
  | 'details_glass'
  | 'classic'
  | 'minimal'
  | 'raid'
  | 'pro_gradient';
export type MeterFontFamily =
  | 'expressway'
  | 'alegreya_sans'
  | 'classic_serif'
  | 'cinzel'
  | 'monospace'
  | 'futura';

export interface MeterFontOption {
  id: MeterFontFamily;
  name: string;
  family: string;
  desc: string;
  sample: string;
}

export const FONT_OPTIONS: readonly MeterFontOption[] = [
  {
    id: 'expressway',
    name: 'Modern Gothic (Standard)',
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    desc: 'Clean, high readability and contrast. Standard combat meter typography.',
    sample: '1. Warrior 145.2k (14.2k, 28%)',
  },
  {
    id: 'alegreya_sans',
    name: 'Alegreya Sans (WoC HUD)',
    family: 'var(--font-ui)',
    desc: 'Canonical interface typography for World of ClaudeCraft.',
    sample: '1. Chronomancer 138.9k (13.5k, 26%)',
  },
  {
    id: 'classic_serif',
    name: 'Classic Serif',
    family: 'Georgia, "Palatino Linotype", Palatino, serif',
    desc: 'Elegant serif font inspired by classic fantasy RPG interfaces.',
    sample: '1. Paladin 124.6k (12.1k, 24%)',
  },
  {
    id: 'cinzel',
    name: 'Cinzel (Heraldic Fantasy)',
    family: 'var(--font-display)',
    desc: 'Epic medieval display font for roleplay immersion.',
    sample: '1. Mage 118.4k (11.6k, 22%)',
  },
  {
    id: 'monospace',
    name: 'Mono Tabular (Zero Jitter)',
    family: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace',
    desc: 'Fixed width: numbers and columns stay completely stable in combat.',
    sample: '1. Rogue 152.0k (15.0k, 29%)',
  },
  {
    id: 'futura',
    name: 'Futura Bold (High Impact)',
    family: '"Trebuchet MS", "Arial Black", system-ui, sans-serif',
    desc: 'High-impact bold typography for large screens and readability at distance.',
    sample: '1. Hunter 112.3k (11.0k, 21%)',
  },
];

export interface MetersSettings {
  // Window & Background
  density: MeterDensity;
  opacity: MeterOpacity;
  backgroundAlpha: number;
  locked: boolean;
  windowScale: number;

  // Typography
  fontFamily: MeterFontFamily;

  // Bars & Textures
  barHeight: number;
  barSpacing: number;
  barTexture: MeterBarTexture;
  barAnimation: boolean;
  alwaysShowMe: boolean;

  // Text & Formatting
  numberFormat: MeterNumberFormat;
  showDps: boolean;
  showPercent: boolean;
  showRank: boolean;
  showClassIcon: boolean;

  // Header
  showRaidTotals: boolean;
  showTitleBar: boolean;

  // Combat & Limits
  maxVisibleRows: number; // 0 = auto/unlimited
  includeShieldsInHeal: boolean;

  // Theme
  themePreset: MeterThemePreset;
}

export const METERS_SETTINGS_STORAGE_KEY = 'woc_meters_settings_v1';
export const METERS_PROFILES_STORAGE_KEY = 'woc_meters_profiles_v1';
export const METERS_ACTIVE_PROFILE_KEY = 'woc_meters_active_profile_v1';

export const DEFAULT_METERS_SETTINGS: Readonly<MetersSettings> = {
  density: 'standard',
  opacity: 'glass',
  backgroundAlpha: 76,
  locked: false,
  windowScale: 100,
  fontFamily: 'expressway',
  barHeight: 20,
  barSpacing: 1,
  barTexture: 'specular',
  barAnimation: true,
  alwaysShowMe: true,
  numberFormat: 'compact',
  showDps: true,
  showPercent: true,
  showRank: true,
  showClassIcon: true,
  showRaidTotals: true,
  showTitleBar: true,
  maxVisibleRows: 0,
  includeShieldsInHeal: true,
  themePreset: 'details_glass',
};

export const PRESETS: Record<Exclude<MeterThemePreset, 'custom'>, Partial<MetersSettings>> = {
  details_glass: {
    density: 'standard',
    opacity: 'glass',
    backgroundAlpha: 76,
    fontFamily: 'expressway',
    barHeight: 20,
    barSpacing: 1,
    barTexture: 'specular',
    barAnimation: true,
    alwaysShowMe: true,
    numberFormat: 'compact',
    showDps: true,
    showPercent: true,
    showRank: true,
    showClassIcon: true,
    showRaidTotals: true,
    showTitleBar: true,
    maxVisibleRows: 0,
    includeShieldsInHeal: true,
    themePreset: 'details_glass',
  },
  classic: {
    density: 'standard',
    opacity: 'solid',
    backgroundAlpha: 96,
    fontFamily: 'classic_serif',
    barHeight: 20,
    barSpacing: 1,
    barTexture: 'smooth',
    barAnimation: false,
    alwaysShowMe: false,
    numberFormat: 'detailed',
    showDps: true,
    showPercent: true,
    showRank: true,
    showClassIcon: true,
    showRaidTotals: false,
    showTitleBar: true,
    maxVisibleRows: 0,
    includeShieldsInHeal: true,
    themePreset: 'classic',
  },
  minimal: {
    density: 'compact',
    opacity: 'minimal',
    backgroundAlpha: 40,
    fontFamily: 'expressway',
    barHeight: 16,
    barSpacing: 0,
    barTexture: 'smooth',
    barAnimation: true,
    alwaysShowMe: true,
    numberFormat: 'compact',
    showDps: true,
    showPercent: false,
    showRank: false,
    showClassIcon: false,
    showRaidTotals: false,
    showTitleBar: true,
    maxVisibleRows: 6,
    includeShieldsInHeal: true,
    themePreset: 'minimal',
  },
  raid: {
    density: 'compact',
    opacity: 'glass',
    backgroundAlpha: 80,
    fontFamily: 'expressway',
    barHeight: 18,
    barSpacing: 1,
    barTexture: 'specular',
    barAnimation: true,
    alwaysShowMe: true,
    numberFormat: 'compact',
    showDps: true,
    showPercent: true,
    showRank: true,
    showClassIcon: true,
    showRaidTotals: true,
    showTitleBar: true,
    maxVisibleRows: 10,
    includeShieldsInHeal: true,
    themePreset: 'raid',
  },
  pro_gradient: {
    density: 'standard',
    opacity: 'transparent',
    backgroundAlpha: 0,
    fontFamily: 'expressway',
    barHeight: 22,
    barSpacing: 0,
    barTexture: 'gradient',
    barAnimation: true,
    alwaysShowMe: true,
    numberFormat: 'damage_dps',
    showDps: true,
    showPercent: false,
    showRank: false,
    showClassIcon: true,
    showRaidTotals: false,
    showTitleBar: true,
    maxVisibleRows: 0,
    includeShieldsInHeal: true,
    themePreset: 'pro_gradient',
  },
};

export function loadMetersSettings(storage?: Pick<Storage, 'getItem' | 'setItem'>): MetersSettings {
  if (!storage) return { ...DEFAULT_METERS_SETTINGS };
  try {
    const raw = storage.getItem(METERS_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_METERS_SETTINGS };
    const parsed = JSON.parse(raw);
    const d = DEFAULT_METERS_SETTINGS;
    const fontValid = FONT_OPTIONS.some((f) => f.id === parsed.fontFamily);
    return {
      density: parsed.density === 'compact' ? 'compact' : 'standard',
      opacity:
        parsed.opacity === 'solid' ||
        parsed.opacity === 'minimal' ||
        parsed.opacity === 'transparent'
          ? parsed.opacity
          : 'glass',
      backgroundAlpha:
        typeof parsed.backgroundAlpha === 'number' ? parsed.backgroundAlpha : d.backgroundAlpha,
      locked: typeof parsed.locked === 'boolean' ? parsed.locked : d.locked,
      windowScale: typeof parsed.windowScale === 'number' ? parsed.windowScale : d.windowScale,
      fontFamily: fontValid ? parsed.fontFamily : d.fontFamily,
      barHeight: typeof parsed.barHeight === 'number' ? parsed.barHeight : d.barHeight,
      barSpacing: typeof parsed.barSpacing === 'number' ? parsed.barSpacing : d.barSpacing,
      barTexture:
        parsed.barTexture === 'smooth' || parsed.barTexture === 'gradient'
          ? parsed.barTexture
          : 'specular',
      barAnimation: typeof parsed.barAnimation === 'boolean' ? parsed.barAnimation : d.barAnimation,
      alwaysShowMe: typeof parsed.alwaysShowMe === 'boolean' ? parsed.alwaysShowMe : d.alwaysShowMe,
      numberFormat:
        parsed.numberFormat === 'detailed' || parsed.numberFormat === 'damage_dps'
          ? parsed.numberFormat
          : 'compact',
      showDps: typeof parsed.showDps === 'boolean' ? parsed.showDps : d.showDps,
      showPercent: typeof parsed.showPercent === 'boolean' ? parsed.showPercent : d.showPercent,
      showRank: typeof parsed.showRank === 'boolean' ? parsed.showRank : d.showRank,
      showClassIcon:
        typeof parsed.showClassIcon === 'boolean' ? parsed.showClassIcon : d.showClassIcon,
      showRaidTotals:
        typeof parsed.showRaidTotals === 'boolean' ? parsed.showRaidTotals : d.showRaidTotals,
      showTitleBar: typeof parsed.showTitleBar === 'boolean' ? parsed.showTitleBar : d.showTitleBar,
      maxVisibleRows:
        typeof parsed.maxVisibleRows === 'number' ? parsed.maxVisibleRows : d.maxVisibleRows,
      includeShieldsInHeal:
        typeof parsed.includeShieldsInHeal === 'boolean'
          ? parsed.includeShieldsInHeal
          : d.includeShieldsInHeal,
      themePreset:
        parsed.themePreset in PRESETS || parsed.themePreset === 'custom'
          ? parsed.themePreset
          : d.themePreset,
    };
  } catch {
    return { ...DEFAULT_METERS_SETTINGS };
  }
}

export function saveMetersSettings(
  settings: Partial<MetersSettings>,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  if (!storage) return;
  try {
    storage.setItem(METERS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage quota or restricted context; fail gracefully
  }
}

export function loadProfiles(
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): Record<string, MetersSettings> {
  const defaults: Record<string, MetersSettings> = {
    Default: { ...DEFAULT_METERS_SETTINGS },
    'Pro Gradient': {
      ...DEFAULT_METERS_SETTINGS,
      ...PRESETS.pro_gradient,
    },
    'Banda / Raid': {
      ...DEFAULT_METERS_SETTINGS,
      ...PRESETS.raid,
    },
    Minimalista: {
      ...DEFAULT_METERS_SETTINGS,
      ...PRESETS.minimal,
    },
    'WoW Clasico': {
      ...DEFAULT_METERS_SETTINGS,
      ...PRESETS.classic,
    },
  };
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(METERS_PROFILES_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return { ...defaults, ...parsed };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveProfiles(
  profiles: Record<string, MetersSettings>,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  if (!storage) return;
  try {
    storage.setItem(METERS_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore quota errors
  }
}

export function getActiveProfileName(storage?: Pick<Storage, 'getItem' | 'setItem'>): string {
  if (!storage) return 'Default';
  try {
    return storage.getItem(METERS_ACTIVE_PROFILE_KEY) || 'Default';
  } catch {
    return 'Default';
  }
}

export function setActiveProfileName(
  name: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  if (!storage) return;
  try {
    storage.setItem(METERS_ACTIVE_PROFILE_KEY, name);
  } catch {
    // Ignore quota errors
  }
}

export function exportProfileString(settings: MetersSettings): string {
  const json = JSON.stringify(settings);
  const encoded =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json).toString('base64');
  return `!WoC-Details:${encoded}`;
}

export function importProfileString(str: string): MetersSettings | null {
  if (!str || !str.trim()) return null;
  const trimmed = str.trim();
  let jsonStr = '';
  if (trimmed.startsWith('!WoC-Details:')) {
    const b64 = trimmed.slice(13);
    try {
      jsonStr =
        typeof atob === 'function'
          ? decodeURIComponent(escape(atob(b64)))
          : Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    jsonStr = trimmed;
  } else {
    try {
      jsonStr =
        typeof atob === 'function'
          ? decodeURIComponent(escape(atob(trimmed)))
          : Buffer.from(trimmed, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;
    const mockStorage = {
      getItem: () => jsonStr,
      setItem: () => {},
    };
    return loadMetersSettings(mockStorage);
  } catch {
    return null;
  }
}

export function applySettingsClasses(el: HTMLElement, settings: Partial<MetersSettings>): void {
  if (settings.density !== undefined || settings.barHeight !== undefined) {
    el.classList.toggle(
      'mt-compact',
      settings.density === 'compact' ||
        (settings.barHeight !== undefined && settings.barHeight <= 16),
    );
  }
  if (settings.opacity !== undefined || settings.backgroundAlpha !== undefined) {
    const isExplicitTransparent =
      settings.opacity === 'transparent' || settings.backgroundAlpha === 0;
    el.classList.toggle('mt-opacity-glass', settings.opacity === 'glass' && !isExplicitTransparent);
    el.classList.toggle('mt-opacity-solid', settings.opacity === 'solid' && !isExplicitTransparent);
    el.classList.toggle(
      'mt-opacity-minimal',
      settings.opacity === 'minimal' && !isExplicitTransparent,
    );
    el.classList.toggle('mt-opacity-transparent', isExplicitTransparent);
  }

  if (settings.barTexture !== undefined) {
    el.classList.toggle('mt-tex-smooth', settings.barTexture === 'smooth');
    el.classList.toggle('mt-tex-specular', settings.barTexture === 'specular');
    el.classList.toggle('mt-tex-gradient', settings.barTexture === 'gradient');
  }
  if (settings.barAnimation !== undefined) {
    el.classList.toggle('mt-anim-none', !settings.barAnimation);
  }
  if (settings.showTitleBar !== undefined) {
    el.classList.toggle('mt-no-title', !settings.showTitleBar);
  }
  if (settings.showRank !== undefined) {
    el.classList.toggle('mt-hide-rank', !settings.showRank);
  }
  if (settings.showPercent !== undefined) {
    el.classList.toggle('mt-hide-pct', !settings.showPercent);
  }
  if (settings.showDps !== undefined) {
    el.classList.toggle('mt-hide-dps', !settings.showDps);
  }
  if (settings.showClassIcon !== undefined) {
    el.classList.toggle('mt-hide-icons', !settings.showClassIcon);
  }
  if (settings.locked !== undefined) {
    el.classList.toggle('mt-locked', !!settings.locked);
  }

  if (settings.fontFamily) {
    const f = FONT_OPTIONS.find((opt) => opt.id === settings.fontFamily) ?? FONT_OPTIONS[0];
    el.style.setProperty('--mt-font-family', f.family);
  }

  if (settings.barHeight) {
    el.style.setProperty('--mt-bar-h', `${settings.barHeight}px`);
  }
  if (typeof settings.barSpacing === 'number') {
    el.style.setProperty('--mt-bar-gap', `${settings.barSpacing}px`);
  }
  if (typeof settings.backgroundAlpha === 'number') {
    el.style.setProperty('--mt-bg-alpha', `${settings.backgroundAlpha}%`);
    el.style.setProperty('--mt-bg-alpha-ratio', `${settings.backgroundAlpha / 100}`);
  }
  if (settings.windowScale && settings.windowScale !== 100) {
    el.style.setProperty('--mt-scale', `${settings.windowScale / 100}`);
  } else if (settings.windowScale === 100) {
    el.style.removeProperty('--mt-scale');
  }
}

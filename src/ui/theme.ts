// In-game UI theming — pure, host-agnostic core (no DOM imports).
//
// A theme is a small set of semantic colour "knobs" (accent, border, panel
// base, two text shades, four resource-bar colours). Curated presets are full
// knob maps; the player may additionally override any knob (the "custom"
// layer). `resolveTheme` merges preset + custom into the effective knobs, and
// `themeCssVars` expands those knobs into the concrete `--var: value` pairs the
// stylesheet consumes — deriving secondary accent/scrollbar colours so a single
// accent tweak stays visually coherent.
//
// The DOM bridge (main.ts) just loops the returned map through
// `documentElement.style.setProperty`, exactly like the existing comfort
// settings. Nothing here touches the sim, the wire, or balance.

export type ThemeKnob =
  | 'accent'
  | 'border'
  | 'panel'
  | 'text'
  | 'textMuted'
  | 'hp'
  | 'mana'
  | 'rage'
  | 'energy';

export type ThemeKnobs = Record<ThemeKnob, string>;

export type PresetId = 'classic' | 'midnight' | 'parchment' | 'highContrast';

export interface ThemeState {
  preset: PresetId;
  /** Per-knob overrides layered over the preset; absent knobs fall through. */
  custom: Partial<ThemeKnobs>;
}

// Order is the display order of the custom-colour pickers in Options.
export const THEME_KNOB_ORDER: ThemeKnob[] = [
  'accent',
  'border',
  'panel',
  'text',
  'textMuted',
  'hp',
  'mana',
  'rage',
  'energy',
];

// i18n sub-keys (under hudChrome.theme.knob.*) for each knob's label.
export const THEME_KNOB_LABEL_KEY: Record<ThemeKnob, string> = {
  accent: 'accent',
  border: 'border',
  panel: 'panel',
  text: 'text',
  textMuted: 'textMuted',
  hp: 'hp',
  mana: 'mana',
  rage: 'rage',
  energy: 'energy',
};

export const PRESET_ORDER: PresetId[] = ['classic', 'midnight', 'parchment', 'highContrast'];

// `classic` reproduces the shipped gold/dark palette; the others are alternates.
export const THEME_PRESETS: Record<PresetId, ThemeKnobs> = {
  classic: {
    accent: '#ffd100',
    border: '#6f5a2a',
    panel: '#15151f',
    text: '#f0ebd8',
    textMuted: '#998d6a',
    hp: '#1eb838',
    mana: '#2b7bd4',
    rage: '#c0392b',
    energy: '#e4c531',
  },
  midnight: {
    accent: '#8fb8e8',
    border: '#3a4a66',
    panel: '#0e1420',
    text: '#dce6f2',
    textMuted: '#7f8ca3',
    hp: '#2ec27e',
    mana: '#4a90d9',
    rage: '#d96459',
    energy: '#e0c84f',
  },
  parchment: {
    accent: '#8a5a1a',
    border: '#b89a5e',
    panel: '#ece0c4',
    text: '#2e2410',
    textMuted: '#6b5d3e',
    hp: '#2f8f3a',
    mana: '#2f6fb0',
    rage: '#b03a2e',
    energy: '#a8801f',
  },
  highContrast: {
    accent: '#ffe000',
    border: '#ffffff',
    panel: '#000000',
    text: '#ffffff',
    textMuted: '#d0d0d0',
    hp: '#00e000',
    mana: '#00b0ff',
    rage: '#ff3030',
    energy: '#ffe000',
  },
};

export const DEFAULT_PRESET: PresetId = 'classic';
export const DEFAULT_THEME: ThemeState = { preset: DEFAULT_PRESET, custom: {} };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix `hex` toward `target` by `t` (0 = hex, 1 = target). Pure. */
export function mixHex(hex: string, target: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// --- WCAG contrast (sRGB relative luminance + ratio) -----------------------
// Pure helpers so the contrast guards below (and the unit tests) never need a
// DOM. Follows WCAG 2.1: linearize each channel, weight, then ratio with the
// +0.05 flare term.

function srgbChannel(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance in [0,1] for a #rrggbb colour. Pure. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** WCAG contrast ratio (>=1) between two #rrggbb colours. Pure. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** True when `panel` reads as a light surface (so text should go dark). */
export function isLightPanel(hex: string): boolean {
  return relativeLuminance(hex) > 0.4;
}

/** `rgba(...)` string from a hex colour and an alpha in [0,1]. Pure. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Minimum body-text contrast we will let a resolved theme ship with. */
export const MIN_TEXT_CONTRAST = 4.5;
/** Minimum contrast for muted/secondary and accent (large-text tier). */
export const MIN_LARGE_CONTRAST = 3;

/**
 * Repair a text colour so it clears `min` contrast against `panel`. We keep the
 * caller's hue when it already passes; otherwise we step it toward whichever of
 * black/white the panel contrasts with best until it clears (or fall back to
 * that pole). Pure, so the custom-override guard is unit-testable.
 */
export function ensureReadable(textHex: string, panelHex: string, min: number): string {
  if (contrastRatio(textHex, panelHex) >= min) return textHex;
  const pole = isLightPanel(panelHex) ? '#000000' : '#ffffff';
  if (contrastRatio(pole, panelHex) < min) return pole; // panel itself is mid-grey; best effort
  for (let t = 0.15; t < 1; t += 0.15) {
    const candidate = mixHex(textHex, pole, t);
    if (contrastRatio(candidate, panelHex) >= min) return candidate;
  }
  return pole;
}

/**
 * Effective knobs: the preset overlaid with any valid custom overrides, then a
 * contrast guard so a custom text/panel pair (e.g. white-on-white) can never
 * ship below AA. Both text shades are repaired against the resolved panel.
 */
export function resolveTheme(state: ThemeState): ThemeKnobs {
  const base = THEME_PRESETS[state.preset] ?? THEME_PRESETS[DEFAULT_PRESET];
  const out: ThemeKnobs = { ...base };
  for (const knob of THEME_KNOB_ORDER) {
    const v = state.custom[knob];
    if (isValidHex(v)) out[knob] = v;
  }
  out.text = ensureReadable(out.text, out.panel, MIN_TEXT_CONTRAST);
  out.textMuted = ensureReadable(out.textMuted, out.panel, MIN_LARGE_CONTRAST);
  return out;
}

/**
 * Expand the 9 knobs into the concrete CSS custom properties the stylesheet
 * reads. Secondary accent/scrollbar colours are derived so a lone accent change
 * still produces a coherent frame. Returns a plain map; the caller applies it.
 */
export function themeCssVars(knobs: ThemeKnobs): Record<string, string> {
  const { accent, border, panel, text, textMuted, hp, mana, rage, energy } = knobs;
  const accentDim = mixHex(accent, '#000000', 0.22);
  const lightPanel = isLightPanel(panel);
  // panelEdge: dark panels darken hard (the classic vignette); light panels only
  // tint slightly so body/muted/accent text stays above AA over the gradient's
  // bottom band instead of dropping onto a near-#827b6c mid-grey.
  const panelEdge = lightPanel ? mixHex(panel, '#000000', 0.14) : mixHex(panel, '#000000', 0.45);
  // A panel-aware gold: on a dark panel the raw accent reads fine, but a bright
  // accent on the light Parchment panel is gold-on-cream (sub-AA). Darken the
  // accent toward black until it clears the large-text tier against BOTH the
  // panel and its edge so accent values recolor and stay readable per preset.
  const colorGold = ensureReadable(
    ensureReadable(accent, panel, MIN_LARGE_CONTRAST),
    panelEdge,
    MIN_LARGE_CONTRAST,
  );
  // Overlay text sits over the 3D world (quest tracker), NOT a panel, so it must
  // stay light regardless of preset and lean on its text-shadow for contrast.
  const overlayText = '#f4eede';
  // High-Contrast Text draws a halo behind HUD labels via text-shadow. A dark
  // halo sharpens light text against a dark panel, but on a light panel
  // (Parchment) the body text is already dark, so a dark halo just blurs into
  // the glyph instead of separating it. The halo needs to sit on the opposite
  // side of the panel's lightness from the text, so flip it light there.
  const textOutline = lightPanel ? '#ffffff' : '#000000';
  return {
    '--gold': accent,
    '--gold-dim': accentDim,
    '--color-gold': colorGold,
    '--color-accent': colorGold,
    '--color-primary-glow': rgba(accent, 0.2),
    '--color-primary-glow-heavy': rgba(accent, 0.4),
    '--color-border-focus': accentDim,
    '--border': border,
    '--color-border-default': mixHex(border, '#000000', 0.25),
    '--panel-base': panel,
    '--panel-bg': `linear-gradient(170deg, ${rgba(panel, 0.95)} 0%, ${rgba(panelEdge, 0.95)} 60%, ${rgba(panelEdge, 0.95)} 100%)`,
    '--panel-edge': panelEdge,
    '--color-bg-dark': panelEdge,
    '--color-text-light': text,
    '--color-text-muted': textMuted,
    '--color-text-overlay': overlayText,
    '--text-outline-color': textOutline,
    '--scrollbar-thumb': mixHex(border, '#000000', 0.15),
    '--scrollbar-thumb-hover': border,
    '--scrollbar-border': border,
    '--color-hp': hp,
    '--color-mana': mana,
    '--color-rage': rage,
    '--color-energy': energy,
  };
}

/** Parse an untrusted persisted blob into a valid ThemeState. Never throws. */
export function parseTheme(raw: unknown): ThemeState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_THEME, custom: {} };
  const obj = raw as Record<string, unknown>;
  const preset = PRESET_ORDER.includes(obj.preset as PresetId)
    ? (obj.preset as PresetId)
    : DEFAULT_PRESET;
  const custom: Partial<ThemeKnobs> = {};
  const rawCustom = obj.custom;
  if (rawCustom && typeof rawCustom === 'object') {
    const c = rawCustom as Record<string, unknown>;
    for (const knob of THEME_KNOB_ORDER) {
      if (isValidHex(c[knob])) custom[knob] = c[knob] as string;
    }
  }
  return { preset, custom };
}

export function serializeTheme(state: ThemeState): string {
  return JSON.stringify({ preset: state.preset, custom: state.custom });
}

// --- Persistence ----------------------------------------------------------
// Dedicated localStorage store, mirroring the Keybinds pattern, so the
// numeric/bool `woc_settings` schema stays clean. Browser-only; the pure
// functions above carry all the logic and are what the unit tests cover.

const THEME_STORE_KEY = 'woc_theme';

export class ThemeStore {
  private state: ThemeState;

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(THEME_STORE_KEY) ?? 'null');
    } catch {
      /* corrupt */
    }
    this.state = parseTheme(raw);
  }

  get(): ThemeState {
    return { preset: this.state.preset, custom: { ...this.state.custom } };
  }

  /** Effective CSS variable map for the current state. */
  cssVars(): Record<string, string> {
    return themeCssVars(resolveTheme(this.state));
  }

  private save(): void {
    try {
      localStorage.setItem(THEME_STORE_KEY, serializeTheme(this.state));
    } catch {
      /* unavailable */
    }
  }

  setPreset(preset: PresetId): void {
    if (PRESET_ORDER.includes(preset)) {
      this.state.preset = preset;
      this.save();
    }
  }

  /** Set or (with null) clear one custom knob override. */
  setCustom(knob: ThemeKnob, value: string | null): void {
    if (value === null) delete this.state.custom[knob];
    else if (isValidHex(value)) this.state.custom[knob] = value;
    this.save();
  }

  /** Drop all custom overrides, falling back to the bare preset. */
  resetCustom(): void {
    this.state.custom = {};
    this.save();
  }
}

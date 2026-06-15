// Player-adjustable game settings (camera, audio, graphics) surfaced in the
// Esc options menu. Pure + persisted to localStorage; main.ts applies each
// value to the live subsystem (Input / GameAudio / MusicDirector / Renderer).

// Camera default is 0.7: the old fixed speed (1.0) was near the top of the
// reasonable range and drew complaints, so out of the box it's calmer while
// the slider still reaches 1.25 for players who liked it fast.
export const SETTING_RANGES = {
  cameraSpeed: { min: 0.25, max: 1.25, def: 0.7 },
  sfxVolume: { min: 0, max: 1, def: 0.8 },
  musicVolume: { min: 0, max: 1, def: 0.8 },
  brightness: { min: 0.6, max: 1.5, def: 1 },
  renderScale: { min: 0.5, max: 1, def: 1 },
  fullscreen: { min: 0, max: 1, def: 1 },
  // on by default: post-cap players see their overflow/virtual-level bar; turn
  // off for the classic static "MAX LEVEL" text (Max-Level XP Overflow)
  showOverflowXp: { min: 0, max: 1, def: 1 },
  // off by default: always-on click-to-move would disrupt the precise melee
  // positioning the team wanted to preserve, so it's opt-in (#95)
  clickToMove: { min: 0, max: 1, def: 0 },
} as const;

export const BOOL_SETTINGS = {
  mouseCamera: { def: false },
} as const;

export type NumericSettingKey = keyof typeof SETTING_RANGES;
export type BoolSettingKey = keyof typeof BOOL_SETTINGS;
export type GameSettings = { [K in NumericSettingKey]: number } & { [K in BoolSettingKey]: boolean };

interface Range { min: number; max: number; def: number }

const STORE_KEY = 'woc_settings';
const NUMERIC_KEYS = Object.keys(SETTING_RANGES) as NumericSettingKey[];
const BOOL_KEYS = Object.keys(BOOL_SETTINGS) as BoolSettingKey[];

function clampNumeric(key: NumericSettingKey, v: number): number {
  const r = SETTING_RANGES[key];
  if (!Number.isFinite(v)) return r.def;
  return Math.min(r.max, Math.max(r.min, v));
}

export class Settings {
  private values: GameSettings;

  constructor() {
    this.values = this.load();
  }

  private load(): GameSettings {
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { /* corrupt */ }
    const raw = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
    const out = {} as GameSettings;
    for (const key of NUMERIC_KEYS) {
      const v = raw[key];
      out[key] = typeof v === 'number' ? clampNumeric(key, v) : SETTING_RANGES[key].def;
    }
    for (const key of BOOL_KEYS) {
      const v = raw[key];
      out[key] = typeof v === 'boolean' ? v : BOOL_SETTINGS[key].def;
    }
    return out;
  }

  private save(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.values)); } catch { /* storage unavailable */ }
  }

  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.values[key];
  }

  all(): GameSettings {
    return { ...this.values };
  }

  /** Clamp + store a value; returns the value actually applied. */
  set<K extends NumericSettingKey>(key: K, value: number): number;
  set<K extends BoolSettingKey>(key: K, value: boolean): boolean;
  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): GameSettings[K] {
    if ((BOOL_KEYS as readonly string[]).includes(key)) {
      const v = !!value;
      (this.values as Record<string, unknown>)[key] = v;
      this.save();
      return v as GameSettings[K];
    }
    const v = clampNumeric(key as NumericSettingKey, value as number);
    (this.values as Record<string, unknown>)[key] = v;
    this.save();
    return v as GameSettings[K];
  }

  reset(): void {
    for (const key of NUMERIC_KEYS) this.values[key] = SETTING_RANGES[key].def;
    for (const key of BOOL_KEYS) this.values[key] = BOOL_SETTINGS[key].def;
    this.save();
  }
}

export type { Range };

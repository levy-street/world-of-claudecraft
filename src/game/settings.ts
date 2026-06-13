// Player-adjustable game settings (camera, audio, graphics) surfaced in the
// Esc options menu. Pure + persisted to localStorage; main.ts applies each
// value to the live subsystem (Input / GameAudio / MusicDirector / Renderer).

export interface GameSettings {
  cameraSpeed: number;  // mouse-look sensitivity multiplier (1 = the old fixed speed)
  sfxVolume: number;    // 0..1
  musicVolume: number;  // 0..1
  brightness: number;   // tone-mapping exposure multiplier
  renderScale: number;  // resolution multiplier on top of the device pixel ratio
}

interface Range { min: number; max: number; def: number }

// Camera default is 0.7: the old fixed speed (1.0) was near the top of the
// reasonable range and drew complaints, so out of the box it's calmer while
// the slider still reaches 1.25 for players who liked it fast.
export const SETTING_RANGES: Record<keyof GameSettings, Range> = {
  cameraSpeed: { min: 0.25, max: 1.25, def: 0.7 },
  sfxVolume: { min: 0, max: 1, def: 0.8 },
  musicVolume: { min: 0, max: 1, def: 0.8 },
  brightness: { min: 0.6, max: 1.5, def: 1 },
  renderScale: { min: 0.5, max: 1, def: 1 },
};

const STORE_KEY = 'woc_settings';
const KEYS = Object.keys(SETTING_RANGES) as (keyof GameSettings)[];

function clampSetting(key: keyof GameSettings, v: number): number {
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
    const out = {} as GameSettings;
    for (const key of KEYS) {
      const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[key] : undefined;
      out[key] = typeof raw === 'number' ? clampSetting(key, raw) : SETTING_RANGES[key].def;
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
  set<K extends keyof GameSettings>(key: K, value: number): number {
    const v = clampSetting(key, value);
    this.values[key] = v;
    this.save();
    return v;
  }

  reset(): void {
    for (const key of KEYS) this.values[key] = SETTING_RANGES[key].def;
    this.save();
  }
}

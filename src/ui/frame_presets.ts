import { LAYOUT_RESET_EPOCH, LAYOUT_RESET_EPOCH_KEY } from './frame_pos_reset';
import {
  decodeFramePreset,
  encodeFramePreset,
  FRAME_PRESET_LIMIT,
  FRAME_PRESET_SETTINGS,
  FRAME_PRESETS_KEY,
  FRAME_PRESETS_MAX_LENGTH,
  type FramePreset,
  framePresetGeometryKey,
  isFramePresetSetting,
  parseFramePresets,
} from './frame_presets_core';
import { clampUiScale } from './ui_scale';

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
/** Local, named snapshots. Applying replaces frame state while preserving other preferences. */
export class FramePresets {
  constructor(private readonly storage: Store) {}
  list(): (FramePreset | null)[] {
    try {
      return parseFramePresets(this.storage.getItem(FRAME_PRESETS_KEY));
    } catch {
      return parseFramePresets(null);
    }
  }
  active(): number {
    try {
      const index = JSON.parse(this.storage.getItem(FRAME_PRESETS_KEY) ?? '{}').active;
      return Number.isInteger(index) &&
        index >= 0 &&
        index < FRAME_PRESET_LIMIT &&
        this.list()[index]
        ? index
        : -1;
    } catch {
      return -1;
    }
  }
  private keys(): string[] {
    return Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i)).filter(
      (key): key is string => key !== null && framePresetGeometryKey(key),
    );
  }
  save(index: number, name: string): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= FRAME_PRESET_LIMIT) return false;
    try {
      const geometry: Record<string, string> = {};
      for (const key of this.keys()) {
        const value = this.storage.getItem(key);
        if (value !== null) geometry[key] = value;
      }
      const raw = JSON.parse(this.storage.getItem('woc_settings') ?? '{}');
      const settings = Object.fromEntries(
        Object.entries(raw).filter(([key]) => isFramePresetSetting(key)),
      );
      // Record even the default explicitly so each preset owns its UI scale.
      settings.uiScale = clampUiScale(raw.uiScale);
      const slots = this.list();
      slots[index] = { name: name.trim().slice(0, 40), geometry, settings } as FramePreset;
      const encoded = JSON.stringify({ v: 1, slots, active: index });
      if (encoded.length > FRAME_PRESETS_MAX_LENGTH) return false;
      this.storage.setItem(FRAME_PRESETS_KEY, encoded);
      return true;
    } catch {
      return false;
    }
  }
  export(index: number): string | null {
    const preset = this.list()[index];
    return preset ? encodeFramePreset(preset) : null;
  }
  import(code: string): number | null {
    const preset = decodeFramePreset(code);
    if (!preset) return null;
    try {
      const slots = this.list();
      const index = slots.findIndex((slot) => !slot);
      if (index < 0) return null;
      slots[index] = preset;
      const encoded = JSON.stringify({ v: 1, slots, active: this.active() });
      if (encoded.length > FRAME_PRESETS_MAX_LENGTH) return null;
      this.storage.setItem(FRAME_PRESETS_KEY, encoded);
      return index;
    } catch {
      return null;
    }
  }
  remove(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= FRAME_PRESET_LIMIT) return false;
    try {
      const slots = this.list();
      const active = this.active() === index ? -1 : this.active();
      slots[index] = null;
      this.storage.setItem(FRAME_PRESETS_KEY, JSON.stringify({ v: 1, slots, active }));
      return true;
    } catch {
      return false;
    }
  }
  apply(index: number): boolean {
    const preset = this.list()[index];
    if (!preset) return false;
    const previous = new Map<string, string | null>();
    try {
      const raw = JSON.parse(this.storage.getItem('woc_settings') ?? '{}');
      for (const key of FRAME_PRESET_SETTINGS) delete raw[key];
      Object.assign(raw, preset.settings);
      const changes = new Map<string, string | null>();
      for (const key of this.keys()) changes.set(key, null);
      for (const [key, value] of Object.entries(preset.geometry)) changes.set(key, value);
      changes.set('woc_settings', JSON.stringify(raw));
      changes.set(FRAME_PRESETS_KEY, JSON.stringify({ v: 1, slots: this.list(), active: index }));
      changes.set(LAYOUT_RESET_EPOCH_KEY, String(LAYOUT_RESET_EPOCH));
      for (const [key, value] of changes) {
        previous.set(key, this.storage.getItem(key));
        if (value === null) this.storage.removeItem(key);
        else this.storage.setItem(key, value);
      }
      return true;
    } catch {
      for (const [key, value] of previous) {
        try {
          if (value === null) this.storage.removeItem(key);
          else this.storage.setItem(key, value);
        } catch {
          /* unavailable storage */
        }
      }
      return false;
    }
  }
}

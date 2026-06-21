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
  // Pre-rendered NPC voice-line clips (public/audio/voice). Slightly louder than
  // SFX by default so dialogue reads over ambient combat noise.
  voiceVolume: { min: 0, max: 1, def: 0.9 },
  brightness: { min: 0.6, max: 1.5, def: 1 },
  // 1 low, 2 medium, 3 high, 4 ultra, 5 advanced. The renderer reads this
  // from localStorage during startup because tier choice controls preload.
  graphicsPreset: { min: 1, max: 5, def: 4 },
  // Advanced-only: 0 keeps terrain/foliage cheap, 1 enables high terrain.
  terrainDetail: { min: 0, max: 1, def: 1 },
  foliageDensity: { min: 0, max: 1, def: 1 },
  effectsQuality: { min: 0, max: 1, def: 1 },
  shadowQuality: { min: 0, max: 1, def: 1 },
  // vertical camera field of view in degrees. def 60 keeps the shipped look;
  // a wider FOV shows more of the world (good for situational awareness) while
  // a narrower one zooms in. Purely a comfort/visibility preference.
  cameraFov: { min: 55, max: 100, def: 60 },
  renderScale: { min: 0.5, max: 1, def: 1 },
  fullscreen: { min: 0, max: 1, def: 1 },
  // on by default: post-cap players see their overflow/virtual-level bar; turn
  // off for the classic static "MAX LEVEL" text (Max-Level XP Overflow)
  showOverflowXp: { min: 0, max: 1, def: 1 },
  // off by default: always-on click-to-move would disrupt the precise melee
  // positioning the team wanted to preserve, so it's opt-in (#95)
  clickToMove: { min: 0, max: 1, def: 0 },
  // 0 = left mouse button, 2 = right mouse button. Surfaced as a two-state
  // button in Key Bindings so click-to-move's trigger is remappable without
  // pretending mouse buttons are keyboard codes.
  clickToMoveButton: { min: 0, max: 2, def: 0 },
  // touch-only: scales the camera (look) joystick turn/pitch rate. The Camera
  // Speed slider only scales mouselook, so before this phones had no way to
  // tune look sensitivity; surfaced in Graphics only on phone touch devices.
  touchLookSpeed: { min: 0.4, max: 1.8, def: 1 },
  // 1.0 (fully opaque) by default; touch-only. Lets phone players dim the
  // on-screen joysticks + buttons so they obscure less of the world.
  touchOpacity: { min: 0.3, max: 1, def: 1 },
  // on by default: biome-driven ambient snow/rain. Stored 0/1 so it reuses the
  // existing settingToggle UI; players on weak machines can switch it off.
  weather: { min: 0, max: 1, def: 1 },
  // touch-only: scales both on-screen joysticks from their anchored corner so
  // players can size the thumb pads to their hands (0.7x–1.3x). 1.0 = stock.
  joystickScale: { min: 0.7, max: 1.3, def: 1 },
  // touch only: scale the on-screen action button cluster so players with
  // larger or smaller thumbs can size the controls to taste (default 1.0x).
  // Surfaced in the Esc menu only on phone-touch devices.
  actionButtonScale: { min: 0.8, max: 1.3, def: 1 },
  // touch-only: how far the move thumbstick must travel before it registers
  // movement. Higher values resist accidental drift on a jittery thumb; lower
  // values make the stick more responsive. Default matches the old fixed 0.22.
  joystickDeadzone: { min: 0.1, max: 0.4, def: 0.22 },

  // --- Interface & Comfort pack: presentational HUD tuning, applied via CSS
  // custom properties in main.ts. All default to 1.0 (unchanged look) and are
  // purely client-side display choices — they never touch the sim. ---
  // Scales the hover tooltip's text so small-screen / low-vision players can
  // read item & ability tooltips without squinting.
  tooltipScale: { min: 0.85, max: 1.5, def: 1 },
  // Scales the combat-log / chat text independently of tooltips.
  chatFontScale: { min: 0.85, max: 1.4, def: 1 },
  // Dims the chat frame's backdrop so it obscures less of the world (1 = the
  // classic opaque frame, lower = more see-through).
  chatOpacity: { min: 0.3, max: 1, def: 1 },
  // Scales floating combat text (the damage/heal numbers over units). Bigger
  // for readability on a TV; smaller to declutter a busy fight.
  fctScale: { min: 0.7, max: 1.8, def: 1 },
  // Fades the HUD panels & windows as a whole; lets players see more of the
  // world behind their frames without hiding them entirely.
  hudOpacity: { min: 0.5, max: 1, def: 1 },
} as const;

export const BOOL_SETTINGS = {
  mouseCamera: { def: false },
  // off by default: mirrors the touch layout so the movement joystick sits on
  // the right and the camera joystick on the left, for left-thumb-dominant
  // players. CSS-only swap gated on body.mobile-left-handed; ignored on desktop.
  leftHandedTouch: { def: false },
  // on by default: mask configured swear words in chat with ****. Purely a
  // local display choice; the server sends raw text and each client decides.
  // (Slurs are blocked server-side regardless and never reach here.)
  filterProfanity: { def: true },
  // off by default: MOBA-style "attack move". When on, one rebindable Attack
  // Move key (default A) walks the player toward the cursor, auto-attacking the
  // enemy under it or the nearest one met along the way. Other movement keys
  // keep working; only the attack-move key itself is reserved while active.
  attackMove: { def: false },
  // off by default: invert the vertical axis of the touch camera joystick (and
  // swipe-to-look) so pushing the stick up tilts the camera down — the classic
  // flight-sim / console preference some touch players reach for (#323-adjacent)
  touchInvertLook: { def: false },

  // --- Interface & Comfort pack (booleans). ---
  // off by default: drop every HUD cross-fade / panel animation, for players
  // who get motion-sick or just want instant windows. Mirrors the built-in
  // prefers-reduced-motion handling as an explicit in-game switch.
  reduceMotion: { def: false },
  // off by default: thicken the dark outline behind HUD text so labels stay
  // legible against bright terrain (a low-vision / high-glare aid).
  highContrastText: { def: false },
  // off by default: an opt-in frosted-glass blur behind HUD panels & windows.
  // Off keeps the classic crisp look (and zero GPU cost); on softens the world
  // showing through translucent frames.
  frostedPanels: { def: false },
  // off by default: shrink the chat frame to a compact height so it covers
  // less of the lower-left world view.
  compactChat: { def: false },
  // off by default: show a small frames-per-second readout in the corner for
  // players tuning their graphics settings.
  showFps: { def: false },
  // on by default: show the linked/connected wallet row on the character
  // selection screen. This is only a local display preference; verification and
  // holder perks remain active when the row is hidden.
  showWalletOnCharacterScreen: { def: true },
  // on by default: include verified wallet holder/balance details in newly
  // rendered player cards. The player-card modal can toggle this per device.
  showWalletOnPlayerCard: { def: true },
  // off by default: invert the vertical axis of mouselook (push mouse forward
  // to look down), the classic flight-sim preference.
  invertLookY: { def: false },
  // on by default: play an NPC's voiced line when its dialogue / quest detail
  // opens. Off mutes voice-over entirely (independent of the SFX/music toggles).
  voiceEnabled: { def: true },
  // off by default: the per-footfall step clips (self + other entities) tend to
  // read as repetitive over a long session, so they're silenced out of the box;
  // players who want them back can re-enable. Independent of the SFX volume
  // slider — jump/land/splash/swim and combat one-shots are unaffected.
  footstepSfx: { def: false },
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

export type ClickMoveMouseButton = 0 | 2;

export function normalizeClickMoveButton(value: number): ClickMoveMouseButton {
  return value >= 1 ? 2 : 0;
}

export function clickMoveButtonLabel(value: number): string {
  return normalizeClickMoveButton(value) === 2 ? 'Right Click' : 'Left Click';
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

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
  // 1 low, 2 medium, 3 high, 4 ultra, 5 advanced. The renderer reads this from
  // localStorage during startup because tier choice controls preload. def is MEDIUM (a safe
  // middle, also the Reset target): on a player's FIRST run main.ts probes the device and
  // PERSISTS a device-appropriate preset over this default when the GPU is recognized
  // (resolveDefaultGraphicsPreset in gfx.ts), so a weak phone is not stuck on a tier it cannot
  // run and a strong desktop is not capped below what it can drive. A masked/inconclusive device
  // stays on this medium default and keeps re-detecting on later boots (see graphicsDefaultApplied).
  // An explicit player choice (stored here) is never overridden.
  graphicsPreset: { min: 1, max: 5, def: 2 },
  // Adaptive browser-effects tier for the DOM/CSS layer (distinct from the WebGL
  // graphicsPreset above). 0 = Auto: detect the engine (Chromium/WebKit/Gecko),
  // version and desktop-vs-mobile and tone down the most GPU-expensive CSS
  // (backdrop-filter, big blurs/shadows, decorative background animations) so
  // weaker engines stay smooth. 1 = Full (force all effects), 2 = Reduced,
  // 3 = Minimal. Purely presentational; never touches the sim. See browser_env.ts.
  browserEffects: { min: 0, max: 3, def: 0 },
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
  // Which control interface to present: 0 = Auto (detect desktop vs touch from
  // the device), 1 = Desktop (force keyboard/mouse, hide the on-screen controls),
  // 2 = Touch (force the on-screen joysticks/buttons). Lets a tablet driven by a
  // keyboard+mouse pick the desktop UI, and a touch-capable desktop opt into the
  // on-screen controls. Read by useTouchInterface in mobile_controls.ts.
  interfaceMode: { min: 0, max: 2, def: 0 },
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

  // --- Gamepad / controller pack. Applied to the GamepadManager in main.ts. ---
  // How far an analog stick must travel before it registers, killing resting
  // drift. Separate from the touch joystick deadzone above.
  gamepadStickDeadzone: { min: 0.05, max: 0.4, def: 0.18 },
  // Right-stick camera turn/pitch rate, in radians/sec at full deflection.
  gamepadCameraSpeed: { min: 0.5, max: 5, def: 2.4 },
  // Rumble intensity (0 silences haptics without disabling the pad entirely).
  gamepadVibration: { min: 0, max: 1, def: 1 },

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
  // Scales the ENTIRE in-game HUD layer (#ui) up or down via CSS zoom, so every
  // fixed-px frame/label/button grows together — the global "fonts too small"
  // remedy that the per-element tooltip/chat/fct scales can't cover. 1.0 = stock.
  uiScale: { min: 0.85, max: 1.4, def: 1 },
  // Scales just the player unit frame (portrait, name, hp/resource bars, combo
  // pips) via --player-frame-scale, so it can shrink toward the target frame's
  // compact read without touching the rest of the HUD. Pairs with the frame's
  // move/lock button (MovableFrame): moved, it also adopts the target frame's
  // narrow bar width. 1.0 = stock.
  playerFrameScale: { min: 0.7, max: 1.15, def: 1 },
  // The target frame's twin of playerFrameScale, via --target-frame-scale.
  // Same children-zoom trick (the frame itself is drag-positioned). 1.0 = stock.
  targetFrameScale: { min: 0.7, max: 1.15, def: 1 },
  // Party/raid frame layout. partyFrameStyle: 0 automatic, 1 classic, 2 raid.
  // partyFrameHealthText: 0 none, 1 percent, 2 current, 3 current/max.
  // partyFrameSort: 0 group, 1 role, 2 name.
  partyFrameStyle: { min: 0, max: 2, def: 0 },
  partyFrameScale: { min: 0.7, max: 1.4, def: 1 },
  partyFrameWidth: { min: 120, max: 260, def: 170 },
  partyFrameHeight: { min: 30, max: 72, def: 42 },
  partyFrameSpacing: { min: 0, max: 12, def: 4 },
  partyFrameColumns: { min: 1, max: 5, def: 1 },
  partyFrameHealthText: { min: 0, max: 3, def: 1 },
  partyFrameSort: { min: 0, max: 2, def: 0 },
} as const;

export const BOOL_SETTINGS = {
  mouseCamera: { def: false },
  // on by default: while a camera drag is active, pointer-lock the canvas so the
  // OS cursor cannot leave the window during rotation (otherwise it hits the
  // screen edge and the camera freezes, or slips onto a second monitor).
  lockCursorOnRotate: { def: true },
  // on by default: poll a connected controller for input. Off ignores the pad
  // entirely (keyboard/mouse/touch unaffected).
  gamepadEnabled: { def: true },
  // off by default: invert the vertical axis of the right-stick camera, the
  // classic console/flight-sim preference. Independent of mouse/touch invert.
  gamepadInvertY: { def: false },
  // off by default: mirrors the touch layout so the movement joystick sits on
  // the right and the camera joystick on the left, for left-thumb-dominant
  // players. CSS-only swap gated on body.mobile-left-handed; ignored on desktop.
  leftHandedTouch: { def: false },
  // off by default: shows the fixed camera joystick on touch (hidden otherwise,
  // reserving no layout space and consuming no touches). Swipe-look on open
  // gameplay space is the primary camera path; this is an opt-in alternative for
  // players who prefer a dedicated stick. Gated on body.mobile-camera-joystick-on.
  mobileCameraJoystick: { def: false },
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
  // on by default: classic-style "start auto-attack on ability use". When on,
  // using an offensive ability also engages your white-swing auto-attack (read
  // live by the HUD at cast time, see ui/attack_on_ability.ts). The sim's
  // startAutoAttack still no-ops unless a valid hostile target is in range, and
  // heals / buffs / damage-breakable CC (gouge, sap, sheep) never trigger it.
  startAttackOnAbilityUse: { def: true },
  // on by default: slot 0 shows the classic fixed Attack (auto-attack) toggle.
  // Turning it off (or right-clicking the Attack button) removes it from the bar,
  // freeing slot 0 and its keybind to hold a normal assignable action.
  showAttackButton: { def: true },
  // off by default: walk-by proximity autoloot (loot corpses just by walking
  // past them). Auto-grabbing loot can feel jarring, so it is opt-in and classic
  // deliberate looting stays the default. Gates the client AutoLoot pass in
  // main.ts; the sim's authoritative gate and the raid-instance gate are separate.
  walkByAutoloot: { def: false },
  // on by default: desktop ground-targeted spells open a terrain reticle before
  // casting. Touch keeps the instant target-feet fallback because there is no
  // persistent cursor to preview.
  groundReticle: { def: true },
  // off by default: anchor the player's own BUFF row to the movable player
  // frame instead of the classic top-right corner. hud.ts reparents the buff
  // bar into #player-frame (above it while docked over the action bars, below
  // it once the frame is moved), so it follows the frame's spot and scale; the
  // debuff row stays put in the DOM and slides up beside the minimap (the
  // vacated top spot) so incoming debuffs keep one glanceable classic corner.
  // Desktop only; the mobile layout keeps its own aura placement.
  aurasOnPlayerFrame: { def: false },
  // Party/raid frame display profile. Health is always visible; these switches
  // choose the supporting information layered around it.
  partyFrameShowResource: { def: true },
  partyFrameShowAbsorbs: { def: true },
  partyFrameShowAuras: { def: true },
  partyFrameShowSelf: { def: false },

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
  // on by default: show the developer badge (nameplate glyph + name outline,
  // inspect-window block, player card, and the Developers leaderboard tab).
  // Purely a local display preference: the badge is still earned and broadcast
  // either way, this only controls whether THIS client renders it.
  showDevBadges: { def: true },
  // on by default: render your OWN overhead nameplate (name, level, guild, hp,
  // $WOC holder tier, dev badge, linked-Discord PFP) exactly as other players see
  // it, so Discord linking and other flair changes have immediate visual feedback.
  // Purely a local display preference; players can turn it off for the classic view.
  showOwnNameplate: { def: true },
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
  // on by default: a brief OSRS-style ground marker (an expanding ring plus a
  // crossed "X") where you left-click in the world, gold for a normal click and
  // red when the click lands on a hostile. Purely a local presentation cue; it
  // never touches sim state. Off removes the marker entirely.
  clickFeedback: { def: true },
  // off by default: swap the looping landing-page trailer for a static, dimmed,
  // high-contrast backdrop so the start-screen text stays legible (and the
  // 5.7 MB video is never fetched). Forced on regardless for phones / Save-Data /
  // prefers-reduced-motion, see shouldUseStaticBackdrop in landing_backdrop.ts.
  landingHighContrast: { def: false },
  // off by default (expanded): when on, the on-screen quest tracker is collapsed
  // to just its "Quests (N)" header. Toggled by clicking the tracker header; kept
  // here so the choice persists across sessions like the other HUD preferences.
  questTrackerCollapsed: { def: false },
  // off by default (expanded): when on, the on-screen Book of Deeds watchlist
  // tracker is collapsed to just its header. Toggled by clicking the tracker
  // header (the quest-tracker convention); kept here so the choice persists.
  deedTrackerCollapsed: { def: false },
  // off by default: append an "Item Level N" (plus power score) line to every item
  // tooltip. Purely a display preference read live by the HUD; off keeps the
  // classic stat-only tooltip. See src/sim/item_level.ts for the derivation.
  showItemLevel: { def: false },
  // off by default: out of the box the HUD shows a single action bar. When on, the
  // second action bar row (#actionbar2, slots 12..22) is revealed via a body class
  // applied in main.ts. Purely a display preference; the slots stay reachable via
  // their keybinds either way, so the row being hidden never disables those abilities.
  showSecondaryActionBar: { def: false },
  // on by default: keep the Daily Rewards chest launcher visible on the HUD. Hiding
  // it only removes the shortcut; rewards, eligibility, and the panel remain available.
  showDailyRewardsChest: { def: true },
  // internal, never shown in the options UI: set true once main.ts has persisted a
  // device-appropriate graphicsPreset on a player's first run (a CONCLUSIVE detection).
  // It gates firstRunGraphicsPreset so a recognized device is classified at most once and
  // an explicit later choice is never re-detected over. def MUST be false: save() writes the
  // whole values object (def-filling every key) the first time any setting is stored, so a
  // non-false def would fake "applied" and defeat detection. reset() clears it back to false,
  // so Reset to Defaults re-detects the device default on the next reload.
  graphicsDefaultApplied: { def: false },
} as const;

export type NumericSettingKey = keyof typeof SETTING_RANGES;
export type BoolSettingKey = keyof typeof BOOL_SETTINGS;
export type GameSettings = { [K in NumericSettingKey]: number } & {
  [K in BoolSettingKey]: boolean;
};

interface Range {
  min: number;
  max: number;
  def: number;
}

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
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    } catch {
      /* corrupt */
    }
    const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
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
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable */
    }
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

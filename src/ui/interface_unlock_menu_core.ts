// Pure builders for the interface editor's Frames Settings menu and the
// party-frame edit preview: the toggle and select tables the dropdown
// renders, the per-frame size-reset key table, and the dummy roster the
// preview pads a real party out to. Host-free (no DOM): hud.ts stays a thin
// consumer that supplies its live settings hooks and the real members, so a
// Vitest drives the REAL tables (both orientation arms included) instead of
// a fake. Registered in UI_PURE_CORES (tests/architecture.test.ts).
import { formatNumber, type TranslationKey, t } from './i18n';
import type { FramesMenuSelect, FramesMenuToggle } from './interface_unlock';
import type { PartyFrameMember } from './party_frames';

export type FramesMenuSettingValue = number | boolean;

/** The two members of Hud's OptionsHooks the menu builders need, spelled
 * STRUCTURALLY (string keys, method syntax so the generically-typed Settings
 * class satisfies it bivariantly): a pure core may not import game/settings
 * (the architecture guard's host-agnostic sweep), and a test fake needs no
 * localStorage-backed class. The pair is persist (settings.set) then apply
 * (onSettingChange), the same one the options window's own rows drive. */
export interface FramesMenuSettingsHooks {
  settings: {
    get(key: string): FramesMenuSettingValue | undefined;
    set(key: string, value: FramesMenuSettingValue): FramesMenuSettingValue;
  };
  onSettingChange(key: string, value: FramesMenuSettingValue): void;
}

/** The numeric range a select spans; hud passes the live SETTING_RANGES rows
 * (a pure core may not import them itself). */
export interface FramesMenuSelectRange {
  min: number;
  max: number;
  def: number;
}

const BOOL_TOGGLE_ROWS = [
  ['combineActionBars', 'hudChrome.options.combineActionBars'],
  ['hideUnusedActionSlots', 'hudChrome.options.hideUnusedActionSlots'],
  ['mouseoverCast', 'hudChrome.options.mouseoverCast'],
  ['lockActionBars', 'hudChrome.options.lockActionBars'],
  ['buffsLeftToRight', 'hudChrome.interfaceUnlock.buffsLeftToRight'],
  ['debuffsLeftToRight', 'hudChrome.interfaceUnlock.debuffsLeftToRight'],
  ['lockPlayerFrameToActionBar', 'hudChrome.interfaceUnlock.lockPlayerFrameToBar'],
  ['menuRailHorizontal', 'hudChrome.interfaceUnlock.menuRailHorizontal'],
  ['frameSnapToGrid', 'hudChrome.interfaceUnlock.snapToGrid'],
] as const;

const BAR_ORIENTATION_KEYS = [
  'actionBar1Vertical',
  'actionBar2Vertical',
  'actionBar3Vertical',
] as const;

const BAR_ORIENTATION_LABELS = [
  'hudChrome.interfaceUnlock.actionBar1Vertical',
  'hudChrome.interfaceUnlock.actionBar2Vertical',
  'hudChrome.interfaceUnlock.actionBar3Vertical',
] as const;

/** The frame-behavior settings the editor dropdown owns (their options-window
 * rows are gone; see buildInterfaceControls). `set` persists AND applies.
 * Bar orientation is PER BAR while split (owner request), and one toggle
 * driving all three while combined, since the block moves and flips as a
 * single shape then. */
export function buildFramesMenuToggles(
  hooks: FramesMenuSettingsHooks | null,
  combinedBars: boolean,
): FramesMenuToggle[] {
  if (!hooks) return [];
  const toggles: FramesMenuToggle[] = BOOL_TOGGLE_ROWS.map(([key, labelKey]) => ({
    id: key as string,
    label: t(labelKey),
    value: !!hooks.settings.get(key),
    set: (value: boolean) => hooks.onSettingChange(key, hooks.settings.set(key, value)),
  }));
  if (combinedBars) {
    toggles.push({
      id: 'actionBarsVertical',
      label: t('hudChrome.interfaceUnlock.actionBarsVertical'),
      value: !!hooks.settings.get('actionBar1Vertical'),
      set: (value: boolean) => {
        for (const key of BAR_ORIENTATION_KEYS)
          hooks.onSettingChange(key, hooks.settings.set(key, value));
      },
    });
  } else {
    BAR_ORIENTATION_KEYS.forEach((key, i) => {
      toggles.push({
        id: key,
        label: t(BAR_ORIENTATION_LABELS[i]),
        value: !!hooks.settings.get(key),
        set: (value: boolean) => hooks.onSettingChange(key, hooks.settings.set(key, value)),
      });
    });
  }
  return toggles;
}

/** The discrete party layout knobs live in the editor menu rather than the
 * options window (owner request: the sizing sliders left the Frames tab once
 * the editor gained real-dimension drags; columns and the row spacing join
 * the editor's own menu as whole-px pickers). */
export function buildFramesMenuSelects(
  hooks: FramesMenuSettingsHooks | null,
  ranges: Record<'partyFrameColumns' | 'partyFrameSpacing', FramesMenuSelectRange>,
): FramesMenuSelect[] {
  if (!hooks) return [];
  const selectFor = (
    key: 'partyFrameColumns' | 'partyFrameSpacing',
    labelKey: TranslationKey,
  ): FramesMenuSelect => {
    const range = ranges[key];
    const options: { value: number; label: string }[] = [];
    for (let value = range.min; value <= range.max; value += 1)
      options.push({ value, label: formatNumber(value) });
    return {
      id: key,
      label: t(labelKey),
      value: Math.round(Number(hooks.settings.get(key) ?? range.def)),
      options,
      set: (value: number) => hooks.onSettingChange(key, hooks.settings.set(key, value)),
    };
  };
  return [
    selectFor('partyFrameColumns', 'hudChrome.partyFrames.columns'),
    selectFor('partyFrameSpacing', 'hudChrome.partyFrames.spacing'),
  ];
}

/** Settings behind each frame's per-row Reset size button: frames whose
 * sizes live in real settings (the dimension drags, the scale factors)
 * reset those alongside the mover's own grip zoom. */
export const FRAME_SIZE_RESET_KEYS: Partial<Record<string, readonly string[]>> = {
  playerFrame: ['playerFrameScale', 'playerFrameWidth', 'playerFrameHeight'],
  targetFrame: ['targetFrameScale', 'targetFrameWidth', 'targetFrameHeight'],
  partyFrames: ['partyFrameScale', 'partyFrameWidth', 'partyFrameHeight'],
};

/** The edit preview's roster is always this deep (owner request), so
 * arranging is done against the largest stack the frame realistically holds. */
export const PARTY_SAMPLE_TOTAL = 10;

const SAMPLE_CLASSES = [
  'warrior',
  'priest',
  'rogue',
  'hunter',
  'shaman',
  'mage',
  'warlock',
  'paladin',
  'druid',
] as const;

const SAMPLE_RESOURCE: Record<(typeof SAMPLE_CLASSES)[number], PartyFrameMember['rtype']> = {
  warrior: 'rage',
  priest: 'mana',
  rogue: 'energy',
  hunter: 'focus',
  shaman: 'mana',
  mage: 'mana',
  warlock: 'mana',
  paladin: 'mana',
  druid: 'mana',
};

/** Pad the player's REAL party (already selected through the live pipeline)
 * out to the full sample roster with dummy members. */
export function buildPartySampleMembers(
  real: readonly PartyFrameMember[],
  total = PARTY_SAMPLE_TOTAL,
): PartyFrameMember[] {
  const members = [...real];
  for (let i = real.length; i < total; i += 1) {
    const cls = SAMPLE_CLASSES[i % SAMPLE_CLASSES.length];
    members.push({
      // Negative pids so a sample row key can never collide with a real member.
      pid: -(i + 1),
      // One interpolated key, not concatenation: a locale can reorder the
      // class name and the ordinal.
      name: t('hudChrome.interfaceUnlock.previewMemberName', {
        className: t(`classes.${cls}` as TranslationKey),
        number: formatNumber(i + 1),
      }),
      cls,
      level: 20,
      hp: 100,
      mhp: 100,
      res: cls === 'warrior' ? 0 : 100,
      mres: 100,
      rtype: SAMPLE_RESOURCE[cls],
      x: 0,
      z: 0,
      dead: 0,
      inCombat: 0,
      group: 1 as const,
      connected: 1,
      oor: false,
    });
  }
  return members;
}

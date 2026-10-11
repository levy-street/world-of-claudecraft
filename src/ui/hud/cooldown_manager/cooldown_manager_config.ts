// The Cooldown Manager's stored shape and every rule that reads it back: the
// groups the player builds (a single button, a grid of buttons, or a line of
// spells), which spells sit in each, how each group lays out and when it shows,
// how each spell announces itself, and the settings every group shares.
//
// Pure data rules with no DOM, storage or i18n. The localStorage wrapper is
// cooldown_manager_store.ts; this module is what it runs every read through, so
// a hand-edited, stale or corrupted save degrades to defaults instead of
// throwing. The alert sound reuses the Auras panel's cue palette verbatim
// (src/game/aura_cue_catalog.ts): one set of sounds to learn.

import { AURA_CUE_NONE, sanitizeAuraCueId } from '../../../game/aura_cue_catalog';

/** The three group shapes the player can add. */
export type CooldownGroupKind = 'single' | 'grid' | 'line';
export const COOLDOWN_GROUP_KINDS: readonly CooldownGroupKind[] = ['single', 'grid', 'line'];
export type CooldownOrientation = 'horizontal' | 'vertical';
/** Which way buttons grow: `forward` is right (horizontal) or down (vertical),
 *  `reverse` is left or up. */
export type CooldownDirection = 'forward' | 'reverse';
/** When a group paints. A hidden group still plays its sounds and lights the
 *  hotbar, so a player can route a spell to sound alone. */
export type CooldownVisibility = 'always' | 'combat' | 'hidden';
export const COOLDOWN_VISIBILITIES: readonly CooldownVisibility[] = ['always', 'combat', 'hidden'];

/** The most groups one character keeps. */
export const COOLDOWN_MAX_GROUPS = 12;
/** The most spells a line holds. Longer stops being a glanceable readout. */
export const COOLDOWN_LINE_MAX = 12;
/** A grid runs 1 to this many buttons per row, and 1 to this many rows. */
export const COOLDOWN_GRID_MAX_SIDE = 12;
export const COOLDOWN_PADDING_MAX = 12;
/** The longest custom group name, in characters. */
export const COOLDOWN_GROUP_NAME_MAX = 32;

/** A tracked entry: a snake_case ability id, or an aura token (`aura:<id>`,
 *  `kind:<kind>`, see cooldown_manager_auras.ts). Anything else is junk. */
const ABILITY_ID_RE = /^(?:(?:aura|kind):)?[a-z0-9_]{1,64}$/;
/** The highest stack count an aura alert can wait for. */
export const COOLDOWN_ALERT_STACKS_MAX = 20;
const GROUP_ID_RE = /^g[0-9]{1,4}$/;

/** One floating group of buttons. */
export interface CooldownGroup {
  /** Stable id (`g1`, `g2`, ...), unique within the character's groups. */
  id: string;
  kind: CooldownGroupKind;
  /** The player's name for the group; empty keeps the numbered default
   *  ("Button Group 2"). */
  name: string;
  /** The base ability ids, in button order. A spell sits in one group at most. */
  spells: string[];
  /** Group centre, as a fraction of the viewport (0..1 each axis). */
  posX: number;
  posY: number;
  /** Icon size, 0.6 to 2. */
  scale: number;
  /** Gap between buttons, in CSS pixels before scaling. */
  padding: number;
  /** Whole-group opacity, 0.2 to 1. */
  opacity: number;
  orientation: CooldownOrientation;
  direction: CooldownDirection;
  /** Grid only: buttons per run (a row when horizontal, a column when vertical). */
  perLine: number;
  /** Grid only: how many runs. Always enough to hold the group's spells. */
  lines: number;
  visibility: CooldownVisibility;
  /** Print the remaining cooldown seconds on each button. */
  showTimer: boolean;
}

export type CooldownGroupPatch = Partial<Omit<CooldownGroup, 'id' | 'kind' | 'spells'>>;

/** How one tracked spell behaves. */
export interface CooldownSpellConfig {
  /** The cue that plays when the spell becomes ready (or transforms while
   *  ready), or AURA_CUE_NONE for silence, the default. */
  soundId: string;
  /** Per-spell playback gain, 0.1 to 1, multiplied by the master SFX volume. */
  soundVolume: number;
  /** Brighten and outline the button while the spell is ready to press. */
  glowWhenReady: boolean;
  /** Keep the button's slot empty until the spell is ready. */
  onlyWhenReady: boolean;
  /** Also light this spell's action-bar button with the proc glow while it is
   *  ready. Additive only, like the Auras panel's Hotbar Glow: it can never
   *  suppress an authored class proc glow. */
  hotbarGlow: boolean;
  /** Aura entries only: the stack count at which the aura counts as "up" (it
   *  lights, pulses and chimes). 0 means as soon as it appears. */
  alertStacks: number;
}

export type CooldownSpellPatch = Partial<CooldownSpellConfig>;

/** The settings every group shares. */
export interface CooldownManagerLayout {
  /** Master switch: nothing paints and nothing plays while off. */
  enabled: boolean;
  /** Opacity of a button that is NOT ready, relative to its group. */
  idleOpacity: number;
  /** Only play ready sounds while the player is in combat. */
  soundInCombatOnly: boolean;
}

export type CooldownManagerLayoutPatch = Partial<CooldownManagerLayout>;

export const COOLDOWN_SCALE_MIN = 0.6;
export const COOLDOWN_SCALE_MAX = 2;
export const COOLDOWN_OPACITY_MIN = 0.2;
export const COOLDOWN_OPACITY_MAX = 1;
export const COOLDOWN_VOLUME_MIN = 0.1;
export const COOLDOWN_VOLUME_MAX = 1;

export function defaultCooldownSpellConfig(): CooldownSpellConfig {
  return {
    soundId: AURA_CUE_NONE,
    soundVolume: 0.7,
    glowWhenReady: true,
    onlyWhenReady: false,
    hotbarGlow: false,
    alertStacks: 0,
  };
}

export function defaultCooldownManagerLayout(): CooldownManagerLayout {
  return { enabled: true, idleOpacity: 0.55, soundInCombatOnly: false };
}

/** Where a new group of each kind lands: centred, above the default action
 *  bars, clear of the cast bar. Later groups step down so a new one never lands
 *  exactly on top of the last. */
const DEFAULT_POS_Y: Readonly<Record<CooldownGroupKind, number>> = {
  single: 0.5,
  line: 0.62,
  grid: 0.4,
};
const NEW_GROUP_STEP_Y = 0.04;

/** The spells a group can hold at its current shape. */
export function cooldownGroupCapacity(
  group: Pick<CooldownGroup, 'kind' | 'perLine' | 'lines'>,
): number {
  if (group.kind === 'single') return 1;
  if (group.kind === 'line') return COOLDOWN_LINE_MAX;
  return group.perLine * group.lines;
}

/** The smallest run length whose longest run count still holds the spells. */
export function minGridPerLine(spellCount: number): number {
  return Math.max(1, Math.ceil(spellCount / COOLDOWN_GRID_MAX_SIDE));
}

/** The smallest run count that still holds a grid's spells at this width. */
export function minGridLines(spellCount: number, perLine: number): number {
  return Math.max(1, Math.ceil(spellCount / Math.max(1, perLine)));
}

/**
 * The 1-based grid cell of the button at `index` in a group holding `count`
 * buttons. A line and a single button are one run; a grid wraps every
 * `perLine`. Horizontal fills rows, vertical fills columns, and `reverse` fills
 * each run from the far end (left or up), which is how a group anchored to the
 * right or bottom of the screen grows toward the middle.
 */
export function cooldownCell(
  group: Pick<CooldownGroup, 'kind' | 'perLine' | 'orientation' | 'direction'>,
  index: number,
  count: number,
): { column: number; row: number } {
  const per = group.kind === 'grid' ? Math.max(1, group.perLine) : Math.max(1, count);
  const run = Math.floor(index / per);
  let along = index % per;
  if (group.direction === 'reverse') along = per - 1 - along;
  return group.orientation === 'horizontal'
    ? { column: along + 1, row: run + 1 }
    : { column: run + 1, row: along + 1 };
}

/** Whether a group paints this frame (the placement preview shows every group
 *  so a hidden one can still be arranged). */
export function cooldownGroupShown(
  visibility: CooldownVisibility,
  inCombat: boolean,
  preview: boolean,
): boolean {
  if (preview) return true;
  if (visibility === 'hidden') return false;
  return visibility === 'always' || inCombat;
}

/** Case- and accent-insensitive "name contains query" for the spell search. An
 *  empty query matches everything. */
export function cooldownSpellMatches(name: string, query: string): boolean {
  const q = foldSearch(query.trim());
  return q === '' || foldSearch(name).includes(q);
}

function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function numberIn(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function intIn(raw: unknown, min: number, max: number, fallback: number): number {
  return Math.round(numberIn(raw, min, max, fallback));
}

function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function oneOf<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  return values.find((value) => value === raw) ?? fallback;
}

/** A custom group name read back: control characters dropped, whitespace
 *  collapsed and trimmed, capped at COOLDOWN_GROUP_NAME_MAX characters. Anything
 *  that is not a string is no name (the numbered default). */
export function sanitizeCooldownGroupName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const clean = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, COOLDOWN_GROUP_NAME_MAX).join('').trim();
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function newCooldownGroup(
  kind: CooldownGroupKind,
  existing: readonly Pick<CooldownGroup, 'id'>[],
): CooldownGroup {
  let n = 1;
  const ids = new Set(existing.map((group) => group.id));
  while (ids.has(`g${n}`)) n++;
  const step = (existing.length % 5) * NEW_GROUP_STEP_Y;
  return {
    id: `g${n}`,
    kind,
    name: '',
    spells: [],
    posX: 0.5,
    posY: Math.min(0.95, DEFAULT_POS_Y[kind] + step),
    scale: 1,
    padding: 4,
    opacity: 1,
    orientation: 'horizontal',
    direction: 'forward',
    perLine: 3,
    lines: 3,
    visibility: 'always',
    showTimer: true,
  };
}

export function sanitizeCooldownGroup(raw: unknown): CooldownGroup | null {
  const value = record(raw);
  if (typeof value.id !== 'string' || !GROUP_ID_RE.test(value.id)) return null;
  const kind = COOLDOWN_GROUP_KINDS.find((entry) => entry === value.kind);
  if (!kind) return null;
  const base = newCooldownGroup(kind, []);
  const maxSpells =
    kind === 'grid'
      ? COOLDOWN_GRID_MAX_SIDE * COOLDOWN_GRID_MAX_SIDE
      : cooldownGroupCapacity({ kind, perLine: 1, lines: 1 });
  const spells: string[] = [];
  if (Array.isArray(value.spells)) {
    for (const id of value.spells) {
      if (spells.length >= maxSpells) break;
      if (typeof id === 'string' && ABILITY_ID_RE.test(id) && !spells.includes(id)) spells.push(id);
    }
  }
  // A grid never drops a spell the player placed: narrowing it grows the run
  // count to hold them, and past the longest run count the run length stays
  // wide enough instead (see minGridPerLine, which the Columns slider uses).
  const perLine = Math.max(
    intIn(value.perLine, 1, COOLDOWN_GRID_MAX_SIDE, base.perLine),
    kind === 'grid' ? minGridPerLine(spells.length) : 1,
  );
  const lines = Math.max(
    intIn(value.lines, 1, COOLDOWN_GRID_MAX_SIDE, base.lines),
    kind === 'grid' ? minGridLines(spells.length, perLine) : 1,
  );
  return {
    id: value.id,
    kind,
    name: sanitizeCooldownGroupName(value.name),
    spells,
    posX: numberIn(value.posX, 0, 1, base.posX),
    posY: numberIn(value.posY, 0, 1, base.posY),
    scale: numberIn(value.scale, COOLDOWN_SCALE_MIN, COOLDOWN_SCALE_MAX, base.scale),
    padding: intIn(value.padding, 0, COOLDOWN_PADDING_MAX, base.padding),
    opacity: numberIn(value.opacity, COOLDOWN_OPACITY_MIN, COOLDOWN_OPACITY_MAX, base.opacity),
    orientation: oneOf(value.orientation, ['horizontal', 'vertical'], base.orientation),
    direction: oneOf(value.direction, ['forward', 'reverse'], base.direction),
    perLine,
    lines,
    visibility: oneOf(value.visibility, COOLDOWN_VISIBILITIES, base.visibility),
    showTimer: boolOr(value.showTimer, base.showTimer),
  };
}

/** The group list read back: valid groups only, first id wins, capped, and a
 *  spell claimed by an earlier group dropped from any later one. */
export function sanitizeCooldownGroups(raw: unknown): CooldownGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: CooldownGroup[] = [];
  const claimed = new Set<string>();
  for (const entry of raw) {
    if (out.length >= COOLDOWN_MAX_GROUPS) break;
    const group = sanitizeCooldownGroup(entry);
    if (!group || out.some((other) => other.id === group.id)) continue;
    const spells = group.spells.filter((id) => !claimed.has(id));
    for (const id of spells) claimed.add(id);
    out.push(spells.length === group.spells.length ? group : { ...group, spells });
  }
  return out;
}

export function sanitizeCooldownSpellConfig(raw: unknown): CooldownSpellConfig {
  const fallback = defaultCooldownSpellConfig();
  const value = record(raw);
  return {
    soundId: sanitizeAuraCueId(value.soundId),
    soundVolume: numberIn(
      value.soundVolume,
      COOLDOWN_VOLUME_MIN,
      COOLDOWN_VOLUME_MAX,
      fallback.soundVolume,
    ),
    glowWhenReady: boolOr(value.glowWhenReady, fallback.glowWhenReady),
    onlyWhenReady: boolOr(value.onlyWhenReady, fallback.onlyWhenReady),
    hotbarGlow: boolOr(value.hotbarGlow, fallback.hotbarGlow),
    alertStacks: intIn(value.alertStacks, 0, COOLDOWN_ALERT_STACKS_MAX, fallback.alertStacks),
  };
}

export function sanitizeCooldownManagerLayout(raw: unknown): CooldownManagerLayout {
  const fallback = defaultCooldownManagerLayout();
  const value = record(raw);
  return {
    enabled: boolOr(value.enabled, fallback.enabled),
    idleOpacity: numberIn(
      value.idleOpacity,
      COOLDOWN_OPACITY_MIN,
      COOLDOWN_OPACITY_MAX,
      fallback.idleOpacity,
    ),
    soundInCombatOnly: boolOr(value.soundInCombatOnly, fallback.soundInCombatOnly),
  };
}

/** The group a spell sits in, or null when it is Not Displayed. */
export function cooldownGroupOf(groups: readonly CooldownGroup[], spellId: string): string | null {
  return groups.find((group) => group.spells.includes(spellId))?.id ?? null;
}

/**
 * Move one spell into a group (at the end), or out of every group when
 * `groupId` is null. A spell sits in one group at most, so it leaves its old
 * one. Same array back when nothing changes: already there, unknown group, the
 * destination is full, or the id is not an ability id.
 */
export function assignCooldownSpell(
  groups: readonly CooldownGroup[],
  spellId: string,
  groupId: string | null,
): readonly CooldownGroup[] {
  if (!ABILITY_ID_RE.test(spellId)) return groups;
  const current = cooldownGroupOf(groups, spellId);
  if (current === groupId) return groups;
  const target = groupId === null ? null : groups.find((group) => group.id === groupId);
  if (target === undefined) return groups;
  if (target && target.spells.length >= cooldownGroupCapacity(target)) return groups;
  return groups.map((group) => {
    if (group.id === current) {
      return { ...group, spells: group.spells.filter((id) => id !== spellId) };
    }
    if (target && group.id === target.id) return { ...group, spells: [...group.spells, spellId] };
    return group;
  });
}

/** Move one spell one place earlier (-1) or later (+1) within its group. */
export function moveCooldownSpell(
  groups: readonly CooldownGroup[],
  spellId: string,
  delta: -1 | 1,
): readonly CooldownGroup[] {
  const groupId = cooldownGroupOf(groups, spellId);
  if (groupId === null) return groups;
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const index = group.spells.indexOf(spellId);
    const next = index + delta;
    if (next < 0 || next >= group.spells.length) return group;
    const spells = [...group.spells];
    spells[index] = spells[next];
    spells[next] = spellId;
    return { ...group, spells };
  });
}

/** Apply a layout patch to one group, clamped, with a grid grown to fit. */
export function patchCooldownGroup(
  groups: readonly CooldownGroup[],
  groupId: string,
  patch: CooldownGroupPatch,
): readonly CooldownGroup[] {
  return groups.map((group) =>
    group.id === groupId ? (sanitizeCooldownGroup({ ...group, ...patch }) ?? group) : group,
  );
}

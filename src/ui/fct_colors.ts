// Combat Text Colors (Interface > Combat > Combat Text Colors): a per-kind colour override
// for the floating combat text, one slot per kind of number. Every slot starts on Default.
// A slot set to Custom stores a hex colour here, and applyFctColors() publishes it as a CSS
// variable on :root plus a body class; the matching override rule in hud.css only applies
// while that body class is present. A slot on Default therefore changes nothing at all:
// the vivid and Classic looks keep their shipped colours byte for byte.
//
// Stored in its own localStorage key, like the UI theme (theme.ts), so the numeric/bool
// `woc_settings` schema stays clean; the all-settings export carries the key too
// (settings_transfer_core.ts).

import { isValidHex } from './theme';

/** Every colour slot, in the order the Combat Text Colors panel lists them. */
export const FCT_COLOR_SLOTS = [
  'white',
  'whiteCrit',
  'ability',
  'abilityCrit',
  'dot',
  'dotCrit',
  'heal',
  'healCrit',
  'hot',
  'hotCrit',
  'pet',
  'petCrit',
  'block',
  'avoid',
  'absorb',
  'taken',
  'takenCrit',
] as const;

export type FctColorSlot = (typeof FCT_COLOR_SLOTS)[number];

/** The slots a player set to Custom, each with its hex colour. Absent = Default. */
export type FctColorState = Partial<Record<FctColorSlot, string>>;

/**
 * The colour each slot shows in the default (vivid) look, from tokens.css: the picker's
 * starting swatch while the slot is on Default. A pet's hit keeps a dim white / khaki
 * split by default; one Custom colour replaces both.
 */
export const FCT_COLOR_DEFAULTS: Readonly<Record<FctColorSlot, string>> = {
  white: '#ffffff',
  whiteCrit: '#ffffff',
  ability: '#ffc933',
  abilityCrit: '#ffc933',
  dot: '#ffc933',
  dotCrit: '#ffc933',
  heal: '#3ce63c',
  healCrit: '#3ce63c',
  hot: '#3ce63c',
  hotCrit: '#3ce63c',
  pet: '#c9b37e',
  petCrit: '#c9b37e',
  block: '#86a6ff',
  avoid: '#a3b0c2',
  absorb: '#9fd7ff',
  taken: '#ff5544',
  takenCrit: '#ff5544',
};

function kebab(slot: FctColorSlot): string {
  return slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** The CSS variable a Custom slot's colour is published under (hud.css reads it). */
export function fctColorVar(slot: FctColorSlot): string {
  return `--fct-user-${kebab(slot)}`;
}

/** The body class that switches a slot's override rule on in hud.css. */
export function fctColorClass(slot: FctColorSlot): string {
  return `fct-c-${kebab(slot)}`;
}

/** Keep only known slots holding a valid #rrggbb colour; anything else reads as Default. */
export function parseFctColors(raw: unknown): FctColorState {
  const out: FctColorState = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  for (const slot of FCT_COLOR_SLOTS) {
    const v = rec[slot];
    if (isValidHex(v)) out[slot] = v.toLowerCase();
  }
  return out;
}

export function serializeFctColors(state: FctColorState): string {
  const out: FctColorState = {};
  for (const slot of FCT_COLOR_SLOTS) {
    const v = state[slot];
    if (v !== undefined) out[slot] = v;
  }
  return JSON.stringify(out);
}

/** The minimal surface applyFctColors writes to (a Document in the client). */
export interface FctColorTarget {
  documentElement: {
    style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  };
  body: { classList: { toggle(token: string, force?: boolean): boolean } } | null;
}

/** Publish the state: a Custom slot gets its variable and body class, a Default one neither. */
export function applyFctColors(doc: FctColorTarget, state: FctColorState): void {
  for (const slot of FCT_COLOR_SLOTS) {
    const v = state[slot];
    if (v !== undefined) doc.documentElement.style.setProperty(fctColorVar(slot), v);
    else doc.documentElement.style.removeProperty(fctColorVar(slot));
    doc.body?.classList.toggle(fctColorClass(slot), v !== undefined);
  }
}

// --- Persistence ----------------------------------------------------------

export const FCT_COLORS_STORE_KEY = 'woc_fct_colors';

export class FctColorStore {
  private state: FctColorState;

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(FCT_COLORS_STORE_KEY) ?? 'null');
    } catch {
      /* corrupt or unavailable: every slot reads as Default */
    }
    this.state = parseFctColors(raw);
  }

  get(): FctColorState {
    return { ...this.state };
  }

  /** Set a slot to Custom with `hex`, or (with null) back to Default. */
  set(slot: FctColorSlot, hex: string | null): void {
    if (hex === null) delete this.state[slot];
    else if (isValidHex(hex)) this.state[slot] = hex.toLowerCase();
    this.save();
  }

  /** Every slot back to Default. */
  reset(): void {
    this.state = {};
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(FCT_COLORS_STORE_KEY, serializeFctColors(this.state));
    } catch {
      /* unavailable */
    }
  }
}

/** The options panel's seam onto the store (OptionsHooks.fctColors). */
export interface FctColorHooks {
  get(): FctColorState;
  /** A hex colour sets the slot to Custom; null puts it back on Default. */
  set(slot: FctColorSlot, hex: string | null): void;
  reset(): void;
}

/** Load the saved colours, publish them on `doc` now, and republish on every change. */
export function createFctColorHooks(doc: FctColorTarget): FctColorHooks {
  const store = new FctColorStore();
  const publish = () => applyFctColors(doc, store.get());
  publish();
  return {
    get: () => store.get(),
    set: (slot, hex) => {
      store.set(slot, hex);
      publish();
    },
    reset: () => {
      store.reset();
      publish();
    },
  };
}

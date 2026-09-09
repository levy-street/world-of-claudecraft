// Pure envelope logic for the Key Bindings panel's hotkey-setup export + import
// code. DOM-free and storage-free: the caller hands in the live Keybinds
// snapshot (actionId -> [primary, secondary]) and gets a shareable code string
// back, or hands a pasted code in and gets a shape-validated bindings blob out.
// Registered in tests/architecture.test.ts UI_PURE_CORES.
//
// This module validates SHAPE only (the envelope, string keys, arrays of
// key-combo strings or nulls). Semantics (known action ids, reserved codes, the
// one-code-per-action sweep) are the Keybinds model's job: importBindings()
// runs the exact validation load() runs on a stored profile, so a pasted code
// can never bind what a saved profile could not. Unknown actions are carried
// through here and ignored there, so a code exported by a NEWER build with an
// extra action still imports the parts this build understands.
//
// A distinct envelope marker keeps a hotkey code from reading as a settings /
// frame-layout code (settings_transfer_core.ts) and vice versa; a pasted code
// of that other family is reported as 'kind' so the message can say so.

import { TRANSFER_CODE_MAX_CHARS } from './settings_transfer_core';

/** The envelope marker, so a random pasted JSON blob never reads as a code. */
const ENVELOPE = 'woc-keybinds';
/** The settings/frame-layout family's marker, recognised only to name it. */
const SETTINGS_ENVELOPE = 'woc-transfer';
const VERSION = 1;
/** primary + secondary; anything past the second entry is dropped. */
const SLOTS_PER_ACTION = 2;
/** Keys that would reach Object.prototype rather than a binding row. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type KeybindSetup = Record<string, (string | null)[]>;

/** Build the shareable code for `binds` (the Keybinds snapshot). Rows that are
 *  not a well-formed [combo|null, combo|null] pair are dropped, so the code
 *  never carries anything an import would reject. */
export function buildKeybindCode(binds: KeybindSetup): string {
  return JSON.stringify({ woc: ENVELOPE, v: VERSION, binds: sanitizeSetup(binds) });
}

export type ParsedKeybindCode =
  | { ok: true; binds: KeybindSetup }
  | { ok: false; reason: 'format' | 'kind' | 'empty' };

/** Parse a pasted code. Returns the shape-valid bindings, or why not: 'format'
 *  (not a code at all, or past the size bound), 'kind' (a settings /
 *  frame-layout code, so the message can say "that is a settings export"
 *  instead of "invalid"), 'empty' (a valid code carrying no usable binding row,
 *  or, when `knownActions` is given, none for an action this build knows: such a
 *  code would import as a full reset). */
export function parseKeybindCode(
  text: string,
  knownActions?: ReadonlySet<string>,
): ParsedKeybindCode {
  if (text.length > TRANSFER_CODE_MAX_CHARS) return { ok: false, reason: 'format' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'format' };
  }
  const env = raw as { woc?: unknown; v?: unknown; binds?: unknown };
  if (env.woc === SETTINGS_ENVELOPE) return { ok: false, reason: 'kind' };
  if (
    env.woc !== ENVELOPE ||
    typeof env.v !== 'number' ||
    typeof env.binds !== 'object' ||
    env.binds === null ||
    Array.isArray(env.binds)
  ) {
    return { ok: false, reason: 'format' };
  }
  const binds = sanitizeSetup(env.binds as Record<string, unknown>);
  const ids = Object.keys(binds);
  if (ids.length === 0) return { ok: false, reason: 'empty' };
  if (knownActions && !ids.some((id) => knownActions.has(id)))
    return { ok: false, reason: 'empty' };
  return { ok: true, binds };
}

/** Keep only rows shaped [combo|null, combo|null]: string keys, an array
 *  value, each of its first two entries a non-empty string or null (anything
 *  else reads as null, so a half-good row still imports its good half). A row
 *  that is not an array is dropped; an all-null row is KEPT, since it means the
 *  exporter had deliberately unbound that action and the import must too. */
function sanitizeSetup(raw: Record<string, unknown>): KeybindSetup {
  const out: KeybindSetup = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(id) || !Array.isArray(entry)) continue;
    const slots: (string | null)[] = [];
    for (let i = 0; i < SLOTS_PER_ACTION; i++) {
      const v = entry[i];
      slots.push(typeof v === 'string' && v.length > 0 ? v : null);
    }
    out[id] = slots;
  }
  return out;
}

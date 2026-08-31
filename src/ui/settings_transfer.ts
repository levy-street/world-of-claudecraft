// The localStorage half of the settings/frame-layout export + import (options
// window). The envelope, the key allowlist and the validation live in the pure
// core (settings_transfer_core.ts); this module only snapshots the allowed
// keys out of storage and writes a parsed code back in. Registered in
// tests/architecture.test.ts UI_DOM_MODULES (it owns browser storage).

import {
  buildTransferCode,
  type ParsedTransfer,
  parseTransferCode,
  type TransferKind,
  transferKeyAllowed,
} from './settings_transfer_core';

/** The shareable code for the current client state of `kind`. */
export function exportTransferCode(kind: TransferKind): string {
  const entries: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !transferKeyAllowed(kind, key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) entries[key] = value;
    }
  } catch {
    /* storage unavailable: an empty code still round-trips */
  }
  return buildTransferCode(kind, entries);
}

/** Validate `text` and write its entries. The caller reloads the page on
 *  success: every family here is read at boot (the settings apply-all loop,
 *  the movers' constructors), and a reload is the one path that re-applies
 *  all of them without a bespoke live-refresh per subsystem. */
export function importTransferCode(kind: TransferKind, text: string): ParsedTransfer {
  const parsed = parseTransferCode(kind, text);
  if (!parsed.ok) return parsed;
  try {
    for (const [key, value] of Object.entries(parsed.entries)) {
      localStorage.setItem(key, value);
    }
  } catch {
    return { ok: false, reason: 'format' };
  }
  return parsed;
}

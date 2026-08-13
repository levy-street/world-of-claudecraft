// The class power tuner's server-side runtime: the shipped-baseline catalog the
// admin dashboard renders, the boot install of this realm's saved document, and
// the read/save/history operations behind the admin endpoints.
//
// Boot order matters and is the reason this module exists rather than the
// handlers reaching for the sim directly:
//
//   1. snapshot the catalog from the SHIPPED ability table, so a slider at 1.0
//      always means "as authored" no matter what this realm has installed
//   2. install the realm's saved document onto the ability table
//   3. only then construct the GameServer, and with it the Sim
//
// A save persists and audits; it does NOT re-install. Tuning is deliberately
// boot-scoped (see src/sim/tuning/install.ts), so the dashboard reports the
// saved document as pending until the realm restarts.

import {
  activeClassTuning,
  buildClassTuningCatalog,
  type ClassTuningCatalog,
  type ClassTuningDocument,
  classTuningDocumentKey,
  countTunedChannels,
  emptyClassTuningDocument,
  installClassTuning,
  sanitizeClassTuningDocument,
  uninstallClassTuning,
} from '../src/sim/tuning';
import {
  type ClassTuningHistoryEntry,
  listClassTuningHistory,
  loadClassTuning,
  saveClassTuningChange,
} from './class_tuning_db';

export const CLASS_TUNING_NOTE_MAX = 500;

let catalogSnapshot: ClassTuningCatalog | null = null;
let savedDocument: ClassTuningDocument = emptyClassTuningDocument();
let savedAt: string | null = null;

/**
 * The shipped ability catalog: every class, spec, ability and tunable channel,
 * with the AUTHORED numbers behind each slider.
 *
 * Memoized on first call. Boot calls it before installing, so the memo holds
 * the untuned baseline for the life of the process.
 */
export function classTuningCatalog(): ClassTuningCatalog {
  catalogSnapshot ??= buildClassTuningCatalog();
  return catalogSnapshot;
}

export interface ClassTuningState {
  /** What is stored for this realm (what the dashboard's sliders show). */
  saved: ClassTuningDocument;
  /** What this process actually installed at boot. */
  active: ClassTuningDocument;
  savedAt: string | null;
  /** True when the saved document differs from the running one: restart pending. */
  pendingRestart: boolean;
  tunedAbilities: number;
  tunedWeapons: number;
  tunedChannels: number;
}

export function classTuningState(): ClassTuningState {
  const active = activeClassTuning();
  return {
    saved: savedDocument,
    active,
    savedAt,
    pendingRestart: classTuningDocumentKey(savedDocument) !== classTuningDocumentKey(active),
    tunedAbilities: Object.keys(savedDocument.abilities).length,
    tunedWeapons: Object.keys(savedDocument.weapons).length,
    tunedChannels: countTunedChannels(savedDocument),
  };
}

/**
 * Boot step: snapshot the shipped catalog, then load and install this realm's
 * document. Call BEFORE the first `GameServer` (and therefore the first `Sim`)
 * is constructed.
 *
 * A load failure is not fatal. A realm that cannot read its tuning row boots on
 * the shipped numbers, which is the same world every untuned realm runs; taking
 * the realm down over a balance document would be the worse outcome.
 */
export async function installRealmClassTuning(): Promise<ClassTuningState> {
  classTuningCatalog();
  try {
    const stored = await loadClassTuning();
    savedDocument = sanitizeClassTuningDocument(stored.data);
    savedAt = stored.updatedAt;
  } catch (err) {
    console.error('failed to load class tuning; booting on the shipped numbers:', err);
    savedDocument = emptyClassTuningDocument();
    savedAt = null;
  }
  // The install shares the load's fail-open rule: a document the walker cannot
  // apply must not keep the realm from booting, on THIS restart or any later
  // one (the row persists, so a throw here would red every boot until someone
  // hand-edited Postgres). Restore the shipped tables and boot untuned; the
  // saved document stays as loaded, so pendingRestart reports the drift.
  try {
    installClassTuning(savedDocument);
  } catch (err) {
    console.error('failed to install class tuning; booting on the shipped numbers:', err);
    uninstallClassTuning();
  }
  const state = classTuningState();
  if (state.tunedChannels > 0) {
    console.log(
      `class power tuning installed: ${state.tunedChannels} channel(s) across ${state.tunedAbilities} ability(ies) and ${state.tunedWeapons} weapon(s)`,
    );
  }
  return state;
}

export interface ClassTuningSaveOutcome {
  changed: boolean;
  state: ClassTuningState;
}

/**
 * Validate, persist and audit a new tuning document. Returns the state the
 * dashboard should render, including whether a restart is now pending.
 *
 * The document that reaches Postgres is always the SANITIZED one, so a row this
 * process would refuse to apply can never be stored in the first place.
 */
export async function saveRealmClassTuning(
  input: unknown,
  accountId: number,
  note: string,
): Promise<ClassTuningSaveOutcome> {
  const doc = sanitizeClassTuningDocument(input);
  const result = await saveClassTuningChange(
    doc as unknown as Record<string, unknown>,
    accountId,
    note.slice(0, CLASS_TUNING_NOTE_MAX),
  );
  savedDocument = doc;
  if (result.updatedAt !== null) savedAt = result.updatedAt;
  return { changed: result.changed, state: classTuningState() };
}

export function classTuningHistory(
  limit?: number,
  beforeId?: number,
): Promise<ClassTuningHistoryEntry[]> {
  return listClassTuningHistory(limit, beforeId);
}

/** Test seam: forget the memoized catalog and the loaded document. */
export function resetClassTuningRuntimeForTests(): void {
  catalogSnapshot = null;
  savedDocument = emptyClassTuningDocument();
  savedAt = null;
}

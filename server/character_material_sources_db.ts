// The character save's half of the material source audit: turn a PERSISTED
// character blob into the two container slot lists the shared ledger core reads
// (the personal bank and the Materials Vault), and journal what one save moved
// on the caller's OWN open transaction.
//
// This is the adapter, not the model. Every decision about what a movement IS
// belongs to server/material_source_ledger.ts and its sim leaves; everything
// here is shape: which persisted field holds which container, how the vault's
// two stores (the compact `stock` count map and the identity-preserving
// `special` list) become one slot list, and how a refusal aborts the save.
//
// Contracts:
//   * The caller passes a TRANSACTION-SCOPED client and has ALREADY taken the
//     characters row lock and landed the character UPDATE. The row lock is what
//     makes two concurrent saves of one character safe; the journal's own
//     anchor locks are not.
//   * The BEFORE state is the locked persisted pre-image the save statement
//     returned, never a re-read and never a reconstruction. A save that cannot
//     prove its row update (zero rows: a lease fence refused it) journals
//     NOTHING, and a save that DID update a row but carries no pre-image is a
//     broken call site, so it throws rather than journalling an invented empty
//     opening.
//   * Refusals are TOTAL and never player-facing: a malformed container aborts
//     the whole save through the caller's transaction rather than committing a
//     partial or a wrong audit. That is deliberately fail-closed. A persisted
//     row the shared core cannot read (a malformed composition, a count that is
//     not a positive safe integer on a MATERIAL id) therefore makes that
//     character's saves fail until an operator repairs the row; the alternative,
//     silently dropping the row, would fabricate a deposit on the next save.
//   * A container that moved nothing costs no query (the journal leaf skips it
//     entirely), so an ordinary save that touched neither store issues no SQL
//     here at all.
//   * The vault's compact `stock` map cannot carry composition: those units
//     project through the core's LEGACY reading (unrecorded stock, no invented
//     gatherer). Only `special` rows and bank slots can carry an exact
//     composition, and theirs is passed through untouched.

import type { CharacterState } from '../src/sim/character_state';
import { materialItemIds } from '../src/sim/material_ids';
import { cloneMaterialData } from '../src/sim/material_payload_identity';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import {
  type MaterialSourceContainerChange,
  type MaterialSourceJournalClient,
  type MaterialSourceJournalWriteResult,
  writeMaterialSourceJournal,
} from './material_source_journal_db';
import { REALM } from './realm';

/** The two character-owned containers, as slot lists the ledger core reads. */
export interface CharacterMaterialContainers {
  /** The personal bank's inventory (`state.bank.inventory`). */
  readonly personal: readonly MaterialStackSlot[];
  /** The Materials Vault: its compact stock rows followed by its special rows. */
  readonly vault: readonly MaterialStackSlot[];
}

/** The persisted before-state a save statement returned: the two raw JSONB
 *  subtrees, exactly as PostgreSQL handed them back, plus optional live-row
 *  proof that their journal anchors already exist. Offline captures omit the
 *  proofs and therefore retain the full opening. */
export interface CharacterMaterialPreimage {
  readonly bank: unknown;
  readonly vault: unknown;
  /** Trusted only when read as literal true from the locked live-row query. */
  readonly personalAnchorExists?: boolean;
  /** Trusted only when read as literal true from the locked live-row query. */
  readonly vaultAnchorExists?: boolean;
}

export type CharacterMaterialSourceError =
  | 'invalid-bank'
  | 'invalid-bank-inventory'
  | 'invalid-bank-slot'
  | 'invalid-vault'
  | 'invalid-vault-stock'
  | 'invalid-vault-special'
  | 'invalid-vault-slot';

export type CharacterMaterialSourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CharacterMaterialSourceError };

const succeed = <T>(value: T): CharacterMaterialSourceResult<T> => ({ ok: true, value });
const fail = (error: CharacterMaterialSourceError): CharacterMaterialSourceResult<never> => ({
  ok: false,
  error,
});

/** The fixed leading text of every refusal (call sites and tests match on it). */
export const CHARACTER_MATERIAL_SOURCE_REFUSAL = 'material source journal refused a character save';

/** A refusal from this adapter or the ledger core beneath it. Thrown, never
 *  returned, because the only correct answer is aborting the caller's
 *  transaction: the state write and its audit commit together or not at all. */
export class CharacterMaterialSourceRefused extends Error {
  readonly characterId: number;
  readonly reason: string;
  constructor(characterId: number, reason: string) {
    super(`${CHARACTER_MATERIAL_SOURCE_REFUSAL}: character ${characterId}, ${reason}`);
    this.name = 'CharacterMaterialSourceRefused';
    this.characterId = characterId;
    this.reason = reason;
  }
}

/**
 * An ORDINARY data record: an object literal, a JSON.parse result, or a
 * null-prototype bag (the material_sources.ts rule, for the same reason). A
 * Date, a Map, an array or a class instance has no business in a persisted blob
 * and is refused rather than read as an empty container.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Absent and null are the same state: a blob written before the feature, or a
 *  character who never opened the container. Both are an empty container, never
 *  a refusal. */
const isAbsent = (value: unknown): boolean => value === undefined || value === null;

/**
 * Persisted slot rows: an array whose every entry is a plain record. Indexed
 * rather than `every`, so a sparse array's holes are read as the `undefined`
 * the core would see instead of being skipped. Row FIELDS are NOT inspected
 * here: an ordinary row whose item id is not a material is the core's business
 * (it skips it), and a malformed MATERIAL row is the core's refusal to raise.
 */
function readSlotRows(value: unknown, out: MaterialStackSlot[]): boolean {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i];
    if (!isPlainRecord(row)) return false;
    // Through `unknown` on purpose. A plain record and a slot do not overlap as
    // TYPES (a slot's required fields are exactly what is not being checked
    // here), and inventing a field check to make the narrowing legal would
    // change behavior: a malformed MATERIAL row must reach the core to be
    // refused, not be dropped here into a silently smaller container.
    out.push(row as unknown as MaterialStackSlot);
  }
  return true;
}

function readBankSlots(bank: unknown): CharacterMaterialSourceResult<MaterialStackSlot[]> {
  if (isAbsent(bank)) return succeed([]);
  if (!isPlainRecord(bank)) return fail('invalid-bank');
  const inventory = bank.inventory;
  if (isAbsent(inventory)) return succeed([]);
  const slots: MaterialStackSlot[] = [];
  if (!readSlotRows(inventory, slots)) {
    return fail(Array.isArray(inventory) ? 'invalid-bank-slot' : 'invalid-bank-inventory');
  }
  return succeed(slots);
}

/**
 * The vault as ONE slot list. A compact `stock` row becomes the slot it
 * describes (an item id and a count, no payload, no composition), and every
 * `special` row rides through with its instance payload, crafted marker and
 * composition intact. Counts are handed to the core UNVALIDATED and UNCOERCED,
 * with the single exception noted at the read below (a row holding exactly
 * nothing): the core owns what a legal count is, and a second tolerance rule
 * here could only drift from the one the sim's own load path applies.
 */
function readVaultSlots(vault: unknown): CharacterMaterialSourceResult<MaterialStackSlot[]> {
  if (isAbsent(vault)) return succeed([]);
  if (!isPlainRecord(vault)) return fail('invalid-vault');
  const slots: MaterialStackSlot[] = [];

  const stock = vault.stock;
  if (!isAbsent(stock)) {
    if (!isPlainRecord(stock)) return fail('invalid-vault-stock');
    for (const [itemId, count] of Object.entries(stock)) {
      // A row holding EXACTLY nothing is not a holding: the vault's own load
      // path skips it for the same reason, and it contributes zero units to the
      // audit either way, so passing it to the core (which would refuse a
      // non-positive count and take the whole save down with it) would refuse a
      // save over a row that says nothing. Every OTHER value goes through
      // untouched: a negative, fractional or unparseable count DOES claim
      // something the ledger cannot represent, and the core owns that refusal.
      if (count === 0) continue;
      slots.push({ itemId, count: count as number });
    }
  }

  const special = vault.special;
  if (!isAbsent(special)) {
    if (!readSlotRows(special, slots)) {
      return fail(Array.isArray(special) ? 'invalid-vault-slot' : 'invalid-vault-special');
    }
  }
  return succeed(slots);
}

/** Both character-owned containers from one persisted blob's two subtrees. */
export function readCharacterMaterialContainers(
  bank: unknown,
  vault: unknown,
): CharacterMaterialSourceResult<CharacterMaterialContainers> {
  const personal = readBankSlots(bank);
  if (!personal.ok) return personal;
  const stored = readVaultSlots(vault);
  if (!stored.ok) return stored;
  return succeed({ personal: personal.value, vault: stored.value });
}

/**
 * A DETACHED copy of a live blob's two container subtrees, for the offline
 * writers that mutate `state` in place: the before-state must survive the
 * mutation that is about to overwrite it. Structural copy through the shared
 * safe walk, so unknown persisted fields and an own `__proto__` key survive and
 * nothing aliases the caller's blob.
 */
export function captureCharacterPreimage(
  state: Pick<CharacterState, 'bank' | 'vault'> | null | undefined,
): CharacterMaterialPreimage {
  return {
    bank: cloneMaterialData(state?.bank ?? null),
    vault: cloneMaterialData(state?.vault ?? null),
  };
}

/** The two container changes one character save can carry, in a fixed order
 *  (personal, then vault): the journal statement takes the caller's order and
 *  never reorders it, so a stable order keeps its anchor locks stable too. */
export function characterMaterialChanges(
  characterId: number,
  before: CharacterMaterialContainers,
  after: CharacterMaterialContainers,
  realm: string = REALM,
  anchorProof?: CharacterMaterialPreimage,
): readonly MaterialSourceContainerChange[] {
  return [
    {
      realm,
      container: 'personal',
      ownerId: characterId,
      before: before.personal,
      after: after.personal,
      ...(anchorProof?.personalAnchorExists === true ? { anchorExists: true } : {}),
    },
    {
      realm,
      container: 'vault',
      ownerId: characterId,
      before: before.vault,
      after: after.vault,
      ...(anchorProof?.vaultAnchorExists === true ? { anchorExists: true } : {}),
    },
  ];
}

function containersOrThrow(
  characterId: number,
  side: 'before' | 'after',
  bank: unknown,
  vault: unknown,
): CharacterMaterialContainers {
  const read = readCharacterMaterialContainers(bank, vault);
  if (!read.ok) throw new CharacterMaterialSourceRefused(characterId, `${side} ${read.error}`);
  return read.value;
}

/**
 * Journal what THIS save moved, on the caller's open transaction.
 *
 * `update` is the character UPDATE's own result: a zero-row update means the
 * fence refused the write, so nothing is journalled and the caller's rollback
 * (or its false return) stands alone. A row that DID update while `before` is
 * null is a broken call site rather than a fence miss, and throws: a source
 * write always rides a proven row update, and an absent pre-image must never be
 * read as an empty container (that would mint an opening the character never
 * had).
 *
 * Returns the journal's write result, or null when this save wrote no revision
 * (no row updated, or neither container moved).
 */
export async function journalCharacterSaveSources(
  client: MaterialSourceJournalClient,
  characterId: number,
  before: CharacterMaterialPreimage | null,
  update: { readonly rowCount: number | null },
  after: Pick<CharacterState, 'bank' | 'vault'>,
): Promise<MaterialSourceJournalWriteResult | null> {
  if ((update.rowCount ?? 0) <= 0) return null;
  if (before === null) {
    throw new CharacterMaterialSourceRefused(characterId, 'the landed save carried no pre-image');
  }
  const changes = characterMaterialChanges(
    characterId,
    containersOrThrow(characterId, 'before', before.bank, before.vault),
    containersOrThrow(characterId, 'after', after.bank, after.vault),
    REALM,
    before,
  );
  const written = await writeMaterialSourceJournal(client, changes, materialItemIds());
  if (!written.ok) throw new CharacterMaterialSourceRefused(characterId, written.error);
  return written.value;
}

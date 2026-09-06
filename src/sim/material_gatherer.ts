// WHO gathered a unit: the one place a gatherer descriptor is built, validated,
// and turned into the exact per-unit source composition a gathering grant lands.
//
// The rule this module exists to make unbreakable: ATTRIBUTION IS NOT A
// SIGNATURE. `gatherer` records who pulled the unit out of the world; `signer`
// is the pre-existing premium mark a rare roll mints. They travel in the SAME
// descriptor and are decided INDEPENDENTLY: a plain gather writes a gatherer and
// no signer, a rare gather writes both, and nothing here can ever promote the
// first into the second. `isPremiumMaterialSource` reads only `signer`, so a
// recorded gatherer confers no benefit by construction.
//
// IDENTITY IS SUPPLIED, NEVER INVENTED. This module mints nothing:
//   * ONLINE identity is the authoritative `characterId` the server passes to
//     addPlayer. Never a client- or save-supplied id.
//   * OFFLINE / HEADLESS identity is an opaque bounded id the HOST allocated
//     outside the sim (a crypto UUID, a namespace plus a counter) and passed in
//     explicitly, or the one a previous session PERSISTED into CharacterState.
//   * With neither, the player is UNKNOWN and gathers unrecorded stock, exactly
//     as before this feature existed. A bare `new Sim(...)` in a test is that
//     case, and it must stay that way: deriving an id from the world seed, the
//     entity id or the character name would mint a globally unique-looking
//     attribution out of values that are neither unique nor durable (two fresh
//     characters of one class and name, or two headless runs of one seed, would
//     silently share provenance).
//
// The NAME is a live SNAPSHOT read at each mint, never stored with the identity,
// which is what makes a rename apply to future gathers only: units already in a
// stack keep the name they were gathered under.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random,
// Date.now, performance.now or crypto. Draws NO rng. Every function is total and
// side-effect free; a refusal is an explicit code or `undefined`, never a throw,
// with the ONE deliberate exception at `readPersistedLocalIdentity`, whose
// contract is to refuse a load rather than let a malformed stored identity be
// silently regenerated into a different one.

import {
  canonicalMaterialComposition,
  MAX_GATHERER_ID_LENGTH,
  type MaterialComposition,
  type MaterialSource,
} from './material_sources';
import { isLegalCrafterName } from './professions/tools';

/**
 * The DURABLE half of a gatherer: everything except the name, which is read
 * live at mint time. `character` is the authoritative database id; the other
 * two are host-allocated opaque ids their host persists.
 */
export type GathererIdentity =
  | { readonly kind: 'character'; readonly id: number }
  | { readonly kind: 'offline' | 'headless'; readonly id: string };

/** The subset a host persists into CharacterState. A `character` identity is
 *  NEVER persisted: the server re-supplies it from the row at every join, so a
 *  save can never carry an identity claim back in. */
export type LocalGathererIdentity = Extract<GathererIdentity, { kind: 'offline' | 'headless' }>;

/** The player fields a mint reads. `PlayerMeta` satisfies it structurally. */
export interface GathererMetaView {
  readonly name: string;
  readonly gathererIdentity?: GathererIdentity;
}

export const LOCAL_GATHERER_KINDS = ['offline', 'headless'] as const;

/** Refusal reason for a malformed stored identity; an operator diagnostic, never
 *  player-facing text. */
export const INVALID_LOCAL_IDENTITY =
  'persisted material gatherer identity is invalid; refusing character load';

/** The id shape the shared descriptor validator already enforces, restated here
 *  so a host id is refused at the BOUNDARY rather than silently producing an
 *  unrecorded gather much later. */
function isLegalLocalId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_GATHERER_ID_LENGTH) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

const isLocalKind = (value: unknown): value is LocalGathererIdentity['kind'] =>
  value === 'offline' || value === 'headless';

/**
 * An ordinary data record: a plain object literal or a null-prototype bag, which
 * is all a save blob or a host config can legitimately be.
 *
 * Arrays, class instances and objects whose fields live on a PROTOTYPE are
 * refused as shapes, before their contents are read at all. An identity claim
 * inherited rather than owned is not data the host handed over, and letting one
 * satisfy the read would attribute a player under an id nothing actually stored.
 */
function isOrdinaryDataRecord(value: unknown): value is { kind?: unknown; id?: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A host-supplied local identity, or null when it is absent or unusable. Used
 *  for the FRESH host default, where an unusable value simply means "this host
 *  supplied nothing" and the player gathers unrecorded. THE shared shape check:
 *  the persisted read below is the same rule with a different refusal. */
export function readLocalGathererIdentity(value: unknown): LocalGathererIdentity | null {
  if (!isOrdinaryDataRecord(value)) return null;
  if (!isLocalKind(value.kind) || !isLegalLocalId(value.id)) return null;
  return { kind: value.kind, id: value.id };
}

/**
 * The PERSISTED local identity, read on the load path.
 *
 * ABSENT is exactly `undefined`, and nothing else: an old save has no such field
 * and its character simply keeps whatever identity the host supplies this
 * session.
 *
 * PRESENT BUT MALFORMED THROWS, and an explicit `null` IS present. A blob that
 * stored the field and stored a non-identity in it is a corrupt save, not a
 * pre-feature one, and reading it as absent is the exact silent regeneration
 * this refusal exists to prevent.
 *
 * It is the one refusal in this module, and the alternative is worse than a
 * failed load: silently falling back to the fresh host default would hand the
 * character a DIFFERENT durable identity than the one its existing gathered
 * stock is attributed to, quietly splitting one player's provenance in two with
 * nothing to detect it afterwards.
 */
export function readPersistedLocalIdentity(value: unknown): LocalGathererIdentity | undefined {
  if (value === undefined) return undefined;
  const parsed = readLocalGathererIdentity(value);
  if (parsed === null) throw new Error(INVALID_LOCAL_IDENTITY);
  return parsed;
}

/**
 * The identity a joining player runs under, from the three inputs a host can
 * offer, in strict precedence:
 *
 *  1. `characterId` (ONLINE). Authoritative, supplied by the server from the
 *     character row. A present-but-invalid id is a host defect, not a player
 *     input, so it refuses rather than falling through to a weaker identity: an
 *     online character must never be attributed under a local id.
 *  2. The PERSISTED local identity from the save. It supersedes the fresh host
 *     default, which is what makes a reloaded offline character keep the
 *     identity its already-gathered stock names.
 *  3. The fresh host default, for a character that has none yet.
 *
 * Undefined means UNKNOWN: nothing is invented, and every gather this session
 * lands as unrecorded stock.
 */
export function resolveGathererIdentity(input: {
  readonly characterId?: number;
  readonly persisted?: LocalGathererIdentity;
  readonly hostDefault?: LocalGathererIdentity | null;
}): GathererIdentity | undefined {
  const { characterId } = input;
  if (characterId !== undefined) {
    if (!Number.isSafeInteger(characterId) || characterId <= 0) {
      throw new RangeError('material gatherer characterId must be a positive safe integer');
    }
    return { kind: 'character', id: characterId };
  }
  if (input.persisted !== undefined) return input.persisted;
  return input.hostDefault ?? undefined;
}

/** The identity a save should carry: the LOCAL kinds only. An online character
 *  writes nothing, so its blob stays byte-identical to a pre-feature save and
 *  the server keeps re-supplying the row's own id. */
export function persistedLocalIdentity(
  identity: GathererIdentity | undefined,
): LocalGathererIdentity | undefined {
  if (identity === undefined || identity.kind === 'character') return undefined;
  return { kind: identity.kind, id: identity.id };
}

/**
 * The full descriptor for a mint: the durable identity plus a LIVE name
 * snapshot. Undefined when the player has no identity, or when the current name
 * cannot be recorded (the same bounded shape every other persisted name answers
 * to), because a descriptor with no readable name is not attribution.
 */
export function gathererFor(meta: GathererMetaView): MaterialSource['gatherer'] | undefined {
  const identity = meta.gathererIdentity;
  if (identity === undefined) return undefined;
  const name = meta.name;
  if (typeof name !== 'string' || name.length === 0 || !isLegalCrafterName(name)) return undefined;
  return identity.kind === 'character'
    ? { kind: 'character', id: identity.id, name }
    : { kind: identity.kind, id: identity.id, name };
}

/**
 * The exact per-unit sources ONE gathering grant lands: a single bucket of
 * `count` units carrying whatever provenance is actually known.
 *
 * `signer` is the caller's own premium decision and is passed in ONLY by a site
 * whose rare roll already said so. It rides the same bucket rather than the item
 * payload, which is what lets a signed yield share real stack room with plain
 * and differently-signed units instead of forcing its own slot, and what keeps
 * `instance.signer` from coexisting with a composition (an ambiguity the shared
 * stack reader refuses outright).
 *
 * Undefined when there is nothing to record: no identity and no signature. That
 * is the pre-feature grant, unchanged, and it is what a bare test Sim gets.
 */
export function gatheredMaterialSources(
  meta: GathererMetaView,
  count: number,
  opts?: { readonly signer?: string },
): MaterialComposition | undefined {
  if (!Number.isSafeInteger(count) || count <= 0) return undefined;
  const gatherer = gathererFor(meta);
  const signer = opts?.signer;
  const signable = typeof signer === 'string' && isLegalCrafterName(signer);
  if (gatherer === undefined && !signable) return undefined;

  const source: { gatherer?: MaterialSource['gatherer']; signer?: string } = {};
  if (gatherer !== undefined) source.gatherer = gatherer;
  // Independent of the gatherer in both directions: a signature with no
  // recorded gatherer is the legacy premium shape and stays legal.
  if (signable) source.signer = signer;

  // Through the shared algebra, never hand-built: one validator decides descriptor
  // legality for grants, saves, journals and receipts alike, and it hands back a
  // freshly owned bucket so no grant aliases the meta it read.
  const canonical = canonicalMaterialComposition([{ source, count }], count);
  return canonical.ok ? canonical.value : undefined;
}

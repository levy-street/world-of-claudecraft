// The BROWSER host's allocator for offline material-gatherer identities.
//
// It lives here, outside `src/sim/`, for one reason: minting a unique id needs
// randomness, and the sim has none. The sim only ever RECEIVES a finished
// `{kind, id}` value, so the same explicit inputs always replay to the same
// attribution.
//
// The shape is ONE fresh cryptographic UUID PER OFFLINE CHARACTER, and nothing
// else. Not a device key, not a counter, not a stored value of any kind:
//   * 122 random bits per allocation already separate two characters, two tabs,
//     two devices and two sessions, with no allocator state for any of them to
//     race over. A persisted counter had to be read, incremented and written
//     between two allocations to stay unique, which is exactly the sequence two
//     tabs interleave and a corrupt read restarts.
//   * A character that must KEEP its id across a reload does not re-mint: the id
//     it was allocated is persisted in `CharacterState.materialGathererIdentity`
//     and restored ahead of this fresh default (see `src/sim/material_gatherer.ts`
//     `resolveGathererIdentity`). Durability is the save's job, not this module's.
//   * Storing nothing also means storing no per-device identifier, so an offline
//     session leaves no cross-character handle behind on the machine.
//
// The id is opaque on purpose. It is not derived from the world seed, the
// character name, the class or any entity id: those are neither unique nor
// durable, and deriving from them is exactly how two distinct players end up
// sharing one gatherer record.
//
// Randomness missing means NO identity, never a guessed one. There is
// deliberately no `Math.random` or clock fallback: both would mint a
// unique-LOOKING id that collides in practice, and a false attribution is worse
// than none. The caller passes the null through, the sim leaves the player
// unknown, and that session's gathers record nothing rather than something
// false.

import type { LocalGathererIdentity } from '../sim/material_gatherer';

/** The `off:` tag plus a 36-character UUID is 40 characters. The sim's shared
 *  descriptor validator bounds a gatherer id at `MAX_GATHERER_ID_LENGTH` (64)
 *  printable-ASCII characters; this must stay at or under it, which
 *  `tests/gatherer_host_identity.test.ts` pins against the sim's own constant. */
const OFFLINE_ID_PREFIX = 'off:';
const MAX_OFFLINE_ID_LENGTH = 64;

/** Canonical lowercase UUID, the one output shape both mint paths produce. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const UUID_BYTES = 16;

/**
 * The randomness this module needs, and nothing more. `Crypto` satisfies it
 * structurally, so production passes the host's own; a test passes a
 * deterministic stub. Both members are optional because an environment can
 * expose a `crypto` object with neither.
 */
export interface GathererIdentityRandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => Uint8Array;
}

/** The host's randomness, or null where there is none. Read at CALL time, never
 *  at module load, so importing this file is safe under a bare Node test env. */
function hostRandomSource(): GathererIdentityRandomSource | null {
  try {
    return globalThis.crypto ?? null;
  } catch {
    // Some locked-down embedders throw on the property access itself.
    return null;
  }
}

/** 16 random bytes as a canonical v4 UUID. The version and variant bits are
 *  stamped on a COPY, so the caller's buffer is never rewritten. */
function formatUuidV4(bytes: Uint8Array): string {
  const octets = Array.from(bytes);
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;
  const hex = octets.map((octet) => octet.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * One fresh UUID from the strongest member the source actually offers, or null.
 *
 * `randomUUID` first because it is the purpose-built call; `getRandomValues` is
 * the wider fallback. A `randomUUID` that answers something other than a
 * canonical UUID is not trusted and falls through to the byte path, because the
 * id it would produce has to satisfy the sim's bounded shape either way.
 */
function mintUuid(source: GathererIdentityRandomSource): string | null {
  try {
    if (typeof source.randomUUID === 'function') {
      const uuid = source.randomUUID();
      if (typeof uuid === 'string' && UUID_SHAPE.test(uuid)) return uuid;
    }
  } catch {
    // A restricted UUID capability does not rule out the byte capability.
  }
  try {
    if (typeof source.getRandomValues === 'function') {
      const bytes = source.getRandomValues(new Uint8Array(UUID_BYTES));
      if (bytes instanceof Uint8Array && bytes.length === UUID_BYTES) return formatUuidV4(bytes);
    }
  } catch {
    // Attribution is optional when the host has no usable crypto capability.
  }
  return null;
}

/** The bound the sim's descriptor validator enforces, restated at this boundary
 *  so a mint that could not be recorded is refused HERE rather than silently
 *  producing unattributed gathers much later. */
function isBoundedPrintableAscii(value: string): boolean {
  if (value.length === 0 || value.length > MAX_OFFLINE_ID_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/**
 * Allocate ONE offline gatherer identity, for ONE offline character.
 *
 * Every call mints independently, so two calls never collide however they are
 * interleaved: there is no shared state between them to read, bump or corrupt.
 * Null means this environment offered no usable randomness, and the caller must
 * pass that null through rather than substituting anything.
 *
 * `source` exists for tests; production callers pass nothing and get the host's
 * own `crypto`.
 */
export function allocateOfflineGathererIdentity(
  source: GathererIdentityRandomSource | null = hostRandomSource(),
): LocalGathererIdentity | null {
  if (source === null) return null;
  const uuid = mintUuid(source);
  if (uuid === null) return null;
  const id = `${OFFLINE_ID_PREFIX}${uuid}`;
  if (!isBoundedPrintableAscii(id)) return null;
  return { kind: 'offline', id };
}

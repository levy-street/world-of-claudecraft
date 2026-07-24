import type { Pool } from 'pg';
import type { ProceduralItemUidLease } from '../src/sim/procedural_item_uid';

export const PROCEDURAL_ITEM_UID_BLOCK_SIZE = 4_294_967_296;

export const PROCEDURAL_ITEM_UID_SCHEMA = `
CREATE TABLE IF NOT EXISTS procedural_item_uid_sequences (
  realm TEXT PRIMARY KEY,
  next_serial BIGINT NOT NULL CHECK (next_serial >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL = `
INSERT INTO procedural_item_uid_sequences (realm, next_serial, updated_at)
VALUES ($1, $2::bigint + 1, now())
ON CONFLICT (realm) DO UPDATE SET
  next_serial = procedural_item_uid_sequences.next_serial + $2::bigint,
  updated_at = now()
RETURNING
  (next_serial - $2::bigint)::text AS start_serial,
  next_serial::text AS end_exclusive`;

type ReservedUidBlockRow = {
  start_serial: string;
  end_exclusive: string;
};

const REALM_ENCODING_BASE = 67n;

function realmCharacterDigit(char: string): bigint {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return BigInt(code - 64);
  if (code >= 97 && code <= 122) return BigInt(code - 70);
  if (code >= 48 && code <= 57) return BigInt(code + 5);
  if (char === ' ') return 63n;
  if (code === 39) return 64n;
  if (char === '_') return 65n;
  if (char === '-') return 66n;
  throw new Error('invalid procedural item UID realm');
}

// resolveRealm limits names to 24 characters from a 66-character alphabet.
// Non-zero base-67 digits give an exact lowercase base-36 encoding that fits
// the existing 32-character namespace field.
export function proceduralItemUidNamespaceForRealm(realm: string): string {
  if (!realm || realm.length > 24) throw new Error('invalid procedural item UID realm');
  let encoded = 0n;
  for (const char of realm) {
    encoded = encoded * REALM_ENCODING_BASE + realmCharacterDigit(char);
  }
  return `r${encoded.toString(36)}`;
}

export async function reserveProceduralItemUidBlock(
  pool: Pick<Pool, 'query'>,
  realm: string,
  blockSize = PROCEDURAL_ITEM_UID_BLOCK_SIZE,
): Promise<ProceduralItemUidLease> {
  const realmNamespace = proceduralItemUidNamespaceForRealm(realm);
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
    throw new Error('procedural item UID block size must be a positive safe integer');
  }
  const result = await pool.query<ReservedUidBlockRow>(RESERVE_PROCEDURAL_ITEM_UID_BLOCK_SQL, [
    realm,
    String(blockSize),
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('procedural item UID reservation returned no row');

  let startSerial: bigint;
  let endExclusive: bigint;
  try {
    startSerial = BigInt(row.start_serial);
    endExclusive = BigInt(row.end_exclusive);
  } catch {
    throw new Error('procedural item UID reservation returned malformed serials');
  }
  if (startSerial < 1n || endExclusive - startSerial !== BigInt(blockSize)) {
    throw new Error('procedural item UID reservation returned an invalid range');
  }
  return {
    realmNamespace,
    startSerial: startSerial.toString(),
    endExclusive: endExclusive.toString(),
  };
}

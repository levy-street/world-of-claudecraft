// Provably fair commit-reveal for every house-banked casino game (the RiverBoat
// realm's spinner, packs, and future domain-tagged games). The server commits to
// a secret daily seed BEFORE any plays (publishing sha256(seed)), derives each
// outcome deterministically from that seed plus the player's identity and their
// own client seed, and REVEALS the seed after the day closes so anyone can
// recompute every outcome and confirm it matches what was paid.
//
// Money-deciding randomness must be unpredictable to the client before the
// commit, so it lives here in server/ and never in the deterministic src/sim
// (which a client can replay). This module is pure crypto over node:crypto with
// no DB or network, so the whole fairness surface is unit-testable. A new
// house-banked game adds its own domain-tagged digest helper beside spinDigest
// and packUnit (the |spin| and |pack| tags below), never reuses another game's
// tag: domain separation is what stops one revealed seed stream from predicting
// a different game's outcomes.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Daily seed length in bytes (256 bits of entropy). */
export const DAILY_SEED_BYTES = 32;

const HEX64 = /^[0-9a-f]{64}$/i;

/** A fresh secret daily seed. Called once per UTC day before any spins. */
export function generateDailySeed(): Buffer {
  return randomBytes(DAILY_SEED_BYTES);
}

/** The public commitment for a seed: sha256(seed), lowercase hex. */
export function commitFor(seed: Buffer): string {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Verify a revealed seed matches its published commitment. Returns false for a
 * malformed commit string or a seed that hashes to anything else. Constant-time
 * compare so a caller cannot probe the commit byte-by-byte by timing.
 */
export function verifyReveal(commitHex: string, seed: Buffer): boolean {
  if (!HEX64.test(commitHex)) return false;
  const expected = createHash('sha256').update(seed).digest();
  const got = Buffer.from(commitHex, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * The per-spin digest. Domain-separated so a seed reused across features cannot
 * produce the same stream, and bound to (accountId, dayNonce, clientSeed):
 *   - accountId + dayNonce make each of a player's spins independent,
 *   - clientSeed is player-supplied entropy, so the server cannot grind the seed
 *     to target a specific player's outcome (standard provably-fair property).
 */
export function spinDigest(
  seed: Buffer,
  accountId: number,
  dayNonce: number,
  clientSeed: string,
): Buffer {
  return createHash('sha256')
    .update(seed)
    .update(Buffer.from(`|spin|${accountId}|${dayNonce}|${clientSeed}`, 'utf8'))
    .digest();
}

/**
 * Map a 32-byte digest to a uniform double in [0, 1). Uses the top 53 bits (the
 * full mantissa of a double) from the first 8 bytes, the standard construction
 * for an unbiased random double from 64 random bits.
 */
export function unitFromDigest(digest: Buffer): number {
  const hi = digest.readUInt32BE(0); // 32 bits
  const lo = digest.readUInt32BE(4); // 32 bits
  // (hi << 21) | (lo >>> 11) gives 53 bits; divide by 2^53.
  return (hi * 2097152 + (lo >>> 11)) / 9007199254740992;
}

/** The spin's outcome value in [0, 1) used to index the prize table. */
export function deriveOutcomeUnit(
  seed: Buffer,
  accountId: number,
  dayNonce: number,
  clientSeed: string,
): number {
  return unitFromDigest(spinDigest(seed, accountId, dayNonce, clientSeed));
}

/**
 * A fair uniform in [0, 1) for the `index`-th roll of a pack open. Domain-tagged
 * "pack" (distinct from spins) and bound to the burn signature, which the player
 * cannot predict before they burn, so neither side can grind the roll: the
 * outcome is fixed the moment the burn lands and is recomputable from the
 * revealed daily seed.
 */
export function packUnit(seed: Buffer, accountId: number, txSig: string, index: number): number {
  const digest = createHash('sha256')
    .update(seed)
    .update(Buffer.from(`|pack|${accountId}|${txSig}|${index}`, 'utf8'))
    .digest();
  return unitFromDigest(digest);
}

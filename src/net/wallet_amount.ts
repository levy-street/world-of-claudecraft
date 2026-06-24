// Pure (dependency-free) money math for player-to-player transfers, split out of
// src/net/wallet.ts so it can be unit-tested without loading the Reown /
// @solana/web3.js bundle (which only runs in a browser environment).

/**
 * Convert a human-entered decimal amount to integer base units for `decimals`,
 * with no floating-point error (it parses the digit strings directly rather than
 * multiplying a float). Throws a user-facing error on malformed input, more
 * fractional digits than the currency supports, or a non-positive amount.
 */
export function parseAmountToBase(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (trimmed === '' || trimmed === '.' || !/^\d*\.?\d*$/.test(trimmed)) {
    throw new Error('Enter a valid amount.');
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const base = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
  if (base <= 0n) throw new Error('Enter an amount greater than zero.');
  return base;
}

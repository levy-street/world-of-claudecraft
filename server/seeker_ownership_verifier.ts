export interface SeekerOwnershipVerifierDeps {
  claimForAccount(accountId: number): Promise<{ mint: string } | null>;
  walletForAccount(accountId: number): Promise<{ pubkey: string } | null>;
  findToken(
    walletAddress: string,
    signal: AbortSignal,
    requiredMint: string,
  ): Promise<{ mint: string } | null>;
}

export interface SeekerOwnershipVerifier {
  verify(accountId: number, signal: AbortSignal): Promise<boolean>;
}

/**
 * Verify current SGT ownership before a spin. Admission, single-flight, and the
 * request deadline are owned by the caller's process-wide bounded executor.
 */
export function createSeekerOwnershipVerifier(
  deps: SeekerOwnershipVerifierDeps,
): SeekerOwnershipVerifier {
  return {
    async verify(accountId, signal) {
      try {
        const [claim, wallet] = await Promise.all([
          deps.claimForAccount(accountId),
          deps.walletForAccount(accountId),
        ]);
        if (!claim || !wallet || signal.aborted) return false;
        const token = await deps.findToken(wallet.pubkey, signal, claim.mint);
        return token?.mint === claim.mint;
      } catch {
        return false;
      }
    },
  };
}

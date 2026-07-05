// STUB (RFC) — per-agent Solana wallet auto-provisioning.
// On agent creation: generate a Keypair, store the base58 secret in an encrypted SecretVault,
// return the public address. Recommended for v1 over Steward (simpler; v1 scope is hold/earn only).
// TODO(eliza): import { Keypair } from '@solana/web3.js'; import bs58 from 'bs58'.

export interface SecretVault {
  get(agentId: string, key: string): Promise<string | null>;
  put(agentId: string, key: string, value: string): Promise<void>; // encrypted at rest
}

export interface ProvisionedWallet {
  address: string; // base58 pubkey
}

/** Idempotent: returns the existing wallet if one is already vaulted for this agent. */
export async function provisionWallet(
  agentId: string,
  vault: SecretVault,
): Promise<ProvisionedWallet> {
  const existing = await vault.get(agentId, 'SOLANA_PRIVATE_KEY');
  if (existing) {
    // return { address: addressFromSecret(existing) };
    throw new Error('TODO(eliza): derive address from existing secret');
  }
  // const kp = Keypair.generate();
  // const secretB58 = bs58.encode(kp.secretKey);   // format @elizaos/plugin-wallet expects
  // await vault.put(agentId, 'SOLANA_PRIVATE_KEY', secretB58);
  // return { address: kp.publicKey.toBase58() };
  void agentId;
  void vault;
  throw new Error('TODO(eliza): provisionWallet — generate + vault keypair');
}

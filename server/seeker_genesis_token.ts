export const SEEKER_GENESIS_TOKEN_MINT_AUTHORITY = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4';
export const SEEKER_GENESIS_TOKEN_METADATA_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
export const SEEKER_GENESIS_TOKEN_GROUP_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';

export interface SeekerGenesisTokenDescriptor {
  mintAddress: string;
  ownerAmount: string;
  mintAuthority: string | null;
  metadataPointerAuthority: string | null;
  metadataAddress: string | null;
  groupAddress: string | null;
}

function ownsPositiveAmount(amount: string): boolean {
  return /^\d+$/.test(amount) && BigInt(amount) > 0n;
}

/**
 * Match every identity-bearing Token-2022 extension published for SGT.
 * The balance check prevents an emptied token account from proving ownership.
 */
export function isSeekerGenesisToken(descriptor: SeekerGenesisTokenDescriptor): boolean {
  return (
    ownsPositiveAmount(descriptor.ownerAmount) &&
    descriptor.mintAuthority === SEEKER_GENESIS_TOKEN_MINT_AUTHORITY &&
    descriptor.metadataPointerAuthority === SEEKER_GENESIS_TOKEN_MINT_AUTHORITY &&
    descriptor.metadataAddress === SEEKER_GENESIS_TOKEN_METADATA_ADDRESS &&
    descriptor.groupAddress === SEEKER_GENESIS_TOKEN_GROUP_ADDRESS
  );
}

export function verifiedSeekerGenesisTokenMint(
  descriptors: readonly SeekerGenesisTokenDescriptor[],
): string | null {
  for (const descriptor of descriptors) {
    if (isSeekerGenesisToken(descriptor)) return descriptor.mintAddress;
  }
  return null;
}

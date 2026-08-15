import { describe, expect, it } from 'vitest';
import {
  isSeekerGenesisToken,
  SEEKER_GENESIS_TOKEN_GROUP_ADDRESS,
  SEEKER_GENESIS_TOKEN_METADATA_ADDRESS,
  SEEKER_GENESIS_TOKEN_MINT_AUTHORITY,
  type SeekerGenesisTokenDescriptor,
  verifiedSeekerGenesisTokenMint,
} from '../server/seeker_genesis_token';

const validDescriptor: SeekerGenesisTokenDescriptor = {
  mintAddress: 'SgtMint111111111111111111111111111111111111',
  ownerAmount: '1',
  mintAuthority: SEEKER_GENESIS_TOKEN_MINT_AUTHORITY,
  metadataPointerAuthority: SEEKER_GENESIS_TOKEN_MINT_AUTHORITY,
  metadataAddress: SEEKER_GENESIS_TOKEN_METADATA_ADDRESS,
  groupAddress: SEEKER_GENESIS_TOKEN_GROUP_ADDRESS,
};

describe('Seeker Genesis Token verification', () => {
  it('accepts only a positive balance with every official SGT identity field', () => {
    expect(isSeekerGenesisToken(validDescriptor)).toBe(true);

    for (const key of [
      'mintAuthority',
      'metadataPointerAuthority',
      'metadataAddress',
      'groupAddress',
    ] as const) {
      expect(isSeekerGenesisToken({ ...validDescriptor, [key]: 'attacker' })).toBe(false);
    }
  });

  it('rejects empty, invalid, and previously transferred token accounts', () => {
    for (const ownerAmount of ['', '-1', '0', '0.1', 'not-a-number']) {
      expect(isSeekerGenesisToken({ ...validDescriptor, ownerAmount })).toBe(false);
    }
  });

  it('returns the unique mint used for reward anti-sybil tracking', () => {
    expect(
      verifiedSeekerGenesisTokenMint([
        { ...validDescriptor, mintAddress: 'fake', groupAddress: 'attacker' },
        validDescriptor,
      ]),
    ).toBe(validDescriptor.mintAddress);
    expect(verifiedSeekerGenesisTokenMint([{ ...validDescriptor, ownerAmount: '0' }])).toBeNull();
  });
});

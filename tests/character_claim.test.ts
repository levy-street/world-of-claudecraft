// server/character_claim.ts, the on-chain ownership check at the heart of
// tradeable characters: an account controls a bound character only when its
// linked wallet is the subdomain's current on-chain owner. DB + SNS reads are
// mocked (the mocks target server/sns_chain, the IO shell) so we test the
// decision logic, not the chain.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  walletForAccount: vi.fn(),
  getCharacterById: vi.fn(),
  reassignCharacterAccount: vi.fn(),
}));
vi.mock('../server/sns_chain', () => ({
  resolveSubdomainOwner: vi.fn(),
  snsReady: () => true,
}));

import { accountControlsBoundCharacter } from '../server/character_claim';
import * as db from '../server/db';
import * as snsChain from '../server/sns_chain';

const WALLET = 'Wallet1111111111111111111111111111111111111';
const DOMAIN = 'aragorn.worldofclaudecraft.sol';

beforeEach(() => {
  vi.mocked(db.walletForAccount).mockReset();
  vi.mocked(snsChain.resolveSubdomainOwner).mockReset();
});

describe('accountControlsBoundCharacter', () => {
  it('is true when the linked wallet is the subdomain owner', async () => {
    vi.mocked(db.walletForAccount).mockResolvedValue({
      account_id: 1,
      pubkey: WALLET,
      linked_at: 'now',
    } as any);
    vi.mocked(snsChain.resolveSubdomainOwner).mockResolvedValue(WALLET);
    expect(await accountControlsBoundCharacter(1, DOMAIN)).toBe(true);
    expect(snsChain.resolveSubdomainOwner).toHaveBeenCalledWith(DOMAIN);
  });

  it('is false when the on-chain owner is a different wallet (sold/transferred)', async () => {
    vi.mocked(db.walletForAccount).mockResolvedValue({
      account_id: 1,
      pubkey: WALLET,
      linked_at: 'now',
    } as any);
    vi.mocked(snsChain.resolveSubdomainOwner).mockResolvedValue(
      'SomeoneElse2222222222222222222222222222222',
    );
    expect(await accountControlsBoundCharacter(1, DOMAIN)).toBe(false);
  });

  it('is false when the account has no linked wallet', async () => {
    vi.mocked(db.walletForAccount).mockResolvedValue(null);
    expect(await accountControlsBoundCharacter(1, DOMAIN)).toBe(false);
    expect(snsChain.resolveSubdomainOwner).not.toHaveBeenCalled();
  });

  it('is false when the subdomain no longer exists or cannot be read', async () => {
    vi.mocked(db.walletForAccount).mockResolvedValue({
      account_id: 1,
      pubkey: WALLET,
      linked_at: 'now',
    } as any);
    vi.mocked(snsChain.resolveSubdomainOwner).mockResolvedValue(null);
    expect(await accountControlsBoundCharacter(1, DOMAIN)).toBe(false);
  });
});

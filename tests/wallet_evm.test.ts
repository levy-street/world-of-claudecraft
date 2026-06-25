import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundaries (eth_rpc, db) — NOT the EIP-1271 decision under test.
const eth = vi.hoisted(() => ({
  ethGetCode: vi.fn(async (): Promise<string | null> => '0x'),
  ethCall: vi.fn(async (): Promise<string | null> => null),
  ETH_CHAIN_ID: 1,
}));
vi.mock('../server/eth_rpc', () => eth);
vi.mock('../server/db', () => ({
  createEvmWalletChallenge: vi.fn(), consumeEvmWalletChallenge: vi.fn(), pruneEvmWalletChallenges: vi.fn(),
  linkEvmWalletToAccount: vi.fn(), evmWalletForAccount: vi.fn(), unlinkEvmWallet: vi.fn(),
}));
vi.mock('../server/ratelimit', () => ({ walletLinkRateLimited: vi.fn(() => false) }));

import { verifyContractSignature } from '../server/wallet_evm';
import { EIP1271_MAGIC_VALUE } from '../server/wallet_link_evm';

const SAFE = '0x' + 'a'.repeat(40);
const SIG = '0x' + 'bc'.repeat(65);

beforeEach(() => {
  eth.ethGetCode.mockReset();
  eth.ethCall.mockReset();
});

describe('verifyContractSignature (EIP-1271)', () => {
  it('returns false for an EOA (no contract code) without calling isValidSignature', async () => {
    eth.ethGetCode.mockResolvedValue('0x');
    expect(await verifyContractSignature(SAFE, 'msg', SIG)).toBe(false);
    expect(eth.ethCall).not.toHaveBeenCalled();
  });
  it('accepts when the contract returns the EIP-1271 magic value', async () => {
    eth.ethGetCode.mockResolvedValue('0x363d3d373d3d3d363d73'); // has code
    eth.ethCall.mockResolvedValue(`${EIP1271_MAGIC_VALUE}${'0'.repeat(56)}`);
    expect(await verifyContractSignature(SAFE, 'msg', SIG)).toBe(true);
  });
  it('rejects when the contract returns a non-magic value', async () => {
    eth.ethGetCode.mockResolvedValue('0xabcdef');
    eth.ethCall.mockResolvedValue(`0xdeadbeef${'0'.repeat(56)}`);
    expect(await verifyContractSignature(SAFE, 'msg', SIG)).toBe(false);
  });
  it('fails closed when the RPC is unavailable (getCode null)', async () => {
    eth.ethGetCode.mockResolvedValue(null);
    expect(await verifyContractSignature(SAFE, 'msg', SIG)).toBe(false);
    expect(eth.ethCall).not.toHaveBeenCalled();
  });
  it('fails closed when the isValidSignature call returns null', async () => {
    eth.ethGetCode.mockResolvedValue('0xabcdef');
    eth.ethCall.mockResolvedValue(null);
    expect(await verifyContractSignature(SAFE, 'msg', SIG)).toBe(false);
  });
});

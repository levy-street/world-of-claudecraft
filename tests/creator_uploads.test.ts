import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundaries (DB, RPC balance, Pinata, remote fetch/validate) — NOT
// the marketplace orchestration under test. isSolanaAddress + normalizeDesignSpec
// stay real.
const db = vi.hoisted(() => ({
  createMarketplaceQuote: vi.fn(), getMarketplaceQuote: vi.fn(), deleteMarketplaceQuote: vi.fn(),
  redeemPurchase: vi.fn(), listLiveCreatorSkins: vi.fn(async () => []),
  getCreatorSkin: vi.fn(async (_id: string) => null as unknown),
  walletForAccount: vi.fn(async (_a: number) => ({ pubkey: 'So11111111111111111111111111111111111111112' })),
  upsertCreatorSkin: vi.fn(async () => {}),
  countLiveCreatorSkinsByAccount: vi.fn(async () => 0),
  countHostedSkinsByAccount: vi.fn(async () => 0),
  ensureCreatorTrust: vi.fn(async () => {}),
  getCreatorTrust: vi.fn(async () => ({ approvedCount: 0, strikes: 0, lastStrikeAt: null, trusted: false, firstListingAt: new Date().toISOString() })),
  listHostedSkinsByAccount: vi.fn(async () => [] as Array<{ id: string; overflowHidden: boolean }>),
  setCreatorSkinOverflowHidden: vi.fn(async () => {}),
  setCreatorSkinReview: vi.fn(async () => {}), setCreatorSkinStatus: vi.fn(async () => {}),
  setCreatorTrusted: vi.fn(async () => {}), bumpApprovedListings: vi.fn(async () => {}), recordCreatorStrike: vi.fn(async () => {}),
}));
vi.mock('../server/db', () => db);
const woc = vi.hoisted(() => ({ holderInfoForPubkey: vi.fn(async () => ({ tier: 3, balance: 100 })) }));
vi.mock('../server/woc_balance', () => woc);
const pin = vi.hoisted(() => ({ pinFileToIPFS: vi.fn(async () => 'QmDEADBEEF'), unpinFromIPFS: vi.fn(async () => {}), pinataEnabled: vi.fn(() => true) }));
vi.mock('../server/pinata', () => pin);
const ssa = vi.hoisted(() => ({
  fetchRemoteImage: vi.fn(async () => Buffer.from('png')),
  validateSkinPng: vi.fn(() => ({ ok: true, sha256: 'abc', width: 1024, height: 1024 })),
}));
vi.mock('../server/skin_assets', () => ssa);

import { createHostedListing, createSelfHostedListing, enforceHostedQuota, reviewListing, removeListing } from '../server/marketplace';

const WALLET = 'So11111111111111111111111111111111111111112';
const base = { name: 'My Skin', description: 'd', priceUsdc: 10_000_000n, targetClass: null };

beforeEach(() => { vi.clearAllMocks(); woc.holderInfoForPubkey.mockResolvedValue({ tier: 3, balance: 100 }); pin.pinataEnabled.mockReturnValue(true); ssa.validateSkinPng.mockReturnValue({ ok: true, sha256: 'abc', width: 1024, height: 1024 }); });

describe('createHostedListing — quota gate + pin + review', () => {
  it('denies at quota and never pins', async () => {
    db.countHostedSkinsByAccount.mockResolvedValueOnce(2); // coppercrest quota is 2
    const r = await createHostedListing({ ...base, bytes: Buffer.from('x') }, 7, WALLET);
    expect(r).toEqual({ ok: false, reason: 'hosted_quota_exceeded' });
    expect(pin.pinFileToIPFS).not.toHaveBeenCalled();
    expect(db.upsertCreatorSkin).not.toHaveBeenCalled();
  });
  it('below quota: pins to IPFS and lists pending (untrusted creator)', async () => {
    const r = await createHostedListing({ ...base, bytes: Buffer.from('x') }, 7, WALLET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reviewStatus).toBe('pending');
    expect(pin.pinFileToIPFS).toHaveBeenCalledTimes(1);
    const row = db.upsertCreatorSkin.mock.calls[0][0] as { source: string; ipfsCid: string; reviewStatus: string; assetUrl: string };
    expect(row).toMatchObject({ source: 'hosted', ipfsCid: 'QmDEADBEEF', reviewStatus: 'pending' });
    expect(row.assetUrl).toMatch(/^\/api\/skins\/cs_[0-9a-f]+\/atlas\.png$/);
  });
  it('trusted creator (whale, 1 approval) lists instant-live', async () => {
    woc.holderInfoForPubkey.mockResolvedValue({ tier: 7, balance: 1_000_000 });
    db.getCreatorTrust.mockResolvedValue({ approvedCount: 1, strikes: 0, lastStrikeAt: null, trusted: true, firstListingAt: new Date(Date.now() - 1e9).toISOString() });
    const r = await createHostedListing({ ...base, bytes: Buffer.from('x') }, 7, WALLET);
    expect(r.ok && r.reviewStatus === 'approved').toBe(true);
  });
  it('refuses when Pinata is unconfigured', async () => {
    pin.pinataEnabled.mockReturnValue(false);
    expect(await createHostedListing({ ...base, bytes: Buffer.from('x') }, 7, WALLET)).toEqual({ ok: false, reason: 'hosting_unavailable' });
  });
  it('rejects an invalid PNG before pinning', async () => {
    ssa.validateSkinPng.mockReturnValueOnce({ ok: false, reason: 'invalid_png' } as never);
    expect(await createHostedListing({ ...base, bytes: Buffer.from('x') }, 7, WALLET)).toEqual({ ok: false, reason: 'invalid_png' });
    expect(pin.pinFileToIPFS).not.toHaveBeenCalled();
  });
});

describe('createSelfHostedListing — SSRF-mapped failure + free path', () => {
  it('maps an SSRF/transport throw to a clean failure (nothing persisted)', async () => {
    ssa.fetchRemoteImage.mockRejectedValueOnce(new Error('url_private_host'));
    expect(await createSelfHostedListing({ ...base, originUrl: 'http://169.254.169.254/x' }, 7, WALLET)).toEqual({ ok: false, reason: 'url_private_host' });
    expect(db.upsertCreatorSkin).not.toHaveBeenCalled();
  });
  it('free path persists with origin_url + opaque assetUrl, pending review', async () => {
    const r = await createSelfHostedListing({ ...base, originUrl: 'https://cdn.example/s.png' }, 7, WALLET);
    expect(r.ok).toBe(true);
    const row = db.upsertCreatorSkin.mock.calls[0][0] as { source: string; originUrl: string };
    expect(row).toMatchObject({ source: 'self_hosted', originUrl: 'https://cdn.example/s.png' });
  });
});

describe('enforceHostedQuota — park newest over-quota, keep oldest', () => {
  it('hides the newest (count - quota) and leaves the rest', async () => {
    // newest first; tier 3 → quota 2; 4 hosted → overflow 2 (the two newest)
    db.listHostedSkinsByAccount.mockResolvedValueOnce([
      { id: 'd', overflowHidden: false }, { id: 'c', overflowHidden: false },
      { id: 'b', overflowHidden: false }, { id: 'a', overflowHidden: false },
    ]);
    const overflow = await enforceHostedQuota(7, 3);
    expect(overflow).toBe(2);
    expect(db.setCreatorSkinOverflowHidden).toHaveBeenCalledWith('d', true);
    expect(db.setCreatorSkinOverflowHidden).toHaveBeenCalledWith('c', true);
    expect(db.setCreatorSkinOverflowHidden).toHaveBeenCalledTimes(2); // b,a already false -> no write
  });
  it('restores parked skins on a top-up (quota now covers all)', async () => {
    db.listHostedSkinsByAccount.mockResolvedValueOnce([
      { id: 'd', overflowHidden: true }, { id: 'c', overflowHidden: true },
      { id: 'b', overflowHidden: false }, { id: 'a', overflowHidden: false },
    ]);
    const overflow = await enforceHostedQuota(7, 5); // gilded → quota 12 ⊇ 4
    expect(overflow).toBe(0);
    expect(db.setCreatorSkinOverflowHidden).toHaveBeenCalledWith('d', false);
    expect(db.setCreatorSkinOverflowHidden).toHaveBeenCalledWith('c', false);
  });
});

describe('reviewListing / removeListing — moderation + trust accrual', () => {
  it('approve credits the creator + recomputes trust', async () => {
    db.getCreatorSkin.mockResolvedValueOnce({ id: 's1', source: 'hosted', creatorAccountId: 7 } as never);
    const r = await reviewListing('s1', 'approve');
    expect(r).toEqual({ ok: true, reviewStatus: 'approved' });
    expect(db.setCreatorSkinReview).toHaveBeenCalledWith('s1', 'approved');
    expect(db.bumpApprovedListings).toHaveBeenCalledWith(7);
    expect(db.setCreatorTrusted).toHaveBeenCalled(); // recompute persisted
  });
  it('reject hides from sale without crediting', async () => {
    db.getCreatorSkin.mockResolvedValueOnce({ id: 's1', source: 'hosted', creatorAccountId: 7 } as never);
    expect(await reviewListing('s1', 'reject')).toEqual({ ok: true, reviewStatus: 'rejected' });
    expect(db.bumpApprovedListings).not.toHaveBeenCalled();
  });
  it('approve on an unknown skin fails', async () => {
    db.getCreatorSkin.mockResolvedValueOnce(null as never);
    expect(await reviewListing('nope', 'approve')).toEqual({ ok: false, reason: 'not_found' });
  });
  it('remove records a strike and unpins a hosted skin', async () => {
    db.getCreatorSkin.mockResolvedValueOnce({ id: 's1', source: 'hosted', ipfsCid: 'QmX', creatorAccountId: 7 } as never);
    expect(await removeListing('s1')).toEqual({ ok: true });
    expect(db.setCreatorSkinStatus).toHaveBeenCalledWith('s1', 'removed');
    expect(db.recordCreatorStrike).toHaveBeenCalledWith(7);
    expect(pin.unpinFromIPFS).toHaveBeenCalledWith('QmX');
  });
});

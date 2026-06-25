import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db layer (no Postgres) + the on-chain ownership reader; the lost-on-sell
// sweep + force-unequip logic on the real GameServer is under test.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = vi.hoisted(() => ({
  pool: { query: vi.fn(async (): Promise<any> => ({ rows: [] })) },
  saveCharacterState: vi.fn(async (): Promise<void> => {}),
  openPlaySession: vi.fn(async (): Promise<number> => 1),
  closePlaySession: vi.fn(async (): Promise<void> => {}),
  insertChatLogs: vi.fn(async (): Promise<void> => {}),
  walletForAccount: vi.fn(async (): Promise<any> => null),
  markAccountQuestComplete: vi.fn(async (): Promise<any> => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async (): Promise<any> => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async (): Promise<any> => ({ completedQuestIds: [], mechChromaIds: [] })),
  loadMarketState: vi.fn(async (): Promise<any> => null),
  saveMarketState: vi.fn(async (): Promise<void> => {}),
  // NFT grant ledger + allow-list + EVM wallet:
  evmWalletForAccount: vi.fn(async (): Promise<any> => ({ address: '0x' + '1'.repeat(40) })),
  getNftCollection: vi.fn(async (): Promise<any> => ({ chain: 'ethereum', contract: '0xc', name: 'C', standard: 'erc721', profileId: 'bayc', licenseBasis: '', enabled: true })),
  grantNftSkin: vi.fn(async (): Promise<void> => {}),
  revokeNftSkin: vi.fn(async (): Promise<boolean> => true),
  touchNftGrant: vi.fn(async (): Promise<void> => {}),
  listNftGrantsForAccount: vi.fn(async (): Promise<any[]> => []),
}));
const own = vi.hoisted(() => ({ ownsNft: vi.fn(async (): Promise<boolean | null> => true) }));
vi.mock('../server/db', () => db);
vi.mock('../server/nft_ownership', () => own);

import { GameServer, type ClientSession } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

function fakeWs(): { sent: unknown[]; ws: { readyState: number; send: (p: string) => void } } {
  const sent: unknown[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

const SKIN = 'cs_nft_abc';
const GRANT = { skinId: SKIN, chain: 'ethereum', contract: '0xc', tokenId: '1', revoked: false };

function joinWithEquippedNftSkin(server: GameServer): { session: ClientSession; entity: any } {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, 7, 7, 'Ape', 'warrior' as PlayerClass, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  // Grant + equip the NFT skin (as a successful claim + change_skin would).
  server.applyCreatorSkinGrant(7, SKIN);
  const sim = (server as unknown as { sim: { entities: Map<number, any>; setPlayerSkin: (pid: number, skin: number, cat: string, csk: string | null) => void } }).sim;
  const entity = sim.entities.get(session.pid);
  sim.setPlayerSkin(session.pid, entity.skin, 'class', SKIN);
  return { session, entity };
}

beforeEach(() => {
  for (const m of Object.values(db)) (m as { mockReset?: () => void }).mockReset?.();
  own.ownsNft.mockReset();
  db.pool.query.mockResolvedValue({ rows: [] });
  db.openPlaySession.mockResolvedValue(1);
  db.evmWalletForAccount.mockResolvedValue({ address: '0x' + '1'.repeat(40) });
  db.getNftCollection.mockResolvedValue({ chain: 'ethereum', contract: '0xc', name: 'C', standard: 'erc721', profileId: 'bayc', licenseBasis: '', enabled: true });
  db.revokeNftSkin.mockResolvedValue(true);
  db.listNftGrantsForAccount.mockResolvedValue([]);
  own.ownsNft.mockResolvedValue(true);
});

describe('lost-on-sell sweep', () => {
  it('revokes and force-unequips a skin whose NFT the wallet no longer holds', async () => {
    const server = new GameServer();
    const { session, entity } = joinWithEquippedNftSkin(server);
    expect(entity.cosmeticSkinId).toBe(SKIN);
    expect(session.accountCosmetics.ownedCreatorSkinIds).toContain(SKIN);

    db.listNftGrantsForAccount.mockResolvedValue([GRANT]);
    own.ownsNft.mockResolvedValue(false); // sold
    await server.refreshNftGrantsForAccount(7);

    expect(db.revokeNftSkin).toHaveBeenCalledWith(7, SKIN);
    expect(session.accountCosmetics.ownedCreatorSkinIds).not.toContain(SKIN);
    expect(entity.cosmeticSkinId).toBeNull(); // actively unequipped
  });

  it('keeps the skin on an UNKNOWN ownership read (fail-closed, no revoke)', async () => {
    const server = new GameServer();
    const { session, entity } = joinWithEquippedNftSkin(server);
    db.listNftGrantsForAccount.mockResolvedValue([GRANT]);
    own.ownsNft.mockResolvedValue(null); // RPC outage
    await server.refreshNftGrantsForAccount(7);

    expect(db.revokeNftSkin).not.toHaveBeenCalled();
    expect(db.touchNftGrant).toHaveBeenCalledWith(7, SKIN);
    expect(entity.cosmeticSkinId).toBe(SKIN); // still worn
  });

  it('restores a previously-revoked grant when the NFT is re-acquired', async () => {
    const server = new GameServer();
    joinWithEquippedNftSkin(server);
    db.listNftGrantsForAccount.mockResolvedValue([{ ...GRANT, revoked: true }]);
    own.ownsNft.mockResolvedValue(true); // re-acquired
    await server.refreshNftGrantsForAccount(7);

    expect(db.grantNftSkin).toHaveBeenCalledWith(7, SKIN);
    expect(db.revokeNftSkin).not.toHaveBeenCalled();
  });

  it('revokes when the wallet is unlinked or the collection is delisted', async () => {
    const server = new GameServer();
    const { entity } = joinWithEquippedNftSkin(server);
    db.listNftGrantsForAccount.mockResolvedValue([GRANT]);
    db.evmWalletForAccount.mockResolvedValue(null); // wallet unlinked
    await server.refreshNftGrantsForAccount(7);
    expect(db.revokeNftSkin).toHaveBeenCalledWith(7, SKIN);
    expect(entity.cosmeticSkinId).toBeNull();
  });

  it('resweepNftGrants revokes a disabled collection immediately, no ownership read', async () => {
    const server = new GameServer();
    const { entity } = joinWithEquippedNftSkin(server);
    db.listNftGrantsForAccount.mockResolvedValue([GRANT]);
    db.getNftCollection.mockResolvedValue({ chain: 'ethereum', contract: '0xc', name: 'C', standard: 'erc721', profileId: 'bayc', licenseBasis: '', enabled: false }); // operator disabled it
    await server.resweepNftGrants();
    expect(db.revokeNftSkin).toHaveBeenCalledWith(7, SKIN);
    expect(own.ownsNft).not.toHaveBeenCalled(); // disabled -> revoke without an RPC read
    expect(entity.cosmeticSkinId).toBeNull();
  });
});

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_claudium_routes';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  moderationStatusForAccount: vi.fn(),
}));

vi.mock('../../server/claudium_proxy', async (importActual) => {
  const actual = await importActual<typeof import('../../server/claudium_proxy')>();
  return {
    ...actual,
    claudiumSpend: vi.fn(),
    claudiumStore: vi.fn(),
  };
});

import { configureClaudiumRuntime, handleClaudiumApi, routes } from '../../server/claudium';
import { claudiumSpend, claudiumStore } from '../../server/claudium_proxy';
import { FakeRes, makeReq } from './helpers';

const spendMock = vi.mocked(claudiumSpend);
const storeMock = vi.mocked(claudiumStore);
const grantWeaponSkins = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  configureClaudiumRuntime({ grantWeaponSkins });
});

describe('Claudium spend entitlement mirroring', () => {
  it('mounts a fused limiter after authentication on every monetary mutation route', () => {
    const paths = [
      '/api/claudium/purchase',
      '/api/claudium/purchase/woc/confirm',
      '/api/claudium/native/quote',
      '/api/claudium/native/confirm',
      '/api/claudium/spend',
    ];
    for (const path of paths) {
      const route = routes.find((entry) => entry.method === 'POST' && entry.path === path);
      expect(route?.middleware).toHaveLength(2);
    }
  });

  it('does not mirror a caller item until the authoritative store owns that exact skin', async () => {
    spendMock.mockResolvedValue({
      // The in-memory companion backend historically reported a reused key as
      // granted:true, while Postgres reported granted:false. The game must be safe
      // against either representation.
      granted: true,
      balance: 0,
      costClaudium: 200,
      reason: 'already_granted',
    });
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: true,
        },
        {
          itemId: 'solheim_sword',
          name: 'Solheim, Last Light of the Dawn',
          kind: 'skin',
          costClaudium: 5000,
          owned: false,
        },
      ],
    });

    const req = makeReq({
      method: 'POST',
      url: '/api/claudium/spend',
      body: { itemId: 'solheim_sword', kind: 'skin', idempotencyKey: 'reused-key' },
    });
    const res = new FakeRes();

    await handleClaudiumApi(req, res as never, 7);

    expect(storeMock).toHaveBeenCalledWith('7');
    expect(grantWeaponSkins).not.toHaveBeenCalled();
  });

  it('mirrors a skin only after the authoritative store confirms that item is owned', async () => {
    spendMock.mockResolvedValue({
      granted: true,
      balance: 300,
      costClaudium: 200,
      reason: null,
    });
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: true,
        },
      ],
    });

    const req = makeReq({
      method: 'POST',
      url: '/api/claudium/spend',
      body: {
        itemId: 'guildmark_arming_sword',
        kind: 'skin',
        idempotencyKey: 'fresh-key',
      },
    });
    const res = new FakeRes();

    await handleClaudiumApi(req, res as never, 7);

    expect(storeMock).toHaveBeenCalledWith('7');
    expect(grantWeaponSkins).toHaveBeenCalledWith(7, ['guildmark_arming_sword']);
  });
});

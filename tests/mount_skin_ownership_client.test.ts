// The online client's worn-mount-skin ownership gate (src/net/mount_skin_ownership.ts).
//
// Mount ownership is account-wide: a collectible look is owned while its reins sit in
// ANY character's bags or personal bank, mirrored to the client as
// AccountCosmetics.collectibleMountSkinIds. The Cosmetics window lists those looks as
// owned and the server's wornMountSkinAllowed accepts them, but ClientWorld's
// changeMountSkin used to check only the store list (mountSkinIds) and silently
// dropped the request. A character could therefore never wear a mount whose reins
// another character holds (for example the Emberbristle Broom kept on an alt).

import { describe, expect, it } from 'vitest';
import { accountOwnsMountSkin } from '../src/net/mount_skin_ownership';
import type { ClientWorld } from '../src/net/online';
import type { AccountCosmetics } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

function cosmetics(over: Partial<AccountCosmetics>): AccountCosmetics {
  return {
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
    ...over,
  };
}

function clientWith(c: AccountCosmetics): { client: ClientWorld; sent: unknown[] } {
  const sent: unknown[] = [];
  Object.assign(globalThis, { WebSocket: { OPEN: 1 } });
  const client = bareClient(7, {
    accountCosmetics: c,
    ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    entities: new Map([[7, { id: 7, mountSkinId: null }]]),
  });
  return { client, sent };
}

describe('accountOwnsMountSkin', () => {
  it('accepts a store skin and a collectible look, and nothing else', () => {
    const c = cosmetics({
      mountSkinIds: ['mech_bird'],
      collectibleMountSkinIds: ['emberbristle_broom'],
    });
    expect(accountOwnsMountSkin(c, 'mech_bird')).toBe(true);
    expect(accountOwnsMountSkin(c, 'emberbristle_broom')).toBe(true);
    expect(accountOwnsMountSkin(c, 'valorsteed')).toBe(false);
  });

  it('reads a missing collectible projection as owning no collectibles', () => {
    const c = cosmetics({ mountSkinIds: ['mech_bird'] });
    expect(accountOwnsMountSkin(c, 'emberbristle_broom')).toBe(false);
    expect(accountOwnsMountSkin(c, 'mech_bird')).toBe(true);
  });
});

describe('ClientWorld.changeMountSkin', () => {
  it('wears a collectible look whose reins another character holds', () => {
    const { client, sent } = clientWith(
      cosmetics({ collectibleMountSkinIds: ['emberbristle_broom'] }),
    );
    client.changeMountSkin('emberbristle_broom');
    expect(sent).toEqual([{ t: 'cmd', cmd: 'change_mount_skin', skin: 'emberbristle_broom' }]);
    expect(client.entities.get(7)?.mountSkinId).toBe('emberbristle_broom');
  });

  it('still wears a store skin and takes the skin off with null', () => {
    const { client, sent } = clientWith(cosmetics({ mountSkinIds: ['mech_bird'] }));
    client.changeMountSkin('mech_bird');
    client.changeMountSkin(null);
    expect(sent).toEqual([
      { t: 'cmd', cmd: 'change_mount_skin', skin: 'mech_bird' },
      { t: 'cmd', cmd: 'change_mount_skin', skin: null },
    ]);
    expect(client.entities.get(7)?.mountSkinId).toBeNull();
  });

  it('sends nothing for a look the account does not own', () => {
    const { client, sent } = clientWith(
      cosmetics({ collectibleMountSkinIds: ['emberbristle_broom'] }),
    );
    client.changeMountSkin('valorsteed');
    expect(sent).toEqual([]);
    expect(client.entities.get(7)?.mountSkinId).toBeNull();
  });
});

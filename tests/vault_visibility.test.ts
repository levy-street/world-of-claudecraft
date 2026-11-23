import { describe, expect, it } from 'vitest';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { createGroundObject, createPlayer } from '../src/sim/entity';
import { vaultPortalVisible } from '../src/sim/vault_visibility';

describe('vault portal visibility', () => {
  it('does not offer an invisible entrance as a nearby interaction', () => {
    const player = createPlayer(3, 'warrior', { x: 0, y: 0, z: 0 }, 'Viewer');
    const portal = createGroundObject(10, '', 'Hoard', { x: 1, y: 0, z: 0 });
    portal.templateId = 'hoard_entrance';
    portal.vaultOwnerPid = 2;
    portal.lootable = true;
    const world = {
      player,
      playerId: 3,
      partyInfo: { members: [{ pid: 3 }] },
      entities: new Map([[10, portal]]),
      questLog: new Map(),
      farmPatches: [],
    };
    expect(resolveNearbyInteractionCandidate(world)).toBeNull();
    world.partyInfo.members.push({ pid: 2 });
    expect(resolveNearbyInteractionCandidate(world)).toMatchObject({ id: 10, kind: 'object' });
  });

  it('uses stable owner identity after reconnect and rejects a reused entity id', () => {
    const portal = { vaultOwnerPid: 1, vaultOwnerCharacterId: 100 };
    const characters = new Map([
      [1, 200],
      [2, 100],
      [3, 300],
    ]);
    const identity = (pid: number) => characters.get(pid);
    expect(vaultPortalVisible(portal, 1, null, identity)).toBe(false);
    expect(vaultPortalVisible(portal, 2, null, identity)).toBe(true);
    expect(vaultPortalVisible(portal, 3, [2, 3], identity)).toBe(true);
    expect(vaultPortalVisible(portal, 3, null, identity)).toBe(false);
    expect(vaultPortalVisible({}, 3, null, identity)).toBe(true);
  });

  it('applies current-party visibility to offline render admission too', () => {
    const world = {
      playerId: 3,
      partyInfo: { members: [{ pid: 3 }] },
      worldQuestCycle: '',
      worldQuestLog: new Map(),
    };
    const hidden = makeQuestObjectGate({}, world);
    const portal = createGroundObject(10, '', 'Hoard', { x: 0, y: 0, z: 0 });
    portal.vaultOwnerPid = 2;
    expect(hidden(portal, new Map())).toBe(true);
    world.partyInfo.members.push({ pid: 2 });
    expect(hidden(portal, new Map())).toBe(false);
    world.partyInfo.members = [{ pid: 3 }];
    expect(hidden(portal, new Map())).toBe(true);
    world.playerId = 2;
    expect(hidden(portal, new Map())).toBe(false);
  });
});

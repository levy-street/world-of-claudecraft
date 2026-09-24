import { describe, expect, it } from 'vitest';
import { addVaultRewardToCharacterState } from '../../server/vault_reward_state';
import type { CharacterState } from '../../src/sim/character_state';
import { HEROIC_MARK_ITEM_ID } from '../../src/sim/content/dungeon_difficulty';
import { HOARD_BASE_ITEM_IDS, hoardLootVariantId } from '../../src/sim/content/hoard_loot';
import { TREASURE_MAP_ITEM_IDS } from '../../src/sim/content/treasure_maps';
import { grantHoardReward } from '../../src/sim/rift/hoard_reward_grant';
import { Sim } from '../../src/sim/sim';

describe('direct vault reward character snapshot', () => {
  function saved(): CharacterState {
    return {
      level: 20,
      xp: 0,
      copper: 10,
      hp: 100,
      resource: 0,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {} as CharacterState['equipment'],
      inventory: [{ itemId: 'thorium_ore', count: 2 }],
      questLog: [],
      questsDone: [],
      worldQuests: {
        cycle: '2026-09-23',
        progress: [],
        vaultAttempt: { id: '7:1', rarity: 'rare', siteId: 'x', seed: 1 },
      },
    };
  }

  it('adds the immutable parcel and clears only the matching owner marker', () => {
    const state = saved();
    addVaultRewardToCharacterState(
      state,
      {
        characterId: 7,
        recipientName: 'Owner',
        items: [{ itemId: 'thorium_ore', count: 3 }],
        copper: 42,
        mailDueAt: '2026-09-23T00:00:00.000Z',
      },
      '7:1',
      true,
    );
    expect(state.inventory).toContainEqual(
      expect.objectContaining({ itemId: 'thorium_ore', count: 5 }),
    );
    expect(state.copper).toBe(52);
    expect(state.worldQuests?.vaultAttempt).toBeUndefined();
    expect(state.worldQuests?.clueCasketsOpened).toBe(1);
  });

  it('does not count a capped guest as paid', () => {
    const state = saved();
    addVaultRewardToCharacterState(
      state,
      {
        characterId: 8,
        recipientName: 'Guest',
        items: [],
        copper: 0,
        mailDueAt: '2026-09-23T00:00:00.000Z',
      },
      '7:1',
      false,
    );
    expect(state.copper).toBe(10);
    expect(state.worldQuests?.vaultGuestPayouts).toBeUndefined();
    expect(state.worldQuests?.vaultAttempt?.id).toBe('7:1');
  });

  it('does not charge a past-cycle guest claim to the new cycle', () => {
    const state = saved();
    addVaultRewardToCharacterState(
      state,
      {
        characterId: 8,
        recipientName: 'Guest',
        items: [{ itemId: 'thorium_ore', count: 1 }],
        copper: 10,
        mailDueAt: '2026-09-23T00:00:00.000Z',
        guestCycle: '2026-09-22',
      },
      '7:1',
      false,
    );
    expect(state.copper).toBe(20);
    expect(state.worldQuests?.clueCasketsOpened).toBe(1);
    expect(state.worldQuests?.vaultGuestPayouts).toBeUndefined();
  });

  it('does not charge a direct claim twice after its clear reserved the guest allowance', () => {
    const state = saved();
    if (!state.worldQuests) throw new Error('missing world quest state');
    state.worldQuests.vaultGuestCycle = state.worldQuests.cycle;
    state.worldQuests.vaultGuestPayouts = 2;
    addVaultRewardToCharacterState(
      state,
      {
        characterId: 8,
        recipientName: 'Guest',
        items: [{ itemId: 'thorium_ore', count: 1 }],
        copper: 10,
        mailDueAt: '2026-09-23T00:00:00.000Z',
        guestCycle: state.worldQuests.cycle,
      },
      '7:1',
      false,
    );
    expect(state.worldQuests.vaultGuestPayouts).toBe(2);
  });

  it('commits discovery and Reliquary first-find metadata with the direct parcel', () => {
    const state = saved();
    const baseId = HOARD_BASE_ITEM_IDS[0];
    const tierId = hoardLootVariantId(baseId, 'rare');
    addVaultRewardToCharacterState(
      state,
      {
        characterId: 7,
        recipientName: 'Owner',
        items: [{ itemId: tierId, count: 1 }],
        copper: 42,
        mailDueAt: '2026-09-23T00:00:00.000Z',
      },
      '7:1',
      true,
    );
    expect(state.deedStats?.itemsDiscovered).toEqual(expect.arrayContaining([tierId, baseId]));
    expect(state.deedStats?.visited).toContain('quality:rare');
    expect(state.reliquary?.firstFind?.[baseId]).toEqual({ count: 1 });
    expect(state.reliquary?.recent).toContain(baseId);
  });

  it.each([
    ['material', 'thorium_ore'],
    ['plain hoard piece', HOARD_BASE_ITEM_IDS[0]],
    ['tarnished hoard piece', hoardLootVariantId(HOARD_BASE_ITEM_IDS[0], 'rare')],
    ['sovereign hoard piece', hoardLootVariantId(HOARD_BASE_ITEM_IDS[0], 'legendary')],
    ['heroic mark', HEROIC_MARK_ITEM_ID],
    ['mount reins', 'reins_lanternback_troll'],
    ['next map', TREASURE_MAP_ITEM_IDS.epic],
  ])('matches the live collection ledger for %s', (_label, itemId) => {
    const sim = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'VaultTester', {
      characterId: 7,
      tutorialGreetingSent: true,
      bot: true,
    });
    const before = sim.serializeCharacter(pid);
    if (!before) throw new Error('missing player snapshot');
    const projected = structuredClone(before);
    const claim = {
      characterId: 7,
      recipientName: 'VaultTester',
      items: [{ itemId, count: 1 }],
      copper: 1,
      mailDueAt: '2026-09-23T00:00:00.000Z',
    };
    addVaultRewardToCharacterState(projected, claim, '7:1', true);
    expect(
      grantHoardReward(
        sim.ctx,
        pid,
        'rare',
        { items: claim.items, copper: 1, capped: false },
        true,
      ),
    ).toBe(true);
    const live = sim.serializeCharacter(pid);
    expect(projected.deedStats).toEqual(live?.deedStats);
    expect(projected.reliquary).toEqual(live?.reliquary);
  });
});

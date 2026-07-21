import { describe, expect, it } from 'vitest';
import { SKINS } from '../src/render/characters/manifest';
import {
  EVENT_SKIN_TIERS,
  EVENT_SKIN_TOKEN_ID,
  MECH_CHROMAS,
  mechChromaItemId,
  rankAllowsSkin,
  rollSkinRank,
  SKIN_COUNTS,
  SKIN_RANK_ROLL_WEIGHTS,
  SKIN_RANKS,
} from '../src/sim/content/skins';
import { Sim } from '../src/sim/sim';
import type { PlayerClass, SimEvent, SkinRank } from '../src/sim/types';

type SkinEvent = Extract<SimEvent, { type: 'skinEvent' }>;

// Events emitted outside tick() (useItem) are returned by the next tick() drain.
function drainSkinEvent(sim: Sim): SkinEvent | undefined {
  return sim.tick().find((e): e is SkinEvent => e.type === 'skinEvent');
}

function rollRank(seed: number, cls: PlayerClass = 'mage'): { sim: Sim; rank: SkinRank } {
  const sim = new Sim({ seed, playerClass: cls, playerName: 'Roller' });
  sim.addItem(EVENT_SKIN_TOKEN_ID, 1);
  sim.useItem(EVENT_SKIN_TOKEN_ID);
  const ev = drainSkinEvent(sim);
  if (!ev) throw new Error('expected a skinEvent');
  return { sim, rank: ev.rank };
}

describe('cosmetic skin-select event', () => {
  it('rolls a rank on use and emits a personal skinEvent (token not yet consumed)', () => {
    const { sim, rank } = rollRank(7);
    expect(SKIN_RANKS).toContain(rank);
    const tokens = sim.inventory.find((s) => s.itemId === EVENT_SKIN_TOKEN_ID)?.count;
    expect(tokens).toBe(1); // consumed on lock-in, not on open
  });

  it('emits the skinEvent as a personal (pid-scoped) cue', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', playerName: 'Roller' });
    sim.addItem(EVENT_SKIN_TOKEN_ID, 1);
    sim.useItem(EVENT_SKIN_TOKEN_ID);
    const ev = drainSkinEvent(sim);
    expect(ev?.pid).toBe(sim.playerId);
  });

  it('does not reroll when the token is used again', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', playerName: 'Roller' });
    sim.addItem(EVENT_SKIN_TOKEN_ID, 1);
    sim.useItem(EVENT_SKIN_TOKEN_ID);
    const first = drainSkinEvent(sim)!.rank;
    sim.useItem(EVENT_SKIN_TOKEN_ID); // re-open
    const second = drainSkinEvent(sim)!.rank;
    expect(second).toBe(first);
  });

  it('is deterministic: the same seed rolls the same rank', () => {
    expect(rollRank(123).rank).toBe(rollRank(123).rank);
  });

  it('uses 70/25/5 rarity roll weights', () => {
    expect(SKIN_RANK_ROLL_WEIGHTS).toEqual({ uncommon: 70, rare: 25, epic: 5 });
    expect(rollSkinRank(0)).toBe('uncommon');
    expect(rollSkinRank(0.69999)).toBe('uncommon');
    expect(rollSkinRank(0.7)).toBe('rare');
    expect(rollSkinRank(0.94999)).toBe('rare');
    expect(rollSkinRank(0.95)).toBe('epic');
    expect(rollSkinRank(0.99999)).toBe('epic');
  });

  it('locks in an in-rank skin: applies it, consumes the token, clears the pending rank', () => {
    const { sim, rank } = rollRank(1);
    const skin = EVENT_SKIN_TIERS[0].skin; // lowest tier — allowed by every rank
    expect(rankAllowsSkin(rank, skin)).toBe(true);

    sim.claimEventSkin(skin);

    expect(sim.player.skin).toBe(skin);
    expect(sim.inventory.find((s) => s.itemId === EVENT_SKIN_TOKEN_ID)).toBeUndefined();
    expect(sim.serializeCharacter(sim.playerId)?.pendingSkinRank ?? null).toBeNull();
  });

  it('uses the Aldric reward item as a mech cosmetic spinner token', () => {
    const sim = new Sim({ seed: 1, playerClass: 'mage', playerName: 'Mech' });
    sim.addItem('alien_armor_plate', 1);

    sim.useItem('alien_armor_plate');

    const roll = drainSkinEvent(sim);
    expect(roll?.catalog).toBe('mech');
    expect(sim.accountCosmetics.mechChromaIds).toEqual([]);
    expect(sim.player.skinCatalog).toBe('class');
    expect(sim.countItem('alien_armor_plate')).toBe(1);

    const claim = sim.claimEventSkin(0);

    expect(claim).toEqual({ catalog: 'mech', skin: 0, chromaId: 'amber_crimson' });
    expect(sim.accountCosmetics.mechChromaIds).toEqual(['amber_crimson']);
    expect(sim.player.skin).toBe(0);
    expect(sim.player.skinCatalog).toBe('mech');
    expect(sim.countItem('alien_armor_plate')).toBe(0);
  });

  it('uses a returned specific mech cosmetic item as an account-wide unlock', () => {
    const sim = new Sim({ seed: 1, playerClass: 'mage', playerName: 'Mech' });
    sim.addItem('amber_crimson_armor_plate', 1);

    sim.useItem('amber_crimson_armor_plate');

    expect(drainSkinEvent(sim)).toBeUndefined();
    expect(sim.accountCosmetics.mechChromaIds).toEqual(['amber_crimson']);
    expect(sim.player.skin).toBe(0);
    expect(sim.player.skinCatalog).toBe('mech');
    expect(sim.countItem('amber_crimson_armor_plate')).toBe(0);
  });

  it('unequips a mech cosmetic account-wide and returns the specific item', () => {
    const sim = new Sim({ seed: 1, playerClass: 'shaman', playerName: 'Mechwearer' });
    sim.addItem('amber_crimson_armor_plate', 1);
    sim.useItem('amber_crimson_armor_plate');

    expect((sim as any).unequipMechChroma('amber_crimson')).toBe(true);

    expect(sim.accountCosmetics.mechChromaIds).toEqual([]);
    expect(sim.player.skin).toBe(0);
    expect(sim.player.skinCatalog).toBe('class');
    expect(sim.countItem('amber_crimson_armor_plate')).toBe(1);

    sim.useItem('amber_crimson_armor_plate');

    expect(sim.accountCosmetics.mechChromaIds).toEqual(['amber_crimson']);
    expect(sim.player.skin).toBe(0);
    expect(sim.player.skinCatalog).toBe('mech');
    expect(sim.countItem('amber_crimson_armor_plate')).toBe(0);
  });

  it('returns a non-vendorable, non-discardable, non-marketable mech cosmetic item when unequipped', () => {
    const sim = new Sim({ seed: 1, playerClass: 'shaman', playerName: 'Seller' });
    const merchant = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'the_merchant',
    );
    if (!merchant) throw new Error('merchant not found');
    const pos = sim.groundPos(merchant.pos.x, merchant.pos.z);
    sim.player.pos = { ...pos };
    sim.player.prevPos = { ...pos };

    sim.addItem('amber_crimson_armor_plate', 1);
    sim.useItem('amber_crimson_armor_plate');
    expect((sim as any).unequipMechChroma('amber_crimson')).toBe(true);

    sim.sellItem('amber_crimson_armor_plate');
    sim.discardItem('amber_crimson_armor_plate');
    expect(sim.countItem('amber_crimson_armor_plate')).toBe(1);

    sim.marketList('amber_crimson_armor_plate', 1, 100);

    expect(sim.countItem('amber_crimson_armor_plate')).toBe(1);
    expect(
      sim.marketListings.some((listing) => listing.itemId === 'amber_crimson_armor_plate'),
    ).toBe(false);
  });

  it('returns and reuses a specific item for every mech chroma', () => {
    for (const chroma of MECH_CHROMAS) {
      const itemId = mechChromaItemId(chroma.id);
      expect(itemId, chroma.id).toBeTruthy();

      const sim = new Sim({ seed: 1, playerClass: 'shaman', playerName: `Mech-${chroma.id}` });
      sim.accountCosmetics = {
        completedQuestIds: [],
        mechChromaIds: [chroma.id],
        weaponSkinIds: [],
        weaponSkinLoadout: {},
      };
      expect((sim as any).unequipMechChroma(chroma.id)).toBe(true);
      expect(sim.accountCosmetics.mechChromaIds).not.toContain(chroma.id);
      expect(sim.countItem(itemId!)).toBe(1);

      sim.useItem(itemId!);

      expect(sim.accountCosmetics.mechChromaIds).toContain(chroma.id);
      expect(sim.countItem(itemId!)).toBe(0);
    }
  });

  it('can equip a mech cosmetic as the active live appearance catalog', () => {
    const sim = new Sim({ seed: 1, playerClass: 'shaman', playerName: 'Mechwearer' });

    expect(sim.setPlayerSkin(sim.playerId, 0, 'mech')).toBe(true);

    expect(sim.player.skin).toBe(0);
    expect(sim.player.skinCatalog).toBe('mech');
    expect(sim.serializeCharacter(sim.playerId)?.skinCatalog).toBe('mech');
  });

  it('rejects a skin above the rolled rank (server authority): no change, token kept', () => {
    // Find a seed that rolls the lowest rank so an epic pick is out of bounds.
    let sim: Sim | null = null;
    for (let seed = 1; seed < 500 && sim === null; seed++) {
      const r = rollRank(seed);
      if (r.rank === 'uncommon') sim = r.sim;
    }
    expect(sim).not.toBeNull();
    const epicSkin = EVENT_SKIN_TIERS.find((tier) => tier.rank === 'epic')!.skin;
    expect(rankAllowsSkin('uncommon', epicSkin)).toBe(false);

    sim!.claimEventSkin(epicSkin);

    expect(sim!.player.skin).toBe(0); // unchanged class default
    expect(sim!.inventory.find((s) => s.itemId === EVENT_SKIN_TOKEN_ID)?.count).toBe(1);
    expect(sim!.serializeCharacter(sim!.playerId)?.pendingSkinRank).toBe('uncommon');
  });

  it('claimEventSkin is a no-op when there is no active event', () => {
    const sim = new Sim({ seed: 2, playerClass: 'mage', playerName: 'Idle' });
    sim.claimEventSkin(EVENT_SKIN_TIERS[0].skin);
    expect(sim.player.skin).toBe(0);
  });

  it('rejects a skin that does not exist for the class, even if the rank allows it', () => {
    // Paladin only has skins 0 and 1; the epic tier maps to skin 3, which it lacks.
    let sim: Sim | null = null;
    for (let seed = 1; seed < 500 && sim === null; seed++) {
      const r = rollRank(seed, 'paladin');
      if (r.rank === 'epic') sim = r.sim;
    }
    expect(sim).not.toBeNull();
    const epicSkin = EVENT_SKIN_TIERS.find((tier) => tier.rank === 'epic')!.skin;
    expect(rankAllowsSkin('epic', epicSkin)).toBe(true); // rank gate alone would allow it
    expect(epicSkin).toBeGreaterThanOrEqual(SKIN_COUNTS.paladin); // but it doesn't exist

    sim!.claimEventSkin(epicSkin);

    expect(sim!.player.skin).toBe(0); // not applied
    expect(sim!.inventory.find((s) => s.itemId === EVENT_SKIN_TOKEN_ID)?.count).toBe(1); // token kept
  });

  it('SKIN_COUNTS stays in lockstep with the renderer SKINS manifest', () => {
    for (const cls of Object.keys(SKIN_COUNTS) as PlayerClass[]) {
      expect(SKINS[`player_${cls}`]?.length, cls).toBe(SKIN_COUNTS[cls]);
    }
  });

  it('persists the pending rank across serialize/deserialize', () => {
    const { sim, rank } = rollRank(4);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.pendingSkinRank).toBe(rank);

    const sim2 = new Sim({ seed: 99, playerClass: 'warrior', playerName: 'Other' });
    const pid = sim2.addPlayer('mage', 'Saver', { state });
    expect(sim2.serializeCharacter(pid)?.pendingSkinRank).toBe(rank);
  });
});

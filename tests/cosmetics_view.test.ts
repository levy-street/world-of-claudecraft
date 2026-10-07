import { describe, expect, it } from 'vitest';
import { ALL_MOUNT_SKIN_IDS } from '../src/sim/content/mount_skins';
import { MECH_CHROMAS } from '../src/sim/content/skins';
import {
  COSMETICS_TABS,
  type CosmeticsSnapshot,
  cosmeticsSig,
  cosmeticsTabStrip,
  isCosmeticsTab,
  mechChromaCards,
  mountSkinCards,
  weaponSkinGroups,
} from '../src/ui/hud/cosmetics/cosmetics_view';

const snap = (over: Partial<CosmeticsSnapshot> = {}): CosmeticsSnapshot => ({
  tab: 'mounts',
  ownedMountSkins: [],
  wornMountSkin: null,
  ownsAnyMount: true,
  weaponSkinIds: [],
  weaponSkinLoadout: {},
  applicableWeaponTypes: [],
  mechChromaIds: [],
  wornMech: { catalog: 'class', skin: 0 },
  ...over,
});

describe('cosmetics tabs', () => {
  it('is the closed three-tab set with a WAI-ARIA strip', () => {
    expect(COSMETICS_TABS).toEqual(['mounts', 'skins', 'mech']);
    expect(isCosmeticsTab('mech')).toBe(true);
    expect(isCosmeticsTab('buddies')).toBe(false);
    const strip = cosmeticsTabStrip('skins', { mounts: 'M', skins: 'S', mech: 'X' }, 'Sections');
    expect(strip.tabs.map((t) => [t.id, t.label, t.selected])).toEqual([
      ['mounts', 'M', false],
      ['skins', 'S', true],
      ['mech', 'X', false],
    ]);
    expect(strip.panelId).toBe('cosmetics-panel');
    expect(strip.tabClass).toBe('cos-tab');
  });
});

describe('mount skin cards', () => {
  it('hides mounts without acquisition sources until owned, including their wear controls', () => {
    const ids = ['terrorspark_groundshaker', 'drakemaw_raptor'];
    expect(mountSkinCards(snap()).filter((card) => ids.includes(card.id))).toEqual([]);
    const cards = mountSkinCards(snap({ ownedMountSkins: ids, wornMountSkin: ids[0] }));
    expect(cards.find((card) => card.id === ids[0])?.action).toBe('takeOff');
    expect(cards.find((card) => card.id === ids[1])?.action).toBe('wear');
  });
  it('lists every catalog skin in store order, unowned ones as store-only', () => {
    const cards = mountSkinCards(snap());
    expect(cards.map((c) => c.id)).toEqual(
      ALL_MOUNT_SKIN_IDS.filter(
        (id) => !['terrorspark_groundshaker', 'drakemaw_raptor'].includes(id),
      ),
    );
    for (const card of cards) {
      expect(card.owned).toBe(false);
      expect(card.worn).toBe(false);
      expect(card.action).toBeNull();
      expect(card.ownershipScope).toBe('account');
      expect(card.wornScope).toBe('character');
    }
  });

  it('offers Wear on an owned skin and Take off on the worn one', () => {
    const cards = mountSkinCards(
      snap({ ownedMountSkins: ['mech_bird', 'chimeglass_tortoise'], wornMountSkin: 'mech_bird' }),
    );
    const bird = cards.find((c) => c.id === 'mech_bird');
    const tortoise = cards.find((c) => c.id === 'chimeglass_tortoise');
    expect(bird).toMatchObject({ owned: true, worn: true, action: 'takeOff', rarity: 'epic' });
    expect(tortoise).toMatchObject({ owned: true, worn: false, action: 'wear', rarity: 'epic' });
  });

  it('offers collectible skins from account item ownership and revokes the worn state when ownership disappears', () => {
    const owned = mountSkinCards(
      snap({ ownedMountSkins: ['grag_bear'], wornMountSkin: 'grag_bear' }),
    );
    expect(owned.find((c) => c.id === 'grag_bear')).toMatchObject({
      owned: true,
      worn: true,
      action: 'takeOff',
    });
    const revoked = mountSkinCards(snap({ ownedMountSkins: [], wornMountSkin: 'grag_bear' }));
    expect(revoked.find((c) => c.id === 'grag_bear')).toMatchObject({
      owned: false,
      worn: false,
      action: null,
    });
  });

  it('never reports a worn skin the account does not own', () => {
    const cards = mountSkinCards(snap({ ownedMountSkins: [], wornMountSkin: 'mech_bird' }));
    expect(cards.find((c) => c.id === 'mech_bird')).toMatchObject({ worn: false, action: null });
  });
});

describe('weapon skin groups', () => {
  it('groups only owned skins by weapon type, rarity ascending, with apply gated on the equipped type', () => {
    const groups = weaponSkinGroups(
      snap({
        weaponSkinIds: [
          'ice_fang_sword',
          'guildmark_arming_sword',
          'glaciersplit_axe',
          'not_a_skin',
        ],
        weaponSkinLoadout: { sword: 'ice_fang_sword' },
        applicableWeaponTypes: ['sword'],
      }),
    );
    expect(groups.map((g) => g.weaponType)).toEqual(['sword', 'axe']);
    const [sword, axe] = groups;
    expect(sword.rows.map((r) => r.id)).toEqual(['guildmark_arming_sword', 'ice_fang_sword']);
    expect(sword.rows[1]).toMatchObject({ applied: true, action: 'detach', canApply: true });
    expect(sword.rows[0]).toMatchObject({ applied: false, action: 'apply', canApply: true });
    expect(axe.rows[0]).toMatchObject({
      id: 'glaciersplit_axe',
      applied: false,
      action: 'apply',
      canApply: false,
      ownershipScope: 'account',
      appliedScope: 'account',
    });
  });

  it('is empty with nothing owned, even if the loadout names a skin', () => {
    expect(weaponSkinGroups(snap({ weaponSkinLoadout: { sword: 'ice_fang_sword' } }))).toEqual([]);
  });
});

describe('mech chroma cards', () => {
  it('lists owned chromas in catalog order with the worn one marked', () => {
    const worn = MECH_CHROMAS[3].id;
    const other = MECH_CHROMAS[0].id;
    const cards = mechChromaCards(
      snap({ mechChromaIds: [worn, other], wornMech: { catalog: 'mech', skin: 3 } }),
    );
    expect(cards.map((c) => c.id)).toEqual([other, worn]);
    expect(cards[0]).toMatchObject({ index: 0, worn: false, action: 'wear' });
    expect(cards[1]).toMatchObject({
      index: 3,
      worn: true,
      action: 'takeOff',
      rank: MECH_CHROMAS[3].rank,
    });
  });

  it('marks nothing worn while the class body is shown', () => {
    const cards = mechChromaCards(
      snap({ mechChromaIds: [MECH_CHROMAS[3].id], wornMech: { catalog: 'class', skin: 3 } }),
    );
    expect(cards[0]).toMatchObject({ worn: false, action: 'wear' });
  });
});

describe('cosmeticsSig', () => {
  it('changes on every input the cards read and only on those', () => {
    const base = snap();
    expect(cosmeticsSig(base)).toBe(cosmeticsSig(snap()));
    expect(cosmeticsSig(snap({ tab: 'mech' }))).not.toBe(cosmeticsSig(base));
    expect(cosmeticsSig(snap({ wornMountSkin: 'mech_bird' }))).not.toBe(cosmeticsSig(base));
    expect(cosmeticsSig(snap({ applicableWeaponTypes: ['sword'] }))).not.toBe(cosmeticsSig(base));
    expect(cosmeticsSig(snap({ wornMech: { catalog: 'mech', skin: 0 } }))).not.toBe(
      cosmeticsSig(base),
    );
  });
});

// The self sheet's preview subject (src/ui/self_preview_subject.ts), extracted from Hud: the
// character sheet's own body and hands, and Lantern Hall's try-on of a weapon appearance.
import { describe, expect, it } from 'vitest';
import { TRY_ON_STAND_IN } from '../src/render/characters/preview_appearance';
import { selfPreviewSubject, selfTryOnBody } from '../src/ui/self_preview_subject';

function world(mainhand: string | null, loadout: Record<string, string> = {}) {
  return {
    player: {
      skin: 2,
      skinCatalog: 'class',
      helmHidden: false,
      modularAppearance: undefined,
      mainhandItemId: mainhand,
      offhandItemId: null,
    },
    equipment: { mainhand, offhand: null },
    accountCosmetics: { weaponSkinLoadout: loadout },
    cfg: { seed: 1, playerClass: 'warrior' as const },
  } as never;
}

describe('the self preview subject', () => {
  it('without a try-on: the held hands and the worn skin the world resolves', () => {
    const subject = selfPreviewSubject(world('worn_sword'), 'warrior', 2, 'player_warrior');
    expect(subject).toMatchObject({
      cls: 'warrior',
      skin: 2,
      mainhand: 'worn_sword',
      offhand: null,
      weaponSkinId: null,
      framing: 'sheet',
    });
  });

  it('a try-on holds the appearance, with a stand-in of its own type when the hand cannot', () => {
    // a staff appearance tried on by a sword wielder: the stand-in staff, the try-on skin
    const staff = selfPreviewSubject(
      world('worn_sword'),
      'warrior',
      2,
      undefined,
      'rimelight_staff',
    );
    expect(staff.weaponSkinId).toBe('rimelight_staff');
    expect(staff.mainhand).toBe(TRY_ON_STAND_IN.staff);
    // a sword appearance on a sword: the real hand stays
    const sword = selfPreviewSubject(
      world('worn_sword'),
      'warrior',
      2,
      undefined,
      'squallcrest_sword',
    );
    expect(sword).toMatchObject({ weaponSkinId: 'squallcrest_sword', mainhand: 'worn_sword' });
  });

  it('a Combat Mech subject draws no authored look and no WOC appearance', () => {
    const mech = selfPreviewSubject(world('worn_sword'), 'warrior', 0, 'player_mech');
    expect(mech).toMatchObject({ previewKey: 'player_mech', look: null, wocAppearance: undefined });
  });

  it("the try-on body is the sheet's own resolution; a mech wearer tries it on the class body", () => {
    expect(selfTryOnBody(world('worn_sword'))).toEqual(['warrior', 2, 'player_warrior']);
    const mech = {
      cfg: { seed: 1, playerClass: 'mage' as const },
      player: { skin: 3, skinCatalog: 'mech' },
    } as never;
    expect(selfTryOnBody(mech)).toEqual(['mage', 0, undefined]);
  });
});

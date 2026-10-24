// The SELF subject the shared character turntable mounts (Hud.mountCharPreview): the player's
// own body as the world draws it, both equipped hands, the worn set and the world's Armory
// skin, in the close self-sheet framing. Extracted from the Hud coordinator so the character
// sheet, the skin picker and Lantern Hall's try-on (an appearance held in your own hand before
// you buy it) build the one subject the same way. Pure: it reads the world and returns data.
import { modularLookFor, previewTryOnMainhand } from '../render/characters';
import { resolveActiveWeaponSkin } from '../sim/content/weapon_skin_rules';
import type { PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { activeCharacterAppearancePreview } from './character_appearance';
import { type PreviewSubject, wocPreviewKey } from './preview_subject';

export type SelfPreviewWorld = Pick<IWorld, 'player' | 'equipment' | 'accountCosmetics'>;

/** The body a try-on mounts: the class, the skin index and visual key the character sheet
 *  resolves (Hud.renderCharPreview, activeCharacterAppearancePreview). A Combat Mech wearer
 *  tries the appearance on their class body instead: the mech is a whole replacement rig
 *  whose assets stream lazily, and the try-on is about the weapon in the hand. */
export function selfTryOnBody(
  world: Pick<IWorld, 'cfg' | 'player'>,
): [cls: PlayerClass, skin: number, previewKey: string | undefined] {
  const cls = world.cfg.playerClass;
  const preview = activeCharacterAppearancePreview(
    cls,
    world.player.skin ?? 0,
    world.player.skinCatalog ?? 'class',
  );
  const mech = preview.visualKey === 'player_mech';
  return [cls, mech ? 0 : preview.skin, mech ? undefined : preview.visualKey];
}

/** The self sheet's subject. `tryOnSkinId` dresses that weapon appearance instead of the
 *  worn one, holding a stand-in of its own weapon type when neither hand can show it. */
export function selfPreviewSubject(
  world: SelfPreviewWorld,
  cls: PlayerClass,
  skin: number,
  previewKey?: string,
  tryOnSkinId: string | null = null,
): PreviewSubject {
  // The hands the WORLD draws (the entity's held ids, where a membership weapon shows its
  // class form), not the raw equipment slots.
  const offhand = world.player.offhandItemId ?? null;
  const mainhand = previewTryOnMainhand(tryOnSkinId, world.player.mainhandItemId ?? null, offhand);
  // The sheet shows the body the WORLD draws, read through the same look
  // seam the portrait uses: the player's own face, hair and kit, including
  // the helmet-visibility choice. A Combat Mech is a whole replacement body
  // and wins over the authored look, matching createCharacterVisual's own
  // precedence in-world (composing over it hid a purchased cosmetic).
  const mech = previewKey === 'player_mech';
  const app = world.player.modularAppearance;
  return {
    cls,
    skin,
    // A WOC body follows the creation pick and wears its head, colours, size; mech stays.
    previewKey: mech ? previewKey : (wocPreviewKey(cls, app) ?? previewKey),
    wocAppearance: mech ? undefined : app,
    look: mech ? null : modularLookFor(world.player),
    // A WOC body wears what the sheet's own slots hold, helm eye included.
    wornEquipment: world.equipment,
    helmHidden: world.player.helmHidden,
    mainhand,
    offhand,
    // The paperdoll wears the world's Armory skin: one shared rule (class + hands + loadout).
    weaponSkinId:
      tryOnSkinId ??
      resolveActiveWeaponSkin(
        cls,
        mainhand,
        world.accountCosmetics.weaponSkinLoadout,
        world.player.skinCatalog ?? 'class',
        offhand,
      ),
    framing: 'sheet',
  };
}

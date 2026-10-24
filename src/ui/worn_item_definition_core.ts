// Read the same class/spec/level projection as combat from mirrored player state.
import { ITEMS } from '../sim/data';
import { membershipArmourItem, referralArmourItem } from '../sim/membership_armour';
import type { ItemDef } from '../sim/types';
import type { IWorld } from '../world_api';

export function wornItemForPlayer(
  world: Pick<IWorld, 'cfg' | 'player'>,
  id: string | null | undefined,
): ItemDef | null {
  const item = id ? ITEMS[id] : undefined;
  if (!item) return null;
  const player = world.player;
  return referralArmourItem(
    membershipArmourItem(
      item,
      world.cfg.playerClass,
      player.specId,
      player.level,
      player.membershipActive === true,
    ),
    world.cfg.playerClass,
    player.specId,
    player.level,
    !!player.referralInviterName,
  );
}

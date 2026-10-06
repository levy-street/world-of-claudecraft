// Mobile riding uses the same trained mount toggle as keyboard and gamepad.
// Bag contents never replace the character's selected cosmetic.
import type { MountKey } from '../sim/content/mounts';

export type MobileMountAction =
  | { kind: 'dismount' }
  // Retained for callers with an existing exhaustive item-action dispatcher.
  | { kind: 'summon'; itemId: string }
  | { kind: 'fallback' };

export function mobileMountAction(
  mountedKey: string,
  _bagOwned: readonly MountKey[],
): MobileMountAction {
  return mountedKey ? { kind: 'dismount' } : { kind: 'fallback' };
}

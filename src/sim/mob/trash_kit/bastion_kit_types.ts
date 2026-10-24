// The Sunken Bastion trash's own kit block (MobTemplate.trashKit.bastion), as
// a type-only leaf: the content (sunken_bastion.ts) authors it, the Bastion
// extension (bastion_extension.ts, bastion_order.ts) runs it. The first
// Bastion pass rides core keys (bastion_kit.ts); this block holds the second
// wave's, so the shared driver never grows a Bastion branch.

import type { TrashKitCast } from '../../types';

export interface BastionKitDef {
  /** Loose on My Mark (bastion_order.ts): an interruptible shout at one
   *  player past the tank within `range`. When the bar ends, every living
   *  `shooters` mob of the caster's own pack within `shooterRange` of the
   *  mark looses a bolt at them at once (a roll of `min` to `max`, scaled by
   *  the SHOOTER's mechanic multiplier, named `boltName`); a wall between a
   *  shooter and the mark stops that bolt. Kick the shout, or hide. */
  order?: TrashKitCast & {
    range: number;
    shooters: string;
    shooterRange: number;
    min: number;
    max: number;
    boltName: string;
  };
}

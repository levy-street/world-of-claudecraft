// The Sunken Bastion's kit extension (kit_extension.ts): routes the Bastion's
// second-wave key block (MobTemplate.trashKit.bastion) into the shared
// driver. The first pass's Bastion keys stay core keys (bastion_kit.ts); the
// second wave's ride here, so the driver never grows a Bastion branch.
//
//   order   Loose on My Mark (Drowned Sergeant, bastion_order.ts): a kickable
//           shout that sends every arbalest of its pack at one player.

import type { TrashKitCast, TrashKitDef } from '../../types';
import { landOrder, orderTarget } from './bastion_order';
import type { TrashKitExtension } from './kit_extension';

/** The Bastion's second-wave cast keys, in priority order. */
const BASTION_CAST_KEYS = ['order'] as const;
type BastionCastKey = (typeof BASTION_CAST_KEYS)[number];

function isBastionKey(key: string): key is BastionCastKey {
  return (BASTION_CAST_KEYS as readonly string[]).includes(key);
}

export const BASTION_KIT_EXTENSION: TrashKitExtension = {
  castKeys: BASTION_CAST_KEYS,
  castDef(kit: TrashKitDef, key: string): TrashKitCast | undefined {
    return isBastionKey(key) ? kit.bastion?.[key] : undefined;
  },
  // The shout is a spoken order: a silence or a kick stops it.
  isPhysical: () => false,
  ready(ctx, inst, mob, kit, _key, st, players) {
    const target = orderTarget(ctx, inst, mob, kit, st, players);
    return target ? { ok: true, target } : { ok: false, target: null };
  },
  land(ctx, inst, mob, kit, _key, targetId) {
    landOrder(ctx, inst, mob, kit, targetId);
  },
};

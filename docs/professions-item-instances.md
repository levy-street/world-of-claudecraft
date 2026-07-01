# Professions Item Instances

Decision: go, as an additive item-instance payload alongside the existing fungible `{ itemId, count }` inventory slot.

Most items should remain fungible stacks. Professions features that need per-item state can opt a slot into `InvSlot.instance`, which carries the currently known downstream requirements:

- `signer`: the crafter or gatherer identity that signed the item.
- `effectCharges`: per-effect durability or charge counters for tools and slotted effects.
- `rolledQuality` / `rolledStats`: non-fungible quality and stat rolls that cannot be represented by a shared item id.
- `boundTo`: the character identity the item instance is bound to.

The rationale is that tool charge state, signed commissions, and binding workflows all need state that cannot safely live on a global item definition or on a stack keyed only by `itemId`. Keeping the payload optional avoids changing the normal fast path for materials, vendor goods, loot stacks, and other fully fungible items.

Current scope:

- Character save/load preserves the instance payload for inventory and vendor buyback slots.
- Bag filtering/display treats instanced slots as normal slots so they remain visible to the player.
- The World Market lists only fungible stacks. Instanced slots are intentionally inert until the market flow has explicit support for escrow, listing, buying, cancelling, and collecting per-instance goods.

Out of scope: crafting-quality rolls that can be represented by distinct rarity-keyed item ids should continue to do that and should not block on item instances.
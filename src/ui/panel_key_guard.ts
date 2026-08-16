// The non-modal panel key guard, as a pure decision.
//
// The delve board, lockpick panel, map window, and the bank + bags cluster are
// non-modal overlays, so canUseGameKeys() stays true over them and the global
// jump (Space) / chat (Enter) binds would otherwise hijack those keys on a
// focused panel button (the map's Quests toggle, a bank grid cell, and each
// close button included). The Hud's guard stops propagation, but NOT the
// default, so the button's native activation still fires.
//
// The one exception is a bag ITEM row. That button runs a GAME action (use /
// summon / equip / sell / deposit), so Space over it must stay Jump:
//
//   - It has already cancelled the default itself (bags_window.ts
//     guardItemRowSpace), so there is no native activation left to protect the
//     jump bind from. That matters because the bags rebuild re-seats focus by
//     data-focus-key: summon a mount from your bags and the reins row is still
//     focused, so the browser's synthesised Space click re-used the reins,
//     which on the mount you are already riding dismounts you (src/sim/
//     mounts.ts). Every attempt to hop threw the rider instead.
//   - Swallowing Space here would leave that same rider unable to jump at all
//     while their bags are open, which is the other half of the same bug.
//
// Enter is never let through: keyboard players keep the row's native activation.

/** Marks a bag item row: the one panel button Space must pass through. */
export const BAG_ITEM_ROW_ATTR = 'data-bag-item-row';

/** True when a key over `target` is a panel activation the game must not also see. */
export function panelKeyGuardStops(target: HTMLElement, key: string, code: string): boolean {
  if (target.tagName !== 'BUTTON') return false;
  const isSpace = key === ' ' || key === 'Spacebar' || code === 'Space';
  if (isSpace) return !target.hasAttribute(BAG_ITEM_ROW_ATTR);
  return key === 'Enter';
}

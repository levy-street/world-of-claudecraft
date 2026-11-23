// Game item -> the armor set a WOC body shows for it: the display table of the
// 2026-09-25 character size gameplan (step 7), the way classic MMOs map an item
// to a display record instead of hard-coding a look per class.
//
// An item with NO row shows the wearer's own class set's piece for the item's
// slot (woc_parts_core.ts wocArmorAssetFor): every item today, so a warrior in
// any helm wears the warrior helm. A row points an item at another set, and the
// wearer then shows THAT set's piece for the item's slot, in the wearer's own
// body fit and at the texture tier the wearer draws. Pieces mix freely across
// sets (a mage hood over warrior plate) because every set rides the same rig
// and binds by bone name (woc_armor_bind.ts).
//
// Adding a new helm is one row and one asset set:
//   1. ship the set's armor files per body fit (build_woc_split.mjs: low,
//      medium and top):
//      its nodes follow the class sets' convention, `Armor_<Set>_<Piece>` for
//      the male fit and `Armor_Female_<Set>_<Piece>` for the female fit, where
//      <Set> is the set id with each word capitalized (`iron_crown` ->
//      `Iron_Crown`) and <Piece> is Helm, Chest_Front/Chest_Back,
//      Shoulder_L/Shoulder_R, Gauntlet_L/Gauntlet_R, Waist or Boot_L/Boot_R;
//   2. add `<item id>: { set: '<set id>' }` below.
// The set's catalog entries are minted from that convention
// (woc_armor_catalog.ts), so a set only ever needs the pieces it ships.
// Data-as-code, keyed by the server item id; tests/woc_item_display.test.ts
// pins every row against the item table and the shipped armor files.

/** One display row: the armor set whose piece an item shows. */
export interface WocItemDisplay {
  /** The armor set id (a class set: `warrior`, `mage`, ...; or a set of its own). */
  readonly set: string;
}

export const WOC_ITEM_DISPLAY: Readonly<Record<string, WocItemDisplay>> = {};

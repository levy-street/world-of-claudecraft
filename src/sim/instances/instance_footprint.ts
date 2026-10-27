// The instance-footprint half width per dungeon: how far either side of a
// slot's origin (in x) a body still counts as "inside the claim". Every
// dungeon uses the generic envelope except the authored fields drawn wider
// than it, which name their own half width here. A dungeon's x band is 600 yd
// (data.ts instanceOrigin), so any half width under 300 keeps neighbouring
// bands apart. Dependency-free leaf: occupancy (instances/dungeons.ts), the
// trash kit's claim roster (mob/trash_kit/driver.ts), the gate engine's
// announcements (instances/dungeon_gates.ts) and the vault craft gate's reach
// (vault_craft_gate.ts) all read it, so the claim has ONE shape.

/** The generic half width (yards). */
export const INSTANCE_FOOTPRINT_HALF_WIDTH = 120;

/** Authored fields wider than the generic envelope. The Smith's Heart's
 *  field reaches |x| 258 (content/smith_heart_layout.ts bounds: the Smith's
 *  Forge in the west, the Quench Basin and the Heart in the east). */
const WIDE_FIELD_HALF_WIDTH: Readonly<Record<string, number>> = {
  smith_heart: 270,
};

/** The claim's half width in x for a dungeon id. */
export function instanceHalfWidthOf(dungeonId: string): number {
  return WIDE_FIELD_HALF_WIDTH[dungeonId] ?? INSTANCE_FOOTPRINT_HALF_WIDTH;
}

// The rune wall on the Anchor Ledge (docs/design/dungeon-rework/gravewyrm_sanctum.md
// section 3, "a readable lore object"): the Smith's three acts cut into the rock
// as runes the height of a man. The wall itself is render only (the kit piece
// Kit_RuneWall) and carries pictures, never letters, so no language is baked
// into the world art. Its meaning reaches the player the way the repo's other
// readable lore objects speak (the Ignivar raid's Tempering Records): one chat
// line, emitted to that player alone as a `log` event in English and
// re-localized on the client by the sim_i18n EXACT matcher
// (`log.sanctumRuneWall`). It is read on approach, the first time each player
// of a claim walks up in front of the wall, so no click target or wire change
// is needed. Zero rng; the per-claim memory dies with the claim.

import { RUNE_WALL } from '../../content/gravewyrm_sanctum_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { claimPlayers, localOf } from './claim';

/** The rune wall's lore line (re-localized by src/ui/sim_i18n.ts,
 *  `log.sanctumRuneWall`). */
export const RUNE_WALL_LORE_LOG =
  "The Smith's runes, cut the height of a man, name the three acts of his craft: heat, the hammer, and the quench. The quench still holds the Wyrm in the ice.";

/** The rune glow's blue, the colour the line is written in. */
export const RUNE_WALL_LORE_COLOR = '#7cc8ff';

/** How far in front of the wall's face the runes read (yd), and the slack past
 *  its two ends. */
export const RUNE_WALL_READ_DEPTH = 16;
const READ_END_SLACK = 2;

/** Is an instance-local point in front of the rune wall, close enough to read
 *  it? The wall runs along z on the ledge's east edge, its face toward -x. */
export function inRuneWallReadZone(lx: number, lz: number): boolean {
  const face = RUNE_WALL.x - RUNE_WALL.hw;
  return (
    lx <= face &&
    lx >= face - RUNE_WALL_READ_DEPTH &&
    Math.abs(lz - RUNE_WALL.z) <= RUNE_WALL.hd + READ_END_SLACK
  );
}

interface ReadMemory {
  /** The claim the memory belongs to (its exit entity), so a freed and
   *  re-claimed slot reads afresh. */
  claim: number | null;
  read: Set<number>;
}

// Keyed by the slot record of ONE world (the dungeon_gates devOpen precedent).
const memory = new WeakMap<InstanceSlot, ReadMemory>();

/** One tick of the rune wall: every claim player who has just walked up in
 *  front of it, and has not read it this claim, reads its lore line. */
export function tickRuneWallLore(ctx: SimContext, inst: InstanceSlot): void {
  let m = memory.get(inst);
  if (!m || m.claim !== inst.exitId) {
    m = { claim: inst.exitId, read: new Set() };
    memory.set(inst, m);
  }
  for (const p of claimPlayers(ctx, inst)) {
    if (m.read.has(p.id)) continue;
    const at = localOf(ctx, inst, p);
    if (!inRuneWallReadZone(at.x, at.z)) continue;
    m.read.add(p.id);
    ctx.emit({ type: 'log', text: RUNE_WALL_LORE_LOG, color: RUNE_WALL_LORE_COLOR, pid: p.id });
  }
}

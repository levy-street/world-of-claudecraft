import type { CrowdControlDrCategory } from './types';

// Which plain (non-fear) incapacitates carry diminishing returns in PvP, the
// sibling rule to stun_dr.ts.
//
// The fear family already has its own ladder (`fearDr` on the ability def, the
// 'fear' category). Everything else in the `incapacitate` kind was undiminished:
// a rogue could Sap the same player back to back for the full 8 sec every time,
// which is the one plain incapacitate long enough and cheap enough for that to
// matter (Gouge is 4 sec off a melee swing, Eye Jab and Wyvern Sting are shorter
// still and sit behind cooldowns).
//
// Sap therefore takes the 'incapacitate' category, whose ladder is resolved by
// the GENERIC arm of Sim.crowdControlDurationAfterDr: PVP_CC_DR_MULTIPLIERS
// (full, half, quarter, then immune) over PVP_ROOT_DR_RESET seconds. That is
// byte-for-byte the ladder Gripping Roots (entangling_roots) rides through the
// 'root' category, which is the parity the balance pass asked for. It is a
// SEPARATE category on purpose: sharing 'root' would let a rogue's Sap eat a
// druid's root chain and vice versa, the same reason opener and controlled
// stuns are split in stun_dr.ts.
const DIMINISHED_INCAPACITATES = new Set(['sap']);

/** The DR category a plain incapacitate rides, or null when it is undiminished.
 *  Fear-family incapacitates never reach here: their def carries `fearDr` and
 *  the dispatch picks the 'fear' category before consulting this. */
export function incapacitateDrCategory(abilityId: string): CrowdControlDrCategory | null {
  return DIMINISHED_INCAPACITATES.has(abilityId) ? 'incapacitate' : null;
}

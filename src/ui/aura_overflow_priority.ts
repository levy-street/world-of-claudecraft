// Pure selection of which buff-bar slots the low-tier overflow cap sheds this
// frame (auras_painter.ts). Split out of the painter because the selection
// itself needs none of the painter's DOM pool state: it is a pure function of
// this frame's aura list and the cap, so it is unit-tested directly with plain
// AuraSlotState fixtures.
//
// Two independent kinds of "never shed" exemption feed the selection:
//  - id-allowlisted (ALWAYS_VISIBLE_AURA_IDS): an aura whose icon IS an
//    affordance (a resource meter, a charge counter) rather than cosmetic
//    upkeep, so hiding it hides an action.
//  - short-duration priority (AuraSlotState.shortDuration, auras_view.ts
//    isShortDurationBuff): a buff authored with a short lifetime (Raised
//    Guard's 6 sec block, an on-use proc) is far more likely to be something
//    the player is actively TIMING than a raid/world buff that will still be
//    up in twenty minutes. When the cap must shed, a long-duration buff sheds
//    before a short one, so a tank watching their active-mitigation icon on
//    Low never loses it to a stat buff that merely applied earlier in the
//    fight. Player feedback: https://github.com/levy-street/world-of-claudecraft/pull/3668
import type { AuraSlotState } from './auras_view';

// Auras the low graphics tier's buff cap may NEVER shed regardless of
// duration. Moved here (out of auras_painter.ts) alongside the sibling
// short-duration priority rule, since both answer the same question: does
// this buff's icon carry information a flat cap must never hide?
export const ALWAYS_VISIBLE_AURA_IDS: ReadonlySet<string> = new Set([
  'divine_ascension',
  'shaman_thunder_charges',
  'shaman_warspirit_cadence',
  'moontide',
  'old_blood',
  'verdance',
]);

function isExempt(s: Pick<AuraSlotState, 'isDebuff' | 'alwaysRender' | 'key'>): boolean {
  return s.isDebuff || s.alwaysRender || ALWAYS_VISIBLE_AURA_IDS.has(s.key);
}

/**
 * Fill `shed[0..count)` with which of `slots[0..count)` the cap sheds this
 * frame, and return the shed count. `shed` is caller-owned and reused frame to
 * frame (grown, never shrunk) so this stays allocation-free on the hot path;
 * only indices `< count` are written, matching what `paint()` reads back.
 *
 * Exempt slots (a debuff, `alwaysRender`, or an ALWAYS_VISIBLE_AURA_IDS id)
 * always render and are never marked shed, and -- FAIRNESS -- they do NOT
 * spend any of the cap's budget: `cap` ordinary buffs render regardless of
 * how many exempt auras are also active, so a raid full of debuffs never
 * shrinks a player's buff allotment. Among the ordinary buffs, short-duration
 * ones (`shortDuration`) fill the `cap` budget first; only once that is
 * exhausted do long-duration buffs start losing theirs. Within each bucket,
 * ties break by application order (index order), the same "first applied,
 * first rendered" rule the uncapped path already uses, so the selection
 * stays deterministic frame to frame.
 */
export function selectShedSlots(
  slots: readonly AuraSlotState[],
  count: number,
  cap: number,
  shed: boolean[],
): number {
  for (let i = 0; i < count; i++) shed[i] = false;
  let budget = cap;
  let shedCount = 0;
  for (let i = 0; i < count; i++) {
    const s = slots[i];
    if (isExempt(s) || !s.shortDuration) continue;
    if (budget > 0) budget--;
    else {
      shed[i] = true;
      shedCount++;
    }
  }
  for (let i = 0; i < count; i++) {
    const s = slots[i];
    if (isExempt(s) || s.shortDuration) continue;
    if (budget > 0) budget--;
    else {
      shed[i] = true;
      shedCount++;
    }
  }
  return shedCount;
}

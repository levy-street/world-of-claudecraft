import type { CrowdControlDrCategory } from './types';

// Classic-era stun diminishing returns are NOT one shared bucket. Same-category
// stuns diminish together (full -> half -> quarter -> immune), but stuns split
// into independent categories so a rogue's opener stun does not eat into the
// diminishing chain of a controlled stun:
//   - openerStun:     from-stealth openers (Cheap Shot, Pounce)
//   - controlledStun: deliberate on-demand stuns (Kidney Shot, Hammer of Justice,
//                     Bash, Charge, Feral/Bear Charge)
//   - randomStun:     proc-style stuns (none represented yet; the safe default)
// Keeping these separate preserves the core rogue opener flow: Cheap Shot does
// not diminish the following Kidney Shot, while repeated Kidney Shots (or repeated
// Hammer of Justice) still diminish within their own category.
const OPENER_STUNS = new Set(['cheap_shot', 'pounce']);
const CONTROLLED_STUNS = new Set([
  'kidney_shot',
  'hammer_of_justice',
  'bash',
  'charge',
  'bear_charge',
]);

export function stunDrCategory(abilityId: string): CrowdControlDrCategory {
  if (OPENER_STUNS.has(abilityId)) return 'openerStun';
  if (CONTROLLED_STUNS.has(abilityId)) return 'controlledStun';
  return 'randomStun';
}

// A stun DR category is any of the three stun buckets above; they all share the
// stun DR reset window. Used by the duration resolver to pick the reset timer.
export function isStunDrCategory(category: CrowdControlDrCategory): boolean {
  return category === 'openerStun' || category === 'controlledStun' || category === 'randomStun';
}

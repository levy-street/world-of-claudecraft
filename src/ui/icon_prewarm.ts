// Which procedural icons to warm during idle so opening the spellbook / action
// bar and the first buff/debuff landing in combat never pay the synchronous
// canvas compose + PNG encode (iconDataUrl) on the main thread mid-game.
//
// Pure + host-agnostic (no DOM, no canvas) so it unit-tests directly; the HUD is
// the thin consumer that iterates these keys through iconDataUrl during idle.
import type { IconKind } from './icons';

export interface IconWarmKey {
  kind: IconKind;
  id: string;
}

/**
 * The first icons a player hits: every known ability's ability icon (the action
 * bar + spellbook on open) and its aura icon (the buff/debuff bar reuses the
 * ability id when a cast applies an aura - see hud.ts). Deduped so the warmer
 * never composes the same icon twice, and order-stable so the warm front matches
 * what the player is most likely to open first.
 */
export function abilityIconWarmKeys(abilityIds: readonly string[]): IconWarmKey[] {
  const keys: IconWarmKey[] = [];
  const seen = new Set<string>();
  const push = (kind: IconKind, id: string): void => {
    if (!id) return;
    const k = `${kind}|${id}`;
    if (seen.has(k)) return;
    seen.add(k);
    keys.push({ kind, id });
  };
  for (const id of abilityIds) {
    push('ability', id);
    push('aura', id);
  }
  return keys;
}

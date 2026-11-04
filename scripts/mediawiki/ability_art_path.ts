import { ABILITY_ART_PENDING, abilityImageUrl } from '../../src/ui/icons';

/** Prefer the HUD's registered asset. Pending paintings use a lossless copy
 * of their actual canvas art from render_ability_icons.mjs. */
export function wikiAbilityArtPath(id: string): string | null {
  return (
    abilityImageUrl(id) ??
    (ABILITY_ART_PENDING.has(id) ? '/ui/encyclopedia/abilities/' + id + '.webp' : null)
  );
}

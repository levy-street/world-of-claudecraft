// The worn seasonal head (Gourdlight Eve's Carved Pumpkin Head): who draws one,
// and what it does to the helmet under it. Pure (no Three): the sim puts the
// pumpkin on as an aura (kind 'seasonal_cosmetic', src/sim/seasonal/), so every
// host, and every peer through the ordinary aura wire, agrees on who wears it.
//
// While worn the kit helmet is left off (the pumpkin sits where it would), the
// same composed-look path the paperdoll eye toggle drives. A stealthed body
// never draws the pumpkin: a glowing head floating where an unseen rogue walks
// would hand out the one thing stealth hides (the graphics fairness rule).
import { PUMPKIN_HEAD_AURA_ID } from '../../sim/content/gourdlight_eve';

interface AuraLike {
  id: string;
  kind: string;
}

/** Whether these auras carry the worn pumpkin head. */
export function wearsSeasonalHead(auras: readonly AuraLike[]): boolean {
  for (const a of auras)
    if (a.id === PUMPKIN_HEAD_AURA_ID && a.kind === 'seasonal_cosmetic') return true;
  return false;
}

/** The helm-hidden bit the composed look uses: the paperdoll eye, or a worn head. */
export function effectiveHelmHidden(e: {
  helmHidden: boolean;
  auras: readonly AuraLike[];
}): boolean {
  return e.helmHidden || wearsSeasonalHead(e.auras);
}

/** Whether the head piece draws on this body right now. */
export function drawsSeasonalHead(e: {
  kind: string;
  stealthed: boolean;
  ghost?: boolean;
  auras: readonly AuraLike[];
}): boolean {
  return e.kind === 'player' && !e.stealthed && !e.ghost && wearsSeasonalHead(e.auras);
}

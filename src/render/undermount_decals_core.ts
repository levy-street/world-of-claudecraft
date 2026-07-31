// Pure decisions for the Undermount's fairness-critical decals. Actionable
// colors are deliberately independent of graphics tier and reduced motion.

export const UNDERMOUNT_SCORCHED_AURA_ID = 'odrenn_scorched';
export const UNDERMOUNT_CHILLED_AURA_ID = 'odrenn_chilled';
export const UNDERMOUNT_FORGEHEAT_AURA_ID = 'volzharr_forgeheat';
export const UNDERMOUNT_VOLZHARR_ID = 'volzharr_buried_furnace';

export const UNDERMOUNT_DECAL = {
  ventRing: 1 << 0,
  ventCore: 1 << 1,
  forgeheat: 1 << 2,
  scorched: 1 << 3,
  chilled: 1 << 4,
  eruption: 1 << 5,
} as const;

export type UndermountDecalKind = keyof typeof UNDERMOUNT_DECAL;
export type UndermountFxLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface UndermountPresentationSettings {
  fxLevel: UndermountFxLevel;
  reducedMotion: boolean;
}

const COLOR_BY_KIND: Readonly<Record<UndermountDecalKind, number>> = {
  ventRing: 0xff4b16,
  ventCore: 0x050100,
  forgeheat: 0xffc928,
  scorched: 0xff6a1a,
  chilled: 0x5d8fb8,
  eruption: 0xff4b16,
};

/**
 * Actionable hues never vary with presentation settings. The optional settings
 * argument exists so tests can pin that contract across every supported mode.
 */
export function undermountDecalColor(
  kind: UndermountDecalKind,
  _settings?: UndermountPresentationSettings,
): number {
  return COLOR_BY_KIND[kind];
}

export function undermountEntityDecalMask(auras: ReadonlyArray<{ id: string }>): number {
  let mask = 0;
  for (const aura of auras) {
    if (aura.id === UNDERMOUNT_FORGEHEAT_AURA_ID) mask |= UNDERMOUNT_DECAL.forgeheat;
    else if (aura.id === UNDERMOUNT_SCORCHED_AURA_ID) mask |= UNDERMOUNT_DECAL.scorched;
    else if (aura.id === UNDERMOUNT_CHILLED_AURA_ID) mask |= UNDERMOUNT_DECAL.chilled;
  }
  return mask;
}

export function isVolzharrEruptionWindup(
  event: { type: string; fx?: string },
  sourceTemplateId: string | undefined,
): boolean {
  return (
    event.type === 'spellfx' && event.fx === 'windup' && sourceTemplateId === UNDERMOUNT_VOLZHARR_ID
  );
}

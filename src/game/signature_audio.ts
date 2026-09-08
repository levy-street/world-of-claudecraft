interface Accent {
  key: string;
  gain: number;
  cooldown: number;
}
const ACCENTS: Readonly<Record<string, Accent>> = {
  pyroblast: { key: 'signature_pyre', gain: 0.32, cooldown: 0.65 },
  frost_nova: { key: 'signature_glacier', gain: 0.27, cooldown: 0.65 },
  chain_lightning: { key: 'signature_thunder', gain: 0.25, cooldown: 0.65 },
  chain_heal: { key: 'signature_tide', gain: 0.3, cooldown: 0.65 },
  ghost_wolf: { key: 'signature_wolf', gain: 0.32, cooldown: 0.8 },
  hammer_of_wrath: { key: 'signature_judgement', gain: 0.25, cooldown: 0.65 },
  execute: { key: 'signature_execution', gain: 0.3, cooldown: 0.65 },
  abyssal_rift: { key: 'signature_rift', gain: 0.3, cooldown: 0.8 },
};
/** A distinct low-level material tail, never a second copy of the foreground impact. */
export function signatureAccent(
  kind: string,
  abilityId: string | undefined,
  lite: boolean,
): Accent | null {
  if (kind !== 'impact' || lite || !abilityId) return null;
  if (ACCENTS[abilityId]) return ACCENTS[abilityId];
  const ability = ABILITIES[abilityId];
  if (!ability || ability.passive) return null;
  const family =
    ability.targetType === 'friendly'
      ? 'chain_heal'
      : (
          {
            fire: 'pyroblast',
            frost: 'frost_nova',
            shadow: 'abyssal_rift',
            nature: 'chain_lightning',
            holy: 'hammer_of_wrath',
            physical: 'execute',
            arcane: 'ghost_wolf',
          } as const
        )[ability.school];
  const base = ACCENTS[family];
  return { key: base.key, gain: ability.castTime > 0 ? 0.14 : 0.09, cooldown: 1.1 };
}
export function signatureAccentKeys(): string[] {
  return Object.values(ACCENTS).map((a) => a.key);
}

import { ABILITIES } from '../sim/data';

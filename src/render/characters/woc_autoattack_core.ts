// Autoattack swings for the WOC bodies, from the hand-keyed library
// (woc_keyed_animations.ts): which clip a white swing plays and when its blade
// lands. Pure: no three.js, no mixer.
import type { DualSwingState } from './attack_swing_core';
import { contactDelaySec, pickDualSwing } from './attack_swing_core';
import type { VisualDef } from './manifest';
import type { WeaponAttackStyle } from './weapon_attack_style_core';
import contacts from './woc_autoattack_contacts.json';

export const WOC_AUTO_ATTACK_NAMES = [
  'Woc_Attack_1H_0',
  'Woc_Attack_1H_1',
  'Woc_Attack_2H_0',
  'Woc_Attack_2H_1',
  'Woc_Attack_Unarmed_0',
  'Woc_Attack_Unarmed_1',
  'Woc_Attack_Rifle',
  'Woc_Attack_Bow',
  'Woc_Attack_Dual',
  'Woc_Attack_Dual#main',
  'Woc_Attack_Dual#off',
] as const;

const DUAL = 'Woc_Attack_Dual';

/** Autoattacks only. Named abilities, cast releases and wands retain their own path. */
export function pickWocAutoAttack(input: {
  def: VisualDef;
  abilityId: string | undefined;
  kind: 'melee' | 'wand' | undefined;
  style: WeaponAttackStyle | null;
  singleSetTwoHander: boolean;
  bowSkin: boolean;
  unarmed: boolean;
  index: number;
  mixerTime: number;
  dual: DualSwingState;
  has: (name: string) => boolean;
}): { clip: string | null; delay: number } | null {
  const { def, abilityId, kind, style, singleSetTwoHander, index, has } = input;
  if (!def.wocCharacter || abilityId || kind === 'wand') return null;
  const ranged = kind !== 'melee' && def.clips.attack.includes('Ranged_Shoot');
  const twoHanded =
    !singleSetTwoHander &&
    (style === 'twohand' || (style === null && def.clips.attack.includes('2H_Chop')));
  let clip = ranged
    ? input.bowSkin
      ? 'Woc_Attack_Bow'
      : 'Woc_Attack_Rifle'
    : input.unarmed
      ? `Woc_Attack_Unarmed_${index % 2}`
      : `Woc_Attack_${twoHanded ? '2H' : '1H'}_${index % 2}`;
  if (!has(clip)) return null;
  const scale = def.attackTimeScale ?? 1.3;
  const table = contacts[def.wocCharacter.fit];
  let contact = 0;
  if (!ranged && style === 'dualwield') {
    if (![DUAL, `${DUAL}#main`, `${DUAL}#off`].every(has)) return null;
    const pick = pickDualSwing(DUAL, [DUAL], has, input.mixerTime, input.dual);
    clip = pick.clip ?? DUAL;
    contact = pick.contact;
    if (pick.clip === null)
      return { clip: null, delay: contactDelaySec(table, clip, contact, scale) };
  }
  return { clip, delay: ranged ? 0 : contactDelaySec(table, clip, contact, scale) };
}

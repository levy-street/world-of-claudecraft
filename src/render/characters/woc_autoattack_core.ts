import type { DualSwingState } from './attack_swing_core';
import { contactDelaySec, pickDualSwing } from './attack_swing_core';
import type { VisualDef } from './manifest';
import type { WeaponAttackStyle } from './weapon_attack_style_core';
import contacts from './woc_autoattack_contacts.json';

export function wocAutoAttacksUrl(fit: 'male' | 'female'): string {
  return `models/chars/players/woc/wow_autoattacks_${fit}.glb`;
}

export const WOC_AUTO_ATTACK_NAMES = [
  'WoW_Attack1H_0',
  'WoW_Attack1H_1',
  'WoW_Attack2H_0',
  'WoW_Attack2H_1',
  'WoW_AttackUnarmed_0',
  'WoW_AttackUnarmed_1',
  'WoW_AttackRifle_0',
  'WoW_AttackBow_0',
  'WoW_AutoDual',
  'WoW_AutoDual#main',
  'WoW_AutoDual#off',
] as const;

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
  let clip = ranged
    ? input.bowSkin
      ? 'WoW_AttackBow_0'
      : 'WoW_AttackRifle_0'
    : input.unarmed
      ? `WoW_AttackUnarmed_${index % 2}`
      : `WoW_Attack${!singleSetTwoHander && (style === 'twohand' || (style === null && def.clips.attack.includes('2H_Chop'))) ? '2H' : '1H'}_${index % 2}`;
  if (!has(clip)) return null;
  let contact = 0;
  if (!ranged && style === 'dualwield') {
    if (!['WoW_AutoDual', 'WoW_AutoDual#main', 'WoW_AutoDual#off'].every(has)) return null;
    const pick = pickDualSwing('WoW_AutoDual', ['WoW_AutoDual'], has, input.mixerTime, input.dual);
    clip = pick.clip ?? 'WoW_AutoDual';
    contact = pick.contact;
    if (pick.clip === null)
      return {
        clip: null,
        delay: contactDelaySec(
          contacts[def.wocCharacter.fit],
          clip,
          contact,
          def.attackTimeScale ?? 1.3,
        ),
      };
  }
  return {
    clip,
    delay: ranged
      ? 0
      : contactDelaySec(contacts[def.wocCharacter.fit], clip, contact, def.attackTimeScale ?? 1.3),
  };
}

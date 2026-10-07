import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DURATION_SECONDS,
  MEMBERSHIP_TOKEN_ID,
  MEMBERSHIP_XP_MULTIPLIER,
} from '../sim/content/membership';
import {
  isMembershipArmour,
  isReferralArmour,
  membershipArmourItem,
  membershipItemLevel,
  referralArmourItem,
} from '../sim/membership_armour';
import type { ItemDef, ItemInstancePayload, PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { esc } from './esc';
import { t } from './i18n';
import { itemNumber } from './item_instance_tooltip';

type MembershipTooltipWorld = Pick<IWorld, 'cfg' | 'player' | 'talentSpec'>;

export interface MembershipTooltipWearer {
  templateId: string;
  level: number;
  specId?: string | null;
  membershipActive?: boolean;
  referralInviterName?: string;
}

/** Resolve the same wearer-specific definition as combat, including dormancy. */
export function membershipTooltipItem(
  item: ItemDef,
  world: MembershipTooltipWorld,
  wearer?: MembershipTooltipWearer,
): ItemDef {
  const referral = isReferralArmour(item.id);
  return (referral ? referralArmourItem : membershipArmourItem)(
    item,
    (wearer?.templateId ?? world.cfg.playerClass) as PlayerClass,
    wearer ? (wearer.specId ?? null) : world.talentSpec,
    wearer?.level ?? world.player.level,
    referral
      ? !!(wearer ?? world.player).referralInviterName
      : (wearer ?? world.player).membershipActive === true,
  );
}

/** Dormant armour grants no enchant, quality, or other per-copy stat benefits. */
export function membershipTooltipInstance(
  item: ItemDef,
  instance: ItemInstancePayload | undefined,
  wearer: Pick<MembershipTooltipWearer, 'membershipActive' | 'referralInviterName'>,
): ItemInstancePayload | undefined {
  const active = wearer.membershipActive === true;
  const referralInviterName = wearer.referralInviterName;
  return (isMembershipArmour(item.id) && !active) ||
    (isReferralArmour(item.id) && !referralInviterName)
    ? undefined
    : instance;
}

export function membershipTooltipEquipment(
  world: MembershipTooltipWorld & Pick<IWorld, 'equipment' | 'equipmentInstances'>,
): { equipment: IWorld['equipment']; instances: IWorld['equipmentInstances'] } {
  const instances = { ...world.equipmentInstances };
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
    const id = world.equipment[slot] ?? '';
    if (
      (isMembershipArmour(id) && world.player.membershipActive !== true) ||
      (isReferralArmour(id) && !world.player.referralInviterName)
    )
      delete instances[slot];
  }
  return { equipment: world.equipment, instances };
}

export function membershipItemTooltipLines(
  item: ItemDef,
  wearer: Pick<MembershipTooltipWearer, 'level' | 'membershipActive' | 'referralInviterName'>,
): string {
  const { level, referralInviterName } = wearer;
  const active = wearer.membershipActive === true;
  if (item.id === MEMBERSHIP_TOKEN_ID) {
    return `<div class="tt-desc">${esc(
      t('itemUi.tooltip.membershipToken', {
        days: itemNumber(MEMBERSHIP_DURATION_SECONDS / 86400),
      }),
    )}</div>`;
  }
  const referral = isReferralArmour(item.id);
  if (!isMembershipArmour(item.id) && !referral) return '';
  const line = (text: string, css = 'tt-desc'): string => `<div class="${css}">${esc(text)}</div>`;
  return (
    line(t('itemUi.tooltip.membershipAdaptive')) +
    line(
      t(level >= 20 ? 'itemUi.tooltip.membershipPerfected' : 'itemUi.tooltip.membershipScaling', {
        level: itemNumber(membershipItemLevel(level)),
      }),
      'tt-sub',
    ) +
    line(
      t(referral ? 'itemUi.tooltip.referralFullSet' : 'itemUi.tooltip.membershipFullSet', {
        member: referralInviterName ?? t('itemUi.tooltip.referralInviter'),
        pieces: itemNumber(MEMBERSHIP_ARMOUR_SLOTS.length),
        percent: itemNumber((MEMBERSHIP_XP_MULTIPLIER - 1) * 100),
      }),
    ) +
    (referral
      ? line(
          t(
            referralInviterName
              ? 'itemUi.tooltip.referralRetained'
              : 'itemUi.tooltip.referralDormant',
          ),
          referralInviterName ? 'tt-sub' : 'tt-red',
        )
      : line(
          t(active ? 'itemUi.tooltip.membershipRequired' : 'itemUi.tooltip.membershipDormant'),
          active ? 'tt-sub' : 'tt-red',
        ))
  );
}

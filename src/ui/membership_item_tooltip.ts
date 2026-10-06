import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DURATION_SECONDS,
  MEMBERSHIP_TOKEN_ID,
  MEMBERSHIP_XP_MULTIPLIER,
} from '../sim/content/membership';
import {
  isMembershipArmour,
  membershipArmourItem,
  membershipItemLevel,
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
}

/** Resolve the same wearer-specific definition as combat, including dormancy. */
export function membershipTooltipItem(
  item: ItemDef,
  world: MembershipTooltipWorld,
  wearer?: MembershipTooltipWearer,
): ItemDef {
  return membershipArmourItem(
    item,
    (wearer?.templateId ?? world.cfg.playerClass) as PlayerClass,
    wearer ? (wearer.specId ?? null) : world.talentSpec,
    wearer?.level ?? world.player.level,
    (wearer ?? world.player).membershipActive === true,
  );
}

/** Dormant armour grants no enchant, quality, or other per-copy stat benefits. */
export function membershipTooltipInstance(
  item: ItemDef,
  instance: ItemInstancePayload | undefined,
  active: boolean,
): ItemInstancePayload | undefined {
  return isMembershipArmour(item.id) && !active ? undefined : instance;
}

export function membershipTooltipEquipment(
  world: MembershipTooltipWorld & Pick<IWorld, 'equipment' | 'equipmentInstances'>,
): { equipment: IWorld['equipment']; instances: IWorld['equipmentInstances'] } {
  const instances = { ...world.equipmentInstances };
  if (world.player.membershipActive !== true) {
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
      if (isMembershipArmour(world.equipment[slot] ?? '')) delete instances[slot];
    }
  }
  return { equipment: world.equipment, instances };
}

export function membershipItemTooltipLines(item: ItemDef, level: number, active: boolean): string {
  if (item.id === MEMBERSHIP_TOKEN_ID) {
    return `<div class="tt-desc">${esc(
      t('itemUi.tooltip.membershipToken', {
        days: itemNumber(MEMBERSHIP_DURATION_SECONDS / 86400),
      }),
    )}</div>`;
  }
  if (!isMembershipArmour(item.id)) return '';
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
      t('itemUi.tooltip.membershipFullSet', {
        pieces: itemNumber(MEMBERSHIP_ARMOUR_SLOTS.length),
        percent: itemNumber((MEMBERSHIP_XP_MULTIPLIER - 1) * 100),
      }),
    ) +
    line(
      t(active ? 'itemUi.tooltip.membershipRequired' : 'itemUi.tooltip.membershipDormant'),
      active ? 'tt-sub' : 'tt-red',
    )
  );
}

import { isTemporaryNecromancyUndeadTemplateId } from '../content/necromancy';

export const NECROMANCY_DOMINION_CAP = 2;

export const NECROMANCY_DOMINION_TEMPLATE_IDS = [
  'necromancy_skeletal_warrior',
  'necromancy_bone_mage',
  'necromancy_gravewing',
] as const;

export type NecromancyDominionTemplateId = (typeof NECROMANCY_DOMINION_TEMPLATE_IDS)[number];

export interface DominionServant {
  templateId: string;
  dead?: boolean;
}

export interface OwnedDominionServant extends DominionServant {
  ownerId?: number | null;
}

export interface CorpseExplosionServant extends DominionServant {
  id: number;
  hp: number;
  maxHp: number;
  despawnTimer?: number;
}

export type DominionSummonBlock = 'duplicate' | 'full' | null;

export function isDominionTemplateId(
  templateId: string,
): templateId is NecromancyDominionTemplateId {
  return isTemporaryNecromancyUndeadTemplateId(templateId);
}

export function livingDominionServants(servants: readonly DominionServant[]): DominionServant[] {
  return servants.filter((servant) => !servant.dead && isDominionTemplateId(servant.templateId));
}

export function selectCorpseExplosionServant<T extends CorpseExplosionServant>(
  servants: readonly T[],
): T | null {
  const eligible = servants.filter(
    (servant) => !servant.dead && isDominionTemplateId(servant.templateId),
  );
  eligible.sort((a, b) => {
    const priority = (servant: CorpseExplosionServant): number => {
      if (servant.templateId === 'necromancy_bone_mage') return 0;
      if (servant.templateId === 'necromancy_skeletal_warrior') return 1;
      return 2;
    };
    const priorityDifference = priority(a) - priority(b);
    if (priorityDifference !== 0) return priorityDifference;
    const aTimer = Number.isFinite(a.despawnTimer)
      ? (a.despawnTimer ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
    const bTimer = Number.isFinite(b.despawnTimer)
      ? (b.despawnTimer ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
    const aHealth = a.maxHp > 0 ? a.hp / a.maxHp : 0;
    const bHealth = b.maxHp > 0 ? b.hp / b.maxHp : 0;
    if (aTimer !== bTimer) return aTimer - bTimer;
    return aHealth - bHealth || a.id - b.id;
  });
  return eligible[0] ?? null;
}

export function dominionSummonBlock(
  servants: readonly DominionServant[],
  templateId: string,
): DominionSummonBlock {
  if (!isDominionTemplateId(templateId)) return null;
  const living = livingDominionServants(servants);
  if (living.some((servant) => servant.templateId === templateId)) return 'duplicate';
  return living.length >= NECROMANCY_DOMINION_CAP ? 'full' : null;
}

export function dominionSummonBlockForOwner(
  servants: Iterable<OwnedDominionServant>,
  ownerId: number,
  templateId: string,
): DominionSummonBlock {
  return dominionSummonBlockFromMask(
    dominionCompositionMaskForOwner(servants, ownerId),
    templateId,
  );
}

function dominionTemplateBit(templateId: string): number {
  switch (templateId) {
    case 'necromancy_skeletal_warrior':
      return 1;
    case 'necromancy_bone_mage':
      return 2;
    case 'necromancy_gravewing':
      return 4;
    default:
      return 0;
  }
}

export function dominionCompositionMaskForOwner(
  servants: Iterable<OwnedDominionServant>,
  ownerId: number,
): number {
  let mask = 0;
  for (const servant of servants) {
    if (servant.ownerId !== ownerId || servant.dead || !isDominionTemplateId(servant.templateId)) {
      continue;
    }
    mask |= dominionTemplateBit(servant.templateId);
  }
  return mask;
}

export function dominionSummonBlockFromMask(
  compositionMask: number,
  templateId: string,
): DominionSummonBlock {
  const requestedBit = dominionTemplateBit(templateId);
  if (requestedBit === 0) return null;
  if ((compositionMask & requestedBit) !== 0) return 'duplicate';
  const living =
    (compositionMask & 1) + ((compositionMask >> 1) & 1) + ((compositionMask >> 2) & 1);
  return living >= NECROMANCY_DOMINION_CAP ? 'full' : null;
}

const DOMINION_ABILITY_TEMPLATES: Readonly<Record<string, NecromancyDominionTemplateId>> = {
  raise_skeletal_warrior: 'necromancy_skeletal_warrior',
  raise_bone_mage: 'necromancy_bone_mage',
  raise_gravewing: 'necromancy_gravewing',
};

export function dominionTemplateForAbility(abilityId: string): NecromancyDominionTemplateId | null {
  return DOMINION_ABILITY_TEMPLATES[abilityId] ?? null;
}

export function missingDominionTemplates(
  servants: readonly DominionServant[],
): NecromancyDominionTemplateId[] {
  const active = new Set(livingDominionServants(servants).map((servant) => servant.templateId));
  return NECROMANCY_DOMINION_TEMPLATE_IDS.filter((templateId) => !active.has(templateId));
}

// Pure view-core for the gathering source-info detail (Intentional Gathering
// PR5): given the sim's MaterialSourceInfo for one material, decide WHICH
// facts a short detail block shows, capped so a long carrier/zone list never
// grows the block without bound. DOM/i18n-free: the painter
// (gathering_source_painter.ts) resolves creature/zone/material names and
// paints from this model. Decides no yield and invents no location; every id
// and number here came from the sim module unchanged.

import type {
  MaterialSourceInfo,
  NodeZoneSource,
} from '../../../sim/professions/gathering_source_locations';

/** How many creatures/zones to show before collapsing the rest into an
 *  honest "and N more" count. */
const MAX_VISIBLE = 3;

export interface GatheringSourceExampleModel {
  readonly mobId: string;
  readonly zoneId: string;
  readonly rare: boolean;
  readonly elite: boolean;
  readonly questGated: boolean;
}

export interface GatheringSourceCorpseView {
  readonly kind: 'corpse';
  readonly examples: readonly GatheringSourceExampleModel[];
  readonly remainingCount: number;
  /** Same-tag premium specimen item ids (usually zero or one); never a
   *  prediction about any one unrolled corpse. Always empty when this view
   *  is for a specimen's own entry (see `conditionalOnBaseItemId`). */
  readonly premiumSpecimenItemIds: readonly string[];
  /** Present only when this material IS a specimen: the base material item
   *  id it is a rare-or-better bonus roll of, reached from the SAME
   *  carriers listed above. Null for an ordinary base material. */
  readonly conditionalOnBaseItemId: string | null;
}

export interface GatheringSourceNodeZoneModel {
  readonly zoneId: string;
  readonly minimumNodeTier: number;
}

export interface GatheringSourceNodeView {
  readonly kind: 'node';
  readonly zones: readonly GatheringSourceNodeZoneModel[];
  readonly remainingZoneCount: number;
  readonly isFineGrade: boolean;
  /** Present only when isFineGrade: the minimum TOOL tier that actually
   *  upgrades the harvest (fineGatherTier + 1, strictly above), not the
   *  gatherTier itself. */
  readonly minimumFineToolTier: number | null;
}

export interface GatheringSourceFarmView {
  readonly kind: 'farm';
  readonly zoneIds: readonly string[];
  readonly remainingZoneCount: number;
  readonly isFineGrade: boolean;
  readonly growDurationMs: number;
  readonly minimumFarmingSkill: number;
  readonly requiredHoeTier: number;
}

export interface GatheringSourceFishingZoneModel {
  readonly zoneId: string;
  readonly minimumProficiency: number;
  readonly minimumRodTier: number;
  readonly provenLocation: boolean;
}

export interface GatheringSourceFishingView {
  readonly kind: 'fishing';
  readonly zones: readonly GatheringSourceFishingZoneModel[];
  readonly remainingZoneCount: number;
}

export interface GatheringSourceUnknownView {
  readonly kind: 'unknown';
}

export type GatheringSourceViewModel =
  | GatheringSourceCorpseView
  | GatheringSourceNodeView
  | GatheringSourceFarmView
  | GatheringSourceFishingView
  | GatheringSourceUnknownView;

function capZones<T>(zones: readonly T[]): { visible: readonly T[]; remaining: number } {
  const visible = zones.slice(0, MAX_VISIBLE);
  return { visible, remaining: Math.max(0, zones.length - visible.length) };
}

/** Builds the capped display model for one material's source info. A material
 *  no shipped family produces (`kind: 'unknown'`) yields the unknown view,
 *  which the painter renders as nothing rather than an invented source. */
export function buildGatheringSourceView(info: MaterialSourceInfo): GatheringSourceViewModel {
  switch (info.kind) {
    case 'corpse': {
      const { visible, remaining } = capZones(info.examples);
      return {
        kind: 'corpse',
        examples: visible.map((example) => ({
          mobId: example.mobId,
          zoneId: example.zoneId,
          rare: example.rare,
          elite: example.elite,
          questGated: example.questGated,
        })),
        remainingCount: remaining,
        premiumSpecimenItemIds: info.premiumSpecimenItemIds,
        conditionalOnBaseItemId: info.conditionalOnBaseItemId ?? null,
      };
    }
    case 'node': {
      const { visible, remaining } = capZones(info.zones);
      return {
        kind: 'node',
        zones: visible.map((zone: NodeZoneSource) => ({
          zoneId: zone.zoneId,
          minimumNodeTier: zone.minimumNodeTier,
        })),
        remainingZoneCount: remaining,
        isFineGrade: info.isFineGrade,
        minimumFineToolTier:
          info.isFineGrade && info.fineGatherTier !== undefined ? info.fineGatherTier + 1 : null,
      };
    }
    case 'farm': {
      const { visible, remaining } = capZones(info.zoneIds);
      return {
        kind: 'farm',
        zoneIds: visible,
        remainingZoneCount: remaining,
        isFineGrade: info.isFineGrade,
        growDurationMs: info.growDurationMs,
        minimumFarmingSkill: info.minimumFarmingSkill,
        requiredHoeTier: info.requiredHoeTier,
      };
    }
    case 'fishing': {
      const { visible, remaining } = capZones(info.zones);
      return {
        kind: 'fishing',
        zones: visible.map((zone) => ({
          zoneId: zone.zoneId,
          minimumProficiency: zone.minimumProficiency,
          minimumRodTier: zone.minimumRodTier,
          provenLocation: zone.provenLocation,
        })),
        remainingZoneCount: remaining,
      };
    }
    default:
      return { kind: 'unknown' };
  }
}

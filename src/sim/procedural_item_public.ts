import {
  cloneRolledAffix,
  type GeneratedItemName,
  type ProceduralItemInstance,
  type ProceduralRarity,
  type RolledAffix,
} from './procedural_item';
import type { ItemInstancePayload } from './types';

export interface PublicProceduralItemView {
  version: 1;
  baseId: string;
  itemLevel: number;
  rarity: ProceduralRarity;
  affixes: RolledAffix[];
  implicits?: RolledAffix[];
  legendaryPowerId?: string;
  powerRevision?: number;
  legendaryRolls?: Record<string, number>;
  generatedName: GeneratedItemName;
}

export interface PublicItemInstanceView {
  signer?: string;
  rolled?: {
    quality?: string;
    stats?: Record<string, number>;
    masterwork?: boolean;
  };
  enchant?: string;
  /** Transfer-visible binding arm. The recipient must know the copy will bind. */
  bindOnTrade?: boolean;
  procedural?: PublicProceduralItemView;
}

export function publicProceduralItemView(item: ProceduralItemInstance): PublicProceduralItemView {
  return {
    version: 1,
    baseId: item.baseId,
    itemLevel: item.itemLevel,
    rarity: item.rarity,
    affixes: item.affixes.map(cloneRolledAffix),
    ...(item.implicits && { implicits: item.implicits.map(cloneRolledAffix) }),
    ...(item.legendaryPowerId && {
      legendaryPowerId: item.legendaryPowerId,
    }),
    ...(item.powerRevision !== undefined && {
      powerRevision: item.powerRevision,
    }),
    ...(item.legendaryRolls && {
      legendaryRolls: { ...item.legendaryRolls },
    }),
    generatedName: {
      ...item.generatedName,
      ...(item.generatedName.rareWordIds && {
        rareWordIds: [...item.generatedName.rareWordIds] as [string, string],
      }),
    },
  };
}

export function publicItemInstanceView(payload: ItemInstancePayload): PublicItemInstanceView {
  return {
    ...(payload.signer && { signer: payload.signer }),
    ...(payload.rolled && {
      rolled: {
        ...payload.rolled,
        ...(payload.rolled.stats && { stats: { ...payload.rolled.stats } }),
      },
    }),
    ...(payload.enchant && { enchant: payload.enchant }),
    ...(payload.bindOnTrade === true && { bindOnTrade: true }),
    ...(payload.procedural && {
      procedural: publicProceduralItemView(payload.procedural),
    }),
  };
}

/**
 * Owner-only wire projection. It retains the opaque procedural UID needed to
 * edit an exact staged offer while sharing the same seed/provenance redaction
 * as the public projection. Never send this view to another player.
 */
export function ownerItemInstanceView(payload: ItemInstancePayload): ItemInstancePayload {
  const view = publicItemInstanceView(payload);
  return {
    ...view,
    ...(payload.procedural &&
      view.procedural && {
        procedural: {
          ...view.procedural,
          uid: payload.procedural.uid,
        },
      }),
  } as ItemInstancePayload;
}

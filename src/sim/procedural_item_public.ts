import {
  cloneRolledAffix,
  type GeneratedItemName,
  type ProceduralItemDefinitionRevision,
  type ProceduralItemInstance,
  type ProceduralRarity,
  type RolledAffix,
} from './procedural_item';
import { cloneItemInstancePayload, type InvSlot, type ItemInstancePayload } from './types';

export interface PublicProceduralItemView {
  version: 1;
  definitionRevision?: ProceduralItemDefinitionRevision;
  baseId: string;
  itemLevel: number;
  rarity: ProceduralRarity;
  affixes: RolledAffix[];
  implicits?: RolledAffix[];
  legendaryPowerId?: string;
  powerRevision?: number;
  legendaryRolls?: Record<string, number>;
  raidForged?: true;
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
    ...(item.definitionRevision !== undefined && {
      definitionRevision: item.definitionRevision,
    }),
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
    ...(item.raidForged && {
      raidForged: true,
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
  const view = cloneItemInstancePayload(payload);
  if (payload.procedural) {
    view.procedural = {
      ...publicProceduralItemView(payload.procedural),
      uid: payload.procedural.uid,
    } as ProceduralItemInstance;
  }
  return view;
}

/** Owner-only inventory/bank projection that also preserves cell ordering. */
export function ownerInvSlotView(slot: InvSlot): InvSlot {
  return {
    ...slot,
    ...(slot.instance && { instance: ownerItemInstanceView(slot.instance) }),
  };
}

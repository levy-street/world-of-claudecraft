export type ItemIconMapping = {
  entries?: readonly { itemId?: unknown }[];
  generatedBatches?: readonly { itemIds?: readonly unknown[] }[];
};

export type ItemIconMasterInspection = {
  width: number;
  height: number;
  space: 'srgb';
};

export declare const ITEM_ICON_MASTER_MIN_SIZE: 512;

export declare function itemIconOwnershipIndex(mapping: ItemIconMapping): Map<string, string[]>;

export declare function assertExactlyOneItemIconOwner(
  itemId: string,
  owners: ReadonlyMap<string, readonly string[]>,
): void;

export declare function inspectItemIconMaster(source: string): Promise<ItemIconMasterInspection>;

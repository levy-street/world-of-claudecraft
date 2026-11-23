export interface LootNodeContract {
  readonly name: string;
  readonly parent: string;
  readonly mesh: boolean;
  readonly maxTriangles?: number;
}
export interface LootAssetContract {
  readonly file: string;
  readonly rawName: string;
  readonly reportTag: string;
  readonly root: string;
  readonly assetId: string;
  readonly blenderVersion: string;
  readonly maxBytes: number;
  readonly maxTriangles: number;
  readonly materials: readonly string[];
  readonly glowMaterials: readonly string[];
  readonly nodes: readonly LootNodeContract[];
  readonly anchors: Readonly<Record<string, readonly number[]>>;
  readonly bounds: {
    readonly min: readonly number[];
    readonly max: readonly number[];
    readonly tolerance: number;
  };
}
export const GUTTERED_EYE: LootAssetContract;

// Types for armor_atlas.mjs (the build's per-set texture atlas; tests read ATLAS_SIZES).
export declare const ATLAS_SIZES: Readonly<
  Record<'low' | 'full', Readonly<Record<string, [number, number]>>>
>;
export declare function atlasArmorSet(
  doc: unknown,
  tier: 'low' | 'full',
  masterFor: (texture: unknown, material: unknown, slot: string) => Uint8Array | Buffer | null,
): Promise<unknown>;

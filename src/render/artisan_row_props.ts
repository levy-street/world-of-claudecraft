// Legacy Artisan Row assets remain in the shipped model inventory because the
// crafting-station renderer reuses several of them. The old ten fixed
// Eastbrook placements and their preload/build path were removed by the civic
// rebuild; this module now owns metadata only for asset-manifest tests.

type ArtisanPropKind =
  | 'engineering_workbench'
  | 'alchemy_cauldron'
  | 'cooking_spit'
  | 'leatherworking_rack'
  | 'tailoring_loom'
  | 'inscription_lectern'
  | 'enchanting_altar'
  | 'jewelcrafting_bench'
  | 'mining_ore_cart'
  | 'herbalism_drying_rack';

const ARTISAN_ASSET_URL: Record<ArtisanPropKind, string> = {
  engineering_workbench: '/models/props/engineering_workbench.glb',
  alchemy_cauldron: '/models/props/alchemy_cauldron.glb',
  cooking_spit: '/models/props/cooking_spit.glb',
  leatherworking_rack: '/models/props/leatherworking_rack.glb',
  tailoring_loom: '/models/props/tailoring_loom.glb',
  inscription_lectern: '/models/props/inscription_lectern.glb',
  enchanting_altar: '/models/props/enchanting_altar.glb',
  jewelcrafting_bench: '/models/props/jewelcrafting_bench.glb',
  mining_ore_cart: '/models/props/mining_ore_cart.glb',
  herbalism_drying_rack: '/models/props/herbalism_drying_rack.glb',
};

const ARTISAN_TARGET_HEIGHT: Record<ArtisanPropKind, number> = {
  engineering_workbench: 1,
  alchemy_cauldron: 0.9,
  cooking_spit: 0.85,
  leatherworking_rack: 1.5,
  tailoring_loom: 1.3,
  inscription_lectern: 1.1,
  enchanting_altar: 1,
  jewelcrafting_bench: 0.9,
  mining_ore_cart: 1.1,
  herbalism_drying_rack: 1.4,
};

/** Test-only model-inventory metadata; this module performs no runtime preload. */
export const artisanRowPreloadInternalsForTest = {
  assetUrl: ARTISAN_ASSET_URL,
  targetHeight: ARTISAN_TARGET_HEIGHT,
};

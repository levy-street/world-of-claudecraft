// Approved world-space Placer export. Both simulation pickups and their models
// consume these transforms so moving a visual cannot leave its interaction behind.
// Rotation is the Placer's yaw in degrees; scale multiplies the imported GLB.
export const FARSHORE_SHIPWRECK_PLACEMENT = {
  key: 'wq_shipwreck',
  x: 306,
  y: -4.75,
  z: 123.05,
  rot: 90,
  scale: 14,
} as const;

export const FARSHORE_HULL_FRAGMENT_PLACEMENT = {
  key: 'wq_hull_fragment',
  x: 302.7,
  y: -6,
  z: 117.75,
  rot: 330,
  scale: 6,
} as const;

export const FARSHORE_SALVAGE_PLACEMENTS = [
  { key: 'wq_waterlogged_barrel', x: 326.2, y: -4.5, z: 140.6, rot: 105, scale: 2 },
  { key: 'wq_damaged_crate', x: 344, y: -4.5, z: 144.7, rot: 270, scale: 1.5 },
  { key: 'wq_broken_planks', x: 369.9, y: -4, z: 136.3, rot: 270, scale: 2 },
  { key: 'wq_damaged_crate', x: 322.1, y: 0, z: 108.2, rot: 135, scale: 1.5 },
  { key: 'wq_damaged_crate', x: 324.1, y: 0, z: 108.2, rot: 15, scale: 1 },
  { key: 'wq_capsized_rowboat', x: 387.1, y: -4, z: 126.5, rot: 330, scale: 5 },
  { key: 'wq_damaged_crate', x: 381.6, y: -3, z: 126, rot: 45, scale: 1.5 },
  { key: 'wq_waterlogged_barrel', x: 342.2, y: -4.5, z: 126.7, rot: 75, scale: 2 },
  { key: 'wq_fallen_anchor', x: 320.6, y: -4.25, z: 130.05, rot: 345, scale: 2 },
  { key: 'wq_damaged_crate', x: 366.1, y: -2.25, z: 112.5, rot: 90, scale: 1.5 },
  { key: 'wq_broken_planks', x: 392.5, y: -4.5, z: 125.3, rot: 270, scale: 2 },
] as const;

export const FARSHORE_SALVAGE_VISUAL_KEYS = [
  'wq_broken_planks',
  'wq_waterlogged_barrel',
  'wq_damaged_crate',
  'wq_fallen_anchor',
  'wq_hull_fragment', // Reserved slot: the hull is now permanent scenery.
  'wq_capsized_rowboat',
] as const;

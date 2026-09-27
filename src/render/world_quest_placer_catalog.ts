// Shared shipwreck assets; the scale here is only the placer's starting size.
export const WORLD_QUEST_PLACER_ASSETS = {
  wq_shipwreck: { label: 'Shipwreck', file: 'shipwreck', scale: 26 },
  wq_broken_planks: { label: 'Broken planks', file: 'broken_planks', scale: 2 },
  wq_waterlogged_barrel: { label: 'Waterlogged barrel', file: 'waterlogged_barrel', scale: 1.5 },
  wq_damaged_crate: { label: 'Damaged crate', file: 'damaged_crate', scale: 1.5 },
  wq_fallen_anchor: { label: 'Fallen anchor', file: 'fallen_anchor', scale: 2 },
  wq_hull_fragment: { label: 'Hull fragment', file: 'hull_fragment', scale: 3 },
  wq_capsized_rowboat: { label: 'Capsized rowboat', file: 'capsized_rowboat', scale: 5 },
} as const;

export type WorldQuestPlacerKey = keyof typeof WORLD_QUEST_PLACER_ASSETS;
export const WORLD_QUEST_PLACER_KEYS = Object.keys(
  WORLD_QUEST_PLACER_ASSETS,
) as WorldQuestPlacerKey[];

export function isWorldQuestPlacerKey(key: string): key is WorldQuestPlacerKey {
  return Object.hasOwn(WORLD_QUEST_PLACER_ASSETS, key);
}

export function worldQuestPlacerUrl(key: WorldQuestPlacerKey): string {
  return `/models/world_quests/shipwreck/${WORLD_QUEST_PLACER_ASSETS[key].file}.glb`;
}

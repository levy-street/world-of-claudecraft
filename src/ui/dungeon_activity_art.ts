const SCENES: Readonly<Record<string, string>> = {
  hollow_crypt: '/textures/loading/hollow-crypt-empty.webp',
  sunken_bastion: '/ui/dungeon-scenes/sunken-bastion.webp',
  drowned_temple: '/ui/dungeon-scenes/drowned-temple.webp',
  gravewyrm_sanctum: '/ui/dungeon-scenes/gravewyrm-sanctum.webp',
  wildheart_basin: '/ui/dungeon-scenes/wildheart-basin.webp',
  nythraxis_crypt: '/textures/loading/hollow-crypt-empty.webp',
  nythraxis_boss_arena: '/textures/loading/thornpeak-storm.webp',
  ignivar_raid_arena: '/textures/loading/drakemaw-caldera.webp',
};

/** Scenic card art, shared by both difficulties of an activity. */
export function activitySceneUrl(dungeonId: string): string {
  return Object.hasOwn(SCENES, dungeonId) ? SCENES[dungeonId] : '/ui/chrome/dfinder.webp';
}

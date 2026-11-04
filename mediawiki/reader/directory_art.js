// The same original HUD icons players use to reach these subjects in game.
export const DIRECTORY_ART = {
  Items: 'bags',
  Quests: 'questlog',
  Mobs: 'arena',
  Abilities: 'spellbook',
  'Gameplay Systems': 'crafting',
  Dungeons: 'dfinder',
  Zones: 'map',
  NPCs: 'social',
  Classes: 'character',
  Specializations: 'talents',
  'Talent choices': 'perfecting',
  'All Pages': 'book',
};
export function directoryArt(title) {
  return Object.hasOwn(DIRECTORY_ART, title) ? '/ui/chrome/' + DIRECTORY_ART[title] + '.webp' : '';
}

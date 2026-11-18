import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDDIES } from '../../src/sim/content/buddies';
import { ROW_TREES, TALENTS } from '../../src/sim/content/talents';
import { WEEKLY_EMISSARY_NPC_DEF, WEEKLY_QUESTS } from '../../src/sim/content/weekly_quests';
import { WORLD_QUESTS } from '../../src/sim/content/world_quests';
import { ALL_RECIPES, QUESTS } from '../../src/sim/data';
import { worldQuestScoreboardForQuest } from '../../src/sim/world_quest_scoreboards';
import { classIconUrl } from '../../src/ui/class_icon_art';
import { crestIconUrl } from '../../src/ui/crest_icon_art';
import { currencyImageUrl } from '../../src/ui/currency_art';
import { activitySceneUrl } from '../../src/ui/dungeon_activity_art';
import { deedImageUrl, itemImageUrl, weaponIconUrl } from '../../src/ui/icons';
import { BAKED_MAP_BG } from '../../src/ui/map_bg_manifest.generated';
import { mapMarkerIconUrl, questMarkerArtId } from '../../src/ui/map_marker_icon_art';
import { specIconUrl } from '../../src/ui/spec_icon_art';
import { talentRowOptionIconRef } from '../../src/ui/talent_icons';
import { BUDDY_PORTRAIT_URLS, targetPortraitUrl } from '../../src/ui/target_portrait_view';
import { WEEKLY_ART_DIR } from '../../src/ui/weekly_quests_view';
import { worldQuestBoardArt } from '../../src/ui/world_quest_leaderboard_view';

import { wikiAbilityArtPath } from './ability_art_path';

type TitleMaps = Partial<
  Record<
    | 'class'
    | 'ability'
    | 'item'
    | 'zone'
    | 'mob'
    | 'npc'
    | 'quest'
    | 'dungeon'
    | 'spec'
    | 'talent'
    | 'worldQuest'
    | 'weekly'
    | 'recipe'
    | 'deed'
    | 'companion',
    ReadonlyMap<string, string>
  >
>;

// Mirrors the HUD's static item branch, including heroic weapon inheritance.
// Never invoke the fallback canvas renderer from the Node seed generator.
const paintedItem = (id: string) => currencyImageUrl(id) ?? weaponIconUrl(id) ?? itemImageUrl(id);

/** The packaged icon for an item, or '' when the game paints it at run time. */
export function itemArtPath(id: string): string {
  const path = paintedItem(id);
  return path &&
    /^\/ui\/[A-Za-z0-9_/-]+\.webp$/.test(path) &&
    existsSync(join('public', path.slice(1)))
    ? path
    : '';
}

/** The icon a talent row option shows in the game's talent window, or '' when none ships. */
export function talentArtPath(option: Parameters<typeof talentRowOptionIconRef>[0]): string {
  const art = talentRowOptionIconRef(option);
  const path =
    art.kind === 'image'
      ? art.url
      : art.kind === 'ability'
        ? wikiAbilityArtPath(art.id)
        : crestIconUrl(art.id);
  return path &&
    /^\/ui\/[A-Za-z0-9_/-]+\.webp$/.test(path) &&
    existsSync(join('public', path.slice(1)))
    ? path
    : '';
}

/** The packaged portrait for a creature, or '' when it has none. */
export function mobArtPath(id: string): string {
  const path = targetPortraitUrl(id, true);
  return path &&
    /^\/ui\/[A-Za-z0-9_/-]+\.webp$/.test(path) &&
    existsSync(join('public', path.slice(1)))
    ? path
    : '';
}

/** Large renders of each creature's and NPC's model, written by
 *  scripts/mediawiki/render_entity_stills.mjs, plus the NPCs and creatures on character
 *  bodies that scripts/wiki/render_character_stills.mjs draws with the game's own renderer
 *  (their authored faces, hair and props). A class page shows the Guide's figure of that
 *  class, and a quest page the portrait of the character who gives it. Keyed by page title. */
export function modelStills(titleBy: TitleMaps): Map<string, string> {
  const read = (file: string): Record<string, string> =>
    existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const stills = {
    ...read(join('scripts', 'mediawiki', 'entity_stills.json')),
    ...read(join('scripts', 'mediawiki', 'entity_stills_characters.json')),
  };
  const byTitle = new Map<string, string>();
  const add = (title: string | undefined, path: string | undefined) => {
    if (
      title &&
      path &&
      /^\/(?:encyclopedia|guide)-stills\/[\w.-]+\.webp$/.test(path) &&
      existsSync(join('public', path.slice(1)))
    )
      byTitle.set(title, path);
  };
  for (const kind of ['mob', 'npc'] as const)
    for (const [id, title] of titleBy[kind] ?? []) add(title, stills[kind + '/' + id]);
  for (const [id, title] of titleBy.class ?? []) add(title, '/guide-stills/player_' + id + '.webp');
  for (const [id, title] of titleBy.quest ?? []) {
    const giver = QUESTS[id]?.giverNpcId;
    if (giver) add(title, stills['npc/' + giver] ?? stills['mob/' + giver]);
  }
  return byTitle;
}

export function articleArt(titleBy: TitleMaps): Map<string, string> {
  const byTitle = new Map<string, string>();
  const files = new Map<string, boolean>();
  const add = (kind: keyof TitleMaps, id: string, path: string | null | undefined) => {
    const title = titleBy[kind]?.get(id);
    if (
      !title ||
      !path ||
      !/^\/(?:ui|textures|map_bg)\/[a-z0-9_./-]+\.webp$/i.test(path) ||
      path.includes('..')
    )
      return;
    if (!files.has(path)) files.set(path, existsSync(join('public', path.slice(1))));
    if (files.get(path)) byTitle.set(title, path);
  };
  for (const id of titleBy.item?.keys() ?? []) add('item', id, paintedItem(id));
  for (const id of titleBy.ability?.keys() ?? []) add('ability', id, wikiAbilityArtPath(id));
  for (const id of titleBy.class?.keys() ?? []) add('class', id, classIconUrl(id));
  for (const id of titleBy.mob?.keys() ?? []) add('mob', id, targetPortraitUrl(id, true));
  for (const id of titleBy.zone?.keys() ?? []) {
    if (Object.hasOwn(BAKED_MAP_BG.zones, id)) add('zone', id, '/map_bg/' + id + '.webp');
  }
  for (const id of titleBy.dungeon?.keys() ?? []) add('dungeon', id, activitySceneUrl(id));
  // NPC faces are normally captured from the live model. The status crest is
  // the game's own static NPC identity; a monster sharing a name is not its portrait.
  for (const id of titleBy.npc?.keys() ?? [])
    add(
      'npc',
      id,
      id === WEEKLY_EMISSARY_NPC_DEF.id
        ? '/' + WEEKLY_ART_DIR + '/emissary.webp'
        : crestIconUrl('status_npc'),
    );
  for (const q of Object.values(QUESTS)) {
    // Keep the quest icon neutral when rewards depend on the character's class.
    const rewards = [...new Set([...Object.values(q.itemRewards), ...(q.choiceRewards ?? [])])];
    const singleReward = rewards.length === 1 ? paintedItem(rewards[0]) : null;
    add(
      'quest',
      q.id,
      singleReward ?? mapMarkerIconUrl(questMarkerArtId(q.repeatable ? 'repeat' : 'available')),
    );
  }
  for (const cls of Object.values(TALENTS)) {
    for (const spec of cls.specs) add('spec', cls.class + '/' + spec.id, specIconUrl(spec));
    for (const row of ROW_TREES[cls.class])
      for (const option of row.options) {
        add('talent', cls.class + '/' + option.id, talentArtPath(option));
      }
  }
  for (const quest of WORLD_QUESTS) {
    const board = worldQuestScoreboardForQuest(quest.id);
    const art = board ? worldQuestBoardArt(board.id) : mapMarkerIconUrl(questMarkerArtId('repeat'));
    add('worldQuest', quest.id, art);
  }
  for (const quest of WEEKLY_QUESTS)
    add('weekly', quest.id, '/' + WEEKLY_ART_DIR + '/' + quest.kind + '.webp');
  for (const recipe of ALL_RECIPES) add('recipe', recipe.id, paintedItem(recipe.resultItemId));
  for (const id of titleBy.deed?.keys() ?? []) add('deed', id, deedImageUrl('deed_' + id));
  for (const buddy of Object.values(BUDDIES))
    add('companion', buddy.key, BUDDY_PORTRAIT_URLS[buddy.key]);
  return byTitle;
}

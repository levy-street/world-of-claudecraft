import { activitySceneUrl } from '../../dungeon_activity_art';

/** Shared panoramic art for listing, recruitment and creation backgrounds. */
export function expeditionImageUrl(dungeonId: string): string {
  return activitySceneUrl(dungeonId);
}

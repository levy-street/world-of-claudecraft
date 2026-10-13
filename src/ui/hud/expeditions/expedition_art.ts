import { classIconUrl } from '../../class_icon_art';
import { activitySceneUrl } from '../../dungeon_activity_art';
import { esc } from '../../esc';
import { svgIcon } from '../../ui_icons';

/** Shared panoramic art for listing, recruitment and creation backgrounds. */
export function expeditionImageUrl(dungeonId: string): string {
  return activitySceneUrl(dungeonId);
}

export function expeditionHero(dungeonId: string, title: string, subtitle: string): string {
  return `<div class="expedition-hero"><img class="expedition-hero-art" src="${esc(expeditionImageUrl(dungeonId))}" alt="" decoding="async" draggable="false"><div class="expedition-hero-shade"></div><div class="expedition-hero-copy"><p>${subtitle}</p><h3>${title}</h3></div></div>`;
}

export function expeditionClassEmblem(cls: string): string {
  const url = classIconUrl(cls);
  return `<span class="ui-portrait-wrap expedition-emblem"><span class="ui-portrait">${url ? `<img src="${esc(url)}" alt="" decoding="async" draggable="false">` : svgIcon('character')}</span></span>`;
}

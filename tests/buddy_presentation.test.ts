import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDDIES, BUDDY_KEYS } from '../src/sim/content/buddies';
import type { Entity } from '../src/sim/types';
import { mobDisplayName, mobHoverIdentity } from '../src/ui/entity_display_core';
import * as entityI18n from '../src/ui/entity_i18n';
import { buddyCosmeticsHtml } from '../src/ui/hud/cosmetics/buddy_cosmetics_view';
import { type MobTooltipModel, mobTooltipHtml } from '../src/ui/mob_tooltip_view';
import { BUDDY_PORTRAIT_URLS, targetPortraitUrl } from '../src/ui/target_portrait_view';

afterEach(() => vi.restoreAllMocks());

function buddy(templateId: string, name: string): Entity {
  return { kind: 'mob', templateId, name, ownerId: 7 } as Entity;
}

function tooltip(entity: Entity): string {
  const model: MobTooltipModel = {
    ...mobHoverIdentity(entity),
    level: 1,
    familyLabel: 'Elementals',
    color: '#ffffff',
    hostile: false,
    rank: 'normal',
    quests: [],
  };
  return mobTooltipHtml(model, { t: (key) => key, fmt: String });
}

describe('buddy portraits shared by Cosmetics and target frames', () => {
  it('uses the same model headshot for each buddy on both surfaces', () => {
    expect(BUDDY_PORTRAIT_URLS).toEqual({
      horse: '/ui/portraits/buddy_horse.webp',
      crystal_lich: '/ui/portraits/buddy_crystal_lich.webp',
      forgemaw: '/ui/portraits/buddy_forgemaw.webp',
    });
    const html = buddyCosmeticsHtml({ owned: BUDDY_KEYS, pending: [], active: 'horse' });
    for (const key of BUDDY_KEYS) {
      const targetUrl = targetPortraitUrl(`buddy_${key}`, true);
      expect(targetUrl).toBe(BUDDY_PORTRAIT_URLS[key]);
      expect(html).toContain(`src="${targetUrl}" alt="" aria-hidden="true" draggable="false"`);
    }
    expect(html.match(/class="cos-buddy-icon"/g)).toHaveLength(3);
    expect(html).not.toContain('/ui/items/whistle_');
  });

  it('does not treat an NPC or an unknown buddy id as a known buddy portrait', () => {
    expect(targetPortraitUrl('buddy_horse', false)).toBeNull();
    expect(targetPortraitUrl('buddy_unknown', true)).toBe('/ui/mobs/buddy_unknown.webp');
    expect(targetPortraitUrl('buddy_constructor', true)).toBe('/ui/mobs/buddy_constructor.webp');
    expect(targetPortraitUrl('forest_wolf', true)).toBe('/ui/mobs/forest_wolf.webp');
  });
});

describe('buddy hover identity', () => {
  it.each(BUDDY_KEYS)('shows a custom name followed by the original %s buddy type', (key) => {
    const entity = buddy(`buddy_${key}`, 'Sir Oats');
    expect(mobHoverIdentity(entity)).toEqual({ name: 'Sir Oats', buddyType: BUDDIES[key].name });
    const html = tooltip(entity);
    expect(html).toContain('>Sir Oats</div>');
    expect(html).toContain(`<div class="tt-sub">${BUDDIES[key].name}</div>`);
    expect(html.indexOf('Sir Oats')).toBeLessThan(html.indexOf(BUDDIES[key].name));
  });

  it.each(BUDDY_KEYS)('does not duplicate the original name for an unnamed %s', (key) => {
    const entity = buddy(`buddy_${key}`, BUDDIES[key].name);
    expect(mobHoverIdentity(entity)).toEqual({ name: BUDDIES[key].name, buddyType: undefined });
    expect(tooltip(entity).split(BUDDIES[key].name)).toHaveLength(2);
  });

  it('keeps custom names verbatim while resolving the localized original type', () => {
    // The shipped buddy names currently fall back to English in every locale.
    // Give the existing entity translation seam a distinct localized value so
    // this proves the identity resolver consumes it, without changing catalogs.
    const translate = vi.spyOn(entityI18n, 'tEntity').mockReturnValue('Liche de cristal');
    const identity = mobHoverIdentity(buddy('buddy_crystal_lich', 'Frost Nova'));
    expect(identity).toEqual({ name: 'Frost Nova', buddyType: 'Liche de cristal' });
    expect(translate).toHaveBeenCalledWith({
      kind: 'mob',
      id: 'buddy_crystal_lich',
      field: 'name',
    });
    expect(mobHoverIdentity(buddy('buddy_crystal_lich', BUDDIES.crystal_lich.name))).toEqual({
      name: 'Liche de cristal',
      buddyType: undefined,
    });
  });

  it('escapes a nickname supplied by the world before inserting tooltip markup', () => {
    const html = tooltip(buddy('buddy_forgemaw', '<img src=x>'));
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('Forgemaw The Molten');
  });

  it('preserves the existing template title for other mobs without a buddy-type row', () => {
    const identity = mobHoverIdentity(buddy('forest_wolf', 'Other name'));
    expect(identity).toEqual({ name: mobDisplayName('forest_wolf') });
  });
});

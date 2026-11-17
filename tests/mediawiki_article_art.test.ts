import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { articleArt, modelStills } from '../scripts/mediawiki/article_art';
import { ABILITIES, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { targetPortraitUrl } from '../src/ui/target_portrait_view';

describe('Encyclopedia game artwork', () => {
  it('preserves actual disambiguated titles and uses the playable game asset', () => {
    const art = articleArt({
      class: new Map([['mage', 'Mage']]),
      ability: new Map([['fireball', 'Fireball (Ability) (2)']]),
      item: new Map([['abyssal_loop', 'Abyssal Loop (2)']]),
      mob: new Map([['balgath_cyclops', 'Balgath (Mob)']]),
      npc: new Map([['weekly_emissary', 'Cham Pete (NPC)']]),
      spec: new Map([
        ['priest/holy', 'Priest Holy'],
        ['paladin/holy', 'Paladin Holy'],
      ]),
      dungeon: new Map([['hollow_crypt', 'The Hollow Crypt']]),
      worldQuest: new Map([['wq_evergarden_forging', 'Forge quest']]),
      weekly: new Map([['wk_raid', 'Raid weekly']]),
    });
    expect(art.get('Mage')).toBe('/ui/classes/mage.webp');
    expect(art.get('Fireball (Ability) (2)')).toBe('/ui/skills/mage/fireball.webp');
    expect(art.get('Abyssal Loop (2)')).toBe('/ui/items/abyssal_loop.webp');
    expect(art.get('Balgath (Mob)')).toBe('/ui/mobs/balgath_cyclops.webp');
    expect(art.get('Cham Pete (NPC)')).toBe('/ui/weekly/emissary.webp');
    expect(art.get('The Hollow Crypt')).toBe('/textures/loading/hollow-crypt-empty.webp');
    expect(art.get('Priest Holy')).toBeTruthy();
    expect(art.get('Paladin Holy')).not.toBe(art.get('Priest Holy'));
    expect(art.get('Forge quest')).toBe('/ui/world-quests/leaderboard/forge.webp');
    expect(art.get('Raid weekly')).toBe('/ui/weekly/raid.webp');
  });
  it('only references shipped files and resolves every mob portrait', () => {
    const map = (records: Record<string, unknown>, prefix: string) =>
      new Map(Object.keys(records).map((id) => [id, prefix + id]));
    const art = articleArt({
      mob: map(MOBS, 'mob/'),
      item: map(ITEMS, 'item/'),
      ability: map(ABILITIES, 'ability/'),
      zone: new Map([['unreleased', 'Unreleased']]),
    });
    expect(art.has('Unreleased')).toBe(false);
    for (const [id] of Object.entries(MOBS))
      expect(art.get('mob/' + id), id).toBe(targetPortraitUrl(id, true));
    for (const path of new Set(art.values()))
      expect(existsSync(join('public', path.slice(1))), path).toBe(true);
  });
  it('gives creature pages a shipped model render, never a borrowed character body', () => {
    const map = (records: Record<string, unknown>, prefix: string) =>
      new Map(Object.keys(records).map((id) => [id, prefix + id]));
    const models = modelStills({ mob: map(MOBS, 'mob/'), npc: map(NPCS, 'npc/') });
    expect(models.size).toBeGreaterThan(100);
    for (const [title, path] of models) {
      expect(path, title).toMatch(/^\/encyclopedia-stills\/[\w.-]+\.webp$/);
      expect(existsSync(join('public', path.slice(1))), path).toBe(true);
      // A player or NPC rig would draw a generic class body, not the creature.
      expect(path, title).not.toMatch(/\/(?:player|npc)_/);
    }
    // NPCs wear authored looks this renderer cannot draw, so they keep their icon.
    expect([...models.keys()].some((title) => title.startsWith('npc/'))).toBe(false);
    expect(models.get('mob/rift_boss_frost')).toBe(
      '/encyclopedia-stills/mob_hoard_hoarfrost_warden.webp',
    );
  });
});

describe('Encyclopedia reader model art', () => {
  it('lifts the model line into the info box instead of printing it', () => {
    const reader = readFileSync('mediawiki/reader/reader.js', 'utf8');
    expect(reader).toContain("image(page.model, 'article-art model')");
    const seed = readFileSync('mediawiki/seed/pages.xml', 'utf8');
    expect(seed).toMatch(
      /&lt;woc-art path=&quot;\/encyclopedia-stills\/[\w.-]+\.webp&quot; size=&quot;model&quot; \/&gt;/,
    );
  });
});

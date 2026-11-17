import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { articleArt, modelStills } from '../scripts/mediawiki/article_art';
import { ABILITIES, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
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
  it('gives creature and NPC pages a shipped model render', () => {
    const map = (records: Record<string, unknown>, prefix: string) =>
      new Map(Object.keys(records).map((id) => [id, prefix + id]));
    const models = modelStills({ mob: map(MOBS, 'mob/'), npc: map(NPCS, 'npc/') });
    expect(models.size).toBeGreaterThan(400);
    for (const [title, path] of models) {
      expect(path, title).toMatch(/^\/encyclopedia-stills\/[\w.-]+\.webp$/);
      expect(existsSync(join('public', path.slice(1))), path).toBe(true);
    }
    expect(models.get('mob/rift_boss_frost')).toBe(
      '/encyclopedia-stills/mob_hoard_hoarfrost_warden.webp',
    );
    // NPCs and creatures on character bodies come from the game's own renderer, which
    // draws their authored face, hair and props.
    expect(models.get('npc/smith_haldren')).toBe('/encyclopedia-stills/npc__smith_haldren.webp');
    expect(models.get('mob/deacon_voss')).toBe('/encyclopedia-stills/mob__deacon_voss.webp');
  });
  it('shows the class figure on a class page and the quest giver on a quest page', () => {
    const quest = Object.values(QUESTS).find((q) => q.giverNpcId === 'foreman_odell');
    expect(quest).toBeTruthy();
    const models = modelStills({
      class: new Map([['warrior', 'Warrior']]),
      quest: new Map([[quest!.id, 'A quest']]),
    });
    expect(models.get('Warrior')).toBe('/guide-stills/player_warrior.webp');
    expect(models.get('A quest')).toBe('/encyclopedia-stills/npc__foreman_odell.webp');
  });
  it('never draws a character body with the simple model viewer', () => {
    // That viewer draws a player or NPC rig as a generic class body without its look.
    const viewer: Record<string, string> = JSON.parse(
      readFileSync('scripts/mediawiki/entity_stills.json', 'utf8'),
    );
    for (const [key, path] of Object.entries(viewer)) {
      expect(path, key).not.toMatch(/\/(?:player|npc)_/);
      expect(key, key).not.toMatch(/^npc\//);
    }
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

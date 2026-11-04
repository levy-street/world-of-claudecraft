import { describe, expect, it } from 'vitest';
import { addEntityArticles } from '../scripts/mediawiki/entity_articles';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { questRoute } from '../scripts/mediawiki/quest_route';
import {
  CLASSES,
  DUNGEONS,
  getActiveWorldContent,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
} from '../src/sim/data';
import { CRAB_SUMMON_SITE } from '../src/sim/interactions/crab_summon';
import { spawnOpenWorldMob } from '../src/sim/mob/open_world_tuning';

function articles() {
  const pages = new Map<string, string>();
  const registries = {
    item: ITEMS,
    mob: MOBS,
    npc: NPCS,
    quest: QUESTS,
    class: CLASSES,
    dungeon: DUNGEONS,
    zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
    ability: {},
  };
  const titleBy = Object.fromEntries(
    Object.entries(registries).map(([kind, defs]) => [
      kind,
      new Map(Object.keys(defs).map((id) => [id, kind + '/' + id])),
    ]),
  ) as Record<ArticleKind, Map<string, string>>;
  const w: ArticleTools = {
    titleBy,
    add: (title, body) => pages.set(title, body),
    section: (name, body) => name + '\n' + body + '\n',
    table: (rows) => rows.map((r) => r.join(': ')).join('\n'),
    bullets: (rows) => rows.join('\n'),
    link: (title, label) => '[[' + title + '|' + label + ']]',
    kindWording: (kind) => (kind === 'recipe' ? 'pattern' : kind),
    money: (n) => (n ?? 0) + ' copper',
  };
  addEntityArticles(w);
  return pages;
}
describe('encyclopedia entity articles', () => {
  it('covers every quest, creature and item and resolves game data inside representative articles', () => {
    const pages = articles();
    expect(pages.size).toBe(
      Object.keys(QUESTS).length + Object.keys(MOBS).length + Object.keys(ITEMS).length,
    );
    expect(pages.get('mob/balgath_cyclops')).toContain('next dawn');
    expect(pages.get('item/emissary_cache')).toContain('equally likely');
    expect(pages.get('item/legendary_cowl_of_event_horizon')).toContain('hoard');
    expect(pages.get('item/siltguard_helm')).toContain('equal odds');
    expect(pages.get('item/reins_mech_bird')).toContain('Legacy souvenir');
    expect(pages.get('item/seal_of_the_nine_oaths')).toContain('Heroic Marks');
    const unlisted = Object.values(DUNGEONS).find(
      (d) => d.guideVisible === false && d.spawns.length,
    )!;
    expect(pages.get('mob/' + unlisted.spawns[0].mobId)).toContain('unlisted in the public guide');
    expect(pages.get('item/reins_emberbristle_broom')).toContain(
      'One for 5 [[item/emberwoven_sheaf',
    );
    const quest = pages.get('quest/q_ps_mother_of_pearl')!;
    expect(quest).toContain('Walkthrough');
    expect(quest).toContain('mob/mister_crabs');
    expect(quest).toContain('Use the Briny Lure');
    const m = MOBS.forest_wolf;
    const wolf = spawnOpenWorldMob(1, m, m.minLevel, { x: 0, y: 0, z: 0 });
    expect(pages.get('mob/forest_wolf')).toContain(
      wolf.maxHp + ' health, ' + wolf.stats.armor + ' armor',
    );
    expect(pages.get('item/ps_lustrous_pearl')).toContain('mob/mister_crabs');
    expect(pages.get('item/bastion_sigil')).toContain('1,000 maximum health');
    expect(pages.get('mob/nythraxis_scourge_of_thornpeak')).toContain('Heroic encounter');
    for (const [id, body] of pages)
      expect(body, id).not.toMatch(/\[\[undefined|\[object Object\]|\bNaN\b/);
  }, 30000);
  it('resolves every offer and hand-in, and either locates each step or explains how its location is determined', () => {
    for (const q of Object.values(QUESTS)) {
      const r = questRoute(q);
      for (const step of ['Start', 'Hand-in'])
        expect(
          r.points.some((p) => p.step === step),
          q.id + ' ' + step,
        ).toBe(true);
      for (const i of q.objectives.keys()) {
        expect(
          r.points.some((p) => p.step === i + 1) || r.notes.some((n) => n.step === i + 1),
          q.id + ' step ' + (i + 1),
        ).toBe(true);
      }
      expect(
        r.points.every((p) => p.frame && p.label && Number.isFinite(p.x) && Number.isFinite(p.z)),
        q.id,
      ).toBe(true);
    }
    const pearl = questRoute(QUESTS.q_ps_mother_of_pearl);
    expect(pearl.points).toContainEqual(expect.objectContaining({ step: 1, ...CRAB_SUMMON_SITE }));
    const q = QUESTS.q_deepfen_purge;
    const actual = getActiveWorldContent().npcs[q.giverNpcId].pos;
    expect(questRoute(q).points).toContainEqual(
      expect.objectContaining({ step: 'Start', ...actual }),
    );
    const recovery = questRoute(QUESTS.q_ps_the_long_walk);
    expect(recovery.points.some((p) => p.step === 1)).toBe(false);
    expect(recovery.notes.some((n) => n.step === 1 && n.text.includes('corpse'))).toBe(true);
  });
});

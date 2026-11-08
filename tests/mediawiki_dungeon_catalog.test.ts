import { describe, expect, it } from 'vitest';
import { addDungeonCatalog, raidRooms } from '../scripts/mediawiki/dungeon_catalog';
import { dungeonRecovery } from '../scripts/mediawiki/dungeon_recovery';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { talentLoadoutGuide } from '../scripts/mediawiki/talent_loadout_guide';
import { DUNGEON_CHECKPOINTS } from '../src/sim/content/dungeon_checkpoints';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { DUNGEONS, MOBS, QUESTS, ZONES } from '../src/sim/data';
import { IGNIVAR_RAID_ROOM_IDS } from '../src/sim/ignivar_raid_ids';

const pages = new Map<string, string>();
const titleBy = Object.fromEntries(
  ['class', 'ability', 'item', 'npc', 'mob', 'quest', 'dungeon', 'zone'].map((kind) => [
    kind,
    new Map<string, string>(),
  ]),
) as Record<ArticleKind, Map<string, string>>;
for (const [kind, records] of Object.entries({
  dungeon: DUNGEONS,
  mob: MOBS,
  quest: QUESTS,
  zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
}))
  for (const [id, value] of Object.entries(records))
    titleBy[kind as ArticleKind].set(id, value.name);
const w: ArticleTools & { reserve(title: string): string } = {
  titleBy,
  reserve: (title) => title,
  link: (title, label = title) => '[[' + title + (title === label ? '' : '|' + label) + ']]',
  section: (title, body) => '\n== ' + title + ' ==\n' + body + '\n',
  bullets: (lines) => lines.map((s) => '* ' + s).join('\n'),
  table: (rows) => rows.map(([name, value]) => name + ': ' + value).join('\n'),
  add: (title, body) => {
    expect(pages.has(title)).toBe(false);
    pages.set(title, body);
  },
  money: (value) => String(value),
};
const parents = addDungeonCatalog(w);

describe('dungeon and raid guides', () => {
  it('lists raids once as complete activities and keeps every connected room in its parent guide', () => {
    const activity = FINDER_ACTIVITIES.find((a) => a.id === 'ignivar_raid_arena_normal')!;
    expect(raidRooms(activity).map((r) => r.id)).toEqual([...IGNIVAR_RAID_ROOM_IDS]);
    const index = pages.get('Dungeons')!;
    expect(index.match(/\[\[Crucible of the Last Spring \(Raid\)/g)).toHaveLength(1);
    expect(index.match(/\[\[Nythraxis \(Raid\)/g)).toHaveLength(2); // raid listing and attunement cross-reference
    expect(index).not.toContain('Connected rooms');
    for (const id of IGNIVAR_RAID_ROOM_IDS) {
      expect(index).not.toContain('[[' + DUNGEONS[id].name + ']]');
      expect(parents.get(id)).toBe('Crucible of the Last Spring (Raid)');
      expect(pages.get(parents.get(id)!)).toContain('[[' + DUNGEONS[id].name + ']]');
    }
    for (const activity of FINDER_ACTIVITIES.filter((a) => a.kind === 'dungeon'))
      expect(index).toContain('[[' + DUNGEONS[activity.dungeonId].name + ']]');
  });
  it('preserves raid requirements, physical travel, encounter order and lockout distinctions', () => {
    const nythraxis = pages.get('Nythraxis (Raid)')!;
    expect(nythraxis).toContain(QUESTS.q_nythraxis_bound_guardian.name);
    expect(nythraxis).toContain('Daily, after defeating the final boss');
    const crucible = pages.get('Crucible of the Last Spring (Raid)')!;
    expect(crucible).toContain('Weekly; the two boss rooms');
    expect(crucible).toContain('2 tanks, 2 healers and 6 damage dealers');
    expect(crucible).toContain('wait 9 seconds');
    expect(crucible).toContain('Defeat every [[Ember Sentinel]] and [[Crucible Warden]]');
    expect(crucible).toContain('to open the gate to the Molten Assembly');
    expect(crucible.indexOf('Ignivar, Herald of the Last Flame')).toBeLessThan(
      crucible.indexOf('Varkhul, Forgefather'),
    );
    expect(crucible).toContain('background-size:100% 100%');
    for (const body of pages.values()) expect(body).not.toMatch(/undefined|\bNaN\b/);
  });
  it('publishes every checkpoint with its unlock conditions and room coordinates', () => {
    for (const [id, checkpoints] of Object.entries(DUNGEON_CHECKPOINTS)) {
      const body = dungeonRecovery(DUNGEONS[id], w);
      expect(body).toContain('same run');
      expect(body).toContain('During an active fight');
      for (const checkpoint of checkpoints) {
        expect(body).toContain('(' + checkpoint.pos.x + ', ' + checkpoint.pos.z + ')');
        for (const boss of checkpoint.bosses) expect(body).toContain(MOBS[boss].name);
        for (const gate of checkpoint.gates)
          expect(body).toContain(DUNGEONS[id].gates!.find((g) => g.id === gate)!.name);
      }
    }
  });
  it('explains build capture, gear failure, import limits and active-build deletion', () => {
    const guide = talentLoadoutGuide();
    for (const text of [
      '10 named builds',
      '24 characters',
      'same name',
      'action bars',
      'Missing or unusable gear',
      'does not include gear or action bars',
      'next remaining build',
    ])
      expect(guide).toContain(text);
  });
});

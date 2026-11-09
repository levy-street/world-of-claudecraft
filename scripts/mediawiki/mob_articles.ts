import { BUDDIES } from '../../src/sim/content/buddies';
import {
  THATCHGRIN_CORPSE_SECONDS,
  THATCHGRIN_HP_CAP_RATIO,
  THATCHGRIN_HP_STEP_RATIO,
  THATCHGRIN_ID,
  THATCHGRIN_RESPAWN_SECONDS,
} from '../../src/sim/content/gourdlight_eve_scarecrow';
import { HEROIC_BOSS_LOOT } from '../../src/sim/content/heroic_loot';
import {
  DUNGEON_LIST,
  getActiveWorldContent,
  MOBS,
  QUESTS,
  zoneContaining,
} from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import { heroicLootItemId } from '../../src/sim/loot/heroic_item';
import { MAX_AGGRO_RADIUS } from '../../src/sim/mob/aggro_ranges';
import { resolveRespawnSeconds } from '../../src/sim/respawn_policy';
import { thatchgrinSpawnTemplate } from '../../src/sim/seasonal/scarecrow';
import { resolveScarecrowField } from '../../src/sim/seasonal/scarecrow_field';
import type { LootEntry } from '../../src/sim/types';
import { WORLD_BOSS_CORPSE_SECONDS, WORLD_BOSSES } from '../../src/sim/world_boss';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { companionBossSources, companionByCreature, companionRollText } from './companion_sources';
import { creatureRole, FRIENDLY_GROUPS } from './creature_role';
import { journalArticles } from './encounter_articles';
import { type ArticleTools, append, lines, pct, ref, words } from './entity_format';
import { mobMechanicLines } from './mob_mechanics';
import { releasedCampStats } from './released_camp_stats';

const coinRange = (copper: number) =>
  Math.ceil(copper * 0.6) + ' to ' + Math.ceil(copper * 1.4) + ' copper';
function lootLine(w: ArticleTools, entry: LootEntry, heroicOnly: boolean, upgrades: boolean) {
  const item = entry.itemId;
  const reward = [];
  if (item) {
    reward.push(ref(w, 'item', item));
    const heroic = heroicLootItemId(
      item,
      upgrades && !entry.questId && !entry.normalOnly && !heroicOnly,
    );
    if (heroic !== item) reward.push('on Heroic you get ' + ref(w, 'item', heroic));
  }
  if (entry.copper)
    reward.push(
      coinRange(entry.copper) +
        (entry.heroicCopper ? ' (' + coinRange(entry.heroicCopper) + ' on Heroic)' : ''),
    );
  const conditions = [];
  if (entry.questId)
    conditions.push('only while you need it for ' + ref(w, 'quest', entry.questId));
  if (entry.normalOnly) conditions.push('Normal only');
  if (heroicOnly) conditions.push('Heroic only');
  if (entry.rollGroup)
    conditions.push('shares one roll with the ' + words(entry.rollGroup) + ' pool');
  if (entry.unlessOwned) conditions.push('only if you do not already have it');
  if (entry.unlessOwnedItem)
    conditions.push('only if you do not have ' + ref(w, 'item', entry.unlessOwnedItem));
  if (entry.maxPlayerLevel !== undefined)
    conditions.push('only if you are level ' + entry.maxPlayerLevel + ' or lower');
  return (
    reward.join(', ') + ' (' + [pct(entry.chance) + ' base chance', ...conditions].join(', ') + ').'
  );
}
export function addMobArticles(w: ArticleTools, itemSources: Map<string, Set<string>>) {
  const journals = journalArticles(w);
  const locations = new Map<string, Set<string>>();
  for (const c of getActiveWorldContent().camps) {
    const m = MOBS[c.mobId];
    if (!m) continue;
    const z = zoneContaining(c.center.x, c.center.z);
    const min = c.respawnSeconds ?? resolveRespawnSeconds(m, c.center, undefined, null);
    const max = c.respawnSeconds ?? resolveRespawnSeconds(m, c.center, undefined, (_lo, hi) => hi);
    const level = [c.levelMin ?? m.minLevel, c.levelMax ?? m.maxLevel];
    const respawn = min === max ? min + ' sec' : min + ' to just under ' + max + ' sec';
    append(
      locations,
      m.id,
      (z ? ref(w, 'zone', z.id) : 'Overworld') +
        ' at (' +
        c.center.x +
        ', ' +
        c.center.z +
        '), within ' +
        c.radius +
        ' yd. ' +
        c.count +
        ' in this camp. Level ' +
        (level[0] === level[1] ? level[0] : level.join(' to ')) +
        '. Comes back ' +
        respawn +
        ' after it dies.',
    );
  }
  const instanceMobs = new Set<string>();
  for (const d of DUNGEON_LIST) {
    for (const s of d.spawns) {
      instanceMobs.add(s.mobId);
      append(
        locations,
        s.mobId,
        ref(w, 'dungeon', d.id) +
          (d.guideVisible === false ? ' (this dungeon is unlisted in the public guide)' : '') +
          '.',
      );
    }
  }
  const hunted = new Map<string, Set<string>>();
  for (const q of Object.values(QUESTS))
    for (const o of q.objectives)
      if (o.type === 'kill')
        append(hunted, o.targetMobId, ref(w, 'quest', q.id) + ' (kill ' + o.count + ').');
  for (const m of Object.values(MOBS)) {
    const companion = companionByCreature.get(m.id);
    if (companion) {
      const title = w.titleBy.companion?.get(companion.key);
      const guide = title ? w.link(title, companion.name) : w.link('Companions');
      w.add(
        w.titleBy.mob.get(m.id)!,
        w.section(
          'Overview',
          companion.name +
            ' is a cosmetic companion. It follows its owner and takes no part in combat. See ' +
            guide +
            ' for how to collect it.',
        ),
        ['Friendly creatures', FRIENDLY_GROUPS.companion],
      );
      continue;
    }
    const facts: [string, string][] = [
      ['Family', words(m.family)],
      ['Base swing interval', m.attackSpeed + ' sec'],
      ['Movement speed', m.moveSpeed + ' yd per sec'],
      ['Base detection radius', m.aggroRadius + ' yd'],
      [
        'Classification',
        [
          m.worldBoss && 'world boss',
          m.boss && 'boss',
          m.elite && 'elite',
          m.rare && 'rare',
          creatureRole(m.id) !== 'enemy' && creatureRole(m.id),
        ]
          .filter(Boolean)
          .join(', ') || 'ordinary',
      ],
    ];
    const schedule = WORLD_BOSSES.find((b) => b.templateId === m.id);
    if (schedule) {
      facts.push(
        [
          'World boss health',
          schedule.hpScale.base +
            ' health when one player is fighting it. It gains ' +
            schedule.hpScale.perPlayer +
            ' more health for each extra player who joins, up to ' +
            schedule.hpScale.max +
            '. During a spawn, its health can only go up, never down.',
        ],
        [
          'Spawn schedule',
          m.slumber
            ? 'Sleeps at night and wakes at dawn. After it is killed, its body stays for ' +
              WORLD_BOSS_CORPSE_SECONDS +
              ' sec. When the body is gone, the boss comes back at the next dawn. On servers without a day and night clock, it comes back every ' +
              schedule.intervalSeconds +
              ' sec instead.'
            : 'Spawns on a schedule, ' + schedule.intervalSeconds + ' seconds apart.',
        ],
      );
      append(
        locations,
        m.id,
        'World boss spawn at (' + schedule.pos.x + ', ' + schedule.pos.z + ').',
      );
    }
    if (m.aggroRadius > 0 && !m.dummy)
      facts.push([
        'Ordinary detection',
        'For each level it is above you, it notices you 1.5 yd farther away. For each level you are above it, it notices you 1.5 yd closer. This distance is never less than 4 yd or more than ' +
          MAX_AGGRO_RADIUS +
          ' yd.',
      ]);
    if (m.hardLeashRadius) facts.push(['Maximum chase from home', m.hardLeashRadius + ' yd']);
    if (m.requiresQuestId) facts.push(['Associated quest', ref(w, 'quest', m.requiresQuestId)]);
    if (m.seasonalEvent) facts.push(['Event', words(m.seasonalEvent)]);
    if (m.xpMult !== undefined) facts.push(['Experience multiplier', String(m.xpMult)]);
    const stats: [string, string][] = [];
    const campMob = getActiveWorldContent().camps.some((c) => c.mobId === m.id);
    for (let lvl = m.minLevel; lvl <= m.maxLevel; lvl++) {
      const pos = { x: 0, y: 0, z: 0 };
      const entity = campMob
        ? releasedCampStats(m, lvl)
        : createMob(1, m.id === THATCHGRIN_ID ? thatchgrinSpawnTemplate(m) : m, lvl, pos);
      if (schedule) entity.maxHp = schedule.hpScale.base;
      if (m.id === THATCHGRIN_ID && lvl === m.maxLevel) {
        const base = entity.maxHp;
        facts.push(
          [
            'Participant scaling',
            base +
              ' health when one player is fighting it. It gains ' +
              Math.round(base * THATCHGRIN_HP_STEP_RATIO) +
              ' more health for each extra player, up to ' +
              Math.round(base * THATCHGRIN_HP_CAP_RATIO) +
              '.',
          ],
          [
            'Spawn schedule',
            'Only appears during Gourdlight Eve. Sleeps by day and wakes at night. After it is killed, its body stays for up to ' +
              THATCHGRIN_CORPSE_SECONDS +
              ' sec. When the body is gone, it comes back ' +
              THATCHGRIN_RESPAWN_SECONDS +
              ' sec later.',
          ],
        );
        const field = resolveScarecrowField(WORLD_SEED);
        if (field)
          append(locations, m.id, 'Gourdlight field at (' + field.x + ', ' + field.z + ').');
      }
      stats.push([
        'Level ' + lvl,
        entity.maxHp +
          ' health, ' +
          entity.stats.armor +
          ' armor, ' +
          entity.weapon.min +
          ' to ' +
          entity.weapon.max +
          ' base weapon damage.' +
          (entity.mechanicDamageMult
            ? ' Special attack damage × ' + Number(entity.mechanicDamageMult.toFixed(5)) + '.'
            : '') +
          (entity.mechanicHealMult
            ? ' Special ability healing × ' + Number(entity.mechanicHealMult.toFixed(5)) + '.'
            : ''),
      ]);
    }
    const drops: string[] = [];
    for (const [entries, heroicOnly] of [
      [m.loot, false],
      [HEROIC_BOSS_LOOT[m.id] ?? [], true],
    ] as const)
      for (const e of entries) {
        // The runtime quest-drop branch awards only item slots. A quest-gated copper-only row produces nothing.
        if (
          e.questId &&
          (!e.itemId ||
            !QUESTS[e.questId]?.objectives.some(
              (o) => o.type === 'collect' && o.itemId === e.itemId,
            ))
        )
          continue;
        const text = lootLine(w, e, heroicOnly, instanceMobs.has(m.id));
        drops.push(text);
        if (!e.itemId) continue;
        const source = ref(w, 'mob', m.id) + ' drops ' + text;
        append(itemSources, e.itemId, source);
        if (instanceMobs.has(m.id) && !e.questId && !e.normalOnly && !heroicOnly)
          append(itemSources, heroicLootItemId(e.itemId, true), source);
      }
    if (m.loot.some((e) => e.rollGroup) || HEROIC_BOSS_LOOT[m.id]?.some((e) => e.rollGroup))
      drops.unshift(
        'Some items share one roll. Only one of them can drop from that roll. Your class, and items you already have, can change the final odds.',
      );
    if (m.worldBoss)
      drops.unshift(
        'Each player who helped and can get loot rolls for themselves. Each player can win at most one gear item per kill, across all the shared gear pools.',
      );
    for (const row of companionBossSources.filter((s) => s.bossId === m.id)) {
      const name = BUDDIES[row.key].name;
      const title = w.titleBy.companion?.get(row.key);
      drops.push(
        (title ? w.link(title, name) : name) +
          ' companion. ' +
          companionRollText(row.fullGroupChance),
      );
    }
    const info =
      w.section('Overview', m.name + ' belongs to the ' + words(m.family) + ' family.') +
      w.section('Facts', w.table(facts)) +
      w.section(
        'Base stats by level',
        'For creatures in the outside world, these numbers already include level scaling. For creatures in dungeons, these numbers come before room and difficulty changes. Weapon damage is shown before armor and other damage reduction lower it.\n\n' +
          w.table(stats),
      ) +
      lines(w, 'Locations', Array.from(locations.get(m.id) ?? [])) +
      lines(w, 'Mechanics', mobMechanicLines(m)) +
      (journals.get(m.id) ?? '') +
      lines(w, 'Loot', drops) +
      lines(w, 'Quest credit', Array.from(hunted.get(m.id) ?? []));
    const role = creatureRole(m.id);
    w.add(
      w.titleBy.mob.get(m.id)!,
      info,
      role === 'enemy' ? ['Mobs', m.family] : ['Friendly creatures', FRIENDLY_GROUPS[role]],
    );
  }
}

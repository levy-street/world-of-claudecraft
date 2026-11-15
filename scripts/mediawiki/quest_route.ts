import { FARM_CROPS, farmCropSkillThreshold } from '../../src/sim/content/farm_crops';
import {
  GOURDLIGHT_KEEPER_NPC_ID,
  TRICK_OR_TREAT_NPCS,
} from '../../src/sim/content/gourdlight_eve';
import {
  MUSTER_BOSS_TEMPLATE_ID,
  MUSTER_EFFIGY_POST,
  MUSTER_RACK,
} from '../../src/sim/content/mirefen_muster';
import { MOUNT_RACE_COURSE, MOUNT_RACE_START_PLATFORM } from '../../src/sim/content/mounts';
import {
  HUB_DUMMY_DRILL_OBJECT_ITEM_ID,
  HUB_HEALING_DRILL_OBJECT_ITEM_ID,
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_SPARRING_MASTER_ID,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../../src/sim/content/practice_dummies';
import { HARVEST_COMPONENT_ITEMS } from '../../src/sim/content/professions';
import { BOOTCAMP_COURSE_CHECKPOINTS } from '../../src/sim/content/proving_shore';
import { DEEPFEN_SHALLOWS_LAKE } from '../../src/sim/content/zone2';
import {
  DUNGEON_LIST,
  ESCORTS,
  farmPatchesInActiveWorld,
  gatherNodesInActiveWorld,
  getActiveWorldContent,
  ITEMS,
  MOBS,
  NPCS,
  ZONES,
  zoneContaining,
} from '../../src/sim/data';
import {
  CRAB_MOB_ID,
  CRAB_SUMMON_RANGE,
  CRAB_SUMMON_SITE,
} from '../../src/sim/interactions/crab_summon';
import {
  FIREBOTTLE_COOLDOWN_SECS,
  HUT_BURN_RANGE,
  HUT_REBURN_COOLDOWN_SECS,
} from '../../src/sim/interactions/firebottle_hut';
import { practiceDummyPos } from '../../src/sim/moved_objects';
import { nodeMaterialFor } from '../../src/sim/professions/gathering_materials';
import { fineGradeReachable, fineMaterialFor } from '../../src/sim/professions/material_grades';
import type { StationType } from '../../src/sim/professions/stations';
import { resolveScarecrowField } from '../../src/sim/seasonal/scarecrow_field';
import { gourdlightDailySites } from '../../src/sim/seasonal_daily_sites';
import { resolvedKeeperPosts } from '../../src/sim/seasonal_keeper_posts';
import { ABILITY_DRILL_RING } from '../../src/sim/tutorial/ability_drill';
import { SIGNPOST_NOTICEBOARD_ID } from '../../src/sim/tutorial/signpost_read';
import { type QuestDef, questTurnInNpcIds } from '../../src/sim/types';
import { WORLD_BOSSES } from '../../src/sim/world_boss';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { stationNameText } from '../../src/ui/hud/professions/station_name_view';
import { type TranslationKey, t } from '../../src/ui/i18n';
import { recipes, words } from './entity_format';

/** The game's own bed line: the garden's zone plus the bed's 1-based position. */
function farmBedLabel(patch: { zoneId: string }, index: number): string {
  const zone = ZONES.find((z) => z.id === patch.zoneId);
  return t('hudChrome.harvestJournal.bedLine', { zone: zone?.name ?? '', index: index + 1 });
}

type Step = 'Start' | 'Hand-in' | number;
type Position = { x: number; z: number };
export interface RoutePoint extends Position {
  step: Step;
  frame: string;
  label: string;
  radius?: number;
}
export interface QuestRoute {
  points: RoutePoint[];
  notes: { step: Step; text: string }[];
}

export function questRoute(quest: QuestDef): QuestRoute {
  const world = getActiveWorldContent();
  const points: RoutePoint[] = [];
  const notes: QuestRoute['notes'] = [];
  let step: Step = 'Start';
  const note = (text: string) => {
    if (!notes.some((n) => n.step === step && n.text === text)) notes.push({ step, text });
  };
  function point(pos: Position, label: string, frame = 'Overworld', radius?: number) {
    const zone = frame === 'Overworld' ? zoneContaining(pos.x, pos.z) : undefined;
    if (zone) label += ' (' + zone.name + ')';
    if (
      !points.some(
        (p) =>
          p.step === step &&
          p.frame === frame &&
          p.label === label &&
          p.x === pos.x &&
          p.z === pos.z,
      )
    )
      points.push({ step, frame, label, x: pos.x, z: pos.z, ...(radius ? { radius } : {}) });
  }
  function inDungeon(d: (typeof DUNGEON_LIST)[number], pos: Position, label: string) {
    point(pos, label, d.name);
    if (d.guideVisible === false) note(d.name + ' is not listed in the public guide right now.');
  }
  function npc(id: string) {
    const n = world.npcs[id] ?? NPCS[id];
    if (!n) return;
    if (id === GOURDLIGHT_KEEPER_NPC_ID) {
      for (const post of resolvedKeeperPosts(WORLD_SEED))
        point(post.pos, n.name + ' (while Gourdlight Eve is active)');
      return;
    }
    if (world.npcs[id] && (!n.dynamic || n.fixedPost || id === HUB_SPARRING_MASTER_ID))
      point(n.pos, n.name);
    for (const d of DUNGEON_LIST) {
      for (const s of d.npcs ?? []) if (s.npcId === id) inDungeon(d, s, n.name);
      if (id === 'brother_aldric_raid') {
        const boss = d.spawns.find((s) => s.mobId === 'nythraxis_scourge_of_thornpeak');
        if (boss) inDungeon(d, { x: boss.x, z: boss.z - 50 }, n.name + ' (Nythraxis encounter)');
      }
    }
  }
  function mob(id: string) {
    const name = MOBS[id]?.name ?? words(id);
    for (const c of world.camps)
      if (c.mobId === id) point(c.center, name + ' camp center', 'Overworld', c.radius);
    for (const b of WORLD_BOSSES) if (b.templateId === id) point(b.pos, name + ' world boss spawn');
    for (const d of DUNGEON_LIST)
      for (const s of d.spawns) if (s.mobId === id) inDungeon(d, s, name);
    if (id === 'bound_guardian') object('crypt_ritual_circle');
    if (id === CRAB_MOB_ID)
      point(
        CRAB_SUMMON_SITE,
        'Use the Briny Lure at the tide pool',
        'Overworld',
        CRAB_SUMMON_RANGE,
      );
  }
  function object(id: string) {
    for (const obj of world.groundObjects)
      if (obj.itemId === id) for (const p of obj.positions) point(p, obj.name);
    for (const d of DUNGEON_LIST)
      for (const o of d.objects ?? []) if (o.itemId === id) inDungeon(d, o, o.name);
    if (id === HUB_DUMMY_DRILL_OBJECT_ITEM_ID || id === HUB_HEALING_DRILL_OBJECT_ITEM_ID) {
      const heal = id === HUB_HEALING_DRILL_OBJECT_ITEM_ID;
      note(
        heal
          ? 'Target the hurt dummy and cast a direct heal that really restores some of its missing health. Extra healing past full health gives no credit.'
          : 'Target the training dummy and hit it with attacks or spells that do damage.',
      );
      point(
        practiceDummyPos(
          world.objectMoves,
          heal ? HUB_HEALING_DUMMY_ID : HUB_TRAINING_DUMMY_ID,
          heal ? HUB_HEALING_DUMMY_POS : HUB_TRAINING_DUMMY_POS,
        ),
        heal ? 'Heal the injured training dummy' : 'Strike the training dummy',
      );
    }
    if (id === 'ps_gauntlet_flag')
      for (const [i, p] of BOOTCAMP_COURSE_CHECKPOINTS.entries())
        point(p, 'Cross course checkpoint ' + (i + 1));
    if (id === 'murloc_hut')
      note(
        'Use the Firebottle within ' +
          HUT_BURN_RANGE +
          ' yards of each hut. The bottle is ready again after ' +
          FIREBOTTLE_COOLDOWN_SECS +
          ' seconds. After you burn a hut, it cannot be burned again for ' +
          HUT_REBURN_COOLDOWN_SECS +
          ' seconds.',
      );
    if (id === 'ps_ability_drill')
      point(
        ABILITY_DRILL_RING,
        'Land an ability on a training effigy inside the drill ring',
        'Overworld',
        ABILITY_DRILL_RING.radius,
      );
    if (id === 'ps_guild_signpost')
      for (const b of world.services?.noticeboards ?? [])
        if (b.id === SIGNPOST_NOTICEBOARD_ID) point(b, b.name);
    if (id === 'train_valorsteed') {
      npc('stablemaster_marla');
      point(MOUNT_RACE_START_PLATFORM, 'Glowing start platform');
      point(MOUNT_RACE_COURSE.arch, 'Start and finish arch');
      for (const [i, j] of MOUNT_RACE_COURSE.jumps.entries()) point(j, 'Clear jump ' + (i + 1));
      note(
        `This quest is a training course you ride alone. Stand on the glowing square and choose Start Race to borrow the training Valorsteed. After the countdown, jump all ${MOUNT_RACE_COURSE.jumps.length} bars in any order. Then ride through the finish arch within ${MOUNT_RACE_COURSE.timeLimitSeconds} seconds. This is not the same as [[Mount racing]], which is no longer part of the live game.`,
      );
    }
    if (id === 'ps_passing_stone')
      note(
        'Use the Passing Stone from your bags in a safe spot. Release your spirit. Then walk your ghost back to your corpse where you fell.',
      );
  }
  function gather(id?: string, type?: string) {
    for (const n of gatherNodesInActiveWorld()) {
      if (type && n.type !== type) continue;
      const base = nodeMaterialFor(n.type, n.zoneId).itemId;
      if (id && base !== id && !(fineMaterialFor(base) === id && fineGradeReachable(base, n.tier)))
        continue;
      point(
        n.pos,
        t(`hudChrome.gathering.nodeName.${n.type}` as TranslationKey) + ', tier ' + n.tier,
      );
    }
  }
  function craft(id: string) {
    const r = recipes.get(id);
    if (!r) return;
    const type = r.stationType;
    note(
      'Craft ' +
        (ITEMS[r.resultItemId]?.name ?? words(r.resultItemId)) +
        ' using ' +
        r.reagents
          .map((a) => a.count + ' ' + (ITEMS[a.itemId]?.name ?? words(a.itemId)))
          .join(', ') +
        ' (amounts before any bonuses).',
    );
    for (const s of world.services?.stations ?? [])
      if (s.type === type) point(s.pos, stationNameText(s.type as StationType));
  }
  npc(quest.giverNpcId);
  for (const [i, o] of quest.objectives.entries()) {
    step = i + 1;
    switch (o.type) {
      case 'kill':
        mob(o.targetMobId);
        break;
      case 'collect': {
        object(o.itemId);
        for (const m of Object.values(MOBS))
          if (m.loot.some((e) => e.itemId === o.itemId && (!e.questId || e.questId === quest.id)))
            mob(m.id);
        for (const n of Object.values(NPCS))
          if (!n.devVendor && n.vendorItems?.includes(o.itemId)) npc(n.id);
        gather(o.itemId);
        if (o.itemId === 'the_codfather') {
          point(
            DEEPFEN_SHALLOWS_LAKE,
            'Deepfen Shallows lake center',
            'Overworld',
            DEEPFEN_SHALLOWS_LAKE.radius + 10,
          );
          note(
            'Face the lake with a fishing pole and reel in when a fish bites. While you have the quest, the first fish you catch here is the Codfather, as long as you are not already carrying one.',
          );
        }
        const crop = Object.values(FARM_CROPS).find(
          (c) => c.produceItemId === o.itemId || c.fineProduceItemId === o.itemId,
        );
        if (crop) {
          note(
            'Plant ' +
              ITEMS[crop.seedItemId].name +
              ' in a free bed with Farming skill ' +
              farmCropSkillThreshold(crop.tier) +
              ' or higher. Wait ' +
              crop.durationMs / 60000 +
              ' minutes for it to grow, then harvest it.',
          );
          for (const patch of farmPatchesInActiveWorld())
            patch.beds.forEach((bed, i) => {
              point(bed, farmBedLabel(patch, i));
            });
        }
        if (Object.values(HARVEST_COMPONENT_ITEMS).includes(o.itemId)) {
          const origin = points.find((p) => p.step === 'Start');
          const camps = world.camps.filter((c) =>
            MOBS[c.mobId]?.componentTags?.some((t) => HARVEST_COMPONENT_ITEMS[t] === o.itemId),
          );
          if (origin)
            camps.sort(
              (a, b) =>
                Math.hypot(a.center.x - origin.x, a.center.z - origin.z) -
                Math.hypot(b.center.x - origin.x, b.center.z - origin.z),
            );
          for (const c of camps.slice(0, 3))
            point(c.center, 'Harvest ' + MOBS[c.mobId].name + ' corpses', 'Overworld', c.radius);
          note(
            'Set your harvest preference to ' +
              ITEMS[o.itemId].name +
              '. Kill a creature that has this part, loot it, then harvest its body. The map shows nearby camps of creatures that have it.',
          );
        }
        if (o.itemId === 'thatchgrin_patch_pumpkin' || o.itemId === 'cursed_candle_stub') {
          const sites = gourdlightDailySites(WORLD_SEED);
          for (const p of o.itemId === 'cursed_candle_stub' ? sites.candles : sites.patch)
            point(p, ITEMS[o.itemId].name);
        } else if (o.itemId === 'gourdlight_crow_feather') {
          const field = resolveScarecrowField(WORLD_SEED);
          if (field) point(field, 'Old Thatchgrin’s field');
          note(
            'Fight Old Thatchgrin during Gourdlight Eve. When it uses Crowcall, crows appear. Kill them and loot their feathers.',
          );
        }
        for (const r of recipes.values()) if (r.resultItemId === o.itemId) craft(r.id);
        if (quest.requiredItems?.includes(o.itemId))
          note(
            'If you do not have a ' +
              ITEMS[o.itemId].name +
              ', you get one when you take this quest.',
          );
        break;
      }
      case 'interact':
        if (o.targetNpcId) npc(o.targetNpcId);
        if (o.targetObjectItemId) object(o.targetObjectItemId);
        break;
      case 'gather':
        gather(o.itemId, o.nodeType);
        break;
      case 'craft':
        craft(o.recipeId);
        break;
      case 'farm':
        for (const p of farmPatchesInActiveWorld())
          if (!o.patchId || o.patchId === p.id)
            p.beds.forEach((b, i) => {
              point(b, farmBedLabel(p, i));
            });
        break;
      case 'escort': {
        const e = ESCORTS[o.escortId];
        if (e) {
          point(e.start, 'Speak to ' + MOBS[e.npcMobId].name + ' to begin');
          for (const [i, p] of e.waypoints.entries()) point(p, 'Escort waypoint ' + (i + 1));
          note(
            'Keep the person you are guarding safe through each ambush. Be within ' +
              e.creditRadius +
              ' yards of them at the last stop to get credit.',
          );
        }
        break;
      }
      case 'event':
        if (o.eventId === 'muster_pike_drawn')
          point(MUSTER_RACK, 'Borrow the Shardpike at the rack');
        else if (o.eventId.startsWith('muster_effigy_'))
          point(MUSTER_EFFIGY_POST, 'Straw Foreman practice effigy');
        else if (o.eventId === 'balgath_blinded') mob(MUSTER_BOSS_TEMPLATE_ID);
        else if (o.eventId.startsWith('gourdlight_')) {
          const towns: Record<string, string> = {
            eastbrook: 'eastbrook_vale',
            fenbridge: 'mirefen_marsh',
            highwatch: 'thornpeak_heights',
          };
          const town = towns[o.eventId.replace('gourdlight_knock_', '')];
          for (const [id, hosts] of Object.entries(TRICK_OR_TREAT_NPCS))
            if (!town || town === id) for (const h of hosts) npc(h);
        }
        break;
    }
  }
  step = 'Hand-in';
  for (const id of questTurnInNpcIds(quest)) npc(id);
  return { points, notes };
}

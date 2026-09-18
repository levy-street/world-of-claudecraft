import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import type { SimContext } from './sim_context';
import { worldQuestCycleOfferingQuest } from './world_quest_rotation';
import { restoreWorldQuestClaims, updateWorldQuests } from './world_quests';

const WORLD_QUEST_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  eastbrook_bandits: 'wq_eastbrook_bandits',
  eastbrook: 'wq_eastbrook_bandits',
  bandits: 'wq_eastbrook_bandits',

  hollow_sporelings: 'wq_hollow_sporelings',
  sporelings: 'wq_hollow_sporelings',
  hollow: 'wq_hollow_sporelings',

  drakelands_brood: 'wq_drakelands_brood',
  brood: 'wq_drakelands_brood',
  drakelands: 'wq_drakelands_brood',

  frostveil_howlers: 'wq_frostveil_howlers',
  howlers: 'wq_frostveil_howlers',

  amberfall_lurkers: 'wq_amberfall_lurkers',
  lurkers: 'wq_amberfall_lurkers',
  amberfall: 'wq_amberfall_lurkers',

  willowfen_ore: 'wq_willowfen_ore',
  ore: 'wq_willowfen_ore',
  willowfen: 'wq_willowfen_ore',

  nightbloom_barrow: 'wq_nightbloom_barrow',
  barrow: 'wq_nightbloom_barrow',
  nightbloom: 'wq_nightbloom_barrow',

  wraithwood_restless: 'wq_wraithwood_restless',
  restless: 'wq_wraithwood_restless',
  wraithwood: 'wq_wraithwood_restless',

  evergarden_watch: 'wq_evergarden_watch',
  watch: 'wq_evergarden_watch',
  evergarden: 'wq_evergarden_watch',
});

export const CLASSIC_WORLD_QUEST_COMMANDS: readonly string[] = Object.freeze([
  'eastbrook_bandits',
  'hollow_sporelings',
  'drakelands_brood',
  'frostveil_howlers',
  'amberfall_lurkers',
  'willowfen_ore',
  'nightbloom_barrow',
  'wraithwood_restless',
  'evergarden_watch',
]);

export function resolveWorldQuestId(key: string): string | undefined {
  const normalized = key.trim().toLowerCase();
  if (WORLD_QUEST_ALIASES[normalized]) return WORLD_QUEST_ALIASES[normalized];
  if (Object.hasOwn(WORLD_QUESTS_BY_ID, normalized)) return normalized;
  if (Object.hasOwn(WORLD_QUESTS_BY_ID, `wq_${normalized}`)) return `wq_${normalized}`;
  return undefined;
}

export function armWorldQuestForDev(ctx: SimContext, pid: number, questKey: string): boolean {
  if (!ctx.devCommands) return false;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return false;

  const questId = resolveWorldQuestId(questKey);
  const quest = questId ? WORLD_QUESTS_BY_ID[questId] : undefined;
  if (!quest) {
    ctx.error(pid, `[dev] Unknown world quest '${questKey}'. Use /dev wq to list them.`);
    return false;
  }

  const rotation = ctx.currentWorldQuestRotation();
  const devCycle = worldQuestCycleOfferingQuest(rotation.cycle || 'wq3_0', quest.id);
  if (!devCycle) {
    ctx.error(pid, `[dev] World quest '${quest.id}' has no offering rotation.`);
    return false;
  }

  meta.devWorldQuestCycle = devCycle;
  if (meta.worldQuestCycle !== devCycle) {
    meta.worldQuestCycle = devCycle;
    meta.worldQuestLog.clear();
    meta.worldQuestAreas.clear();
  }

  ctx.setPlayerLevel(Math.max(quest.minLevel, player.level), pid);
  meta.worldQuestLog.set(quest.id, { questId: quest.id, count: 0, state: 'active' });
  meta.worldQuestAreas.delete(quest.id);
  meta.wireRev++;

  cancelProfessionSessionOnDisplacement(ctx, player);
  const pos = ctx.groundPos(quest.area.x, quest.area.z);
  player.pos = pos;
  player.prevPos = { ...pos };
  ctx.rebucket(player);

  updateWorldQuests(ctx, meta, player);
  restoreWorldQuestClaims(meta);

  ctx.emit({ type: 'worldQuestStarted', questId: quest.id, pid });
  ctx.emit({
    type: 'log',
    pid,
    text: `[dev] World quest '${quest.id}' armed (${quest.zoneId}). Teleported to ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}.`,
  });
  return true;
}

export function listWorldQuestsForDev(ctx: SimContext, pid: number): void {
  if (!ctx.devCommands) return;
  ctx.emit({
    type: 'log',
    pid,
    text: '[dev] World Quests: /dev wq <name>; wisp maze: /dev wq wisps; generated daily levels: /dev wq candy <day> or /dev wq ley <day> (1-32, repeating after 32); glider practice: /dev wq glider <level> (1-3); or individual commands:',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev eastbrook_bandits (Eastbrook Vale: Load freight)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev hollow_sporelings (Veiled Hollow: Corrupted sporelings)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev drakelands_brood (Drakelands: Dragonkin broodguards)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev frostveil_howlers (Frostveil: Sprung wolf traps)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev amberfall_lurkers (Amberfall: Marsh lurkers)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev willowfen_ore (Willowfen: Ore veins)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev nightbloom_barrow (Nightbloom: Barrow wights)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev wraithwood_restless (Wraithwood: Wood wraiths)',
  });
  ctx.emit({
    type: 'log',
    pid,
    text: '- /dev evergarden_watch (Evergarden: Hedge Knights)',
  });
}

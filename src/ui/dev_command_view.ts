import { MAX_LEVEL } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

export type DevCommandCategory =
  | 'player'
  | 'spawns'
  | 'inventory'
  | 'progress'
  | 'travel'
  | 'scenarios';

export interface DevCommandValues {
  [key: string]: string | number | undefined;
}

export interface DevCommandAction {
  id: string;
  category: DevCommandCategory;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  command(values: DevCommandValues): string | null;
}

const SAFE_TOKEN = /^[a-z0-9_]+$/i;

function token(values: DevCommandValues, key: string): string | null {
  const value = String(values[key] ?? '').trim();
  return SAFE_TOKEN.test(value) ? value : null;
}

function boundedInteger(
  values: DevCommandValues,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = Number(values[key]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function fixed(command: string): (values: DevCommandValues) => string {
  return () => command;
}

export const DEV_COMMAND_ACTIONS: readonly DevCommandAction[] = [
  {
    id: 'heal',
    category: 'player',
    labelKey: 'devCommand.actions.heal.label',
    descriptionKey: 'devCommand.actions.heal.description',
    command: fixed('/dev heal'),
  },
  {
    id: 'resource',
    category: 'player',
    labelKey: 'devCommand.actions.resource.label',
    descriptionKey: 'devCommand.actions.resource.description',
    command: fixed('/dev resource'),
  },
  {
    id: 'cooldowns',
    category: 'player',
    labelKey: 'devCommand.actions.cooldowns.label',
    descriptionKey: 'devCommand.actions.cooldowns.description',
    command: fixed('/dev cooldowns'),
  },
  {
    id: 'god',
    category: 'player',
    labelKey: 'devCommand.actions.god.label',
    descriptionKey: 'devCommand.actions.god.description',
    command: fixed('/dev god'),
  },
  {
    id: 'revive',
    category: 'player',
    labelKey: 'devCommand.actions.revive.label',
    descriptionKey: 'devCommand.actions.revive.description',
    command: fixed('/dev revive'),
  },
  {
    id: 'kill',
    category: 'player',
    labelKey: 'devCommand.actions.kill.label',
    descriptionKey: 'devCommand.actions.kill.description',
    command: fixed('/dev kill'),
  },
  {
    id: 'combatreset',
    category: 'player',
    labelKey: 'devCommand.actions.combatreset.label',
    descriptionKey: 'devCommand.actions.combatreset.description',
    command: fixed('/dev combatreset'),
  },
  {
    id: 'level',
    category: 'player',
    labelKey: 'devCommand.actions.level.label',
    descriptionKey: 'devCommand.actions.level.description',
    command: (values) => `/dev level ${boundedInteger(values, 'level', 1, MAX_LEVEL, 1)}`,
  },
  {
    id: 'spawn',
    category: 'spawns',
    labelKey: 'devCommand.actions.spawn.label',
    descriptionKey: 'devCommand.actions.spawn.description',
    command: (values) => {
      const mob = token(values, 'mob');
      if (!mob) return null;
      const count = boundedInteger(values, 'count', 1, 20, 1);
      const level = boundedInteger(values, 'mobLevel', 1, MAX_LEVEL, 1);
      return `/dev spawn ${mob} ${count} ${level}`;
    },
  },
  {
    id: 'killtarget',
    category: 'spawns',
    labelKey: 'devCommand.actions.killtarget.label',
    descriptionKey: 'devCommand.actions.killtarget.description',
    command: fixed('/dev killtarget'),
  },
  {
    id: 'despawntarget',
    category: 'spawns',
    labelKey: 'devCommand.actions.despawntarget.label',
    descriptionKey: 'devCommand.actions.despawntarget.description',
    command: fixed('/dev despawn target'),
  },
  {
    id: 'despawnall',
    category: 'spawns',
    labelKey: 'devCommand.actions.despawnall.label',
    descriptionKey: 'devCommand.actions.despawnall.description',
    command: fixed('/dev despawn spawned'),
  },
  {
    id: 'give',
    category: 'inventory',
    labelKey: 'devCommand.actions.give.label',
    descriptionKey: 'devCommand.actions.give.description',
    command: (values) => {
      const item = token(values, 'item');
      return item ? `/dev give ${item} ${boundedInteger(values, 'itemCount', 1, 20, 1)}` : null;
    },
  },
  {
    id: 'gold',
    category: 'inventory',
    labelKey: 'devCommand.actions.gold.label',
    descriptionKey: 'devCommand.actions.gold.description',
    command: (values) => `/dev gold ${boundedInteger(values, 'gold', 1, 100000, 100)}`,
  },
  {
    id: 'quest',
    category: 'progress',
    labelKey: 'devCommand.actions.quest.label',
    descriptionKey: 'devCommand.actions.quest.description',
    command: (values) => {
      const quest = token(values, 'quest');
      return quest ? `/dev quest ${quest}` : null;
    },
  },
  {
    id: 'quests',
    category: 'progress',
    labelKey: 'devCommand.actions.quests.label',
    descriptionKey: 'devCommand.actions.quests.description',
    command: fixed('/dev quests'),
  },
  {
    id: 'attune',
    category: 'progress',
    labelKey: 'devCommand.actions.attune.label',
    descriptionKey: 'devCommand.actions.attune.description',
    command: fixed('/dev attune'),
  },
  {
    id: 'gather',
    category: 'progress',
    labelKey: 'devCommand.actions.gather.label',
    descriptionKey: 'devCommand.actions.gather.description',
    command: (values) => {
      const profession = token(values, 'profession');
      return profession
        ? `/dev gather ${profession} ${boundedInteger(values, 'gatherAmount', 1, 100, 1)}`
        : null;
    },
  },
  {
    id: 'teleport',
    category: 'travel',
    labelKey: 'devCommand.actions.teleport.label',
    descriptionKey: 'devCommand.actions.teleport.description',
    command: (values) => {
      const x = Number(values.x);
      const z = Number(values.z);
      return Number.isFinite(x) && Number.isFinite(z) ? `/dev tp ${x} ${z}` : null;
    },
  },
  {
    id: 'dungeon',
    category: 'travel',
    labelKey: 'devCommand.actions.dungeon.label',
    descriptionKey: 'devCommand.actions.dungeon.description',
    command: (values) => {
      const dungeon = token(values, 'dungeon');
      const difficulty = values.difficulty === 'heroic' ? 'heroic' : 'normal';
      return dungeon ? `/dev dungeon ${dungeon} ${difficulty}` : null;
    },
  },
  {
    id: 'raid',
    category: 'travel',
    labelKey: 'devCommand.actions.raid.label',
    descriptionKey: 'devCommand.actions.raid.description',
    command: (values) => `/dev raid ${values.raidDifficulty === 'normal' ? 'normal' : 'heroic'}`,
  },
  {
    id: 'raidreset',
    category: 'travel',
    labelKey: 'devCommand.actions.raidreset.label',
    descriptionKey: 'devCommand.actions.raidreset.description',
    command: fixed('/dev raid reset'),
  },
  {
    id: 'bot',
    category: 'scenarios',
    labelKey: 'devCommand.actions.bot.label',
    descriptionKey: 'devCommand.actions.bot.description',
    command: (values) => {
      const name = token(values, 'botName');
      return name ? `/dev bot ${name}` : null;
    },
  },
  {
    id: 'lfgqueue',
    category: 'scenarios',
    labelKey: 'devCommand.actions.lfgqueue.label',
    descriptionKey: 'devCommand.actions.lfgqueue.description',
    command: fixed('/dev lfg queue'),
  },
  {
    id: 'lfgraid',
    category: 'scenarios',
    labelKey: 'devCommand.actions.lfgraid.label',
    descriptionKey: 'devCommand.actions.lfgraid.description',
    command: fixed('/dev lfg raid'),
  },
  {
    id: 'lfgboard',
    category: 'scenarios',
    labelKey: 'devCommand.actions.lfgboard.label',
    descriptionKey: 'devCommand.actions.lfgboard.description',
    command: fixed('/dev lfg board'),
  },
];

export function isDevGuiCommand(value: string): boolean {
  return /^\/dev\s+gui\s*$/i.test(value.trim());
}

export function filteredDevActions(
  category: DevCommandCategory,
  query: string,
  text: (key: TranslationKey) => string = (key) => key,
): readonly DevCommandAction[] {
  const needle = query.trim().toLowerCase();
  return DEV_COMMAND_ACTIONS.filter(
    (action) =>
      action.category === category &&
      (!needle ||
        text(action.labelKey).toLowerCase().includes(needle) ||
        text(action.descriptionKey).toLowerCase().includes(needle)),
  );
}

export function buildDevCommand(actionId: string, values: DevCommandValues): string | null {
  return DEV_COMMAND_ACTIONS.find((action) => action.id === actionId)?.command(values) ?? null;
}

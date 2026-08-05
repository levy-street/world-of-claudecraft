// Pure (IO-free) parsing and validation of the farm bot's JSON config profile:
// which server and character to log in as, what to farm (mode, zones, node
// types/tiers/priorities, node id lists), fishing spots, the combat rotation
// and recovery knobs, death and safety policies, and bag offload. Kept
// separate from the IO shell (main.ts) so the validation is unit-tested
// without touching the filesystem or the network. Credentials
// (WOC_USERNAME/WOC_PASSWORD) are read from the environment by main.ts at
// runtime and deliberately never appear here.

import { GATHER_NODE_TYPES } from '../src/sim/content/gather_nodes';
import type { GatherNodeType } from '../src/sim/types';

// What the bot does when there is something to do. Supersedes the legacy
// fishing.enabled flag (still accepted; see parseConfig). 'gold' is the
// dungeon gold-farm mode and 'level' is the camp-grind leveling mode: both
// bypass gathering and fishing entirely.
export type FarmMode = 'gather-fish' | 'gather' | 'fish' | 'gold' | 'level' | 'target';

export type KeepQuality = 'rare' | 'epic' | 'legendary';

export interface LevelGrindConfig {
  // Stop (done) when the player reaches this level.
  targetLevel: number;
  // Stop pulling and recharge below this hp/mana percent.
  restBelowPct: number;
  // 'money-blues' keeps only copper and rare+ loot (junk discarded after the
  // loot); 'all' loots everything and sells via the bags-full vendor flow.
  lootRule: 'money-blues' | 'all';
  // Move to the next zone band when every camp in the current zone is gray.
  zoneUp: boolean;
}

export interface TargetConfig {
  // The one material to farm (an item id).
  itemId: string;
  // Stop after this many gathered/caught/looted; 0 means farm forever.
  goal: number;
  // Source override; 'auto' takes the best resolver pick.
  source: 'auto' | 'gather' | 'fish' | 'mobs';
  // When the goal is reached, mail the stack to this alt before stopping.
  mailToWhenDone?: string;
}

export interface GoldFarmConfig {
  // Dungeon ids to rotate between (DUNGEONS keys, src/sim/data.ts).
  dungeons: string[];
  // Stop pulling and recharge below this hp/mana percent.
  restBelowPct: number;
  // The single-target pull ability (Rite of Expulsion by default).
  pullAbility: string;
  // Loot qualities worth keeping; everything else on a taken corpse is
  // discarded after the loot (the wire takes all).
  keepQualities: KeepQuality[];
}

export interface FishingConfig {
  // Legacy single-spot field, mirrored from `spots[0]` when only `spots` is
  // given; kept because the brain reads it until the spot-rotation phase.
  spot?: { x: number; z: number };
  // Rotation list of fishing spots; supersedes `spot` (still accepted).
  spots: { x: number; z: number }[];
  // Casts attempted at one spot before moving on; undefined means no limit.
  castsPerSpot?: number;
  // Legacy gate, superseded by `mode`. When neither is written the default is
  // false (the pre-`mode` behavior); see parseConfig for the reconciliation.
  enabled: boolean;
}

export interface CombatConfig {
  // Ability slots to cast in priority order while in combat, e.g. [0, 1, 2].
  abilitySlots: number[];
  // 'slots' casts abilitySlots round-robin; 'auto' picks from known abilities
  // by cooldown/GCD/resource (later phase).
  rotationMode: 'slots' | 'auto';
  // Kill hostile mobs near the route between node spawns (later phase).
  grind: boolean;
  // 'outleveled' runs from attackers too far above the player's level;
  // 'outnumbered' runs from 3+ attackers; 'both' applies either rule.
  flee: 'never' | 'outleveled' | 'outnumbered' | 'both';
  // Level gap that triggers an 'outleveled' flee.
  fleeAboveLevelDelta: number;
  // Pull-size cap: skip a pull target when the living hostiles within 10 yd
  // of it outnumber this (gold and level modes; combat.grind ignores it).
  maxPullSize: number;
  eatItemId?: string;
  drinkItemId?: string;
  eatBelowHpPct?: number;
  drinkBelowManaPct?: number;
}

export type BagFullPolicy = 'sell-junk' | 'stop';

export interface BagsConfig {
  fullPolicy: BagFullPolicy;
  // When non-empty, only these item ids are sold as junk (later phase).
  sellAllowlist: string[];
  // Recipient alt for mail offload; unset means never mail (later phase).
  mailTo?: string;
  // What to mail: 'all' gathered mats, or an explicit item-id list.
  mailItems: 'all' | string[];
  // List kept-quality (rare+) drops on the World Market when a merchant is
  // near during a BAGS_FULL trip, instead of vendoring them for scrap.
  marketSell: boolean;
}

export interface MountConfig {
  // Summon an owned mount for overworld travel legs over 60 yd (level 20+,
  // riding trained, reins in bags). Dismounts on combat and on arrival.
  enabled: boolean;
  // Buy riding training (80g) when near the stablemaster and copper allows.
  buyTraining: boolean;
}

export interface DeathConfig {
  // After a resurrect, rest (eat/drink/wait) until hp and mana are full.
  waitUntilFull: boolean;
  // Session death cap; 0 means unlimited.
  maxDeaths: number;
  // How long the route avoids a spot where the bot died.
  avoidDeathSpotMinutes: number;
}

export interface SafetyConfig {
  // What a whisper (or near say) triggers: log line, webhook alarm, or logout.
  whisperAction: 'log' | 'alarm' | 'logout';
  playerPause: {
    // Pause while another player lingers nearby (later phase).
    enabled: boolean;
    radiusYd: number;
    seconds: number;
  };
  schedule: {
    // Farm/break rhythm; 0 means no scheduled breaks.
    sessionMinutes: number;
    breakMinutes: number;
    breakAction: 'idle' | 'logout';
  };
  // Discord/Slack-compatible alert webhook; unset means no alerts leave the
  // log (later phase).
  webhookUrl?: string;
}

export interface FarmBotConfig {
  serverUrl: string;
  characterName: string;
  // The single-zone legacy field; the working zone when `zones` is empty.
  zoneId: string;
  // Multi-zone rotation list; empty means farm `zoneId` only (later phase).
  zones: string[];
  mode: FarmMode;
  nodeTypes: GatherNodeType[];
  // Type preference order for node picking; defaults to nodeTypes order.
  nodePriority: GatherNodeType[];
  maxNodeTier: number;
  // Node-id filters: whitelist empty means all allowed (later phase).
  nodeBlacklist: string[];
  nodeWhitelist: string[];
  fishing: FishingConfig;
  combat: CombatConfig;
  bags: BagsConfig;
  death: DeathConfig;
  safety: SafetyConfig;
  // Dungeon gold-farm settings (only read when mode is 'gold').
  goldFarm: GoldFarmConfig;
  // Leveling grind settings (only read when mode is 'level').
  levelGrind: LevelGrindConfig;
  // Target-mat farming settings (only read when mode is 'target').
  target: TargetConfig;
  // Auto-equip strictly-better drops after loot (never downgrades, never bags).
  gearUpgrades: boolean;
  // Mount travel for long overworld legs.
  mount: MountConfig;
  // 0 means run until interrupted.
  maxRuntimeMinutes: number;
}

const BAG_FULL_POLICIES: readonly BagFullPolicy[] = ['sell-junk', 'stop'];
const FARM_MODES: readonly FarmMode[] = [
  'gather-fish',
  'gather',
  'fish',
  'gold',
  'level',
  'target',
];
const KEEP_QUALITIES: readonly KeepQuality[] = ['rare', 'epic', 'legendary'];
const WHISPER_ACTIONS: readonly SafetyConfig['whisperAction'][] = ['log', 'alarm', 'logout'];
const BREAK_ACTIONS: readonly SafetyConfig['schedule']['breakAction'][] = ['idle', 'logout'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function checkNoUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}: unknown key '${key}'`);
  }
}

function parseSpot(
  value: unknown,
  path: string,
  errors: string[],
): { x: number; z: number } | undefined {
  if (isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z)) {
    return { x: value.x, z: value.z };
  }
  errors.push(`${path}: must be {x: number, z: number}`);
  return undefined;
}

function parseStringList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: must be an array of strings`);
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (isNonEmptyString(entry)) out.push(entry);
    else errors.push(`${path}: entries must be non-empty strings`);
  }
  return out;
}

function parseNodeTypeList(value: unknown, path: string, errors: string[]): GatherNodeType[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path}: must be a non-empty array of ${GATHER_NODE_TYPES.join('|')}`);
    return [];
  }
  const out: GatherNodeType[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && (GATHER_NODE_TYPES as readonly string[]).includes(entry)) {
      if (!out.includes(entry as GatherNodeType)) out.push(entry as GatherNodeType);
    } else {
      errors.push(
        `${path}: invalid entry ${JSON.stringify(entry)}, expected ${GATHER_NODE_TYPES.join('|')}`,
      );
    }
  }
  return out;
}

// Validates a plain parsed-JSON value into a FarmBotConfig. Strict on both
// types and key names (unknown keys are rejected so typos in the profile
// surface immediately). Collects every problem and throws one Error listing
// them all rather than failing on the first.
export function parseConfig(json: unknown): FarmBotConfig {
  const errors: string[] = [];

  if (!isRecord(json)) {
    throw new Error('invalid farmbot config: top level must be a JSON object');
  }
  checkNoUnknownKeys(
    json,
    [
      'serverUrl',
      'characterName',
      'zoneId',
      'zones',
      'mode',
      'nodeTypes',
      'nodePriority',
      'maxNodeTier',
      'nodeBlacklist',
      'nodeWhitelist',
      'fishing',
      'combat',
      'bags',
      'death',
      'safety',
      'goldFarm',
      'levelGrind',
      'target',
      'gearUpgrades',
      'mount',
      'maxRuntimeMinutes',
    ],
    'config',
    errors,
  );

  if (!isNonEmptyString(json.serverUrl)) errors.push('serverUrl: must be a non-empty string');
  if (!isNonEmptyString(json.characterName))
    errors.push('characterName: must be a non-empty string');
  if (!isNonEmptyString(json.zoneId)) errors.push('zoneId: must be a non-empty string');

  let zones: string[] = [];
  if (json.zones !== undefined) zones = parseStringList(json.zones, 'zones', errors);

  let nodeTypes: GatherNodeType[] = [...GATHER_NODE_TYPES];
  if (json.nodeTypes !== undefined) {
    const parsed = parseNodeTypeList(json.nodeTypes, 'nodeTypes', errors);
    if (parsed.length > 0) nodeTypes = parsed;
  }

  // Defaults to the nodeTypes order (post-parse) when not written.
  let nodePriority: GatherNodeType[] = [...nodeTypes];
  if (json.nodePriority !== undefined) {
    const parsed = parseNodeTypeList(json.nodePriority, 'nodePriority', errors);
    if (parsed.length > 0) nodePriority = parsed;
  }

  let maxNodeTier = 99;
  if (json.maxNodeTier !== undefined) {
    if (
      typeof json.maxNodeTier === 'number' &&
      Number.isInteger(json.maxNodeTier) &&
      json.maxNodeTier >= 1
    ) {
      maxNodeTier = json.maxNodeTier;
    } else {
      errors.push('maxNodeTier: must be an integer >= 1');
    }
  }

  let nodeBlacklist: string[] = [];
  if (json.nodeBlacklist !== undefined) {
    nodeBlacklist = parseStringList(json.nodeBlacklist, 'nodeBlacklist', errors);
  }
  let nodeWhitelist: string[] = [];
  if (json.nodeWhitelist !== undefined) {
    nodeWhitelist = parseStringList(json.nodeWhitelist, 'nodeWhitelist', errors);
  }

  const fishing: FishingConfig = { enabled: false, spots: [] };
  let fishingEnabledExplicit = false;
  if (json.fishing !== undefined) {
    if (!isRecord(json.fishing)) {
      errors.push('fishing: must be an object');
    } else {
      checkNoUnknownKeys(
        json.fishing,
        ['enabled', 'spot', 'spots', 'castsPerSpot'],
        'fishing',
        errors,
      );
      if (json.fishing.enabled !== undefined) {
        if (typeof json.fishing.enabled !== 'boolean') {
          errors.push('fishing.enabled: must be a boolean');
        } else {
          fishing.enabled = json.fishing.enabled;
          fishingEnabledExplicit = true;
        }
      }
      if (json.fishing.spot !== undefined) {
        const spot = parseSpot(json.fishing.spot, 'fishing.spot', errors);
        if (spot) fishing.spot = spot;
      }
      if (json.fishing.spots !== undefined) {
        if (!Array.isArray(json.fishing.spots)) {
          errors.push('fishing.spots: must be an array of {x: number, z: number}');
        } else {
          const spots: { x: number; z: number }[] = [];
          json.fishing.spots.forEach((entry, i) => {
            const spot = parseSpot(entry, `fishing.spots[${i}]`, errors);
            if (spot) spots.push(spot);
          });
          fishing.spots = spots;
        }
      }
      if (json.fishing.castsPerSpot !== undefined) {
        const casts = json.fishing.castsPerSpot;
        if (typeof casts === 'number' && Number.isInteger(casts) && casts >= 1) {
          fishing.castsPerSpot = casts;
        } else {
          errors.push('fishing.castsPerSpot: must be an integer >= 1');
        }
      }
    }
  }
  // Keep the legacy single spot and the rotation list mirroring each other:
  // spot-only input seeds the list, list-only input seeds the spot.
  if (fishing.spots.length === 0 && fishing.spot) fishing.spots = [fishing.spot];
  if (fishing.spot === undefined && fishing.spots.length > 0) fishing.spot = fishing.spots[0];

  // mode and the legacy fishing.enabled flag: when exactly one of the two is
  // written, the other is derived from it; when both are written, BOTH are
  // respected ('gather' still never fishes and 'fish' always fishes via the
  // brain's mode gate; 'gather-fish' consults enabled). Respecting both keeps
  // parseConfig output (which always carries the pair) re-parseable, and
  // stops a serialized 'gather-fish' + enabled:false config from having
  // fishing silently switched on. When neither is written, the legacy
  // default (no fishing) holds.
  let mode: FarmMode;
  if (json.mode !== undefined) {
    if (typeof json.mode === 'string' && (FARM_MODES as readonly string[]).includes(json.mode)) {
      mode = json.mode as FarmMode;
      if (!fishingEnabledExplicit) fishing.enabled = mode !== 'gather';
    } else {
      errors.push(`mode: must be ${FARM_MODES.join('|')}`);
      mode = fishing.enabled ? 'gather-fish' : 'gather';
    }
  } else if (fishingEnabledExplicit) {
    mode = fishing.enabled ? 'gather-fish' : 'gather';
  } else {
    mode = 'gather-fish';
  }

  const combat: CombatConfig = {
    abilitySlots: [],
    rotationMode: 'slots',
    grind: false,
    flee: 'never',
    fleeAboveLevelDelta: 3,
    maxPullSize: 2,
  };
  if (json.combat !== undefined) {
    if (!isRecord(json.combat)) {
      errors.push('combat: must be an object');
    } else {
      checkNoUnknownKeys(
        json.combat,
        [
          'abilitySlots',
          'rotationMode',
          'grind',
          'flee',
          'fleeAboveLevelDelta',
          'maxPullSize',
          'eatItemId',
          'drinkItemId',
          'eatBelowHpPct',
          'drinkBelowManaPct',
        ],
        'combat',
        errors,
      );
      if (json.combat.abilitySlots !== undefined) {
        if (
          Array.isArray(json.combat.abilitySlots) &&
          json.combat.abilitySlots.every(isNonNegativeInt)
        ) {
          combat.abilitySlots = [...json.combat.abilitySlots];
        } else {
          errors.push('combat.abilitySlots: must be an array of non-negative integers');
        }
      }
      if (json.combat.rotationMode !== undefined) {
        if (json.combat.rotationMode === 'slots' || json.combat.rotationMode === 'auto') {
          combat.rotationMode = json.combat.rotationMode;
        } else {
          errors.push('combat.rotationMode: must be slots|auto');
        }
      }
      if (json.combat.grind !== undefined) {
        if (typeof json.combat.grind === 'boolean') combat.grind = json.combat.grind;
        else errors.push('combat.grind: must be a boolean');
      }
      if (json.combat.flee !== undefined) {
        if (
          json.combat.flee === 'never' ||
          json.combat.flee === 'outleveled' ||
          json.combat.flee === 'outnumbered' ||
          json.combat.flee === 'both'
        ) {
          combat.flee = json.combat.flee;
        } else {
          errors.push('combat.flee: must be never|outleveled|outnumbered|both');
        }
      }
      if (json.combat.fleeAboveLevelDelta !== undefined) {
        const delta = json.combat.fleeAboveLevelDelta;
        if (isFiniteNumber(delta) && delta >= 0) combat.fleeAboveLevelDelta = delta;
        else errors.push('combat.fleeAboveLevelDelta: must be a number >= 0');
      }
      if (json.combat.maxPullSize !== undefined) {
        const size = json.combat.maxPullSize;
        if (isNonNegativeInt(size) && size >= 1) combat.maxPullSize = size;
        else errors.push('combat.maxPullSize: must be an integer >= 1');
      }
      if (json.combat.eatItemId !== undefined) {
        if (isNonEmptyString(json.combat.eatItemId)) combat.eatItemId = json.combat.eatItemId;
        else errors.push('combat.eatItemId: must be a non-empty string');
      }
      if (json.combat.drinkItemId !== undefined) {
        if (isNonEmptyString(json.combat.drinkItemId)) combat.drinkItemId = json.combat.drinkItemId;
        else errors.push('combat.drinkItemId: must be a non-empty string');
      }
      if (json.combat.eatBelowHpPct !== undefined) {
        const pct = json.combat.eatBelowHpPct;
        if (isFiniteNumber(pct) && pct > 0 && pct <= 100) combat.eatBelowHpPct = pct;
        else errors.push('combat.eatBelowHpPct: must be a number in (0, 100]');
      }
      if (json.combat.drinkBelowManaPct !== undefined) {
        const pct = json.combat.drinkBelowManaPct;
        if (isFiniteNumber(pct) && pct > 0 && pct <= 100) combat.drinkBelowManaPct = pct;
        else errors.push('combat.drinkBelowManaPct: must be a number in (0, 100]');
      }
    }
  }

  const bags: BagsConfig = {
    fullPolicy: 'sell-junk',
    sellAllowlist: [],
    mailItems: 'all',
    marketSell: false,
  };
  if (json.bags !== undefined) {
    if (!isRecord(json.bags)) {
      errors.push('bags: must be an object');
    } else {
      checkNoUnknownKeys(
        json.bags,
        ['fullPolicy', 'sellAllowlist', 'mailTo', 'mailItems', 'marketSell'],
        'bags',
        errors,
      );
      if (json.bags.fullPolicy !== undefined) {
        if (
          typeof json.bags.fullPolicy === 'string' &&
          (BAG_FULL_POLICIES as readonly string[]).includes(json.bags.fullPolicy)
        ) {
          bags.fullPolicy = json.bags.fullPolicy as BagFullPolicy;
        } else {
          errors.push(`bags.fullPolicy: must be ${BAG_FULL_POLICIES.join('|')}`);
        }
      }
      if (json.bags.sellAllowlist !== undefined) {
        bags.sellAllowlist = parseStringList(json.bags.sellAllowlist, 'bags.sellAllowlist', errors);
      }
      if (json.bags.mailTo !== undefined) {
        if (isNonEmptyString(json.bags.mailTo)) bags.mailTo = json.bags.mailTo;
        else errors.push('bags.mailTo: must be a non-empty string');
      }
      if (json.bags.mailItems !== undefined) {
        if (json.bags.mailItems === 'all') {
          bags.mailItems = 'all';
        } else if (Array.isArray(json.bags.mailItems)) {
          bags.mailItems = parseStringList(json.bags.mailItems, 'bags.mailItems', errors);
        } else {
          errors.push("bags.mailItems: must be 'all' or an array of item-id strings");
        }
      }
      if (json.bags.marketSell !== undefined) {
        if (typeof json.bags.marketSell === 'boolean') bags.marketSell = json.bags.marketSell;
        else errors.push('bags.marketSell: must be a boolean');
      }
    }
  }

  const death: DeathConfig = { waitUntilFull: true, maxDeaths: 0, avoidDeathSpotMinutes: 30 };
  if (json.death !== undefined) {
    if (!isRecord(json.death)) {
      errors.push('death: must be an object');
    } else {
      checkNoUnknownKeys(
        json.death,
        ['waitUntilFull', 'maxDeaths', 'avoidDeathSpotMinutes'],
        'death',
        errors,
      );
      if (json.death.waitUntilFull !== undefined) {
        if (typeof json.death.waitUntilFull === 'boolean')
          death.waitUntilFull = json.death.waitUntilFull;
        else errors.push('death.waitUntilFull: must be a boolean');
      }
      if (json.death.maxDeaths !== undefined) {
        if (isNonNegativeInt(json.death.maxDeaths)) death.maxDeaths = json.death.maxDeaths;
        else errors.push('death.maxDeaths: must be an integer >= 0 (0 = unlimited)');
      }
      if (json.death.avoidDeathSpotMinutes !== undefined) {
        const minutes = json.death.avoidDeathSpotMinutes;
        if (isFiniteNumber(minutes) && minutes >= 0) death.avoidDeathSpotMinutes = minutes;
        else errors.push('death.avoidDeathSpotMinutes: must be a number >= 0');
      }
    }
  }

  const safety: SafetyConfig = {
    whisperAction: 'alarm',
    playerPause: { enabled: false, radiusYd: 40, seconds: 20 },
    schedule: { sessionMinutes: 0, breakMinutes: 20, breakAction: 'idle' },
  };
  if (json.safety !== undefined) {
    if (!isRecord(json.safety)) {
      errors.push('safety: must be an object');
    } else {
      checkNoUnknownKeys(
        json.safety,
        ['whisperAction', 'playerPause', 'schedule', 'webhookUrl'],
        'safety',
        errors,
      );
      if (json.safety.whisperAction !== undefined) {
        if (
          typeof json.safety.whisperAction === 'string' &&
          (WHISPER_ACTIONS as readonly string[]).includes(json.safety.whisperAction)
        ) {
          safety.whisperAction = json.safety.whisperAction as SafetyConfig['whisperAction'];
        } else {
          errors.push(`safety.whisperAction: must be ${WHISPER_ACTIONS.join('|')}`);
        }
      }
      if (json.safety.webhookUrl !== undefined) {
        if (isNonEmptyString(json.safety.webhookUrl)) safety.webhookUrl = json.safety.webhookUrl;
        else errors.push('safety.webhookUrl: must be a non-empty string');
      }
      if (json.safety.playerPause !== undefined) {
        if (!isRecord(json.safety.playerPause)) {
          errors.push('safety.playerPause: must be an object');
        } else {
          const pp = json.safety.playerPause;
          checkNoUnknownKeys(pp, ['enabled', 'radiusYd', 'seconds'], 'safety.playerPause', errors);
          if (pp.enabled !== undefined) {
            if (typeof pp.enabled === 'boolean') safety.playerPause.enabled = pp.enabled;
            else errors.push('safety.playerPause.enabled: must be a boolean');
          }
          if (pp.radiusYd !== undefined) {
            if (isFiniteNumber(pp.radiusYd) && pp.radiusYd > 0)
              safety.playerPause.radiusYd = pp.radiusYd;
            else errors.push('safety.playerPause.radiusYd: must be a number > 0');
          }
          if (pp.seconds !== undefined) {
            if (isFiniteNumber(pp.seconds) && pp.seconds > 0)
              safety.playerPause.seconds = pp.seconds;
            else errors.push('safety.playerPause.seconds: must be a number > 0');
          }
        }
      }
      if (json.safety.schedule !== undefined) {
        if (!isRecord(json.safety.schedule)) {
          errors.push('safety.schedule: must be an object');
        } else {
          const sc = json.safety.schedule;
          checkNoUnknownKeys(
            sc,
            ['sessionMinutes', 'breakMinutes', 'breakAction'],
            'safety.schedule',
            errors,
          );
          if (sc.sessionMinutes !== undefined) {
            if (isFiniteNumber(sc.sessionMinutes) && sc.sessionMinutes >= 0) {
              safety.schedule.sessionMinutes = sc.sessionMinutes;
            } else {
              errors.push('safety.schedule.sessionMinutes: must be a number >= 0 (0 = off)');
            }
          }
          if (sc.breakMinutes !== undefined) {
            if (isFiniteNumber(sc.breakMinutes) && sc.breakMinutes >= 0) {
              safety.schedule.breakMinutes = sc.breakMinutes;
            } else {
              errors.push('safety.schedule.breakMinutes: must be a number >= 0');
            }
          }
          if (sc.breakAction !== undefined) {
            if (
              typeof sc.breakAction === 'string' &&
              (BREAK_ACTIONS as readonly string[]).includes(sc.breakAction)
            ) {
              safety.schedule.breakAction =
                sc.breakAction as SafetyConfig['schedule']['breakAction'];
            } else {
              errors.push(`safety.schedule.breakAction: must be ${BREAK_ACTIONS.join('|')}`);
            }
          }
        }
      }
    }
  }

  const goldFarm: GoldFarmConfig = {
    dungeons: ['hollow_crypt', 'sunken_bastion'],
    restBelowPct: 50,
    pullAbility: 'exorcism',
    keepQualities: [...KEEP_QUALITIES],
  };
  if (json.goldFarm !== undefined) {
    if (!isRecord(json.goldFarm)) {
      errors.push('goldFarm: must be an object');
    } else {
      checkNoUnknownKeys(
        json.goldFarm,
        ['dungeons', 'restBelowPct', 'pullAbility', 'keepQualities'],
        'goldFarm',
        errors,
      );
      if (json.goldFarm.dungeons !== undefined) {
        const dungeons = parseStringList(json.goldFarm.dungeons, 'goldFarm.dungeons', errors);
        if (Array.isArray(json.goldFarm.dungeons) && dungeons.length === 0) {
          errors.push('goldFarm.dungeons: must list at least one dungeon');
        } else if (dungeons.length > 0) {
          goldFarm.dungeons = dungeons;
        }
      }
      if (json.goldFarm.restBelowPct !== undefined) {
        const pct = json.goldFarm.restBelowPct;
        if (isFiniteNumber(pct) && pct > 0 && pct <= 100) goldFarm.restBelowPct = pct;
        else errors.push('goldFarm.restBelowPct: must be a number in (0, 100]');
      }
      if (json.goldFarm.pullAbility !== undefined) {
        if (isNonEmptyString(json.goldFarm.pullAbility))
          goldFarm.pullAbility = json.goldFarm.pullAbility;
        else errors.push('goldFarm.pullAbility: must be a non-empty string');
      }
      if (json.goldFarm.keepQualities !== undefined) {
        if (
          Array.isArray(json.goldFarm.keepQualities) &&
          json.goldFarm.keepQualities.length > 0 &&
          json.goldFarm.keepQualities.every(
            (q) => typeof q === 'string' && (KEEP_QUALITIES as readonly string[]).includes(q),
          )
        ) {
          goldFarm.keepQualities = [...json.goldFarm.keepQualities] as KeepQuality[];
        } else {
          errors.push(
            `goldFarm.keepQualities: must be a non-empty array of ${KEEP_QUALITIES.join('|')}`,
          );
        }
      }
    }
  }

  const levelGrind: LevelGrindConfig = {
    targetLevel: 20,
    restBelowPct: 50,
    lootRule: 'money-blues',
    zoneUp: true,
  };
  if (json.levelGrind !== undefined) {
    if (!isRecord(json.levelGrind)) {
      errors.push('levelGrind: must be an object');
    } else {
      checkNoUnknownKeys(
        json.levelGrind,
        ['targetLevel', 'restBelowPct', 'lootRule', 'zoneUp'],
        'levelGrind',
        errors,
      );
      if (json.levelGrind.targetLevel !== undefined) {
        if (isNonNegativeInt(json.levelGrind.targetLevel) && json.levelGrind.targetLevel >= 1) {
          levelGrind.targetLevel = json.levelGrind.targetLevel;
        } else {
          errors.push('levelGrind.targetLevel: must be an integer >= 1');
        }
      }
      if (json.levelGrind.restBelowPct !== undefined) {
        const pct = json.levelGrind.restBelowPct;
        if (isFiniteNumber(pct) && pct > 0 && pct <= 100) levelGrind.restBelowPct = pct;
        else errors.push('levelGrind.restBelowPct: must be a number in (0, 100]');
      }
      if (json.levelGrind.lootRule !== undefined) {
        if (json.levelGrind.lootRule === 'money-blues' || json.levelGrind.lootRule === 'all') {
          levelGrind.lootRule = json.levelGrind.lootRule;
        } else {
          errors.push('levelGrind.lootRule: must be money-blues|all');
        }
      }
      if (json.levelGrind.zoneUp !== undefined) {
        if (typeof json.levelGrind.zoneUp === 'boolean') levelGrind.zoneUp = json.levelGrind.zoneUp;
        else errors.push('levelGrind.zoneUp: must be a boolean');
      }
    }
  }

  const target: TargetConfig = { itemId: '', goal: 0, source: 'auto' };
  if (json.target !== undefined) {
    if (!isRecord(json.target)) {
      errors.push('target: must be an object');
    } else {
      checkNoUnknownKeys(
        json.target,
        ['itemId', 'goal', 'source', 'mailToWhenDone'],
        'target',
        errors,
      );
      if (json.target.itemId !== undefined) {
        // '' means unset (the value parseConfig itself emits as a default),
        // so a serialized config round-trips; the mode-gate below catches
        // target mode without a material.
        if (isNonEmptyString(json.target.itemId)) target.itemId = json.target.itemId;
        else if (json.target.itemId !== '')
          errors.push('target.itemId: must be a non-empty string');
      }
      if (json.target.goal !== undefined) {
        if (isNonNegativeInt(json.target.goal)) target.goal = json.target.goal;
        else errors.push('target.goal: must be an integer >= 0 (0 = forever)');
      }
      if (json.target.source !== undefined) {
        if (
          json.target.source === 'auto' ||
          json.target.source === 'gather' ||
          json.target.source === 'fish' ||
          json.target.source === 'mobs'
        ) {
          target.source = json.target.source;
        } else {
          errors.push('target.source: must be auto|gather|fish|mobs');
        }
      }
      if (json.target.mailToWhenDone !== undefined) {
        if (isNonEmptyString(json.target.mailToWhenDone)) {
          target.mailToWhenDone = json.target.mailToWhenDone;
        } else {
          errors.push('target.mailToWhenDone: must be a non-empty string');
        }
      }
    }
  }
  if (mode === 'target' && target.itemId === '') {
    errors.push('target.itemId: required when mode is target');
  }

  let maxRuntimeMinutes = 0;
  if (json.maxRuntimeMinutes !== undefined) {
    if (isFiniteNumber(json.maxRuntimeMinutes) && json.maxRuntimeMinutes >= 0) {
      maxRuntimeMinutes = json.maxRuntimeMinutes;
    } else {
      errors.push('maxRuntimeMinutes: must be a number >= 0 (0 = unlimited)');
    }
  }

  // Auto-equip defaults ON in level mode (upgrades while leveling are the
  // norm); every other mode keeps it opt-in. The requiredLevel gate in
  // gear.ts already restricts swaps to items the character can wear.
  let gearUpgrades = mode === 'level';
  if (json.gearUpgrades !== undefined) {
    if (typeof json.gearUpgrades === 'boolean') gearUpgrades = json.gearUpgrades;
    else errors.push('gearUpgrades: must be a boolean');
  }

  const mount: MountConfig = { enabled: false, buyTraining: false };
  if (json.mount !== undefined) {
    if (!isRecord(json.mount)) {
      errors.push('mount: must be an object');
    } else {
      checkNoUnknownKeys(json.mount, ['enabled', 'buyTraining'], 'mount', errors);
      if (json.mount.enabled !== undefined) {
        if (typeof json.mount.enabled === 'boolean') mount.enabled = json.mount.enabled;
        else errors.push('mount.enabled: must be a boolean');
      }
      if (json.mount.buyTraining !== undefined) {
        if (typeof json.mount.buyTraining === 'boolean') mount.buyTraining = json.mount.buyTraining;
        else errors.push('mount.buyTraining: must be a boolean');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid farmbot config:\n- ${errors.join('\n- ')}`);
  }

  return {
    serverUrl: json.serverUrl as string,
    characterName: json.characterName as string,
    zoneId: json.zoneId as string,
    zones,
    mode,
    nodeTypes,
    nodePriority,
    maxNodeTier,
    nodeBlacklist,
    nodeWhitelist,
    fishing,
    combat,
    bags,
    death,
    safety,
    goldFarm,
    levelGrind,
    target,
    gearUpgrades,
    mount,
    maxRuntimeMinutes,
  };
}

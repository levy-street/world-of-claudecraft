import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot/bases';
import { EquipmentEffectRuntime } from '../src/sim/equipment/equipment_effect_runtime';
import type {
  ActiveEquipmentPower,
  EquipmentEffectCommand,
  EquipmentEffectEvent,
  EquipmentPowerDefinition,
} from '../src/sim/equipment/equipment_effect_types';
import { Rng } from '../src/sim/rng';
import type { PlayerClass } from '../src/sim/types';

export const LEGENDARY_BALANCE_SAMPLE_FLOOR = 100_000;
export const LEGENDARY_SUSTAINED_MIN_PCT = 8;
export const LEGENDARY_SUSTAINED_MAX_PCT = 15;
export const LEGENDARY_BURST_MAX_PCT = 25;
export const LEGENDARY_BURST_WINDOW_MS = 10_000;
export const LEGENDARY_AREA_TARGETS = 5;

export const LEGENDARY_BALANCE_CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
] as const satisfies readonly PlayerClass[];

export type LegendaryBuildProfileId =
  | 'fresh_l10'
  | 'dungeon_l15'
  | 'pre_raid_l20'
  | 'bis_l20'
  | 'legendary_l20';

export interface LegendaryBuildProfile {
  id: LegendaryBuildProfileId;
  label: string;
  level: number;
  itemLevel: number;
  throughputScale: number;
  cadenceMultiplier: number;
  critChance: number;
  attackPower: number;
  spellPower: number;
  maxHealth: number;
}

export const LEGENDARY_BUILD_PROFILES = [
  {
    id: 'fresh_l10',
    label: 'Fresh level 10',
    level: 10,
    itemLevel: 10,
    throughputScale: 0.32,
    cadenceMultiplier: 1.14,
    critChance: 0.05,
    attackPower: 42,
    spellPower: 4,
    maxHealth: 330,
  },
  {
    id: 'dungeon_l15',
    label: 'Dungeon level 15',
    level: 15,
    itemLevel: 15,
    throughputScale: 0.61,
    cadenceMultiplier: 1.07,
    critChance: 0.08,
    attackPower: 72,
    spellPower: 14,
    maxHealth: 520,
  },
  {
    id: 'pre_raid_l20',
    label: 'Pre-raid level 20',
    level: 20,
    itemLevel: 20,
    throughputScale: 1,
    cadenceMultiplier: 1,
    critChance: 0.1,
    attackPower: 102,
    spellPower: 30,
    maxHealth: 760,
  },
  {
    id: 'bis_l20',
    label: 'Best-in-slot level 20',
    level: 20,
    itemLevel: 25,
    throughputScale: 1.18,
    cadenceMultiplier: 0.94,
    critChance: 0.14,
    attackPower: 142,
    spellPower: 54,
    maxHealth: 900,
  },
  {
    id: 'legendary_l20',
    label: 'Legendary level 20',
    level: 20,
    itemLevel: 26,
    throughputScale: 1.34,
    cadenceMultiplier: 0.88,
    critChance: 0.18,
    attackPower: 176,
    spellPower: 74,
    maxHealth: 1020,
  },
] as const satisfies readonly LegendaryBuildProfile[];

interface ClassBalanceModel {
  level20Dps: number;
  level20Hps: number;
  attackPowerMultiplier: number;
  spellPowerMultiplier: number;
  meleeDamageShare: number;
  spellDamageShare: number;
  shadowDamageShare: number;
}

// Level-20 DPS anchors are the medians from docs/balance/row-sweep.json.
// The channel shares are explicit workload assumptions, not claims about every
// specialization. They only allocate the baseline denominator to the event that
// can activate a power.
const CLASS_MODELS: Readonly<Record<PlayerClass, ClassBalanceModel>> = {
  warrior: {
    level20Dps: 31.533333,
    level20Hps: 0,
    attackPowerMultiplier: 1.2,
    spellPowerMultiplier: 0,
    meleeDamageShare: 0.78,
    spellDamageShare: 0,
    shadowDamageShare: 0,
  },
  paladin: {
    level20Dps: 16.133333,
    level20Hps: 25,
    attackPowerMultiplier: 0.85,
    spellPowerMultiplier: 0.75,
    meleeDamageShare: 0.45,
    spellDamageShare: 0.35,
    shadowDamageShare: 0,
  },
  hunter: {
    level20Dps: 26.6,
    level20Hps: 0,
    attackPowerMultiplier: 1.15,
    spellPowerMultiplier: 0,
    meleeDamageShare: 0.36,
    spellDamageShare: 0.24,
    shadowDamageShare: 0,
  },
  rogue: {
    level20Dps: 34.533333,
    level20Hps: 0,
    attackPowerMultiplier: 1.2,
    spellPowerMultiplier: 0,
    meleeDamageShare: 0.82,
    spellDamageShare: 0,
    shadowDamageShare: 0,
  },
  priest: {
    level20Dps: 23.533333,
    level20Hps: 34,
    attackPowerMultiplier: 0.25,
    spellPowerMultiplier: 1.15,
    meleeDamageShare: 0,
    spellDamageShare: 0.9,
    shadowDamageShare: 0.62,
  },
  shaman: {
    level20Dps: 30.2,
    level20Hps: 30,
    attackPowerMultiplier: 0.65,
    spellPowerMultiplier: 0.9,
    meleeDamageShare: 0.25,
    spellDamageShare: 0.8,
    shadowDamageShare: 0,
  },
  mage: {
    level20Dps: 36.133333,
    level20Hps: 0,
    attackPowerMultiplier: 0.2,
    spellPowerMultiplier: 1.2,
    meleeDamageShare: 0,
    spellDamageShare: 0.95,
    shadowDamageShare: 0,
  },
  warlock: {
    level20Dps: 29.933333,
    level20Hps: 0,
    attackPowerMultiplier: 0.25,
    spellPowerMultiplier: 1.15,
    meleeDamageShare: 0,
    spellDamageShare: 0.95,
    shadowDamageShare: 0.76,
  },
  druid: {
    level20Dps: 21.533333,
    level20Hps: 29,
    attackPowerMultiplier: 0.75,
    spellPowerMultiplier: 0.8,
    meleeDamageShare: 0.34,
    spellDamageShare: 0.74,
    shadowDamageShare: 0,
  },
};

type RollEdge = 'minimum' | 'maximum';

interface MetricSet {
  triggerCount: number;
  rngDrawCount: number;
  sustainedDamagePct: number;
  burstDamagePct: number;
  cleaveDamagePct: number;
  sustainedHealingPct: number;
  burstHealingPct: number;
  groupHealingPct: number;
  sustainedMitigationPct: number;
  burstMitigationPct: number;
  resourcePerMinute: number;
  silenceSecondsPerMinute: number;
  movementAveragePct: number;
  movementPeakPct: number;
  hastePeakPct: number;
  triggerRatePerMinute: number;
}

export interface LegendaryMetricRange {
  minimum: number;
  maximum: number;
}

export type LegendaryBalanceCategory =
  | 'single_target_damage'
  | 'conditional_damage'
  | 'cleave'
  | 'healing'
  | 'mitigation'
  | 'resource'
  | 'control'
  | 'mobility';

export interface LegendaryBalanceRow {
  powerId: string;
  powerName: string;
  playerClass: PlayerClass;
  profileId: LegendaryBuildProfileId;
  category: LegendaryBalanceCategory;
  samplesPerRollEdge: number;
  eventIntervalMs: number;
  elapsedSecondsPerRollEdge: number;
  minimumRolls: Readonly<Record<string, number>>;
  maximumRolls: Readonly<Record<string, number>>;
  triggerCount: LegendaryMetricRange;
  rngDrawCount: LegendaryMetricRange;
  sustainedDamagePct: LegendaryMetricRange;
  burstDamagePct: LegendaryMetricRange;
  cleaveDamagePct: LegendaryMetricRange;
  sustainedHealingPct: LegendaryMetricRange;
  burstHealingPct: LegendaryMetricRange;
  groupHealingPct: LegendaryMetricRange;
  sustainedMitigationPct: LegendaryMetricRange;
  burstMitigationPct: LegendaryMetricRange;
  resourcePerMinute: LegendaryMetricRange;
  silenceSecondsPerMinute: LegendaryMetricRange;
  movementAveragePct: LegendaryMetricRange;
  movementPeakPct: LegendaryMetricRange;
  hastePeakPct: LegendaryMetricRange;
  triggerRatePerMinute: LegendaryMetricRange;
  sustainedDamageGateApplicable: boolean;
  burstDamageGateApplicable: boolean;
  sustainedDamageGatePass: boolean | null;
  burstDamageGatePass: boolean | null;
}

export interface LegendaryBalanceSimulationOptions {
  samplesPerRollEdge?: number;
  seed?: number;
  profileIds?: readonly LegendaryBuildProfileId[];
  playerClasses?: readonly PlayerClass[];
  powerIds?: readonly string[];
}

export interface LegendaryBalanceReport {
  version: 1;
  seed: number;
  samplesPerRollEdge: number;
  burstWindowMs: number;
  areaTargets: number;
  profileIds: LegendaryBuildProfileId[];
  playerClasses: PlayerClass[];
  powerIds: string[];
  totalRows: number;
  totalEventSamples: number;
  sampleFloorMet: boolean;
  fullCoverage: boolean;
  rows: LegendaryBalanceRow[];
  gateFailures: string[];
  verdict: 'READY' | 'NOT_READY';
  deterministicFingerprint: string;
}

interface ContributionTotals {
  damage: number;
  cleaveDamage: number;
  healing: number;
  groupHealing: number;
  mitigation: number;
  resource: number;
  silenceSeconds: number;
  movementEquivalentSeconds: number;
  movementPeak: number;
  hastePeak: number;
}

class RollingMaximum {
  private readonly values: Array<{ atMs: number; value: number }> = [];
  private head = 0;
  private sum = 0;
  private maximum = 0;

  constructor(private readonly windowMs: number) {}

  add(atMs: number, value: number): void {
    if (value > 0) {
      this.values.push({ atMs, value });
      this.sum += value;
    }
    while (this.head < this.values.length && this.values[this.head].atMs <= atMs - this.windowMs) {
      this.sum -= this.values[this.head].value;
      this.head += 1;
    }
    this.maximum = Math.max(this.maximum, this.sum);
  }

  max(): number {
    return this.maximum;
  }
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function metricRange(minimum: number, maximum: number): LegendaryMetricRange {
  return {
    minimum: rounded(Math.min(minimum, maximum)),
    maximum: rounded(Math.max(minimum, maximum)),
  };
}

function rollsFor(
  definition: EquipmentPowerDefinition,
  edge: RollEdge,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(definition.rolls).map(([key, roll]) => [
      key,
      edge === 'minimum' ? roll.min : roll.max,
    ]),
  );
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function seedFor(baseSeed: number, ...parts: readonly string[]): number {
  return Number.parseInt(fnv1a(`${baseSeed}:${parts.join(':')}`), 16) >>> 0;
}

function categoryFor(definition: EquipmentPowerDefinition): LegendaryBalanceCategory {
  if (definition.id === 'nightglass_fang') return 'conditional_damage';
  if (definition.effects.some((effect) => effect.kind === 'chain_damage')) return 'cleave';
  if (
    definition.effects.some((effect) =>
      ['area_damage', 'apply_dot', 'apply_mark'].includes(effect.kind),
    )
  ) {
    return 'single_target_damage';
  }
  if (
    definition.effects.some((effect) => ['area_heal', 'create_ground_area'].includes(effect.kind))
  ) {
    return 'healing';
  }
  if (
    definition.effects.some(
      (effect) =>
        effect.kind === 'grant_shield' ||
        (effect.kind === 'grant_buff' && effect.tag === 'damage_reduction'),
    )
  ) {
    return 'mitigation';
  }
  if (definition.effects.some((effect) => effect.kind === 'restore_resource')) return 'resource';
  if (definition.effects.some((effect) => effect.kind === 'apply_silence')) return 'control';
  return 'mobility';
}

function classesFor(definition: EquipmentPowerDefinition): readonly PlayerClass[] {
  if (definition.requiredClass) return [definition.requiredClass];
  if (!definition.compatibleBaseIds) return LEGENDARY_BALANCE_CLASSES;

  const compatibleClasses = new Set<PlayerClass>();
  for (const baseId of definition.compatibleBaseIds) {
    const base = PROCEDURAL_ITEM_BASES[baseId];
    if (!base) throw new Error(`unknown compatible base ${baseId} for ${definition.id}`);
    if (!base.requiredClass) return LEGENDARY_BALANCE_CLASSES;
    for (const playerClass of base.requiredClass) compatibleClasses.add(playerClass);
  }
  return LEGENDARY_BALANCE_CLASSES.filter((playerClass) => compatibleClasses.has(playerClass));
}

function baseIntervalMs(definition: EquipmentPowerDefinition): number {
  switch (definition.trigger.event) {
    case 'ability_cast':
      if (definition.id === 'feral_moonclasp') return 1_500;
      return 2_500;
    case 'weapon_hit':
      return 2_000;
    case 'spell_damage':
      return 1_800;
    case 'heal':
      return 2_500;
    case 'kill':
      return 12_000;
    case 'health_changed':
      return 45_000;
    case 'movement':
      return 1_000;
    case 'damage_taken':
      return 2_000;
  }
}

function intervalMsFor(
  definition: EquipmentPowerDefinition,
  profile: LegendaryBuildProfile,
): number {
  const cadenceScaled =
    definition.trigger.event === 'ability_cast' ||
    definition.trigger.event === 'weapon_hit' ||
    definition.trigger.event === 'spell_damage' ||
    definition.trigger.event === 'heal' ||
    definition.trigger.event === 'kill';
  const multiplier = cadenceScaled ? profile.cadenceMultiplier : 1;
  return Math.max(1, Math.round(baseIntervalMs(definition) * multiplier));
}

function commandDurationSeconds(command: EquipmentEffectCommand): number {
  return Math.max(0.05, (command.durationMs ?? 1_000) / 1_000);
}

function eventBaseAmount(
  event: EquipmentEffectEvent,
  profile: LegendaryBuildProfile,
  model: ClassBalanceModel,
): number {
  if (event.amount !== undefined && Number.isFinite(event.amount) && event.amount > 0) {
    return event.amount;
  }
  const attackPower = profile.attackPower * model.attackPowerMultiplier;
  const spellPower = profile.spellPower * model.spellPowerMultiplier;
  return Math.max(1, Math.round(profile.level * 3 + attackPower * 0.15 + spellPower * 0.35));
}

function scaledAmount(
  event: EquipmentEffectEvent,
  command: EquipmentEffectCommand,
  profile: LegendaryBuildProfile,
  model: ClassBalanceModel,
): number {
  return Math.max(1, Math.round(eventBaseAmount(event, profile, model) * (command.magnitude ?? 1)));
}

function dotTotal(
  event: EquipmentEffectEvent,
  command: EquipmentEffectCommand,
  profile: LegendaryBuildProfile,
  model: ClassBalanceModel,
): number {
  const duration = commandDurationSeconds(command);
  const interval = Math.max(0.05, (command.intervalMs ?? command.durationMs ?? 1_000) / 1_000);
  const ticks = Math.max(1, Math.ceil(duration / interval));
  return Math.max(1, Math.round(scaledAmount(event, command, profile, model) / ticks)) * ticks;
}

function normalizedCriticalAmount(base: number, critical: boolean, critChance: number): number {
  const criticalMultiplier = 1.8;
  const normalized = base / (1 + critChance * (criticalMultiplier - 1));
  return normalized * (critical ? criticalMultiplier : 1);
}

function matchingEvent(
  definition: EquipmentPowerDefinition,
  playerClass: PlayerClass,
  profile: LegendaryBuildProfile,
  model: ClassBalanceModel,
  nowMs: number,
  intervalMs: number,
  critical: boolean,
): EquipmentEffectEvent {
  const spellEligible = model.spellDamageShare > 0;
  const kind =
    definition.trigger.event === 'spell_damage' && !spellEligible
      ? ('weapon_hit' as const)
      : definition.trigger.event;
  const intervalSeconds = intervalMs / 1_000;
  const dps = model.level20Dps * profile.throughputScale;
  const hps = model.level20Hps * profile.throughputScale;
  const event: EquipmentEffectEvent = {
    kind,
    nowMs,
    actorId: 1,
    actorClass: playerClass,
    targetId: 2,
    abilityId: definition.trigger.abilityIds?.[0],
    critical,
    healthBefore: profile.maxHealth * 0.4,
    healthAfter: profile.maxHealth * 0.3,
    maxHealth: profile.maxHealth,
    movementDistance: 5 * intervalSeconds,
  };
  if (kind === 'weapon_hit' && definition.trigger.event === 'weapon_hit') {
    event.amount = normalizedCriticalAmount(
      dps * intervalSeconds * model.meleeDamageShare,
      critical,
      profile.critChance,
    );
  } else if (kind === 'spell_damage') {
    event.amount = dps * intervalSeconds * model.spellDamageShare;
  } else if (kind === 'heal') {
    event.amount = normalizedCriticalAmount(hps * intervalSeconds, critical, profile.critChance);
  }
  return event;
}

function runEdge(
  definition: EquipmentPowerDefinition,
  playerClass: PlayerClass,
  profile: LegendaryBuildProfile,
  samples: number,
  seed: number,
  edge: RollEdge,
): MetricSet {
  const model = CLASS_MODELS[playerClass];
  const intervalMs = intervalMsFor(definition, profile);
  const durationSeconds = (samples * intervalMs) / 1_000;
  const durationMinutes = durationSeconds / 60;
  const dps = model.level20Dps * profile.throughputScale;
  const hps = model.level20Hps * profile.throughputScale;
  const incomingDps = profile.maxHealth / 20;
  const baselineDamage = dps * durationSeconds;
  const baselineHealing = hps * durationSeconds;
  const baselineIncoming = incomingDps * durationSeconds;
  const rng = new Rng(seed);
  let rngDrawCount = 0;
  rng.setObserver(() => {
    rngDrawCount += 1;
  });
  const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => rng.next());
  const power: ActiveEquipmentPower = {
    powerId: definition.id,
    powerRevision: definition.revision,
    itemLevel: profile.itemLevel,
    rolls: rollsFor(definition, edge),
  };
  const totals: ContributionTotals = {
    damage: 0,
    cleaveDamage: 0,
    healing: 0,
    groupHealing: 0,
    mitigation: 0,
    resource: 0,
    silenceSeconds: 0,
    movementEquivalentSeconds: 0,
    movementPeak: 0,
    hastePeak: 0,
  };
  const damageBurst = new RollingMaximum(LEGENDARY_BURST_WINDOW_MS);
  const healingBurst = new RollingMaximum(LEGENDARY_BURST_WINDOW_MS);
  const mitigationBurst = new RollingMaximum(LEGENDARY_BURST_WINDOW_MS);
  let triggerCount = 0;
  let markUntilMs = -1;
  let markMagnitude = 0;

  for (let index = 0; index < samples; index += 1) {
    const nowMs = index * intervalMs;
    const critical =
      definition.trigger.event === 'weapon_hit' || definition.trigger.criticalOnly === true
        ? rng.chance(profile.critChance)
        : false;
    const event = matchingEvent(
      definition,
      playerClass,
      profile,
      model,
      nowMs,
      intervalMs,
      critical,
    );
    const evaluation = runtime.evaluate(power, event);
    let eventDamage = 0;
    let eventHealing = 0;
    let eventMitigation = 0;
    if (evaluation.triggered) triggerCount += 1;

    for (const command of evaluation.commands) {
      switch (command.kind) {
        case 'area_damage': {
          const primary = scaledAmount(event, command, profile, model);
          eventDamage += primary;
          const targetCount = Math.min(LEGENDARY_AREA_TARGETS, command.maxTargets ?? 1);
          totals.cleaveDamage += primary * Math.max(0, targetCount - 1);
          break;
        }
        case 'apply_dot':
          eventDamage += dotTotal(event, command, profile, model);
          break;
        case 'chain_damage': {
          const secondary = scaledAmount(event, command, profile, model);
          const extraTargets = Math.min(
            Math.max(0, LEGENDARY_AREA_TARGETS - 1),
            command.maxTargets ?? 0,
          );
          totals.cleaveDamage += secondary * extraTargets;
          break;
        }
        case 'apply_mark':
          markUntilMs = nowMs + (command.durationMs ?? 0);
          markMagnitude = command.magnitude ?? 0;
          break;
        case 'create_ground_area': {
          if (command.tag !== 'healing') break;
          const interval = Math.max(0.05, (command.intervalMs ?? 1_000) / 1_000);
          const ticks = Math.max(1, Math.floor(commandDurationSeconds(command) / interval));
          const single = scaledAmount(event, command, profile, model) * ticks;
          eventHealing += single;
          totals.groupHealing += single * Math.max(1, command.maxTargets ?? 1);
          break;
        }
        case 'area_heal': {
          const single = scaledAmount(event, command, profile, model);
          eventHealing += single;
          totals.groupHealing += single * Math.max(1, command.maxTargets ?? 1);
          break;
        }
        case 'grant_shield':
          eventMitigation += scaledAmount(event, command, profile, model);
          break;
        case 'grant_buff': {
          const magnitude = command.magnitude ?? 0;
          const duration = commandDurationSeconds(command);
          if (command.tag === 'haste') {
            const contribution = dps * model.meleeDamageShare * magnitude * duration;
            eventDamage += contribution;
            totals.hastePeak = Math.max(totals.hastePeak, magnitude);
          } else if (command.tag === 'damage_reduction') {
            eventMitigation += incomingDps * magnitude * duration;
          } else if (command.tag === 'movement_speed') {
            totals.movementEquivalentSeconds += magnitude * duration;
            totals.movementPeak = Math.max(totals.movementPeak, magnitude);
          }
          break;
        }
        case 'restore_resource':
          totals.resource += Math.max(0, command.magnitude ?? 0);
          break;
        case 'apply_silence':
          totals.silenceSeconds += Math.max(
            0.05,
            command.magnitude !== undefined
              ? command.magnitude / 1_000
              : commandDurationSeconds(command),
          );
          break;
      }
    }

    if (markUntilMs > nowMs) {
      const baselineIntervalDamage = dps * (intervalMs / 1_000);
      eventDamage += baselineIntervalDamage * model.shadowDamageShare * markMagnitude;
    }

    totals.damage += eventDamage;
    totals.healing += eventHealing;
    totals.mitigation += eventMitigation;
    damageBurst.add(nowMs, eventDamage);
    healingBurst.add(nowMs, eventHealing);
    mitigationBurst.add(nowMs, eventMitigation);
  }

  return {
    triggerCount,
    rngDrawCount,
    sustainedDamagePct: rounded((totals.damage / Math.max(1, baselineDamage)) * 100),
    burstDamagePct: rounded(
      (damageBurst.max() / Math.max(1, dps * (LEGENDARY_BURST_WINDOW_MS / 1_000))) * 100,
    ),
    cleaveDamagePct: rounded((totals.cleaveDamage / Math.max(1, baselineDamage)) * 100),
    sustainedHealingPct: rounded((totals.healing / Math.max(1, baselineHealing)) * 100),
    burstHealingPct: rounded(
      (healingBurst.max() / Math.max(1, hps * (LEGENDARY_BURST_WINDOW_MS / 1_000))) * 100,
    ),
    groupHealingPct: rounded((totals.groupHealing / Math.max(1, baselineHealing)) * 100),
    sustainedMitigationPct: rounded((totals.mitigation / Math.max(1, baselineIncoming)) * 100),
    burstMitigationPct: rounded(
      (mitigationBurst.max() / Math.max(1, incomingDps * (LEGENDARY_BURST_WINDOW_MS / 1_000))) *
        100,
    ),
    resourcePerMinute: rounded(totals.resource / Math.max(1, durationMinutes)),
    silenceSecondsPerMinute: rounded(totals.silenceSeconds / Math.max(1, durationMinutes)),
    movementAveragePct: rounded(
      (totals.movementEquivalentSeconds / Math.max(1, durationSeconds)) * 100,
    ),
    movementPeakPct: rounded(totals.movementPeak * 100),
    hastePeakPct: rounded(totals.hastePeak * 100),
    triggerRatePerMinute: rounded(triggerCount / Math.max(1, durationMinutes)),
  };
}

function rowFor(
  definition: EquipmentPowerDefinition,
  playerClass: PlayerClass,
  profile: LegendaryBuildProfile,
  samples: number,
  seed: number,
): LegendaryBalanceRow {
  const minimum = runEdge(
    definition,
    playerClass,
    profile,
    samples,
    seedFor(seed, definition.id, playerClass, profile.id),
    'minimum',
  );
  const maximum = runEdge(
    definition,
    playerClass,
    profile,
    samples,
    seedFor(seed, definition.id, playerClass, profile.id),
    'maximum',
  );
  const category = categoryFor(definition);
  const intervalMs = intervalMsFor(definition, profile);
  const sustainedDamageGateApplicable =
    category === 'single_target_damage' &&
    (definition.trigger.event !== 'spell_damage' || CLASS_MODELS[playerClass].spellDamageShare > 0);
  const burstDamageGateApplicable =
    sustainedDamageGateApplicable || category === 'conditional_damage';
  const sustainedDamage = metricRange(minimum.sustainedDamagePct, maximum.sustainedDamagePct);
  const burstDamage = metricRange(minimum.burstDamagePct, maximum.burstDamagePct);

  return {
    powerId: definition.id,
    powerName: definition.name,
    playerClass,
    profileId: profile.id,
    category,
    samplesPerRollEdge: samples,
    eventIntervalMs: intervalMs,
    elapsedSecondsPerRollEdge: rounded((samples * intervalMs) / 1_000),
    minimumRolls: rollsFor(definition, 'minimum'),
    maximumRolls: rollsFor(definition, 'maximum'),
    triggerCount: metricRange(minimum.triggerCount, maximum.triggerCount),
    rngDrawCount: metricRange(minimum.rngDrawCount, maximum.rngDrawCount),
    sustainedDamagePct: sustainedDamage,
    burstDamagePct: burstDamage,
    cleaveDamagePct: metricRange(minimum.cleaveDamagePct, maximum.cleaveDamagePct),
    sustainedHealingPct: metricRange(minimum.sustainedHealingPct, maximum.sustainedHealingPct),
    burstHealingPct: metricRange(minimum.burstHealingPct, maximum.burstHealingPct),
    groupHealingPct: metricRange(minimum.groupHealingPct, maximum.groupHealingPct),
    sustainedMitigationPct: metricRange(
      minimum.sustainedMitigationPct,
      maximum.sustainedMitigationPct,
    ),
    burstMitigationPct: metricRange(minimum.burstMitigationPct, maximum.burstMitigationPct),
    resourcePerMinute: metricRange(minimum.resourcePerMinute, maximum.resourcePerMinute),
    silenceSecondsPerMinute: metricRange(
      minimum.silenceSecondsPerMinute,
      maximum.silenceSecondsPerMinute,
    ),
    movementAveragePct: metricRange(minimum.movementAveragePct, maximum.movementAveragePct),
    movementPeakPct: metricRange(minimum.movementPeakPct, maximum.movementPeakPct),
    hastePeakPct: metricRange(minimum.hastePeakPct, maximum.hastePeakPct),
    triggerRatePerMinute: metricRange(minimum.triggerRatePerMinute, maximum.triggerRatePerMinute),
    sustainedDamageGateApplicable,
    burstDamageGateApplicable,
    sustainedDamageGatePass: sustainedDamageGateApplicable
      ? sustainedDamage.minimum >= LEGENDARY_SUSTAINED_MIN_PCT &&
        sustainedDamage.maximum <= LEGENDARY_SUSTAINED_MAX_PCT
      : null,
    burstDamageGatePass: burstDamageGateApplicable
      ? burstDamage.maximum <= LEGENDARY_BURST_MAX_PCT
      : null,
  };
}

function includesAll<T>(selected: readonly T[], required: readonly T[]): boolean {
  return required.every((entry) => selected.includes(entry));
}

export function simulateLegendaryBalance(
  options: LegendaryBalanceSimulationOptions = {},
): LegendaryBalanceReport {
  const samples = options.samplesPerRollEdge ?? LEGENDARY_BALANCE_SAMPLE_FLOOR;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1_000_000) {
    throw new Error('samples per roll edge must be an integer from 1 to 1000000');
  }
  const seed = options.seed ?? 0x1e9e7da;
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');

  const requestedProfiles = options.profileIds ?? LEGENDARY_BUILD_PROFILES.map((entry) => entry.id);
  const profiles = LEGENDARY_BUILD_PROFILES.filter((profile) =>
    requestedProfiles.includes(profile.id),
  );
  if (profiles.length !== new Set(requestedProfiles).size) {
    throw new Error('unknown or duplicate legendary build profile');
  }
  const requestedClasses = options.playerClasses ?? LEGENDARY_BALANCE_CLASSES;
  const playerClasses = LEGENDARY_BALANCE_CLASSES.filter((entry) =>
    requestedClasses.includes(entry),
  );
  if (playerClasses.length !== new Set(requestedClasses).size) {
    throw new Error('unknown or duplicate legendary balance class');
  }
  const allDefinitions = Object.values(PROCEDURAL_LEGENDARY_POWERS);
  const requestedPowerIds = options.powerIds ?? allDefinitions.map((entry) => entry.id);
  const definitions = allDefinitions.filter((entry) => requestedPowerIds.includes(entry.id));
  if (definitions.length !== new Set(requestedPowerIds).size) {
    throw new Error('unknown or duplicate legendary power id');
  }

  const rows: LegendaryBalanceRow[] = [];
  for (const definition of definitions) {
    for (const playerClass of classesFor(definition)) {
      if (!playerClasses.includes(playerClass)) continue;
      for (const profile of profiles) {
        rows.push(rowFor(definition, playerClass, profile, samples, seed));
      }
    }
  }
  const profileIds = profiles.map((entry) => entry.id);
  const powerIds = definitions.map((entry) => entry.id);
  const fullCoverage =
    includesAll(
      profileIds,
      LEGENDARY_BUILD_PROFILES.map((entry) => entry.id),
    ) &&
    includesAll(playerClasses, LEGENDARY_BALANCE_CLASSES) &&
    includesAll(
      powerIds,
      Object.values(PROCEDURAL_LEGENDARY_POWERS).map((entry) => entry.id),
    );
  const gateFailures = rows.flatMap((row) => {
    const failures: string[] = [];
    if (row.sustainedDamageGatePass === false) {
      failures.push(
        `${row.powerId}/${row.playerClass}/${row.profileId} sustained ` +
          `${row.sustainedDamagePct.minimum.toFixed(3)} to ` +
          `${row.sustainedDamagePct.maximum.toFixed(3)} percent`,
      );
    }
    if (row.burstDamageGatePass === false) {
      failures.push(
        `${row.powerId}/${row.playerClass}/${row.profileId} burst ` +
          `${row.burstDamagePct.maximum.toFixed(3)} percent`,
      );
    }
    return failures;
  });
  const reportWithoutFingerprint = {
    version: 1 as const,
    seed,
    samplesPerRollEdge: samples,
    burstWindowMs: LEGENDARY_BURST_WINDOW_MS,
    areaTargets: LEGENDARY_AREA_TARGETS,
    profileIds,
    playerClasses,
    powerIds,
    totalRows: rows.length,
    totalEventSamples: rows.length * samples * 2,
    sampleFloorMet: samples >= LEGENDARY_BALANCE_SAMPLE_FLOOR,
    fullCoverage,
    rows,
    gateFailures,
    verdict:
      samples >= LEGENDARY_BALANCE_SAMPLE_FLOOR && fullCoverage && gateFailures.length === 0
        ? ('READY' as const)
        : ('NOT_READY' as const),
  };
  return {
    ...reportWithoutFingerprint,
    deterministicFingerprint: fnv1a(JSON.stringify(reportWithoutFingerprint)),
  };
}

export function assertLegendaryBalanceRelease(report: LegendaryBalanceReport): void {
  const failures: string[] = [];
  if (!report.sampleFloorMet) {
    failures.push(
      `sample floor not met: ${report.samplesPerRollEdge} < ${LEGENDARY_BALANCE_SAMPLE_FLOOR}`,
    );
  }
  if (!report.fullCoverage) failures.push('all powers, classes, and build profiles are required');
  failures.push(...report.gateFailures);
  if (failures.length > 0) {
    throw new Error(`legendary balance gate failed:\n${failures.join('\n')}`);
  }
}

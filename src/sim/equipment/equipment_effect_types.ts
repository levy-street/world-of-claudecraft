import type { PlayerClass } from '../types';

export const MAX_EQUIPMENT_PROC_DEPTH = 4;

export type EquipmentEventKind =
  | 'ability_cast'
  | 'damage_taken'
  | 'heal'
  | 'health_changed'
  | 'kill'
  | 'movement'
  | 'spell_damage'
  | 'weapon_hit';

export interface EquipmentEffectEvent {
  kind: EquipmentEventKind;
  nowMs: number;
  actorId: number;
  actorClass: PlayerClass;
  targetId?: number;
  abilityId?: string;
  critical?: boolean;
  amount?: number;
  healthBefore?: number;
  healthAfter?: number;
  maxHealth?: number;
  movementDistance?: number;
  procDepth?: number;
}

export type EquipmentEffectTarget =
  | 'self'
  | 'event_target'
  | 'area_around_self'
  | 'area_around_target';

export type EquipmentEffectKind =
  | 'apply_dot'
  | 'apply_mark'
  | 'apply_silence'
  | 'area_damage'
  | 'area_heal'
  | 'chain_damage'
  | 'create_ground_area'
  | 'grant_buff'
  | 'grant_shield'
  | 'restore_resource';

export interface EquipmentPowerRollDefinition {
  min: number;
  max: number;
  step: number;
}

export interface EquipmentPowerMagnitude {
  base?: number;
  itemLevelScale?: number;
  rollKey?: string;
  rollScale?: number;
  minimum?: number;
  maximum?: number;
}

export interface EquipmentPowerEffectTemplate {
  kind: EquipmentEffectKind;
  target: EquipmentEffectTarget;
  magnitude?: EquipmentPowerMagnitude;
  durationMs?: number;
  intervalMs?: number;
  radius?: number;
  maxTargets?: number;
  tag?: string;
}

export interface EquipmentPowerHealthCrossing {
  direction: 'below' | 'above';
  fraction: number;
}

export interface EquipmentPowerTrigger {
  event: EquipmentEventKind;
  abilityIds?: readonly string[];
  criticalOnly?: boolean;
  every?: number;
  chance?: number;
  internalCooldownMs?: number;
  healthCrossing?: EquipmentPowerHealthCrossing;
  accumulatedMovement?: number;
}

export interface EquipmentPowerDefinition {
  id: string;
  revision: 1;
  name: string;
  description: string;
  requiredClass?: PlayerClass;
  compatibleBaseIds?: readonly string[];
  trigger: EquipmentPowerTrigger;
  rolls: Readonly<Record<string, EquipmentPowerRollDefinition>>;
  effects: readonly EquipmentPowerEffectTemplate[];
}

export interface EquippedPowerCandidate {
  slot: string;
  uid: string;
  powerId?: string;
}

export type ActiveEquipmentPowerSelection =
  | { status: 'none' }
  | { status: 'active'; powerId: string; uid: string; slot: string }
  | { status: 'invalid'; reason: 'multiple_active_powers'; powerIds: string[] };

export interface ActiveEquipmentPower {
  powerId: string;
  powerRevision: 1;
  itemLevel: number;
  rolls: Readonly<Record<string, number>>;
}

export interface EquipmentEffectCommand {
  kind: EquipmentEffectKind;
  sourcePowerId: string;
  sourcePowerRevision: 1;
  sourceActorId: number;
  targetId?: number;
  target: EquipmentEffectTarget;
  magnitude?: number;
  durationMs?: number;
  intervalMs?: number;
  radius?: number;
  maxTargets?: number;
  tag?: string;
  procDepth: number;
}

export interface EquipmentEffectEvaluation {
  triggered: boolean;
  reason:
    | 'triggered'
    | 'no_power'
    | 'unknown_power'
    | 'revision_mismatch'
    | 'class_mismatch'
    | 'event_mismatch'
    | 'ability_mismatch'
    | 'critical_required'
    | 'health_crossing_mismatch'
    | 'cadence_pending'
    | 'movement_pending'
    | 'internal_cooldown'
    | 'chance_failed'
    | 'proc_depth_limit';
  commands: EquipmentEffectCommand[];
}

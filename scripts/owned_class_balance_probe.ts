import { stoneboundThreatMultiplier } from '../src/sim/combat/shaman_warspirit';
import type { TalentAllocation } from '../src/sim/content/talents';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { updateMobTarget } from '../src/sim/mob/targeting';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  type EquipSlot,
  type PlayerClass,
  type SimEvent,
} from '../src/sim/types';
import { anchorProbeInOpenField } from './probe_anchor';

export type OwnedDpsSpec =
  | 'packlord'
  | 'coldsight'
  | 'fieldcraft'
  | 'thundercall'
  | 'warspirit'
  | 'vespers'
  | 'moongrove'
  | 'wildfang';

export type OwnedHealerSpec = 'spiritmend' | 'doctrine' | 'benison' | 'groveheart';

export interface OwnedClassBalanceScenario {
  targets: 1 | 3;
  seconds: 15 | 60 | 120 | 123;
  window: 'burst' | 'sustained' | 'raid';
  targetLevel?: 20 | 22 | 23 | 24;
  targetTemplateId?: 'training_dummy' | 'nythraxis_scourge_of_thornpeak';
}

export interface OwnedClassCombatOutcomes {
  hit: number;
  miss: number;
  dodge: number;
  parry: number;
  block: number;
  resist: number;
  // main's leash rework added an 'evade' outcome kind; probes must tally it or
  // the DamageEventKind index below stops typechecking.
  evade: number;
  crit: number;
}

export interface OwnedClassBalanceResult {
  head: string;
  seed: number;
  spec: OwnedDpsSpec;
  playerClass: PlayerClass;
  scenario: OwnedClassBalanceScenario;
  targetArmor: number;
  totalDamage: number;
  dps: number;
  outcomes: OwnedClassCombatOutcomes;
  damageByTarget: Record<string, number>;
  damageBySource: Record<string, number>;
  castsByAbility: Record<string, number>;
  cooldownUses: Record<string, number>;
  buttonsPressed: number;
  readyIdleSeconds: number;
  dualWielding: boolean;
  resource: {
    type: string | null;
    start: number;
    end: number;
    max: number;
  };
  stats: {
    attackPower: number;
    rangedAttackPower: number;
    spellPower: number;
  };
  equipment: Record<string, string | null>;
  talents: TalentAllocation;
}

export interface OwnedHealerBalanceResult {
  head: string;
  seed: number;
  spec: OwnedHealerSpec;
  allies: 1 | 3;
  seconds: number;
  effectiveHealing: number;
  healingBySource: Record<string, number>;
  hps: number;
  overhealing: number;
  overhealPct: number;
  absorbedDamage: number;
  damage: number;
  dps: number;
  preparedHealing: number;
  emergencyRecoverySeconds: number | null;
  castsByAbility: Record<string, number>;
  resource: { start: number; end: number; max: number };
  equipment: Record<string, string | null>;
  talents: TalentAllocation;
}

export interface OwnedClassDpsAverage {
  spec: OwnedDpsSpec;
  scenario: OwnedClassBalanceScenario;
  seeds: readonly number[];
  dps: number;
  resourceEnd: number;
  buttonsPressed: number;
  readyIdleSeconds: number;
  outcomes: OwnedClassCombatOutcomes;
}

export interface OwnedHealerAverage {
  spec: OwnedHealerSpec;
  allies: 1 | 3;
  seeds: readonly number[];
  hps: number;
  dps: number;
  overhealPct: number;
  absorbedDamage: number;
  emergencyRecoverySeconds: number;
  resourceEnd: number;
}

export interface WarspiritOfftankResult {
  head: string;
  seed: number;
  rawIncomingDamage: number;
  galeheartIncomingDamage: number;
  stoneboundIncomingDamage: number;
  stoneboundMitigationPct: number;
  stoneboundThreatFrom100Damage: number;
  forcedTargetUptimeSeconds: number;
  secondsToLoseThreatAfterLeaving: number;
}

type ProbeSim = Sim & {
  addEntity(entity: Entity): void;
  rebucket(entity: Entity): void;
  nextId: number;
};

interface Fixture {
  cls: PlayerClass;
  talentSpec: string;
  talentRows?: Record<number, string>;
  distance: number;
  hunterPet: boolean;
}

type PbeLoadout = Readonly<Partial<Record<EquipSlot, string>>>;

interface RunState {
  sim: ProbeSim;
  spec: OwnedDpsSpec;
  targets: Entity[];
  primary: Entity;
  castsByAbility: Record<string, number>;
  cooldownUses: Record<string, number>;
  buttonsPressed: number;
  readyIdleTicks: number;
}

export const OWNED_CLASS_BALANCE_SCENARIOS: readonly OwnedClassBalanceScenario[] = [
  { targets: 1, seconds: 15, window: 'burst' },
  { targets: 1, seconds: 60, window: 'sustained' },
  { targets: 3, seconds: 15, window: 'burst' },
  { targets: 3, seconds: 60, window: 'sustained' },
] as const;

export const OWNED_CLASS_LEVEL_20_BOSS_SCENARIO: OwnedClassBalanceScenario = {
  targets: 1,
  seconds: 120,
  window: 'raid',
  targetLevel: 20,
  targetTemplateId: 'nythraxis_scourge_of_thornpeak',
};

export const OWNED_CLASS_RAID_SCENARIOS: readonly OwnedClassBalanceScenario[] = [
  {
    targets: 1,
    seconds: 120,
    window: 'raid',
    targetLevel: 22,
    targetTemplateId: 'nythraxis_scourge_of_thornpeak',
  },
  {
    targets: 1,
    seconds: 120,
    window: 'raid',
    targetLevel: 23,
    targetTemplateId: 'nythraxis_scourge_of_thornpeak',
  },
  {
    targets: 1,
    seconds: 120,
    window: 'raid',
    targetLevel: 24,
    targetTemplateId: 'nythraxis_scourge_of_thornpeak',
  },
] as const;

export const OWNED_DPS_SPECS: readonly OwnedDpsSpec[] = [
  'packlord',
  'coldsight',
  'fieldcraft',
  'thundercall',
  'warspirit',
  'vespers',
  'moongrove',
  'wildfang',
] as const;

const FIXTURES: Record<OwnedDpsSpec, Fixture> = {
  packlord: { cls: 'hunter', talentSpec: 'beast_mastery', distance: 20, hunterPet: true },
  coldsight: { cls: 'hunter', talentSpec: 'marksmanship', distance: 20, hunterPet: true },
  fieldcraft: { cls: 'hunter', talentSpec: 'survival', distance: 12, hunterPet: true },
  thundercall: { cls: 'shaman', talentSpec: 'elemental', distance: 18, hunterPet: false },
  warspirit: { cls: 'shaman', talentSpec: 'enhancement', distance: 3, hunterPet: false },
  vespers: { cls: 'priest', talentSpec: 'shadow', distance: 18, hunterPet: false },
  moongrove: {
    cls: 'druid',
    talentSpec: 'balance',
    talentRows: {
      14: 'dru_r14_moonfury',
      20: 'dru_r20_improved_hurricane',
    },
    distance: 18,
    hunterPet: false,
  },
  wildfang: {
    cls: 'druid',
    talentSpec: 'feral',
    talentRows: {
      14: 'dru_r14_savage_fury',
      20: 'dru_r20_improved_hurricane',
    },
    distance: 3,
    hunterPet: false,
  },
};

// Fixed level-20 PBE loadouts. These deliberately use exact item ids instead of
// "best available" discovery so a new item cannot silently rewrite the balance
// baseline. Each class keeps its intended raid set, including its 4-piece bonus.
const HUNTER_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'heroic_direfang_greatblade',
  helmet: 'heroic_nighttalon_crown',
  neck: 'yumis_keepsake_locket',
  shoulder: 'heroic_nighttalon_shoulderguards',
  chest: 'heroic_wyrmshadow_harness',
  waist: 'nighttalon_waistband',
  legs: 'tidewoven_trousers',
  gloves: 'nighttalon_grips',
  feet: 'bonechill_striders',
  ring1: 'sutils_gambit',
  ring2: 'sutils_gambit',
};

const THUNDERCALL_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'stormcallers_focus',
  offhand: 'heroic_wraithfire_orb',
  helmet: 'heroic_stormcallers_crown',
  neck: 'zense_meridian',
  shoulder: 'heroic_stormcallers_spaulders',
  chest: 'shroud_of_the_gravewyrm',
  waist: 'stormcallers_waistguard',
  legs: 'lunar_choir_leggings',
  gloves: 'stormcallers_handguards',
  feet: 'shadowpulse_slippers',
  ring1: 'architects_cornerstone',
  ring2: 'architects_cornerstone',
};

const WARSPIRIT_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'gravewyrm_cleaver',
  offhand: 'gravewyrm_cleaver',
  helmet: 'heroic_stormcallers_crown',
  neck: 'swiftfang_talisman',
  shoulder: 'heroic_stormcallers_spaulders',
  chest: 'morthens_cryptforged_hauberk',
  waist: 'stormcallers_waistguard',
  legs: 'heroic_deathlord_legguards',
  gloves: 'stormcallers_handguards',
  feet: 'tideworn_warboots',
  ring1: 'seal_of_the_nine_oaths',
  ring2: 'sutils_gambit',
};

const VESPERS_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'scepter_of_the_deathless_court',
  offhand: 'heroic_wraithfire_orb',
  helmet: 'heroic_soulflame_cowl',
  neck: 'zense_meridian',
  shoulder: 'heroic_soulflame_mantle',
  chest: 'shroud_of_the_gravewyrm',
  waist: 'soulflame_cord',
  legs: 'lunar_choir_leggings',
  gloves: 'soulflame_gloves',
  feet: 'shadowpulse_slippers',
  ring1: 'architects_cornerstone',
  ring2: 'architects_cornerstone',
};

const HEALER_SHAMAN_PBE_LOADOUT: PbeLoadout = THUNDERCALL_PBE_LOADOUT;
const HEALER_PRIEST_PBE_LOADOUT: PbeLoadout = VESPERS_PBE_LOADOUT;
// Groveheart heals from an intellect-leather set: the shared DRUID_PBE_LOADOUT
// is the agility set the two damage lanes are anchored on, and it starves the
// healer's mana pool at half the peer fixtures'.
const DRUID_HEALER_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'scepter_of_the_deathless_court',
  helmet: 'stormroot_cowl',
  neck: 'zense_meridian',
  shoulder: 'stormbark_mantle',
  chest: 'vestments_of_the_waking_grove',
  waist: 'lunarward_cinch',
  legs: 'heroic_wildgrowth_leggings',
  gloves: 'heroic_grovewardens_grips',
  feet: 'dreamroot_boots',
  ring1: 'nielas_coldlight_band',
  ring2: 'architects_cornerstone',
};
const DRUID_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'scepter_of_the_deathless_court',
  helmet: 'heroic_nighttalon_crown',
  neck: 'medallion_of_endless_profit',
  shoulder: 'heroic_nighttalon_shoulderguards',
  chest: 'scourgehide_carapace',
  waist: 'bonechill_cord',
  legs: 'heroic_wyrmshadow_legguards',
  gloves: 'heroic_wyrmshadow_talongrips',
  feet: 'heroic_wyrmshadow_treads',
  ring1: 'architects_cornerstone',
  ring2: 'nielas_coldlight_band',
};
// Moongrove is a spell caster: its best-in-slot is an intellect leather set
// (spell power at this level comes from intellect), not the agility set the
// melee Wildfang cat lanes are anchored on. Measuring a caster in agility gear
// hid its real gear scaling and forced its base numbers high. This fixed set
// is the greedy intellect pick over the epic pool (spellPower ~105), so the
// "full BiS" balance anchor reflects a caster the way the guide's gear-by-
// measurement axis intends.
const MOONGROVE_PBE_LOADOUT: PbeLoadout = {
  mainhand: 'heroic_wildheart_hexwood_staff',
  helmet: 'sunbone_oracles_crown',
  neck: 'zense_meridian',
  shoulder: 'voidweave_mantle',
  chest: 'verdant_heart_vestment',
  waist: 'lunarward_cinch',
  legs: 'necromancers_legwraps',
  gloves: 'shadowpulse_handwraps',
  feet: 'heroic_necromancers_soulsteps',
  ring1: 'architects_cornerstone',
  ring2: 'riftbound_band_of_insight',
};

export const OWNED_CLASS_PBE_LOADOUTS: Readonly<Record<OwnedDpsSpec, PbeLoadout>> = {
  packlord: HUNTER_PBE_LOADOUT,
  coldsight: HUNTER_PBE_LOADOUT,
  fieldcraft: HUNTER_PBE_LOADOUT,
  thundercall: THUNDERCALL_PBE_LOADOUT,
  warspirit: WARSPIRIT_PBE_LOADOUT,
  vespers: VESPERS_PBE_LOADOUT,
  moongrove: MOONGROVE_PBE_LOADOUT,
  wildfang: DRUID_PBE_LOADOUT,
};

// Fixed PBE builds keep balance evidence reproducible and make each profile use
// the talents that support its intended role. Hunter remains on its separately
// approved baseline fixture until its choice-row balance pass is specified.
export const OWNED_CLASS_PBE_TALENTS: Readonly<
  Partial<Record<OwnedDpsSpec | OwnedHealerSpec, TalentAllocation>>
> = {
  thundercall: {
    spec: 'elemental',
    rows: {
      5: 'sha_r5_imbue_mastery',
      8: 'sha_r8_frost_bind',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_elemental_fury',
    },
  },
  warspirit: {
    spec: 'enhancement',
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_tidal_waves',
    },
  },
  spiritmend: {
    spec: 'restoration',
    rows: {
      5: 'sha_r5_imbue_mastery',
      8: 'sha_r8_improved_earth_shock',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_bloodlust',
    },
  },
  // Druid v0.29 lanes (stacked #2218 + #2328 + druid): the engine-economy row
  // and capstone the pinned druid numbers were measured with; the matrix
  // overrides row 20 per capstone run. Groveheart's band profile runs bare.
  moongrove: {
    spec: 'balance',
    rows: { 14: 'dru_r14_moonfury', 20: 'dru_r20_improved_hurricane' },
  },
  wildfang: {
    spec: 'feral',
    rows: { 14: 'dru_r14_savage_fury', 20: 'dru_r20_improved_hurricane' },
  },
  groveheart: {
    spec: 'restoration',
    rows: {
      5: 'dru_r5_natures_bounty',
      8: 'dru_r8_improved_roots',
      11: 'dru_r11_innervate',
      14: 'dru_r14_empowered_touch',
      17: 'dru_r17_survival_of_the_fittest',
      20: 'dru_r20_berserk',
    },
  },
  doctrine: {
    spec: 'discipline',
    rows: {
      5: 'pri_r5_improved_renew',
      8: 'pri_r8_improved_shield',
      11: 'pri_r11_vampiric_embrace',
      14: 'pri_r11_meditation',
      17: 'pri_r17_anointing',
      20: 'pri_r20_twin_covenant',
    },
  },
  benison: {
    spec: 'holy',
    rows: {
      5: 'pri_r5_improved_renew',
      8: 'pri_r17_inner_fire',
      11: 'pri_r11_vampiric_embrace',
      14: 'pri_r11_meditation',
      17: 'pri_r17_choir_of_deliverance',
      20: 'pri_r20_second_verse',
    },
  },
  vespers: {
    spec: 'shadow',
    rows: {
      5: 'pri_r5_twisted_faith',
      8: 'pri_r17_inner_fire',
      11: 'pri_r8_psychic_scream',
      14: 'pri_r14_pain_and_suffering',
      17: 'pri_r17_anointing',
      20: 'pri_r20_incarnate_spirit',
    },
  },
};

function pbeTalents(spec: OwnedDpsSpec | OwnedHealerSpec, talentSpec: string): TalentAllocation {
  const profile = OWNED_CLASS_PBE_TALENTS[spec] ?? { spec: talentSpec, rows: {} };
  return { spec: profile.spec, rows: { ...profile.rows } };
}

function equipPbeLoadout(sim: Sim, spec: OwnedDpsSpec): void {
  equipExactLoadout(sim, OWNED_CLASS_PBE_LOADOUTS[spec]);
}

function equipExactLoadout(sim: Sim, loadout: PbeLoadout): void {
  for (const [slot, itemId] of Object.entries(loadout) as [EquipSlot, string][]) {
    if (!ITEMS[itemId]) throw new Error(`missing PBE fixture item ${itemId}`);
    sim.addItem(itemId, 1);
    sim.equipItemToSlot(itemId, slot);
  }
  const equipment = sim.players.get(sim.playerId)?.equipment;
  for (const [slot, itemId] of Object.entries(loadout) as [EquipSlot, string][]) {
    if (equipment?.[slot] !== itemId) {
      throw new Error(`failed to equip ${itemId} in ${slot}`);
    }
  }
}

function placeEntity(sim: ProbeSim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  sim.rebucket(entity);
}

function addTarget(
  sim: ProbeSim,
  xOffset: number,
  distance: number,
  scenario: OwnedClassBalanceScenario = {
    targets: 1,
    seconds: 60,
    window: 'sustained',
  },
): Entity {
  const targetLevel = scenario.targetLevel ?? 20;
  const armorTemplate = MOBS[scenario.targetTemplateId ?? 'training_dummy'];
  // Keep the target inert so this probe measures the class rotation, not the
  // Nythraxis encounter script. The named raid template supplies its real armor
  // curve while the training-dummy shell prevents boss casts, adds, and movement.
  const target = createMob(sim.nextId++, MOBS.training_dummy, targetLevel, {
    x: sim.player.pos.x + xOffset,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  target.hostile = true;
  target.stats.armor = Math.round(armorTemplate.armorPerLevel * (targetLevel - 1));
  target.aiState = 'idle';
  target.moveSpeed = 0;
  target.maxHp = 100_000_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 100;
  sim.addEntity(target);
  return target;
}

function addHunterPet(sim: ProbeSim, target: Entity): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: target.pos.x + 1,
    y: target.pos.y,
    z: target.pos.z - 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.maxHp = 1_000_000;
  pet.hp = pet.maxHp;
  pet.aggroTargetId = target.id;
  pet.inCombat = true;
  sim.addEntity(pet);
  return pet;
}

function ownAura(
  target: Entity,
  id: string,
  sourceId: number,
): Entity['auras'][number] | undefined {
  return target.auras.find((aura) => aura.id === id && aura.sourceId === sourceId);
}

function fullStacks(player: Entity, kind: string, stacks: number): boolean {
  return player.auras.some((aura) => aura.kind === kind && (aura.stacks ?? 0) >= stacks);
}

function hasAura(player: Entity, id: string): boolean {
  return player.auras.some((aura) => aura.id === id);
}

function aimAt(state: RunState, target: Entity): void {
  state.sim.targetEntity(target.id);
  state.sim.player.facing = Math.atan2(
    target.pos.x - state.sim.player.pos.x,
    target.pos.z - state.sim.player.pos.z,
  );
  state.sim.player.prevFacing = state.sim.player.facing;
}

function castFingerprint(sim: Sim, abilityId: string): string {
  const p = sim.player;
  return JSON.stringify([
    p.resource,
    p.gcdRemaining,
    p.castingAbility,
    p.cooldowns.get(abilityId) ?? null,
    p.auras.map((aura) => [aura.id, aura.stacks ?? null, aura.remaining]),
  ]);
}

function tryCast(
  state: RunState,
  abilityId: string,
  target: Entity = state.primary,
  groundTarget = false,
): boolean {
  const resolved = state.sim.resolvedAbility(abilityId);
  if (!resolved || state.sim.player.resource < resolved.cost) return false;
  aimAt(state, target);
  const before = castFingerprint(state.sim, resolved.def.id);
  const resolvedId = resolved.def.id;
  const resolvedName = resolved.def.name;
  if (groundTarget) {
    state.sim.castAbility(abilityId, state.sim.playerId, { x: target.pos.x, z: target.pos.z });
  } else {
    state.sim.castAbility(abilityId);
  }
  if (castFingerprint(state.sim, resolvedId) === before) return false;
  state.buttonsPressed++;
  state.castsByAbility[resolvedName] = (state.castsByAbility[resolvedName] ?? 0) + 1;
  if (resolved.cooldown > 0) {
    state.cooldownUses[resolvedName] = (state.cooldownUses[resolvedName] ?? 0) + 1;
  }
  return true;
}

function castPacklord(state: RunState): void {
  if (fullStacks(state.sim.player, 'hunter_ferocity', 3) && tryCast(state, 'stampede')) {
    return;
  }
  if (state.sim.resolvedAbility('pack_command')?.def.id === 'unleash_beast') {
    if (tryCast(state, 'pack_command')) return;
  }
  if (tryCast(state, 'bestial_wrath')) return;
  if (state.sim.player.resource >= 75 && tryCast(state, 'arcane_shot')) return;
  if (tryCast(state, 'pack_command')) return;
  tryCast(state, 'arcane_shot');
}

function castColdsight(state: RunState): void {
  if (tryCast(state, 'cold_focus')) return;
  if (state.targets.length === 3 && tryCast(state, 'volley', state.primary, true)) return;
  if (tryCast(state, 'rapid_fire')) return;
  if (tryCast(state, 'aimed_shot')) return;
  tryCast(state, 'measured_shot');
}

function castFieldcraft(state: RunState): void {
  const wound = ownAura(state.primary, 'bloodhook_bleed', state.sim.playerId);
  const momentum =
    state.sim.player.auras.find((aura) => aura.id === 'hunting_momentum')?.stacks ?? 0;
  if (tryCast(state, 'bloodtrail_assault')) return;
  if (!wound) {
    if (dist2d(state.sim.player.pos, state.primary.pos) >= 8) {
      if (tryCast(state, 'bloodhook')) return;
    } else if (tryCast(state, 'trailbreak')) {
      return;
    }
  }
  if (wound && tryCast(state, 'shrapnel_charge')) return;
  if (wound && momentum >= 3 && tryCast(state, 'mongoose_bite')) return;
  if (wound && wound.remaining <= 3 && tryCast(state, 'mongoose_bite')) return;
  tryCast(state, 'raptor_strike');
}

function castThundercall(state: RunState): void {
  const thunder =
    state.sim.player.auras.find((aura) => aura.id === 'shaman_thunder_charges')?.stacks ?? 0;
  if (tryCast(state, 'primal_exaltation')) return;
  if (tryCast(state, 'elemental_mastery')) return;
  if (thunder >= 5) {
    if (state.targets.length === 3 && tryCast(state, 'earthquake', state.primary, true)) return;
    if (tryCast(state, 'earth_shock')) return;
  }
  const missingCinder = state.targets.find(
    (target) => !ownAura(target, 'flame_shock', state.sim.playerId),
  );
  if (missingCinder && thunder < 4 && tryCast(state, 'flame_shock', missingCinder)) return;
  if (state.targets.length === 3 && tryCast(state, 'chain_lightning')) return;
  tryCast(state, 'lightning_bolt');
}

function castWarspirit(state: RunState): void {
  if (tryCast(state, 'primal_exaltation')) return;
  if (hasAura(state.sim.player, 'shaman_stormcast') && tryCast(state, 'lightning_bolt')) return;
  if (tryCast(state, 'stormstrike')) return;
  if (!ownAura(state.primary, 'flame_shock', state.sim.playerId)) {
    if (tryCast(state, 'flame_shock')) return;
  }
  tryCast(state, 'earth_shock');
}

function castVespers(state: RunState): void {
  if (tryCast(state, 'power_infusion', state.sim.player)) return;
  if (fullStacks(state.sim.player, 'gloomtithe', 5) && tryCast(state, 'summon_tithefiend')) return;
  const missingDirge = state.targets.find((target) => {
    const dirge = ownAura(target, 'shadow_word_pain', state.sim.playerId);
    return !dirge || dirge.remaining <= 3;
  });
  if (missingDirge && tryCast(state, 'shadow_word_pain', missingDirge)) return;
  if (tryCast(state, 'mind_blast')) return;
  tryCast(state, 'mind_flay');
}

function castMoongrove(state: RunState): void {
  const missingTempest = state.targets.find((target) => {
    const tempest = ownAura(target, 'moonfire', state.sim.playerId);
    return !tempest || tempest.remaining <= 3;
  });
  if (missingTempest && tryCast(state, 'moonfire', missingTempest)) return;
  const moontide = state.sim.player.auras.find((aura) => aura.id === 'moontide');
  if ((moontide?.stacks ?? 0) >= 3) {
    // The spend choice: Sunwake when mana runs thin, Moonsurge otherwise.
    const lowMana = state.sim.player.resource < state.sim.player.maxResource * 0.4;
    if (tryCast(state, lowMana ? 'starfire' : 'moonseed')) return;
  }
  if (!state.sim.player.cooldowns.has('moonseed') && tryCast(state, 'moonseed')) return;
  tryCast(state, 'wrath');
}

function castWildfang(state: RunState): void {
  const flense = ownAura(state.primary, 'rake', state.sim.playerId);
  const bloodrift = ownAura(state.primary, 'rip', state.sim.playerId);
  const oldBlood = state.sim.player.auras.find((aura) => aura.id === 'old_blood');
  if ((oldBlood?.stacks ?? 0) >= 3 && state.sim.player.comboPoints >= 1) {
    // The long bleed timers make one builder after Bloodrift affordable, so
    // the detonation always carries at least a one-point bite.
    if (tryCast(state, 'ferocious_bite')) return;
  }
  if (state.sim.player.comboPoints >= 5 && !bloodrift) {
    if (tryCast(state, 'rip')) return;
  }
  if (!flense && tryCast(state, 'rake')) return;
  if (state.sim.player.comboPoints >= 5 && tryCast(state, 'ferocious_bite')) return;
  tryCast(state, 'claw');
}

function runRotation(state: RunState): void {
  const player = state.sim.player;
  if (player.dead || player.castingAbility || player.gcdRemaining > 0.001) return;
  if (player.chargeTargetId !== null) return;
  if (state.spec === 'packlord') castPacklord(state);
  else if (state.spec === 'coldsight') castColdsight(state);
  else if (state.spec === 'fieldcraft') castFieldcraft(state);
  else if (state.spec === 'thundercall') castThundercall(state);
  else if (state.spec === 'warspirit') castWarspirit(state);
  else if (state.spec === 'vespers') castVespers(state);
  else if (state.spec === 'moongrove') castMoongrove(state);
  else castWildfang(state);
}

function prepare(state: RunState): void {
  if (state.spec === 'packlord' || state.spec === 'coldsight' || state.spec === 'fieldcraft') {
    tryCast(state, 'aspect_of_the_hawk');
  } else if (state.spec === 'thundercall') {
    tryCast(state, 'flametongue_weapon');
  } else if (state.spec === 'warspirit') {
    tryCast(state, 'galeheart_weapon');
  } else if (state.spec === 'vespers') {
    tryCast(state, 'shadowform');
  } else if (state.spec === 'moongrove') {
    tryCast(state, 'moonkin_form');
  } else if (state.spec === 'wildfang') {
    tryCast(state, 'cat_form');
    state.sim.startAutoAttack();
  }
  state.sim.tick();
  state.sim.player.gcdRemaining = 0;
  state.sim.player.resource = state.sim.player.maxResource;
  state.sim.drainEvents();
  state.castsByAbility = {};
  state.cooldownUses = {};
  state.buttonsPressed = 0;
  state.readyIdleTicks = 0;
}

function ownedByPlayer(sim: Sim, sourceId: number, playerId: number): boolean {
  let source = sim.entities.get(sourceId);
  const visited = new Set<number>();
  while (source && !visited.has(source.id)) {
    if (source.id === playerId) return true;
    visited.add(source.id);
    source = source.ownerId === null ? undefined : sim.entities.get(source.ownerId);
  }
  return false;
}

function collectDamage(
  state: RunState,
  events: SimEvent[],
  byTarget: Record<string, number>,
  bySource: Record<string, number>,
  outcomes?: OwnedClassCombatOutcomes,
): number {
  let total = 0;
  for (const event of events) {
    if (event.type !== 'damage' || !ownedByPlayer(state.sim, event.sourceId, state.sim.playerId)) {
      continue;
    }
    const targetIndex = state.targets.findIndex((target) => target.id === event.targetId);
    if (targetIndex < 0) continue;
    if (outcomes) {
      outcomes[event.kind]++;
      if (event.crit) outcomes.crit++;
    }
    if (event.amount <= 0) continue;
    total += event.amount;
    const targetKey = `target_${targetIndex + 1}`;
    byTarget[targetKey] = (byTarget[targetKey] ?? 0) + event.amount;
    const sourceKey = event.ability ?? 'Auto Attack';
    bySource[sourceKey] = (bySource[sourceKey] ?? 0) + event.amount;
  }
  return total;
}

export function runOwnedClassDpsProbe(
  spec: OwnedDpsSpec,
  scenario: OwnedClassBalanceScenario,
  seed = 29_900,
  head = 'working-tree',
  talentRows?: Record<number, string>,
  // Gear tier axis: 'pbe' is the fixed best-in-slot loadout (the balance
  // anchor; Moongrove's is its intellect caster set), 'naked' equips nothing so
  // the base spell/weapon numbers alone drive the result. The naked tier
  // isolates un-geared spec parity, the same low-gear axis a leveling or
  // fresh-alt player experiences.
  gear: 'pbe' | 'naked' = 'pbe',
): OwnedClassBalanceResult {
  const fixture = FIXTURES[spec];
  const sim = new Sim({ seed, playerClass: fixture.cls, autoEquip: false }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  const talents = pbeTalents(spec, fixture.talentSpec);
  // Druid fixtures carry engine rows, and the druid matrix overrides the
  // capstone per run; both fold over the upstream PBE talent profile.
  talents.rows = { ...talents.rows, ...(fixture.talentRows ?? {}), ...(talentRows ?? {}) };
  if (!sim.applyTalents(talents)) {
    throw new Error(`failed to apply ${fixture.talentSpec}`);
  }
  if (gear === 'pbe') equipPbeLoadout(sim, spec);
  // Keep all three targets in one unobstructed cluster. The starter-world origin
  // has a static collider just left of the player, so a negative offset turns the
  // third target into a line-of-sight fixture instead of an area-damage fixture.
  const offsets = scenario.targets === 1 ? [0] : [0, 2, 4];
  const targets = offsets.map((offset) => addTarget(sim, offset, fixture.distance, scenario));
  if (fixture.hunterPet) addHunterPet(sim, targets[0]);
  sim.targetEntity(targets[0].id);
  sim.startAutoAttack();
  const state: RunState = {
    sim,
    spec,
    targets,
    primary: targets[0],
    castsByAbility: {},
    cooldownUses: {},
    buttonsPressed: 0,
    readyIdleTicks: 0,
  };
  prepare(state);

  const resourceStart = sim.player.resource;
  const damageByTarget = Object.fromEntries(targets.map((_, index) => [`target_${index + 1}`, 0]));
  const damageBySource: Record<string, number> = {};
  const outcomes: OwnedClassCombatOutcomes = {
    hit: 0,
    miss: 0,
    dodge: 0,
    parry: 0,
    block: 0,
    resist: 0,
    evade: 0,
    crit: 0,
  };
  let totalDamage = 0;
  for (let tick = 0; tick < scenario.seconds * 20; tick++) {
    const wasReady =
      !sim.player.dead &&
      !sim.player.castingAbility &&
      sim.player.gcdRemaining <= 0.001 &&
      sim.player.chargeTargetId === null;
    const buttonsBefore = state.buttonsPressed;
    runRotation(state);
    if (wasReady && state.buttonsPressed === buttonsBefore) state.readyIdleTicks++;
    totalDamage += collectDamage(state, sim.tick(), damageByTarget, damageBySource, outcomes);
  }
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  return {
    head,
    seed,
    spec,
    playerClass: fixture.cls,
    scenario,
    targetArmor: state.primary.stats.armor,
    totalDamage,
    dps: totalDamage / scenario.seconds,
    outcomes,
    damageByTarget,
    damageBySource,
    castsByAbility: state.castsByAbility,
    cooldownUses: state.cooldownUses,
    buttonsPressed: state.buttonsPressed,
    readyIdleSeconds: state.readyIdleTicks / 20,
    dualWielding: sim.player.dualWielding,
    resource: {
      type: sim.player.resourceType,
      start: resourceStart,
      end: sim.player.resource,
      max: sim.player.maxResource,
    },
    stats: {
      attackPower: sim.player.attackPower,
      rangedAttackPower: sim.player.rangedPower,
      spellPower: sim.player.spellPower,
    },
    equipment: { ...meta.equipment },
    talents,
  };
}

export function runOwnedClassDpsMatrix(
  seed = 29_900,
  head = 'working-tree',
): OwnedClassBalanceResult[] {
  return OWNED_DPS_SPECS.flatMap((spec) =>
    OWNED_CLASS_BALANCE_SCENARIOS.map((scenario) =>
      runOwnedClassDpsProbe(spec, scenario, seed, head),
    ),
  );
}

export function runOwnedClassRaidMatrix(
  seed = 29_930,
  head = 'working-tree',
): OwnedClassBalanceResult[] {
  return OWNED_DPS_SPECS.flatMap((spec) =>
    OWNED_CLASS_RAID_SCENARIOS.map((scenario) => runOwnedClassDpsProbe(spec, scenario, seed, head)),
  );
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageOwnedClassDpsProbe(
  spec: OwnedDpsSpec,
  scenario: OwnedClassBalanceScenario,
  seeds: readonly number[],
): OwnedClassDpsAverage {
  if (seeds.length === 0) throw new Error('DPS balance average requires at least one seed');
  const runs = seeds.map((seed) => runOwnedClassDpsProbe(spec, scenario, seed));
  return {
    spec,
    scenario,
    seeds: [...seeds],
    dps: average(runs.map((run) => run.dps)),
    resourceEnd: average(runs.map((run) => run.resource.end)),
    buttonsPressed: average(runs.map((run) => run.buttonsPressed)),
    readyIdleSeconds: average(runs.map((run) => run.readyIdleSeconds)),
    outcomes: {
      hit: average(runs.map((run) => run.outcomes.hit)),
      miss: average(runs.map((run) => run.outcomes.miss)),
      dodge: average(runs.map((run) => run.outcomes.dodge)),
      parry: average(runs.map((run) => run.outcomes.parry)),
      block: average(runs.map((run) => run.outcomes.block)),
      resist: average(runs.map((run) => run.outcomes.resist)),
      evade: average(runs.map((run) => run.outcomes.evade)),
      crit: average(runs.map((run) => run.outcomes.crit)),
    },
  };
}

function healerFixture(spec: OwnedHealerSpec): {
  cls: 'shaman' | 'priest' | 'druid';
  talentSpec: 'restoration' | 'discipline' | 'holy';
  loadout: PbeLoadout;
} {
  if (spec === 'groveheart') {
    return { cls: 'druid', talentSpec: 'restoration', loadout: DRUID_HEALER_PBE_LOADOUT };
  }
  if (spec === 'spiritmend') {
    return { cls: 'shaman', talentSpec: 'restoration', loadout: HEALER_SHAMAN_PBE_LOADOUT };
  }
  return {
    cls: 'priest',
    talentSpec: spec === 'doctrine' ? 'discipline' : 'holy',
    loadout: HEALER_PRIEST_PBE_LOADOUT,
  };
}

function lowestHealth(allies: readonly Entity[]): Entity {
  return [...allies].sort(
    (left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.id - right.id,
  )[0];
}

function healerCast(
  sim: Sim,
  caster: Entity,
  abilityId: string,
  target: Entity,
  castsByAbility: Record<string, number>,
): boolean {
  const resolved = sim.resolvedAbility(abilityId, caster.id);
  if (!resolved || caster.resource < resolved.cost) return false;
  sim.targetEntity(target.id, caster.id);
  caster.facing = Math.atan2(target.pos.x - caster.pos.x, target.pos.z - caster.pos.z);
  caster.prevFacing = caster.facing;
  const before = castFingerprint(sim, resolved.def.id);
  sim.castAbility(abilityId, caster.id);
  if (castFingerprint(sim, resolved.def.id) === before) return false;
  castsByAbility[resolved.def.name] = (castsByAbility[resolved.def.name] ?? 0) + 1;
  return true;
}

function runHealerRotation(
  spec: OwnedHealerSpec,
  sim: Sim,
  healer: Entity,
  allies: Entity[],
  enemy: Entity,
  castsByAbility: Record<string, number>,
): void {
  if (healer.dead || healer.castingAbility || healer.gcdRemaining > 0.001) return;
  const lowest = lowestHealth(allies);
  const injured = allies.filter((ally) => ally.hp / ally.maxHp < 0.82).length;
  if (spec === 'groveheart') {
    // The documented loop: harvest at full growth, keep Wildbloom on the whole
    // party and Second Bloom on the spike target, and fill every remaining
    // GCD with Wildmend while the garden ticks. A sow-only loop saturates its
    // GCDs re-seeding and under-measures the spec (the pooled-payoff lesson).
    if (
      healer.resource < healer.maxResource * 0.4 &&
      !healer.cooldowns.has('innervate') &&
      healerCast(sim, healer, 'innervate', healer, castsByAbility)
    ) {
      return;
    }
    const verdance = healer.auras.find((aura) => aura.id === 'verdance');
    if ((verdance?.stacks ?? 0) >= 5) {
      if (healerCast(sim, healer, 'swiftmend', lowest, castsByAbility)) return;
    }
    if (lowest.hp / lowest.maxHp < 0.55) {
      if (healerCast(sim, healer, 'healing_touch', lowest, castsByAbility)) return;
    }
    const unseeded = allies.find((ally) => !ownAura(ally, 'rejuvenation', healer.id));
    if (unseeded && healerCast(sim, healer, 'rejuvenation', unseeded, castsByAbility)) return;
    if (!ownAura(lowest, 'regrowth', healer.id)) {
      if (healerCast(sim, healer, 'regrowth', lowest, castsByAbility)) return;
    }
    if (lowest.hp / lowest.maxHp < 0.8) {
      healerCast(sim, healer, 'healing_touch', lowest, castsByAbility);
    }
    return;
  }
  if (spec === 'spiritmend') {
    if (healerCast(sim, healer, 'primal_exaltation', healer, castsByAbility)) return;
    const prepared = allies.filter((ally) =>
      ally.auras.some(
        (aura) => aura.id === 'shaman_mending_current' && aura.sourceId === healer.id,
      ),
    ).length;
    if (allies.length === 3 && prepared >= 2 && injured >= 2) {
      if (healerCast(sim, healer, 'chain_heal', lowest, castsByAbility)) return;
    }
    if (lowest.hp / lowest.maxHp < 0.55) {
      if (healerCast(sim, healer, 'tidecall', lowest, castsByAbility)) return;
    }
    healerCast(sim, healer, 'healing_wave', lowest, castsByAbility);
    return;
  }
  if (spec === 'doctrine') {
    if (healerCast(sim, healer, 'power_infusion', healer, castsByAbility)) return;
    const unlinked = allies.filter(
      (ally) =>
        !ally.auras.some((aura) => aura.id === 'priest_doctrine' && aura.sourceId === healer.id),
    );
    if (unlinked.length > 0) {
      if (healerCast(sim, healer, 'power_word_shield', lowestHealth(unlinked), castsByAbility)) {
        return;
      }
    }
    if (lowest.hp / lowest.maxHp < 0.42) {
      if (healerCast(sim, healer, 'scouring_mercy', lowest, castsByAbility)) return;
      if (healerCast(sim, healer, 'flash_heal', lowest, castsByAbility)) return;
    }
    healerCast(sim, healer, 'smite', enemy, castsByAbility);
    return;
  }
  const watched = allies.some((ally) =>
    ally.auras.some((aura) => aura.id === 'seraphic_vigil' && aura.sourceId === healer.id),
  );
  if (!watched && healerCast(sim, healer, 'seraphic_vigil', lowest, castsByAbility)) return;
  if (allies.length === 3 && injured >= 2) {
    if (healerCast(sim, healer, 'choir_of_deliverance', healer, castsByAbility)) return;
  }
  if (allies.length === 3 && injured >= 2) {
    if (healerCast(sim, healer, 'prayer_of_healing', healer, castsByAbility)) return;
  }
  if (lowest.hp / lowest.maxHp < 0.5) {
    if (healerCast(sim, healer, 'flash_heal', lowest, castsByAbility)) return;
  }
  healerCast(sim, healer, 'heal', lowest, castsByAbility);
}

export function runOwnedHealerProbe(
  spec: OwnedHealerSpec,
  allyCount: 1 | 3,
  seed = 29_910,
  head = 'working-tree',
  talentRows?: Record<number, string>,
  seconds = 60,
): OwnedHealerBalanceResult {
  const fixture = healerFixture(spec);
  const sim = new Sim({ seed, playerClass: fixture.cls, autoEquip: false }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  const talents = pbeTalents(spec, fixture.talentSpec);
  talents.rows = { ...talents.rows, ...(talentRows ?? {}) };
  if (!sim.applyTalents(talents)) {
    throw new Error(`failed to apply ${fixture.talentSpec}`);
  }
  equipExactLoadout(sim, fixture.loadout);
  const healer = sim.player;
  placeEntity(sim, healer, 720, 0);
  const allies: Entity[] = [];
  for (let index = 0; index < allyCount; index++) {
    const allyId = sim.addPlayer('warrior', `Balance Ally ${index + 1}`);
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing healer balance ally');
    placeEntity(sim, ally, 722 + index * 2, 0);
    sim.partyInvite(ally.id, healer.id);
    sim.partyAccept(ally.id);
    ally.hp = Math.max(1, Math.round(ally.maxHp * 0.35));
    allies.push(ally);
  }
  const enemy = addTarget(sim, 0, 10);
  enemy.weapon.min = 0;
  enemy.weapon.max = 0;
  healer.resource = healer.maxResource;
  const resourceStart = healer.resource;
  const castsByAbility: Record<string, number> = {};
  let effectiveHealing = 0;
  let overhealing = 0;
  let absorbedDamage = 0;
  const healingBySource: Record<string, number> = {};
  const originalApplyHeal = sim.ctx.applyHeal;
  sim.ctx.applyHeal = (...args): number => {
    // resolution is the LAST applyHeal parameter: the merge put #2428's
    // beaconTransferEligible/alreadyResolved flags ahead of it at 7 and 8.
    const callerResolution = args[9];
    const measured = { resolved: 0 };
    args[9] = measured;
    const effective = originalApplyHeal(...args);
    overhealing += Math.max(0, measured.resolved - effective);
    if (callerResolution) callerResolution.resolved = measured.resolved;
    return effective;
  };
  sim.drainEvents();

  let damage = 0;
  let emergencyRecoverySeconds: number | null = null;
  let recovered = false;
  for (let tick = 0; tick < seconds * 20; tick++) {
    runHealerRotation(spec, sim, healer, allies, enemy, castsByAbility);
    const events = sim.tick();
    for (const event of events) {
      if (event.type !== 'heal2' || event.sourceId !== healer.id) continue;
      effectiveHealing += event.amount;
      const ability = event.ability ?? 'Unknown';
      healingBySource[ability] = (healingBySource[ability] ?? 0) + event.amount;
    }
    damage += collectDamage(
      {
        sim,
        spec: 'vespers',
        targets: [enemy],
        primary: enemy,
        castsByAbility,
        cooldownUses: {},
        buttonsPressed: 0,
        readyIdleTicks: 0,
      },
      events,
      { target_1: 0 },
      {},
    );
    const elapsed = (tick + 1) / 20;
    if (!recovered && allies.every((ally) => ally.hp / ally.maxHp >= 0.8)) {
      recovered = true;
      emergencyRecoverySeconds = elapsed;
    }
    if (recovered && (tick + 1) % 20 === 0) {
      for (const ally of allies) {
        const pulse = Math.max(1, Math.round(ally.maxHp * 0.12));
        const absorbBefore = ally.auras.reduce(
          (total, aura) => total + (aura.kind === 'absorb' ? Math.max(0, aura.value) : 0),
          0,
        );
        sim.ctx.dealDamage(
          enemy,
          ally,
          pulse,
          false,
          'physical',
          'Balance Pressure',
          'hit',
          true,
          undefined,
          false,
        );
        const absorbAfter = ally.auras.reduce(
          (total, aura) => total + (aura.kind === 'absorb' ? Math.max(0, aura.value) : 0),
          0,
        );
        absorbedDamage += Math.max(0, absorbBefore - absorbAfter);
      }
    }
  }
  const preparedHealing = allies.reduce(
    (total, ally) =>
      total +
      (ally.auras.find(
        (aura) => aura.id === 'shaman_mending_current' && aura.sourceId === healer.id,
      )?.value ?? 0),
    0,
  );
  const meta = sim.players.get(healer.id);
  if (!meta) throw new Error('missing healer metadata');
  return {
    head,
    seed,
    spec,
    allies: allyCount,
    seconds,
    effectiveHealing,
    healingBySource,
    hps: effectiveHealing / seconds,
    overhealing,
    overhealPct:
      effectiveHealing + overhealing > 0 ? overhealing / (effectiveHealing + overhealing) : 0,
    absorbedDamage,
    damage,
    dps: damage / seconds,
    preparedHealing,
    emergencyRecoverySeconds,
    castsByAbility,
    resource: { start: resourceStart, end: healer.resource, max: healer.maxResource },
    equipment: { ...meta.equipment },
    talents,
  };
}

export function averageOwnedHealerProbe(
  spec: OwnedHealerSpec,
  allies: 1 | 3,
  seeds: readonly number[],
): OwnedHealerAverage {
  if (seeds.length === 0) throw new Error('healer balance average requires at least one seed');
  const runs = seeds.map((seed) => runOwnedHealerProbe(spec, allies, seed));
  return {
    spec,
    allies,
    seeds: [...seeds],
    hps: average(runs.map((run) => run.hps)),
    dps: average(runs.map((run) => run.dps)),
    overhealPct: average(runs.map((run) => run.overhealPct)),
    absorbedDamage: average(runs.map((run) => run.absorbedDamage)),
    emergencyRecoverySeconds: average(
      runs.map((run) => run.emergencyRecoverySeconds ?? run.seconds),
    ),
    resourceEnd: average(runs.map((run) => run.resource.end)),
  };
}

function incomingDamageForPosture(
  posture: 'galeheart_weapon' | 'rockbiter_weapon',
  seed: number,
): number {
  const sim = new Sim({ seed, playerClass: 'shaman', autoEquip: false }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec: 'enhancement', rows: {} } as never)) {
    throw new Error('failed to apply enhancement');
  }
  equipExactLoadout(sim, WARSPIRIT_PBE_LOADOUT);
  const attacker = createMob(sim.nextId++, MOBS.forest_wolf, 20, sim.groundPos(0, 3));
  attacker.hostile = true;
  attacker.hp = attacker.maxHp = 1_000_000;
  sim.addEntity(attacker);
  sim.player.gcdRemaining = 0;
  sim.castAbility(posture);
  sim.tick();
  if (posture === 'rockbiter_weapon') {
    sim.player.gcdRemaining = 0;
    sim.castAbility('lightning_shield');
    sim.tick();
  }
  sim.player.hp = sim.player.maxHp = 1_000_000;
  const before = sim.player.hp;
  for (let hit = 0; hit < 10; hit++) {
    sim.ctx.dealDamage(
      attacker,
      sim.player,
      100,
      false,
      'physical',
      'Benchmark Swing',
      'hit',
      false,
    );
  }
  return before - sim.player.hp;
}

export function runWarspiritOfftankProbe(
  seed = 29_920,
  head = 'working-tree',
): WarspiritOfftankResult {
  const galeheartIncomingDamage = incomingDamageForPosture('galeheart_weapon', seed);
  const stoneboundIncomingDamage = incomingDamageForPosture('rockbiter_weapon', seed);
  const sim = new Sim({ seed, playerClass: 'shaman', autoEquip: false }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec: 'enhancement', rows: {} } as never)) {
    throw new Error('failed to apply enhancement');
  }
  equipExactLoadout(sim, WARSPIRIT_PBE_LOADOUT);
  const rivalId = sim.addPlayer('warrior', 'Threat Rival');
  sim.setPlayerLevel(20, rivalId);
  const rival = sim.entities.get(rivalId);
  if (!rival) throw new Error('missing threat rival');
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, sim.groundPos(0, 3));
  target.hostile = true;
  target.hp = target.maxHp = 1_000_000;
  target.inCombat = true;
  target.aiState = 'attack';
  target.aggroTargetId = sim.player.id;
  target.threat.set(rival.id, 1_000);
  sim.addEntity(target);
  sim.player.gcdRemaining = 0;
  sim.castAbility('rockbiter_weapon');
  sim.tick();
  target.threat.clear();
  sim.ctx.dealDamage(sim.player, target, 100, false, 'physical', 'Threat Probe', 'hit', false, {
    mult: stoneboundThreatMultiplier(sim.ctx, sim.player),
  });
  const stoneboundThreatFrom100Damage = target.threat.get(sim.player.id) ?? 0;

  target.threat.set(rival.id, 1_000);
  target.threat.set(sim.player.id, 1_000);
  target.aggroTargetId = sim.player.id;
  target.forcedTargetId = sim.player.id;
  target.forcedTargetTimer = 3;
  let forcedTicks = 0;
  while (target.forcedTargetTimer > 0 && forcedTicks < 100) {
    updateMobTarget(sim.ctx, target);
    forcedTicks++;
  }
  sim.player.gcdRemaining = 0;
  sim.castAbility('galeheart_weapon');
  sim.tick();
  let secondsToLoseThreatAfterLeaving = 0;
  while (target.aggroTargetId === sim.player.id && secondsToLoseThreatAfterLeaving < 60) {
    secondsToLoseThreatAfterLeaving++;
    target.threat.set(rival.id, (target.threat.get(rival.id) ?? 0) + 25);
    updateMobTarget(sim.ctx, target);
  }
  const rawIncomingDamage = 1_000;
  return {
    head,
    seed,
    rawIncomingDamage,
    galeheartIncomingDamage,
    stoneboundIncomingDamage,
    stoneboundMitigationPct: 1 - stoneboundIncomingDamage / galeheartIncomingDamage,
    stoneboundThreatFrom100Damage,
    forcedTargetUptimeSeconds: forcedTicks / 20,
    secondsToLoseThreatAfterLeaving,
  };
}

function printResult(result: OwnedClassBalanceResult): void {
  const { scenario } = result;
  const targetLabel =
    scenario.window === 'raid' ? ` level ${scenario.targetLevel} armor ${result.targetArmor}` : '';
  console.log(
    `${result.spec.padEnd(12)} ${scenario.targets} target ${String(scenario.seconds).padStart(2)} sec ` +
      `${result.dps.toFixed(2).padStart(7)} DPS  buttons ${String(result.buttonsPressed).padStart(2)} ` +
      `${result.resource.type ?? 'none'} ${Math.round(result.resource.end)}/${result.resource.max}` +
      targetLabel,
  );
  const sources = Object.entries(result.damageBySource)
    .sort((left, right) => right[1] - left[1])
    .map(([ability, damage]) => `${ability}: ${damage}`)
    .join(', ');
  console.log(`  ${sources}`);
  if (scenario.window === 'raid') {
    const outcomes = result.outcomes;
    console.log(
      `  outcomes hit ${outcomes.hit}, miss ${outcomes.miss}, dodge ${outcomes.dodge}, ` +
        `parry ${outcomes.parry}, resist ${outcomes.resist}, crit ${outcomes.crit}`,
    );
  }
}

if (process.argv[1]?.endsWith('owned_class_balance_probe.ts')) {
  const head = process.env.WOC_BALANCE_HEAD ?? 'working-tree';
  for (const result of runOwnedClassDpsMatrix(29_900, head)) printResult(result);
  for (const result of runOwnedClassRaidMatrix(29_930, head)) printResult(result);
  for (const spec of ['spiritmend', 'doctrine', 'benison'] as const) {
    for (const allies of [1, 3] as const) {
      const result = runOwnedHealerProbe(spec, allies, 29_910, head);
      console.log(
        `${spec.padEnd(12)} ${allies} ${allies === 1 ? 'ally ' : 'allies'} 60 sec ` +
          `${result.hps.toFixed(2).padStart(7)} HPS  ${result.dps.toFixed(2).padStart(7)} DPS  ` +
          `overheal ${(result.overhealPct * 100).toFixed(1)}%  recovery ` +
          `${result.emergencyRecoverySeconds ?? 'never'} sec  mana ${Math.round(result.resource.end)}/${result.resource.max}`,
      );
    }
  }
  const offtank = runWarspiritOfftankProbe(29_920, head);
  console.log(
    `warspirit off-tank  Stonebound ${offtank.stoneboundIncomingDamage}/${offtank.galeheartIncomingDamage} ` +
      `incoming (${(offtank.stoneboundMitigationPct * 100).toFixed(1)}% less), ` +
      `${offtank.stoneboundThreatFrom100Damage} threat/100 damage, ` +
      `${offtank.forcedTargetUptimeSeconds.toFixed(1)} sec forced, ` +
      `${offtank.secondsToLoseThreatAfterLeaving} sec to lose threat`,
  );
}

// Focused heroic-Nythraxis healer comparison. Drives the REAL scripted encounter
// (Soul Rend stacking, Deathless Rage wardstone channels, add court) with a FIXED
// 10-player raid (2 tanks + 5 dps) and swaps ONLY the three healer slots, running a
// mono-healer trio per healer spec. Chronomancy gets an offensive-healer AI (keeps
// Temporal Echo on the tank, reactive Mend/Barrier, otherwise DPSes the boss so the
// Echo conversion actually flows); the pure healers heal normally. Reuses the setup
// + mechanic-handling logic from scripts/nythraxis_matrix.ts.
//
// Run: npx tsx scripts/nythraxis_healer_compare.ts
import {
  defaultBuild,
  type TalentAllocation,
  talentPointsAtLevel,
  validateAllocation,
} from '../src/sim/content/talents';
import { DUNGEONS, ITEMS, instanceOrigin, MOBS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  type EquipSlot,
  type ItemDef,
  MELEE_RANGE,
  type PlayerClass,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type Role = 'bossTank' | 'offTank' | 'healer' | 'dps';
type SpecKind = 'physical' | 'caster' | 'healer' | 'tank';
type Spec = {
  key: string;
  cls: PlayerClass;
  role: Role;
  kind: SpecKind;
  melee: boolean;
  talents: TalentAllocation;
  prepull?: string[];
  rotation: string[];
  healRotation?: string[];
  offensiveHealer?: boolean; // Chronomancy: heals by dealing Arcane damage
};

const SLOTS: EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];
const NYTHRAXIS_DROP_IDS = new Set(
  (MOBS.nythraxis_scourge_of_thornpeak.loot ?? [])
    .map((entry) => entry.itemId)
    .filter((id): id is string => !!id),
);

// ---- fixed non-healer comp (identical across every run) --------------------------
const protectionWarrior: Spec = {
  key: 'protection_warrior',
  cls: 'warrior',
  role: 'bossTank',
  kind: 'tank',
  melee: true,
  talents: {
    spec: 'prot',
    ranks: {
      war_toughness: 3,
      war_imp_heroic_strike: 2,
      war_tactical_choice: 1,
      prot_toughness: 3,
      prot_imp_thunder_clap: 2,
    },
    choices: { war_tactical_choice: 'tc_bladed_armor' },
  },
  rotation: ['defensive_stance', 'battle_shout', 'sunder_armor', 'shield_slam', 'thunder_clap', 'heroic_strike'],
};
const protectionPaladin: Spec = {
  key: 'protection_paladin',
  cls: 'paladin',
  role: 'offTank',
  kind: 'tank',
  melee: true,
  talents: {
    spec: 'protection',
    ranks: {
      pal_divine_strength: 3,
      pal_imp_devotion_aura: 2,
      pal_holy_calling: 1,
      prot_redoubt: 3,
      prot_imp_righteous_fury: 2,
    },
    choices: { pal_holy_calling: 'pal_calling_guardian' },
  },
  rotation: ['righteous_fury', 'devotion_aura', 'consecration', 'judgement', 'seal_of_righteousness'],
};
const fixedDps: Spec[] = [
  {
    key: 'fire_mage',
    cls: 'mage',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'fire',
      ranks: { mag_elemental_precision: 3, mag_flame_throwing: 2, mag_school_focus: 1, fire_imp_fireball: 3, fire_incinerate: 2 },
      choices: { mag_school_focus: 'mag_school_fire' },
    },
    prepull: ['arcane_intellect'],
    rotation: ['fire_blast', 'pyroblast', 'fireball', 'scorch'],
  },
  {
    key: 'combat_rogue',
    cls: 'rogue',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'combat',
      ranks: { rog_malice: 3, rog_imp_sinister: 2, rog_dirty_tricks: 1, combat_precision: 3, combat_dual_wield: 2 },
      choices: { rog_dirty_tricks: 'rog_trick_blade' },
    },
    rotation: ['instant_poison', 'adrenaline_rush', 'eviscerate', 'sinister_strike'],
  },
  {
    key: 'marksmanship_hunter',
    cls: 'hunter',
    role: 'dps',
    kind: 'physical',
    melee: false,
    talents: {
      spec: 'marksmanship',
      ranks: { hun_lethal_shots: 3, hun_efficiency: 2, mm_imp_arcane_shot: 3, mm_aimed_focus: 2, mm_barrage: 1 },
      choices: {},
    },
    rotation: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'aimed_shot', 'arcane_shot'],
  },
  {
    key: 'destruction_warlock',
    cls: 'warlock',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'destruction',
      ranks: { wlk_demonic_embrace: 3, wlk_cataclysm: 2, dest_cataclysm: 3, dest_bane: 3 },
      choices: {},
    },
    prepull: ['demon_skin'],
    rotation: ['shadowburn', 'immolate', 'corruption', 'curse_of_agony', 'shadow_bolt'],
  },
  {
    key: 'arms_warrior',
    cls: 'warrior',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'arms',
      ranks: { war_toughness: 3, war_imp_heroic_strike: 2, war_tactical_choice: 1, arms_imp_overpower: 2, arms_deep_wounds: 2 },
      choices: { war_tactical_choice: 'tc_bladed_armor' },
    },
    rotation: ['battle_shout', 'berserker_rage', 'execute', 'mortal_strike', 'slam', 'heroic_strike'],
  },
];

// ---- the healers under test (one mono-trio per run) -------------------------------
const HEALERS: Record<string, Spec> = {
  chronomancer: {
    key: 'chronomancer',
    cls: 'mage',
    role: 'healer',
    kind: 'healer',
    melee: false,
    offensiveHealer: true,
    talents: {
      spec: 'arcane',
      ranks: { mag_arcane_focus: 3, mag_elemental_precision: 2, mag_school_focus: 1, arc_imp_missiles: 3, arc_arcane_power: 2 },
      choices: { mag_school_focus: 'mag_school_arcane' },
    },
    prepull: ['arcane_intellect'],
    rotation: ['arcane_surge', 'arcane_missiles'], // offensive loop that drives Echo
    healRotation: ['temporal_mend', 'temporal_barrier'],
  },
  holy_priest: {
    key: 'holy_priest',
    cls: 'priest',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'holy',
      ranks: { pri_wand_specialization: 3, pri_meditation: 2, pri_inner_calling: 1, holy_healing_focus: 3, holy_divine_fury: 2 },
      choices: { pri_inner_calling: 'pri_calling_holy' },
    },
    rotation: ['smite'],
    healRotation: ['flash_heal', 'heal', 'lesser_heal'],
  },
  discipline_priest: {
    key: 'discipline_priest',
    cls: 'priest',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'discipline',
      ranks: { pri_wand_specialization: 3, pri_meditation: 2, pri_inner_calling: 1, disc_unbreakable_will: 3, disc_imp_shield: 2 },
      choices: { pri_inner_calling: 'pri_calling_disc' },
    },
    rotation: ['smite'],
    healRotation: ['power_word_shield', 'flash_heal', 'heal', 'lesser_heal'],
  },
  restoration_druid: {
    key: 'restoration_druid',
    cls: 'druid',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'restoration',
      ranks: { dru_natures_grasp: 3, dru_naturalist: 2, dru_natures_path: 1, rest_imp_rejuv: 3, rest_reflection: 2 },
      choices: { dru_natures_path: 'dru_path_resto' },
    },
    rotation: ['wrath'],
    healRotation: ['regrowth', 'healing_touch', 'rejuvenation'],
  },
  restoration_shaman: {
    key: 'restoration_shaman',
    cls: 'shaman',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'restoration',
      ranks: { sha_ancestral_knowledge: 3, sha_tidal_focus: 2, rest_tidal_focus: 3, rest_imp_healing_wave: 2, rest_choice: 1 },
      choices: { rest_choice: 'rest_choice_mana' },
    },
    rotation: ['lightning_bolt'],
    healRotation: ['chain_heal', 'healing_wave'],
  },
  holy_paladin: {
    key: 'holy_paladin',
    cls: 'paladin',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'holy',
      ranks: { pal_divine_strength: 3, pal_benediction: 2, pal_holy_calling: 1, holy_imp_holy_light: 3, holy_flash_focus: 2 },
      choices: { pal_holy_calling: 'pal_calling_light' },
    },
    rotation: ['exorcism'],
    healRotation: ['flash_of_light', 'holy_light'],
  },
};

// ---- setup helpers (ported from nythraxis_matrix.ts) ------------------------------
function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}
function face(source: Entity, target: Entity) {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}
function statScore(item: ItemDef, spec: Spec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  if (spec.kind === 'healer')
    return weapon + (s.int ?? 0) * 5.4 + (s.spi ?? 0) * 4.4 + (s.sta ?? 0) * 0.8 + (s.armor ?? 0) * 0.004;
  if (spec.kind === 'caster')
    return weapon * 2 + (s.int ?? 0) * 4.6 + (s.spi ?? 0) * 1.8 + (s.sta ?? 0) * 0.6 + (s.armor ?? 0) * 0.003;
  if (spec.kind === 'tank')
    return weapon * 5 + (s.sta ?? 0) * 5 + (s.str ?? 0) * 3 + (s.agi ?? 0) * 2 + (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'druid' ? 1.2 : 0) + (s.armor ?? 0) * 0.08;
  return weapon * 8 + (s.str ?? 0) * 3 + (s.agi ?? 0) * 3 + (s.sta ?? 0) + (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'shaman' ? 1.5 : 0) + (s.armor ?? 0) * 0.01;
}
function equipBest(sim: Sim, pid: number, spec: Spec) {
  for (const slot of SLOTS) {
    const item = Object.values(ITEMS)
      .filter((c) => !NYTHRAXIS_DROP_IDS.has(c.id) && c.slot === slot && (c.kind === 'weapon' || c.kind === 'armor') && canEquipItem(spec.cls, c))
      .sort((a, b) => statScore(b, spec) - statScore(a, spec))[0];
    if (item) {
      sim.addItem(item.id, 1, pid);
      sim.equipItem(item.id, pid);
    }
  }
}
function ensureTalents(sim: Sim, pid: number, spec: Spec) {
  const check = validateAllocation(spec.cls, spec.talents, talentPointsAtLevel(20));
  if (!check.ok) console.warn(`Invalid talents for ${spec.key}: ${check.reason}`);
  if (!sim.applyTalents(spec.talents, pid)) sim.applyTalents(defaultBuild(spec.cls, talentPointsAtLevel(20)), pid);
}
function livingAdds(sim: Sim) {
  return [...sim.entities.values()].filter((e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior' && !e.dead);
}
function cast(sim: Sim, pid: number, targetId: number, ability: string): boolean {
  const p = sim.entities.get(pid)!;
  if (p.dead || p.castingAbility) return false;
  p.targetId = targetId;
  const target = sim.entities.get(targetId);
  if (target) face(p, target);
  const before = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  sim.castAbility(ability, pid);
  const after = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  return before !== after;
}
function positionFor(spec: Spec, boss: Entity, i: number) {
  const range = spec.melee ? MELEE_RANGE - 1.2 : spec.role === 'healer' ? 16 : 22;
  const angle = (Math.PI * 2 * i) / 10;
  return { x: boss.pos.x + Math.sin(angle) * range, z: boss.pos.z - Math.cos(angle) * range };
}
function auraActive(entity: Entity, id: string, sourceId?: number): boolean {
  return entity.auras.some((a) => a.id === id && (sourceId === undefined || a.sourceId === sourceId) && a.remaining > 0.2);
}
function sunderStacks(target: Entity): number {
  return target.auras.find((a) => a.kind === 'sunder')?.stacks ?? 0;
}
const DOT_ABILITIES = new Set(['immolate', 'corruption', 'curse_of_agony', 'shadow_word_pain', 'serpent_sting', 'rupture']);
const SELF_BUFF_ABILITIES = new Set(['aspect_of_the_hawk', 'battle_shout', 'righteous_fury', 'devotion_aura', 'seal_of_righteousness', 'instant_poison', 'defensive_stance', 'demon_skin']);
function shouldTryAbility(caster: Entity, target: Entity, ability: string): boolean {
  if (DOT_ABILITIES.has(ability) && auraActive(target, ability, caster.id)) return false;
  if (SELF_BUFF_ABILITIES.has(ability) && auraActive(caster, ability)) return false;
  if ((ability === 'eviscerate' || ability === 'rupture') && caster.comboPoints < 5) return false;
  if (ability === 'heroic_strike' && caster.queuedOnSwing === ability) return false;
  if (ability === 'sunder_armor' && sunderStacks(target) >= 5) return false;
  if (ability === 'judgement' && !caster.auras.some((a) => a.kind === 'imbue' && a.value2 !== undefined)) return false;
  return true;
}
function threatLeadFor(add: Entity, tankPid: number): number {
  const tankThreat = add.threat.get(tankPid) ?? 0;
  let nextThreat = 0;
  for (const [pid, threat] of add.threat.entries()) if (pid !== tankPid) nextThreat = Math.max(nextThreat, threat);
  return tankThreat - nextThreat;
}
function secureAddThreat(add: Entity, tankPid: number, lead: number): void {
  const nextThreat = Math.max(0, ...[...add.threat.entries()].filter(([pid]) => pid !== tankPid).map(([, t]) => t));
  const current = add.threat.get(tankPid) ?? 0;
  if (add.aggroTargetId !== tankPid || current - nextThreat < lead) {
    add.threat.set(tankPid, Math.max(current, nextThreat + lead));
    add.aggroTargetId = tankPid;
  }
}

interface RunResult {
  healer: string;
  killed: boolean;
  breakReason: string;
  seconds: number;
  bossHpPct: number;
  raidDeaths: number;
  soulRendDeaths: number;
  deathlessDeaths: number;
  healerHps: number; // aggregate direct healing of the 3 healers
  healerEchoHps: number; // portion from Temporal Echo (chrono only)
  healerAbsorbPs: number; // aggregate damage soaked by healer shields / sec
  healerEffectivePs: number; // healing + absorption per sec (true throughput)
  healerDps: number; // aggregate boss dps from the 3 healers
  healerFirstOom: number | null;
  healerOomSeconds: number; // summed across the 3 healers
  healerMinManaPct: number; // lowest any healer dipped to
  deathBreakdown: Record<string, number>;
}

const SEED = Number(process.env.SEED ?? '42');
function runOne(healerSpec: Spec): RunResult {
  const sim = new Sim({ seed: SEED, noPlayer: true, playerClass: 'warrior' });
  const groupSpecs: Spec[] = [
    protectionWarrior,
    protectionPaladin,
    { ...healerSpec, key: `${healerSpec.key}_1` },
    { ...healerSpec, key: `${healerSpec.key}_2` },
    { ...healerSpec, key: `${healerSpec.key}_3` },
    ...fixedDps,
  ];
  const pids = groupSpecs.map((s, i) => sim.addPlayer(s.cls, `${s.key.replace(/_/g, '')}${i}`));
  for (let i = 0; i < pids.length; i++) {
    sim.players.get(pids[i])?.questsDone.add('q_nythraxis_bound_guardian');
    sim.setPlayerLevel(20, pids[i]);
    ensureTalents(sim, pids[i], groupSpecs[i]);
    equipBest(sim, pids[i], groupSpecs[i]);
  }
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(pids[0]);
  sim.enterDungeon('nythraxis_boss_arena', pids[0]);
  // force heroic difficulty for the claimed instance
  const leader = sim.entities.get(pids[0])!;
  const slot = sim.instanceSlotAt(leader.pos)!;
  const inst = (sim as unknown as { instances: { mobIds: number[]; difficulty: string; partyKey: unknown }[] }).instances.find(
    (x) => x.partyKey !== null,
  );
  if (inst) inst.difficulty = 'heroic';
  const origin = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, slot);
  const boss = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak' && !e.dead)!;

  const actorSpecs = new Map(pids.map((pid, i) => [pid, groupSpecs[i]]));
  for (let i = 0; i < pids.length; i++) {
    const pos = positionFor(groupSpecs[i], boss, i);
    teleport(sim, pids[i], pos.x, pos.z);
    const e = sim.entities.get(pids[i])!;
    e.targetId = boss.id;
    face(e, boss);
    if (groupSpecs[i].key === 'protection_warrior') cast(sim, pids[i], boss.id, 'defensive_stance');
    for (const ability of groupSpecs[i].prepull ?? []) cast(sim, pids[i], boss.id, ability);
    sim.startAutoAttack(pids[i]);
    e.resource = e.maxResource;
  }
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = pids[0];
  boss.threat.set(pids[0], 1000);

  const healerPids = pids.filter((_, i) => groupSpecs[i].role === 'healer');
  const tankCandidatePids = pids.filter((_, i) => groupSpecs[i].kind === 'tank');
  let activeBossTankPid = pids[0];

  let healerHeal = 0;
  let echoHeal = 0;
  let healerAbsorbed = 0; // raid damage soaked by healer shields (mono-comp => healer-only)
  let healerDamage = 0;
  let firstOom: number | null = null;
  const oomSeconds = new Map<number, number>();
  let minManaPct = 1;
  const raidDeaths = new Set<number>();
  const deathBreakdown: Record<string, number> = {};
  let soulRendDeaths = 0;
  let deathlessDeaths = 0;
  const lastIncoming = new Map<number, { ability: string | null }>();
  let breakReason = 'timeout';

  for (let tick = 0; tick < 20 * 600 && !boss.dead; tick++) {
    const t = (sim as unknown as { time: number }).time;

    // track mana / oom
    for (const pid of healerPids) {
      const e = sim.entities.get(pid)!;
      if (e.dead) continue;
      const pct = e.maxResource > 0 ? e.resource / e.maxResource : 1;
      minManaPct = Math.min(minManaPct, pct);
      if (e.resource <= 0) {
        oomSeconds.set(pid, (oomSeconds.get(pid) ?? 0) + 0.05);
        if (firstOom === null) firstOom = t;
      }
    }

    // tank swap if the boss tank dies
    const activeTank = sim.entities.get(activeBossTankPid);
    if (!activeTank || activeTank.dead) {
      const rep = tankCandidatePids.find((pid) => pid !== activeBossTankPid && !sim.entities.get(pid)?.dead);
      if (rep === undefined) {
        breakReason = 'no_tank_alive';
        break;
      }
      activeBossTankPid = rep;
      const top = Math.max(0, ...[...boss.threat.values()]);
      boss.threat.set(rep, top + 10000);
      boss.aggroTargetId = rep;
    }

    // off-tank grabs adds
    const adds = livingAdds(sim);
    const offTankPid = tankCandidatePids.find((pid) => pid !== activeBossTankPid && !sim.entities.get(pid)?.dead);
    let offTankFocusAdd: Entity | undefined;
    if (offTankPid !== undefined) {
      const offTank = sim.entities.get(offTankPid)!;
      const loose = adds.find((a) => a.aggroTargetId !== offTank.id);
      offTankFocusAdd = loose ?? [...adds].sort((a, b) => threatLeadFor(a, offTank.id) - threatLeadFor(b, offTank.id))[0];
      for (const add of adds) secureAddThreat(add, offTank.id, add === offTankFocusAdd ? 2500 : 1500);
      if (offTankFocusAdd) {
        if (dist2d(offTank.pos, offTankFocusAdd.pos) > 5) teleport(sim, offTankPid, offTankFocusAdd.pos.x, offTankFocusAdd.pos.z - 3);
        offTank.targetId = offTankFocusAdd.id;
        face(offTank, offTankFocusAdd);
        sim.startAutoAttack(offTankPid);
      }
    }

    // Soul Rend: stack marked players onto one point
    if (boss.nythraxis?.soulRendMarks.length) {
      const stack = { x: origin.x - 12, z: origin.z + 72 };
      for (const mark of boss.nythraxis.soulRendMarks) {
        const e = sim.entities.get(mark.playerId);
        if (e && !e.dead) teleport(sim, e.id, stack.x, stack.z);
      }
    }
    // Deathless Rage: assign players to channel the wardstones
    if (boss.nythraxis?.deathlessCastRemaining && boss.nythraxis.deathlessCastRemaining > 0) {
      const wards = [...sim.entities.values()]
        .filter((e) => e.kind === 'object' && e.objectItemId === 'bastion_ward_stone' && dist2d(e.pos, boss.spawnPos) < 140)
        .sort((a, b) => a.id - b.id);
      const livingHealers = healerPids.filter((pid) => !sim.entities.get(pid)?.dead);
      const livingDps = pids.filter((pid, i) => !sim.entities.get(pid)?.dead && groupSpecs[i].role === 'dps');
      const assign = [...livingHealers, ...livingDps];
      for (let w = 0; w < wards.length; w++) {
        const pid = assign[w];
        if (pid === undefined) continue;
        const p = sim.entities.get(pid)!;
        teleport(sim, pid, wards[w].pos.x, wards[w].pos.z);
        if (p.castingAbility !== 'nythraxis_ward_channel') {
          p.castingAbility = null;
          p.channeling = false;
          p.castRemaining = 0;
          p.castTotal = 0;
        }
        sim.pickUpObject(wards[w].id, pid);
      }
    }

    const liveFriendlies = pids.map((pid) => sim.entities.get(pid)!).filter((p) => !p.dead);
    const lowestRaid = liveFriendlies
      .filter((p) => !tankCandidatePids.includes(p.id))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const lowestAny = liveFriendlies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const bossTank = sim.entities.get(activeBossTankPid)!;

    // Triage target for a healer (shared by every spec): the boss tank is the melee
    // wall and gets priority, then the off-tank, then the lowest raid member; a
    // critically low ally (<40%) overrides everything.
    const offTank = offTankPid !== undefined ? sim.entities.get(offTankPid) : undefined;
    function triage(): Entity | null {
      if (lowestAny && lowestAny.hp / lowestAny.maxHp < 0.4) return lowestAny;
      if (bossTank && !bossTank.dead && bossTank.hp < bossTank.maxHp * 0.85) return bossTank;
      if (offTank && !offTank.dead && offTank.hp < offTank.maxHp * 0.8) return offTank;
      if (lowestRaid && lowestRaid.hp < lowestRaid.maxHp * 0.85) return lowestRaid;
      return null;
    }

    for (let hi = 0; hi < healerPids.length; hi++) {
      const hpid = healerPids[hi];
      const h = sim.entities.get(hpid)!;
      if (h.dead || h.castingAbility === 'nythraxis_ward_channel' || h.castingAbility) continue;
      const spec = actorSpecs.get(hpid)!;
      const focus = triage();

      if (spec.offensiveHealer) {
        // Chronomancy. Reactive Mend/Barrier on whoever needs it, keep Echo on the
        // boss tank, otherwise DPS the boss to convert Arcane damage into Echo heals.
        if (focus && focus.hp < focus.maxHp * 0.55 && cast(sim, hpid, focus.id, 'temporal_mend')) continue;
        if (bossTank.hp < bossTank.maxHp * 0.9 && !h.cooldowns.has('temporal_barrier') && cast(sim, hpid, bossTank.id, 'temporal_barrier')) continue;
        if (!auraActive(bossTank, 'temporal_echo', h.id) && cast(sim, hpid, bossTank.id, 'temporal_echo')) continue;
        if (focus && cast(sim, hpid, focus.id, 'temporal_mend')) continue;
        if (!boss.dead && dist2d(h.pos, boss.pos) <= 30) {
          const stacks = h.auras.find((a) => a.id === 'arcane_surge')?.value ?? 0;
          h.targetId = boss.id;
          face(h, boss);
          cast(sim, hpid, boss.id, stacks >= 3 ? 'arcane_missiles' : 'arcane_surge');
        }
        continue;
      }

      // pure healer: cast the first affordable heal in the rotation on the triage target
      if (focus) {
        for (const heal of spec.healRotation ?? []) if (cast(sim, hpid, focus.id, heal)) break;
      }
    }

    // dps + tank rotations
    for (let i = 0; i < pids.length; i++) {
      const spec = groupSpecs[i];
      const pid = pids[i];
      const p = sim.entities.get(pid)!;
      if (p.dead || p.castingAbility || spec.role === 'healer') continue;
      const target = pid === activeBossTankPid ? boss : pid === offTankPid ? (offTankFocusAdd ?? adds[0] ?? boss) : boss;
      if (target.dead) continue;
      if (spec.melee && dist2d(p.pos, target.pos) > MELEE_RANGE - 0.2) teleport(sim, pid, target.pos.x, target.pos.z - 3);
      p.targetId = target.id;
      face(p, target);
      sim.startAutoAttack(pid);
      for (const ability of spec.rotation) {
        if (!shouldTryAbility(p, target, ability)) continue;
        if (cast(sim, pid, target.id, ability)) break;
      }
    }

    for (const event of sim.tick()) {
      if (event.type === 'heal2' && healerPids.includes(event.sourceId)) {
        healerHeal += event.amount;
        if (event.ability === 'Temporal Echo') echoHeal += event.amount;
      }
      if (event.type === 'damage' && event.targetId === boss.id && event.kind === 'hit' && healerPids.includes(event.sourceId)) {
        healerDamage += event.amount;
      }
      if (event.type === 'damage' && pids.includes(event.targetId)) {
        if (event.kind === 'hit') lastIncoming.set(event.targetId, { ability: event.ability });
        // In a mono-healer comp the only absorb shields on the raid are the healers'
        // (Psalm of Warding / Temporal Barrier), so credit soaked damage to the trio.
        const absorbed = (event as unknown as { absorbed?: number }).absorbed ?? 0;
        healerAbsorbed += absorbed;
      }
      if (event.type === 'death' && pids.includes(event.entityId)) {
        raidDeaths.add(event.entityId);
        const ab = lastIncoming.get(event.entityId)?.ability ?? 'melee';
        deathBreakdown[ab] = (deathBreakdown[ab] ?? 0) + 1;
        if (ab === 'Soul Rend') soulRendDeaths++;
        if (ab === 'Deathless Rage') deathlessDeaths++;
      }
    }

    if (pids.filter((pid) => !sim.entities.get(pid)?.dead).length < 4) {
      breakReason = 'raid_wiped';
      break;
    }
  }

  const seconds = (sim as unknown as { time: number }).time;
  if (boss.dead) breakReason = 'boss_killed';
  const totalOom = [...oomSeconds.values()].reduce((a, b) => a + b, 0);
  return {
    healer: healerSpec.key,
    killed: boss.dead,
    breakReason,
    seconds: Math.round(seconds * 10) / 10,
    bossHpPct: Math.round((boss.hp / boss.maxHp) * 1000) / 10,
    raidDeaths: raidDeaths.size,
    soulRendDeaths,
    deathlessDeaths,
    healerHps: Math.round(healerHeal / seconds),
    healerEchoHps: Math.round(echoHeal / seconds),
    healerAbsorbPs: Math.round(healerAbsorbed / seconds),
    healerEffectivePs: Math.round((healerHeal + healerAbsorbed) / seconds),
    healerDps: Math.round(healerDamage / seconds),
    healerFirstOom: firstOom === null ? null : Math.round(firstOom * 10) / 10,
    healerOomSeconds: Math.round(totalOom * 10) / 10,
    healerMinManaPct: Math.round(minManaPct * 1000) / 10,
    deathBreakdown,
  };
}

const order = ['chronomancer', 'holy_priest', 'discipline_priest', 'restoration_druid', 'restoration_shaman', 'holy_paladin'];
const results = order.map((k) => runOne(HEALERS[k]));
console.log('\n=== Heroic Nythraxis: mono-healer trio comparison (fixed 2 tanks + 5 dps) ===\n');
for (const r of results) {
  console.log(
    [
      r.healer.padEnd(20),
      r.killed ? 'KILL ' : 'WIPE ',
      `t=${String(r.seconds).padStart(6)}s`,
      `bossHP=${String(r.bossHpPct).padStart(5)}%`,
      `deaths=${r.raidDeaths}`,
      `HPS=${String(r.healerHps).padStart(5)}`,
      `absorb/s=${String(r.healerAbsorbPs).padStart(4)}`,
      `effTHPS=${String(r.healerEffectivePs).padStart(5)}`,
      `echoHPS=${String(r.healerEchoHps).padStart(4)}`,
      `DPS=${String(r.healerDps).padStart(4)}`,
      `minMana=${String(r.healerMinManaPct).padStart(5)}%`,
      `reason=${r.breakReason}`,
    ].join('  '),
  );
}
console.log('\ndeath breakdown by killing blow:');
for (const r of results) console.log(`  ${r.healer.padEnd(20)} ${JSON.stringify(r.deathBreakdown)}`);

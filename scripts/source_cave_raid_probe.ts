// Source Cave raid balance matrix: runs scripted 10-player level-20 raids
// (1 tank / 3 healers / 6 dps, best available non-cave gear, real talents and
// rotations) through the full encounter in the REAL Sim. Four composition
// profiles run over a deterministic 20-seed matrix by default.
//
//   npx tsx scripts/source_cave_probe_runner.ts
//
// PROBE_SEED=42 narrows to one diagnostic seed. PROBE_SEEDS=7,42 and
// PROBE_PROFILES=aoe,single-target-mixed narrow the matrix. PROBE_VERBOSE=1
// prints every wave; otherwise the runner emits one aggregate per profile.

import {
  defaultBuild,
  type TalentAllocation,
  talentPointsAtLevel,
  validateAllocation,
} from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import {
  SOURCE_CAVE_DUNGEON_ID,
  SOURCE_CAVE_REBOOT_TEMPLATE,
  SOURCE_CAVE_SEAL_RADIUS,
} from '../src/sim/source_cave';
import {
  dist2d,
  type Entity,
  type EquipSlot,
  type ItemDef,
  MELEE_RANGE,
  type PlayerClass,
  type SimEvent,
} from '../src/sim/types';
import {
  aggregateProbeRuns,
  hunterProbePosition,
  parseProbeSeeds,
  SOURCE_CAVE_PROBE_PROFILES,
  type SourceCaveProbeProfile,
  type SourceCaveProbeProfileKey,
  validateProbeWaveActivation,
} from './source_cave_probe_core';

type Role = 'tank' | 'healer' | 'dps';
type SpecKind = 'physical' | 'caster' | 'healer' | 'tank';
interface Spec {
  key: string;
  cls: PlayerClass;
  role: Role;
  kind: SpecKind;
  melee: boolean;
  talents: TalentAllocation;
  prepull?: string[];
  rotation: string[];
  healRotation?: string[];
}

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

// The cave's own chest rewards are excluded from the gear-up: the probe asks
// whether a raid WITHOUT the cave's loot can clear it.
const CAVE_REWARD_IDS = new Set([
  'commit_blade',
  'bug_squasher',
  'mech_keyboard',
  'source_cave_mantle',
]);

// Specs copied from scripts/nythraxis_matrix.ts (the calibrated 10-player
// harness); pet classes are represented by the hunter running petless.
const PROT_WARRIOR: Spec = {
  key: 'protection_warrior',
  cls: 'warrior',
  role: 'tank',
  kind: 'tank',
  melee: true,
  talents: {
    spec: 'prot',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_second_wind',
      11: 'war_row_storm_bolt',
      14: 'war_row_anger_management',
      17: 'war_row_bloodbath',
      20: 'war_row_colossal_might',
    },
  },
  // No thunder_clap: an AoE swung near the dormant encirclement ring (radius
  // 13) wakes whole cohorts (tryWakeSourceCaveWave), so a seal-stacked tank
  // plays single-target, exactly the discipline the room teaches real raids.
  rotation: ['defensive_stance', 'battle_shout', 'sunder_armor', 'shield_slam', 'heroic_strike'],
};
const HOLY_PRIEST: Spec = {
  key: 'holy_priest',
  cls: 'priest',
  role: 'healer',
  kind: 'healer',
  melee: false,
  talents: {
    spec: 'holy',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'pri_r5_improved_renew',
      8: 'pri_r8_improved_shield',
      11: 'pri_r11_meditation',
      14: 'pri_r14_greater_heal',
      17: 'pri_r17_inner_fire',
      20: 'pri_r20_blessed_recovery',
    },
  },
  rotation: ['smite'],
  healRotation: ['flash_heal', 'heal', 'lesser_heal'],
};
const RESTO_DRUID: Spec = {
  key: 'restoration_druid',
  cls: 'druid',
  role: 'healer',
  kind: 'healer',
  melee: false,
  talents: {
    spec: 'restoration',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'dru_r5_natures_bounty',
      8: 'dru_r8_improved_roots',
      11: 'dru_r11_improved_mark',
      14: 'dru_r14_empowered_touch',
      17: 'dru_r17_survival_of_the_fittest',
      20: 'dru_r20_tranquility',
    },
  },
  rotation: ['wrath'],
  healRotation: ['regrowth', 'healing_touch', 'rejuvenation'],
};
const ARMS_WARRIOR: Spec = {
  key: 'arms_warrior',
  cls: 'warrior',
  role: 'dps',
  kind: 'physical',
  melee: true,
  talents: {
    spec: 'arms',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_victory_rush',
      11: 'war_row_storm_bolt',
      14: 'war_row_anger_management',
      17: 'war_row_bloodbath',
      20: 'war_row_colossal_might',
    },
  },
  rotation: [
    'battle_shout',
    'berserker_rage',
    'execute',
    'mortal_strike',
    'rend',
    'slam',
    'heroic_strike',
  ],
};
const COMBAT_ROGUE: Spec = {
  key: 'combat_rogue',
  cls: 'rogue',
  role: 'dps',
  kind: 'physical',
  melee: true,
  talents: {
    spec: 'combat',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'rog_r5_relentless_strikes',
      8: 'rog_r8_smoke_screen',
      11: 'rog_r11_improved_slice_and_dice',
      14: 'rog_r14_deadly_brew',
      17: 'rog_r17_cheat_death',
      20: 'rog_r20_master_assassin',
    },
  },
  rotation: ['instant_poison', 'adrenaline_rush', 'eviscerate', 'sinister_strike'],
};
const FIRE_MAGE: Spec = {
  key: 'fire_mage',
  cls: 'mage',
  role: 'dps',
  kind: 'caster',
  melee: false,
  talents: {
    spec: 'fire',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'mag_r5_blink_cast',
      8: 'mag_r8_warded',
      11: 'mag_r11_twin_nova',
      14: 'mag_r14_power_echo',
      17: 'mag_r17_convergence',
      20: 'mag_r20_overflowing_power',
    },
  },
  prepull: ['arcane_intellect'],
  rotation: ['fire_blast', 'pyroblast', 'fireball', 'scorch'],
};
const ELEM_SHAMAN: Spec = {
  key: 'elemental_shaman',
  cls: 'shaman',
  role: 'dps',
  kind: 'caster',
  melee: false,
  talents: {
    spec: 'elemental',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_elemental_attunement',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_elemental_warding',
      20: 'sha_r20_elemental_fury',
    },
  },
  prepull: ['lightning_shield'],
  rotation: ['flame_shock', 'earth_shock', 'lightning_bolt'],
};
const MM_HUNTER: Spec = {
  key: 'marksmanship_hunter',
  cls: 'hunter',
  role: 'dps',
  kind: 'physical',
  melee: false,
  talents: {
    spec: 'marksmanship',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'hun_r5_improved_serpent_sting',
      8: 'hun_r8_improved_concussive',
      11: 'hun_r11_efficiency',
      14: 'hun_r14_sniper_training',
      17: 'hun_r17_thick_hide',
      20: 'hun_r20_rapid_killing',
    },
  },
  rotation: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'aimed_shot', 'arcane_shot'],
};

const RESTO_SHAMAN: Spec = {
  key: 'restoration_shaman',
  cls: 'shaman',
  role: 'healer',
  kind: 'healer',
  melee: false,
  talents: {
    spec: 'restoration',
    // Talents 2.0 v2 (one pick per row level): role-flavored passives chosen to
    // keep the probe's scripted rotations authoritative (no granted active is
    // added to any rotation; the marksman stays petless, the tank single-target).
    rows: {
      5: 'sha_r5_imbue_mastery',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_chain_lightning',
      17: 'sha_r17_elemental_warding',
      20: 'sha_r20_tidal_waves',
    },
  },
  rotation: ['lightning_bolt'],
  healRotation: ['healing_wave'],
};

const MAX_SECONDS = 20 * 60;
const DT_TICKS_PER_SEC = 20;

const DPS_SPEC_BY_CLASS = {
  warrior: ARMS_WARRIOR,
  rogue: COMBAT_ROGUE,
  mage: FIRE_MAGE,
  shaman: ELEM_SHAMAN,
  hunter: MM_HUNTER,
} as const;

function raidForProfile(profile: SourceCaveProbeProfile): Spec[] {
  return [
    PROT_WARRIOR,
    HOLY_PRIEST,
    RESTO_DRUID,
    RESTO_SHAMAN,
    ...profile.dpsClasses.map((cls, index) => ({
      ...DPS_SPEC_BY_CLASS[cls],
      key: `${DPS_SPEC_BY_CLASS[cls].key}_${index + 1}`,
    })),
  ];
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  // biome-ignore lint/suspicious/noExplicitAny: probe reaches sim internals like the tests do.
  (sim as any).rebucket(e);
}

function face(source: Entity, target: Entity): void {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}

function statScore(item: ItemDef, spec: Spec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  if (spec.kind === 'healer')
    return (
      weapon + (s.int ?? 0) * 5.4 + (s.spi ?? 0) * 4.4 + (s.sta ?? 0) * 0.8 + (s.armor ?? 0) * 0.004
    );
  if (spec.kind === 'caster')
    return (
      weapon * 2 +
      (s.int ?? 0) * 4.6 +
      (s.spi ?? 0) * 1.8 +
      (s.sta ?? 0) * 0.6 +
      (s.armor ?? 0) * 0.003
    );
  if (spec.kind === 'tank')
    return (
      weapon * 5 + (s.sta ?? 0) * 5 + (s.str ?? 0) * 3 + (s.agi ?? 0) * 2 + (s.armor ?? 0) * 0.08
    );
  return weapon * 8 + (s.str ?? 0) * 3 + (s.agi ?? 0) * 3 + (s.sta ?? 0) + (s.armor ?? 0) * 0.01;
}

function equipBest(sim: Sim, pid: number, spec: Spec): void {
  for (const slot of SLOTS) {
    // Legendaries are excluded: "well-equipped" means attainable rares/epics,
    // not a raid of flagship artifacts. (Thronebane's Chain Arc proc also
    // chains onto dormant contributors and wakes their cohorts, a hazard a
    // real owner manages by hand; the probe models the standard raid.)
    const item = Object.values(ITEMS)
      .filter(
        (candidate) =>
          !CAVE_REWARD_IDS.has(candidate.id) &&
          candidate.quality !== 'legendary' &&
          candidate.slot === slot &&
          (candidate.kind === 'weapon' || candidate.kind === 'armor') &&
          canEquipItem(spec.cls, candidate),
      )
      .sort((a, b) => statScore(b, spec) - statScore(a, spec))[0];
    if (item) {
      sim.addItem(item.id, 1, pid);
      sim.equipItem(item.id, pid);
    }
  }
}

function ensureTalents(sim: Sim, pid: number, spec: Spec): void {
  const check = validateAllocation(spec.cls, spec.talents, talentPointsAtLevel(20));
  if (!check.ok) console.warn(`Invalid talents for ${spec.key}: ${check.reason}`);
  if (!sim.applyTalents(spec.talents, pid)) {
    sim.applyTalents(defaultBuild(spec.cls, talentPointsAtLevel(20)), pid);
  }
}

function cast(sim: Sim, pid: number, targetId: number, ability: string): boolean {
  const p = sim.entities.get(pid);
  if (!p || p.dead || p.castingAbility) return false;
  p.targetId = targetId;
  const target = sim.entities.get(targetId);
  if (target) face(p, target);
  const before = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  sim.castAbility(ability, pid);
  const after = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  return before !== after;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function setupHunterPet(sim: Sim, pid: number): void {
  const hunter = sim.entities.get(pid);
  if (!hunter) throw new Error('hunter probe owner is missing');
  // The matrix measures raid balance, not the six pre-raid tame channels. Call
  // the real pet-construction path directly so every profile enters the cave at
  // the same sim time and shared-RNG position.
  (
    sim as unknown as {
      summonPet(owner: Entity, templateId: string): void;
    }
  ).summonPet(hunter, 'forest_wolf');
  if (!sim.petOf(pid)) throw new Error('hunter probe failed to create its controlled pet');
  sim.setPetMode('passive', pid);
  sim.setPetAutoTaunt(false, pid);
}

export interface ProbeRunResult {
  profile: SourceCaveProbeProfileKey;
  seed: number;
  outcome: 'cleared' | 'wipe' | 'timeout' | 'invalid';
  seconds: number;
  deaths: number;
  petDeaths: number;
  minHealerManaPct: number;
  tauntPeels: number;
  hunterRepositions: number;
  petDamageEvents: number;
  aoeCasts: number;
  invalidReason: string | null;
  waveInfo: Array<{ size: number; startT: number | null; endT: number | null }>;
  deathLog: Array<{ t: number; who: string }>;
  healerMana: Array<{ key: string; waves: string[] }>;
}

export function runProbe(seed: number, profile: SourceCaveProbeProfile): ProbeRunResult {
  const raid = raidForProfile(profile);
  // biome-ignore lint/suspicious/noExplicitAny: probe reaches sim internals like the tests do.
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as Sim & any;
  const pids: number[] = raid.map((spec, i) => sim.addPlayer(spec.cls, `${spec.key}_${i}`));
  for (let i = 0; i < pids.length; i++) {
    sim.setPlayerLevel(20, pids[i]);
    ensureTalents(sim, pids[i], raid[i]);
    equipBest(sim, pids[i], raid[i]);
  }
  if (profile.controlledHunterPets) {
    for (let i = 0; i < pids.length; i++) {
      if (raid[i].cls === 'hunter') setupHunterPet(sim, pids[i]);
    }
    for (let i = 0; i < pids.length; i++) {
      if (raid[i].cls === 'hunter') sim.setPetMode('defensive', pids[i]);
    }
  }
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(pids[0]);
  for (const pid of pids) sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

  const inst = sim.instances.find(
    (candidate: { dungeonId: string; partyKey: string | null }) =>
      candidate.dungeonId === SOURCE_CAVE_DUNGEON_ID && candidate.partyKey !== null,
  );
  if (!inst?.sourceCaveEncounter) throw new Error('cave instance missing');
  const button = inst.objectIds
    .map((id: number) => sim.entities.get(id))
    .find((e: Entity | undefined) => e?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE) as Entity;
  if (!button) throw new Error('reboot button missing');

  // Opening formation: stacked tight (the per-tick dynamic formation below
  // spreads healers/ranged only while a cleaver wave is active), tank a step
  // toward the ring so activated cohorts (nearest-player acquisition) mostly
  // open on him.
  for (let i = 0; i < pids.length; i++) {
    const p = sim.entities.get(pids[i]) as Entity;
    const spread = raid[i].role === 'tank' ? 4 : 1.5;
    const angle = (Math.PI * 2 * i) / pids.length;
    teleport(
      sim,
      p,
      button.pos.x + Math.sin(angle) * spread,
      button.pos.z + Math.cos(angle) * spread,
    );
    for (const ability of raid[i].prepull ?? []) cast(sim, pids[i], pids[i], ability);
    const pet = sim.petOf(pids[i]);
    if (pet) teleport(sim, pet, p.pos.x + 0.5, p.pos.z + 0.5);
  }
  const leaderEntity = sim.entities.get(pids[0]) as Entity;
  leaderEntity.targetId = button.id;
  sim.interact(pids[0]);
  const state = inst.sourceCaveEncounter;
  if (!state.started) throw new Error('encounter did not start (confirmation? off-seal player?)');

  const tankPid = pids[0];
  const healerPids = pids.filter((_, i) => raid[i].role === 'healer');
  const waveInfo: Array<{
    size: number;
    startT: number | null;
    endT: number | null;
  }> = state.waves.map((wave: number[]) => ({ size: wave.length, startT: null, endT: null }));
  const deaths: Array<{ t: number; who: string }> = [];
  const dead = new Set<number>();
  const manaAtWaveEnd: Record<string, string[]> = {};
  for (const hpid of healerPids) manaAtWaveEnd[String(hpid)] = [];
  let taunted = 0;
  let outcome: ProbeRunResult['outcome'] = 'timeout';
  let t = 0;
  let invalidReason: string | null = null;
  let hunterRepositions = 0;
  let petDamageEvents = 0;
  let aoeCasts = 0;
  const deadPets = new Set<number>();

  const activeMobs = (): Entity[] =>
    [...state.activeMobIds]
      .map((id: number) => sim.entities.get(id) as Entity | undefined)
      .filter((e: Entity | undefined): e is Entity => !!e && !e.dead);
  const wouldHitDormant = (source: Entity, radius: number): boolean => {
    for (let wave = 0; wave < state.waves.length; wave++) {
      if (state.activatedWaves.has(wave)) continue;
      for (const id of state.waves[wave]) {
        const mob = sim.entities.get(id) as Entity | undefined;
        if (mob && !mob.dead && dist2d(source.pos, mob.pos) <= radius + 0.5) return true;
      }
    }
    return false;
  };

  for (let tick = 0; tick < MAX_SECONDS * DT_TICKS_PER_SEC; tick++) {
    t = tick / DT_TICKS_PER_SEC;
    const activatedBeforeDecision = new Set<number>(state.activatedWaves);
    const livingWaveIndexesBefore = state.waves.flatMap((wave: number[], index: number) =>
      state.activatedWaves.has(index) &&
      wave.some((id: number) => sim.entities.get(id)?.dead === false)
        ? [index]
        : [],
    );
    const pacingTime = sim.time;
    const pacingNextWaveAt = state.nextWaveAt;
    for (let w = 0; w < waveInfo.length; w++) {
      if (state.activatedWaves.has(w) && waveInfo[w].startT === null) waveInfo[w].startT = t;
      if (
        waveInfo[w].startT !== null &&
        waveInfo[w].endT === null &&
        state.waves[w].every((id: number) => sim.entities.get(id)?.dead !== false)
      ) {
        waveInfo[w].endT = t;
        for (const hpid of healerPids) {
          const h = sim.entities.get(hpid) as Entity;
          manaAtWaveEnd[String(hpid)].push(
            `${Math.round((h.resource / Math.max(1, h.maxResource)) * 100)}%`,
          );
        }
      }
    }
    if (state.cleared) {
      outcome = 'cleared';
      break;
    }
    const living = pids.map((pid) => sim.entities.get(pid) as Entity).filter((p) => !p.dead);
    if (living.length === 0) {
      outcome = 'wipe';
      break;
    }

    const mobs = activeMobs();
    // Focus-fire order: lowest current hp first.
    const focus = mobs.sort((a, b) => a.hp - b.hp)[0] ?? null;

    // Dynamic formation: healers and physical ranged stack tight by default
    // (staying central keeps swarm-wave openers on the tank side) and step out
    // to a 6.5 arc only while a cleaver (architect-tier, cleave template) is
    // active, so Sweeping Refactor cannot splash them. Mages always hold the
    // centre (their arcane_explosion must never reach the dormant ring).
    const cleaverActive = mobs.some(
      (m) =>
        (sim.sourceCave.templates as Array<{ id: string; cleave?: unknown }>).find(
          (t) => t.id === m.templateId,
        )?.cleave !== undefined,
    );
    for (let i = 0; i < pids.length; i++) {
      const spec = raid[i];
      if (spec.role === 'tank' || spec.melee || spec.cls === 'mage' || spec.cls === 'hunter')
        continue;
      const p = sim.entities.get(pids[i]) as Entity;
      if (p.dead) continue;
      const want = cleaverActive ? 6.5 : 1.5;
      const angle = (Math.PI * 2 * i) / pids.length;
      const wx = button.pos.x + Math.sin(angle) * want;
      const wz = button.pos.z + Math.cos(angle) * want;
      if (dist2d(p.pos, { x: wx, y: p.pos.y, z: wz }) > 1.5) teleport(sim, p, wx, wz);
    }

    // Hunters hold the inside edge opposite the focus target. This keeps them
    // inside containment while respecting the class's real 8-yard dead zone.
    if (focus) {
      for (let i = 0; i < pids.length; i++) {
        if (raid[i].cls !== 'hunter') continue;
        const hunter = sim.entities.get(pids[i]) as Entity;
        if (hunter.dead) continue;
        const want = hunterProbePosition(button.pos, focus.pos, i);
        if (dist2d(hunter.pos, focus.pos) < 8.25) {
          teleport(sim, hunter, want.x, want.z);
          hunterRepositions++;
        }
      }
    }

    // Healers: keep the lowest raider up; idle otherwise.
    const lowest = [...living].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    for (const hpid of healerPids) {
      const h = sim.entities.get(hpid) as Entity;
      if (h.dead) continue;
      const spec = raid[pids.indexOf(hpid)];
      const target =
        lowest && lowest.hp / lowest.maxHp < 0.9 ? lowest : (sim.entities.get(tankPid) as Entity);
      if (target && !target.dead && target.hp < target.maxHp * 0.96) {
        for (const heal of spec.healRotation ?? []) {
          if (cast(sim, hpid, target.id, heal)) break;
        }
      }
    }

    // Tank: peel any active mob that turned onto a healer, else build on focus.
    // Once mobs stack on the raid, thunder_clap is safe from the centre (reach
    // 8 from the button cannot touch the dormant ring at 13).
    const tank = sim.entities.get(tankPid) as Entity;
    if (!tank.dead && focus) {
      const healerSet = new Set(healerPids);
      const loose = mobs.find((m) => m.aggroTargetId !== null && healerSet.has(m.aggroTargetId));
      if (loose && cast(sim, tankPid, loose.id, 'taunt')) taunted++;
      else {
        const stacked = mobs.filter((m) => dist2d(tank.pos, m.pos) < 7).length;
        const nearCentre = dist2d(tank.pos, button.pos) < 4;
        if (
          profile.allowTankAoe &&
          stacked >= 3 &&
          nearCentre &&
          !wouldHitDormant(tank, 8) &&
          cast(sim, tankPid, focus.id, 'thunder_clap')
        ) {
          aoeCasts++;
        } else {
          tank.targetId = focus.id;
          face(tank, focus);
          sim.startAutoAttack(tankPid);
          for (const ability of PROT_WARRIOR.rotation) {
            if (cast(sim, tankPid, focus.id, ability)) break;
          }
        }
      }
    }

    // DPS: melee defend themselves and the healers first (classic wave play:
    // peel your attacker, casters kill the focus), everyone else on the focus.
    const healerSet = new Set(healerPids);
    for (let i = 0; i < pids.length; i++) {
      const spec = raid[i];
      if (spec.role !== 'dps') continue;
      const p = sim.entities.get(pids[i]) as Entity;
      if (p.dead || p.castingAbility || !focus) continue;
      const peel = spec.melee
        ? (mobs.find((m) => m.aggroTargetId === p.id && dist2d(p.pos, m.pos) < 8) ??
          mobs.find(
            (m) =>
              m.aggroTargetId !== null &&
              healerSet.has(m.aggroTargetId) &&
              dist2d(p.pos, m.pos) < 8,
          ))
        : undefined;
      const myTarget = peel ?? focus;
      if (spec.melee && dist2d(p.pos, myTarget.pos) > MELEE_RANGE - 0.3) {
        // Step toward the mob along the button-to-mob bearing, clamped INSIDE
        // the seal (stepping off the seal breaches the encounter by design).
        // A mob within seal radius + melee reach is hittable from the clamp.
        const dx = myTarget.pos.x - button.pos.x;
        const dz = myTarget.pos.z - button.pos.z;
        const r = Math.hypot(dx, dz);
        if (r > 0 && r < SOURCE_CAVE_SEAL_RADIUS + MELEE_RANGE - 2) {
          const stand = Math.min(r, SOURCE_CAVE_SEAL_RADIUS - 1.5);
          teleport(sim, p, button.pos.x + (dx / r) * stand, button.pos.z + (dz / r) * stand);
        }
      }
      p.targetId = myTarget.id;
      face(p, myTarget);
      sim.startAutoAttack(pids[i]);
      if (profile.controlledHunterPets) {
        const pet = sim.petOf(pids[i]);
        if (pet && pet.aggroTargetId !== myTarget.id) sim.petAttack(pids[i]);
      }
      // Mages swap to arcane_explosion on a swarm: self-centred radius 10 from
      // the raid stack cannot reach the dormant ring (13), so it is the one
      // safe AoE in the room. Two clustered mobs are enough since the v0.29
      // combat retune: waves die fast enough that a 3-mob pile rarely forms,
      // which left the AoE scenario vacuously AoE-free (aoeCasts === 0).
      // Fire mages swap to Flamestrike on a swarm: arcane_explosion (Aetherburst)
      // is arcane-spec-only since Talents 2.0, so the fire kit's AoE is the
      // target-centred Flamestrike (radius 7). The dormant-ring guard therefore
      // measures from the TARGET the strike lands on, not the caster: a strike on
      // the raid-stack target cannot reach the dormant ring (13) from there.
      if (
        profile.allowPlayerAoe &&
        spec.cls === 'mage' &&
        mobs.filter((m) => dist2d(myTarget.pos, m.pos) < 6).length >= 2 &&
        !wouldHitDormant(myTarget, 7) &&
        cast(sim, pids[i], myTarget.id, 'flamestrike')
      ) {
        aoeCasts++;
        continue;
      }
      for (const ability of spec.rotation) {
        if (cast(sim, pids[i], myTarget.id, ability)) break;
      }
    }

    const events = sim.tick();
    const petIds = new Set(
      pids.map((pid) => sim.petOf(pid, true)?.id).filter((id): id is number => id !== undefined),
    );
    petDamageEvents += events.filter(
      (event: SimEvent) =>
        event.type === 'damage' && petIds.has(event.sourceId) && event.amount > 0,
    ).length;
    const pacing = validateProbeWaveActivation({
      before: activatedBeforeDecision,
      after: state.activatedWaves,
      livingWaveIndexes: livingWaveIndexesBefore,
      nextWaveAt: pacingNextWaveAt,
      time: pacingTime,
      dt: 1 / DT_TICKS_PER_SEC,
      totalWaves: state.waves.length,
      breached: state.breached,
    });
    if (!pacing.valid) {
      outcome = 'invalid';
      invalidReason = pacing.reason ?? 'unknown pacing violation';
      break;
    }
    if (process.env.TRACE_WAKES === '1') {
      for (const w of state.activatedWaves) {
        if (activatedBeforeDecision.has(w)) continue;
        const waveIds = new Set<number>(state.waves[w]);
        const touching = events.filter(
          (ev: { targetId?: number; sourceId?: number; entityId?: number }) =>
            (ev.targetId !== undefined && waveIds.has(ev.targetId)) ||
            (ev.sourceId !== undefined && waveIds.has(ev.sourceId)),
        );
        console.log(
          `[trace] t=${round1(t)}s wave ${w + 1} activated;`,
          touching.length ? JSON.stringify(touching) : 'no event touched it (timer-driven)',
        );
      }
    }
    for (const pid of pids) {
      const p = sim.entities.get(pid) as Entity;
      if (p.dead && !dead.has(pid)) {
        dead.add(pid);
        deaths.push({ t: round1(t), who: raid[pids.indexOf(pid)].key });
      }
    }
    for (const pid of pids) {
      const pet = sim.petOf(pid, true);
      if (pet?.dead) deadPets.add(pet.id);
    }
  }

  const minHealerManaPct = Math.min(
    ...healerPids.map((pid) => {
      const healer = sim.entities.get(pid) as Entity;
      return Math.round((healer.resource / Math.max(1, healer.maxResource)) * 100);
    }),
  );

  return {
    profile: profile.key,
    seed,
    outcome,
    seconds: round1(t),
    deaths: deaths.length,
    petDeaths: deadPets.size,
    minHealerManaPct,
    tauntPeels: taunted,
    hunterRepositions,
    petDamageEvents,
    aoeCasts,
    invalidReason,
    waveInfo,
    deathLog: deaths,
    healerMana: healerPids.map((pid) => ({
      key: raid[pids.indexOf(pid)].key,
      waves: manaAtWaveEnd[String(pid)],
    })),
  };
}

function logRun(result: ProbeRunResult): void {
  const boss = result.waveInfo[result.waveInfo.length - 1];
  console.log('=== Source Cave raid probe', result.profile, '(seed', `${result.seed})`, '===');
  console.log(
    'outcome:',
    result.outcome,
    ' total:',
    result.seconds,
    's  deaths:',
    result.deaths,
    ' pet deaths:',
    result.petDeaths,
    ' taunt peels:',
    result.tauntPeels,
  );
  if (result.invalidReason) console.log('invalid pacing:', result.invalidReason);
  for (let w = 0; w < result.waveInfo.length; w++) {
    const info = result.waveInfo[w];
    const label = w === result.waveInfo.length - 1 ? 'BOSS' : `wave ${w + 1}`;
    const dur = info.startT !== null && info.endT !== null ? round1(info.endT - info.startT) : null;
    console.log(
      `${label.padEnd(7)} size ${String(info.size).padStart(2)}  start ${info.startT ?? '-'}s  cleared in ${dur ?? '-'}s`,
    );
  }
  console.log(
    'boss fight:',
    boss.startT !== null && boss.endT !== null
      ? `${round1(boss.endT - boss.startT)}s`
      : 'not reached',
  );
  console.log(
    'deaths:',
    result.deathLog.map((death) => `${death.who}@${death.t}s`).join(', ') || 'none',
  );
  for (const healer of result.healerMana) {
    console.log(`${healer.key} mana at wave ends:`, healer.waves.join(' '));
  }
}

function selectedProfiles(env: { PROBE_PROFILES?: string }): SourceCaveProbeProfile[] {
  const keys = env.PROBE_PROFILES
    ? env.PROBE_PROFILES.split(',').map((value) => value.trim())
    : Object.keys(SOURCE_CAVE_PROBE_PROFILES);
  return keys.map((key) => {
    const profile = SOURCE_CAVE_PROBE_PROFILES[key as SourceCaveProbeProfileKey];
    if (!profile) throw new Error(`Unknown PROBE_PROFILES entry: ${key}`);
    return profile;
  });
}

function main(): void {
  const seeds = parseProbeSeeds(process.env);
  const profiles = selectedProfiles(process.env);
  const verbose =
    process.env.PROBE_VERBOSE === '1' || (seeds.length === 1 && profiles.length === 1);
  if (seeds.length * profiles.length > 4) {
    throw new Error(
      'Use npx tsx scripts/source_cave_probe_runner.ts for matrices larger than four runs',
    );
  }
  const allResults: ProbeRunResult[] = [];
  for (const profile of profiles) {
    const results = seeds.map((seed) => runProbe(seed, profile));
    allResults.push(...results);
    if (verbose && process.env.PROBE_QUIET !== '1') for (const result of results) logRun(result);
    const summary = aggregateProbeRuns(results);
    if (process.env.PROBE_QUIET !== '1') {
      console.log(
        `${profile.key}: ${summary.clears}/${summary.validRuns} clears, ${summary.invalidRuns} invalid, ` +
          `median clear ${round1(summary.medianClearSeconds)}s, p90 deaths ${summary.p90Deaths}, ` +
          `p10 healer mana ${summary.p10MinHealerManaPct}%`,
      );
    }
  }
  if (process.env.PROBE_JSON === '1') console.log(JSON.stringify(allResults));
}

if (process.env.NODE_ENV !== 'test') main();

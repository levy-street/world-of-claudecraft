// Monte Carlo simulation benchmark for Chronomancer vs Holy Priest
// on Nythraxis (nythraxis_boss_arena) and Ignivar (ignivar_raid_arena).
// Calibrated against live raid parses from parses.worldofclaudecraft.com
// (Nythraxis fight #89995, Ignivar fight #88229).
// Mechanics: Soul Rend stacking, Bastion Ward stone channeling, Bone Spikes shatter,
// Sigil drag, Ignivar tank swap (Molten Armor), Searing Torrent cone facing,
// Shared Pyre soak, Chains of the Forge break, Revolving Inferno ray dodging,
// and Heart of the End add burst.

import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { ignivarPointInRotatingRay } from '../src/sim/ignivar_arena';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, MELEE_RANGE } from '../src/sim/types';
import {
  applyTankRaidBuffs,
  auraActive,
  cast,
  face,
  healTick,
  round1,
  type Spec,
  summarize,
  teleport,
} from './healing_montecarlo';

function must<T>(value: T | undefined, label = 'expected value'): T {
  if (value === undefined) throw new Error(`must: ${label} was undefined`);
  return value;
}

// -------------------------------------------------------------------- SPECS

export const CHRONO_SPEC: Spec = {
  key: 'chronomancer',
  cls: 'mage',
  kind: 'healer',
  talents: {
    spec: 'arcane',
    rows: {
      5: 'mag_r5_ice_floes',
      8: 'mag_r8_warded',
      11: 'mag_r11_twin_nova',
      14: 'mag_r14_power_echo',
      17: 'mag_r17_convergence',
      20: 'mag_r20_evocation',
    },
  },
  setup: ['arcane_intellect'],
  emergencyMana: 'evocation',
};

// From fight #88229 Kokolini (rank 1 parse)
const PRIEST_SPEC: Spec = {
  key: 'holy_priest',
  cls: 'priest',
  kind: 'healer',
  talents: {
    spec: 'holy',
    rows: {
      5: 'pri_r5_twisted_faith',
      8: 'pri_r8_improved_shield',
      11: 'pri_r8_psychic_scream',
      14: 'pri_r11_meditation',
      17: 'pri_r17_martyrs_aegis',
      20: 'pri_r20_second_verse',
    },
  },
  healPriority: ['renew', 'flash_heal', 'heal', 'lesser_heal'],
};

// From fight #88229 HanzoKin (rank 1 tank parse)
const TANK_SPEC: Spec = {
  key: 'protection_warrior',
  cls: 'warrior',
  kind: 'tank',
  talents: {
    spec: 'prot',
    rows: {
      5: 'war_row_crushing_charge',
      8: 'war_row_die_by_the_sword',
      11: 'war_row_storm_bolt',
      14: 'war_row_blood_offering',
      17: 'war_row_bloodbath',
      20: 'war_row_sanguine_aura',
    },
  },
  setup: ['defensive_stance'],
};

const OFFTANK_SPEC: Spec = {
  key: 'offtank_warrior',
  cls: 'warrior',
  kind: 'tank',
  talents: {
    spec: 'prot',
    rows: {
      5: 'war_row_crushing_charge',
      8: 'war_row_die_by_the_sword',
      11: 'war_row_storm_bolt',
      14: 'war_row_blood_offering',
      17: 'war_row_bloodbath',
      20: 'war_row_sanguine_aura',
    },
  },
  setup: ['defensive_stance'],
};

const DPS_MAGE_SPEC: Spec = {
  key: 'fire_mage',
  cls: 'mage',
  kind: 'caster',
  talents: {
    spec: 'fire',
    rows: {
      5: 'mag_r5_ice_floes',
      8: 'mag_r8_temporal_rift',
      11: 'mag_r11_twin_nova',
      14: 'mag_r14_overload',
      17: 'mag_r17_convergence',
      20: 'mag_r20_evocation',
    },
  },
};

// -------------------------------------------------------------------- BOT HELPERS

function createBiSPlayer(sim: Sim, spec: Spec, name: string): number {
  const pid = sim.addPlayer(spec.cls, name);
  sim.setPlayerLevel(20, pid);
  sim.applyTalents(spec.talents, pid);
  equipBestInSlotForDev(sim.ctx, pid, spec.talents.spec);
  return pid;
}

/** Active tank mitigation loop */
function tankMitigationTick(sim: Sim, tankPid: number, bossId: number) {
  const tank = sim.entities.get(tankPid);
  if (!tank || tank.dead) return;
  if (!auraActive(tank, 'defensive_stance')) cast(sim, tankPid, tankPid, 'defensive_stance');
  cast(sim, tankPid, tankPid, 'shield_block');
  cast(sim, tankPid, bossId, 'demoralizing_shout');
  cast(sim, tankPid, bossId, 'thunder_clap');
  cast(sim, tankPid, bossId, 'shield_slam') || cast(sim, tankPid, bossId, 'sunder_armor');
}

/** Parse-calibrated DPS Mage bot */
function dpsMageTick(sim: Sim, magePid: number, target: Entity) {
  const mage = sim.entities.get(magePid);
  if (!mage || mage.dead || mage.castingAbility) return;
  face(mage, target);

  // Evocation if low mana
  if (mage.resource < mage.maxResource * 0.15) {
    if (cast(sim, magePid, magePid, 'evocation')) return;
  }

  // Hot streak -> instant Pyroblast
  if (auraActive(mage, 'hot_streak')) {
    if (cast(sim, magePid, target.id, 'pyroblast')) return;
  }

  // Burst cooldown
  if (!auraActive(mage, 'combustion')) {
    cast(sim, magePid, magePid, 'combustion');
  }

  // Offensive priority
  if (cast(sim, magePid, target.id, 'fire_blast')) return;
  cast(sim, magePid, target.id, 'fireball');
}

/** Chronomancer healer AI tick */
function chronoHealTick(
  sim: Sim,
  chronoPid: number,
  boss: Entity,
  activeTank: Entity,
  livingRaid: Entity[],
  priorityTarget: Entity | null,
) {
  const chrono = sim.entities.get(chronoPid);
  if (!chrono || chrono.dead || chrono.castingAbility) return;

  const targetEnemy = priorityTarget && !priorityTarget.dead ? priorityTarget : boss;

  // 1. Off-GCD cooldown: Perfect Moment (grants 4 Arcane Charges + 20% darts dmg)
  if (chrono.resource >= 40 && !auraActive(chrono, 'perfect_moment')) {
    cast(sim, chronoPid, chronoPid, 'perfect_moment');
  }

  // 2. Emergency triage: if an ally is below 35% HP, direct heal with Temporal Mend
  const criticalAlly = livingRaid.find((p) => p.hp < p.maxHp * 0.35);
  if (criticalAlly) {
    if (cast(sim, chronoPid, criticalAlly.id, 'temporal_mend')) return;
  }

  // 3. Low-mana recovery: Evocation
  if (chrono.resource < chrono.maxResource * 0.2) {
    if (cast(sim, chronoPid, chronoPid, 'evocation')) return;
  }

  // 4. Group Echo: Temporal Cascade when >= 2 allies are damaged below 85% HP
  const woundedCount = livingRaid.filter((p) => p.hp < p.maxHp * 0.85).length;
  const activeEchoes = livingRaid.filter((p) => auraActive(p, 'temporal_echo', chronoPid)).length;
  if (
    (woundedCount >= 2 || activeEchoes < 2) &&
    cast(sim, chronoPid, activeTank.id, 'temporal_cascade')
  ) {
    return;
  }

  // 5. Single-target Echo maintenance on active tank (keeps baseline conversion up)
  const tankEcho = activeTank.auras.find(
    (a) => a.kind === 'temporal_echo' && a.sourceId === chronoPid,
  );
  if (!tankEcho || tankEcho.remaining < 4) {
    if (cast(sim, chronoPid, activeTank.id, 'temporal_echo')) return;
  }

  // 6. Offensive damage rotation: builds/consumes charges to drive Echo healing & Aegis shields
  const chargesAura = chrono.auras.find((a) => a.kind === 'arcane_charge');
  const charges = chargesAura?.stacks ?? 0;

  if (targetEnemy && !targetEnemy.dead) {
    face(chrono, targetEnemy);
    if (charges >= 4) {
      if (cast(sim, chronoPid, targetEnemy.id, 'arcane_missiles')) return;
    }
    if (cast(sim, chronoPid, targetEnemy.id, 'arcane_surge')) return;
    cast(sim, chronoPid, targetEnemy.id, 'fire_blast');
  }
}

// -------------------------------------------------------------------- RUN RECORD

export interface MonteCarloRun {
  encounter: 'nythraxis' | 'ignivar';
  healerSpec: 'holy_priest' | 'chronomancer';
  outcome: 'boss_dead' | 'wipe' | 'timecap';
  seconds: number;
  bossHpPct: number;
  deaths: number;
  healerHps: number;
  healerDps: number;
  healerAbsorb: number;
  effectiveHpsTotal: number;
  overhealPct: number;
  tankDtps: number;
  raidDtps: number;
  oomAt: number | null;
}

// -------------------------------------------------------------------- NYTHRAXIS ENCOUNTER

const NYTHRAXIS_DUNGEON = 'nythraxis_boss_arena';
const NYTHRAXIS_BOSS = 'nythraxis_scourge_of_thornpeak';
const NYTHRAXIS_ADD_IDS = new Set([
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
]);
const NYTHRAXIS_PRIEST_ADD = 'nythraxis_heroic_priest_add';

export function runNythraxisSim(
  healerSpec: 'holy_priest' | 'chronomancer',
  seed: number,
  capSeconds = 180,
): MonteCarloRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, devCommands: true });
  const hSpec = healerSpec === 'chronomancer' ? CHRONO_SPEC : PRIEST_SPEC;
  const specs: Spec[] = [
    TANK_SPEC,
    OFFTANK_SPEC,
    hSpec,
    ...Array.from({ length: 7 }, () => DPS_MAGE_SPEC),
  ];

  const pids = specs.map((spec, i) => createBiSPlayer(sim, spec, `${spec.key}_${i}`));
  for (const pid of pids) {
    must(sim.players.get(pid), `player ${pid}`).questsDone.add('q_nythraxis_bound_guardian');
    if (pid !== pids[0]) {
      sim.partyInvite(pid, pids[0]);
      sim.partyAccept(pid);
    }
  }
  sim.convertPartyToRaid(pids[0]);
  sim.enterDungeon(NYTHRAXIS_DUNGEON, pids[0]);

  const leader = must(sim.entities.get(pids[0]));
  const slot = sim.instanceSlotAt(leader.pos);
  const origin = instanceOrigin(DUNGEONS[NYTHRAXIS_DUNGEON].index, slot ?? 0);
  const boss = [...sim.entities.values()].find((e) => e.templateId === NYTHRAXIS_BOSS && !e.dead);
  if (!boss) throw new Error('Nythraxis boss not found');

  const mtPid = pids[0];
  const otPid = pids[1];
  const healerPid = pids[2];
  const dpsPids = pids.slice(3);

  const homePos = new Map<number, { x: number; z: number }>();
  pids.forEach((pid, i) => {
    const isTank = pid === mtPid;
    const isOt = pid === otPid;
    const isHealer = pid === healerPid;
    const range = isTank ? MELEE_RANGE - 1.4 : isOt ? MELEE_RANGE : isHealer ? 20 : 16;
    const angle = (Math.PI * 2 * i) / 10;
    const pos = isTank
      ? { x: boss.pos.x, z: boss.pos.z - (MELEE_RANGE - 1.4) }
      : isOt
        ? { x: boss.pos.x + 3, z: boss.pos.z - MELEE_RANGE }
        : { x: boss.pos.x + Math.sin(angle) * range, z: boss.pos.z - Math.cos(angle) * range };

    homePos.set(pid, pos);
    teleport(sim, pid, pos.x, pos.z);
    const e = must(sim.entities.get(pid));
    e.targetId = boss.id;
    face(e, boss);

    for (const ability of specs[i].setup ?? []) cast(sim, pid, pid, ability);
    if (specs[i].key === 'fire_mage' || specs[i].key === 'chronomancer') {
      cast(sim, pid, pid, 'arcane_intellect');
    }
  });

  applyTankRaidBuffs(sim, mtPid);
  applyTankRaidBuffs(sim, otPid);

  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = mtPid;
  boss.threat.set(mtPid, 5000);

  let activeTankPid = mtPid;
  let tankDamage = 0;
  let tankAliveSeconds = 0;
  let raidDamage = 0;
  let healerDirectHealing = 0;
  let healerOverhealing = 0;
  let healerAbsorbed = 0;
  let healerDamageDealt = 0;
  let deaths = 0;
  let oomAt: number | null = null;
  let outcome: MonteCarloRun['outcome'] = 'timecap';

  const ticks = capSeconds * 20;
  let tick = 0;

  for (; tick < ticks && !boss.dead; tick++) {
    const t = tick / 20;

    // Tank succession
    const activeTank = sim.entities.get(activeTankPid);
    if (!activeTank || activeTank.dead) {
      const replacement = [mtPid, otPid].find((pid) => !sim.entities.get(pid)?.dead);
      if (replacement === undefined) {
        outcome = 'wipe';
        break;
      }
      activeTankPid = replacement;
      const top = Math.max(0, ...boss.threat.values());
      boss.threat.set(replacement, top + 10000);
      boss.aggroTargetId = replacement;
    }
    const tank = must(sim.entities.get(activeTankPid));
    tankAliveSeconds += 1 / 20;

    // Active tank mitigation
    tankMitigationTick(sim, activeTankPid, boss.id);

    // Living adds & Offtank mechanics
    const adds = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && NYTHRAXIS_ADD_IDS.has(e.templateId ?? '') && !e.dead,
    );
    const otAlive = otPid !== activeTankPid && !sim.entities.get(otPid)?.dead;
    if (otAlive && adds.length) {
      const ot = must(sim.entities.get(otPid));
      const focus = adds.find((a) => a.aggroTargetId !== otPid) ?? adds[0];
      for (const add of adds) {
        if (add.templateId === 'nythraxis_heroic_rogue_add') continue;
        const next = Math.max(
          0,
          ...[...add.threat.entries()].filter(([p]) => p !== otPid).map(([, v]) => v),
        );
        if (add.aggroTargetId !== otPid || (add.threat.get(otPid) ?? 0) - next < 1500) {
          add.threat.set(otPid, next + 2500);
          add.aggroTargetId = otPid;
        }
      }
      if (focus && dist2d(ot.pos, focus.pos) > 5) {
        teleport(sim, otPid, focus.pos.x, focus.pos.z - 3);
      }
    }

    // Soul Rend: stack marked players
    if (boss.nythraxis?.soulRendMarks.length) {
      const stack = { x: origin.x - 12, z: origin.z + 72 };
      for (const mark of boss.nythraxis.soulRendMarks) {
        const e = sim.entities.get(mark.playerId);
        if (e && !e.dead) teleport(sim, e.id, stack.x, stack.z);
      }
    } else {
      // Reposition home
      for (const pid of [healerPid, ...dpsPids]) {
        const e = sim.entities.get(pid);
        const home = homePos.get(pid);
        if (!e || e.dead || e.castingAbility === 'nythraxis_ward_channel') continue;
        if (home && dist2d(e.pos, boss.pos) > 26) teleport(sim, pid, home.x, home.z);
      }
    }

    // Sigil Drag: drag Nythraxis onto Sigil to extinguish it and prevent enrage pulse
    const sigil = boss.nythraxis?.sigil;
    if (sigil && sigil.remaining < 12) {
      teleport(sim, activeTankPid, sigil.x, sigil.z - 3);
      boss.pos.x = sigil.x;
      boss.pos.z = sigil.z;
    }

    // Deathless Rage: channel ward stones
    const deathlessRemaining = boss.nythraxis?.deathlessCastRemaining ?? 0;
    if (deathlessRemaining > 0) {
      const wards = [...sim.entities.values()]
        .filter(
          (e) =>
            e.kind === 'object' &&
            e.objectItemId === 'bastion_ward_stone' &&
            dist2d(e.pos, boss.spawnPos) < 140,
        )
        .sort((a, b) => a.id - b.id);
      const livingDps = dpsPids.filter((pid) => !sim.entities.get(pid)?.dead);
      wards.forEach((obj, i) => {
        const pid = livingDps[i] ?? healerPid;
        if (pid === undefined) return;
        const p = must(sim.entities.get(pid));
        teleport(sim, pid, obj.pos.x, obj.pos.z);
        if (p.castingAbility !== 'nythraxis_ward_channel') {
          p.castingAbility = null;
          p.channeling = false;
          p.castRemaining = 0;
          p.castTotal = 0;
        }
        sim.pickUpObject(obj.id, pid);
      });
    }

    // Bone Spikes priority target
    const boneSpikes = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_bone_spike' && !e.dead,
    );

    const livingAllies = pids
      .map((pid) => sim.entities.get(pid))
      .filter((p): p is Entity => p !== undefined && !p.dead);

    // Healer action
    const healer = must(sim.entities.get(healerPid));
    if (!healer.dead && healer.castingAbility !== 'nythraxis_ward_channel') {
      if (healerSpec === 'chronomancer') {
        const priestAdd = adds.find((a) => a.templateId === NYTHRAXIS_PRIEST_ADD);
        const target = boneSpikes[0] ?? priestAdd ?? null;
        chronoHealTick(sim, healerPid, boss, tank, livingAllies, target);
      } else {
        // Holy Priest
        const lowest = livingAllies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const wounded = livingAllies.filter((p) => p.hp < p.maxHp * 0.85);
        const target = lowest && lowest.hp / lowest.maxHp < 0.9 ? lowest : tank;
        let priority = PRIEST_SPEC.healPriority ?? [];
        if (wounded.length >= 3) priority = ['prayer_of_healing', ...priority];
        healTick(sim, healerPid, target, PRIEST_SPEC, priority);
      }
      if (oomAt === null && healer.resource < 25) oomAt = t;
    }

    // Tanks and DPS actions
    for (const pid of [activeTankPid, otPid, ...dpsPids]) {
      const p = sim.entities.get(pid);
      if (!p || p.dead || p.castingAbility) continue;
      const isMage = dpsPids.includes(pid);
      if (isMage) {
        const priestAdd = adds.find((a) => a.templateId === NYTHRAXIS_PRIEST_ADD);
        const target = boneSpikes[0] ?? priestAdd ?? adds[0] ?? boss;
        dpsMageTick(sim, pid, target);
      }
    }

    // Step simulation
    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'damage' && event.kind === 'hit') {
        if (pids.includes(event.targetId)) {
          raidDamage += event.amount;
          if (event.targetId === activeTankPid) tankDamage += event.amount;
          if (event.absorbed) healerAbsorbed += event.absorbed;
        }
        if (event.sourceId === healerPid) {
          healerDamageDealt += event.amount;
        }
      }
      if (event.type === 'heal2' && event.sourceId === healerPid) {
        healerDirectHealing += event.amount;
        if (event.overheal) healerOverhealing += event.overheal;
      }
      if (event.type === 'death' && pids.includes(event.entityId)) {
        deaths++;
      }
    }

    if (livingAllies.length <= 2) {
      outcome = 'wipe';
      break;
    }
  }

  if (boss.dead) outcome = 'boss_dead';
  const seconds = Math.max(1 / 20, tick / 20);
  const totalHealingAttempts = healerDirectHealing + healerOverhealing;

  return {
    encounter: 'nythraxis',
    healerSpec,
    outcome,
    seconds: round1(seconds),
    bossHpPct: round1((100 * boss.hp) / boss.maxHp),
    deaths,
    healerHps: round1(healerDirectHealing / seconds),
    healerDps: round1(healerDamageDealt / seconds),
    healerAbsorb: round1(healerAbsorbed / seconds),
    effectiveHpsTotal: round1((healerDirectHealing + healerAbsorbed) / seconds),
    overhealPct:
      totalHealingAttempts > 0 ? round1((100 * healerOverhealing) / totalHealingAttempts) : 0,
    tankDtps: round1(tankDamage / Math.max(1 / 20, tankAliveSeconds)),
    raidDtps: round1(raidDamage / seconds),
    oomAt: oomAt !== null ? round1(oomAt) : null,
  };
}

// -------------------------------------------------------------------- IGNIVAR ENCOUNTER

const IGNIVAR_DUNGEON = 'ignivar_raid_arena';
const IGNIVAR_BOSS = 'ignivar_herald_of_the_last_flame';
const IGNIVAR_HEART_ADD = 'ignivar_heart_of_the_end';
const IGNIVAR_MOLTEN_ARMOR = 'ignivar_molten_armor';
const IGNIVAR_SOAK_AURA = 'ignivar_shared_pyre';
const IGNIVAR_CHAINS_AURA = 'ignivar_forge_chains';

export function runIgnivarSim(
  healerSpec: 'holy_priest' | 'chronomancer',
  seed: number,
  capSeconds = 300,
): MonteCarloRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, devCommands: true });
  const hSpec = healerSpec === 'chronomancer' ? CHRONO_SPEC : PRIEST_SPEC;
  const specs: Spec[] = [
    TANK_SPEC,
    OFFTANK_SPEC,
    hSpec,
    ...Array.from({ length: 7 }, () => DPS_MAGE_SPEC),
  ];

  const pids = specs.map((spec, i) => createBiSPlayer(sim, spec, `${spec.key}_${i}`));
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(pids[0]);
  enterDungeon(sim.ctx, IGNIVAR_DUNGEON, pids[0], true);

  const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS && !e.dead);
  if (!boss) throw new Error('Ignivar boss not found');

  const mtPid = pids[0];
  const otPid = pids[1];
  const healerPid = pids[2];
  const dpsPids = pids.slice(3);

  // Position setup:
  // Boss spawns at (origin.x, origin.z + 4).
  // MT stands North (x: boss.x, z: boss.z + 4), facing South.
  // Boss faces North toward MT. Cone (Searing Torrent) fires North away from raid.
  // Raid stands South at (x: boss.x, z: boss.z - 15).
  const homePos = new Map<number, { x: number; z: number }>();
  pids.forEach((pid, i) => {
    const isTank = pid === mtPid;
    const isOt = pid === otPid;
    const isHealer = pid === healerPid;
    const pos = isTank
      ? { x: boss.pos.x, z: boss.pos.z + 4 }
      : isOt
        ? { x: boss.pos.x + 3.5, z: boss.pos.z + 4 }
        : isHealer
          ? { x: boss.pos.x - 3, z: boss.pos.z - 16 }
          : { x: boss.pos.x - 8 + (i - 3) * 2.5, z: boss.pos.z - 16 };

    homePos.set(pid, pos);
    teleport(sim, pid, pos.x, pos.z);
    const e = must(sim.entities.get(pid));
    e.targetId = boss.id;
    face(e, boss);

    for (const ability of specs[i].setup ?? []) cast(sim, pid, pid, ability);
    if (specs[i].key === 'fire_mage' || specs[i].key === 'chronomancer') {
      cast(sim, pid, pid, 'arcane_intellect');
    }
  });

  applyTankRaidBuffs(sim, mtPid);
  applyTankRaidBuffs(sim, otPid);

  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = mtPid;
  boss.threat.set(mtPid, 5000);

  let activeTankPid = mtPid;
  let tankDamage = 0;
  let tankAliveSeconds = 0;
  let raidDamage = 0;
  let healerDirectHealing = 0;
  let healerOverhealing = 0;
  let healerAbsorbed = 0;
  let healerDamageDealt = 0;
  let deaths = 0;
  let oomAt: number | null = null;
  let outcome: MonteCarloRun['outcome'] = 'timecap';

  const ticks = capSeconds * 20;
  let tick = 0;

  for (; tick < ticks && !boss.dead; tick++) {
    const t = tick / 20;

    // Tank swap mechanic (Molten Armor >= 2 stacks or death)
    const activeTank = sim.entities.get(activeTankPid);

    if (!activeTank || activeTank.dead) {
      const replacement = [mtPid, otPid].find((pid) => !sim.entities.get(pid)?.dead);
      if (replacement === undefined) {
        outcome = 'wipe';
        break;
      }
      activeTankPid = replacement;
      const top = Math.max(0, ...boss.threat.values());
      boss.threat.set(replacement, top + 10000);
      boss.aggroTargetId = replacement;
    } else {
      // Tank swap on 2+ stacks of Molten Armor
      const moltenStacks = activeTank.auras.find((a) => a.id === IGNIVAR_MOLTEN_ARMOR)?.stacks ?? 0;
      if (moltenStacks >= 2) {
        const otherTankPid = activeTankPid === mtPid ? otPid : mtPid;
        const otherTank = sim.entities.get(otherTankPid);
        const otherStacks =
          otherTank?.auras.find((a) => a.id === IGNIVAR_MOLTEN_ARMOR)?.stacks ?? 0;
        if (otherTank && !otherTank.dead && otherStacks < 2) {
          activeTankPid = otherTankPid;
          const top = Math.max(0, ...boss.threat.values());
          boss.threat.set(otherTankPid, top + 10000);
          boss.aggroTargetId = otherTankPid;
        }
      }
    }
    const currentTank = must(sim.entities.get(activeTankPid));
    tankAliveSeconds += 1 / 20;

    // Active tank mitigation
    tankMitigationTick(sim, activeTankPid, boss.id);

    // Keep tanks in melee North of boss so frontal cone never sweeps raid
    if (dist2d(currentTank.pos, boss.pos) > MELEE_RANGE - 0.5) {
      teleport(sim, activeTankPid, boss.pos.x, boss.pos.z + 4);
    }

    // Mechanics 1: Shared Pyre (Soak Circle)
    const soakedPlayer = pids
      .map((pid) => sim.entities.get(pid))
      .find((p) => p && !p.dead && p.auras.some((a) => a.id === IGNIVAR_SOAK_AURA));

    if (soakedPlayer) {
      const soakers = dpsPids
        .map((pid) => sim.entities.get(pid))
        .filter((p): p is Entity => p !== undefined && !p.dead && p.id !== soakedPlayer.id)
        .slice(0, 4);
      for (const soaker of soakers) {
        if (dist2d(soaker.pos, soakedPlayer.pos) > 4) {
          teleport(sim, soaker.id, soakedPlayer.pos.x + 1, soakedPlayer.pos.z);
        }
      }
    }

    // Mechanics 2: Chains of the Forge (run apart > 18m to break)
    for (const pid of pids) {
      const p = sim.entities.get(pid);
      if (!p || p.dead) continue;
      const chain = p.auras.find((a) => a.id === IGNIVAR_CHAINS_AURA);
      if (chain?.value2) {
        const partner = sim.entities.get(chain.value2);
        if (partner && !partner.dead) {
          const d = dist2d(p.pos, partner.pos);
          if (d <= 18) {
            teleport(sim, p.id, p.pos.x - 10, p.pos.z);
            teleport(sim, partner.id, partner.pos.x + 10, partner.pos.z);
          }
        }
      } else if (!soakedPlayer) {
        const home = homePos.get(pid);
        if (home && dist2d(p.pos, home) > 5 && pid !== activeTankPid && pid !== otPid) {
          teleport(sim, pid, home.x, home.z);
        }
      }
    }

    // Mechanics 3: Dodge Revolving Inferno (Rotating Rays)
    if (boss.ignivar?.rotatingRaysActive) {
      const angle = boss.ignivar.rotatingRaysAngle ?? 0;
      for (const pid of pids) {
        const p = sim.entities.get(pid);
        if (!p || p.dead || pid === activeTankPid) continue;
        if (ignivarPointInRotatingRay(boss.pos, angle, p.pos)) {
          teleport(sim, pid, p.pos.x + 5, p.pos.z);
        }
      }
    }

    // Mechanics 4: Apocalypse (Heart of the End add at 65% HP)
    const heartAdd = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === IGNIVAR_HEART_ADD && !e.dead,
    );

    const livingAllies = pids
      .map((pid) => sim.entities.get(pid))
      .filter((p): p is Entity => p !== undefined && !p.dead);

    // Healer actions
    const healer = must(sim.entities.get(healerPid));
    if (!healer.dead) {
      if (healerSpec === 'chronomancer') {
        chronoHealTick(sim, healerPid, boss, currentTank, livingAllies, heartAdd ?? null);
      } else {
        // Holy Priest
        const lowest = livingAllies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const wounded = livingAllies.filter((p) => p.hp < p.maxHp * 0.85);
        const target = lowest && lowest.hp / lowest.maxHp < 0.9 ? lowest : currentTank;
        let priority = PRIEST_SPEC.healPriority ?? [];
        if (wounded.length >= 3) priority = ['prayer_of_healing', ...priority];
        healTick(sim, healerPid, target, PRIEST_SPEC, priority);
      }
      if (oomAt === null && healer.resource < 25) oomAt = t;
    }

    // DPS actions
    for (const pid of dpsPids) {
      const p = sim.entities.get(pid);
      if (!p || p.dead || p.castingAbility) continue;
      const target = heartAdd && !heartAdd.dead ? heartAdd : boss;
      dpsMageTick(sim, pid, target);
    }

    // Step simulation
    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'damage' && event.kind === 'hit') {
        if (pids.includes(event.targetId)) {
          raidDamage += event.amount;
          if (event.targetId === activeTankPid) tankDamage += event.amount;
          if (event.absorbed) healerAbsorbed += event.absorbed;
        }
        if (event.sourceId === healerPid) {
          healerDamageDealt += event.amount;
        }
      }
      if (event.type === 'heal2' && event.sourceId === healerPid) {
        healerDirectHealing += event.amount;
        if (event.overheal) healerOverhealing += event.overheal;
      }
      if (event.type === 'death' && pids.includes(event.entityId)) {
        deaths++;
      }
    }

    if (livingAllies.length <= 2) {
      outcome = 'wipe';
      break;
    }
  }

  if (boss.dead) outcome = 'boss_dead';
  const seconds = Math.max(1 / 20, tick / 20);
  const totalHealingAttempts = healerDirectHealing + healerOverhealing;

  return {
    encounter: 'ignivar',
    healerSpec,
    outcome,
    seconds: round1(seconds),
    bossHpPct: round1((100 * boss.hp) / boss.maxHp),
    deaths,
    healerHps: round1(healerDirectHealing / seconds),
    healerDps: round1(healerDamageDealt / seconds),
    healerAbsorb: round1(healerAbsorbed / seconds),
    effectiveHpsTotal: round1((healerDirectHealing + healerAbsorbed) / seconds),
    overhealPct:
      totalHealingAttempts > 0 ? round1((100 * healerOverhealing) / totalHealingAttempts) : 0,
    tankDtps: round1(tankDamage / Math.max(1 / 20, tankAliveSeconds)),
    raidDtps: round1(raidDamage / seconds),
    oomAt: oomAt !== null ? round1(oomAt) : null,
  };
}

// -------------------------------------------------------------------- MAIN RUNNER

async function main() {
  const NUM_RUNS = 10;
  const BASE_SEED = 424200;

  console.log('================================================================');
  console.log(`MONTE CARLO SIMULATION: CHRONOMANCER VS HOLY PRIEST (${NUM_RUNS} runs/cell)`);
  console.log('Reference: parses.worldofclaudecraft.com (Nythraxis #89995, Ignivar #88229)');
  console.log('================================================================\n');

  // Cell 1: Nythraxis with Holy Priest
  console.log('Running Nythraxis with Holy Priest...');
  const nythPriestRuns: MonteCarloRun[] = [];
  for (let r = 0; r < NUM_RUNS; r++) {
    nythPriestRuns.push(runNythraxisSim('holy_priest', BASE_SEED + r * 7717));
  }

  // Cell 2: Nythraxis with Chronomancer
  console.log('Running Nythraxis with Chronomancer...');
  const nythChronoRuns: MonteCarloRun[] = [];
  for (let r = 0; r < NUM_RUNS; r++) {
    nythChronoRuns.push(runNythraxisSim('chronomancer', BASE_SEED + r * 7717));
  }

  // Cell 3: Ignivar with Holy Priest
  console.log('Running Ignivar with Holy Priest...');
  const igniPriestRuns: MonteCarloRun[] = [];
  for (let r = 0; r < NUM_RUNS; r++) {
    igniPriestRuns.push(runIgnivarSim('holy_priest', BASE_SEED + r * 7717));
  }

  // Cell 4: Ignivar with Chronomancer
  console.log('Running Ignivar with Chronomancer...');
  const igniChronoRuns: MonteCarloRun[] = [];
  for (let r = 0; r < NUM_RUNS; r++) {
    igniChronoRuns.push(runIgnivarSim('chronomancer', BASE_SEED + r * 7717));
  }

  function reportCell(label: string, runs: MonteCarloRun[]) {
    const kills = runs.filter((r) => r.outcome === 'boss_dead').length;
    const wipes = runs.filter((r) => r.outcome === 'wipe').length;
    const timecaps = runs.filter((r) => r.outcome === 'timecap').length;
    const durations = summarize(runs.map((r) => r.seconds));
    const hps = summarize(runs.map((r) => r.healerHps));
    const dps = summarize(runs.map((r) => r.healerDps));
    const absorb = summarize(runs.map((r) => r.healerAbsorb));
    const eHps = summarize(runs.map((r) => r.effectiveHpsTotal));
    const tankDtps = summarize(runs.map((r) => r.tankDtps));
    const deaths = summarize(runs.map((r) => r.deaths));
    const overheal = summarize(runs.map((r) => r.overhealPct));
    const oomCount = runs.filter((r) => r.oomAt !== null).length;

    console.log(`\n--- ${label} ---`);
    console.log(
      `Outcome: ${kills}/${runs.length} Kills (${Math.round((100 * kills) / runs.length)}%), ${wipes} Wipes, ${timecaps} Timecaps`,
    );
    console.log(`Duration: p50 ${durations.p50}s (min ${durations.min}s, max ${durations.max}s)`);
    console.log(
      `Healer HPS: p50 ${hps.p50.toFixed(1)} | Absorb/s: p50 ${absorb.p50.toFixed(1)} | E-HPS: p50 ${eHps.p50.toFixed(1)}`,
    );
    console.log(`Healer DPS: p50 ${dps.p50.toFixed(1)}`);
    console.log(
      `Tank DTPS: p50 ${tankDtps.p50.toFixed(1)} | Deaths/run: p50 ${deaths.p50.toFixed(1)}`,
    );
    console.log(
      `Overheal %: p50 ${overheal.p50.toFixed(1)}% | OOM events: ${oomCount}/${runs.length}`,
    );
  }

  reportCell('NYTHRAXIS - HOLY PRIEST (Baseline)', nythPriestRuns);
  reportCell('NYTHRAXIS - CHRONOMANCER (Reworked)', nythChronoRuns);
  reportCell('IGNIVAR - HOLY PRIEST (Baseline)', igniPriestRuns);
  reportCell('IGNIVAR - CHRONOMANCER (Reworked)', igniChronoRuns);

  console.log('\n================================================================');
  console.log('SIMULATION FINISHED.');
  console.log('================================================================');
}

if (process.argv[1]?.includes('chronomancer_montecarlo')) {
  main().catch(console.error);
}

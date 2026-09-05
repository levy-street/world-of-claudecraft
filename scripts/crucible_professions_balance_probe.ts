// Controlled six-armor-slot comparisons, not BiS or encounter simulations.
// Run: npx tsx scripts/crucible_professions_balance_probe.ts [collection suffix...]
// --stats prints every profile's derived armor-only stat rows instead of combat.
// --tank-burst doubles the incoming pressure, without changing the damage cadence.
import { updateAuras } from '../src/sim/combat/auras';
import { ITEM_SETS, ITEMS, MOBS } from '../src/sim/data';
import {
  createMob,
  createPlayer,
  type PlayerEquipmentInstances,
  recalcPlayerStats,
} from '../src/sim/entity';
import { perfectedBonusStats } from '../src/sim/professions/perfecting_bonus';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { armorReduction, type EquipSlot, type PlayerClass } from '../src/sim/types';
import {
  OWNED_CLASS_LEVEL_20_BOSS_SCENARIO,
  OWNED_CLASS_PBE_LOADOUTS,
  type OwnedDpsSpec,
  type OwnedHealerSpec,
  runOwnedClassDpsProbe,
  runOwnedHealerProbe,
} from './owned_class_balance_probe';

type ArmorLoadout = Partial<Record<EquipSlot, string>>;
type Stage = 'old6' | 'mixed' | 'raid';
type Control = 'full' | 'no_crafted_signature' | 'no_old_capstone';
export interface CrucibleBalanceProfile {
  collection: string;
  cls: PlayerClass;
  old: 'strength' | 'agility' | 'caster' | 'storm';
  raid: string;
  dps?: OwnedDpsSpec;
  healer?: OwnedHealerSpec;
  tank?: 'stonebound' | 'bear';
}

export const CRUCIBLE_BALANCE_PROFILES: readonly CrucibleBalanceProfile[] = [
  {
    collection: 'crucible_str_mail',
    cls: 'shaman',
    old: 'strength',
    raid: 'warspirit_emberscale',
    dps: 'warspirit',
  },
  {
    collection: 'crucible_tank_mail',
    cls: 'shaman',
    old: 'strength',
    raid: 'stonehearth',
    tank: 'stonebound',
  },
  {
    collection: 'crucible_caster_mail',
    cls: 'shaman',
    old: 'storm',
    raid: 'stormkindled',
    dps: 'thundercall',
  },
  {
    collection: 'crucible_healer_mail',
    cls: 'shaman',
    old: 'storm',
    raid: 'springmender',
    healer: 'spiritmend',
  },
  {
    collection: 'crucible_agi_leather',
    cls: 'hunter',
    old: 'agility',
    raid: 'packlord_emberhide',
    dps: 'packlord',
  },
  {
    collection: 'crucible_str_leather',
    cls: 'druid',
    old: 'agility',
    raid: 'wildfang_emberhide',
    dps: 'wildfang',
  },
  {
    collection: 'crucible_tank_leather',
    cls: 'druid',
    old: 'agility',
    raid: 'cinderbark',
    tank: 'bear',
  },
  {
    collection: 'crucible_caster_leather',
    cls: 'druid',
    old: 'caster',
    raid: 'moonscorch',
    dps: 'moongrove',
  },
  {
    collection: 'crucible_healer_leather',
    cls: 'druid',
    old: 'caster',
    raid: 'grovespring',
    healer: 'groveheart',
  },
  {
    collection: 'crucible_caster_cloth',
    cls: 'priest',
    old: 'caster',
    raid: 'vesperash',
    dps: 'vespers',
  },
  {
    collection: 'crucible_healer_cloth',
    cls: 'priest',
    old: 'caster',
    raid: 'emberscreed',
    healer: 'doctrine',
  },
];
export const CRUCIBLE_CRAFTED_PAIRS = [
  ['chest', 'waist'],
  ['chest', 'feet'],
  ['waist', 'feet'],
] as const;
type CraftedPair = (typeof CRUCIBLE_CRAFTED_PAIRS)[number];
const ARMOR_SLOTS = ['helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'] as const;
const OLD_STRENGTH = {
  helmet: 'heroic_crownforged_dreadhelm',
  shoulder: 'heroic_crownforged_warspaulders',
  chest: 'heroic_deathlord_warplate',
  waist: 'crownforged_girdle',
  gloves: 'crownforged_gauntlets',
  feet: 'deathlord_sabatons',
};
const OLD_AGILITY = {
  helmet: 'heroic_nighttalon_crown',
  shoulder: 'heroic_nighttalon_shoulderguards',
  chest: 'heroic_wyrmshadow_harness',
  waist: 'nighttalon_waistband',
  gloves: 'heroic_wyrmshadow_talongrips',
  feet: 'heroic_wyrmshadow_treads',
};
const OLD_CASTER = {
  helmet: 'heroic_soulflame_cowl',
  shoulder: 'heroic_soulflame_mantle',
  chest: 'heroic_necromancers_starshroud',
  waist: 'soulflame_cord',
  gloves: 'soulflame_gloves',
  feet: 'heroic_necromancers_soulsteps',
};
const OLD_STORM = {
  ...OLD_CASTER,
  helmet: 'heroic_stormcallers_crown',
  shoulder: 'heroic_stormcallers_spaulders',
  waist: 'stormcallers_waistguard',
  gloves: 'stormcallers_handguards',
};
const OLD_LOADOUTS = {
  strength: OLD_STRENGTH,
  agility: OLD_AGILITY,
  caster: OLD_CASTER,
  storm: OLD_STORM,
};
export const CRUCIBLE_BALANCE_SEEDS = [29900, 29901, 29902] as const;

export function crucibleBalanceLoadout(
  profile: CrucibleBalanceProfile,
  stage: Stage,
  pair: CraftedPair,
): ArmorLoadout {
  if (stage === 'old6') return { ...OLD_LOADOUTS[profile.old] };
  const armor: ArmorLoadout =
    stage === 'mixed'
      ? { ...OLD_LOADOUTS[profile.old] }
      : {
          helmet: `${profile.raid}_helmet`,
          shoulder: `${profile.raid}_shoulder`,
          gloves: `${profile.raid}_gloves`,
          [pair.some((slot) => slot === 'chest') ? 'legs' : 'chest']:
            `${profile.raid}_${pair.some((slot) => slot === 'chest') ? 'legs' : 'chest'}`,
        };
  for (const slot of pair) armor[slot] = `${profile.collection}_${slot}`;
  return armor;
}

function instanceBonuses(armor: ArmorLoadout, perfected: boolean): PlayerEquipmentInstances {
  const instances: PlayerEquipmentInstances = {};
  if (!perfected) return instances;
  for (const [slot, id] of Object.entries(armor)) {
    if (!id.startsWith('crucible_')) continue;
    const bonus = perfectedBonusStats(ITEMS[id], { level: 29 }) ?? {};
    instances[slot as EquipSlot] = {
      perfected: true,
      perfectingBound: true,
      perfectingBonus: { ...bonus },
      rolled: { stats: { ...bonus } },
    };
  }
  return instances;
}

function setupArmor(sim: Sim, armor: ArmorLoadout, perfected: boolean): void {
  for (const id of [...sim.entities.keys()]) if (id !== sim.playerId) sim.ctx.dropEntity(id);
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing balance player metadata');
  for (const slot of ARMOR_SLOTS) {
    delete meta.equipment[slot];
    delete meta.equipmentInstance[slot];
  }
  for (const [slot, id] of Object.entries(armor)) {
    sim.addItem(id, 1);
    sim.equipItemToSlot(id, slot as EquipSlot);
    if (meta.equipment[slot as EquipSlot] !== id) throw new Error(`failed to equip ${id}`);
  }
  meta.equipmentInstance = { ...meta.equipmentInstance, ...instanceBonuses(armor, perfected) };
  meta.talentMods = computeCharacterModifiers(meta.cls, meta.talents, 20, meta.equipment);
  recalcPlayerStats(sim.player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
  sim.player.hp = sim.player.maxHp;
}

// Content overrides exist only inside this synchronous diagnostic process.
// Always restore the exact original records, including when a probe throws.
function withControl<T>(profile: CrucibleBalanceProfile, control: Control, run: () => T): T {
  const items = Object.entries(ITEMS).filter(([, def]) => def.set === profile.collection);
  const sets = Object.entries(ITEM_SETS).filter(([, def]) => def.lineage);
  try {
    if (control === 'no_crafted_signature') {
      for (const [id, def] of items) ITEMS[id] = { ...def, set: undefined };
    }
    if (control === 'no_old_capstone') {
      for (const [id, def] of sets)
        ITEM_SETS[id] = { ...def, bonuses: def.bonuses.filter((tier) => tier.pieces !== 6) };
    }
    return run();
  } finally {
    for (const [id, def] of items) ITEMS[id] = def;
    for (const [id, def] of sets) ITEM_SETS[id] = def;
  }
}

export function crucibleBalanceStatRows() {
  return CRUCIBLE_BALANCE_PROFILES.flatMap((profile) =>
    variants()
      .filter((variant) => variant.control === 'full')
      .map((variant) => {
        const armor = crucibleBalanceLoadout(profile, variant.stage, variant.pair);
        const player = createPlayer(1, profile.cls, { x: 0, y: 0, z: 0 }, 'Probe');
        player.level = 20;
        recalcPlayerStats(
          player,
          profile.cls,
          armor,
          undefined,
          instanceBonuses(armor, variant.perfected),
        );
        return {
          profile: profile.collection,
          ...variant,
          stats: player.stats,
          hp: player.maxHp,
          attackPower: player.attackPower,
          spellPower: player.spellPower,
          healPower: player.healPower,
          armor,
          crafted: player.craftedCollectionId ?? null,
        };
      }),
  );
}

function tankProbe(
  profile: CrucibleBalanceProfile,
  armor: ArmorLoadout,
  perfected: boolean,
  seed: number,
  tankPulse: 200 | 400,
) {
  const sim = new Sim({ seed, playerClass: profile.cls, autoEquip: false });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec: profile.tank === 'bear' ? 'feral' : 'enhancement', rows: {} }))
    throw new Error('tank talents');
  sim.player.pos = sim.groundPos(50, -90);
  const mainhand =
    OWNED_CLASS_PBE_LOADOUTS[profile.tank === 'bear' ? 'wildfang' : 'warspirit'].mainhand;
  if (!mainhand) throw new Error('missing tank reference weapon');
  sim.addItem(mainhand, 1);
  sim.equipItemToSlot(mainhand, 'mainhand');
  setupArmor(sim, armor, perfected);
  sim.castAbility(profile.tank === 'bear' ? 'bear_form' : 'rockbiter_weapon');
  const player = sim.player;
  const enemy = createMob(999999, MOBS.forest_wolf, 20, sim.groundPos(52, -90));
  enemy.hostile = true;
  sim.entities.set(enemy.id, enemy);
  let hpLoss = 0;
  let absorbed = 0;
  let raw = 0;
  const ward = () =>
    player.auras.reduce((sum, aura) => sum + (aura.kind === 'absorb' ? aura.value : 0), 0);
  // Resolved incoming-pressure fixture, not an active tank rotation. Armor uses
  // the same classic formula as upstream swings; avoidance is deliberately absent.
  for (let tick = 0; tick < 120 * 20; tick++) {
    sim.time += 0.05;
    player.inCombat = true;
    updateAuras(sim.ctx, player);
    if (tick % 20 !== 0) continue;
    player.hp = player.maxHp;
    const incoming = sim.rng.int(tankPulse * 0.9, tankPulse * 1.1);
    raw += incoming;
    const before = ward();
    sim.ctx.dealDamage(
      enemy,
      player,
      Math.round(incoming * (1 - armorReduction(player.stats.armor, 20))),
      false,
      'physical',
      'Controlled pressure',
      'hit',
      true,
    );
    absorbed += Math.max(0, before - ward());
    hpLoss += player.maxHp - player.hp;
  }
  return { hpLoss, absorbed, raw, maxHp: player.maxHp, armor: player.stats.armor };
}

function variants(): { stage: Stage; pair: CraftedPair; perfected: boolean; control: Control }[] {
  const result: ReturnType<typeof variants> = [
    { stage: 'old6', pair: CRUCIBLE_CRAFTED_PAIRS[0], perfected: false, control: 'full' },
    {
      stage: 'old6',
      pair: CRUCIBLE_CRAFTED_PAIRS[0],
      perfected: false,
      control: 'no_old_capstone',
    },
  ];
  for (const pair of CRUCIBLE_CRAFTED_PAIRS)
    for (const stage of ['mixed', 'raid'] as const) {
      result.push({ stage, pair, perfected: false, control: 'full' });
      result.push({ stage, pair, perfected: true, control: 'full' });
      result.push({ stage, pair, perfected: false, control: 'no_crafted_signature' });
    }
  return result;
}

function measure(
  profile: CrucibleBalanceProfile,
  variant: ReturnType<typeof variants>[number],
  seed: number,
  tankPulse: 200 | 400,
) {
  const armor = crucibleBalanceLoadout(profile, variant.stage, variant.pair);
  return withControl(profile, variant.control, () => {
    const observed: { sim?: Sim } = {};
    const setup = (sim: Sim) => {
      observed.sim = sim;
      setupArmor(sim, armor, variant.perfected);
    };
    if (profile.dps) {
      const row = runOwnedClassDpsProbe(
        profile.dps,
        OWNED_CLASS_LEVEL_20_BOSS_SCENARIO,
        seed,
        'isolated-crucible',
        undefined,
        'pbe',
        setup,
      );
      return { dps: row.dps, resourceEnd: row.resource.end };
    }
    if (profile.healer) {
      const row = runOwnedHealerProbe(
        profile.healer,
        3,
        seed,
        'isolated-crucible',
        undefined,
        60,
        setup,
      );
      if (!observed.sim) throw new Error('healer probe did not expose its setup');
      const healerWorld = observed.sim;
      return {
        hps: row.hps,
        absorbed: row.absorbedDamage,
        dps: row.dps,
        resourceEnd: row.resource.end,
        overheal: row.overhealPct,
        recoverySeconds: row.emergencyRecoverySeconds ?? 60,
        livingAllies: [...healerWorld.players.values()].filter(
          (meta) =>
            meta.entityId !== healerWorld.playerId &&
            healerWorld.entities.get(meta.entityId)?.dead === false,
        ).length,
        healerInCombatAtEnd: Number(healerWorld.player.inCombat),
      };
    }
    return tankProbe(profile, armor, variant.perfected, seed, tankPulse);
  });
}

export function runCrucibleBalanceProbe(
  profileSuffixes: readonly string[] = [],
  tankPulse: 200 | 400 = 200,
) {
  const profiles = CRUCIBLE_BALANCE_PROFILES.filter(
    (profile) =>
      !profileSuffixes.length ||
      profileSuffixes.includes(profile.collection.replace('crucible_', '')),
  );
  if (!profiles.length) throw new Error('no matching balance profile');
  for (const profile of profiles)
    for (const variant of variants()) {
      const runs = CRUCIBLE_BALANCE_SEEDS.map((seed) => measure(profile, variant, seed, tankPulse));
      const means = Object.fromEntries(
        Object.keys(runs[0]).map((key) => [
          key,
          runs.reduce(
            (sum, run) => sum + Number((run as unknown as Record<string, number>)[key]),
            0,
          ) / runs.length,
        ]),
      );
      console.log(
        JSON.stringify({
          profile: profile.collection,
          ...variant,
          seeds: CRUCIBLE_BALANCE_SEEDS,
          ...(profile.tank ? { tankPulse } : {}),
          means,
          runs,
        }),
      );
    }
}

if (process.argv[1]?.endsWith('crucible_professions_balance_probe.ts')) {
  if (process.argv.includes('--stats')) console.log(JSON.stringify(crucibleBalanceStatRows()));
  else
    runCrucibleBalanceProbe(
      process.argv.slice(2).filter((arg) => arg !== '--tank-burst'),
      process.argv.includes('--tank-burst') ? 400 : 200,
    );
}

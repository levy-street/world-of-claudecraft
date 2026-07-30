// Caster DPS measurement probe: sustained single-target DPS for the five caster
// DPS specs at level 20, each with its real spec kit, a full set of choice-row
// picks, and a competent priority rotation, against a training dummy for 123
// seconds (the same fight length as scripts/fury_dps_probe.ts so the meters are
// comparable). Auto-equipped leveling gear for every spec, own self-buffs only.
// Built for the shadow-priest rebalance: run the same file on both trees and
// compare. npx tsx scripts/caster_dps_probe.ts
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const FIGHT_SECONDS = 123;
const TICKS = FIGHT_SECONDS * 20;

type AnySim = Sim & Record<string, any>;

interface SpecProbe {
  label: string;
  cls: string;
  spec: string;
  rows: Array<[5 | 8 | 11 | 14 | 17 | 20, string]>;
  prebuffs: string[];
  wand: boolean;
  // Attempted every tick in order; the sim's own GCD/cost/cooldown gates decide
  // what actually fires. Return early to model "wait" decisions.
  rotation: (sim: AnySim, p: Entity, dummy: Entity) => void;
}

const hasOwnDot = (dummy: Entity, p: Entity, id: string) =>
  dummy.auras.some((a) => a.kind === 'dot' && a.id === id && a.sourceId === p.id);

const hasAura = (p: Entity, kind: string) => p.auras.some((a) => a.kind === kind);

const PROBES: SpecProbe[] = [
  {
    label: 'Priest / Vespers (shadow)',
    cls: 'priest',
    spec: 'shadow',
    rows: [
      [5, 'pri_r5_twisted_faith'],
      [8, 'pri_r8_psychic_scream'],
      [11, 'pri_r11_vampiric_embrace'],
      [14, 'pri_r14_pain_and_suffering'],
      [17, 'pri_r17_desperate_prayer'],
      [20, 'pri_r20_mind_sear'],
    ],
    prebuffs: ['shadowform', 'power_word_fortitude'],
    wand: true,
    rotation: (sim, p, dummy) => {
      if (!hasOwnDot(dummy, p, 'shadow_word_pain')) sim.castAbility('shadow_word_pain');
      sim.castAbility('mind_blast');
      sim.castAbility('mind_flay');
    },
  },
  {
    label: 'Mage / Cryomancy (frost)',
    cls: 'mage',
    spec: 'frost',
    rows: [
      [5, 'mag_r5_ice_floes'],
      [8, 'mag_r8_warded'],
      [11, 'mag_r11_twin_nova'],
      [14, 'mag_r14_overload'],
      [17, 'mag_r17_cold_snap'],
      [20, 'mag_r20_evocation'],
    ],
    prebuffs: ['arcane_intellect', 'frost_armor'],
    wand: true,
    rotation: (sim, p) => {
      if (p.resource < 40) sim.castAbility('evocation');
      sim.castAbility('icy_veins');
      sim.castAbility('overload');
      // Ice Lance only when the frost kit has empowered it (a frozen/charged
      // window); unempowered lance spam is a throughput loss.
      if (hasAura(p, 'next_cast_free') || hasAura(p, 'next_cast_instant')) {
        sim.castAbility('ice_lance');
      }
      sim.castAbility('frostbolt');
    },
  },
  {
    label: 'Warlock / Hexcraft (affliction)',
    cls: 'warlock',
    spec: 'affliction',
    rows: [
      [5, 'wlk_r5_bane'],
      [8, 'wlk_r8_voidfeast'],
      [11, 'wlk_r11_improved_life_tap'],
      [14, 'wlk_r14_amplify_curse'],
      [17, 'wlk_r17_death_coil'],
      [20, 'wlk_r20_chaos_bolt'],
    ],
    prebuffs: ['demon_skin'],
    wand: true,
    rotation: (sim, p, dummy) => {
      if (p.resource < 60 && p.hp > p.maxHp * 0.4) {
        sim.castAbility('life_tap');
        return;
      }
      if (!hasOwnDot(dummy, p, 'corruption')) sim.castAbility('corruption');
      if (!hasOwnDot(dummy, p, 'curse_of_agony')) sim.castAbility('curse_of_agony');
      sim.castAbility('chaos_bolt');
      sim.castAbility('shadow_bolt');
    },
  },
  {
    label: 'Shaman / Thundercall (elemental)',
    cls: 'shaman',
    spec: 'elemental',
    rows: [
      [5, 'sha_r5_concussion'],
      [8, 'sha_r8_shock_efficiency'],
      [11, 'sha_r11_elemental_attunement'],
      [14, 'sha_r14_improved_flame_shock'],
      [17, 'sha_r17_elemental_warding'],
      [20, 'sha_r20_bloodlust'],
    ],
    prebuffs: ['lightning_shield'],
    wand: false,
    rotation: (sim, p, dummy) => {
      sim.castAbility('bloodlust');
      const fs = dummy.auras.find(
        (a) => a.kind === 'dot' && a.id === 'flame_shock' && a.sourceId === p.id,
      );
      if (!fs) sim.castAbility('flame_shock');
      // The r14 pick makes Earthen Jolt detonate (consume) the Cinder Jolt DoT,
      // so only detonate near its natural end.
      if (fs && (fs as any).remaining < 2) sim.castAbility('earth_shock');
      sim.castAbility('lightning_bolt');
    },
  },
  {
    label: 'Druid / Moongrove (balance)',
    cls: 'druid',
    spec: 'balance',
    rows: [
      [5, 'dru_r5_improved_wrath'],
      [8, 'dru_r8_typhoon'],
      [11, 'dru_r11_innervate'],
      [14, 'dru_r14_moonfury'],
      [17, 'dru_r17_improved_barkskin'],
      [20, 'dru_r20_improved_hurricane'],
    ],
    prebuffs: ['moonkin_form', 'mark_of_the_wild'],
    wand: false,
    rotation: (sim, p, dummy) => {
      if (p.resource < 40) sim.castAbility('innervate');
      if (!hasOwnDot(dummy, p, 'moonfire')) sim.castAbility('moonfire');
      if (hasAura(p, 'next_cast_free')) sim.castAbility('starfire');
      sim.castAbility('wrath');
    },
  },
];

for (const probe of PROBES) {
  const sim = new Sim({ seed: 4242, playerClass: probe.cls as any, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(20);
  if (!sim.setSpec(probe.spec)) throw new Error(`setSpec ${probe.spec} failed`);
  sim.tick();
  for (const [level, row] of probe.rows) {
    if (!sim.selectTalentRow(level, row)) throw new Error(`row pick failed: ${row}`);
  }

  const p: Entity = sim.player;
  const dummy = createMob(93001, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 5,
  });
  dummy.hostile = true;
  dummy.maxHp = 10_000_000;
  dummy.hp = 10_000_000;
  sim.addEntity(dummy);
  sim.targetEntity(dummy.id);
  p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
  p.autoAttack = probe.wand;

  for (const buff of probe.prebuffs) sim.castAbility(buff);
  // Sum the damage EVENTS rather than the dummy's hp delta: an inert dummy
  // never enters combat against a ranged attacker, so out-of-combat mob regen
  // would silently eat the hp delta and understate every ranged spec.
  let total = 0;
  const byAbility: Record<string, number> = {};
  for (let i = 0; i < TICKS; i++) {
    // Only act when idle: re-invoking castAbility mid-cast restarts the cast
    // (the sim models a client re-press), which would zero out every cast-time
    // spell and channel in the rotation.
    if (!p.castingAbility && !p.channeling) probe.rotation(sim, p, dummy);
    for (const ev of sim.tick()) {
      if (ev.type === 'damage' && ev.targetId === dummy.id && ev.sourceId === p.id) {
        total += ev.amount;
        const key = ev.ability ?? 'auto';
        byAbility[key] = (byAbility[key] ?? 0) + ev.amount;
      }
    }
  }
  const parts = Object.entries(byAbility)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
    .join(', ');
  console.log(
    `${probe.label.padEnd(36)} total=${String(total).padStart(6)} ` +
      `DPS=${(total / FIGHT_SECONDS).toFixed(1).padStart(6)}  ` +
      `endMana=${String(Math.round(p.resource)).padStart(4)}  [${parts}]`,
  );
}

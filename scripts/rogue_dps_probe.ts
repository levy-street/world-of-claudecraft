// Rogue v0.29 DPS probe: sustained per-spec DPS with the spec engines and the
// redesigned rows, in /dev bis epic gear, against a training dummy for 123
// seconds (the fury probe's fight length; run scripts/fury_dps_probe.ts for
// the peer reference). Engine-aware priority rotations: poison up, Cutthroat
// Tempo maintained, 5-combo Dirt Naps (which
// the engines turn into Venomrend detonations and Redline windows), Veilstrike
// windows for Skulduggery, signature and Flurry of Knives on cooldown.
// npx tsx scripts/rogue_dps_probe.ts
import { MOBS } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const FIGHT_SECONDS = 123;
const TICKS = FIGHT_SECONDS * 20;

type AnySim = Sim & Record<string, any>;

const SPECS = ['assassination', 'combat', 'subtlety'] as const;
const R14 = ['rog_r14_dusk_economy', 'rog_r14_venom_dividend', 'rog_r14_ceaseless_cuts'] as const;
const R20 = ['rog_r20_second_shadow', 'rog_r20_deathmark'] as const;

const SEEDS = [4242, 777, 1313, 99, 2024, 555, 31337, 8080];

function runSeed(seed: number, spec: (typeof SPECS)[number], r14: string, r20: string): number {
  const sim = new Sim({ seed, playerClass: 'rogue', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(20);
  if (!sim.setSpec(spec)) throw new Error(`setSpec ${spec} failed`);
  for (const [level, row] of [
    [5, 'rog_r5_killers_pace'],
    [8, 'rog_r8_borrowed_breath'],
    [11, 'rog_r11_marked_prey'],
    [14, r14],
    [17, 'rog_r17_flurry_of_knives'],
    [20, r20],
  ] as const) {
    if (!sim.selectTalentRow(level, row)) throw new Error(`row pick failed: ${row}`);
  }

  const p: Entity = sim.player;
  equipBestInSlotForDev(sim.ctx, p.id);
  // Poison up before the pull (30 min imbue; Knifework's mastery scales it).
  p.resource = p.maxResource;
  sim.castAbility('deadly_poison');
  for (let i = 0; i < 40; i++) sim.tick();

  const dummy = createMob(93001, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  dummy.maxHp = dummy.hp = 10_000_000;
  sim.addEntity(dummy);
  sim.targetEntity(dummy.id);
  p.facing = 0;

  // Every build opens from Duskveil with Gut Punch (fair pre-pull: any rogue
  // can, and Grave Brand builds must not be the only ones credited for it).
  sim.castAbility('stealth');
  for (let i = 0; i < 25; i++) sim.tick();
  p.resource = p.maxResource;
  sim.castAbility('cheap_shot');
  for (let i = 0; i < 5; i++) sim.tick();

  sim.startAutoAttack();
  const startHp = dummy.hp;
  const builder =
    spec === 'subtlety' ? 'hemorrhage' : spec === 'assassination' ? 'backstab' : 'sinister_strike';

  for (let i = 0; i < TICKS; i++) {
    const sndUp = p.auras.some((a: any) => a.kind === 'buff_haste' && a.id === 'slice_and_dice');
    const bankArmed = (p.auras.find((a: any) => a.id === 'gloam')?.stacks ?? 0) >= 3;
    const veilUp = p.auras.some((a: any) => a.id === 'veilstrike');
    if (!p.cooldowns.has('adrenaline_rush')) sim.castAbility('adrenaline_rush');
    if (!p.cooldowns.has('flurry_of_knives')) sim.castAbility('flurry_of_knives');
    if (spec === 'assassination' && !p.cooldowns.has('cold_blood')) sim.castAbility('cold_blood');
    if (spec === 'combat' && !p.cooldowns.has('blade_flurry')) sim.castAbility('blade_flurry');
    // The detonator is free, so a full bank fires the doubled Lurker's
    // Strike immediately; Thuggery still pools before opening its window.
    if (spec === 'subtlety' && bankArmed && !veilUp) {
      sim.castAbility('ambush'); // the free detonator
      sim.tick();
      continue;
    }
    if (
      spec === 'assassination' &&
      p.comboPoints < 5 &&
      !p.cooldowns.has('venom_dart') &&
      p.auras.some((a: any) => a.id === 'venom_ritual')
    ) {
      sim.castAbility('venom_dart'); // tend the wound between detonations
    }
    const redlineUp = p.auras.some((a: any) => a.id === 'redline');
    if (spec === 'subtlety' && veilUp && p.resource >= 60 && p.comboPoints <= 3) {
      sim.castAbility('cheap_shot'); // veil-window opener
    } else if (spec === 'combat' && redlineUp) {
      // Inside the window the buttons transform: Body Blow (the Wicked Slash
      // slot) deepens the run, and once the pips are deep or the clock is
      // short, the Dirt Nap slot cashes out as Knockout Blow.
      const run = p.auras.find((a: any) => a.id === 'redline');
      const pips = run?.stacks ?? 1;
      const closing = (run?.remaining ?? 0) < 1.6;
      if (p.comboPoints >= 5 && (pips >= 4 || closing)) sim.castAbility('eviscerate');
      else if (p.comboPoints >= 4 && closing) sim.castAbility('eviscerate');
      else sim.castAbility('sinister_strike'); // resolves as Body Blow
    } else if (!sndUp && p.comboPoints >= 2) sim.castAbility('slice_and_dice');
    else if (p.comboPoints >= 5) {
      if (spec === 'combat' && p.resource < 70) {
        // Pool to open Redline hot: the sprint inside the fixed 8 sec window
        // is where the spec's damage lives.
      } else {
        // Venomrend re-opens its own wound, so Knifework never juggles Bleed
        // Out upkeep: every full finisher press is Dirt Nap or the armed rend.
        sim.castAbility('eviscerate');
      }
    } else {
      sim.castAbility(builder);
      if (p.comboPoints === 0 && spec !== 'combat') sim.castAbility('sinister_strike');
    }
    sim.tick();
  }
  return (startHp - dummy.hp) / FIGHT_SECONDS;
}

// Single-seed runs carry 2 to 5% trajectory noise, and three-seed averages
// still shuffled the thin knifework row margin; eight seeds hold it stable.
function run(spec: (typeof SPECS)[number], r14: string, r20: string): number {
  const total = SEEDS.reduce((sum, seed) => sum + runSeed(seed, spec, r14, r20), 0);
  return total / SEEDS.length;
}

console.log('spec, r14, r20, dps');
const results: { spec: string; r14: string; r20: string; dps: number }[] = [];
for (const spec of SPECS) {
  for (const r14 of R14) {
    for (const r20 of R20) {
      const dps = run(spec, r14, r20);
      results.push({ spec, r14, r20, dps });
      console.log(
        `${spec}, ${r14.replace('rog_r14_', '')}, ${r20.replace('rog_r20_', '')}, ${dps.toFixed(1)}`,
      );
    }
  }
}
for (const spec of SPECS) {
  const best = results.filter((r) => r.spec === spec).sort((a, b) => b.dps - a.dps)[0];
  console.log(`BEST ${spec}: ${best.r14} + ${best.r20} = ${best.dps.toFixed(1)} dps`);
}

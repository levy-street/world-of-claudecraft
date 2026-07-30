// Fury DPS measurement probe: sustained fury DPS with the real v0.27 kit,
// Titan's Grip dual two-handers, Anger Management + Recklessness + Colossal
// Might row picks, and a competent Red Harvest priority rotation, against a
// training dummy for 123 seconds (the length of the live meter fight that
// anchored the v0.27.1 nerf: live 222/s mapped to 230.6 here on the pre-fix
// tree, 147.2 post-fix). Kept for sizing coefficient follow-ups: run the same
// file on both trees and compare. npx tsx scripts/fury_dps_probe.ts
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const FIGHT_SECONDS = 123;
const TICKS = FIGHT_SECONDS * 20;

type AnySim = Sim & Record<string, any>;

const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true }) as AnySim;
sim.setPlayerLevel(20);
if (!sim.setSpec('fury')) throw new Error('setSpec fury failed');
sim.tick(); // stance reconcile: Battle -> Berserker (the fury default)

for (const [level, row] of [
  [14, 'war_row_anger_management'],
  [17, 'war_row_recklessness'],
  [20, 'war_row_colossal_might'],
] as const) {
  if (!sim.selectTalentRow(level, row)) throw new Error(`row pick failed: ${row}`);
}

const p: Entity = sim.player;
const meta = sim.players.get(p.id);
if (!meta) throw new Error('no meta');
meta.equipment.mainhand = 'deathless_greatblade';
meta.equipment.offhand = 'bonewrought_greatsword';
recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);

const dummy = createMob(93001, MOBS.training_dummy, 20, {
  x: p.pos.x,
  y: p.pos.y,
  z: p.pos.z + 2,
});
dummy.hostile = true;
dummy.maxHp = 10_000_000;
dummy.hp = 10_000_000;
sim.addEntity(dummy);
sim.targetEntity(dummy.id);
p.facing = 0;
p.autoAttack = true;

// Priority rotation, attempted every tick; the sim's own GCD/cost/cooldown
// gates decide what actually fires.
const ROTATION = ['recklessness', 'red_harvest', 'bloodthirst', 'raging_gale', 'whirlwind'];

const START_HP = dummy.hp;
let rhCasts = 0;
sim.castAbility('battle_shout');
for (let i = 0; i < TICKS; i++) {
  for (const id of ROTATION) {
    if (id === 'red_harvest') {
      if (p.resource < 80) continue;
      const before = p.resource;
      sim.castAbility(id);
      if (p.resource < before - 40) rhCasts++;
    } else {
      sim.castAbility(id);
    }
  }
  sim.tick();
}

const total = START_HP - dummy.hp;
console.log(`titansGrip=${(p as any).titansGrip ?? 'n/a'} endRage=${Math.round(p.resource)}`);
console.log(
  `total=${total} over ${FIGHT_SECONDS}s -> DPS=${(total / FIGHT_SECONDS).toFixed(1)} ` +
    `(red harvests: ${rhCasts}, ${((rhCasts / FIGHT_SECONDS) * 60).toFixed(1)}/min)`,
);

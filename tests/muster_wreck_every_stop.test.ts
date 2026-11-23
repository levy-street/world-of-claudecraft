// Every stop of Balgath's warpath is a wreck that kills the squad standing there.
//
// The owner's playtest: he ran to a picket, did "nothing" there, then ran on and flattened
// the others. The cause was his ordinary FOCUS-phase slams (aoePulse, stomp, hammer,
// cleave: mob/boss_collateral.ts): a pull that opened beside a picket crushed that squad
// while he was still fighting at the start, so when the circuit later marched him onto it
// the arrival slam landed on a camp of corpses. His slams still crush soldiers (the owner
// wants every blow to), so instead the circuit SKIPS a razed picket (mob/warpath.ts
// warpathStopRazed): every march ends on a squad with somebody standing, and the arrival
// slam takes all of them. A full lap is pinned from both ways the boss reaches the world:
// the live scheduler raising him in his crater bed, and `/dev spawn` dropping a copy beside
// the player on the crater's rim (the exact route the owner took when the boss seemed
// missing). In both the opening fight is beside the rim picket, so its squad dies to his
// focus slams and the march skips it.
import { describe, expect, it } from 'vitest';
import {
  MUSTER_CIRCUIT,
  MUSTER_COMMAND_KEEP_OUT,
  MUSTER_INNER_RADIUS,
  musterCamp,
} from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { spawnMobsForDev } from '../src/sim/dev_commands';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { musterPicketRazed } from '../src/sim/muster_picket_razed';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';

/** A camp-free world (the warpath suite's trick): only the bodies under test tick. */
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

interface Internals {
  ctx: SimContext;
  musterArmy: MusterArmyState;
  setGm(pid?: number, on?: boolean): void;
}
const inner = (sim: Sim) => sim as unknown as Internals;

function newSim(scheduled: boolean): Sim {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    world: WORLD,
    worldBossAtBoot: scheduled,
    mirefenMuster: true,
  });
  sim.setPlayerLevel(20);
  // Godded, or he kills the lone tester and the lap becomes an assertion about a corpse.
  inner(sim).setGm(sim.playerId, true);
  return sim;
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

/** The live soldiers posted in a picket's inner ring (the squad an arrival slam takes). */
function innerRingOf(sim: Sim, campId: string): number[] {
  const camp = musterCamp(campId as (typeof MUSTER_CIRCUIT)[number]);
  return inner(sim).musterArmy.soldierIds.filter((id) => {
    const s = sim.entities.get(id);
    if (!s) return false;
    return (
      Math.hypot(s.spawnPos.x - camp.center.x, s.spawnPos.z - camp.center.z) <= MUSTER_INNER_RADIUS
    );
  });
}

interface StopResult {
  stop: number;
  /** Yards from the picket's centre to where the fists came down. */
  offCentre: number;
  /** Inner-ring soldiers standing when the ring went down, and how many the slam killed. */
  standingAtRing: number;
  killed: number;
}

/** Every picket of the circuit razed (the lap is over: nothing left to march on). */
function allRazed(sim: Sim): boolean {
  const def = MOBS[BALGATH]?.warpath;
  if (!def) return false;
  return def.destinations.every((d) =>
    musterPicketRazed(inner(sim).ctx, inner(sim).musterArmy, d.x, d.z, def.wreck.radius),
  );
}

/**
 * Run until every picket is razed with the player hanging `keep` yards off him (a ranged
 * raider, not a tank glued to his shins: that is what lets the opening fight happen beside
 * a picket), and record every arrival slam.
 */
function lap(sim: Sim, boss: Entity, keep: number): StopResult[] {
  const player = sim.player;
  const def = MOBS[BALGATH]?.warpath;
  if (!def) throw new Error('no warpath');
  const out: StopResult[] = [];
  let ringStop: number | null = null;
  let standing: number[] = [];
  const hurt = (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage;
  for (let i = 0; i < 20 * 240 && !(allRazed(sim) && ringStop === null); i++) {
    // A chip hit a second, as a raid chasing him lands: a pull nobody hurts for 30 seconds
    // is one he gives up on (mob/warpath.ts warpathGiveUp).
    if (i % 20 === 0) hurt.call(sim, player, boss, 20, false, 'physical', 'probe', 'hit', true);
    const d = Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
    // A raider punted into the command camp walks back out toward him: he can never enter
    // its circle (mob/keep_out.ts), so one left standing there is an unreachable target,
    // and that is the stall evade rather than the lap this test is about.
    const camp = MUSTER_COMMAND_KEEP_OUT;
    const inCamp = Math.hypot(player.pos.x - camp.x, player.pos.z - camp.z) <= camp.radius + 2;
    if (d > keep || inCamp) {
      const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
      place(sim, player, player.pos.x + Math.sin(a) * 0.35, player.pos.z + Math.cos(a) * 0.35);
    }
    for (const ev of sim.tick()) {
      if (ev.type !== 'spellfxAt' || ev.radius !== def.wreck.radius) continue;
      if (ev.fx === 'runeCircle') {
        ringStop = boss.warpathDestination ?? 0;
        standing = innerRingOf(sim, MUSTER_CIRCUIT[ringStop]).filter(
          (id) => !sim.entities.get(id)?.dead,
        );
      } else if (ev.fx === 'nova' && ringStop !== null) {
        const c = musterCamp(MUSTER_CIRCUIT[ringStop]).center;
        out.push({
          stop: ringStop,
          offCentre: Math.hypot(ev.x - c.x, ev.z - c.z),
          standingAtRing: standing.length,
          killed: standing.filter((id) => sim.entities.get(id)?.dead).length,
        });
        ringStop = null;
      }
    }
    // Dragged to the edge of his tether he marches on; he never evades out of the lap.
    expect(boss.aiState, 'he evaded out of his own lap').not.toBe('evade');
  }
  return out;
}

function expectEveryStopWrecked(sim: Sim, results: StopResult[]): void {
  const def = MOBS[BALGATH]?.warpath;
  expect(allRazed(sim), 'the lap never razed every picket').toBe(true);
  // The opening fight beside the rim picket crushed its squad: the march skipped it.
  expect(results.map((r) => r.stop)).not.toContain(0);
  // Each picket he marched on he marched on once, in circuit order. A picket a FOCUS fight
  // drifted over and crushed is razed and skipped, by design (mob/warpath.ts
  // warpathStopRazed), so which of the later stops a lap reaches depends on where the
  // chase dragged him; that he never marches on a razed one, never twice, and wrecks
  // most of the circuit does not.
  const stops = results.map((r) => r.stop);
  expect(stops.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
  for (const s of stops) expect([1, 2, 3]).toContain(s);
  for (const r of results) {
    const where = MUSTER_CIRCUIT[r.stop];
    expect(r.offCentre, `he stopped short of ${where}`).toBeLessThanOrEqual(def?.arriveRadius ?? 0);
    // Somebody was still standing for him to flatten (never a camp of corpses)...
    expect(r.standingAtRing, `the ${where} squad was already dead`).toBeGreaterThan(0);
    // ...and the arrival slam took every one of them.
    expect(r.killed, `the wreck at ${where} killed`).toBe(r.standingAtRing);
  }
}

describe('every warpath stop is a wreck with kills', () => {
  it('from his crater bed, with the pull opening beside the rim picket', () => {
    const sim = newSim(true);
    // A raider standing on the west rim, a few yards off the rim picket, pulls him out of
    // the bowl: his whole opening focus phase is fought on top of that picket.
    place(sim, sim.player, 128, 300);
    sim.tick();
    const bossId = inner(sim).musterArmy.bossId;
    const boss = bossId !== null ? sim.entities.get(bossId) : undefined;
    if (!boss) throw new Error('the scheduler raised no Balgath');
    expect(boss.spawnPos.x).toBeCloseTo(147, 0);
    expectEveryStopWrecked(sim, lap(sim, boss, 12));
  });

  it('from a /dev spawn copy dropped beside the player on the crater rim', () => {
    const sim = newSim(false);
    place(sim, sim.player, 125, 300);
    sim.tick();
    const [id] = spawnMobsForDev(inner(sim).ctx, sim.playerId, BALGATH);
    const boss = sim.entities.get(id);
    if (!boss) throw new Error('/dev spawn raised no Balgath');
    // The muster answers a dev copy on its once-a-second scan.
    for (let i = 0; i < 25 && inner(sim).musterArmy.bossId !== id; i++) sim.tick();
    expect(inner(sim).musterArmy.bossId).toBe(id);
    expectEveryStopWrecked(sim, lap(sim, boss, 20));
  });
});

// The warpath: a boss who walks a circuit instead of parking in your melee range
// (src/sim/mob/warpath.ts).
//
// Two layers here, because the mechanic has two kinds of failure. The phase machine is a
// pure function and gets driven directly: its bugs live on transitions nobody happens to
// reproduce, and a live-Sim test that runs one lap would never visit the timeout arm at
// all. Everything else needs the real world, because what actually broke in development
// was not the state machine but a single line that turned the body toward the player it
// was swatting, which no unit test of a phase enum could ever have seen.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MUSTER_CAMPS,
  MUSTER_CIRCUIT,
  MUSTER_RACK,
  musterCamp,
} from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { mobCombatProfile } from '../src/sim/mob/combat_profile';
import {
  focusDraggedToLeash,
  nextWarpathDestination,
  nextWarpathPhase,
  resetWarpath,
  WARPATH_WRECK_FUSE_SEC,
  warpathPhaseDuration,
} from '../src/sim/mob/warpath';
import { Sim } from '../src/sim/sim';
import { type Entity, LEASH_DISTANCE, type MobTemplate, type WorldContent } from '../src/sim/types';
import {
  groundHeight,
  isInWaterBody,
  terrainHeight,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const BALGATH = 'balgath_cyclops';

/** Where the live scheduler spawns him: inside the Starfall Crater (world_boss.ts). */
function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

// The live-world suites below need him, a player and the terrain, not the other
// several hundred mobs of the continent: a camp-free world keeps every 20 Hz tick to
// the two bodies under test, so a 200-second chase costs seconds rather than minutes.
const WARPATH_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function def(): NonNullable<MobTemplate['warpath']> {
  const d = MOBS[BALGATH]?.warpath;
  if (!d) throw new Error('balgath_cyclops declares no warpath');
  return d;
}

describe('warpath phase machine', () => {
  it('leaves focus only when its clock runs out', () => {
    expect(nextWarpathPhase('focus', 4, 999, def())).toBe('focus');
    expect(nextWarpathPhase('focus', 0, 999, def())).toBe('travel');
  });

  it('cuts focus short and marches on once the fight drags him to his tether', () => {
    // Instead of evading home out of his own fight (the owner's "ran to a spot and did
    // nothing"), a focus dragged to the leash edge sets off for the next stop.
    expect(nextWarpathPhase('focus', 20, 999, def(), true)).toBe('travel');
    expect(nextWarpathPhase('focus', 20, 999, def(), false)).toBe('focus');
    // Only focus reads it: a run or a wreck in progress is never cut short by it.
    expect(nextWarpathPhase('travel', 20, 999, def(), true)).toBe('travel');
    expect(nextWarpathPhase('wreck', 1, 0, def(), true)).toBe('wreck');
  });

  it('ends a run on ARRIVAL, whatever the clock says', () => {
    expect(nextWarpathPhase('travel', 30, def().arriveRadius - 0.1, def())).toBe('wreck');
    expect(nextWarpathPhase('travel', 30, def().arriveRadius + 40, def())).toBe('travel');
  });

  it('gives up on a landmark it cannot reach, rather than travelling forever', () => {
    // The patience cap. Without it a wedged body travels (and regenerates) indefinitely,
    // which is a soft-lock rather than a mechanic; it is unreachable from a one-lap
    // integration test, so it is pinned here.
    expect(nextWarpathPhase('travel', 0, 9999, def())).toBe('wreck');
  });

  it('returns to focus after the arrival set-piece', () => {
    expect(nextWarpathPhase('wreck', 1, 0, def())).toBe('wreck');
    expect(nextWarpathPhase('wreck', 0, 0, def())).toBe('focus');
  });

  it('leaves the raid long enough on the ground to slam before he moves again', () => {
    // The wreck phase must outlast its own fuse, or he would set off for the next landmark
    // with the ring still burning and the slam would land on empty ground behind him.
    expect(warpathPhaseDuration('wreck', def())).toBeGreaterThan(WARPATH_WRECK_FUSE_SEC);
  });
});

describe('warpath circuit', () => {
  it('walks the authored list in order and wraps', () => {
    expect(nextWarpathDestination(-1, 4)).toBe(0);
    expect(nextWarpathDestination(0, 4)).toBe(1);
    expect(nextWarpathDestination(3, 4)).toBe(0);
  });

  it('passes over a razed stop to the next one still standing, and gives none when all are', () => {
    // Stop 1 razed: from 0 he goes on to 2. Stops 1 and 2 razed: from 0 he goes to 3.
    expect(nextWarpathDestination(0, 4, (i) => i === 1)).toBe(2);
    expect(nextWarpathDestination(0, 4, (i) => i === 1 || i === 2)).toBe(3);
    // It wraps past the end, and may land back on the stop he just left if it still stands.
    expect(nextWarpathDestination(2, 4, (i) => i === 3)).toBe(0);
    expect(nextWarpathDestination(0, 4, (i) => i !== 0)).toBe(0);
    // Every stop razed: nowhere left worth marching on.
    expect(nextWarpathDestination(0, 4, () => true)).toBeNull();
  });

  it('visits every authored stop, which a furthest-first pick would not', () => {
    // The reason this is a circuit: with four landmarks, "always run to the furthest"
    // ping-pongs between the two extremes forever and the town in the middle is never
    // visited at all, so the headline promise of the encounter silently never happens.
    const n = def().destinations.length;
    const seen = new Set<number>();
    let at = -1;
    for (let i = 0; i < n; i++) {
      at = nextWarpathDestination(at, n) ?? -1;
      seen.add(at);
    }
    expect(seen.size).toBe(n);
  });

  it("walks the pickets of the Mirefen muster, in the muster's circuit order", () => {
    // The whole point of the rework: he runs somewhere because there are soldiers there.
    // Every stop is a picket of the muster, exactly, in MUSTER_CIRCUIT order, so the two
    // tables can never drift apart and leave him slamming an empty field.
    const stops = def().destinations;
    expect(stops.map((d) => ({ x: d.x, z: d.z }))).toEqual(
      MUSTER_CIRCUIT.map((id) => musterCamp(id).center),
    );
    for (const id of MUSTER_CIRCUIT) expect(musterCamp(id).onCircuit).toBe(true);
    // The command camp (the weapon rack) is never a stop.
    expect(MUSTER_CAMPS.filter((c) => !c.onCircuit).map((c) => c.id)).toEqual(['command']);
  });

  it('opens with a march on the rim picket that fits inside his patience', () => {
    // A short march now, but still a march, and it must fit the travel timeout with room or
    // a slow on the opening leg would have him give up and wreck an empty patch of rim.
    const spawn = lair();
    const first = def().destinations[0];
    expect(first.label).toContain('rim');
    const opening = Math.hypot(first.x - spawn.x, first.z - spawn.z);
    expect(opening).toBeGreaterThan(25);
    const travelSpeed = (MOBS[BALGATH]?.moveSpeed ?? 0) * def().travelSpeedMult;
    expect(opening / travelSpeed).toBeLessThan(def().travelTimeoutSeconds * 0.75);
  });

  it('keeps the circuit short: a lap of the crater, not a tour of the zone', () => {
    // The owner's call: the old circuit crossed the whole marsh (a 175-yard opening leg,
    // stops at the chapel, the mound, the town and the gravecallers). Every leg is now a
    // short run between neighbouring pickets, and still long enough to be a chase.
    const stops = def().destinations;
    let lap = 0;
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i];
      const b = stops[(i + 1) % stops.length];
      const leg = Math.hypot(a.x - b.x, a.z - b.z);
      expect(leg, `${a.label} to ${b.label}`).toBeGreaterThan(25);
      expect(leg, `${a.label} to ${b.label}`).toBeLessThan(60);
      lap += leg;
    }
    expect(lap).toBeLessThan(220);
  });
});

/** Every sample along a leg, and along two parallel lines 5 yards either side of it. */
function legSamples(
  a: { x: number; z: number },
  b: { x: number; z: number },
): { x: number; z: number }[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const steps = Math.ceil(len);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const off of [-5, -2.5, 0, 2.5, 5]) {
      out.push({ x: a.x + (b.x - a.x) * t - uz * off, z: a.z + (b.z - a.z) * t + ux * off });
    }
  }
  return out;
}

/**
 * The opening leg from his bed, then EVERY stop-to-stop leg, not only the lap's neighbours:
 * the circuit skips a razed picket (mob/warpath.ts warpathStopRazed), so any stop can follow
 * any other.
 */
function allLegs(): [
  { x: number; z: number; label?: string },
  { x: number; z: number; label?: string },
][] {
  const stops = def().destinations;
  return [
    [lair(), stops[0]],
    ...stops.flatMap((a) =>
      stops.filter((b) => b !== a).map((b) => [a, b] as [typeof a, typeof a]),
    ),
  ];
}

describe('warpath circuit is dry and clear', () => {
  it('never runs a leg through the water, not even the shallows', () => {
    // The owner watched him cross a lake. He walks the STRAIGHT LINE between stops, and
    // although he wades (MobTemplate.wadeDepth) the raid chasing him does not, and a leg
    // that clips even the shallows turns the chase into a swim. So every leg, and the
    // opening leg from his bed, is measured end to end at one-yard steps across a 10-yard
    // corridor: never inside a declared water body's footprint, never open sea, and the
    // ground (both the rendered terrain and the walkable floor) a full yard above the
    // waterline everywhere, so no puddle of the zone's water plane can show through.
    const wl = waterLevel();
    for (const [a, b] of allLegs()) {
      const name = b.label ?? 'the first stop';
      for (const pt of legSamples(a, b)) {
        const where = `${Math.round(pt.x)},${Math.round(pt.z)} on the leg to ${name}`;
        expect(isInWaterBody(pt.x, pt.z), `inside a lake footprint at ${where}`).toBe(false);
        expect(waterLevelAt(pt.x, pt.z, WORLD_SEED), `water at ${where}`).toBe(
          Number.NEGATIVE_INFINITY,
        );
        const ground = Math.min(
          terrainHeight(pt.x, pt.z, WORLD_SEED),
          groundHeight(pt.x, pt.z, WORLD_SEED),
        );
        expect(ground - wl, `shallow ground at ${where}`).toBeGreaterThan(1);
      }
    }
  });

  it('keeps every leg clear of every wildlife camp', () => {
    // The chase drags a raid of mixed levels behind him: no leg may pass within aggro reach
    // (20 at most) of a camp's edge plus the raid's own spread around him.
    for (const [a, b] of allLegs()) {
      for (const camp of BUILTIN_WORLD.camps) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const pt of legSamples(a, b)) {
          nearest = Math.min(nearest, Math.hypot(camp.center.x - pt.x, camp.center.z - pt.z));
        }
        expect(
          nearest - camp.radius,
          `the leg to ${b.label ?? 'the first stop'} passes the ${camp.mobId} camp`,
        ).toBeGreaterThan(22);
      }
    }
  });

  it("keeps his arrival slams and his travelling swipe off the command camp's rack", () => {
    // The rack is where a level 6 walks up for a pike. It must never sit under a stop's
    // Barrowfall ring or beside a leg he backhands his way along.
    const rack = MUSTER_RACK;
    for (const stop of def().destinations) {
      expect(Math.hypot(stop.x - rack.x, stop.z - rack.z)).toBeGreaterThan(def().wreck.radius + 10);
    }
    for (const [a, b] of allLegs()) {
      for (const pt of legSamples(a, b)) {
        expect(Math.hypot(pt.x - rack.x, pt.z - rack.z)).toBeGreaterThan(def().swipe.radius + 10);
      }
    }
  });
});

describe('warpath in a live world', () => {
  let sim: Sim;
  let boss: Entity;
  let player: Entity;

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = terrainHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };

  beforeEach(() => {
    sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: WARPATH_TEST_WORLD });
    sim.setPlayerLevel(20);
    // Godded, or he simply kills the sole tester in the first few seconds and every
    // assertion below turns into an assertion about a corpse.
    (sim as unknown as { setGm(pid?: number, on?: boolean): void }).setGm(sim.playerId, true);
    player = sim.player;
    // Spawned where the live scheduler spawns him, with the player standing off his lair
    // the way a raid that walked out to the crater would.
    const spawn = lair();
    place(player, spawn.x, spawn.z - 18);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, spawn.x, spawn.z);
    const e = sim.entities.get(id);
    if (!e) throw new Error('the dev boss did not spawn');
    boss = e;
  });

  /**
   * Run until `done`, keeping the player glued to the boss the way a raid would, and (unless
   * `harry` is off) landing a chip hit every second the way a raid would too: a pull nobody
   * hurts for 30 seconds is one he gives up on (warpathGiveUp), so a chase that never hits
   * him would be measuring that rule instead of the circuit.
   */
  const chase = (seconds: number, done?: () => boolean, harry = true): number => {
    const hurt = (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage;
    for (let i = 0; i < 20 * seconds; i++) {
      if (harry && i % 20 === 0 && boss.aiState !== 'evade') {
        hurt.call(sim, player, boss, 20, false, 'physical', 'probe', 'hit', true);
      }
      const d = Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
      if (d > 6) {
        const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
        player.pos.x += Math.sin(a) * 7 * 0.05;
        player.pos.z += Math.cos(a) * 7 * 0.05;
        player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
      }
      sim.tick();
      if (done?.()) return i / 20;
    }
    return Number.POSITIVE_INFINITY;
  };

  it('leaves his spawn under his own steam and reaches a landmark', () => {
    // The whole complaint: engaged, he used to hold station a dozen yards off the tank
    // forever. He must now cross real ground on his own schedule.
    const arrived = chase(90, () => boss.warpathPhase === 'wreck');
    expect(arrived).toBeLessThan(90);
    const stop = def().destinations[boss.warpathDestination ?? 0];
    expect(Math.hypot(boss.pos.x - stop.x, boss.pos.z - stop.z)).toBeLessThanOrEqual(
      def().arriveRadius,
    );
    // He got there himself: the first stop is the rim picket, 29 yards from his bed in the
    // crater, and he stops within arriveRadius of it, so anything near that gap is a real
    // journey out of the bowl rather than the shuffle he used to do.
    expect(Math.hypot(boss.pos.x - boss.spawnPos.x, boss.pos.z - boss.spawnPos.z)).toBeGreaterThan(
      22,
    );
  });

  it('walks a whole lap of the pickets without the leash ever yanking him home', () => {
    // The soft leash measures 45 yards from where the pull was stamped, and his travel keeps
    // re-stamping it (mob/warpath.ts). The circuit is a short lap of the crater now, so the
    // pin is the whole lap: every picket reached and wrecked in order, with no evade and no
    // dropped pull anywhere on the way. After it every picket's squad is down (the dead stay
    // down for the whole fight), so he holds the fight rather than marching on corpses.
    let evaded = false;
    const wrecked: number[] = [];
    chase(260, () => {
      if (boss.aiState === 'evade') evaded = true;
      const at = boss.warpathDestination ?? -1;
      if (boss.warpathPhase === 'wreck' && wrecked[wrecked.length - 1] !== at) wrecked.push(at);
      return evaded || wrecked.length > def().destinations.length;
    });
    expect(evaded, 'the leash pulled him off his own circuit').toBe(false);
    expect(boss.aggroTargetId, 'he dropped the pull instead of finishing the lap').not.toBeNull();
    expect(wrecked).toEqual([0, 1, 2, 3]);
    // The last set piece plays out, then he holds the fight: nothing is left standing.
    chase(10, () => boss.warpathPhase === 'focus');
    chase(40);
    expect(boss.aiState).not.toBe('evade');
    expect(boss.warpathPhase, 'with every picket razed he holds focus').toBe('focus');
  });

  it('re-tethers around the landmark once he stops', () => {
    // The other half of the leash rule, and the half that is easy to lose. He must be
    // untethered while TRAVELLING (the test above) and tethered again the moment he
    // arrives, or an open-world boss becomes something one kiting player can walk to the
    // other side of the map and abandon there. Both facts live in the same line of
    // mob/warpath.ts, so both are pinned.
    chase(120, () => boss.warpathPhase === 'wreck');
    expect(boss.warpathPhase).toBe('wreck');
    const anchor = boss.leashAnchor;
    expect(anchor, 'he arrived with no anchor at all, so nothing can tether him').not.toBeNull();
    expect(Math.hypot((anchor?.x ?? 0) - boss.pos.x, (anchor?.z ?? 0) - boss.pos.z)).toBeLessThan(
      1,
    );
    // And the profile still opts him into leashing, which is what reads that anchor.
    expect(mobCombatProfile(boss).canLeash).toBe(true);
  });

  it('faces exactly where he is going, on every single moving tick', () => {
    // The reported artifact, as a measurement. A body whose facing and velocity disagree
    // reads as running forward while sliding sideways, and it is invisible in a screenshot.
    // A first cut of the travelling backhand turned him toward whoever he swatted for one
    // tick, which showed up here at a clean pi and nowhere else.
    let worst = 0;
    let moved = 0;
    let last = { x: boss.pos.x, z: boss.pos.z };
    const sample = () => {
      const vx = boss.pos.x - last.x;
      const vz = boss.pos.z - last.z;
      last = { x: boss.pos.x, z: boss.pos.z };
      if (Math.hypot(vx, vz) <= 0.02) return false;
      moved++;
      let err = Math.abs(Math.atan2(vx, vz) - boss.facing);
      while (err > Math.PI) err = Math.abs(err - 2 * Math.PI);
      worst = Math.max(worst, err);
      return false;
    };
    chase(80, sample);
    expect(moved, 'he never moved, so this proved nothing').toBeGreaterThan(200);
    expect(worst).toBeLessThan(0.05);
  });

  it('stands still through the whole arrival set-piece', () => {
    // The slam is measured from where the ring was drawn, so any drift during the fuse
    // separates the blast from its own telegraph. Planting him is also what keeps the one
    // remaining source of a facing-vs-velocity mismatch out of the fight: during the wreck
    // he turns to face the raid, so he must not be translating while he does it.
    chase(120, () => boss.warpathPhase === 'wreck');
    expect(boss.warpathPhase).toBe('wreck');
    const anchor = { x: boss.pos.x, z: boss.pos.z };
    let drift = 0;
    chase(3, () => {
      if (boss.warpathPhase !== 'wreck') return true;
      drift = Math.max(drift, Math.hypot(boss.pos.x - anchor.x, boss.pos.z - anchor.z));
      return false;
    });
    expect(drift).toBeLessThan(0.01);
  });

  it('heals only once the raid stops hurting him, and stops the moment they resume', () => {
    chase(40, () => boss.warpathPhase === 'travel');
    expect(boss.warpathPhase).toBe('travel');
    boss.hp = boss.maxHp * 0.5;

    // Left alone while he runs, he claws health back.
    const before = boss.hp;
    chase(6, () => false, false);
    expect(boss.hp).toBeGreaterThan(before);

    // Hit him every tick and the regen never arms: the unharried clock keeps resetting.
    // Ten a tick, not one: his standing ward (mob/eye_ward.ts) shrugs off 60% of every hit
    // and a single point rounds to nothing landed, which is a legitimate "unharried" (no
    // health was lost) rather than the chip damage this is meant to measure. The old
    // 45-yard opening leg hid that by ending travel inside the window; the crater march
    // does not.
    const hurt = (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage;
    boss.hp = boss.maxHp * 0.5;
    const held = boss.hp;
    for (let i = 0; i < 20 * 6; i++) {
      hurt.call(sim, player, boss, 10, false, 'physical', 'probe', 'hit', true);
      sim.tick();
    }
    // Six seconds of chip damage removes a few hundred; regen at 1.5% of a world-boss
    // pool per second would dwarf that, so anything below the starting value proves it
    // never ran.
    expect(boss.hp).toBeLessThan(held);
  });

  it('shows the arrival ring BEFORE the arrival slam lands', () => {
    // The counterplay contract every other mechanic in this fight keeps: what you were
    // shown is what you have to leave. A slam that resolved on the same tick it announced
    // itself would be an unavoidable hit dressed as a telegraph.
    let ringAt: number | null = null;
    let novaAt: number | null = null;
    const hurt = (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage;
    for (let i = 0; i < 20 * 90 && novaAt === null; i++) {
      // Chip hits, as chase() lands: an unhurt pull is one he gives up on.
      if (i % 20 === 0) hurt.call(sim, player, boss, 20, false, 'physical', 'probe', 'hit', true);
      const d = Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
      if (d > 6) {
        const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
        player.pos.x += Math.sin(a) * 7 * 0.05;
        player.pos.z += Math.cos(a) * 7 * 0.05;
      }
      for (const ev of sim.tick()) {
        if (ev.type !== 'spellfxAt' || ev.radius !== def().wreck.radius) continue;
        if (ev.fx === 'runeCircle' && ringAt === null) ringAt = i / 20;
        if (ev.fx === 'nova' && ringAt !== null) novaAt = i / 20;
      }
    }
    expect(ringAt).not.toBeNull();
    expect(novaAt).not.toBeNull();
    expect((novaAt ?? 0) - (ringAt ?? 0)).toBeGreaterThanOrEqual(WARPATH_WRECK_FUSE_SEC - 0.1);
  });
});

describe('a focus fight dragged to the tether', () => {
  const setup = (anchorOffset: number) => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: true,
      world: WARPATH_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    (sim as unknown as { setGm(pid?: number, on?: boolean): void }).setGm(sim.playerId, true);
    const spawn = lair();
    const player = sim.player;
    player.pos.x = spawn.x;
    player.pos.z = spawn.z - 12;
    player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, spawn.x, spawn.z);
    const boss = sim.entities.get(id) as Entity;
    for (let i = 0; i < 40 && boss.warpathPhase !== 'focus'; i++) sim.tick();
    expect(boss.warpathPhase).toBe('focus');
    // Plant his tether `anchorOffset` yards behind him, as half a minute of punted raiders
    // dragging him off his landmark would.
    boss.leashAnchor = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + anchorOffset };
    return { sim, boss };
  };

  it('marches on to the next stop instead of evading home', () => {
    const { sim, boss } = setup(LEASH_DISTANCE - 0.5);
    expect(focusDraggedToLeash(boss)).toBe(true);
    const before = boss.warpathDestination ?? -1;
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.warpathPhase).toBe('travel');
    expect(boss.warpathDestination).toBe(nextWarpathDestination(before, def().destinations.length));
    expect(boss.aggroTargetId).toBe(sim.playerId);
  });

  it('keeps fighting while the tether still has room', () => {
    const { sim, boss } = setup(LEASH_DISTANCE - 2);
    expect(focusDraggedToLeash(boss)).toBe(false);
    sim.tick();
    expect(boss.warpathPhase).toBe('focus');
    expect(boss.aiState).not.toBe('evade');
  });
});

describe('warpath state hygiene', () => {
  it('is inert for a mob whose template never declared one', () => {
    // Every other mob in the world must be untouched by this, entity SHAPE included: the
    // golden parity trace samples entity fields, and a mob that gained a row of nulls
    // would churn it for no behavior change at all.
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    for (let i = 0; i < 200; i++) sim.tick();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.templateId === BALGATH) continue;
      expect(e.warpathPhase, e.templateId).toBeUndefined();
      expect(e.warpathDestination, e.templateId).toBeUndefined();
    }
  });

  it('leaves a mob that never walked one exactly as it found it', () => {
    const before = { id: 1 } as unknown as Entity;
    resetWarpath(before);
    expect(before.warpathPhase).toBeUndefined();
    expect(before.warpathTimer).toBeUndefined();
    expect(before.warpathBlastAt).toBeUndefined();
  });

  it('drops the circuit for a mob that DID walk one, so the next pull opens on focus', () => {
    const mob = { id: 1, warpathPhase: 'travel', warpathDestination: 2 } as unknown as Entity;
    resetWarpath(mob);
    expect(mob.warpathPhase).toBeUndefined();
    expect(mob.warpathDestination).toBeUndefined();
  });
});

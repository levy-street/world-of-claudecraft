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
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { mobCombatProfile } from '../src/sim/mob/combat_profile';
import {
  nextWarpathDestination,
  nextWarpathPhase,
  resetWarpath,
  WARPATH_WRECK_FUSE_SEC,
  warpathPhaseDuration,
} from '../src/sim/mob/warpath';
import { Sim } from '../src/sim/sim';
import type { Entity, MobTemplate, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const BALGATH = 'balgath_cyclops';

/** Where the live scheduler spawns him: the Starfall Crater's rim (world_boss.ts). */
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

  it('visits every authored stop, which a furthest-first pick would not', () => {
    // The reason this is a circuit: with four landmarks, "always run to the furthest"
    // ping-pongs between the two extremes forever and the town in the middle is never
    // visited at all, so the headline promise of the encounter silently never happens.
    const n = def().destinations.length;
    const seen = new Set<number>();
    let at = -1;
    for (let i = 0; i < n; i++) {
      at = nextWarpathDestination(at, n);
      seen.add(at);
    }
    expect(seen.size).toBe(n);
  });

  it('opens on the chapel and keeps the town on the circuit', () => {
    // He wakes on the Starfall Crater's rim at the zone's east edge, and every straight
    // line from there to Fenbridge runs through the Widow Thicket spider camps, so the
    // pull opens with the long march to the chapel instead. The town is still a stop: the
    // headline promise of the encounter is that he comes for the gate every lap.
    expect(def().destinations[0].label).toContain('Chapel');
    expect(def().destinations.some((d) => d.label.includes('Fenbridge'))).toBe(true);
  });

  it('opens with a march long enough to be an event, inside his own patience', () => {
    // The first leg is the advertisement: the zone watches him cross the fen. It must be
    // the longest leg he walks, and it must still fit the travel timeout with room, or a
    // slow (a root, a stall) on the opening leg would have him give up on the chapel and
    // wreck a patch of empty marsh instead.
    const spawn = lair();
    const first = def().destinations[0];
    const opening = Math.hypot(first.x - spawn.x, first.z - spawn.z);
    expect(opening).toBeGreaterThan(120);
    const travelSpeed = (MOBS[BALGATH]?.moveSpeed ?? 0) * def().travelSpeedMult;
    expect(opening / travelSpeed).toBeLessThan(def().travelTimeoutSeconds * 0.75);
  });

  it('keeps the opening march clear of every spider camp', () => {
    // The reason the chapel is first. A raid dragged through seven spiders on the way to
    // the fight is not a chase for the level eights in it.
    const spawn = lair();
    const first = def().destinations[0];
    for (const camp of BUILTIN_WORLD.camps) {
      if (!camp.mobId.startsWith('mire_widow')) continue;
      // Distance from the camp centre to the segment spawn -> first stop.
      const dx = first.x - spawn.x;
      const dz = first.z - spawn.z;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((camp.center.x - spawn.x) * dx + (camp.center.z - spawn.z) * dz) / (dx * dx + dz * dz),
        ),
      );
      const cx = spawn.x + dx * t;
      const cz = spawn.z + dz * t;
      expect(
        Math.hypot(camp.center.x - cx, camp.center.z - cz),
        `the opening leg runs through the ${camp.mobId} camp at ${camp.center.x},${camp.center.z}`,
      ).toBeGreaterThan(camp.radius);
    }
  });

  it('never runs a leg through the water', () => {
    // The placement rule every authored coordinate in this repo carries, in the form this
    // particular fixture needs it. He walks the STRAIGHT LINE between stops, and although
    // he now wades (MobTemplate.wadeDepth) the raid chasing him does not: a leg that clips
    // the Mirefen lake turns the chase into a swim for everyone but him, and melee cannot
    // follow at all. The first cut of this circuit did exactly that, and it took an
    // in-engine capture to notice, because nothing in the sim or the content tables says a
    // straight line between two dry points is itself dry.
    const stops = def().destinations;
    // The opening leg starts from his SPAWN (the crater rim), which is not on the circuit.
    const spawn = lair();
    const legs = stops.map((a, i) => [a, stops[(i + 1) % stops.length]] as const);
    for (const [a, b] of [[spawn, stops[0]] as const, ...legs]) {
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 2);
      for (let i = 0; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const z = a.z + ((b.z - a.z) * i) / steps;
        const ground = groundHeight(x, z, WORLD_SEED);
        const water = waterLevelAt(x, z, WORLD_SEED);
        expect(
          ground,
          `the leg to ${(b as { label?: string }).label ?? 'the first stop'} is underwater at ${Math.round(x)},${Math.round(z)}`,
        ).toBeGreaterThanOrEqual(water);
      }
    }
  });

  it('keeps the arrival slam off the town itself', () => {
    // He is MEANT to hit the gate: that is the headline of the encounter. He is not meant
    // to sweep the vendors and the level-8 questers behind it with a level-20 raid
    // mechanic. Fenbridge fills a 34-unit hub at z 300 and its northernmost building sits
    // at 325.5, so the blast edge has to stop north of that.
    const town = def().destinations.find((d) => d.label.includes('Fenbridge'));
    expect(town, 'the town is no longer on his circuit').toBeDefined();
    const blastEdge = (town?.z ?? 0) - def().wreck.radius;
    expect(blastEdge, 'the arrival slam reaches into Fenbridge itself').toBeGreaterThan(325.5);
  });

  it('authors legs long enough to be a chase', () => {
    // A three-second trip is not a chase. Every consecutive leg has to be far enough that
    // the raid must commit to following, and that the regen window has time to bite.
    const stops = def().destinations;
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i];
      const b = stops[(i + 1) % stops.length];
      const leg = Math.hypot(a.x - b.x, a.z - b.z);
      expect(leg, `${a.label} to ${b.label} is barely a step`).toBeGreaterThan(40);
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

  /** Run until `done`, keeping the player glued to the boss the way a raid would. */
  const chase = (seconds: number, done?: () => boolean): number => {
    for (let i = 0; i < 20 * seconds; i++) {
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
    // He got there himself: the first stop is the chapel, 175 yards from the crater, and
    // he stops within arriveRadius of it, so anything near that gap is a real journey
    // rather than the shuffle he used to do.
    expect(Math.hypot(boss.pos.x - boss.spawnPos.x, boss.pos.z - boss.spawnPos.z)).toBeGreaterThan(
      30,
    );
  });

  it('is never yanked home mid-circuit by the leash', () => {
    // The soft leash measures 45 yards from the SPAWN, so a leashed warpather evades on
    // the way to his second landmark and heals to full. The two cannot both be true, and
    // this is the pin that says which one won.
    // Run to the THIRD landmark specifically, so the pin covers a full lap's worth of
    // legs rather than the one opening march, and the arrival slam at the end of it.
    let evaded = false;
    let peak = 0;
    chase(220, () => {
      if (boss.aiState === 'evade') evaded = true;
      peak = Math.max(peak, Math.hypot(boss.pos.x - boss.spawnPos.x, boss.pos.z - boss.spawnPos.z));
      return evaded || (boss.warpathDestination === 2 && boss.warpathPhase === 'wreck');
    });
    expect(evaded, 'the leash pulled him off his own circuit').toBe(false);
    expect(boss.aggroTargetId, 'he dropped the pull instead of finishing the leg').not.toBeNull();
    expect(peak, 'he never crossed the leash radius, so this proved nothing').toBeGreaterThan(45);
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
    chase(6, () => false);
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
    for (let i = 0; i < 20 * 90 && novaAt === null; i++) {
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

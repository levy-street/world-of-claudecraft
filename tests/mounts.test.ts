import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import {
  mountTierForBalance, mountUnlockedAtTier, isFlyingMount, MOUNT_LIST, MOUNTS,
  MOUNT_SPEED_NORMAL, MOUNT_SPEED_EPIC, FIRST_FLYING_TIER,
  MOUNT_FLIGHT_SPEED_MIN, MOUNT_FLIGHT_SPEED_MAX,
} from '../src/sim/content/mounts';

// The mount summon cast is 1.5s = 30 ticks at 20 Hz; 40 ticks clears it.
const CAST_TICKS = 40;

// Build a level-capped warrior parked on open ground away from any camp so a
// wandering mob can't aggro mid-cast and cancel the summon.
function makeRider() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
  const p = sim.player;
  p.pos.x = 40; p.pos.z = 40;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  return { sim, p };
}

function summonAndComplete(sim: Sim, id: string): void {
  expect(sim.summonMount(id)).toBe(true);
  for (let i = 0; i < CAST_TICKS; i++) sim.tick();
}

describe('mount tier ladder', () => {
  it('maps $WOC balance to the 11-rung ladder (0.1%, then 1%–10%)', () => {
    expect(mountTierForBalance(null)).toBe(0);
    expect(mountTierForBalance(0)).toBe(0);
    expect(mountTierForBalance(999_999)).toBe(0);     // below the 0.1% line
    expect(mountTierForBalance(1_000_000)).toBe(1);   // exactly 0.1%
    expect(mountTierForBalance(9_999_999)).toBe(1);
    expect(mountTierForBalance(10_000_000)).toBe(2);  // 1%
    expect(mountTierForBalance(50_000_000)).toBe(6);  // 5%
    expect(mountTierForBalance(99_999_999)).toBe(10); // just under 10%
    expect(mountTierForBalance(100_000_000)).toBe(11); // 10%
    expect(mountTierForBalance(250_000_000)).toBe(11); // capped at the top rung
  });

  it('has 11 rungs: 0.1%-4% ground (normal/epic), 5%-10% flying with scaled speed', () => {
    expect(MOUNT_LIST.length).toBe(11);
    for (let i = 0; i < MOUNT_LIST.length; i++) {
      expect(MOUNT_LIST[i].tier).toBe(i + 1);
      if (i > 0) expect(MOUNT_LIST[i].threshold).toBeGreaterThan(MOUNT_LIST[i - 1].threshold);
    }
    // Ground band: 0.1% rides the normal mount, 1%-4% the epic; none fly.
    expect(MOUNT_LIST[0].speedMult).toBe(MOUNT_SPEED_NORMAL);
    for (let i = 1; i < FIRST_FLYING_TIER - 1; i++) {
      expect(MOUNT_LIST[i].speedMult).toBe(MOUNT_SPEED_EPIC);
      expect(MOUNT_LIST[i].flying).toBe(false);
    }
    // Flight band (tiers 6-11): all fly, speed ramps min→max, monotonic, top = 2.5.
    const flyers = MOUNT_LIST.filter((m) => m.flying);
    expect(flyers.map((m) => m.tier)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(flyers[0].speedMult).toBe(MOUNT_FLIGHT_SPEED_MIN);
    expect(flyers[flyers.length - 1].speedMult).toBe(MOUNT_FLIGHT_SPEED_MAX);
    for (let i = 1; i < flyers.length; i++) {
      expect(flyers[i].speedMult).toBeGreaterThan(flyers[i - 1].speedMult);
    }
    expect(isFlyingMount('goldcrest')).toBe(true);   // 5%
    expect(isFlyingMount('stormhoof')).toBe(false);  // 4%
    expect(isFlyingMount('sovereign')).toBe(true);   // 10%
    expect(isFlyingMount('not-a-mount')).toBe(false);
  });

  it('gates ids against an eligibility tier', () => {
    expect(mountUnlockedAtTier('ashmane', 0)).toBe(false);
    expect(mountUnlockedAtTier('ashmane', 1)).toBe(true);
    expect(mountUnlockedAtTier('emberhoof', 1)).toBe(false);
    expect(mountUnlockedAtTier('emberhoof', 2)).toBe(true);
    expect(mountUnlockedAtTier('sovereign', 11)).toBe(true);
    expect(mountUnlockedAtTier('not-a-mount', 11)).toBe(false);
  });
});

describe('summon eligibility gating (server-authoritative in the Sim)', () => {
  it('rejects a mount above the rider\'s holdings, an unknown id, and ineligibility', () => {
    const { sim, p } = makeRider();
    p.mountTier = 0;
    expect(sim.summonMount('ashmane')).toBe(false);
    expect(sim.mountCast).toBeNull();

    p.mountTier = 1;
    expect(sim.summonMount('emberhoof')).toBe(false); // rung 2, not held
    expect(sim.summonMount('not-a-mount')).toBe(false);
    expect(sim.summonMount('ashmane')).toBe(true);    // rung 1, held
    expect(sim.mountCast?.id).toBe('ashmane');
  });

  it('completes the summon after the cast and sets the active steed', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'sovereign');
    expect(p.mountId).toBe('sovereign');
    expect(sim.mountCast).toBeNull();
    expect(p.inCombat).toBe(false);
  });
});

describe('mount move-speed (the gameplay perk)', () => {
  it('applies the classic ground-mount multiplier only while mounted and out of combat', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    const mult = (e: typeof p) => (sim as unknown as { moveSpeedMult(x: typeof p): number }).moveSpeedMult(e);

    expect(mult(p)).toBeCloseTo(1.0); // unmounted

    summonAndComplete(sim, 'emberhoof'); // epic
    expect(p.mountId).toBe('emberhoof');
    expect(mult(p)).toBeCloseTo(MOUNT_SPEED_EPIC);

    // Already in the saddle: swapping to another steed is instant (no re-cast).
    expect(sim.summonMount('ashmane')).toBe(true);
    expect(sim.mountCast).toBeNull();
    expect(p.mountId).toBe('ashmane');
    expect(mult(p)).toBeCloseTo(MOUNT_SPEED_NORMAL);

    // Combat suppresses the boost even before the dismount lands.
    p.inCombat = true;
    expect(mult(p)).toBeCloseTo(1.0);
    p.inCombat = false;
  });
});

describe('dismount triggers', () => {
  it('throws the rider on entering combat (ground mounts; flyers are immune — see below)', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'emberhoof'); // a GROUND mount — combat dismounts it
    expect(p.mountId).toBe('emberhoof');
    (sim as unknown as { enterCombat(a: typeof p, b: typeof p): void }).enterCombat(p, p);
    expect(p.mountId).toBeUndefined();
  });

  it('throws the rider on sourceless damage (falling), off the combat path', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'sovereign');
    expect(p.mountId).toBe('sovereign');
    // Falling damage is dealt with a null source, so it never hits enterCombat.
    (sim as unknown as { dealDamage(s: null, t: typeof p, a: number, c: boolean, sc: string, ab: string, k: string, nr: boolean): void })
      .dealDamage(null, p, 5, false, 'physical', 'Falling', 'hit', true);
    expect(p.mountId).toBeUndefined();
  });

  it('cancels an in-progress summon when the rider moves', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    expect(sim.summonMount('sovereign')).toBe(true);
    expect(sim.mountCast).not.toBeNull();
    sim.moveInput.forward = true; // translational input cancels the cast
    sim.tick();
    expect(sim.mountCast).toBeNull();
    expect(p.mountId).toBeUndefined();
    sim.moveInput.forward = false;
  });

  it('dismisses on demand', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'sovereign');
    expect(p.mountId).toBe('sovereign');
    sim.dismissMount();
    expect(p.mountId).toBeUndefined();
  });
});

describe('dynamic eligibility (sell-below-threshold)', () => {
  it('gracefully downgrades to the lesser mount on a holdings drop; dismounts only at tier 0', () => {
    const { sim, p } = makeRider();
    p.mountTier = 5;
    summonAndComplete(sim, 'stormhoof'); // rung 5 (ground)
    expect(p.mountId).toBe('stormhoof');

    p.mountTier = 2; // sold down below rung 5
    sim.enforceMountEligibility(sim.playerId);
    expect(p.mountId).toBe('emberhoof'); // downgraded to the best rung still held (tier 2)

    // A rung the rider still covers is left untouched.
    p.mountTier = 4;
    sim.enforceMountEligibility(sim.playerId);
    expect(p.mountId).toBe('emberhoof'); // tier 2 ≤ 4, no change

    p.mountTier = 0; // holdings gone entirely
    sim.enforceMountEligibility(sim.playerId);
    expect(p.mountId).toBeUndefined();
  });
});

describe('flight combat-immunity (airborne flyers are non-combatants vs wild mobs)', () => {
  it('a flyer cannot be put into combat (enterCombat is a no-op), so it is never dismounted', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'sovereign'); // a flyer
    expect(p.mountId).toBe('sovereign');
    expect(p.inCombat).toBe(false);
    // Force a combat attempt against the airborne rider.
    (sim as unknown as { enterCombat(a: typeof p, b: typeof p): void }).enterCombat(p, p);
    expect(p.inCombat).toBe(false); // still no combat
    expect(p.mountId).toBe('sovereign'); // still mounted
  });

  it('wild-mob damage does not land on (or dismount) an airborne flyer', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'goldcrest'); // a flyer
    const hp0 = p.hp;
    const wild = { kind: 'mob', ownerId: null } as unknown as typeof p;
    (sim as unknown as { dealDamage(s: typeof p, t: typeof p, a: number, c: boolean, sc: string, ab: string, k: string): void })
      .dealDamage(wild, p, 50, false, 'physical', 'Cleave', 'hit');
    expect(p.hp).toBe(hp0);          // immune to wild-mob damage
    expect(p.mountId).toBe('goldcrest'); // not thrown off
  });

  it('a grounded mount is NOT immune — combat still dismounts it', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    summonAndComplete(sim, 'emberhoof'); // a GROUND mount (tier 2)
    expect(p.mountId).toBe('emberhoof');
    (sim as unknown as { enterCombat(a: typeof p, b: typeof p): void }).enterCombat(p, p);
    expect(p.mountId).toBeUndefined(); // ground mounts still get thrown on combat
  });
});

describe('flight (5%+ steeds soar)', () => {
  // Pacify the roster so flying near a camp can't aggro → combat → dismount.
  const pacify = (sim: Sim) => {
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.targetId = null; e.aiState = 'idle'; }
    }
  };

  it('lifts the rider off the ground and soars horizontally without touching down', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    const groundY = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    summonAndComplete(sim, 'goldcrest'); // tier 6 — the first flying rung (5%)
    expect(p.mountId).toBe('goldcrest');
    for (let i = 0; i < 20; i++) sim.tick(); // rise onto the hover
    expect(p.pos.y).toBeGreaterThan(groundY + 1.5);
    expect(p.onGround).toBe(false);

    const x0 = p.pos.x, z0 = p.pos.z;
    sim.moveInput.forward = true;
    for (let i = 0; i < 20; i++) sim.tick();
    sim.moveInput.forward = false;
    expect(Math.hypot(p.pos.x - x0, p.pos.z - z0)).toBeGreaterThan(5);
    expect(p.mountId).toBe('goldcrest'); // never dismounted mid-flight
  });

  it('climbs while jump is held and settles back toward the hover on release', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    summonAndComplete(sim, 'sovereign'); // the 10% dreadwyrm
    for (let i = 0; i < 12; i++) sim.tick();
    const hoverY = p.pos.y;
    sim.moveInput.jump = true;
    for (let i = 0; i < 30; i++) sim.tick();
    sim.moveInput.jump = false;
    expect(p.pos.y).toBeGreaterThan(hoverY + 3); // gained real altitude

    for (let i = 0; i < 80; i++) sim.tick(); // drift back down
    sim.moveInput.jump = false;
    expect(p.pos.y).toBeLessThan(hoverY + 1);
  });

  it('restores gravity when dismounted in the air (the rider falls)', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    summonAndComplete(sim, 'sovereign');
    sim.moveInput.jump = true;
    for (let i = 0; i < 25; i++) sim.tick(); // climb up
    sim.moveInput.jump = false;
    const airY = p.pos.y;
    sim.dismissMount();
    expect(p.mountId).toBeUndefined();
    for (let i = 0; i < 10; i++) sim.tick();
    expect(p.pos.y).toBeLessThan(airY); // gravity took over — falling
  });
});

describe('flight (5%+ steeds soar)', () => {
  // Pacify the roster so flying near a camp can't aggro → combat → dismount.
  const pacify = (sim: Sim) => {
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.targetId = null; e.aiState = 'idle'; }
    }
  };

  it('lifts the rider off the ground and soars horizontally without touching down', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    const groundY = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    summonAndComplete(sim, 'goldcrest'); // tier 6 — the first flying rung (5%)
    expect(p.mountId).toBe('goldcrest');
    for (let i = 0; i < 20; i++) sim.tick(); // rise onto the hover
    expect(p.pos.y).toBeGreaterThan(groundY + 1.5);
    expect(p.onGround).toBe(false);

    const x0 = p.pos.x, z0 = p.pos.z;
    sim.moveInput.forward = true;
    for (let i = 0; i < 20; i++) sim.tick();
    sim.moveInput.forward = false;
    expect(Math.hypot(p.pos.x - x0, p.pos.z - z0)).toBeGreaterThan(5);
    expect(p.mountId).toBe('goldcrest'); // never dismounted mid-flight
  });

  it('climbs while jump is held and settles back toward the hover on release', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    summonAndComplete(sim, 'sovereign'); // the 10% dreadwyrm
    for (let i = 0; i < 12; i++) sim.tick();
    const hoverY = p.pos.y;
    sim.moveInput.jump = true;
    for (let i = 0; i < 30; i++) sim.tick();
    sim.moveInput.jump = false;
    expect(p.pos.y).toBeGreaterThan(hoverY + 3); // gained real altitude

    for (let i = 0; i < 80; i++) sim.tick(); // drift back down
    sim.moveInput.jump = false;
    expect(p.pos.y).toBeLessThan(hoverY + 1);
  });

  it('restores gravity when dismounted in the air (the rider falls)', () => {
    const { sim, p } = makeRider();
    p.mountTier = 11;
    pacify(sim);
    summonAndComplete(sim, 'sovereign');
    sim.moveInput.jump = true;
    for (let i = 0; i < 25; i++) sim.tick(); // climb up
    sim.moveInput.jump = false;
    const airY = p.pos.y;
    sim.dismissMount();
    expect(p.mountId).toBeUndefined();
    for (let i = 0; i < 10; i++) sim.tick();
    expect(p.pos.y).toBeLessThan(airY); // gravity took over — falling
  });
});

describe('determinism', () => {
  it('produces the same mounted state from the same inputs', () => {
    const run = () => {
      const { sim, p } = makeRider();
      p.mountTier = 11;
      summonAndComplete(sim, MOUNTS.celestial.id);
      return { id: p.mountId, x: p.pos.x, z: p.pos.z };
    };
    expect(run()).toEqual(run());
  });
});

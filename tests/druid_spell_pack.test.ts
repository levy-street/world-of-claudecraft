import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import { type AuraKind, dist2d } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';

const NEW_DRUID = [
  'travel_form',
  'enrage',
  'bash',
  'faerie_fire',
  'hibernate',
  'dash',
  'pounce',
  'insect_swarm',
  'tigers_fury',
  'rip',
] as const;

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function placeOnGround(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  e.fallStartY = e.pos.y;
  e.onGround = true;
}

function advanceTicks(sim: Sim, ticks: number) {
  for (let i = 0; i < ticks; i++) sim.tick();
}

function castTravelForm(sim: Sim, pid: number) {
  const e = sim.entities.get(pid)!;
  sim.setPlayerLevel(20, pid);
  e.resource = e.maxResource;
  sim.castAbility('travel_form', pid);
  sim.tick();
}

function horizontalTravel(sim: Sim, pid: number, ticks: number): number {
  const e = sim.entities.get(pid)!;
  const start = { ...e.pos };
  advanceTicks(sim, ticks);
  return dist2d(start, e.pos);
}

function findDeepWater(seed: number): { x: number; z: number } {
  for (let z = -50; z <= 950; z += 5) {
    for (let x = -170; x <= 170; x += 5) {
      if (groundHeight(x, z, seed) < WATER_LEVEL - 1.25) return { x, z };
    }
  }
  throw new Error('test fixture needs a deep-water coordinate');
}

// Push a shapeshift toggle aura directly (forms use the 3600s sentinel).
function giveForm(sim: Sim, pid: number, kind: AuraKind, name: string) {
  const e = sim.entities.get(pid)!;
  e.auras.push({
    id: name.toLowerCase().replace(/\s+/g, '_'),
    name,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: pid,
    school: 'physical',
  });
}

describe('druid spell pack — definitions', () => {
  it('registers all 10 abilities as druid spells with effects', () => {
    for (const id of NEW_DRUID) {
      const def = ABILITIES[id];
      expect(def, `${id} missing from ABILITIES`).toBeTruthy();
      expect(def.class).toBe('druid');
      expect(def.effects.length).toBeGreaterThan(0);
      expect(CLASSES.druid.abilities, `${id} not in druid kit`).toContain(id);
    }
  });

  it('uses the documented form / combo gates', () => {
    expect(ABILITIES.enrage.requiresForm).toBe('bear');
    expect(ABILITIES.bash.requiresForm).toBe('bear');
    expect(ABILITIES.tigers_fury.requiresForm).toBe('cat');
    expect(ABILITIES.dash.requiresForm).toBe('cat');
    expect(ABILITIES.pounce.requiresStealth).toBe(true);
    expect(ABILITIES.pounce.awardsCombo).toBe(1);
    expect(ABILITIES.rip.spendsCombo).toBe(true);
    expect(ABILITIES.travel_form.requiresOutOfCombat).toBeFalsy();
    expect(ABILITIES.travel_form.castTime).toBe(0);
  });
});

describe('druid spell pack — level gating', () => {
  it('gates each pack spell at its learn level and teaches everything by 20', () => {
    // The choice-row unlock guard moved travel_form (11), bash (8), and rip (14)
    // earlier so the rows that modify them are live at unlock; the rest of the
    // pack still lands 16 to 20.
    const known15 = abilitiesKnownAt('druid', 15).map((k) => k.def.id);
    const stillLate = NEW_DRUID.filter((id) => !['travel_form', 'bash', 'rip'].includes(id));
    for (const id of stillLate) expect(known15).not.toContain(id);
    for (const id of NEW_DRUID) {
      const before = abilitiesKnownAt('druid', ABILITIES[id].learnLevel - 1).map((k) => k.def.id);
      expect(before, `${id} known too early`).not.toContain(id);
    }

    const known20 = abilitiesKnownAt('druid', 20).map((k) => k.def.id);
    for (const id of NEW_DRUID) expect(known20).toContain(id);
  });

  it('teaches Enrage exactly at level 16', () => {
    expect(abilitiesKnownAt('druid', 15).map((k) => k.def.id)).not.toContain('enrage');
    expect(abilitiesKnownAt('druid', 16).map((k) => k.def.id)).toContain('enrage');
  });
});

describe('druid spell pack — casting applies effects', () => {
  it("Tiger's Fury grants attack power in cat form", () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Cat');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    e.resource = 100;
    sim.castAbility('tigers_fury', a);
    sim.tick();
    const buff = e.auras.find((au) => au.kind === 'buff_ap' && au.value === 40);
    expect(buff, 'tigers_fury should apply a +40 buff_ap aura').toBeTruthy();
  });

  it('Enrage generates rage in bear form', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Bear');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    giveForm(sim, a, 'form_bear', 'Bear Form');
    e.resource = 0;
    sim.castAbility('enrage', a);
    sim.tick();
    expect(e.resource).toBeGreaterThan(0);
  });

  it('Travel Form shapeshifts and grants +40% movement speed out of combat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Walker');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    e.resource = 100;
    sim.castAbility('travel_form', a);
    sim.tick();
    const form = e.auras.find((au) => au.kind === 'form_travel');
    expect(form, 'travel_form should apply a form_travel aura').toBeTruthy();
    expect(form!.value).toBeCloseTo(1.4);
    expect((sim as any).moveSpeedMult(e)).toBeCloseTo(1.4);
  });

  // Regression guard for the player-facing path: moveSpeedMult alone passing is not
  // enough (the historical Dash/Travel bug had a correct-looking aura that the
  // movement step floored to a no-op). Drive real input and measure ground covered.
  it('Travel Form actually moves the druid faster (integration)', () => {
    const distanceOver = (withForm: boolean): number => {
      const sim = makeWorld();
      const a = sim.addPlayer('druid', 'Strider');
      const e = sim.entities.get(a)!;
      sim.setPlayerLevel(20, a);
      e.resource = 100;
      if (withForm) {
        sim.castAbility('travel_form', a);
        sim.tick();
      }
      const meta = (sim as any).players.get(a);
      meta.moveInput = {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
      const start = { x: e.pos.x, z: e.pos.z };
      for (let i = 0; i < 60; i++) sim.tick();
      return Math.hypot(e.pos.x - start.x, e.pos.z - start.z);
    };
    const base = distanceOver(false);
    const travel = distanceOver(true);
    expect(base).toBeGreaterThan(0);
    // +40% speed: should cover about 1.4x the ground (allow slack for terrain).
    expect(travel / base).toBeCloseTo(1.4, 1);
  });

  it('Prowl actually moves the druid at half speed in Wolf Form', () => {
    const distanceOver = (withProwl: boolean): number => {
      const sim = makeWorld();
      const pid = sim.addPlayer('druid', withProwl ? 'Prowler' : 'Runner');
      const e = sim.entities.get(pid)!;
      sim.setPlayerLevel(20, pid);
      e.resource = e.maxResource;
      sim.castAbility('cat_form', pid);
      sim.tick();
      advanceTicks(sim, 40);
      if (withProwl) {
        e.resource = e.maxResource;
        sim.castAbility('prowl', pid);
        sim.tick();
        expect(e.auras.some((a) => a.id === 'prowl' && a.kind === 'stealth')).toBe(true);
      }
      const meta = (sim as any).players.get(pid);
      meta.moveInput = {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
      const start = { x: e.pos.x, z: e.pos.z };
      for (let i = 0; i < 60; i++) sim.tick();
      return Math.hypot(e.pos.x - start.x, e.pos.z - start.z);
    };

    const base = distanceOver(false);
    const prowl = distanceOver(true);
    expect(base).toBeGreaterThan(0);
    expect(prowl / base).toBeCloseTo(0.5, 1);
  });

  it('Travel Form toggles off cleanly, removing the form and the speed', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Walker');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    e.resource = 100;
    sim.castAbility('travel_form', a);
    sim.tick();
    expect(e.auras.some((au) => au.kind === 'form_travel')).toBe(true);
    for (let i = 0; i < 40; i++) sim.tick(); // wait out the GCD (forms are on-GCD)
    sim.castAbility('travel_form', a); // recast = shift out
    sim.tick();
    expect(e.auras.some((au) => au.kind === 'form_travel')).toBe(false);
    expect((sim as any).moveSpeedMult(e)).toBeCloseTo(1);
  });

  it('Travel Form can be cast in combat (escape tool)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Runner');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    e.resource = 100;
    e.inCombat = true; // mid-fight
    sim.castAbility('travel_form', a);
    sim.tick();
    expect(
      e.auras.some((au) => au.kind === 'form_travel'),
      'travel_form should shift even in combat',
    ).toBe(true);
  });

  it('Travel Form moves the druid 40% faster than normal forward movement', () => {
    const baseline = makeWorld();
    const walking = baseline.addPlayer('druid', 'Walker');
    placeOnGround(baseline, walking, 0, 40);
    baseline.players.get(walking)!.moveInput.forward = true;

    const travel = makeWorld();
    const runner = travel.addPlayer('druid', 'Runner');
    placeOnGround(travel, runner, 0, 40);
    castTravelForm(travel, runner);
    travel.players.get(runner)!.moveInput.forward = true;

    const ticks = 40;
    const walkingDistance = horizontalTravel(baseline, walking, ticks);
    const travelDistance = horizontalTravel(travel, runner, ticks);

    expect(walkingDistance).toBeGreaterThan(0);
    expect(travelDistance / walkingDistance).toBeCloseTo(1.4, 2);
  });

  it('Travel Form speed applies while following another player', () => {
    const normal = makeWorld();
    const normalLeader = normal.addPlayer('warrior', 'Leader');
    const normalFollower = normal.addPlayer('druid', 'Follower');
    placeOnGround(normal, normalLeader, 0, 90);
    placeOnGround(normal, normalFollower, 0, 40);
    normal.chat('/follow Leader', normalFollower);
    normal.tick();

    const travel = makeWorld();
    const travelLeader = travel.addPlayer('warrior', 'Leader');
    const travelFollower = travel.addPlayer('druid', 'Follower');
    placeOnGround(travel, travelLeader, 0, 90);
    placeOnGround(travel, travelFollower, 0, 40);
    castTravelForm(travel, travelFollower);
    travel.chat('/follow Leader', travelFollower);
    travel.tick();

    const ticks = 10;
    const normalDistance = horizontalTravel(normal, normalFollower, ticks);
    const travelDistance = horizontalTravel(travel, travelFollower, ticks);

    expect(normalDistance).toBeGreaterThan(0);
    expect(travelDistance / normalDistance).toBeCloseTo(1.4, 2);
  });

  it('Travel Form still gets the swim penalty in deep water', () => {
    const walking = makeWorld();
    const walker = walking.addPlayer('druid', 'Walker');
    const water = findDeepWater(walking.cfg.seed);
    placeOnGround(walking, walker, water.x, water.z);
    const walkerEntity = walking.entities.get(walker)!;
    walkerEntity.pos.y = WATER_LEVEL - 0.75;
    walkerEntity.onGround = false;
    walking.players.get(walker)!.moveInput.forward = true;

    const travel = makeWorld();
    const runner = travel.addPlayer('druid', 'Runner');
    placeOnGround(travel, runner, water.x, water.z);
    const runnerEntity = travel.entities.get(runner)!;
    runnerEntity.pos.y = WATER_LEVEL - 0.75;
    runnerEntity.onGround = false;
    castTravelForm(travel, runner);
    runnerEntity.pos.y = WATER_LEVEL - 0.75;
    runnerEntity.onGround = false;
    travel.players.get(runner)!.moveInput.forward = true;

    const ticks = 20;
    const dryBaseline = 7 * (ticks / 20);
    const swimmingDistance = horizontalTravel(walking, walker, ticks);
    const travelSwimmingDistance = horizontalTravel(travel, runner, ticks);

    expect(swimmingDistance / dryBaseline).toBeCloseTo(0.65, 2);
    expect(travelSwimmingDistance / dryBaseline).toBeCloseTo(0.91, 2);
    expect(travelSwimmingDistance / swimmingDistance).toBeCloseTo(1.4, 2);
  });

  it('Travel Form cancels Prowl instead of inheriting the stealth speed penalty', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('druid', 'Prowler');
    const e = sim.entities.get(pid)!;
    sim.setPlayerLevel(20, pid);

    e.resource = e.maxResource;
    sim.castAbility('cat_form', pid);
    sim.tick();
    expect(e.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    advanceTicks(sim, 40);

    e.resource = e.maxResource;
    sim.castAbility('prowl', pid);
    sim.tick();
    expect(e.auras.some((a) => a.id === 'prowl' && a.kind === 'stealth')).toBe(true);
    expect((sim as any).moveSpeedMult(e)).toBeCloseTo(0.5);
    advanceTicks(sim, 40);

    e.resource = e.maxResource;
    sim.castAbility('travel_form', pid);
    sim.tick();

    expect(e.auras.some((a) => a.kind === 'form_travel')).toBe(true);
    expect(e.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect((sim as any).moveSpeedMult(e)).toBeCloseTo(1.4);
  });

  it('Dash grants +50% movement speed in cat form', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Dasher');
    const e = sim.entities.get(a)!;
    sim.setPlayerLevel(20, a);
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    e.resource = 100;
    sim.castAbility('dash', a);
    sim.tick();
    const buff = e.auras.find((au) => au.kind === 'buff_speed');
    expect(buff, 'dash should apply a buff_speed aura').toBeTruthy();
    expect(buff!.value).toBeCloseTo(1.5);
    expect((sim as any).moveSpeedMult(e)).toBeCloseTo(1.5);
  });
});

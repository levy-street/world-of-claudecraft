import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type PlayerMeta, type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// G5 (fix/talents2-balance-pass): fears no longer insta-break on any damage.
// The generic fear family (Morrowlash, Terror Canticle) carries breakChanceScale:
// each damage event breaks the fear with probability
// min(1, amount / (scale * maxHp)), so big hits reliably break it and dot
// ticks usually do not (the classic behavior that makes dot-then-fear a
// warlock rotation instead of an anti-combo). Plain incapacitates (Eye Jab,
// Wyvern Sting, Startle Shot) keep the classic break-on-any-damage rule, and G5
// left the warrior Lingering Dread soak threshold alone. (That soak has since
// moved 20% -> 10% of max health, anchored on FEAR_BREAK_CHANCE_SCALE so it now
// absorbs exactly one guaranteed-break hit; see src/sim/content/warrior_rows.ts.)
// Harrow and Dread Chorus instead carry a deterministic 8% cumulative budget,
// so automatic pet and DoT damage cannot roll an immediate break.

function addTarget(sim: Sim, distance: number, level = 20): Entity {
  const player = sim.player;
  const mob = createMob(20_000 + sim.entities.size, MOBS.forest_wolf, level, {
    x: player.pos.x + distance,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle'; // stay passive so cast-time spells finish without pushback
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
  return mob;
}

function fearAura(target: Entity): Aura | undefined {
  return target.auras.find((aura) => aura.kind === 'incapacitate');
}

function dealHit(sim: Sim, target: Entity, amount: number): void {
  (
    sim as unknown as {
      ctx: {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string | null,
          kind: string,
          aoe: boolean,
          threat: { flat: number; mult: number },
        ): void;
      };
    }
  ).ctx.dealDamage(sim.player, target, amount, false, 'physical', 'test hit', 'hit', false, {
    flat: 0,
    mult: 1,
  });
}

describe('G5: damage-scaled fear break', () => {
  it('a hit at or above scale * maxHp always breaks a chance-scaled fear', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    const mob = addTarget(sim, 3);
    mob.auras.push({
      id: 'test_fear',
      name: 'Test Fear',
      kind: 'incapacitate',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'shadow',
      breaksOnDamage: true,
      breakChanceScale: 0.1,
    } as Aura);
    dealHit(sim, mob, Math.ceil(mob.maxHp * 0.1)); // chance clamps to 1
    expect(fearAura(mob)).toBeUndefined();
  });

  it('a tiny hit usually leaves a chance-scaled fear standing (seeded draw)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    const mob = addTarget(sim, 3);
    mob.auras.push({
      id: 'test_fear',
      name: 'Test Fear',
      kind: 'incapacitate',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'shadow',
      breaksOnDamage: true,
      breakChanceScale: 0.1,
    } as Aura);
    dealHit(sim, mob, 1); // chance 1 / 10000 with the seeded rng: survives
    expect(fearAura(mob)).toBeDefined();
  });

  it('Harrow absorbs 8% max-health damage before breaking', () => {
    // Seed hunted (post-merge camp order) so the level-14-vs-20 Harrow cast
    // is not resisted: the fear must actually land for the aura assertions.
    // Re-hunted (1 -> 3) after the Eastbrook camp respacing thinned the zone-1
    // camp counts, then (3 -> 1) after the Galecrest quest camps (#2887)
    // added four world-gen draws, then (1 -> 4) when the release
    // private-scatter sync moved those late camps onto their own stream and
    // the branch hunt went stale; 4 is the release side's own recorded hunt
    // and holds on the merged stream (the Reliquary branch itself adds no
    // world-gen draws). Release spares on record: 6, 8.
    const sim = new Sim({ seed: 4, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(14);
    const mob = addTarget(sim, 3);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('fear');
    // 1.5s cast, then the fear rides a projectile (spellfx projectile) and
    // applies on arrival: give both legs room.
    for (let i = 0; i < 80; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Harrow fear aura').toBeDefined();
    expect(aura?.duration).toBe(8);
    expect(aura?.breaksOnDamage).toBe(true);
    expect(aura?.breakChanceScale).toBeUndefined();
    expect(aura?.breakThreshold).toBe(8_000);

    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    dealHit(sim, mob, 7_999);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(fearAura(mob)?.breakThreshold).toBe(1);
    dealHit(sim, mob, 1);
    expect(fearAura(mob)).toBeUndefined();
  });

  it('Dread Chorus gives every feared target the same 8% damage budget', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 8: 'wlk_r8_howl_of_terror' } })).toBe(true);
    const first = addTarget(sim, 3);
    const second = createMob(30_000, MOBS.forest_wolf, 20, {
      x: sim.player.pos.x - 3,
      y: sim.player.pos.y,
      z: sim.player.pos.z,
    });
    second.hostile = true;
    second.aiState = 'idle';
    second.maxHp = 50_000;
    second.hp = second.maxHp;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(second);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('howl_of_terror');

    expect(fearAura(first)?.duration).toBe(5);
    expect(fearAura(second)?.duration).toBe(5);
    expect(fearAura(first)?.breakThreshold).toBe(8_000);
    expect(fearAura(second)?.breakThreshold).toBe(4_000);
    expect(fearAura(first)?.breakChanceScale).toBeUndefined();
    expect(fearAura(second)?.breakChanceScale).toBeUndefined();

    dealHit(sim, first, 8_000);
    expect(fearAura(first)).toBeUndefined();
    expect(fearAura(second)?.breakThreshold).toBe(4_000);
  });

  it('states the 8% budget in both Warlock Fear descriptions', () => {
    expect(ABILITIES.fear.description).toBe(
      "Strikes terror into the enemy, leaving it cowering for up to 8 sec. Damage totaling 8% of the target's maximum health breaks the effect.",
    );
    expect(ABILITIES.howl_of_terror.description).toBe(
      "Frightens nearby enemies for up to 5 sec. Damage totaling 8% of a target's maximum health breaks its fear. (Warlock talent)",
    );
  });

  it('Terror Canticle (aoeFear) applies chance-scaled fears', () => {
    const sim = new Sim({ seed: 7, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 11: 'pri_r8_psychic_scream' } })).toBe(true);
    const mob = addTarget(sim, 3);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('psychic_scream');
    for (let i = 0; i < 6; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Terror Canticle fear aura').toBeDefined();
    expect(aura?.breakChanceScale).toBeCloseTo(0.1);
    expect(aura?.breakThreshold).toBeUndefined();
  });

  it('Morrowlash keeps the generic chance-scaled fear behavior', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    const mob = addTarget(sim, 3);
    const meta = (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(
      sim.player.id,
    );
    const def = ABILITIES.death_coil;
    const ability: ResolvedAbility = {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    if (!meta) throw new Error('Morrowlash test setup failed');

    runEffects(sim.ctx, sim.player, meta, mob, ability);

    const aura = fearAura(mob);
    expect(aura, 'Morrowlash fear aura').toBeDefined();
    expect(aura?.breakChanceScale).toBeCloseTo(0.1);
    expect(aura?.breakThreshold).toBeUndefined();
  });

  it('Eye Jab stays a classic incapacitate: any damage breaks it', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(10);
    const mob = addTarget(sim, 2);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('gouge');
    for (let i = 0; i < 6; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Eye Jab incapacitate aura').toBeDefined();
    expect(aura?.breakChanceScale).toBeUndefined();
    dealHit(sim, mob, 1);
    expect(fearAura(mob)).toBeUndefined();
  });
});

// The PvP fear ladder scales the ability's OWN duration. It used to be a table of
// absolute seconds returned WITHOUT reading the authored duration, so every fear
// lasted 8s on its first PvP application whatever its tooltip said: Psychic Scream
// (4s) doubled, and the then-authored Howl of Terror and Death Coil (3s) more than doubled. Five
// abilities across three classes ride this ladder, so an absolute table can only
// ever be correct for one of them.
describe('PvP fear diminishing returns scale the authored duration', () => {
  // Two hostile players is the arm under test; the resolver early-returns the raw
  // duration for anything else, which the PvE case below pins.
  function pvpRig() {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', noPlayer: true });
    const inner = sim as unknown as {
      addPlayer: (c: string, n: string) => number;
      entities: Map<number, Entity>;
      isHostileTo: (a: Entity, b: Entity) => boolean;
      diminishedCrowdControlDuration: (a: Entity, b: Entity, c: string, d: number) => number | null;
    };
    const a = inner.entities.get(inner.addPlayer('warrior', 'Caster'));
    const b = inner.entities.get(inner.addPlayer('warrior', 'Victim'));
    if (!a || !b) throw new Error('no players');
    inner.isHostileTo = () => true;
    const dr = (duration: number, category = 'fear') =>
      inner.diminishedCrowdControlDuration(a, b, category, duration);
    const reset = () => {
      b.ccDr = new Map();
    };
    return { dr, reset, a, b, inner };
  }

  it('gives each fear its own authored duration on the first application', () => {
    const { dr, reset } = pvpRig();
    // Warlock Harrow and the generic boundary are 8 sec, Dread Chorus is 5 sec,
    // warrior Intimidating Shout and priest Psychic Scream 4, and Death Coil 3.
    for (const authored of [8, 5, 4, 3]) {
      reset();
      expect(dr(authored), `authored ${authored}s`).toBe(authored);
    }
  });

  it('keeps the historical 8 -> 4 -> 2 -> 1 ladder for an 8 sec fear', () => {
    const { dr, reset } = pvpRig();
    reset();
    expect([dr(8), dr(8), dr(8), dr(8)]).toEqual([8, 4, 2, 1]);
  });

  it('steps a 4 sec fear down proportionally instead of holding it at 4', () => {
    // The absolute table would have returned 8 then 4 here, so a second fear
    // landed at FULL duration. The multiplier halves from the real value.
    const { dr, reset } = pvpRig();
    reset();
    expect([dr(4), dr(4), dr(4)]).toEqual([4, 2, 1]);
  });

  it('never reaches full immunity, unlike root and stun', () => {
    const { dr, reset } = pvpRig();
    reset();
    for (let i = 0; i < 6; i++) expect(dr(8)).not.toBeNull();
  });

  it('leaves PvE untouched: a mob target takes the raw authored duration', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    const mob = addTarget(sim, 2);
    const inner = sim as unknown as {
      diminishedCrowdControlDuration: (a: Entity, b: Entity, c: string, d: number) => number | null;
    };
    for (const authored of [8, 5, 4, 3]) {
      expect(inner.diminishedCrowdControlDuration(sim.player, mob, 'fear', authored)).toBe(
        authored,
      );
    }
  });

  it('leaves polymorph on its deliberate absolute ladder', () => {
    // Exactly one ability rides polymorph (mage polymorph, authored 15s), so its
    // 10s first rung reads as an intended PvP cap rather than the same defect.
    const { dr, reset } = pvpRig();
    reset();
    expect([dr(15, 'polymorph'), dr(15, 'polymorph'), dr(15, 'polymorph')]).toEqual([10, 5, 1]);
  });
});

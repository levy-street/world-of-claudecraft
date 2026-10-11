// Balgath's five trinkets (src/sim/combat/balgath_trinkets.ts, data in
// src/sim/content/trinkets.ts) against a real Sim: the Shape of the Foreman, the Muster
// Standard's walking guardians, the Guttered Eye's line beam, the Barrowstone Heart's
// statue and the Muster Grapnel's haul, plus the loot rows that pay them out.
import { describe, expect, it } from 'vitest';
import {
  GUTTERED_GLARE_DRIFT,
  glareLineHits,
  MUSTER_STANDARD_SOLDIERS,
} from '../src/sim/combat/balgath_trinkets';
import { wandAllowedInForm } from '../src/sim/combat/form_swing';
import { summonGuardian } from '../src/sim/combat/guardians';
import {
  BALGATH_TRINKET_ITEM_IDS,
  TRINKET_AURA,
  TRINKET_SPECS,
  trinketCooldownKey,
} from '../src/sim/content/trinkets';
import { DUNGEON_X_THRESHOLD, ITEMS, MOBS } from '../src/sim/data';
import { BALGATH_DEV_LOOT_ITEM_IDS } from '../src/sim/dev/balgath_dev_loot';
import { createMob, FOREMAN_SHAPE_SCALE } from '../src/sim/entity';
import { itemLevel, primaryStatSum } from '../src/sim/item_level';
import { applyKnockback } from '../src/sim/knockback';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, type PlayerClass, type SimEvent } from '../src/sim/types';
import { trinketTooltipLineTexts } from '../src/ui/trinket_tooltip_view';

type Use<K extends string> = Extract<(typeof TRINKET_SPECS)[string]['use'], { kind: K }>;

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function wearing(itemId: string, cls: PlayerClass = 'warrior', seed = 23) {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the 30 sec on-equip lockout: these tests exercise the trinket itself.
  sim.player.cooldowns.delete(trinketCooldownKey(itemId));
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
  return sim;
}

function foe(sim: Sim, dx: number, dz: number, hp = 50000): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x + dx,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  mob.hostile = true;
  mob.aiState = 'idle';
  // Pinned in place: these tests measure the trinkets, not the wolves' footwork.
  mob.moveSpeed = 0;
  sim.addEntity(mob);
  return mob;
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...sim.tick());
  return events;
}

const auraOf = (e: Entity, id: string) => e.auras.find((a) => a.id === id);

// ---- the catalog -------------------------------------------------------------------------

describe("Balgath's trinkets in the catalog", () => {
  it('are five epic trinkets at his item level, one attribute each on the ilvl-26 line', () => {
    expect([...BALGATH_TRINKET_ITEM_IDS]).toEqual([
      'knucklebone_of_balgath',
      'muster_standard',
      'guttered_eye',
      'barrowstone_heart',
      'muster_grapnel',
    ]);
    const attribute: Record<string, string> = {
      knucklebone_of_balgath: 'str',
      muster_standard: 'sta',
      guttered_eye: 'int',
      barrowstone_heart: 'sta',
      muster_grapnel: 'int',
    };
    for (const id of BALGATH_TRINKET_ITEM_IDS) {
      const item = ITEMS[id];
      expect(item.slot, id).toBe('trinket');
      expect(item.quality, id).toBe('epic');
      expect(item.soulbound, id).toBe(true);
      expect(Object.keys(item.stats ?? {}), id).toEqual([attribute[id]]);
      expect(itemLevel(item), id).toBe(26);
      expect(primaryStatSum(item), id).toBe(11);
    }
  });

  it('adds the Craterglass Stave on the ilvl-26 caster two-hander line', () => {
    const staff = ITEMS.craterglass_stave;
    expect(staff.quality).toBe('epic');
    expect((staff as { hand?: string }).hand).toBe('twohand');
    expect(itemLevel(staff)).toBe(26);
    // The Wildheart Hexwood Staff's exact shape at the same item level.
    expect(staff.weapon).toEqual(ITEMS.wildheart_hexwood_staff.weapon);
    expect((staff.stats?.int ?? 0) + (staff.stats?.spi ?? 0)).toBe(
      (ITEMS.wildheart_hexwood_staff.stats?.int ?? 0) +
        (ITEMS.wildheart_hexwood_staff.stats?.spi ?? 0),
    );
    // No free Spell Power affix: flat Spell Power is priced per tier (item_budget.ts).
    expect(staff.spellPower ?? 0).toBe(0);
  });

  it('/dev balgath loot hands out exactly the five and the staff', () => {
    expect([...BALGATH_DEV_LOOT_ITEM_IDS]).toEqual([
      ...BALGATH_TRINKET_ITEM_IDS,
      'craterglass_stave',
    ]);
    const sim = new Sim({ seed: 5, playerClass: 'mage', autoEquip: true, devCommands: true });
    sim.chat('/dev balgath loot');
    for (const id of BALGATH_DEV_LOOT_ITEM_IDS) expect(sim.countItem(id), id).toBe(1);
  });
});

// ---- Knucklebone of Balgath --------------------------------------------------------------

describe('Knucklebone of Balgath: the Shape of the Foreman', () => {
  it('takes the shape: form aura, the body a head taller, more armor, cooldown started', () => {
    const sim = wearing('knucklebone_of_balgath');
    const p = sim.player;
    const armorBefore = p.stats.armor;
    const scaleBefore = p.scale;
    sim.useItem('knucklebone_of_balgath');
    const shape = auraOf(p, TRINKET_AURA.foremanShape);
    const use = TRINKET_SPECS.knucklebone_of_balgath.use as Use<'foremanShape'>;
    expect(shape?.kind).toBe('form_foreman');
    expect(shape?.remaining).toBe(use.duration);
    expect(p.scale).toBeCloseTo(scaleBefore * FOREMAN_SHAPE_SCALE, 6);
    expect(p.stats.armor).toBeGreaterThanOrEqual(
      Math.round(armorBefore * (1 + use.armorPct / 100)) - 1,
    );
    expect(p.cooldowns.get(trinketCooldownKey('knucklebone_of_balgath'))).toBe(120);
  });

  it('cannot be knocked back while shaped, and can be again once it lets go', () => {
    const sim = wearing('knucklebone_of_balgath');
    const wolf = foe(sim, 0, 3);
    sim.useItem('knucklebone_of_balgath');
    expect(applyKnockback(ctxOf(sim), wolf, sim.player, 8)).toBe(0);
    run(sim, 15.2);
    expect(auraOf(sim.player, TRINKET_AURA.foremanShape)).toBeUndefined();
    expect(applyKnockback(ctxOf(sim), wolf, sim.player, 8)).toBeGreaterThan(0);
  });

  it('keeps every ability: a mage still casts, only the wand leaves the hands', () => {
    const sim = wearing('knucklebone_of_balgath', 'mage');
    const wolf = foe(sim, 0, 12);
    sim.targetEntity(wolf.id);
    sim.useItem('knucklebone_of_balgath');
    expect(wandAllowedInForm(sim.player)).toBe(false);
    const hp = wolf.hp;
    sim.castAbility('fireball');
    const events = run(sim, 4);
    expect(wolf.hp).toBeLessThan(hp);
    expect(events.some((e) => e.type === 'damage' && e.targetId === wolf.id)).toBe(true);
  });
});

// ---- Muster Standard ---------------------------------------------------------------------

describe('Muster Standard: walking melee guardians', () => {
  // Already in the fight: the soldiers never open one themselves.
  const engage = (e: Entity) => {
    e.inCombat = true;
    return e;
  };
  function planted(distance = 14) {
    const sim = wearing('muster_standard');
    const wolf = engage(foe(sim, 0, distance));
    sim.targetEntity(wolf.id);
    sim.useItem('muster_standard');
    const soldiers = [...sim.entities.values()].filter(
      (e) => e.ownerId === sim.playerId && e.guardianState?.melee,
    );
    return { sim, wolf, soldiers };
  }

  it('plants the standard and raises the two camp soldiers, each on its own health pool', () => {
    const { sim, soldiers } = planted();
    const standard = auraOf(sim.player, TRINKET_AURA.musterStandard);
    expect(standard?.value2).toBeCloseTo(sim.player.pos.x, 6);
    expect(standard?.value3).toBeCloseTo(sim.player.pos.z, 6);
    expect(soldiers.map((s) => s.templateId).sort()).toEqual(
      MUSTER_STANDARD_SOLDIERS.map((s) => `guardian_${s.key}`).sort(),
    );
    const use = TRINKET_SPECS.muster_standard.use as Use<'musterStandard'>;
    for (const s of soldiers) {
      expect(s.maxHp).toBe(Math.round(sim.player.maxHp * use.hpShare));
      expect(s.hostile).toBe(false);
    }
  });

  it('runs to the target, fights it in melee, and only ever hits your target', () => {
    const { sim, wolf, soldiers } = planted(14);
    const bystander = foe(sim, 8, 0);
    const start = soldiers.map((s) => ({ ...s.pos }));
    const hp = wolf.hp;
    const events = run(sim, 6);
    for (let i = 0; i < soldiers.length; i++) {
      const moved = Math.hypot(soldiers[i].pos.x - start[i].x, soldiers[i].pos.z - start[i].z);
      expect(moved).toBeGreaterThan(8);
    }
    expect(wolf.hp).toBeLessThan(hp);
    const soldierIds = new Set(soldiers.map((s) => s.id));
    const hits = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && soldierIds.has(e.sourceId),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.targetId === wolf.id)).toBe(true);
    expect(bystander.hp).toBe(bystander.maxHp);
  });

  it('switches when you switch target', () => {
    const { sim, wolf, soldiers } = planted(6);
    run(sim, 2);
    const second = engage(foe(sim, -6, 0));
    sim.targetEntity(second.id);
    const hp = second.hp;
    run(sim, 5);
    expect(second.hp).toBeLessThan(hp);
    for (const s of soldiers) expect(s.aggroTargetId).toBe(second.id);
    expect(wolf.dead).toBe(false);
  });

  it('never pulls: a creature not yet in the fight is left alone', () => {
    const { sim, wolf, soldiers } = planted(6);
    // Out past its own aggro radius, so only the soldiers could start that fight.
    const idle = foe(sim, -25, 0);
    sim.targetEntity(idle.id);
    run(sim, 5);
    expect(idle.hp).toBe(idle.maxHp);
    expect(idle.inCombat).toBe(false);
    for (const s of soldiers) expect(s.aggroTargetId).toBeNull();
    expect(wolf.dead).toBe(false);
  });

  it('can be struck down like any creature, and its body neither walks nor swings', () => {
    const { sim, wolf, soldiers } = planted(6);
    const ctx = ctxOf(sim);
    const fallen = soldiers[0];
    ctx.dealDamage(wolf, fallen, fallen.hp + 10, false, 'physical', null, 'hit');
    expect(fallen.dead || !sim.entities.has(fallen.id)).toBe(true);
    const events = run(sim, 5);
    expect(sim.entities.has(fallen.id)).toBe(false);
    expect(events.some((e) => e.type === 'damage' && e.sourceId === fallen.id)).toBe(false);
  });

  it('leaves with the standard after its duration', () => {
    const { sim } = planted(6);
    run(sim, 15.1);
    const left = [...sim.entities.values()].filter((e) => e.guardianState?.melee);
    expect(left).toHaveLength(0);
    expect(auraOf(sim.player, TRINKET_AURA.musterStandard)).toBeUndefined();
  });

  /** Run the player `yards` along +x at a player's run (7 yd/s), ticking the world. */
  const runAlong = (sim: Sim, yards: number) => {
    const steps = Math.round(yards / (7 * DT));
    for (let i = 0; i < steps; i++) {
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.pos.x += 7 * DT;
      sim.player.facing = Math.PI / 2;
      sim.tick();
    }
  };
  const soldiersOf = (sim: Sim) =>
    [...sim.entities.values()].filter((e) => e.ownerId === sim.playerId && e.guardianState?.melee);

  it('marches at your side out of combat, keeping up with a run', () => {
    // Owner playtest: they used to stand guard at the standard while the player walked on.
    // With nothing to fight they fall in beside you and keep pace with a run.
    const sim = wearing('muster_standard');
    sim.useItem('muster_standard');
    run(sim, 0.5);
    const start = { ...sim.player.pos };
    runAlong(sim, 25);
    run(sim, 1);
    expect(Math.hypot(sim.player.pos.x - start.x, sim.player.pos.z - start.z)).toBeGreaterThan(24);
    const soldiers = soldiersOf(sim);
    expect(soldiers).toHaveLength(2);
    for (const s of soldiers) {
      expect(Math.hypot(s.pos.x - sim.player.pos.x, s.pos.z - sim.player.pos.z)).toBeLessThan(4);
      expect(s.aggroTargetId).toBeNull();
    }
    // Two bodies, two places: they flank you rather than stacking on one spot.
    expect(
      Math.hypot(soldiers[0].pos.x - soldiers[1].pos.x, soldiers[0].pos.z - soldiers[1].pos.z),
    ).toBeGreaterThan(1);
  });

  it('fights your target wherever you take the fight, not only near the standard', () => {
    const sim = wearing('muster_standard');
    sim.useItem('muster_standard');
    run(sim, 0.5);
    const use = TRINKET_SPECS.muster_standard.use as Use<'musterStandard'>;
    // Well past the old post leash from where the standard went in.
    runAlong(sim, use.leash + 10);
    const wolf = engage(foe(sim, 0, 6));
    sim.targetEntity(wolf.id);
    const hp = wolf.hp;
    run(sim, 5);
    expect(wolf.hp).toBeLessThan(hp);
    for (const s of soldiersOf(sim)) expect(s.aggroTargetId).toBe(wolf.id);
  });

  it('rejoins you at once when left past the leash, and the standard stays up', () => {
    const sim = wearing('muster_standard');
    sim.useItem('muster_standard');
    run(sim, 0.5);
    const use = TRINKET_SPECS.muster_standard.use as Use<'musterStandard'>;
    // A mount, a leap or a portal: far faster than any body could follow.
    sim.player.pos.x += use.leash + 15;
    sim.player.prevPos = { ...sim.player.pos };
    run(sim, 0.2);
    const soldiers = soldiersOf(sim);
    expect(soldiers).toHaveLength(2);
    for (const s of soldiers)
      expect(Math.hypot(s.pos.x - sim.player.pos.x, s.pos.z - sim.player.pos.z)).toBeLessThan(4);
    expect(auraOf(sim.player, TRINKET_AURA.musterStandard)).toBeDefined();
  });

  it('leaves when you die', () => {
    const { sim, wolf } = planted(6);
    run(sim, 1);
    ctxOf(sim).dealDamage(wolf, sim.player, sim.player.hp + 100, false, 'physical', null, 'hit');
    run(sim, 0.2);
    expect([...sim.entities.values()].filter((e) => e.guardianState?.melee)).toHaveLength(0);
  });

  it('leaves every existing (stationary) guardian exactly as it was', () => {
    const sim = wearing('muster_standard', 'hunter');
    const wolf = foe(sim, 0, 10);
    const beast = summonGuardian(ctxOf(sim), sim.player, {
      key: 'stampede_0',
      name: 'Stampede Beast 1',
      color: 0xa02d24,
      scale: 0.85,
      remaining: 12,
      attackInterval: 2,
      minDamage: 18,
      maxDamage: 24,
      school: 'physical',
      abilityId: 'stampede',
      abilityName: 'Stampede',
      preferredTargetId: wolf.id,
      maxRange: 35,
      dismissWhenUntargeted: false,
    });
    // No melee key at all (not even undefined), the classic spawn spot, a stationary body.
    expect(Object.hasOwn(beast.guardianState ?? {}, 'melee')).toBe(false);
    expect(beast.pos.x).toBeCloseTo(sim.player.pos.x + 1.5, 6);
    const at = { ...beast.pos };
    const hp = wolf.hp;
    run(sim, 4);
    expect(beast.pos.x).toBe(at.x);
    expect(beast.pos.z).toBe(at.z);
    expect(wolf.hp).toBeLessThan(hp);
  });
});

// ---- The Guttered Eye ----------------------------------------------------------------------

describe('The Guttered Eye: the line beam', () => {
  it('carries the same base damage as its sister 2 min use, the Muster Standard', () => {
    // Owner playtest: it hit too weakly (6 ticks of 18, 108 in all, under the 3 sec of
    // casting the channel costs). Same boss, item level and cooldown as the Standard, so
    // the same base budget: two soldiers, a swing every 2 sec for 15 sec, 18 on average.
    const glare = TRINKET_SPECS.guttered_eye.use as Use<'gutteredGlare'>;
    const standard = TRINKET_SPECS.muster_standard.use as Use<'musterStandard'>;
    expect(TRINKET_SPECS.guttered_eye.cooldown).toBe(TRINKET_SPECS.muster_standard.cooldown);
    const glareBase = glare.flat * Math.round(glare.duration / glare.every);
    const standardBase =
      standard.soldiers *
      (standard.duration / standard.attackInterval) *
      ((standard.min + standard.max) / 2);
    expect(glareBase).toBe(270);
    expect(glareBase).toBeCloseTo(standardBase, 6);
    // The Spell Power share stays the classic area-channel one: 3 / 3.5, halved, per tick.
    expect(glare.coef).toBeCloseTo(glare.duration / 3.5 / 2 / 6, 1);
  });

  it('hits what lies on the line, nearest first, and nothing behind, beside or past it', () => {
    const at = (id: number, x: number, z: number) => ({ id, pos: { x, z } });
    const hits = glareLineHits(
      { x: 0, z: 0 },
      0, // facing +Z
      [at(1, 0, 10), at(2, 0.9, 5), at(3, 3, 5), at(4, 0, -4), at(5, 0, 31), at(6, -1.2, 20)],
      30,
      1.25,
      8,
    );
    expect(hits.map((h) => h.id)).toEqual([2, 1, 6]);
    // The cap keeps the nearest.
    const many = Array.from({ length: 12 }, (_, i) => at(i + 1, 0, i + 1));
    expect(glareLineHits({ x: 0, z: 0 }, 0, many, 30, 1.25, 8).map((h) => h.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('burns every tick for its whole channel, at the tooltip number, and sweeps as you turn', () => {
    const sim = wearing('guttered_eye', 'mage');
    const ahead = foe(sim, 0, 12);
    const aside = foe(sim, 12, 0);
    const use = TRINKET_SPECS.guttered_eye.use as Use<'gutteredGlare'>;
    const tick = Math.round(use.flat + use.coef * sim.player.spellPower);
    sim.player.facing = 0;
    sim.useItem('guttered_eye');
    let events = run(sim, 1.5);
    const glare = (evs: SimEvent[], id: number) =>
      evs.filter((e) => e.type === 'damage' && e.targetId === id && e.ability === 'Guttered Glare');
    expect(glare(events, ahead.id).length).toBe(3);
    expect(glare(events, aside.id).length).toBe(0);
    for (const hit of glare(events, ahead.id)) {
      if (hit.type === 'damage' && hit.kind === 'hit') expect(hit.amount).toBeLessThanOrEqual(tick);
    }
    // Turn a quarter to the right: the beam sweeps onto the other wolf.
    sim.player.facing = Math.PI / 2;
    events = run(sim, 1.6);
    expect(glare(events, aside.id).length).toBe(3);
    expect(glare(events, ahead.id).length).toBe(0);
    expect(auraOf(sim.player, TRINKET_AURA.gutteredGlare)).toBeUndefined();
  });

  it('scales with Spell Power exactly as the tooltip resolves it', () => {
    const use = TRINKET_SPECS.guttered_eye.use as Use<'gutteredGlare'>;
    for (const sp of [0, 250]) {
      const sim = wearing('guttered_eye', 'mage');
      sim.player.spellPower = sp;
      sim.useItem('guttered_eye');
      expect(auraOf(sim.player, TRINKET_AURA.gutteredGlare)?.value).toBe(
        Math.max(1, Math.round(use.flat + use.coef * sp)),
      );
    }
  });

  it('breaks when you walk away from where you planted it', () => {
    const sim = wearing('guttered_eye', 'mage');
    foe(sim, 0, 12);
    sim.useItem('guttered_eye');
    run(sim, 0.3);
    sim.player.pos.x += GUTTERED_GLARE_DRIFT + 0.5;
    run(sim, 0.4);
    expect(auraOf(sim.player, TRINKET_AURA.gutteredGlare)).toBeUndefined();
  });
});

// ---- Barrowstone Heart ---------------------------------------------------------------------

describe('Barrowstone Heart: the stone statue', () => {
  it('turns a killing blow into a statue, then returns you at a fifth of your health', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(1);
    const statue = auraOf(p, TRINKET_AURA.stoneStatue);
    expect(statue?.kind).toBe('stasis');
    expect(p.cooldowns.get(trinketCooldownKey('barrowstone_heart'))).toBe(180);
    // Stone: nothing gets through while it holds.
    ctxOf(sim).dealDamage(wolf, p, 99999, false, 'physical', null, 'hit');
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(1);
    run(sim, 3.05);
    expect(auraOf(p, TRINKET_AURA.stoneStatue)).toBeUndefined();
    expect(p.hp).toBe(Math.round(p.maxHp * 0.2));
  });

  it('holds only once every three minutes', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    run(sim, 3.05);
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    expect(p.dead).toBe(true);
  });

  it('is armed again once its cooldown has run out', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    run(sim, 3.05);
    p.cooldowns.set(trinketCooldownKey('barrowstone_heart'), 0);
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    expect(p.dead).toBe(false);
  });

  it('waits out the on-equip lockout, so a swap cannot arm a fresh Heart mid-fight', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.addItem('barrowstone_heart', 1);
    sim.equipItem('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    ctxOf(sim).dealDamage(wolf, sim.player, sim.player.hp + 500, false, 'physical', null, 'hit');
    expect(sim.player.dead).toBe(true);
  });

  it('is the last save asked: a guardian ward spends first and the Heart stays ready', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    p.auras.push({
      id: 'sacred_bulwark',
      name: 'Sacred Bulwark',
      kind: 'guardian_ward',
      remaining: 10,
      duration: 10,
      value: 0.35,
      sourceId: p.id,
      school: 'holy',
    });
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    expect(p.dead).toBe(false);
    expect(auraOf(p, TRINKET_AURA.stoneStatue)).toBeUndefined();
    expect(p.cooldowns.get(trinketCooldownKey('barrowstone_heart')) ?? 0).toBe(0);
  });

  it('never holds inside an arena match: ranked play ends at the killing blow', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    ctxOf(sim).arenaMatches.set(p.id, {} as never);
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    ctxOf(sim).arenaMatches.delete(p.id);
    expect(auraOf(p, TRINKET_AURA.stoneStatue)).toBeUndefined();
    expect(p.cooldowns.get(trinketCooldownKey('barrowstone_heart')) ?? 0).toBe(0);
  });

  it('has nothing to use: the press is refused and costs nothing', () => {
    const sim = wearing('barrowstone_heart');
    sim.useItem('barrowstone_heart');
    expect(sim.player.cooldowns.get(trinketCooldownKey('barrowstone_heart')) ?? 0).toBe(0);
    expect(
      sim.drainEvents().some((e) => e.type === 'error' && e.text === 'It works on its own.'),
    ).toBe(true);
  });
});

// ---- Muster Grapnel ------------------------------------------------------------------------

describe('Muster Grapnel: the haul', () => {
  function party() {
    const sim = new Sim({ seed: 31, playerClass: 'priest', autoEquip: true, noPlayer: true });
    const healer = sim.addPlayer('priest', 'Healer');
    const ally = sim.addPlayer('warrior', 'Tank');
    const stranger = sim.addPlayer('rogue', 'Stranger');
    for (const pid of [healer, ally, stranger]) sim.setPlayerLevel(20, pid);
    sim.partyInvite(ally, healer);
    sim.partyAccept(ally);
    sim.addItem('muster_grapnel', 1, healer);
    sim.equipItem('muster_grapnel', healer);
    const h = sim.entities.get(healer) as Entity;
    h.cooldowns.delete(trinketCooldownKey('muster_grapnel'));
    const a = sim.entities.get(ally) as Entity;
    const s = sim.entities.get(stranger) as Entity;
    // Open fen ground, twenty yards apart.
    a.pos = { ...h.pos, x: h.pos.x + 20 };
    s.pos = { ...h.pos, x: h.pos.x - 20 };
    return { sim, h, a, s };
  }

  it('hauls a party member through the air to your side', () => {
    const { sim, h, a } = party();
    sim.targetEntity(a.id, h.id);
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap?.abilityId).toBe('trinket_muster_grapnel');
    expect(a.leap?.landingAoe.radius).toBe(0);
    expect(h.cooldowns.get(trinketCooldownKey('muster_grapnel'))).toBe(90);
    run(sim, 0.8);
    expect(a.leap ?? null).toBeNull();
    expect(Math.hypot(a.pos.x - h.pos.x, a.pos.z - h.pos.z)).toBeLessThan(3);
  });

  it('refuses anyone outside the party, an enemy, or someone out of reach', () => {
    const { sim, h, a, s } = party();
    const wolf = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...h.pos, z: h.pos.z + 5 });
    wolf.hostile = true;
    sim.addEntity(wolf);
    for (const target of [s.id, wolf.id]) {
      sim.targetEntity(target, h.id);
      sim.useItem('muster_grapnel', h.id);
    }
    expect(s.leap ?? null).toBeNull();
    expect(wolf.leap ?? null).toBeNull();
    a.pos = { ...h.pos, x: h.pos.x + 40 };
    sim.targetEntity(a.id, h.id);
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    expect(h.cooldowns.get(trinketCooldownKey('muster_grapnel')) ?? 0).toBe(0);
  });

  it('leaves alone a body another mode holds: a statue, a vehicle seat, a ship deck', () => {
    const { sim, h, a } = party();
    sim.targetEntity(a.id, h.id);
    a.auras.push({
      id: TRINKET_AURA.stoneStatue,
      name: 'Stone Statue',
      kind: 'stasis',
      remaining: 3,
      duration: 3,
      value: 0.2,
      sourceId: a.id,
      school: 'physical',
    });
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    a.auras.length = 0;
    const meta = sim.players.get(a.id);
    if (!meta) throw new Error('no ally meta');
    meta.vehicle = {} as NonNullable<typeof meta.vehicle>;
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    meta.vehicle = null;
    a.ferryRide = { route: 'x' } as unknown as typeof a.ferryRide;
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
  });

  it('cannot move an anchored or shaped ally, nor throw from a leap', () => {
    const { sim, h, a } = party();
    sim.targetEntity(a.id, h.id);
    a.auras.push({
      id: TRINKET_AURA.anchor,
      name: 'Moored',
      kind: 'internal_cd',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: a.id,
      school: 'physical',
    });
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    a.auras.length = 0;
    a.auras.push({
      id: TRINKET_AURA.foremanShape,
      name: 'Shape of the Foreman',
      kind: 'form_foreman',
      remaining: 5,
      duration: 5,
      value: 50,
      sourceId: a.id,
      school: 'physical',
    });
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    a.auras.length = 0;
    h.leap = { ...(h.leap ?? {}) } as NonNullable<typeof h.leap>;
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
    expect(h.cooldowns.get(trinketCooldownKey('muster_grapnel')) ?? 0).toBe(0);
  });

  it('never reaches across an instance wall', () => {
    const { sim, h, a } = party();
    a.pos = { ...a.pos, x: DUNGEON_X_THRESHOLD + 5 };
    h.pos = { ...h.pos, x: DUNGEON_X_THRESHOLD - 5 };
    sim.targetEntity(a.id, h.id);
    sim.useItem('muster_grapnel', h.id);
    expect(a.leap ?? null).toBeNull();
  });
});

// ---- The loot ---------------------------------------------------------------------------------

describe("Balgath's table pays the new spoils within the world-boss conventions", () => {
  const rows = MOBS.balgath_cyclops.loot;

  it('rolls five spoils at 8% (40%) and five trinkets at 6% (30%), trinkets second', () => {
    const spoils = rows.filter((r) => r.rollGroup === 'balgath_spoils');
    const trinkets = rows.filter((r) => r.rollGroup === 'balgath_trinkets');
    expect(spoils.map((r) => r.itemId)).toContain('craterglass_stave');
    expect(spoils.reduce((s, r) => s + r.chance, 0)).toBeCloseTo(0.4, 9);
    expect(trinkets.map((r) => r.itemId)).toEqual([...BALGATH_TRINKET_ITEM_IDS]);
    expect(trinkets.every((r) => r.chance === 0.06)).toBe(true);
    const firstSpoil = rows.findIndex((r) => r.rollGroup === 'balgath_spoils');
    const firstTrinket = rows.findIndex((r) => r.rollGroup === 'balgath_trinkets');
    expect(firstSpoil).toBeLessThan(firstTrinket);
    // Thunzharr's calibration: 40% main group, and a second group near 19% effective.
    expect(0.6 * 0.3).toBeCloseTo(0.18, 9);
  });

  it('never gives one contributor two gear pieces from one kill', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const pids = Array.from({ length: 12 }, (_, i) => sim.addPlayer('warrior', `R${i}`));
    for (const pid of pids) sim.setPlayerLevel(20, pid);
    const metas = pids.map((pid) => sim.players.get(pid)).filter((m) => !!m);
    const gear = new Set([
      ...rows.filter((r) => r.rollGroup === 'balgath_spoils').map((r) => r.itemId),
      ...BALGATH_TRINKET_ITEM_IDS,
    ]);
    let trinketDrops = 0;
    let spoilDrops = 0;
    const kills = 400;
    for (let k = 0; k < kills; k++) {
      const boss = createMob(sim.nextId++, MOBS.balgath_cyclops, 20, { x: 0, y: 0, z: 0 });
      for (const m of metas) m.raidLockouts.clear();
      (sim as unknown as { rollWorldBossLoot(m: Entity, c: typeof metas): void }).rollWorldBossLoot(
        boss,
        metas,
      );
      const perPlayer = new Map<number, number>();
      for (const slot of boss.loot?.items ?? []) {
        if (!slot.itemId || !gear.has(slot.itemId)) continue;
        const who = slot.personalFor?.[0] ?? -1;
        perPlayer.set(who, (perPlayer.get(who) ?? 0) + 1);
        if (BALGATH_TRINKET_ITEM_IDS.includes(slot.itemId)) trinketDrops++;
        else spoilDrops++;
      }
      for (const count of perPlayer.values()) expect(count).toBe(1);
    }
    const draws = kills * metas.length;
    // Loose statistical bands around the designed 40% and 18%.
    expect(spoilDrops / draws).toBeGreaterThan(0.34);
    expect(spoilDrops / draws).toBeLessThan(0.46);
    expect(trinketDrops / draws).toBeGreaterThan(0.14);
    expect(trinketDrops / draws).toBeLessThan(0.22);
  });
});

// ---- the tooltip is the number dealt ------------------------------------------------------
// A clean character (no god mode, no dev multiplier) against the level-20 Training Dummy
// (no armor, never fights back): every number the Use or Equip line prints is what lands.

function dummy(sim: Sim, ahead: number): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: p.pos.x + Math.sin(p.facing) * ahead,
    y: p.pos.y,
    z: p.pos.z + Math.cos(p.facing) * ahead,
  });
  sim.addEntity(mob);
  return mob;
}

function tooltipOf(sim: Sim, itemId: string): string {
  const p = sim.player;
  return trinketTooltipLineTexts(itemId, {
    attackPower: p.attackPower,
    rangedPower: p.rangedPower,
    spellPower: p.spellPower,
    healPower: 0,
    maxHp: p.maxHp,
  })
    .map((line) => line.text)
    .join(' ');
}

/** "18" or "18 (+4)" as the number it resolves to. */
const resolved = (base: string, bonus?: string) => Number(base) + Number(bonus ?? 0);

describe('Balgath trinket tooltips print the damage and healing that land', () => {
  it('The Guttered Eye: every non-critical tick is the tooltip tick, and six of them', () => {
    for (const sp of [0, 50, 137]) {
      const sim = wearing('guttered_eye', 'mage');
      sim.player.spellPower = sp;
      expect(sim.player.devGod ?? false).toBe(false);
      const target = dummy(sim, 8);
      const text = tooltipOf(sim, 'guttered_eye');
      const m = /deals (\d+)(?: \(\+(\d+)\))? Arcane damage every/.exec(text);
      expect(m, text).not.toBeNull();
      const tick = resolved(m?.[1] ?? '0', m?.[2]);
      sim.useItem('guttered_eye');
      const hits = run(sim, 3.2).filter(
        (e): e is Extract<SimEvent, { type: 'damage' }> =>
          e.type === 'damage' && e.targetId === target.id && e.ability === 'Guttered Glare',
      );
      expect(hits).toHaveLength(6);
      for (const h of hits)
        expect(h.amount, `SP ${sp}`).toBe(h.crit ? Math.round(tick * 1.5) : tick);
      // The raised glare (45 a tick at no Spell Power, the Muster Standard's budget).
      expect(tick).toBeGreaterThanOrEqual(45);
      expect(tick).toBeLessThan(60);
    }
  });

  it('Muster Standard: every soldier hit falls inside the printed range', () => {
    const sim = wearing('muster_standard');
    const target = dummy(sim, 2);
    sim.targetEntity(target.id);
    // The owner opens the fight (the soldiers never do).
    sim.startAutoAttack();
    run(sim, 2.5);
    const text = tooltipOf(sim, 'muster_standard');
    const m = /for (\d+) to (\d+)(?: \(\+(\d+)\))? Physical damage/.exec(text);
    expect(m, text).not.toBeNull();
    const lo = resolved(m?.[1] ?? '0', m?.[3]);
    const hi = resolved(m?.[2] ?? '0', m?.[3]);
    sim.useItem('muster_standard');
    const hits = run(sim, 12).filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === target.id && e.sourceOwnerId === sim.playerId,
    );
    expect(hits.length).toBeGreaterThan(6);
    for (const h of hits) {
      if (h.crit || h.kind !== 'hit') continue;
      expect(h.amount).toBeGreaterThanOrEqual(lo);
      expect(h.amount).toBeLessThanOrEqual(hi);
    }
    expect(hi).toBeLessThan(60);
  });

  it('Knucklebone of Balgath: the fists hit exactly as hard as the weapon they replace', () => {
    const swings = (shaped: boolean) => {
      const sim = wearing('knucklebone_of_balgath', 'warrior', 41);
      const target = dummy(sim, 2);
      sim.targetEntity(target.id);
      if (shaped) sim.useItem('knucklebone_of_balgath');
      sim.startAutoAttack();
      return run(sim, 10)
        .filter(
          (e): e is Extract<SimEvent, { type: 'damage' }> =>
            e.type === 'damage' && e.sourceId === sim.playerId && !e.ability && e.kind === 'hit',
        )
        .map((e) => e.amount);
    };
    // Same seed, same swings: the shape changes the body, never the numbers.
    expect(swings(true)).toEqual(swings(false));
  });

  it('Muster Grapnel: the ally lands healed for exactly the printed amount', () => {
    for (const healPower of [0, 90, 240]) {
      const sim = new Sim({ seed: 31, playerClass: 'priest', autoEquip: true, noPlayer: true });
      const healer = sim.addPlayer('priest', 'Healer');
      const ally = sim.addPlayer('warrior', 'Tank');
      for (const pid of [healer, ally]) sim.setPlayerLevel(20, pid);
      sim.partyInvite(ally, healer);
      sim.partyAccept(ally);
      sim.addItem('muster_grapnel', 1, healer);
      sim.equipItem('muster_grapnel', healer);
      const h = sim.entities.get(healer) as Entity;
      const a = sim.entities.get(ally) as Entity;
      h.cooldowns.delete(trinketCooldownKey('muster_grapnel'));
      h.healPower = healPower;
      a.pos = { ...h.pos, x: h.pos.x + 20 };
      a.hp = Math.round(a.maxHp / 2);
      const text = trinketTooltipLineTexts('muster_grapnel', {
        attackPower: h.attackPower,
        rangedPower: h.rangedPower,
        spellPower: h.spellPower,
        healPower: h.healPower,
        maxHp: h.maxHp,
      })
        .map((line) => line.text)
        .join(' ');
      const m = /healing them for (\d+)(?: \(\+(\d+)\))? when they land/.exec(text);
      expect(m, text).not.toBeNull();
      const printed = resolved(m?.[1] ?? '0', m?.[2]);
      sim.targetEntity(a.id, h.id);
      const before = a.hp;
      sim.useItem('muster_grapnel', h.id);
      run(sim, 1);
      // Landed at the healer's side, healed by exactly the printed amount (the heal
      // never crits, and no other healing runs in this second).
      expect(Math.hypot(a.pos.x - h.pos.x, a.pos.z - h.pos.z)).toBeLessThan(3);
      expect(a.hp - before, `healPower ${healPower}`).toBe(printed);
      expect(printed).toBe(Math.round(120 + 0.4 * healPower));
    }
  });

  it('Barrowstone Heart: the health you return with is the health it prints', () => {
    const sim = wearing('barrowstone_heart');
    const wolf = foe(sim, 0, 3);
    const p = sim.player;
    const m = /return with (\d+) health/.exec(tooltipOf(sim, 'barrowstone_heart'));
    expect(m).not.toBeNull();
    ctxOf(sim).dealDamage(wolf, p, p.hp + 500, false, 'physical', null, 'hit');
    run(sim, 3.05);
    expect(p.hp).toBe(Number(m?.[1]));
  });
});

import { describe, expect, it } from 'vitest';
import {
  TURRET_ARENA,
  TURRET_BOWLING,
  TURRET_PHYSICS,
  TURRET_SIZE_CLASSES,
  TURRET_TEMPLATE_SIZES,
  TURRET_TIMING,
  TURRET_WAVES,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import { createMob, mobMaxHp } from '../src/sim/entity';
import { FIRE_AND_FLY_TOWER } from '../src/sim/fire_and_fly_field';
import { resolveTurretPlan, turretSpawnOrder } from '../src/sim/minigames/turret_defense_plan';

const plan = resolveTurretPlan();
const templateIds = [...new Set(TURRET_WAVES.flatMap((w) => w.entries.map((e) => e.templateId)))];

function hitsToKill(wave: number, templateId: string): number {
  const k = plan.kinds.find(
    (x) => x.templateId === templateId && plan.waves[wave].spawns.includes(plan.kinds.indexOf(x)),
  );
  if (!k) throw new Error(`${templateId} is not in wave ${wave + 1}`);
  return Math.ceil(k.maxHp / plan.waves[wave].coreDamage);
}

describe('wave table against the real templates', () => {
  it('uses only templates that exist, each with a size class, and no stale size rows', () => {
    for (const id of templateIds) {
      expect(MOBS[id], id).toBeDefined();
      expect(TURRET_TEMPLATE_SIZES[id], id).toBeDefined();
      expect(MOBS[id].moveSpeed, id).toBeGreaterThan(0);
    }
    expect(Object.keys(TURRET_TEMPLATE_SIZES).sort()).toEqual([...templateIds].sort());
  });

  it('keeps every level inside its template level range', () => {
    for (const wave of TURRET_WAVES) {
      for (const e of wave.entries) {
        const t = MOBS[e.templateId];
        expect(e.level, e.templateId).toBeGreaterThanOrEqual(t.minLevel);
        expect(e.level, e.templateId).toBeLessThanOrEqual(t.maxLevel);
      }
    }
  });

  it('takes health from the real mob formula (createMob and the plan agree)', () => {
    expect(plan.kinds.length).toBeGreaterThan(0);
    for (const k of plan.kinds) {
      const t = MOBS[k.templateId];
      const mob = createMob(1, t, k.level, { x: 0, y: 0, z: 0 });
      expect(k.maxHp, k.templateId).toBe(mob.maxHp);
      expect(mobMaxHp(t, k.level)).toBe(mob.maxHp);
    }
    const hp = Object.fromEntries(plan.kinds.map((k) => [`${k.templateId}@${k.level}`, k.maxHp]));
    expect(hp).toMatchObject({
      'forest_wolf@2': 54,
      'frostmane_yeti@20': 1587,
      'idol_guardian@20': 1831,
    });
  });

  it('marches at the template speed times the march factor, with size-class physics', () => {
    for (const k of plan.kinds) {
      expect(k.marchSpeed).toBeCloseTo(
        MOBS[k.templateId].moveSpeed * TURRET_TIMING.marchFactor,
        12,
      );
      expect(k).toMatchObject(TURRET_SIZE_CLASSES[TURRET_TEMPLATE_SIZES[k.templateId]]);
    }
    expect(plan.kinds.find((k) => k.templateId === 'forest_wolf')?.marchSpeed).toBeCloseTo(4.4, 12);
  });

  it('matches the six-wave composition, weakest first, with the guardian spawning last', () => {
    const composition = TURRET_WAVES.map((w) =>
      w.entries.map((e) => `${e.templateId}x${e.count}@${e.level}`),
    );
    expect(composition).toEqual([
      ['forest_wolfx8@2'],
      ['forest_wolfx6@2', 'wild_boarx6@3'],
      ['vale_banditx8@5', 'webwood_spiderx6@4'],
      ['tunnel_ratx8@6', 'fen_trollx4@11'],
      ['deeprock_koboldx8@15', 'thornpeak_ogrex4@16', 'boneclad_revenantx4@19'],
      ['boneclad_revenantx6@19', 'frostmane_yetix2@20', 'idol_guardianx1@20'],
    ]);
    const last = plan.waves[5].spawns;
    expect(plan.kinds[last[last.length - 1]].templateId).toBe('idol_guardian');
    expect(last.filter((i) => plan.kinds[i].templateId === 'idol_guardian')).toHaveLength(1);
    const firstWaveHp = Math.max(...plan.waves[0].spawns.map((i) => plan.kinds[i].maxHp));
    const lastWaveHp = Math.max(...plan.waves[5].spawns.map((i) => plan.kinds[i].maxHp));
    expect(lastWaveHp).toBeGreaterThan(firstWaveHp * 10);
  });

  it('refuses an unknown template and a template without a size class', () => {
    const wave = (templateId: string) => [
      {
        entries: [{ templateId, count: 1, level: 2 }],
        coreDamage: 1,
        gapMinTicks: 1,
        gapMaxTicks: 1,
      },
    ];
    expect(() => resolveTurretPlan(wave('no_such_mob'))).toThrow(/unknown mob template/);
    const unsized = Object.keys(MOBS).find((id) => !(id in TURRET_TEMPLATE_SIZES));
    expect(unsized).toBeDefined();
    expect(() => resolveTurretPlan(wave(unsized ?? ''))).toThrow(/no size class/);
  });

  it('resolves one kind per template and level, shared across waves', () => {
    const revenants = plan.kinds.filter((k) => k.templateId === 'boneclad_revenant');
    expect(revenants).toHaveLength(1);
    const index = plan.kinds.indexOf(revenants[0]);
    expect(plan.waves[4].spawns).toContain(index);
    expect(plan.waves[5].spawns).toContain(index);
    expect(plan.kinds).toHaveLength(11);
  });

  it('interleaves ordinary entries evenly and keeps each entry count', () => {
    const order = turretSpawnOrder([
      { templateId: 'a', count: 4, level: 1 },
      { templateId: 'b', count: 2, level: 1 },
      { templateId: 'c', count: 1, level: 1, bossLast: true },
    ]);
    expect(order).toEqual([0, 1, 0, 0, 1, 0, 2]);
    plan.waves.forEach((wave, i) => {
      for (const e of TURRET_WAVES[i].entries) {
        const n = wave.spawns.filter(
          (k) => plan.kinds[k].templateId === e.templateId && plan.kinds[k].level === e.level,
        ).length;
        expect(n).toBe(e.count);
      }
    });
  });
});

describe('core-hit tuning intent (hits to kill, from the real template health)', () => {
  it.each([
    [0, 'forest_wolf', 1, 1],
    [2, 'vale_bandit', 2, 2],
    [3, 'fen_troll', 3, 3],
    [4, 'thornpeak_ogre', 3, 4],
    [5, 'boneclad_revenant', 3, 3],
    [5, 'frostmane_yeti', 6, 8],
    [5, 'idol_guardian', 8, 10],
  ] as const)('wave %i %s dies in %i to %i core hits', (wave, id, min, max) => {
    const n = hitsToKill(wave, id);
    expect(n).toBeGreaterThanOrEqual(min);
    expect(n).toBeLessThanOrEqual(max);
  });
});

describe('tuning constants in ticks and yards', () => {
  it('converts the authored seconds to 20 Hz ticks', () => {
    expect(TURRET_TIMING).toMatchObject({
      integrity: 100,
      introTicks: 60,
      betweenTicks: 100,
      windupTicks: 30,
      downTicks: 16,
      riseTicks: 12,
      corpseTicks: 100,
    });
    expect(TURRET_WEAPON.cooldownTicks).toBe(9);
    expect([TURRET_WEAPON.minFlightTicks, TURRET_WEAPON.maxFlightTicks]).toEqual([4, 18]);
    for (const w of TURRET_WAVES) expect([w.gapMinTicks, w.gapMaxTicks]).toEqual([16, 32]);
  });

  it('pins the arena, the tower body and the blast geometry', () => {
    expect(TURRET_ARENA).toEqual({
      spawnRadius: 46,
      breachRadius: FIRE_AND_FLY_TOWER.radius + 0.4,
      turretRadius: FIRE_AND_FLY_TOWER.radius,
      turretHeight: FIRE_AND_FLY_TOWER.topY,
    });
    expect(TURRET_ARENA.turretRadius).toBeCloseTo(1.904, 9);
    expect(TURRET_ARENA.turretHeight).toBeCloseTo(5.1, 9);
    expect(TURRET_ARENA.breachRadius).toBeCloseTo(2.304, 9);
    expect(TURRET_WEAPON).toEqual({
      cooldownTicks: 9,
      minRange: 2,
      maxRange: 60,
      shellSpeed: 110,
      minFlightTicks: 4,
      maxFlightTicks: 18,
      blastRadius: 6,
      blastCore: 1.5,
      grazeFalloff: 0.2,
      push: 18.34,
      pop: 19.59,
      massExponent: 1 / 3,
      deviation: Math.PI / 12,
      deadCenter: 0.05,
      maxLaunchSpeed: 32,
      maxLaunchLift: 26,
    });
    expect(TURRET_PHYSICS).toEqual({
      gravity: 30,
      bounceMinSpeed: 4,
      restitution: 0.35,
      bounceKeep: 0.6,
      wallRestitution: 0.4,
      skidDecel: 25,
      skidStopSpeed: 0.3,
      deepWater: 0.8,
      maxFlightTicks: 200,
      maxSkidTicks: 60,
      substeps: 4,
      stepRise: 0.25,
    });
  });

  it('pins the size classes and the template map', () => {
    expect(TURRET_SIZE_CLASSES).toEqual({
      small: { mass: 1, breachValue: 2, radius: 0.6, height: 1.2 },
      medium: { mass: 1.6, breachValue: 4, radius: 0.5, height: 2 },
      large: { mass: 3, breachValue: 10, radius: 0.9, height: 2.6 },
      huge: { mass: 4.5, breachValue: 15, radius: 1.2, height: 3 },
    });
    expect(TURRET_TEMPLATE_SIZES).toEqual({
      forest_wolf: 'small',
      wild_boar: 'small',
      webwood_spider: 'small',
      tunnel_rat: 'small',
      vale_bandit: 'medium',
      deeprock_kobold: 'medium',
      boneclad_revenant: 'medium',
      fen_troll: 'large',
      thornpeak_ogre: 'large',
      frostmane_yeti: 'huge',
      idol_guardian: 'huge',
    });
  });

  it('pins the bowling tuning, on by default, and carries it on the plan', () => {
    expect(TURRET_BOWLING).toEqual({
      enabled: true,
      minSpeed: 5,
      reachScale: 2,
      transfer: 0.5,
      pop: 7,
      damageShare: 0.1,
      flyerKeep: 0.6,
      lyingHeight: 0.35,
    });
    expect(plan.bowling).toEqual(TURRET_BOWLING);
    expect(plan.bowling).not.toBe(TURRET_BOWLING);
    expect(Object.isFrozen(plan.bowling)).toBe(true);
    const off = resolveTurretPlan(TURRET_WAVES, MOBS, { ...TURRET_BOWLING, enabled: false });
    expect(off.bowling.enabled).toBe(false);
    expect(off.kinds).toEqual(plan.kinds);
    expect(off.waves).toEqual(plan.waves);
  });

  it('gives every size class a height that grows with its mass', () => {
    const classes = Object.values(TURRET_SIZE_CLASSES).sort((a, b) => a.mass - b.mass);
    for (let i = 1; i < classes.length; i++) {
      expect(classes[i].height).toBeGreaterThan(classes[i - 1].height);
    }
    for (const k of plan.kinds) expect(k.height).toBe(TURRET_SIZE_CLASSES[k.sizeClass].height);
  });
});

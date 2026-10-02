// The weapon sockets' tooltips state the damage a monster takes, resolved from the
// current wave: proven here against the engine's own blasts, not the content alone.
import { beforeEach, describe, expect, it } from 'vitest';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_FRAGMENTATION,
  TURRET_SHOCKWAVE,
  TURRET_SIZE_CLASSES,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import { stillSegment, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretMonster,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import type { TurretKind, TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { startTurretShockwave } from '../src/sim/minigames/turret_shockwave';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import {
  turretBombletHitDamage,
  turretShockwaveHitDamage,
  turretWaveCoreDamage,
  turretWeaponDescription,
  turretWeaponTooltip,
} from '../src/ui/hud/vehicle/turret_weapon_tooltip';
import { setLanguage } from '../src/ui/i18n';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const START = 1000;

const KIND: TurretKind = {
  templateId: 'forest_wolf',
  level: 2,
  sizeClass: 'small',
  maxHp: 5000,
  marchSpeed: 4.4,
  ...TURRET_SIZE_CLASSES.small,
};

function plan(coreDamage: number, ...later: number[]): TurretPlan {
  return {
    scenarioId: 'test',
    integrity: 100,
    medals: TURRET_SCENARIO_STANDARD.medals,
    arsenal: { shockwave: 2, fragmentation: 3 },
    kinds: [KIND],
    waves: [coreDamage, ...later].map((damage) => ({
      spawns: [0],
      coreDamage: damage,
      gapMinTicks: 16,
      gapMaxTicks: 32,
      barrels: { count: 0, minRadius: 0, maxRadius: 0 },
      arrival: { kind: 'ring' as const },
    })),
    bowling: { ...TURRET_BOWLING, enabled: false },
  };
}

function run(state: TurretDefenseState, toTick: number): TurretEvent[] {
  const out: TurretEvent[] = [];
  for (let t = state.tick + 1; t <= toTick; t++) out.push(...tickTurretDefense(state, t, flat));
  return out;
}

/** A first wave under way with its one monster lying still at (x, z). */
function field(
  coreDamage: number,
  x: number,
  z: number,
): { state: TurretDefenseState; m: TurretMonster } {
  const state = createTurretDefense(plan(coreDamage), { x: 0, z: 0 }, 7, START);
  run(state, START + TURRET_TIMING.introTicks);
  while (state.spawnCursor < 1) {
    state.nextSpawnTick = 0;
    run(state, state.tick + 1);
  }
  state.nextSpawnTick = Number.MAX_SAFE_INTEGER;
  const m = state.monsters[0];
  m.state = 'down';
  m.seg = stillSegment(state.tick, 100000, { x, y: 0, z });
  return { state, m };
}

function hitsOf(events: TurretEvent[], type: 'shockwaveHit' | 'bomblet') {
  return events.flatMap((e) => (e.type === type ? e.hits : []));
}

beforeEach(() => setLanguage('en'));

describe('the turret weapon tooltips', () => {
  // 61 rounds differently for each weapon (18.3 down, 30.5 up), so the rounding is proven too.
  for (const core of [61, 80, 220]) {
    it(`states the Shockwave's hit the engine deals at a ${core} core damage`, () => {
      const { state, m } = field(core, 4, 0);
      const out = startTurretShockwave(state, state.tick, flat);
      expect(out.ok).toBe(true);
      const hit = hitsOf(run(state, state.tick + TURRET_SHOCKWAVE.rollTicks + 5), 'shockwaveHit');
      expect(hit.find((h) => h.id === m.id)?.damage).toBe(turretShockwaveHitDamage(core));
    });

    it(`states a bomblet's hit the engine deals at a ${core} core damage`, () => {
      const { state, m } = field(core, 0, 20);
      const out = fireTurret(state, state.tick, 0, 20, flat, 'frag');
      if (!out.ok) throw new Error('frag refused');
      const hit = hitsOf(run(state, out.shot.impactTick + 12), 'bomblet');
      expect(hit.find((h) => h.id === m.id)?.damage).toBe(turretBombletHitDamage(core));
    });
  }

  it("reads the current wave's core damage, the last wave's after the run", () => {
    const session: TurretSession = {
      kind: 'turret',
      origin: { x: 0, y: 0, z: 0 },
      defense: createTurretDefense(plan(61, 220), { x: 0, z: 0 }, 7, START),
      priorMountKey: '',
      returnTo: { x: 0, y: 0, z: 0, facing: 0 },
      feedback: [],
      nextFeedbackSeq: 1,
    };
    expect(turretWaveCoreDamage(turretSessionView(session))).toBe(61);
    session.defense.wave = 1;
    session.defense.rev++;
    expect(turretWaveCoreDamage(turretSessionView(session))).toBe(220);
    session.defense.wave = 5;
    session.defense.rev++;
    expect(turretWaveCoreDamage(turretSessionView(session))).toBe(220);
  });

  it('writes each weapon from the live content, in the order the player meets it', () => {
    expect(turretWeaponDescription('shock', 61)).toBe(
      [
        `Slam the tower: a ring rolls from its wall out to ${TURRET_SHOCKWAVE.reach} yd in 0.4 sec. Every monster on the ground it reaches is thrown away from the tower, which stops a strike it is still winding up, and takes 18 damage within ${TURRET_SHOCKWAVE.falloffCore} yd of the tower, less beyond. Monsters in the air pass over it.`,
        'Ready again 1.5 sec after use. Works only during a wave.',
      ].join('\n'),
    );
    expect(turretWeaponDescription('frag', 61)).toBe(
      [
        `Arm it, then fire at the ground like a shell. It bursts above the aim point into 6 bomblets: one lands on the point and ${TURRET_FRAGMENTATION.outerCount} land in a ring ${TURRET_FRAGMENTATION.outerRadius} yd around it. Each deals up to 31 damage within ${TURRET_FRAGMENTATION.blastRadius} yd, throws the monsters it hits and lights kegs.`,
        "Uses the cannon's reload. Arming it again, or cancelling, puts it away without spending a charge. Works only during a wave.",
      ].join('\n'),
    );
  });

  it('ends the tooltip with the charges left, escaped', () => {
    const html = turretWeaponTooltip('frag', 61, 2);
    expect(html).toContain('<div class="tt-title">Fragmentation Shell</div>');
    expect(html).toContain('Charges left: 2');
    expect(html).toContain('cannon&#39;s reload');
  });
});

// Morthen's Rite and the Knellwyrm's Burning Knell, the render plan
// (src/render/hollow_crypt/morthen_rite_fx_core.ts): every shape a player
// reads agrees with the sim's own test (the Reap's cone, the Knell's half),
// the telegraphs take the shared threat palette, the candle looks follow the
// sim's candle templates, the ward cracks with the candles, the Grasp's hands
// rise and sink, and the Bound Soul joins the trash engine's walkers in its
// own look. Presentation only: the timings are the sim's.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  BOUND_SOUL_LOOK,
  CANDLE_FLAME_TIP_Y,
  CANDLE_WICK_Y,
  candleIndexAt,
  candleLook,
  candleStateOf,
  chillMist,
  crackGrowth,
  drainMoteRate,
  gorgedFire,
  graspFill,
  graspHandSpots,
  handsRise,
  handsSink,
  igniteFlash,
  inMarkedHalf,
  inReapSweep,
  KNELL_GESTURE_POUR,
  KNELL_GESTURE_SKY_ROAR,
  KNELL_RING,
  KNELL_SCORCH_SEC,
  knellFire,
  knellHalfIndex,
  knellMarkLook,
  knellScorch,
  MORTHEN_TELEGRAPHS,
  pulseCharge,
  REAP_SWEEP_SEC,
  REMEMBRANCE_FIRE_RAMP,
  RITE_LEDGER,
  reapSweep,
  relightFill,
  remembranceRampGlsl,
  soulRise,
  WARD_HEIGHT,
  WARD_RADIUS,
  wardIntegrity,
  wardShards,
} from '../src/render/hollow_crypt/morthen_rite_fx_core';
import {
  engineCatalog,
  walkerHover,
  walkerSize,
  walkerTint,
} from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import {
  BOUND_SOUL_WALKER,
  inKnellHalf,
  KNELL_TUNING,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_LAND,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_RISE,
  knellHalfYaw,
  MORTHEN_SPOT,
  RITE_RING,
} from '../src/sim/encounters/hollow_crypt';
import {
  candleBodySpot,
  MORTHEN_GORGED,
  MORTHEN_SOUL_TEMPLATE,
  MORTHEN_TUNING,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_SPOTS,
} from '../src/sim/encounters/hollow_crypt/morthen_ids';
import { inCone } from '../src/sim/mob/trash_kit/targets';
import type { Entity } from '../src/sim/types';

const T = MORTHEN_TUNING;
const PALETTE = new Set<number>(Object.values(TELEGRAPH_THREAT_COLORS));

describe('the Rite telegraphs', () => {
  it('take the shared threat palette and the sim own sizes', () => {
    for (const spec of Object.values(MORTHEN_TELEGRAPHS))
      expect(PALETTE.has(spec.color)).toBe(true);
    expect(MORTHEN_TELEGRAPHS.pulse.radius).toBe(T.pulseRadius);
    expect(MORTHEN_TELEGRAPHS.pulse.arcDeg).toBe(360);
    expect(MORTHEN_TELEGRAPHS.reap.radius).toBe(T.reapRange);
    expect(MORTHEN_TELEGRAPHS.reap.arcDeg).toBe(T.reapArcDeg);
    expect(MORTHEN_TELEGRAPHS.grasp.radius).toBe(T.graspRadius);
    expect(MORTHEN_TELEGRAPHS.knell.radius).toBe(KNELL_TUNING.reach);
    expect(MORTHEN_TELEGRAPHS.knell.arcDeg).toBe(180);
    // The Reap and the Knell are the killing blows: lethal red.
    expect(MORTHEN_TELEGRAPHS.reap.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(MORTHEN_TELEGRAPHS.knell.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
  });

  it('draws the Reap cone exactly where the sim sweeps', () => {
    const o = { x: 3, y: 0, z: -4 };
    for (const facing of [0, 0.7, Math.PI / 2, 2.4, -2.9, Math.PI]) {
      for (let x = -16; x <= 16; x += 0.75) {
        for (let z = -16; z <= 16; z += 0.75) {
          const p = { x: o.x + x, y: 0, z: o.z + z };
          expect(inReapSweep(x, z, facing), `${facing} ${x} ${z}`).toBe(
            inCone(o, facing, p, T.reapRange, T.reapArcDeg),
          );
        }
      }
    }
  });

  it('sweeps the Reap crescent across the arc once, then lets it fade', () => {
    expect(reapSweep(-0.01)).toBeNull();
    let last = -1;
    for (let t = 0; t <= REAP_SWEEP_SEC; t += 0.02) {
      const p = reapSweep(t);
      expect(p).not.toBeNull();
      expect(p?.head ?? -1).toBeGreaterThanOrEqual(last);
      expect(p?.tail ?? 2).toBeLessThanOrEqual(p?.head ?? -1);
      last = p?.head ?? -1;
    }
    expect(reapSweep(REAP_SWEEP_SEC)?.head).toBeCloseTo(1, 6);
    expect(reapSweep(REAP_SWEEP_SEC * 3)).toBeNull();
  });

  it('charges the Shadow Pulse ring toward its toll', () => {
    expect(pulseCharge(0)).toBeGreaterThan(0.3);
    expect(pulseCharge(1)).toBeCloseTo(1, 9);
    expect(pulseCharge(0.8)).toBeGreaterThan(pulseCharge(0.4));
  });
});

describe('the Burning Knell', () => {
  it('reads its half back off the object facing the sim gives it', () => {
    for (let half = 0; half < 4; half++) expect(knellHalfIndex(knellHalfYaw(half))).toBe(half);
  });

  it('draws the marked half exactly where the sim burns (inKnellHalf)', () => {
    for (let half = 0; half < 4; half++) {
      const yaw = knellHalfYaw(half);
      for (let dx = -36; dx <= 36; dx += 1.5) {
        for (let dz = -36; dz <= 36; dz += 1.5) {
          expect(inMarkedHalf(yaw, dx, dz), `${half} ${dx} ${dz}`).toBe(
            inKnellHalf(half, RITE_RING.x + dx, RITE_RING.z + dz),
          );
        }
      }
    }
    expect(KNELL_RING.reach).toBe(KNELL_TUNING.reach);
  });

  it('brightens its edge and thickens its embers toward the fire', () => {
    expect(knellMarkLook(0.9).edge).toBeGreaterThan(knellMarkLook(0.2).edge);
    expect(knellMarkLook(0.9).embers).toBeGreaterThan(knellMarkLook(0.2).embers);
    expect(knellMarkLook(0).edge).toBeGreaterThan(0.5);
  });

  it('pours its fire for the whole breath, then the scorch fades out', () => {
    expect(knellFire(0.1)).toBe(1);
    expect(knellFire(KNELL_TUNING.breathSeconds)).toBe(1);
    expect(knellFire(KNELL_TUNING.breathSeconds + 0.35)).toBeLessThan(1);
    expect(knellFire(KNELL_TUNING.breathSeconds + 1)).toBe(0);
    expect(knellScorch(1).char).toBeGreaterThan(0.5);
    expect(knellScorch(KNELL_SCORCH_SEC + 0.1)).toEqual({ char: 0, embers: 0 });
  });

  it('plays its aloft beats as one-shots on clips the Knellwyrm ships', () => {
    const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: 'crypt_knellwyrm' } as Entity)];
    const glb = readFileSync('public/models/creatures/woc_crypt_knellwyrm.glb');
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const names = new Set<string>((json.animations ?? []).map((a: { name: string }) => a.name));
    const cast = def.clips.castByAbility ?? {};
    expect(cast[KNELLWYRM_KNELL_RISE]).toBe('TakeWing');
    expect(cast[KNELLWYRM_KNELL_MARK]).toBe('SkyRoar');
    expect(cast[KNELLWYRM_KNELL_BREATH]).toBe('Strafe');
    expect(cast[KNELLWYRM_KNELL_LAND]).toBe('Glide');
    const attack = def.clips.attackByAbility ?? {};
    expect(attack[KNELL_GESTURE_SKY_ROAR]).toBe('SkyRoar');
    expect(attack[KNELL_GESTURE_POUR]).toBe('Strafe');
    for (const clip of [
      cast[KNELLWYRM_KNELL_RISE],
      cast[KNELLWYRM_KNELL_MARK],
      cast[KNELLWYRM_KNELL_BREATH],
      cast[KNELLWYRM_KNELL_LAND],
      attack[KNELL_GESTURE_SKY_ROAR],
      attack[KNELL_GESTURE_POUR],
    ])
      expect(names.has(clip), clip).toBe(true);
  });
});

describe('the Remembrance Candles', () => {
  it('reads each candle state off its object template', () => {
    expect(candleStateOf(RITE_CANDLE_DARK)).toBe('dark');
    expect(candleStateOf(RITE_CANDLE_NAMED)).toBe('named');
    expect(candleStateOf(RITE_CANDLE_LIT)).toBe('lit');
    expect(candleStateOf(null)).toBe('default');
    expect(candleStateOf('crypt_knell_pyre')).toBe('default');
  });

  it('snuffs a dark candle but keeps it findable, guides the named one, lights the relit one', () => {
    const def = candleLook('default', 0);
    expect(def.decorFlame).toBe(true);
    expect(def.light).toBe(1);
    for (const state of ['dark', 'named'] as const) {
      const l = candleLook(state, 1.3);
      expect(l.decorFlame).toBe(false);
      expect(l.light).toBeLessThan(0.3);
      expect(l.ember).toBeGreaterThan(0.3);
      expect(l.smoke).toBeGreaterThan(0);
      expect(l.column).toBe(0);
    }
    // The Ledger's guide never fades below a readable floor.
    for (let t = 0; t < 4; t += 0.05) expect(candleLook('named', t).guide).toBeGreaterThan(0.4);
    expect(candleLook('dark', 1).guide).toBe(0);
    const lit = candleLook('lit', 0);
    expect(lit.decorFlame).toBe(true);
    expect(lit.light).toBeGreaterThan(def.light);
    expect(lit.column).toBe(1);
    expect(lit.flame).toBe(1);
  });

  it('knows each candle by its spot, and each relight body by its candle', () => {
    for (let i = 0; i < RITE_CANDLE_SPOTS.length; i++) {
      const c = RITE_CANDLE_SPOTS[i];
      expect(candleIndexAt(c.x, c.z)).toBe(i);
      const b = candleBodySpot(i);
      expect(candleIndexAt(b.x, b.z)).toBe(i);
    }
    expect(candleIndexAt(RITE_RING.x, RITE_RING.z)).toBe(-1);
    expect(CANDLE_FLAME_TIP_Y).toBeGreaterThan(CANDLE_WICK_Y);
  });

  it('puts the Ledger on the altar lectern, toward the ring', () => {
    const altar = HOLLOW_CRYPT_FIELD.props.find((p) => p.kind === 'hc_rite_altar');
    expect(altar).toBeDefined();
    if (!altar) return;
    expect(Math.hypot(RITE_LEDGER.x - altar.x, RITE_LEDGER.z - altar.z)).toBeLessThan(2);
    expect(RITE_LEDGER.y).toBeGreaterThan(1.4);
    expect(RITE_LEDGER.y).toBeLessThan(2.4);
  });

  it('swells the relight with its bar and prices it in drawn motes', () => {
    expect(relightFill(4, 4)).toBe(0);
    expect(relightFill(1, 4)).toBeCloseTo(0.75, 9);
    expect(relightFill(0, 0)).toBe(0);
    expect(drainMoteRate(1)).toBeGreaterThan(drainMoteRate(0));
    expect(igniteFlash(0.08)).toBeCloseTo(1, 6);
    expect(igniteFlash(2)).toBe(0);
  });

  it('burns the relit candles in warm holy fire, never his green', () => {
    for (const [, r, g, b] of REMEMBRANCE_FIRE_RAMP) {
      expect(r).toBeGreaterThanOrEqual(g);
      expect(r).toBeGreaterThanOrEqual(b);
    }
    expect(remembranceRampGlsl()).toContain('vec3 ghostRamp(float h)');
  });
});

describe('the Unquiet Ward', () => {
  it('cracks with every candle relit and is gone with the fourth', () => {
    expect([0, 1, 2, 3, 4].map(wardIntegrity)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(crackGrowth(0)).toBe(0);
    expect(crackGrowth(10)).toBe(1);
    expect(crackGrowth(0.3)).toBeGreaterThan(crackGrowth(0.1));
  });

  it('holds his whole drawn body over the altar', () => {
    const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: 'morthen' } as Entity)];
    const crown = (def.height + (def.hover ?? 0)) * 1.35;
    expect(WARD_HEIGHT).toBeGreaterThan(crown + 1);
    expect(WARD_RADIUS).toBeGreaterThan(4);
    expect(Math.hypot(MORTHEN_SPOT.x - RITE_RING.x, MORTHEN_SPOT.z - RITE_RING.z)).toBeLessThan(
      RITE_RING.r - WARD_RADIUS,
    );
  });

  it('flings its shards outward from the dome, deterministically', () => {
    const a = wardShards(40);
    expect(a).toEqual(wardShards(40));
    for (const s of a) {
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
      expect(s.y).toBeGreaterThan(0);
      expect(s.speed).toBeGreaterThan(5);
    }
  });

  it('keeps Grave Chill a light mist', () => {
    expect(chillMist(0)).toBe(0);
    expect(chillMist(T.chillBase)).toBeGreaterThan(0);
    expect(chillMist(99)).toBeLessThanOrEqual(1);
  });
});

describe('Grasp of the Grave', () => {
  it('fills the ring over the fuse, then the hands claw up and later sink', () => {
    expect(graspFill(0)).toBe(0);
    expect(graspFill(T.graspFuse)).toBe(1);
    expect(handsRise(0)).toBe(0);
    expect(handsRise(0.18)).toBeGreaterThan(1);
    expect(handsRise(2)).toBeCloseTo(1, 9);
    expect(handsSink(0)).toBe(1);
    expect(handsSink(10)).toBe(0);
  });

  it('stands its hands inside the ring, each turned toward its centre', () => {
    for (const s of graspHandSpots(7)) {
      expect(Math.hypot(s.x, s.z)).toBeLessThan(0.95);
      // Facing the centre: the yaw's forward points back at the origin.
      expect(Math.sin(s.yaw) * -s.x + Math.cos(s.yaw) * -s.z).toBeGreaterThan(0);
    }
  });
});

describe('the Bound Souls', () => {
  it('fly as trash engine walkers in their own big soul-green look', () => {
    const c = engineCatalog();
    expect(c.walkers.get(MORTHEN_SOUL_TEMPLATE)).toBe(BOUND_SOUL_WALKER);
    // No launch bar to gather on and no fight-long glow: the encounter's.
    expect(c.walkerCasts.has(BOUND_SOUL_WALKER.castId)).toBe(false);
    expect(c.empowerAuras.has(MORTHEN_GORGED)).toBe(false);
    expect(walkerTint(BOUND_SOUL_WALKER)).toBe(BOUND_SOUL_LOOK.tint);
    expect(walkerHover(BOUND_SOUL_WALKER)).toBe(BOUND_SOUL_LOOK.hover);
    expect(walkerSize(BOUND_SOUL_WALKER)).toBeGreaterThan(1.5);
  });

  it('tears out of its alcove in a column that fades, and deepens his fire per stack', () => {
    expect(soulRise(0.12)).toBeCloseTo(1, 6);
    expect(soulRise(2)).toBe(0);
    expect(gorgedFire(0)).toBe(1);
    expect(gorgedFire(3)).toBeGreaterThan(gorgedFire(1));
    expect(gorgedFire(99)).toBe(gorgedFire(T.gorgedMaxStacks));
  });
});

describe('the Remembrance Candle body', () => {
  it('draws no body (the pillar is the kit), keeps a wide click capsule at candle height', () => {
    const key = visualKeyFor({
      kind: 'mob',
      templateId: 'crypt_remembrance_candle',
    } as Parameters<typeof visualKeyFor>[0]);
    expect(key).toBe('crypt_rite_candle_body');
    expect(VISUALS[key].bodyless).toBe(true);
    expect(VISUALS[key].clickRadius ?? 0).toBeGreaterThanOrEqual(2);
    expect(VISUALS[key].height).toBeGreaterThanOrEqual(3);
  });
});

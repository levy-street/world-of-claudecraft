// The fog scene's crossfade, pure half (src/render/fog_scene_fade_core.ts):
// which settles fade (only between the Smith's Heart's rooms), how long (a
// second, the owner's ask of 2026-11-19), the blend of the look and of the key
// light's direction, and the fade's own clock.

import { describe, expect, it } from 'vitest';
import {
  beginSceneFade,
  blendKeyDirectionInto,
  blendSceneLookInto,
  cancelSceneFade,
  type FadeVec3,
  fogSceneFadeSeconds,
  newSceneFade,
  newSceneLook,
  type SceneLook,
  SMITH_HEART_ROOM_FADE_SECONDS,
  sceneFadeEase,
  sceneFadeProgress,
  stepSceneFade,
} from '../src/render/fog_scene_fade_core';
import { resolveFogScene } from '../src/render/fog_scene_state';
import {
  SMITH_HEART_BREATH_LIGHT,
  SMITH_HEART_CORE_LIGHT,
  SMITH_HEART_HAMMER_LIGHT,
  SMITH_HEART_HEAT_LIGHT,
  SMITH_HEART_KEY_DIRECTION,
  SMITH_HEART_QUENCH_LIGHT,
  SMITH_HEART_RING_LIGHT,
} from '../src/render/smith_heart/heart_environment';
import { BREATH, HAMMER_PIT, HEART_ROOM, QUENCH } from '../src/sim/content/smith_heart_layout';
import { DUNGEON_LIST, instanceOrigin } from '../src/sim/data';

const SEED = 1;

/** Every number a look holds, in one fixed order. */
function flat(look: SceneLook): number[] {
  return [
    look.fog.r,
    look.fog.g,
    look.fog.b,
    look.fogNear,
    look.fogFar,
    look.sun.r,
    look.sun.g,
    look.sun.b,
    look.sunIntensity,
    look.hemiSky.r,
    look.hemiSky.g,
    look.hemiSky.b,
    look.hemiGround.r,
    look.hemiGround.g,
    look.hemiGround.b,
    look.hemiIntensity,
    look.envIntensity,
    look.rim,
    look.rimColor.r,
    look.rimColor.g,
    look.rimColor.b,
  ];
}

/** A look whose every number differs from every other's (and from any other
 *  base's), so a field dropped or crossed in the blend cannot hide. */
function lookOf(base: number): SceneLook {
  const look = newSceneLook();
  let i = 0;
  const next = () => base + 0.01 * i++;
  [look.fog.r, look.fog.g, look.fog.b] = [next(), next(), next()];
  look.fogNear = next();
  look.fogFar = next();
  [look.sun.r, look.sun.g, look.sun.b] = [next(), next(), next()];
  look.sunIntensity = next();
  [look.hemiSky.r, look.hemiSky.g, look.hemiSky.b] = [next(), next(), next()];
  [look.hemiGround.r, look.hemiGround.g, look.hemiGround.b] = [next(), next(), next()];
  look.hemiIntensity = next();
  look.envIntensity = next();
  look.rim = next();
  [look.rimColor.r, look.rimColor.g, look.rimColor.b] = [next(), next(), next()];
  return look;
}

function unit(v: readonly [number, number, number]): FadeVec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return { x: v[0] / l, y: v[1] / l, z: v[2] / l };
}

function angle(a: FadeVec3, b: FadeVec3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z)));
}

describe('fogSceneFadeSeconds', () => {
  it('fades a settle between two of the Smith Heart rooms for one second', () => {
    expect(SMITH_HEART_ROOM_FADE_SECONDS).toBe(1);
    expect(fogSceneFadeSeconds('smith_heart', 'smith_heart')).toBe(1);
  });

  it('lands every other settle at once, as before: the way in, the way out, other interiors', () => {
    for (const [from, to] of [
      [null, 'smith_heart'],
      [undefined, 'smith_heart'],
      ['smith_heart', null],
      ['smith_heart', undefined],
      ['smith_heart', 'sunken_bastion'],
      ['sunken_bastion', 'smith_heart'],
      ['sunken_bastion', 'sunken_bastion'],
      ['nythraxis', 'nythraxis'],
      [null, null],
    ] as const) {
      expect(fogSceneFadeSeconds(from, to), `${from} to ${to}`).toBe(0);
    }
  });

  it('fades every walk between the raid rooms the renderer actually resolves, never the way in', () => {
    const heart = DUNGEON_LIST.find((d) => d.id === 'smith_heart');
    if (!heart) throw new Error('no smith_heart dungeon');
    const o = instanceOrigin(heart.index, 0);
    const at = (x: number, z: number) =>
      resolveFogScene(true, o.x, 5, { x: o.x + x, z: o.z + z }, SEED);
    const rooms = [
      at(HEART_ROOM.x, HEART_ROOM.z),
      at(0, 70),
      at(HAMMER_PIT.x, HAMMER_PIT.z),
      at(BREATH.cornice.x, BREATH.cornice.z),
      at(QUENCH.lake.x, QUENCH.lake.z),
      at(-150, 20),
    ];
    // Six rooms, six lights: every pair is a real settle.
    expect(rooms.map((r) => r.desired)).toEqual([
      'smithHeartCore',
      'smithHeartRing',
      'smithHeartHammer',
      'smithHeartBreath',
      'smithHeartQuench',
      'smithHeartHeat',
    ]);
    for (const a of rooms) {
      for (const b of rooms) {
        if (a === b) continue;
        expect(fogSceneFadeSeconds(a.interior, b.interior), `${a.desired} to ${b.desired}`).toBe(1);
      }
    }
    // The overworld outside (a camera well above any water): stepping in or
    // out of the raid cuts.
    const outside = resolveFogScene(false, 0, 400, { x: 0, z: 0 }, SEED);
    expect(outside.desired).toBe('outdoor');
    expect(fogSceneFadeSeconds(outside.interior, rooms[1].interior)).toBe(0);
    expect(fogSceneFadeSeconds(rooms[1].interior, outside.interior)).toBe(0);
  });
});

describe('sceneFadeEase', () => {
  it('runs 0 to 1 as a smoothstep, clamped, leaving and arriving gently', () => {
    expect(sceneFadeEase(0)).toBe(0);
    expect(sceneFadeEase(1)).toBe(1);
    expect(sceneFadeEase(0.5)).toBe(0.5);
    expect(sceneFadeEase(-2)).toBe(0);
    expect(sceneFadeEase(3)).toBe(1);
    // The smoothstep itself, not just its shape (a smootherstep or a sine
    // ease would pass every shape check).
    expect(sceneFadeEase(0.25)).toBe(0.15625);
    expect(sceneFadeEase(0.75)).toBe(0.84375);
    expect(sceneFadeEase(0.25)).toBeLessThan(0.25);
    expect(sceneFadeEase(0.75)).toBeGreaterThan(0.75);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const k = sceneFadeEase(t);
      expect(k).toBeGreaterThan(last);
      last = k;
    }
  });
});

describe('blendSceneLookInto', () => {
  const a = lookOf(0.1);
  const b = lookOf(0.7);

  it('carries every number of the look, each from its own field', () => {
    const fa = flat(a);
    const fb = flat(b);
    // Every field differs from every other in both looks, so a dropped or
    // crossed field shows.
    expect(new Set([...fa, ...fb]).size).toBe(fa.length + fb.length);
    const out = newSceneLook();
    expect(flat(blendSceneLookInto(out, a, b, 0))).toEqual(fa);
    expect(flat(blendSceneLookInto(out, a, b, 1))).toEqual(fb);
    const quarter = flat(blendSceneLookInto(out, a, b, 0.25));
    quarter.forEach((v, i) => {
      expect(v).toBeCloseTo(fa[i] + (fb[i] - fa[i]) * 0.25, 12);
    });
  });

  it('ends on exact copies, past either end too, so a finished fade leaves the preset as authored', () => {
    const out = newSceneLook();
    expect(flat(blendSceneLookInto(out, a, b, 1.7))).toEqual(flat(b));
    expect(flat(blendSceneLookInto(out, a, b, -0.3))).toEqual(flat(a));
  });

  it('may write into either of its own inputs', () => {
    const expected = flat(blendSceneLookInto(newSceneLook(), a, b, 0.4));
    const into = lookOf(0.1);
    blendSceneLookInto(into, into, b, 0.4);
    flat(into).forEach((v, i) => {
      expect(v).toBeCloseTo(expected[i], 12);
    });
  });
});

describe('blendKeyDirectionInto', () => {
  // Two keys a quarter turn apart (every raid room now shares one sun, so the
  // turn is exercised on keys of its own).
  const ring = unit([0.32, 0.6, 0.73]);
  const quench = unit([0.56, 0.56, -0.6]);

  it('starts on the old key, ends exactly on the new one, and turns evenly between', () => {
    const out = { x: 0, y: 0, z: 0 };
    blendKeyDirectionInto(out, ring, quench, 0);
    expect(out.x).toBeCloseTo(ring.x, 12);
    expect(out.y).toBeCloseTo(ring.y, 12);
    expect(out.z).toBeCloseTo(ring.z, 12);
    expect(blendKeyDirectionInto(out, ring, quench, 1)).toEqual(quench);
    blendKeyDirectionInto(out, ring, quench, 0.5);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
    expect(angle(ring, out)).toBeCloseTo(angle(out, quench), 12);
    expect(angle(ring, out)).toBeGreaterThan(0.1);
  });

  it('may write into its target (the renderer turns its own light direction in place)', () => {
    const expected = blendKeyDirectionInto({ x: 0, y: 0, z: 0 }, ring, quench, 0.3);
    const dir = { ...quench };
    blendKeyDirectionInto(dir, ring, dir, 0.3);
    expect(dir.x).toBeCloseTo(expected.x, 12);
    expect(dir.y).toBeCloseTo(expected.y, 12);
    expect(dir.z).toBeCloseTo(expected.z, 12);
  });

  it('takes the target at once when the two point opposite ways (no way round)', () => {
    const up = { x: 0, y: 1, z: 0 };
    const down = { x: 0, y: -1, z: 0 };
    expect(blendKeyDirectionInto({ x: 0, y: 0, z: 0 }, up, down, 0.5)).toEqual(down);
  });
});

describe('the raid sun', () => {
  it('lights every raid room from one sun, so walking between them never moves a shadow', () => {
    // The owner's call of 2026-11-19: the light changes between rooms, never
    // the shadows' direction. Every room's rig reads the one constant.
    for (const light of [
      SMITH_HEART_CORE_LIGHT,
      SMITH_HEART_HAMMER_LIGHT,
      SMITH_HEART_RING_LIGHT,
      SMITH_HEART_BREATH_LIGHT,
      SMITH_HEART_QUENCH_LIGHT,
      SMITH_HEART_HEAT_LIGHT,
    ]) {
      expect(light.keyDirection).toBe(SMITH_HEART_KEY_DIRECTION);
    }
    // Low in the south-east (the Quench's and the Heat's own angle), well
    // above the floor so no shadow is thrown up a wall.
    const sun = unit(SMITH_HEART_KEY_DIRECTION);
    expect(sun.x).toBeGreaterThan(0.3);
    expect(sun.z).toBeLessThan(-0.3);
    expect(sun.y).toBeGreaterThan(0.5);
  });
});

describe('the fade clock', () => {
  it('runs one second from a settle between rooms, then stops', () => {
    const fade = newSceneFade();
    // The first settle into the raid comes from no interior: it lands at once.
    expect(beginSceneFade(fade, 'smith_heart')).toBe(0);
    expect(fade.seconds).toBe(0);
    expect(sceneFadeProgress(fade)).toBe(1);
    // A walk into the next room fades.
    expect(beginSceneFade(fade, 'smith_heart')).toBe(1);
    expect(sceneFadeProgress(fade)).toBe(0);
    expect(stepSceneFade(fade, 0.25)).toBeCloseTo(0.15625, 12);
    expect(stepSceneFade(fade, 0.25)).toBeCloseTo(0.5, 12);
    // A backwards or empty frame never runs the clock back.
    expect(stepSceneFade(fade, -1)).toBeCloseTo(0.5, 12);
    expect(stepSceneFade(fade, 0)).toBeCloseTo(0.5, 12);
    expect(fade.seconds).toBe(1);
    expect(stepSceneFade(fade, 0.6)).toBe(1);
    expect(fade.seconds).toBe(0);
    // Done: further frames change nothing.
    expect(stepSceneFade(fade, 0.1)).toBe(1);
    expect(fade.seconds).toBe(0);
  });

  it('starts over from the top when another room settles mid-fade', () => {
    const fade = newSceneFade();
    beginSceneFade(fade, 'smith_heart');
    beginSceneFade(fade, 'smith_heart');
    stepSceneFade(fade, 0.7);
    expect(beginSceneFade(fade, 'smith_heart')).toBe(1);
    expect(fade.elapsed).toBe(0);
    expect(sceneFadeProgress(fade)).toBe(0);
  });

  it('finishes at once on a long frame (a tab coming back)', () => {
    const fade = newSceneFade();
    beginSceneFade(fade, 'smith_heart');
    beginSceneFade(fade, 'smith_heart');
    expect(stepSceneFade(fade, 5)).toBe(1);
    expect(fade.seconds).toBe(0);
  });

  it('stops a running fade when the raid is left, and the way back in lands at once', () => {
    const fade = newSceneFade();
    beginSceneFade(fade, 'smith_heart');
    beginSceneFade(fade, 'smith_heart');
    stepSceneFade(fade, 0.3);
    expect(beginSceneFade(fade, null)).toBe(0);
    expect(fade.seconds).toBe(0);
    expect(fade.interior).toBe(null);
    expect(beginSceneFade(fade, 'smith_heart')).toBe(0);
  });

  it('forgets the raid on a cancel (the rift rig), so the next settle lands at once', () => {
    const fade = newSceneFade();
    beginSceneFade(fade, 'smith_heart');
    beginSceneFade(fade, 'smith_heart');
    cancelSceneFade(fade);
    expect(fade.seconds).toBe(0);
    expect(fade.interior).toBe(null);
    expect(beginSceneFade(fade, 'smith_heart')).toBe(0);
  });
});

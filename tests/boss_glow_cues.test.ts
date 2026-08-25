// The two glows that live ON the boss's model: the permanently lit eye
// (src/render/characters/eye_glow_core.ts) and the charging fists
// (src/render/characters/charge_glow_core.ts).
//
// These replaced ground-painted indicators, and that is what makes them worth pinning: a
// coloured disc under a boss is unmissable and a glow on his body is not, so every one of
// these has a failure mode that renders a perfectly plausible frame with the cue silently
// absent. Two of them actually happened while this was being built, and both are pinned
// below by name: a mote size expressed in the wrong space (invisible, sub-pixel) and an eye
// core bright enough to blow its own colour out to white.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ChargeGlowSpec,
  chargeGlowIntensity,
  moteWorldSize,
} from '../src/render/characters/charge_glow_core';
import {
  EYE_GLOW_ASLEEP,
  type EyeGlowSpec,
  eyeGlowIntensity,
} from '../src/render/characters/eye_glow_core';
import { VISUALS } from '../src/render/characters/manifest';

const BALGATH_KEY = 'mob_balgath_cyclops';
/** The scale chain a manifest radius passes through before it is a world length. */
const BALGATH_RIG_SCALE = 16.17;

const eyeSpec = (): EyeGlowSpec => {
  const s = VISUALS[BALGATH_KEY]?.eyeGlow;
  if (!s) throw new Error(`${BALGATH_KEY} declares no eyeGlow`);
  return s;
};

describe('the eye is never out', () => {
  it('is declared on the world boss, on his head bone', () => {
    expect(eyeSpec().bone).toBe('Head');
    expect(eyeSpec().offset).toHaveLength(3);
  });

  it('never goes dark at any point in its cycle', () => {
    // The contract, and the reason the floor is not zero: this is what the creature IS, not
    // something he is doing. A cycle that touches zero reads as a light being switched, and
    // a raider a hundred yards out loses the only coloured thing on a grey silhouette.
    const s = eyeSpec();
    for (let t = 0; t < 12; t += 0.013) {
      const k = eyeGlowIntensity(s, t);
      expect(k).toBeGreaterThan(0.5);
      expect(k).toBeLessThanOrEqual(1);
    }
  });

  it('actually breathes, sampled a QUARTER period apart', () => {
    // Half a period from t=0 samples the sine's two zero crossings, which are identical and
    // would pass over a completely static glow.
    const s = eyeSpec();
    const a = eyeGlowIntensity(s, 0);
    const b = eyeGlowIntensity(s, 1 / (s.pulseHz * 4));
    expect(a).not.toBeCloseTo(b, 3);
  });

  it('smoulders through a shut lid while he sleeps: dim, steady, never out', () => {
    // A sleeping cyclops with a blazing eye reads as awake, and a dark socket reads as a
    // corpse. The ember is the one identifying light he keeps in bed, and it does not
    // breathe: a pulsing glow on a sleeping face is the awake cue again.
    const s = eyeSpec();
    const asleep = [0, 0.37, 1 / (s.pulseHz * 4), 5].map((t) =>
      eyeGlowIntensity(s, t, false, true),
    );
    for (const k of asleep) {
      expect(k).toBe(EYE_GLOW_ASLEEP);
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThan(0.5);
    }
    // Reduced motion never brightens a sleeper either.
    expect(eyeGlowIntensity(s, 1, true, true)).toBe(EYE_GLOW_ASLEEP);
  });

  it('holds steady under reduced motion instead of switching off', () => {
    const s = eyeSpec();
    expect(eyeGlowIntensity(s, 0, true)).toBe(eyeGlowIntensity(s, 7.77, true));
    expect(eyeGlowIntensity(s, 0, true)).toBeGreaterThan(0.5);
  });

  it('breathes slowly enough to read as a pilot light, not a strobe', () => {
    expect(eyeSpec().pulseHz).toBeLessThan(1);
  });

  it('stays small enough that the socket does not blow out to white', () => {
    // The first cut was 0.026 bone-local, which is a 0.84 yard ball at his 4.2x spawn scale:
    // additive over an already-emissive eye texture, the core saturated and the one colour
    // the encounter is named for stopped reading as a colour at all. Measured back down.
    const worldDiameter = eyeSpec().radius * 2 * BALGATH_RIG_SCALE;
    expect(worldDiameter).toBeLessThan(0.7);
    expect(worldDiameter, 'an eye nobody can see from range is not the point').toBeGreaterThan(
      0.35,
    );
  });
});

describe('the charging fists', () => {
  const spec = (ability: string): ChargeGlowSpec => {
    const s = VISUALS[BALGATH_KEY]?.clips.chargeGlowByAbility?.[ability];
    if (!s) throw new Error(`no chargeGlow declared for ${ability}`);
    return s;
  };

  it('lights one fist for the aimed hammer and both for the ground slams', () => {
    // The read the cue exists for: one fist means the hammer is coming down on somebody,
    // both means the ground is. If they ever agree, the cue stops carrying information.
    expect(spec('mob_balgath_hammer').hand).toBe('r');
    expect(spec('mob_pulse_windup').hand).toBe('both');
    expect(spec('mob_warpath_wreck').hand).toBe('both');
  });

  it('sizes each mote in WORLD units, through the rig scale', () => {
    // The bug this pins, in full: PointsMaterial.size under sizeAttenuation is a world
    // length, and three's point shader never consults the object's world matrix. A radius
    // left in bone-local units came out 16x too small, so the shell drew at well under one
    // pixel. Every observable (the points exist, they are visible, they are coloured, they
    // orbit correctly) reported healthy, and the fist simply did not glow.
    const r = spec('mob_balgath_hammer').radius;
    expect(moteWorldSize(r, 1)).toBeCloseTo(r * 0.85, 6);
    expect(moteWorldSize(r, BALGATH_RIG_SCALE)).toBeCloseTo(r * 0.85 * BALGATH_RIG_SCALE, 6);
    // ...and the result has to be big enough to survive perspective attenuation at the range
    // the mechanic is read from. Under ~0.2 yards it is sub-pixel past melee.
    expect(moteWorldSize(r, BALGATH_RIG_SCALE)).toBeGreaterThan(0.25);
  });

  it('refuses to collapse on a bone whose scale has not resolved yet', () => {
    // A bone read before its first pose can hand back a zero scale; falling back to 1 draws
    // a too-small mote for one frame, while multiplying through would draw nothing ever.
    const r = spec('mob_balgath_hammer').radius;
    expect(moteWorldSize(r, 0)).toBe(moteWorldSize(r, 1));
    expect(moteWorldSize(r, -3)).toBe(moteWorldSize(r, 1));
  });

  it('outlasts nothing and is gone by the time the blow lands', () => {
    for (const ability of ['mob_balgath_hammer', 'mob_balgath_cleave']) {
      const s = spec(ability);
      expect(chargeGlowIntensity(s, -0.1)).toBe(0);
      expect(chargeGlowIntensity(s, s.seconds)).toBe(0);
      expect(chargeGlowIntensity(s, s.rise)).toBeGreaterThan(0.9);
    }
  });
});

describe('a landed slam is FELT', () => {
  it('hands every impact its own world position', () => {
    // The shake weighs trauma by how far the CAMERA is from the impact, so an impact that
    // forgets to say where it landed scores zero and the boss's heaviest blows land in
    // total silence. This happened: two shipped call sites kept passing trauma alone while
    // the signature grew a position with a default of (0, 0), and the falloff dutifully
    // measured the distance to the corner of the world. Nothing else shows it, because the
    // dust, the crater and the ring all fire normally.
    const src = readFileSync('src/render/balgath_fx.ts', 'utf8');
    const calls = [...src.matchAll(/impactFelt\(([^)]*)\)/g)].map((m) => m[1]);
    // The declaration plus every call site.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const args of calls) {
      expect(args.split(',').length, `impactFelt(${args}) is missing its position`).toBe(3);
    }
    // ...and no default that could let a new caller omit it again.
    expect(src).not.toMatch(/impactFelt\(trauma: number, x = 0/);
  });
});

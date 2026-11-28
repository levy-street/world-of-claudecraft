// The Guardian of the Quench's round-2 look as numbers (quench_wake_core.ts,
// quench_breath_core.ts, quench_strike_core.ts): the Blades Wake's beam and
// its throw-down, Quenching Breath's blast thin at her and thick down the
// cone in a palette that reads ice blue under the Quench grade, Tempering
// Strike's wind-up a second ahead of the cleave and the cracks its slam opens.

import { describe, expect, it } from 'vitest';
import {
  QUENCH_BODY_CLIP,
  QUENCH_MODEL_UNITS,
  QUENCH_YD_PER_UNIT,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  QUENCH_BREATH_BLAST_SECONDS,
  QUENCH_BREATH_COLORS,
  QUENCH_BREATH_STREAK,
  quenchBreathBlast,
  quenchBreathMistAt,
  quenchBreathStreakFade,
} from '../src/render/smith_heart_fx/quench_breath_core';
import {
  QUENCH_STRIKE_CRACKS,
  QUENCH_STRIKE_WIND,
  QUENCH_STRIKE_WIND_OWNS,
  quenchStrikeCrackLook,
  quenchStrikeWindLook,
} from '../src/render/smith_heart_fx/quench_strike_core';
import {
  QUENCH_WAKE_COLORS,
  QUENCH_WAKE_COLUMN,
  QUENCH_WAKE_THROW,
  QUENCH_WAKE_THROW_SECONDS,
  quenchWakeColumnLook,
  quenchWakeCrystal,
  quenchWakeFlare,
  quenchWakeFrontAt,
  quenchWakeHeadAt,
  quenchWakeLine,
  quenchWakeLineSpikes,
  quenchWakeRingSpikes,
  quenchWakeSpikeDone,
  quenchWakeSpikeRise,
  quenchWakeWave,
} from '../src/render/smith_heart_fx/quench_wake_core';
import { QUENCH_TUNING as T } from '../src/sim/encounters/smith_heart/quench_ids';

const lum = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('the Blades Wake: the beam', () => {
  it('climbs and burns with the bar, nothing before it', () => {
    expect(quenchWakeColumnLook(0, 0).shell).toBe(0);
    const early = quenchWakeColumnLook(0.2, 0);
    const full = quenchWakeColumnLook(1, 0);
    expect(full.rise).toBeGreaterThan(early.rise);
    expect(full.core).toBeGreaterThan(early.core);
    expect(full.shell).toBeCloseTo(1, 5);
    expect(full.rise).toBeGreaterThanOrEqual(1);
    expect(full.foot).toBeGreaterThan(0.8);
  });

  it('is a dark shell round her and a bright core over her crown', () => {
    // The shell stands dark against the white lake; the core is a bright cyan.
    expect(lum(QUENCH_WAKE_COLORS.deep)).toBeLessThan(0.08);
    expect(lum(QUENCH_WAKE_COLORS.core)).toBeGreaterThan(lum(QUENCH_WAKE_COLORS.deep) * 8);
    expect(QUENCH_WAKE_COLORS.core[2]).toBeGreaterThan(QUENCH_WAKE_COLORS.core[0] * 3);
    // Round her (wider than her gown), the core starting over her crown.
    expect(QUENCH_WAKE_COLUMN.shellR0).toBeGreaterThan(4);
    // (never drawn through her translucent gown and body).
    expect(QUENCH_WAKE_COLUMN.coreFrom).toBeGreaterThan(
      0.95 * QUENCH_MODEL_UNITS * QUENCH_YD_PER_UNIT,
    );
  });
});

describe('the Blades Wake: the throw', () => {
  it('races the lines out, holds them, lets them go', () => {
    expect(quenchWakeLine(-0.1).alpha).toBe(0);
    expect(quenchWakeLine(QUENCH_WAKE_THROW.lineRun).head).toBeCloseTo(1, 5);
    expect(quenchWakeLine(QUENCH_WAKE_THROW.lineRun + 0.5).alpha).toBe(1);
    expect(quenchWakeLine(QUENCH_WAKE_THROW_SECONDS + 0.01).alpha).toBe(0);
    // The head's own glow is strongest while it runs.
    expect(quenchWakeLine(0.2).glow).toBe(1);
    expect(quenchWakeLine(2).glow).toBe(0);
  });

  it('sprouts crystals as the head passes, each blade flaring as its line arrives', () => {
    for (const k of [0.1, 0.5, 0.9]) {
      const at = quenchWakeHeadAt(k);
      expect(quenchWakeLine(at).head).toBeCloseTo(k, 5);
      expect(quenchWakeCrystal(at - 0.01, at)).toBe(0);
      expect(quenchWakeCrystal(at + 0.3, at)).toBeGreaterThan(0.9);
    }
    expect(quenchWakeFlare(0)).toBe(0);
    expect(quenchWakeFlare(QUENCH_WAKE_THROW.lineRun)).toBe(1);
    expect(quenchWakeFlare(QUENCH_WAKE_THROW.lineRun + QUENCH_WAKE_THROW.flareLife)).toBe(0);
  });

  it('raises spikes behind the front, holds them, sinks them once', () => {
    const at = quenchWakeFrontAt(16);
    expect(at).toBeCloseTo(16 / QUENCH_WAKE_THROW.waveSpeed, 9);
    expect(quenchWakeSpikeRise(at - 0.01, at)).toBe(0);
    expect(quenchWakeSpikeRise(at + QUENCH_WAKE_THROW.spikeRise, at)).toBe(1);
    expect(quenchWakeSpikeRise(at + 0.5, at)).toBe(1);
    expect(quenchWakeSpikeDone(at + 0.5, at)).toBe(false);
    const gone =
      at + QUENCH_WAKE_THROW.spikeRise + QUENCH_WAKE_THROW.spikeHold + QUENCH_WAKE_THROW.spikeSink;
    expect(quenchWakeSpikeRise(gone, at)).toBe(0);
    expect(quenchWakeSpikeDone(gone, at)).toBe(true);
    const w = quenchWakeWave(at, 32);
    expect(w.radius).toBeCloseTo(16, 5);
    expect(w.alpha).toBe(1);
    expect(quenchWakeWave(10, 32).alpha).toBe(0);
  });

  it('lays its spikes the same every time, clear of her gown, inside the lake', () => {
    const a = quenchWakeRingSpikes(7);
    expect(a).toEqual(quenchWakeRingSpikes(7));
    expect(a.length).toBe(QUENCH_WAKE_THROW.ringSpikes);
    for (const s of a) {
      expect(s.r).toBeGreaterThan(5);
      expect(s.r).toBeLessThan(16);
      expect(s.h).toBeGreaterThan(1);
    }
    const out = Array.from({ length: QUENCH_WAKE_THROW.lineSpikes }, () => ({
      r: 0,
      side: 0,
      h: 0,
      lean: 0,
      yaw: 0,
    }));
    const n = quenchWakeLineSpikes(20, 3, out);
    expect(n).toBe(QUENCH_WAKE_THROW.lineSpikes);
    for (const s of out) {
      expect(s.r).toBeGreaterThan(4);
      expect(s.r).toBeLessThan(18);
      // Beside the line, never on it.
      expect(Math.abs(s.side)).toBeGreaterThan(1.4);
    }
  });
});

describe('Quenching Breath: the blast', () => {
  it('reads ice blue, never pushed to a cream white', () => {
    const m = QUENCH_BREATH_COLORS.mist;
    expect(m[2]).toBeGreaterThan(m[0] * 2.5);
    expect(Math.max(...m)).toBeLessThanOrEqual(1);
    for (const c of Object.values(QUENCH_BREATH_COLORS)) {
      // Blue leads in every one (no warm cast), nothing past 1.
      expect(c[2]).toBeGreaterThanOrEqual(c[1]);
      expect(c[1]).toBeGreaterThanOrEqual(c[0]);
      expect(Math.max(...c)).toBeLessThanOrEqual(1);
    }
  });

  it('is thin at her and thick down the cone', () => {
    const near = quenchBreathMistAt(0);
    const far = quenchBreathMistAt(1);
    // None in the first fifth of the cone (her face and her heart stay seen).
    expect(near.along).toBeGreaterThan(0.2);
    expect(far.along).toBeCloseTo(1, 5);
    expect(far.size).toBeGreaterThan(near.size * 2);
    expect(far.alpha).toBeGreaterThan(near.alpha * 2);
    expect(QUENCH_BREATH_STREAK.bornOut).toBeGreaterThanOrEqual(2.5);
    expect(QUENCH_BREATH_STREAK.poolLow).toBeLessThan(QUENCH_BREATH_STREAK.pool);
  });

  it('blows hard, then dies away; each streak in fast and out slow', () => {
    expect(quenchBreathBlast(-0.1)).toBe(0);
    expect(quenchBreathBlast(0.2)).toBe(1);
    expect(quenchBreathBlast(QUENCH_BREATH_BLAST_SECONDS + 0.01)).toBe(0);
    expect(quenchBreathStreakFade(0)).toBe(0);
    expect(quenchBreathStreakFade(0.15)).toBeGreaterThan(0.7);
    expect(quenchBreathStreakFade(1)).toBe(0);
  });
});

describe('Tempering Strike: the wind-up and the cracks', () => {
  it("waits on the sim's own wind-up lead with her fists up, then slams fast", () => {
    expect(QUENCH_STRIKE_WIND).toBeCloseTo(T.strikeWindup, 9);
    // Round 3: her fists are up before the swing and held past it; the slam
    // from up there lands a beat after the cleave, never a second later.
    expect(QUENCH_BODY_CLIP.strikeRaiseTop).toBeLessThan(QUENCH_STRIKE_WIND);
    expect(QUENCH_BODY_CLIP.strikeSlam).toBeLessThan(0.2);
    expect(QUENCH_BODY_CLIP.strikeSpent).toBeLessThan(0.25);
    // The wind-up owns the swing's outcome a little past it, never the next.
    expect(QUENCH_STRIKE_WIND_OWNS).toBeGreaterThan(QUENCH_STRIKE_WIND);
    expect(QUENCH_STRIKE_WIND_OWNS).toBeLessThan(2);
  });

  it('gathers the cold on her bracers, blazing to the slam', () => {
    const a = quenchStrikeWindLook(0.1);
    const b = quenchStrikeWindLook(0.85);
    expect(b.bracers).toBeGreaterThan(a.bracers * 2);
    expect(a.gather).toBeGreaterThan(0);
    expect(quenchStrikeWindLook(QUENCH_STRIKE_WIND).gather).toBe(0);
    expect(quenchStrikeWindLook(-0.1).bracers).toBe(0);
  });

  it('cracks the lake open fast, holds, frosts them over', () => {
    const K = QUENCH_STRIKE_CRACKS;
    expect(quenchStrikeCrackLook(0).open).toBe(0);
    expect(quenchStrikeCrackLook(K.open).open).toBeCloseTo(1, 5);
    expect(quenchStrikeCrackLook(K.open + 0.5).alpha).toBe(1);
    expect(quenchStrikeCrackLook(K.open + K.hold + K.fade + 0.01).alpha).toBe(0);
    expect(quenchStrikeCrackLook(0.1).glow).toBeGreaterThan(quenchStrikeCrackLook(1.6).glow);
  });
});

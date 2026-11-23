// Gourdlight Eve's own sound effects (scripts/sfx/gourdlight_sfx.mjs): every cue the sim
// emits or the render layer plays is a real, catalogued clip, the old borrowed sounds are
// gone, and the Swelling Gourd's heartbeat quickens as it ripens.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountAudioKey } from '../src/game/mount_audio_key';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  GOURDFALL_WHISTLE_SFX,
  SWELL_PULSE_SFX,
  swellPulseGain,
  swellPulseInterval,
} from '../src/render/scarecrow_fx_core';
import { GOURD_BURST_SFX as RAIN_IMPACT_SFX } from '../src/sim/seasonal/scarecrow_kit';
import { GOURD_BURST_SFX as SWELL_BURST_SFX } from '../src/sim/seasonal/scarecrow_swell';

const ROOT = resolve(__dirname, '..');
const OWN = [
  'proj_gourdfall_whistle',
  'impact_gourdfall',
  'spell_swelling_gourd_pulse',
  'impact_swelling_gourd_burst',
  'mount_run_emberbristle_broom',
  'mount_idle_emberbristle_broom',
];

describe('Gourdlight Eve sound effects', () => {
  it('ships every cue as a catalogued clip with its file', () => {
    for (const key of OWN) {
      expect(key in SFX_CLIPS, key).toBe(true);
      expect(existsSync(resolve(ROOT, `public/audio/sfx/${key}.mp3`)), key).toBe(true);
    }
  });

  it('wires the sim and the render layer to their own cues, not borrowed fire', () => {
    expect(RAIN_IMPACT_SFX).toBe('impact_gourdfall');
    expect(SWELL_BURST_SFX).toBe('impact_swelling_gourd_burst');
    expect(GOURDFALL_WHISTLE_SFX).toBe('proj_gourdfall_whistle');
    expect(SWELL_PULSE_SFX).toBe('spell_swelling_gourd_pulse');
  });

  it('gives the broom its own stride and hover hum (no longer the hover cycle)', () => {
    expect(mountAudioKey('emberbristle_broom')).toBe('emberbristle_broom');
    expect(`mount_run_${mountAudioKey('emberbristle_broom')}` in SFX_CLIPS).toBe(true);
    expect(`mount_idle_${mountAudioKey('emberbristle_broom')}` in SFX_CLIPS).toBe(true);
  });

  it('quickens and swells the ripening heartbeat as the fuse runs out', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const dt = swellPulseInterval(p);
      expect(dt).toBeLessThanOrEqual(last + 1e-9);
      last = dt;
    }
    expect(swellPulseInterval(0)).toBeCloseTo(1.4, 6);
    expect(swellPulseInterval(1)).toBeCloseTo(0.28, 6);
    expect(swellPulseGain(1)).toBeGreaterThan(swellPulseGain(0));
  });
});

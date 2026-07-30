import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('Chronomancy clock audio', () => {
  it('ships the user-provided clock recording as a short custom SFX clip', () => {
    const clip = fileURLToPath(new URL('../public/audio/sfx/temporal_clock.mp3', import.meta.url));
    const catalog = source('../scripts/sfx/sfx_prompts.mjs');
    const manifest = source('../src/game/sfx_manifest.generated.ts');
    const audio = source('../src/game/audio.ts');

    expect(statSync(clip).size).toBeGreaterThan(1_000);
    expect(statSync(clip).size).toBeLessThan(100_000);
    expect(catalog).toContain("{ key: 'temporal_clock', custom: true }");
    expect(manifest).toContain('"temporal_clock"');
    expect(manifest).toContain('"url": "/audio/sfx/temporal_clock.mp3?v=');
    expect(audio).not.toContain('temporalClock(');
  });

  it('routes Rewind and Hourglass through the same clock clip', () => {
    const rewind = source('../src/sim/combat/rewind.ts');
    const hud = source('../src/ui/hud.ts');

    expect(rewind.match(/fx: 'temporalClock'/g)).toHaveLength(1);
    expect(rewind).toContain("fx: 'temporalRewindNova'");
    expect(rewind).not.toContain("fx: 'nova'");
    expect(hud).toContain("if (ev.fx === 'temporalClock')");
    expect(hud.match(/'temporal_clock'/g)).toHaveLength(2);
    expect(hud).toContain('const TEMPORAL_CLOCK_GAIN = 0.72;');
    expect(hud.match(/TEMPORAL_CLOCK_GAIN/g)).toHaveLength(3);
    expect(hud).toContain('ev.name === ABILITIES.temporal_hourglass.name && ev.gained');
  });
});

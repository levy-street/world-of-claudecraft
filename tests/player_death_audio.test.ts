// Source-guard for the 'playerDeath' sim-event audio wiring (the
// deeds_window.test.ts pattern): pins that the real character-death event
// plays the dedicated player_death recording via audio.playerDeath(), not
// the generic ui_death UI stinger shared by every minigame/PvP loss chime
// (fiesta, Yumi, arena rating, Vale Cup). A prior version of this code used
// the shared audio.death() here too, silently reusing a placeholder-era cue
// for the one event that has a real, distinct recording.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

describe('playerDeath audio wiring', () => {
  it('plays the real player_death recording, not the generic death chime', () => {
    const start = hud.indexOf("case 'playerDeath':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.playerDeath();');
    expect(body).not.toContain('audio.death();');
  });

  it('leaves every minigame/PvP loss chime on the shared generic cue', () => {
    // fiesta, Yumi match, arena rating, and Vale Cup losses are NOT a
    // character death and must keep using the shared stinger.
    const matches = hud.match(/audio\.death\(\);/g) ?? [];
    expect(matches.length).toBe(4);
  });
});

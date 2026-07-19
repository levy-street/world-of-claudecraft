// Source-guard for the Card Duel hud.ts audio wiring (the
// player_death_audio.test.ts pattern): the sim-behavior side (which event
// fires with which fields) is covered by tests/card_duel_audio_events.test.ts;
// this pins that hud.ts's case blocks actually call the right audio.* method
// for each event, including the layered reveal+push and reveal+shuffle cases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

function caseBody(caseLabel: string): string {
  const start = hud.indexOf(`case '${caseLabel}':`);
  expect(start, caseLabel).toBeGreaterThan(-1);
  const end = hud.indexOf('break;', start);
  return hud.slice(start, end);
}

describe('Card Duel audio wiring in hud.ts', () => {
  it('plays the shuffle cue when a match starts', () => {
    expect(caseBody('cardDuelMatchStart')).toContain('audio.cardShuffle();');
  });

  it('plays the play cue when a card is played', () => {
    expect(caseBody('cardPlayed')).toContain('audio.cardPlay();');
  });

  it('always reveals, and layers push/shuffle on top rather than replacing it', () => {
    const body = caseBody('cardRoundResolved');
    expect(body).toContain('audio.cardReveal();');
    expect(body).toContain("if (ev.outcome === 'push') audio.cardRoundPush();");
    expect(body).toContain('if (ev.reshuffled) audio.cardShuffle();');
    // Reveal must be unconditional (comes before the two conditional layers),
    // not gated behind either outcome check.
    const revealIndex = body.indexOf('audio.cardReveal();');
    const pushIndex = body.indexOf('audio.cardRoundPush();');
    const shuffleIndex = body.indexOf('audio.cardShuffle();');
    expect(revealIndex).toBeLessThan(pushIndex);
    expect(revealIndex).toBeLessThan(shuffleIndex);
  });

  it('reuses duelEnd for a match win and arenaLoss for a match loss, not new recordings', () => {
    const body = caseBody('cardDuelMatchEnd');
    // Pin the branch direction itself, not just that both cues appear
    // somewhere in the case: a swapped if (ev.won) would still pass a bare
    // toContain check on both lines.
    expect(body).toContain('if (ev.won) audio.duelEnd();');
    expect(body).toContain('else audio.arenaLoss();');
  });
});

// While a vehicle seat is up, the player frame is lifted 250px above the seat's own bar,
// which leaves the bottom-bar containers standing empty over the world in front of the seat.
// Those containers must let clicks through, or the turret's click-to-fire dies in a band
// right in front of the tank (found by the headless Fire and Fly probe, 2026-09-29).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/hud.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ');

function declarationsFor(selector: string): string | null {
  const flat = squash(css);
  const at = flat.indexOf(`${selector} {`);
  if (at < 0) return null;
  const open = flat.indexOf('{', at);
  return flat.slice(open + 1, flat.indexOf('}', open)).trim();
}

describe('vehicle seat click-through', () => {
  it('makes the three bottom-bar containers click-through while seated', () => {
    expect(
      declarationsFor('body.operating-vehicle :is(#bottom-bar, #actionbar-row, #actionbar-stack)'),
    ).toBe('pointer-events: none;');
  });

  it('keeps every real row inside them clickable', () => {
    expect(
      declarationsFor(
        'body.operating-vehicle :is(#bottom-bar, #actionbar-row, #actionbar-stack) > :not(#actionbar-row, #actionbar-stack)',
      ),
    ).toBe('pointer-events: auto;');
  });

  it('still lifts the docked player frame over the bottom vehicle bars, the reason the band exists', () => {
    expect(
      declarationsFor(
        'body.operating-vehicle:not(.manning-turret) #player-frame:not(.pf-detached)',
      ),
    ).toBe('margin-bottom: 250px;');
  });
});

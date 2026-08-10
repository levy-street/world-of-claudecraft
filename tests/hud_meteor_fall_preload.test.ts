// Pins the hud.ts half of the Meteor anti-doubling fix (see
// tests/ability_audio_defers_to_recordings.test.ts for the sfx.ts and painter
// halves): the meteorFall telegraph, which fires ~2s before the ground tick
// lands, must kick off sfx.preload('meteor') so the first cast of a session
// doesn't race the fetch+decode and drop the landing recording silently.
import { describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import { Hud } from '../src/ui/hud';

// The noticeboard/resurrection-prompt suites' Object.create idiom: stub only
// the fields playEventSfx's spellfxAt arm touches.
interface PlayEventSfxHarness {
  sim: unknown;
  playEventSfx(ev: unknown): void;
}

function harness(): PlayEventSfxHarness {
  const hud = Object.create(Hud.prototype) as unknown as PlayEventSfxHarness;
  hud.sim = {};
  return hud;
}

describe('HUD meteorFall telegraph preloads the meteor recording', () => {
  it('calls sfx.preload("meteor") on a meteorFall spellfxAt event', () => {
    const preload = vi.spyOn(sfx, 'preload').mockImplementation(() => {});
    try {
      const hud = harness();
      (hud as unknown as { playEventSfx: (ev: unknown) => void }).playEventSfx({
        type: 'spellfxAt',
        x: 0,
        z: 0,
        school: 'fire',
        fx: 'meteorFall',
        ability: 'meteor',
      });
      expect(preload).toHaveBeenCalledWith('meteor');
    } finally {
      preload.mockRestore();
    }
  });
});

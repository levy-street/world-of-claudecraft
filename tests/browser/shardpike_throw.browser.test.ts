import { beforeAll, describe, expect, it } from 'vitest';
import { assetsReady, beginDeferredPreloads } from '../../src/render/assets/preload';
import type { AnimState } from '../../src/render/characters/anim_state';
import { prepareVisual } from '../../src/render/characters/assets';
import { CharacterVisual } from '../../src/render/characters/visual';

const IDLE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

describe('Shardpike real asset and mixer dispatch', () => {
  beforeAll(async () => {
    // Match world entry: player bodies and their donor clips are deferred.
    beginDeferredPreloads();
    await assetsReady();
  }, 60_000);
  it.each(['player_warrior', 'player_mage', 'player_priest', 'player_rogue'])(
    'registers and plays the throw on %s instead of a default weapon swing',
    (key) => {
      const prepared = prepareVisual(key);
      expect(prepared.clips.get('Signature_lance_thrust')?.duration).toBe(1.1);
      const visual = new CharacterVisual(key, 0xffffff);
      try {
        visual.update(0, IDLE, true);
        visual.playAttack('lance_thrust');
        visual.update(0.2, IDLE, true);
        // Inspect the real selected mixer action, not a mocked animation callback.
        const current = (
          visual as unknown as { current: { getClip(): { name: string }; time: number } }
        ).current;
        expect(current.getClip().name).toBe('Signature_lance_thrust');
        expect(current.time).toBeCloseTo(0.2, 5);
        for (let frame = 0; frame < 90; frame++) visual.update(1 / 60, IDLE, true);
        expect(visual.isMidOneShot).toBe(false);
      } finally {
        visual.dispose();
      }
    },
  );
});

import { describe, expect, it } from 'vitest';
import { manifestUrlsForGraphics, VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { ROACH_KING_VISUALS } from '../src/render/characters/roach_king_manifest';
import { roachKingVisualKey } from '../src/render/characters/roach_king_visual_core';
import { characterVisualPoolKey } from '../src/render/characters/visual_pool';

const boss = { kind: 'mob', templateId: 'rift_boss_asmon', auras: [] };

describe('Roach King authoritative visual identity', () => {
  it('switches both initial and live manifest dispatch from the replicated crown', () => {
    expect(visualKeyFor(boss as never)).toBe('mob_asmon_hermit');
    const crowned = { ...boss, auras: [{ id: 'rift_roach_crown' }] };
    expect(visualKeyFor(crowned as never)).toBe('mob_roach_king');
    // A late-join corpse and a healed crowned boss keep their true body.
    expect(visualKeyFor({ ...crowned, dead: true, hp: 0 } as never)).toBe('mob_roach_king');
    expect(visualKeyFor({ ...crowned, hp: 99999 } as never)).toBe('mob_roach_king');
    expect(visualKeyFor({ ...boss, hp: 1 } as never)).toBe('mob_asmon_hermit');
    expect(roachKingVisualKey({ ...boss, auras: [{ id: 'unrelated' }] })).toBe('mob_asmon_hermit');
  });

  it('routes both adds to their distinct authored rigs without affecting other entities', () => {
    expect(visualKeyFor({ ...boss, templateId: 'rift_roachling' } as never)).toBe('mob_roachling');
    expect(visualKeyFor({ ...boss, templateId: 'rift_garbage_beetle' } as never)).toBe(
      'mob_garbage_beetle',
    );
    expect(roachKingVisualKey({ ...boss, templateId: 'wolf' })).toBeNull();
    expect(roachKingVisualKey({ ...boss, kind: 'player' })).toBeNull();
  });

  it('does not reuse a transformed corpse as the next encounter hermit', () => {
    expect(characterVisualPoolKey({ ...boss, skin: 0 } as never)).toBeNull();
    expect(
      characterVisualPoolKey({ ...boss, templateId: 'rift_roachling', skin: 0 } as never),
    ).toBe('mob:rift_roachling');
  });

  it('loads both forms and both adds at every graphics tier with their authored clips', () => {
    for (const [key, def] of Object.entries(ROACH_KING_VISUALS)) {
      expect(VISUALS[key]).toBe(def);
      for (const standard of [false, true])
        expect(manifestUrlsForGraphics(standard)).toContain(def.url);
      expect(def.clips.idle).toBe('Idle');
      expect(def.clips.death).toBe('Death');
      expect(def.clips.attack).toEqual(['Attack']);
      expect(def.tint).toBeUndefined();
      expect(def.authoredAtlas).toBe(true);
    }
    expect(VISUALS.mob_roach_king.height).toBeGreaterThan(VISUALS.mob_asmon_hermit.height);
    expect(VISUALS.mob_asmon_hermit.clips.castByAbility?.rift_asmon_coronation).toBe('Transform');
    expect(VISUALS.mob_roach_king.clips.castByAbility?.rift_asmon_filth).toBe('Spit');
  });
});

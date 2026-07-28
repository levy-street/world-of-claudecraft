// The scene music-directive sample map (src/game/scene_sfx.ts): every harbor
// directive resolves to a real manifest key and reports handled; directives
// without a sampled interpretation (future-phase authoring, plus the
// director-owned silence/resume pair) report unhandled and stay no-ops.
// sfx.playUi is safe headless (it early-returns without an AudioContext).
import { describe, expect, it } from 'vitest';
import { playSceneDirectiveSfx } from '../src/game/scene_sfx';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';

describe('playSceneDirectiveSfx', () => {
  it('handles the three harbor directives', () => {
    expect(playSceneDirectiveSfx('lb_bell_toll_one')).toBe(true);
    expect(playSceneDirectiveSfx('lb_harbor_ambience')).toBe(true);
    expect(playSceneDirectiveSfx('lb_ship_castoff')).toBe(true);
  });

  it('reports unhandled for unknown and director-owned directives', () => {
    expect(playSceneDirectiveSfx('silence')).toBe(false);
    expect(playSceneDirectiveSfx('resume')).toBe(false);
    expect(playSceneDirectiveSfx('lb_no_such_directive')).toBe(false);
  });

  it('maps onto keys the shipped manifest actually carries', () => {
    const keys: readonly string[] = SFX_FIXED_CATALOG_KEYS;
    for (const key of ['lb_bell_toll', 'lb_harbor_ambience', 'lb_ship_castoff']) {
      expect(keys).toContain(key);
    }
  });
});

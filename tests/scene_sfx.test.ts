// The scene music-directive sample map (src/game/scene_sfx.ts): every harbor
// directive resolves to a real manifest key and reports handled; directives
// without a sampled interpretation (future-phase authoring, plus the
// director-owned silence/resume pair) report unhandled and stay no-ops.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { playUi } = vi.hoisted(() => ({ playUi: vi.fn() }));
vi.mock('../src/game/sfx', () => ({ sfx: { playUi } }));

import { playSceneDirectiveSfx } from '../src/game/scene_sfx';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';

const SAMPLED_DIRECTIVES = [
  ['lb_bell_toll_one', 'lb_bell_toll'],
  ['lb_harbor_ambience', 'lb_harbor_ambience'],
  ['lb_ship_castoff', 'lb_ship_castoff'],
] as const;

describe('playSceneDirectiveSfx', () => {
  beforeEach(() => {
    playUi.mockClear();
  });

  it.each(SAMPLED_DIRECTIVES)('maps %s to the exact sampled SFX key', (directive, key) => {
    expect(playSceneDirectiveSfx(directive)).toBe(true);
    expect(playUi).toHaveBeenCalledOnce();
    expect(playUi).toHaveBeenCalledWith(key, { jitter: false });
  });

  it('reports unhandled for future, unknown, and director-owned directives', () => {
    expect(playSceneDirectiveSfx('silence')).toBe(false);
    expect(playSceneDirectiveSfx('resume')).toBe(false);
    expect(playSceneDirectiveSfx('theme:last_bell')).toBe(false);
    expect(playSceneDirectiveSfx('lb_no_such_directive')).toBe(false);
    expect(playUi).not.toHaveBeenCalled();
  });

  it('maps onto keys the shipped manifest actually carries', () => {
    const keys: readonly string[] = SFX_FIXED_CATALOG_KEYS;
    for (const [, key] of SAMPLED_DIRECTIVES) {
      expect(keys).toContain(key);
    }
  });
});

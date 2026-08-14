import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `EntityView.weaponStowed` is a LAST-RENDERED cache, diffed to decide when to
// play the sheathe gesture. It must have exactly one writer in the per-entity
// loop, and that writer must be the swim overlay (`e.weaponStowed || swimming`).
//
// The failure this pins is not obvious from either diff on its own. With two
// diffs against the same field computing different targets, a swimmer holding a
// drawn weapon (`e.weaponStowed === false`, `swimming === true`) has the first
// write `false` and the second write `true` on every single frame. Each write
// is a genuine target change, so `requestStow` replays the sheathe one-shot
// forever; `CharacterVisual.currentIsOneShot` never clears, and the base-state
// machine's `baseChanged && !this.currentIsOneShot` gate then suppresses every
// fade. The state machine still latches swim/swimSurface/swimIdle correctly and
// the authored clips are all bound — nothing ever fades in, and the rig sits
// frozen a third of a second into the sheathe gesture (for a player rig that
// clip is 1H_Melee_Attack_Chop) for as long as the swim lasts.
//
// It regressed exactly once already: the swimming PR removed the older Z-key
// diff, and a later release merge resurrected it.
const rendererSource = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');

describe('the weapon stow overlay is the single writer of the render-side cache', () => {
  it('drives the sheathe gesture from exactly one call site', () => {
    const calls = rendererSource.match(/\.setWeaponStowed\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(rendererSource).toMatch(/v\.visual\.setWeaponStowed\(stowed\)/);
  });

  it('feeds that call the union of the sim bit and the swim latch', () => {
    expect(rendererSource).toMatch(/const stowed = e\.weaponStowed \|\| swimming/);
  });

  it('has no second diff against the bare sim bit', () => {
    expect(rendererSource).not.toMatch(/if \(e\.weaponStowed !== v\.weaponStowed\)/);
    // One reset (`= false`) on the visual-swap path plus the overlay's own
    // write. A third assignment is a second writer by another name.
    const writes = rendererSource.match(/v\.weaponStowed = /g) ?? [];
    expect(writes).toHaveLength(2);
  });
});

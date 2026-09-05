// `EntityView.weaponStowed` is a LAST-RENDERED cache, diffed to decide when to
// play the sheathe gesture. It must have exactly one writer in the per-entity
// loop, and that writer must be the stow overlay: the union of the sim's Z-key
// bit with the swim latch (and, since the mounts landed, with riding).
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
// It has regressed twice: the swimming PR removed the older Z-key diff, and two
// later release merges resurrected it (one parent carrying the deletion, the
// other the untouched lines), which is a shape no reviewer sees in a diff. The
// deletion is on the release line for the third time; this file is what keeps
// it there.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createStowTransition,
  requestStow,
  tickStow,
} from '../src/render/characters/stow_transition';
import { stripComments } from './helpers/strip_comments';

// Comments stripped so header prose quoting `.setWeaponStowed(` or
// `v.weaponStowed = ` can neither satisfy nor red these pins.
const rendererSource = stripComments(
  readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
);

describe('the weapon stow overlay is the single writer of the render-side cache', () => {
  it('drives the sheathe gesture from exactly one call site', () => {
    const calls = rendererSource.match(/\.setWeaponStowed\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(rendererSource).toMatch(/v\.visual\.setWeaponStowed\(stowed\)/);
  });

  it('feeds that call the union of the sim bit and the swim latch', () => {
    // Either spelling of the overlay is fine: the inline union, or the pure
    // `weaponStowedOverlay(e.weaponStowed, swimming, ...)` helper it may be
    // extracted into. What matters is that the sim bit and the swim latch are
    // combined BEFORE the one diff, never diffed separately.
    expect(rendererSource).toMatch(
      /const stowed = (?:e\.weaponStowed \|\| swimming|weaponStowedOverlay\(e\.weaponStowed, swimming)/,
    );
  });

  it('has no second diff against the bare sim bit', () => {
    expect(rendererSource).not.toMatch(/if \(e\.weaponStowed !== v\.weaponStowed\)/);
    // One reset (`= false`) on the pooled-visual swap path plus the overlay's
    // own write. A third assignment is a second writer by another name.
    const writes = rendererSource.match(/v\.weaponStowed = /g) ?? [];
    expect(writes).toHaveLength(2);
  });
});

// Why one writer, played out on the real transition module: the renderer's diff
// is what feeds `requestStow`, so two targets per frame are two requests.
describe('the sheathe transition under a per-frame stow request', () => {
  const SWAP_DELAY = 0.31; // the player rig's gesture midpoint, near enough
  const DT = 1 / 60;

  it('never lands the swap when two writers disagree every frame', () => {
    const t = createStowTransition();
    let gestureReplays = 0;
    let swaps = 0;
    // A swimmer with a weapon drawn: the bare sim bit says false, the swim
    // overlay says true, and both are applied on every frame.
    for (let frame = 0; frame < 600; frame++) {
      for (const target of [false, true]) {
        if (requestStow(t, target, SWAP_DELAY)) gestureReplays++;
      }
      if (tickStow(t, DT) === 'swap') swaps++;
    }
    // Ten seconds of swimming: the one-shot is replayed twice on every frame
    // (which is what pins currentIsOneShot true), and the gesture never
    // completes. Two per frame less the very first request, which happens to
    // match the transition's initial target.
    expect(gestureReplays).toBe(600 * 2 - 1);
    expect(swaps).toBe(0);
    expect(t.attached).toBe(false);
  });

  it('lands it once, and settles, with the single overlay writer', () => {
    const t = createStowTransition();
    let gestureReplays = 0;
    let swaps = 0;
    for (let frame = 0; frame < 600; frame++) {
      if (requestStow(t, true, SWAP_DELAY)) gestureReplays++;
      if (tickStow(t, DT) === 'swap') swaps++;
    }
    expect(gestureReplays).toBe(1);
    expect(swaps).toBe(1);
    expect(t.attached).toBe(true);
    expect(t.timer).toBe(0);
  });
});

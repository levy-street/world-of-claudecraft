// Extends the render-side weapon-stow overlay (weaponStowedOverlay in
// src/render/characters/anim_state.ts) to also sheathe a held weapon while
// mounted, the same way it already sheathes while swimming: an OVERLAY on the
// sim's cosmetic `weaponStowed` bit, not a write to it, so dismounting
// restores exactly what the player had drawn.
//
// `EntityView.weaponStowed` (renderer.ts) is a LAST-RENDERED cache, diffed to
// decide when to play the sheathe gesture, and it must have exactly ONE
// writer per entity per frame. A second, independent diff against the bare
// sim bit (the pre-existing Z-key-only write this change removes) computes a
// different target from the overlay whenever an overlay condition disagrees
// with the raw sim bit; each write is then a genuine target change, so
// requestStow replays the sheathe one-shot every frame and the gesture never
// lands (the rig sits frozen mid-gesture). That failure mode is not specific
// to swimming: it would reproduce identically for a mounted rider with a
// weapon drawn if the mount condition were folded into the overlay without
// also removing the second writer, so this file pins BOTH the mount overlay
// behavior and the single-writer invariant it depends on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { weaponStowedOverlay } from '../src/render/characters/anim_state';
import {
  createStowTransition,
  requestStow,
  tickStow,
} from '../src/render/characters/stow_transition';
import { stripComments } from './helpers/strip_comments';

// Comments stripped so a future header prose mentioning `.setWeaponStowed(` or
// `v.weaponStowed = ` cannot satisfy (or red) these source pins.
const rendererSource = stripComments(
  readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
);

describe('the render-side stow cache stays single-writer with mount folded into the overlay', () => {
  it('drives the sheathe gesture from exactly one call site', () => {
    const calls = rendererSource.match(/\.setWeaponStowed\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(rendererSource).toMatch(/v\.visual\.setWeaponStowed\(stowed\)/);
  });

  it('feeds that call the swim/mount overlay, not a second diff against the bare sim bit', () => {
    expect(rendererSource).toMatch(
      /const stowed = weaponStowedOverlay\(e\.weaponStowed, swimming, e\.mountKey !== ''\)/,
    );
    expect(rendererSource).not.toMatch(/if \(e\.weaponStowed !== v\.weaponStowed\)/);
  });

  it('has exactly one per-frame write to v.weaponStowed (plus the pooled-visual reset on rebuild)', () => {
    const writes = rendererSource.match(/v\.weaponStowed = /g) ?? [];
    expect(writes).toHaveLength(2);
  });
});

// Why one writer matters, played out on the real transition module the
// renderer drives: `requestStow` replays the arm gesture on every genuine
// target change, so two writers disagreeing every frame is two requests
// every frame, and the gesture can never finish.
describe('the sheathe transition under a per-frame mount stow request', () => {
  const SWAP_DELAY = 0.31; // the player rig's gesture midpoint, near enough
  const DT = 1 / 60;

  it('never lands the swap when a stale bare-bit write fights the overlay every frame (the bug a second writer would reintroduce)', () => {
    const t = createStowTransition();
    let swaps = 0;
    for (let frame = 0; frame < 600; frame++) {
      // The old duplicate write: the bare sim bit (weapon still drawn: false)...
      requestStow(t, false, SWAP_DELAY);
      // ...then the overlay wins later in the same frame (mounted: true).
      requestStow(t, true, SWAP_DELAY);
      if (tickStow(t, DT) === 'swap') swaps++;
    }
    // Ten seconds mounted with a weapon drawn: the swap never lands.
    expect(swaps).toBe(0);
    expect(t.attached).toBe(false);
  });

  it('lands it once, and settles, with the single overlay writer covering mount', () => {
    const t = createStowTransition();
    let replays = 0;
    let swaps = 0;
    for (let frame = 0; frame < 600; frame++) {
      if (requestStow(t, weaponStowedOverlay(false, false, true), SWAP_DELAY)) replays++;
      if (tickStow(t, DT) === 'swap') swaps++;
    }
    expect(replays).toBe(1);
    expect(swaps).toBe(1);
    expect(t.attached).toBe(true);
    expect(t.timer).toBe(0);
  });

  it('dismounting restores exactly what the player had drawn (not forced back to sheathed)', () => {
    const t = createStowTransition();
    // Mount with a weapon drawn: the overlay forces the sheathed pose.
    requestStow(t, weaponStowedOverlay(false, false, true), SWAP_DELAY);
    for (let i = 0; i < 30; i++) tickStow(t, DT);
    expect(t.attached).toBe(true);
    // Dismount: the player's own choice (still drawn) is untouched, so the
    // overlay now reports drawn again with no wire traffic of its own.
    requestStow(t, weaponStowedOverlay(false, false, false), SWAP_DELAY);
    for (let i = 0; i < 30; i++) tickStow(t, DT);
    expect(t.attached).toBe(false);
  });

  it('dismounting with the weapon actually sheathed (the player pressed Z) stays sheathed', () => {
    const t = createStowTransition();
    requestStow(t, weaponStowedOverlay(true, false, true), SWAP_DELAY);
    for (let i = 0; i < 30; i++) tickStow(t, DT);
    expect(t.attached).toBe(true);
    requestStow(t, weaponStowedOverlay(true, false, false), SWAP_DELAY);
    for (let i = 0; i < 30; i++) tickStow(t, DT);
    expect(t.attached).toBe(true);
  });
});

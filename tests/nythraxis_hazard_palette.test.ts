// Compact literal acceptance pins for the Nythraxis hazard palettes.
//
// The existing render suites (nythraxis_grave_eruption_render.test.ts,
// nythraxis_grave_flame_render.test.ts, nythraxis_sigil_render.test.ts) prove
// a painted material's color WIRES to the imported palette constant, but they
// compare against that same live import, so an edit that quietly moves a
// palette's actual hue off the owner-called purple-danger / blue-friendly
// design (nythraxis_grave_core.ts's header) would still read as "wired
// correctly" there. These pins compare against independent hex literals
// instead, so such a change is caught here even if every self-referential
// wiring test still passes. Soul Rend's red (alone) / green (stacked)
// behavior is checked separately in nythraxis_soul_rend_marker.test.ts.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_BONE_SPIKE_CLICK_RADIUS,
  NYTHRAXIS_BONE_SPIKE_SELF_ILLUMINATION,
  NYTHRAXIS_BONE_SPIKE_TINT,
  NYTHRAXIS_BONE_SPIKE_TINT_STRENGTH,
  VISUALS,
} from '../src/render/characters/manifest';
import {
  NYTHRAXIS_GRAVE_ERUPTION_PALETTE,
  NYTHRAXIS_GRAVE_FLAME_PALETTE,
  NYTHRAXIS_SOUL_FLAME_PALETTE,
} from '../src/render/nythraxis_grave_core';
import { NYTHRAXIS_GRAVEFIRE_PALETTE } from '../src/render/nythraxis_gravefire_core';
import { NYTHRAXIS_SIGIL_PALETTE } from '../src/render/nythraxis_sigil_core';
import { NYTHRAXIS_SOFT_FIRE_RAMPS } from '../src/render/nythraxis_soft_fire_core';

describe('Nythraxis hazard palette acceptance pins', () => {
  it('recolours the Bone Spike ember orange, the one hue no other Nythraxis surface uses', () => {
    // v0.42.2: the authored bone-and-flagstone atlas read as the boss and the
    // floor under violet torchlight. Orange is the complement of the hall's
    // purple offensive palette, is not the sigil's friendly blue, and is not
    // Soul Rend's red/green, so a spike is unmistakably the thing to kill.
    expect(NYTHRAXIS_BONE_SPIKE_TINT).toBe(0xff7a1a);
    expect(NYTHRAXIS_BONE_SPIKE_TINT_STRENGTH).toBe(1);
    expect(NYTHRAXIS_BONE_SPIKE_SELF_ILLUMINATION).toBe(0.35);
    // The click capsule is about twice the footprint-derived default (1.29),
    // above the 2.2 cap ordinary defs get.
    expect(NYTHRAXIS_BONE_SPIKE_CLICK_RADIUS).toBe(2.6);
    expect(VISUALS.mob_nythraxis_bone_spike).toMatchObject({
      tint: 0xff7a1a,
      tintStrength: 1,
      selfIllumination: 0.35,
    });
  });

  it('keeps the travelling Gravefire footprint purple', () => {
    expect(NYTHRAXIS_GRAVEFIRE_PALETTE).toEqual({
      underlay: 0x1a0a2a,
      glow: 0x5a2e9a,
      edge: 0xa06cff,
      head: 0xd9b8ff,
      tongue: 0xd9b8ff,
    });
  });

  it('keeps every fire sprite purple from core to tip', () => {
    expect(NYTHRAXIS_SOFT_FIRE_RAMPS).toEqual({
      grave: { core: 0xefe4ff, body: 0x8a5cf0, tip: 0x1f0e3d },
      soul: { core: 0xf8dcff, body: 0xc84fff, tip: 0x3a0a3a },
      gravefire: { core: 0xf4ecff, body: 0xa070ff, tip: 0x2a0c4e },
    });
  });

  it('pins the purple-danger Grave Eruption telegraph literally', () => {
    expect(NYTHRAXIS_GRAVE_ERUPTION_PALETTE).toEqual({
      footprint: 0x140a1e,
      boundary: 0x9a5df0,
      countdown: 0xd9b8ff,
      vein: 0xa06cff,
      mote: 0xb98cff,
      shard: 0xf0e6ff,
    });
  });

  it('pins the purple-danger Grave Flame ground fire literally', () => {
    expect(NYTHRAXIS_GRAVE_FLAME_PALETTE).toEqual({
      fill: 0x1a0a2a,
      rim: 0x8a5cf0,
      ember: 0x5a2e9a,
      tongue: 0xd9b8ff,
    });
  });

  it('pins the purple-danger Soulfire pool literally, distinct from Grave Flame', () => {
    expect(NYTHRAXIS_SOUL_FLAME_PALETTE).toEqual({
      fill: 0x2a0a2a,
      rim: 0xc84fff,
      ember: 0x7a1a6e,
      tongue: 0xe8b8ff,
    });
    // Warmer (redder) than Grave Flame's blue-violet rim, so the two purple-
    // family pools stay tellable apart at a glance.
    expect(NYTHRAXIS_SOUL_FLAME_PALETTE.rim).not.toBe(NYTHRAXIS_GRAVE_FLAME_PALETTE.rim);
  });

  it('pins the blue-friendly Binding Sigil ring literally, off the purple-danger family', () => {
    expect(NYTHRAXIS_SIGIL_PALETTE).toEqual({
      rim: 0x7fc0ff,
      fill: 0x0f2f5a,
      sweep: 0xcfe8ff,
    });
  });
});

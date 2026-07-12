// Ambient VFX for the hover cosmetics (back wings / jetpack): authored
// WeaponVfxSpec records rendered through the SAME createWeaponVfx rig the
// Season 1 weapon skins use (the rig only reads the spec's fx/light/emissive;
// it does not care that the anchor payload is a pair of wings instead of a
// sword). Anchors use {yF} fractions of the payload bounds, so they track the
// generated models without hand-measured offsets.
//
// Per-attachment offsets for the back mount live here too: the Tripo prop
// models are centered on origin facing +Z, so each def places itself against
// the chest bone (slightly behind the torso, facing out the back).

import type { HoverVfxKind } from '../sim/content/hover_cosmetics';
import type { WeaponVfxSpec } from './weapon_vfx';

// Butterfly: pastel iridescents. Angel: warm dawn golds. Jet: fire.
// Dragon: sullen coal reds and drifting embers.
const C = {
  teal: 0x7de8ff,
  violet: 0xb18cff,
  pink: 0xffb3e6,
  gold: 0xffd27a,
  white: 0xfff6e0,
  flame: 0xff9c3a,
  ember: 0xff5a2a,
  smoke: 0x8a8a92,
  bloodfire: 0xff3820,
  coal: 0x3a2a28,
};

/** How each attachment sits against the chest bone (model faces +Z; the back
 *  mount turns it to face out the back and tucks it behind the torso). */
export interface HoverAttach {
  pos: [number, number, number];
  rotY: number;
  scale: number;
}

export const HOVER_ATTACH: Record<string, HoverAttach> = {
  // Wing GLBs are baked to a centered canonical frame (spread on X, face +Z,
  // hinge at the origin), so pos.y places the wing MIDLINE relative to the
  // chest mount. The jetpack keeps the prop lane's base-at-y0 frame.
  hover_butterfly_wings: { pos: [0, 0.14, -0.16], rotY: Math.PI, scale: 1.3 },
  hover_angel_wings: { pos: [0, 0.14, -0.16], rotY: Math.PI, scale: 1.35 },
  hover_jetpack: { pos: [0, 0.12, -0.2], rotY: Math.PI, scale: 1 },
  hover_dragon_wings: { pos: [0, 0.14, -0.18], rotY: Math.PI, scale: 1.45 },
};

/** Flap motion per attachment: wing.l / wing.r hinge rotation about the
 *  central mount. Axis 'y' folds open/closed (resting butterfly), 'z' beats
 *  the tips up and down (flight); a rigid attachment (jetpack) has none. */
export const HOVER_FLAP: Record<
  string,
  { speed: number; amp: number; axis: 'y' | 'z' } | undefined
> = {
  hover_butterfly_wings: { speed: 9, amp: 0.5, axis: 'y' },
  hover_angel_wings: { speed: 3.4, amp: 0.28, axis: 'z' },
  hover_jetpack: undefined,
  hover_dragon_wings: { speed: 2.1, amp: 0.38, axis: 'z' },
};

export const HOVER_VFX: Record<HoverVfxKind, WeaponVfxSpec> = {
  sparkle: {
    tier: 'rare',
    name: 'Butterfly Drift',
    type: 'wand',
    lore: 'Iridescent dust drifts from the wingbeats.',
    light: { at: { yF: 0.5 }, intensity: 3.5 },
    fx: [
      {
        kind: 'drift',
        line: [{ yF: 0.2 }, { yF: 0.85 }],
        count: 22,
        vel: [0, -0.12, 0],
        spread: [0.28, 0.1, 0.1],
        life: [1.0, 2.0],
        size: [0.014, 0.034],
        grow: 0.25,
        swirl: 0.08,
        colorA: C.teal,
        colorB: C.violet,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 26 },
        size: [0.02, 0.045],
        rate: [0.5, 1.3],
        color: C.pink,
        star: true,
      },
    ],
  },
  feather: {
    tier: 'rare',
    name: 'Dawnfeather Wings',
    type: 'wand',
    lore: 'A soft dawn glow clings to the feathers.',
    light: { at: { yF: 0.55 }, intensity: 3 },
    fx: [
      {
        kind: 'drift',
        line: [{ yF: 0.15 }, { yF: 0.8 }],
        count: 14,
        vel: [0, -0.16, 0],
        spread: [0.3, 0.08, 0.08],
        life: [1.4, 2.6],
        size: [0.018, 0.04],
        grow: 0.2,
        swirl: 0.05,
        colorA: C.white,
        colorB: C.gold,
        opacity: 0.8,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 18 },
        size: [0.02, 0.04],
        rate: [0.4, 1.0],
        color: C.gold,
        star: true,
      },
    ],
  },
  flame: {
    tier: 'rare',
    name: "Tinker's Jetpack",
    type: 'wand',
    lore: 'Twin thrusters idle on a low blue-orange burn.',
    light: { at: { yF: 0.12 }, intensity: 5 },
    fx: [
      // Thruster wash: fast, short-lived fire pushed DOWN out of the nozzles.
      {
        kind: 'drift',
        line: [{ yF: 0.02 }, { yF: 0.1 }],
        count: 30,
        vel: [0, -1.1, 0],
        spread: [0.14, 0.05, 0.06],
        life: [0.25, 0.5],
        size: [0.02, 0.05],
        grow: 0.5,
        swirl: 0.02,
        colorA: C.flame,
        colorB: C.ember,
        opacity: 0.95,
      },
      // Lazy smoke puffs trailing above the wash.
      {
        kind: 'drift',
        line: [{ yF: 0.0 }, { yF: 0.06 }],
        count: 10,
        vel: [0, -0.45, 0],
        spread: [0.12, 0.05, 0.08],
        life: [0.8, 1.5],
        size: [0.03, 0.07],
        grow: 0.9,
        swirl: 0.05,
        colorA: C.smoke,
        colorB: C.smoke,
        opacity: 0.4,
      },
    ],
  },
  dragonfire: {
    tier: 'legendary',
    name: 'Dreadwyrm Wings',
    type: 'wand',
    lore: 'Embers bleed from the torn membrane and die below.',
    light: { at: { yF: 0.5 }, intensity: 4.5 },
    fx: [
      // Rising embers shed off the whole membrane span.
      {
        kind: 'drift',
        line: [{ yF: 0.2 }, { yF: 0.8 }],
        count: 26,
        vel: [0, 0.22, 0],
        spread: [0.55, 0.15, 0.12],
        life: [0.7, 1.6],
        size: [0.014, 0.036],
        grow: 0.3,
        swirl: 0.12,
        colorA: C.bloodfire,
        colorB: C.ember,
        opacity: 0.95,
      },
      // A slow pall of dark smoke curling off the wing tops.
      {
        kind: 'drift',
        line: [{ yF: 0.6 }, { yF: 0.95 }],
        count: 8,
        vel: [0, 0.14, 0],
        spread: [0.5, 0.1, 0.1],
        life: [1.6, 2.8],
        size: [0.05, 0.1],
        grow: 1.1,
        swirl: 0.06,
        colorA: C.coal,
        colorB: C.smoke,
        opacity: 0.3,
      },
      // Ember-vein glints crawling on the membrane surface.
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 20 },
        size: [0.02, 0.045],
        rate: [0.5, 1.4],
        color: C.bloodfire,
        star: false,
      },
    ],
  },
};

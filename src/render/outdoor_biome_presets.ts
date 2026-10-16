// The outdoor fog, light and god-ray presets per biome, moved out of
// renderer.ts (data-as-code: the renderer's updateAmbience eases between
// these; outdoorFogPreset picks the fog row). Values unchanged.

import type { BiomeId } from '../sim/types';

// Outdoor fog presets per biome (high tier eases between them as the player
// crosses zone bands; low keeps one preset everywhere). Distances are the
// pre-residency-clamp table opened back up (roughly x1.5): with the
// visible-zone streaming lane keeping neighbours resident before they can
// be seen, the fog no longer has to hide unloaded regions itself, so the
// sky and real vistas read again. fogFarForPreparedZones stays as the
// safety clamp for the brief window a build is still catching up. No far
// exceeds MAX_OUTDOOR_FOG_FAR (the rendering/culling envelope).
//
// The MURKY realms (marsh, haunt, frost, ember, dusk, amber and the two
// paint-only caves) then got a readability pass: their `near` was where the
// "cannot see anything in front of me" reports came from, since the chase
// camera sits ~12 yd behind the player and a near of 45 puts the fog barely
// 30 yd ahead of the character. `near` moves out further than `far` here,
// which does steepen those gradients slightly, but it is the plane the
// complaint is actually about and it costs nothing to draw. `far` moves only
// enough to keep each realm's silhouette depth (fog far drives terrain,
// prop and foliage culling, so it is the expensive half). The clear realms
// (vale, peaks, fen, jungle, garden, gale and friends) were already open and
// are untouched.
export const BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
  // The blue-sky biomes carry a deeper sky-blue haze (the old paler values
  // tonemapped to near white, so fully fogged distant trees and zones read
  // as white cutouts against the HDRI sky instead of far-off silhouettes).
  // 700 (not the 850 cap) on the open blue-sky realms: at 850 the last
  // visible hills sat almost fully outside the haze and the horizon read
  // cutout-crisp, with the same saturation at 400 yd as at 40. 700 puts real
  // aerial perspective on the far third while costing nothing near (and
  // fog-far drives culling, so the trim is a small draw-count win too).
  vale: { color: 0x7095bd, near: 55, far: 700 },
  // pale sage matched to the marsh horizon sky: the dome renders fog-free,
  // so a darker murk left every fully fogged silhouette as a cutout band
  marsh: { color: 0xc2cbb6, near: 75, far: 165 },
  peaks: { color: 0x8bb0d4, near: 55, far: 700 },
  beach: { color: 0x7ea6c9, near: 50, far: 700 },
  desert: { color: 0xd8c9a8, near: 50, far: 700 },
  volcano: { color: 0x8a7468, near: 60, far: 145 },
  cave: { color: 0x76807c, near: 48, far: 125 },
  // permanent dusk: rose-mauve murk, the realm's signature
  dusk: { color: 0xc9a3bd, near: 115, far: 400 },
  // scorched haze south, thicker toward the volcanic north (looks pass)
  ember: { color: 0x9a5844, near: 115, far: 385 },
  // the Frostveil: icy mist, the coldest sightlines in the world
  frost: { color: 0xa9bed2, near: 95, far: 325 },
  // the Amberfall: warm golden haze under an endless afternoon
  amber: { color: 0xdec18e, near: 130, far: 430 },
  // the Willowfen: clear airy morning, the lightest fog in the world
  // (deepened from 0xcfe2dc: the near-white haze tonemapped to a white
  // cutout band on the horizon instead of reading as distance, with the same
  // lesson as the blue-sky biomes above)
  fen: { color: 0xb7d0c6, near: 140, far: 510 },
  // the Nightbloom: a lavender dream-haze over the violet downs, deepened
  // to twilight with the realm's new dimmed light level
  night: { color: 0x8d7fc0, near: 110, far: 460 },
  // the Wraithwood: dead-grey murk, the tightest sightlines outdoors
  haunt: { color: 0x454c46, near: 85, far: 265 },
  // the Palmreach: bright humid haze, the clearest air in the world
  jungle: { color: 0xc2e0d0, near: 165, far: 600 },
  // the Evergarden: crystal parkland air with the faintest green cast
  garden: { color: 0xc6ddc6, near: 175, far: 630 },
  // the Galecrest: scrubbed salt air, dawn-lit haze off the sea
  gale: { color: 0xccc9d8, near: 170, far: 645 },
};

export const BATTLEGROUND_FOG = { color: 0xaecbe0, near: 70, far: 210 };
// Low tier trades view distance for draw count (its own perf knob, never a
// gameplay one: entities draw within their own much shorter ranges on every
// tier, so fog distance sheds only cosmetic scenery). Takes the same
// readability pass on `near`, with `far` held nearly still so the tier keeps
// paying for itself.
export const LOW_FOG = { color: 0xa6c6e0, near: 115, far: 340 };

// Per-biome outdoor light grade, eased alongside fog in updateAmbience.
// The three original biomes keep the exact constants the lights were
// created with; the dusk realm warms the sun to late-evening orange and
// turns the sky bounce rose over violet ground. The optional sun/hemi/env
// scales multiply the rig intensities, so a realm's mood can finally live
// in light LEVEL as well as hue (gloom via color luminance alone left the
// Nightbloom's canopies rendering in full daylight green).
export const BIOME_LIGHT: Record<
  BiomeId,
  {
    hemiSky: number;
    hemiGround: number;
    sun: number;
    sunScale?: number;
    hemiScale?: number;
    envScale?: number;
  }
> = {
  vale: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
  marsh: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
  peaks: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
  dusk: { hemiSky: 0xffc9dd, hemiGround: 0x4d3f63, sun: 0xffb072 },
  ember: { hemiSky: 0xe89070, hemiGround: 0x422424, sun: 0xff7440 },
  frost: { hemiSky: 0x9cb6d6, hemiGround: 0x66748a, sun: 0xccdaea },
  amber: { hemiSky: 0xffe2b0, hemiGround: 0x5a4a30, sun: 0xffc86a },
  fen: { hemiSky: 0xdceeff, hemiGround: 0x51704e, sun: 0xfff0d2 },
  // the Nightbloom: dreamlight. A cool rose sun over lavender sky bounce
  // and deep violet ground: luminous, but at a twilight level. At full
  // day strength its canopies and downs rendered in ordinary daylight
  // green under the starfield sky
  night: {
    hemiSky: 0xc0b2f0,
    hemiGround: 0x463a6e,
    sun: 0xe6d4ff,
    sunScale: 0.6,
    hemiScale: 0.95,
    envScale: 0.7,
  },
  // the Wraithwood: sickly grey light strangled by the canopy, dim as
  // well as grey now that the rig has an intensity knob
  haunt: { hemiSky: 0x4d564c, hemiGround: 0x0e120e, sun: 0x6e7a66, sunScale: 0.8, envScale: 0.8 },
  // the Palmreach: hard tropical daylight over deep green bounce
  jungle: { hemiSky: 0xeafcff, hemiGround: 0x3a6a42, sun: 0xfff4d8 },
  // the Evergarden: soft perfect afternoon over clipped lawns
  garden: { hemiSky: 0xe8f8ff, hemiGround: 0x4a7a44, sun: 0xfff2d0 },
  // the Galecrest: cool dawn light, sea-grey bounce off the downs
  gale: { hemiSky: 0xe4e8f2, hemiGround: 0x4e6a52, sun: 0xffe8c8 },
  // paint-only biomes (map editor, never a built-in realm): beach reuses the
  // neutral vale grade, desert the amber warmth, volcano the ember glow, cave
  // the wraithwood gloom.
  beach: { hemiSky: 0xdcefff, hemiGround: 0x465f39, sun: 0xffedd0 },
  desert: { hemiSky: 0xffe2b0, hemiGround: 0x5a4a30, sun: 0xffc86a },
  volcano: { hemiSky: 0xe89070, hemiGround: 0x422424, sun: 0xff7440 },
  cave: { hemiSky: 0x4d564c, hemiGround: 0x0e120e, sun: 0x6e7a66, sunScale: 0.8, envScale: 0.8 },
};

// God-ray shaft strength per biome (default 1). The shafts sell a bright
// sun hanging in clear or golden air; under the Nightbloom's starfield
// twilight or the Wraithwood's grey murk the same additive streaks read as
// artifacts (a playtested report over the Nightbloom's lake), and the
// overcast/rain realms keep only a hint. Eased in updateAmbience so a
// border crossing fades the shafts instead of popping them.
export const BIOME_GOD_RAYS: Partial<Record<BiomeId, number>> = {
  night: 0,
  haunt: 0,
  cave: 0,
  dusk: 0.35,
  frost: 0.45,
  ember: 0.55,
  volcano: 0.3,
  marsh: 0.3,
};

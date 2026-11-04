import * as THREE from 'three';
import { type MoonTerminator, moonTerminator } from './day_night_core';
import { paintMageMoonFace, paintMageMoonGlow } from './mage_moon_face';
import { setRenderCategory } from './renderer_diagnostics';
import {
  MAGE_MOON_RADII,
  type MoonSky,
  mageHaloBoost,
  PENUMBRA_RADII,
  spriteRotationAlong,
  UMBRA_RADII,
} from './twin_moons_core';

// celestial_sprites: the sun and the two moons as they appear in the sky. Billboard
// sprites (always camera-facing, so they read as perfect circles anywhere on
// screen; a dome-shader disc would project to an ellipse off-axis) with
// canvas-drawn faces:
// - the sun is a white-hot core whose HDR material color pushes its texels
//   over the composer's bloom threshold (so it genuinely glares on bloom
//   tiers), under a soft corona and a wide horizontal lens streak;
// - the natural moon is a cratered face, normal-blended so its maria and
//   craters read DARK against the sky, over a modest cool glow that never
//   washes the face; it turns so its lit limb faces the sun, and takes the
//   planet's copper umbra during a lunar eclipse;
// - the mage's moon is a self-lit gold disc carved with the mage's sigil
//   (mage_moon_face.ts), over a warm halo that widens near the horizon. It sits
//   behind the natural moon, which covers it at an eclipse. Where both moons
//   sit is twin_moons_core.
//
// All textures are deterministic canvas paints (module-local LCG, the
// textures.ts convention: no Math.random, same face every boot). The renderer
// owns placement: it aims each sprite along the live sun/moon direction every
// frame and fades material.opacity from userData.baseOpacity by how far the
// body sits above the horizon (updateCelestialSprites).

// Per-painter LCG factory: each texture painter seeds its own instance, so
// the moon face repaints IDENTICALLY at every lunar-phase redraw (same
// craters, new shadow).
function makeRng(s: number): () => number {
  let seed = s >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

// The crisp solar disc: a white-hot plateau, a thin warm limb, a feathered rim
// to anti-alias the edge. The HDR push to bloom comes from the material color,
// not the texture (canvas pixels are LDR).
function sunCoreTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 120);
  g.addColorStop(0, 'rgba(255, 255, 248, 1)');
  g.addColorStop(0.62, 'rgba(255, 250, 232, 1)'); // hot plateau = crisp disc
  g.addColorStop(0.88, 'rgba(255, 226, 164, 1)'); // warm limb
  g.addColorStop(1, 'rgba(255, 214, 140, 0)'); // feathered rim
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(ctx.canvas);
}

// Soft round corona around the disc: a smooth gaussian-like falloff with no
// structure of its own, so it reads as the sun's bloom spilling into the sky
// (ray spokes looked like drawn lines and are gone).
function sunCoronaTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255, 226, 168, 0.6)');
  g.addColorStop(0.22, 'rgba(255, 218, 156, 0.34)');
  g.addColorStop(0.5, 'rgba(255, 210, 146, 0.13)');
  g.addColorStop(0.78, 'rgba(255, 206, 140, 0.04)');
  g.addColorStop(1, 'rgba(255, 206, 140, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(ctx.canvas);
}

// The horizontal lens streak: a radial gradient squashed flat, the classic
// anamorphic glare line. Drawn in its own texture so the sprite can be scaled
// wide and shallow.
function sunGlareTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 64);
  ctx.save();
  ctx.translate(128, 32);
  ctx.scale(1, 0.25);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255, 238, 200, 0.5)');
  g.addColorStop(0.4, 'rgba(255, 226, 170, 0.18)');
  g.addColorStop(1, 'rgba(255, 220, 160, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(-128, -128, 256, 256);
  ctx.restore();
  return new THREE.CanvasTexture(ctx.canvas);
}

/** Texture size and the painted disc's radius inside it. */
const MOON_TEX = 256;
const MOON_R = 118;

/**
 * The maria, hand placed as a stylized near side rather than rolled from the
 * LCG like the craters below.
 *
 * They are the ONLY lunar features big enough to survive the downscale (the
 * face rides at 38 world units and is a few dozen pixels on screen, so a
 * 256-wide texture is minified several times over and anything under about ten
 * texture pixels averages away into flat grey). Since so much of whether the
 * moon reads as the moon rests on these eight shapes, they are authored:
 * Procellarum's sweep down the western limb, the Imbrium/Serenitatis/
 * Tranquillitatis diagonal, Crisium detached out on the eastern edge. A random
 * scatter puts blobs wherever the seed lands, which is how the old face ended
 * up looking like noise rather than like a place.
 *
 * Positions are texture pixels (disc centre 128,128, north up so canvas y runs
 * the other way); `rx`/`ry`/`rot` make the ellipse, `dark` is how far it
 * multiplies the surface under it down.
 */
const MOON_MARIA = [
  // Oceanus Procellarum: the great western plain, long and soft edged
  { x: 66, y: 124, rx: 38, ry: 60, rot: -0.22, dark: 0.9 },
  { x: 95, y: 86, rx: 33, ry: 27, rot: 0.1, dark: 0.95 }, // Imbrium
  { x: 147, y: 90, rx: 24, ry: 21, rot: 0, dark: 0.92 }, // Serenitatis
  { x: 167, y: 112, rx: 25, ry: 22, rot: 0.35, dark: 0.95 }, // Tranquillitatis
  { x: 183, y: 141, rx: 18, ry: 22, rot: 0, dark: 0.88 }, // Fecunditatis
  { x: 202, y: 95, rx: 15, ry: 12, rot: -0.3, dark: 0.85 }, // Crisium
  { x: 97, y: 170, rx: 25, ry: 17, rot: 0.2, dark: 0.82 }, // Nubium / Humorum
  { x: 172, y: 162, rx: 13, ry: 15, rot: 0, dark: 0.8 }, // Nectaris
] as const;

/**
 * Crater size bands. Two of them on purpose: the wide band is what a player
 * actually resolves as pitted ground, and the fine band never resolves at all,
 * it just mottles the surface so the highlands are never a flat wash of one
 * colour. Anything in between is wasted paint.
 */
const MOON_CRATER_BANDS = [
  { count: 11, min: 12, max: 27, spread: 104 },
  { count: 20, min: 4, max: 11, spread: 110 },
] as const;

/**
 * The dark features are MULTIPLIED onto the surface, never alpha blended over
 * it. Blending pulls everything toward one flat mid grey, which is what made
 * the old maria read as a faint smudge: a basin near the bright centre and one
 * out on the dark limb both landed on the same colour and the sphere shading
 * underneath was erased wherever a feature sat. Multiplying scales what is
 * already there, so a crater keeps the shading of the ground it sits in and a
 * crater inside a mare is darker than the mare, which is what gives the face
 * depth instead of decals.
 */
function paintMoonMaria(ctx: CanvasRenderingContext2D, lowGfx = false): void {
  ctx.globalCompositeOperation = 'multiply';
  const contrast = lowGfx ? 0.42 : 1;
  for (const mare of MOON_MARIA) {
    ctx.save();
    ctx.translate(mare.x, mare.y);
    ctx.rotate(mare.rot);
    ctx.scale(1, mare.ry / mare.rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, mare.rx);
    const dark = mare.dark * contrast;
    g.addColorStop(0, lowGfx ? `rgba(196, 212, 238, ${dark})` : `rgba(150, 160, 191, ${dark})`);
    g.addColorStop(
      0.58,
      lowGfx ? `rgba(212, 224, 244, ${dark * 0.7})` : `rgba(172, 181, 206, ${dark * 0.7})`,
    );
    // a transparent stop leaves the backdrop untouched under 'multiply'
    // whatever colour it names, so white keeps the falloff honest
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-mare.rx * 2, -mare.rx * 2, mare.rx * 4, mare.rx * 4);
    ctx.restore();
  }
}

/** Craters: a multiplied floor, a bright arc on the lit (upper-left) rim and a
 *  hard shadow arc opposite. The RIM PAIR is the relief cue; a floor on its own
 *  is a stain. */
function paintMoonCraters(ctx: CanvasRenderingContext2D, rnd: () => number, lowGfx = false): void {
  for (const band of MOON_CRATER_BANDS) {
    for (let i = 0; i < band.count; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = Math.sqrt(rnd()) * band.spread;
      const cx = 128 + Math.cos(ang) * dist;
      const cy = 128 + Math.sin(ang) * dist;
      const cr = band.min + rnd() * (band.max - band.min);
      ctx.globalCompositeOperation = 'multiply';
      const floor = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      floor.addColorStop(0, lowGfx ? 'rgba(186, 204, 234, 0.45)' : 'rgba(126, 136, 170, 0.9)');
      floor.addColorStop(0.72, lowGfx ? 'rgba(204, 218, 240, 0.3)' : 'rgba(152, 161, 191, 0.62)');
      floor.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, 0, MOON_TEX, MOON_TEX);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = Math.max(1.2, cr * 0.2);
      ctx.strokeStyle = lowGfx ? 'rgba(252, 254, 255, 0.55)' : 'rgba(252, 253, 255, 0.72)';
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.84, Math.PI * 0.8, Math.PI * 1.6);
      ctx.stroke();
      ctx.strokeStyle = lowGfx ? 'rgba(164, 186, 224, 0.32)' : 'rgba(92, 101, 133, 0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.84, Math.PI * -0.2, Math.PI * 0.6);
      ctx.stroke();
    }
  }
}

/**
 * The lunar-phase shadow: one path made of the shadow-side half of the disc's
 * circle plus the terminator ellipse's half back up. Canvas angles: -pi/2 =
 * top, +pi/2 = bottom, y grows downward.
 */
function paintMoonPhaseShadow(ctx: CanvasRenderingContext2D, term: MoonTerminator): void {
  ctx.save();
  // ERASE the shadowed region rather than darkening it: the dark side of a
  // real moon is just sky, so those pixels go transparent and whatever sky is
  // behind (day blue, dusk orange, night black) shows straight through. What
  // is left is earthshine, the faint limb you can just pick out against a dark
  // night sky, and it is a WHISPER: at the old 0.05 the halo (which used to be
  // brightest right over the face) added several times more light than this
  // does, so the unlit side came back as a pale disc closing the circle and the
  // moon lost its phase. With the halo hollowed out this is the only thing
  // lighting that side, so it can be read for what it is.
  ctx.globalCompositeOperation = 'destination-out';
  // Near-total erase: the shadowed side of a real moon is all but invisible
  // against the sky, so only the faintest earthshine limb survives. Any more
  // residual than this and the soft halo behind it fills the dark side back in
  // as a readable grey disc (what "the shaded half should barely be visible"
  // reported): the erase has to win decisively over the glow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.99)';
  ctx.beginPath();
  // The shadow sweeps a radius PAST the visible disc (R + 5 covers the
  // feathered anti-aliasing rim): the erase is clipped to face pixels, so
  // overshooting is free, while an exact-R sweep left the rim as a bright
  // ring around the dark side.
  const RS = MOON_R + 5;
  // circle half on the shadow side, top to bottom (anticlockwise = left)
  ctx.arc(128, 128, RS, -Math.PI / 2, Math.PI / 2, term.shadowSide === -1);
  // terminator ellipse half, bottom back to top, through the bulge side
  // (in canvas, anticlockwise from +pi/2 passes through 0 = the right side)
  ctx.ellipse(
    128,
    128,
    Math.max(term.rx * RS, 0.001),
    RS,
    0,
    Math.PI / 2,
    -Math.PI / 2,
    term.bulgeSide === 1,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// The cratered lunar face, repainted whenever the lunar phase crosses a repaint
// bucket: the maria are authored and the craters come from a fresh fixed-seed
// LCG every paint (identical face each time), so only the phase shadow changes.
function paintMoonFace(
  ctx: CanvasRenderingContext2D,
  term: MoonTerminator | null,
  lowGfx = false,
  eclipse: readonly [number, number] | null = null,
): void {
  const rnd = makeRng(97);
  ctx.clearRect(0, 0, MOON_TEX, MOON_TEX);
  // Limb darkening: CONCENTRIC, and a long fall. The old gradient bottomed out
  // at 83% of its highlight, which is not enough drop to read as anything but a
  // disc of paint. (It also nudged its bright origin 14px off centre hoping for
  // a directional look, which an offset radial cannot give you here: with the
  // outer circle barely wider than the disc, BOTH limbs land near the last stop
  // whatever you do with the origin. The lighting direction is the separate
  // pass below.) The last stop is the feathered anti-aliasing rim, outside the
  // disc proper.
  const base = ctx.createRadialGradient(128, 128, 0, 128, 128, MOON_R + 4);
  base.addColorStop(0, 'rgba(247, 249, 255, 1)');
  base.addColorStop(0.55, lowGfx ? 'rgba(242, 246, 255, 1)' : 'rgba(236, 241, 252, 1)');
  base.addColorStop(0.8, lowGfx ? 'rgba(229, 236, 252, 1)' : 'rgba(213, 220, 242, 1)');
  base.addColorStop(0.93, lowGfx ? 'rgba(210, 222, 246, 0.94)' : 'rgba(179, 188, 219, 1)');
  base.addColorStop(0.985, lowGfx ? 'rgba(192, 210, 242, 0.72)' : 'rgba(139, 148, 184, 1)');
  base.addColorStop(1, lowGfx ? 'rgba(186, 206, 240, 0)' : 'rgba(133, 142, 178, 0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, MOON_TEX, MOON_TEX);
  // everything else stays inside the disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, MOON_R, 0, Math.PI * 2);
  ctx.clip();
  // The lighting direction, as its own multiplied ramp across the disc: nothing
  // on the upper-left half, falling away to the lower-right. Concentric limb
  // darkening alone makes a dome (dark all the way round); this is what tips it
  // into a BALL lit from somewhere, and it is the same upper-left key every
  // crater rim below is drawn to, so the whole face agrees on one light.
  const shade = ctx.createLinearGradient(44.6, 44.6, 211.4, 211.4);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(1, lowGfx ? 'rgba(202, 218, 244, 0.45)' : 'rgba(146, 155, 189, 0.85)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, MOON_TEX, MOON_TEX);
  paintMoonMaria(ctx, lowGfx);
  paintMoonCraters(ctx, rnd, lowGfx);
  ctx.restore(); // drops the clip AND the composite mode together
  if (term && term.litFrac < 0.985) paintMoonPhaseShadow(ctx, term);
  if (eclipse) paintMoonEclipse(ctx, eclipse);
}

/**
 * Where the umbra's centre lands on the 256 face canvas for an offset in disc
 * radii in the face frame (+y up): canvas y grows downward, so +y is subtracted.
 */
export function eclipseCanvasCentre(offset: readonly [number, number]): [number, number] {
  return [128 + offset[0] * MOON_R, 128 - offset[1] * MOON_R];
}

/**
 * The planet's shadow on the face during a lunar eclipse: the penumbra a soft
 * dimming ring, the umbra the copper red of sunlight bent through the planet's
 * air. `offset` is the umbra's centre in disc radii in the face frame (+x the
 * texture's right, +y up; MoonSky.umbraOffset). Painted source-atop, so it only
 * lands on face pixels and the sky around the moon stays clear.
 */
function paintMoonEclipse(ctx: CanvasRenderingContext2D, offset: readonly [number, number]): void {
  const [cx, cy] = eclipseCanvasCentre(offset);
  const umbraR = UMBRA_RADII * MOON_R;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const pen = ctx.createRadialGradient(cx, cy, umbraR, cx, cy, PENUMBRA_RADII * MOON_R);
  pen.addColorStop(0, 'rgba(26, 20, 26, 0.5)');
  pen.addColorStop(1, 'rgba(26, 20, 26, 0)');
  ctx.fillStyle = pen;
  ctx.fillRect(0, 0, MOON_TEX, MOON_TEX);
  ctx.fillStyle = 'rgba(122, 42, 24, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, umbraR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Sprite widths in world units at the celestial radius. The halo profile below
 *  is derived from them, so the two cannot drift apart. Sized up from the first
 *  cut (face 38 / halo 92) so the moon reads as a real body when you look up,
 *  closer in prominence to the sun without matching its corona. */
export const MOON_FACE_SCALE = 54;
export const MOON_HALO_SCALE = 118;

/**
 * Where the moon's limb falls on the HALO sprite, as a fraction of the halo's
 * radius. The halo is drawn concentric with the face but about 2.2 times wider,
 * so the face covers a bit under half its radius (the limb sits at ~0.42).
 */
export const MOON_LIMB_IN_HALO = (MOON_FACE_SCALE * (MOON_R / 128)) / MOON_HALO_SCALE;

/** Where the halo starts to lift, and where it peaks. Both live OUTSIDE the
 *  face, which is the entire point (see moonHaloAlpha). */
const HALO_RISE = MOON_LIMB_IN_HALO * 0.9;
const HALO_PEAK = MOON_LIMB_IN_HALO * 1.2;
/** What the halo still adds across the face itself: a trace, not a wash. */
const HALO_CORE = 0.03;
const HALO_MAX = 0.42;

/**
 * The halo's alpha as a function of distance from the moon's centre, in halo-
 * radius units.
 *
 * HOLLOW on purpose, and this is the single biggest reason the moon used to
 * read flat. The halo sprite is additive and much wider than the face, and its
 * old profile was brightest at the centre: it laid its peak straight over the
 * disc and added a constant to every pixel of it. That does three bad things at
 * once. It lifts the whole face into the shoulder of the tonemap curve, where
 * differences get compressed toward each other, so the maria and craters lose
 * most of the contrast they were painted with. It washes out the limb, so the
 * disc stops curving away. And it shines through the unlit side of a crescent,
 * which is supposed to be nothing but sky, and fills it back in as a grey disc.
 *
 * Keeping it near zero across the face and lifting it to full only past the
 * limb turns it back into what a halo is: light spilling AROUND the moon.
 */
export function moonHaloAlpha(t: number): number {
  if (t >= 1) return 0;
  if (t <= HALO_RISE) return HALO_CORE;
  if (t < HALO_PEAK) {
    const k = (t - HALO_RISE) / (HALO_PEAK - HALO_RISE);
    return HALO_CORE + (HALO_MAX - HALO_CORE) * k * k * (3 - 2 * k);
  }
  const k = (t - HALO_PEAK) / (1 - HALO_PEAK);
  return HALO_MAX * (1 - k) ** 3;
}

/** Stops the halo gradient samples `moonHaloAlpha` at. Enough that the shoulder
 *  at the limb stays smooth; the profile itself is the source of truth. */
const HALO_STOPS = 32;

function moonGlowTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(MOON_TEX, MOON_TEX);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= HALO_STOPS; i++) {
    const t = i / HALO_STOPS;
    g.addColorStop(t, `rgba(178, 196, 240, ${moonHaloAlpha(t).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, MOON_TEX, MOON_TEX);
  return new THREE.CanvasTexture(ctx.canvas);
}

export interface CelestialSprites {
  /** aimed along the sun direction; [corona, glare streak, core disc] */
  sunSprites: THREE.Sprite[];
  /** aimed along the natural moon's direction; [glow, cratered face] */
  moonSprites: THREE.Sprite[];
  /** aimed along the mage's moon direction (the night key light); [halo, sigil face] */
  mageSprites: THREE.Sprite[];
  /** every sprite above, for scene entry */
  allSprites: THREE.Sprite[];
  /** Repaint the natural moon's face for a lunar phase (0 = new, 0.5 = full)
   *  and, during an eclipse, the umbra's offset in disc radii (null outside
   *  one). Cheap to call every frame: a no-op until the phase crosses its next
   *  repaint bucket or the umbra moves a tenth of a radius. */
  setNaturalMoon(p: number, eclipse: readonly [number, number] | null): void;
  /** Shift the sun's disc, corona, and glare toward deep sunset orange:
   *  0 = high noon white-gold, 1 = full horizon-crossing orange. Driven per
   *  frame from duskWarmAmount, so the disc itself sets the way the sky does. */
  setSunWarmth(w: number): void;
}

function makeSprite(
  tex: THREE.CanvasTexture,
  scaleX: number,
  scaleY: number,
  opacity: number,
  blending: THREE.Blending,
  renderOrder: number,
  color?: readonly [number, number, number],
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    fog: false,
    depthWrite: false,
    // depth-tested so mountains, buildings, and trees occlude the discs: the
    // sun genuinely rises from BEHIND the skyline. They ride at 760u from the
    // camera, inside the 950 far plane and past all world geometry, so only
    // real silhouettes clip them (the dome draws at forced far depth).
    depthTest: true,
    blending,
    opacity,
  });
  // HDR push (pre-tonemap): values over 1 send the sun core past the bloom
  // threshold on composer tiers so the disc genuinely glares; harmless on
  // tiers without bloom (tonemapping just shoulders it back down).
  if (color) material.color.setRGB(color[0], color[1], color[2]);
  const sp = new THREE.Sprite(material);
  sp.scale.set(scaleX, scaleY, 1);
  sp.renderOrder = renderOrder;
  sp.frustumCulled = false; // rides the camera at a fixed offset; never cull it
  sp.userData.baseOpacity = opacity;
  return sp;
}

// The phase shadow's shape moves imperceptibly within 1/64th of the lunar
// cycle, so repaints snap to these buckets: at most 64 canvas paints per full
// cycle (29.5 world days), free in any given frame. An eclipse's umbra snaps to
// a tenth of a disc radius the same way, a few dozen paints across a whole
// eclipse.
export const MOON_PHASE_BUCKETS = 64;
export const ECLIPSE_STEPS_PER_RADIUS = 10;

/** The repaint bucket of a lunar phase (wrapped into [0, 1)). */
export function moonPhaseBucket(p: number): number {
  return Math.floor((((p % 1) + 1) % 1) * MOON_PHASE_BUCKETS);
}

/**
 * The natural moon face's repaint key: the phase bucket alone outside an
 * eclipse, the bucket plus the umbra offset snapped to a tenth of a radius during
 * one. The face repaints only when this changes. The umbra never reaches past
 * the penumbra's edge (under 7 radii, so within +-70 steps), and the +-500 guard
 * packs the two steps without collision; an eclipse key is always far above the
 * 64 plain buckets.
 */
export function naturalMoonRepaintKey(
  p: number,
  eclipse: readonly [number, number] | null,
): number {
  const bucket = moonPhaseBucket(p);
  if (!eclipse) return bucket;
  const ex = Math.round(eclipse[0] * ECLIPSE_STEPS_PER_RADIUS);
  const ey = Math.round(eclipse[1] * ECLIPSE_STEPS_PER_RADIUS);
  return (bucket * 1000 + ex + 500) * 1000 + ey + 500;
}

/** Build the sun and moon sprite sets. The caller (renderer) categorizes and
 *  adds them to the scene, then drives position/opacity per frame and feeds
 *  the lunar phase through setNaturalMoon. */
export function buildCelestialSprites(lowGfx: boolean): CelestialSprites {
  const sunSprites = [
    makeSprite(sunCoronaTexture(), 230, 230, lowGfx ? 0.6 : 0.5, THREE.AdditiveBlending, -9),
    // the anamorphic glare streak is a composer-tier flourish; low skips the draw
    ...(lowGfx ? [] : [makeSprite(sunGlareTexture(), 320, 80, 0.3, THREE.AdditiveBlending, -9)]),
    // the HDR push sits well past the bloom threshold so the disc genuinely
    // flares; the sun also stays visibly LARGER than the moon
    makeSprite(sunCoreTexture(), 46, 46, 1, THREE.AdditiveBlending, -8, [3.3, 2.95, 2.2]),
  ];
  // sunset tint rig: each sun sprite remembers its noon color and a sunset
  // target; setSunWarmth lerps between them allocation-free. The sunset core
  // drops most of its ENERGY as well as shifting hue: a high HDR value just
  // tonemaps back to white, so the saturated orange only exists at low
  // intensity, exactly like the real thing (a setting sun is dim enough to
  // look at). Red alone stays above the bloom threshold for a soft flare.
  // Order matches sunSprites: [corona, (glare), core].
  const sunsetTargets = [
    new THREE.Color(0.95, 0.4, 0.15),
    ...(lowGfx ? [] : [new THREE.Color(1.0, 0.42, 0.16)]),
    new THREE.Color(1.55, 0.6, 0.2),
  ];
  for (let i = 0; i < sunSprites.length; i++) {
    sunSprites[i].userData.baseColor = sunSprites[i].material.color.clone();
    sunSprites[i].userData.sunsetColor = sunsetTargets[i];
  }
  let lastWarmth = -1;
  // the moon face paints into a canvas the phase repaints reuse
  const faceCtx = makeCanvas(MOON_TEX, MOON_TEX);
  paintMoonFace(faceCtx, null, lowGfx); // full face until the first setNaturalMoon
  const faceTex = new THREE.CanvasTexture(faceCtx.canvas);
  const moonSprites = [
    // drawn over the mage's moon (renderOrder -8.6), which sits behind it
    makeSprite(
      moonGlowTexture(),
      MOON_HALO_SCALE,
      MOON_HALO_SCALE,
      lowGfx ? 0.22 : 0.3,
      THREE.AdditiveBlending,
      -8.4,
    ),
    // normal-blended so maria/craters read dark; a light HDR lift lets the
    // bright HIGHLANDS bloom gently against the night sky while the maria and
    // crater floors, now painted several times darker, stay well under the
    // threshold. On lowGfx there is no bloom pass and the sky stays bright day
    // blue, so the face keeps an unclippedpearly-white [1, 1, 1] multiplier.
    makeSprite(
      faceTex,
      MOON_FACE_SCALE,
      MOON_FACE_SCALE,
      lowGfx ? 0.92 : 1,
      THREE.NormalBlending,
      -8,
      lowGfx ? [1, 1, 1] : [1.2, 1.24, 1.34],
    ),
  ];
  for (const sp of moonSprites) sp.userData.baseScale = sp.scale.x;
  // The mage's moon: painted once (it never changes shape), a touch smaller than
  // the natural moon so a covering is total, with the same halo-to-face ratio so
  // the hollow halo profile holds for it too.
  const mageFaceCtx = makeCanvas(MOON_TEX, MOON_TEX);
  paintMageMoonFace(mageFaceCtx, lowGfx);
  const mageGlowCtx = makeCanvas(MOON_TEX, MOON_TEX);
  paintMageMoonGlow(mageGlowCtx, moonHaloAlpha, HALO_STOPS);
  const mageSprites = [
    makeSprite(
      new THREE.CanvasTexture(mageGlowCtx.canvas),
      MOON_HALO_SCALE * MAGE_MOON_RADII,
      MOON_HALO_SCALE * MAGE_MOON_RADII,
      lowGfx ? 0.36 : 0.42,
      THREE.AdditiveBlending,
      -9,
    ),
    makeSprite(
      new THREE.CanvasTexture(mageFaceCtx.canvas),
      MOON_FACE_SCALE * MAGE_MOON_RADII,
      MOON_FACE_SCALE * MAGE_MOON_RADII,
      1,
      THREE.NormalBlending,
      -8.6,
      lowGfx ? [1, 1, 1] : [1.4, 1.3, 1.12],
    ),
  ];
  for (const sp of mageSprites) sp.userData.baseScale = sp.scale.x;
  let lastKey = -1;
  return {
    sunSprites,
    moonSprites,
    mageSprites,
    allSprites: [...sunSprites, ...mageSprites, ...moonSprites],
    setNaturalMoon(p: number, eclipse: readonly [number, number] | null): void {
      const key = naturalMoonRepaintKey(p, eclipse);
      if (key === lastKey) return;
      lastKey = key;
      const bucket = moonPhaseBucket(p);
      const ex = eclipse ? Math.round(eclipse[0] * ECLIPSE_STEPS_PER_RADIUS) : 0;
      const ey = eclipse ? Math.round(eclipse[1] * ECLIPSE_STEPS_PER_RADIUS) : 0;
      const term = moonTerminator((bucket + 0.5) / MOON_PHASE_BUCKETS);
      const offset: [number, number] | null = eclipse
        ? [ex / ECLIPSE_STEPS_PER_RADIUS, ey / ECLIPSE_STEPS_PER_RADIUS]
        : null;
      paintMoonFace(faceCtx, term, lowGfx, offset);
      faceTex.needsUpdate = true;
      // the halo follows the lit fraction: a full moon glows, a new one barely.
      // Kept modest on purpose: an additive halo that is too strong bleeds over
      // the disc and fills the shadowed side back in (the grey-disc bug), so the
      // glow reads as a soft ring hugging the moon, never a wash across it.
      moonSprites[0].userData.baseOpacity = 0.4 * (0.15 + 0.85 * term.litFrac);
    },
    setSunWarmth(w: number): void {
      if (w === lastWarmth) return; // constant 0 through the high day: free
      lastWarmth = w;
      for (const sp of sunSprites) {
        sp.material.color
          .copy(sp.userData.baseColor as THREE.Color)
          .lerp(sp.userData.sunsetColor as THREE.Color, w);
      }
    },
  };
}

/**
 * Put every celestial sprite in the scene under the sky render category and
 * upload its texture now, at boot. The moons are hidden by day and indoors, and
 * the boot texture pass walks visible objects only, so without this their first
 * upload would land in a live frame at dusk.
 */
export function attachCelestialSprites(
  celestial: CelestialSprites,
  scene: THREE.Scene,
  prewarm: (texture: THREE.Texture | null) => void,
): void {
  for (const sp of celestial.allSprites) {
    setRenderCategory(sp, 'sky');
    scene.add(sp);
    prewarm(sp.material.map);
  }
}

/** One frame's inputs for aimCelestialSprites. */
export interface CelestialFrame {
  camera: THREE.Camera;
  sunDir: THREE.Vector3;
  /** the mage's moon, which is also the night key light's direction */
  mageDir: THREE.Vector3;
  /** how far each body is up (aboveHorizon), already scaled by the realm's amplitude */
  sunUp: number;
  mageUp: number;
  /** the realm's moon amplitude, applied to the natural moon the same way */
  moonAmp: number;
  /** the two-moon sky, or null while the cycle is pinned (no natural moon drawn) */
  sky: MoonSky | null;
  /** the camera is under real sky (the overworld) */
  outdoor: boolean;
  /** duskWarmAmount of the sun's elevation */
  sunWarmth: number;
}

const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpRightArr: [number, number, number] = [0, 0, 0];
const tmpUpArr: [number, number, number] = [0, 0, 0];

function placeSprite(sp: THREE.Sprite, camera: THREE.Camera, dir: THREE.Vector3, up: number): void {
  sp.position.copy(camera.position).addScaledVector(dir, 760);
  sp.material.opacity = (sp.userData.baseOpacity as number) * up;
}

/**
 * Aim and fade the camera-riding sun and moon sprites for this frame, moved
 * out of renderer.ts. The basin keeps directional daylight and the sky dome,
 * but these sprites can clip against its high rim as oversized wedges, so they
 * are reserved for the overworld (`outdoor`). Keeps the natural moon's shape on
 * the lunar clock (no-op between repaint buckets), turns its lit limb toward
 * the sun, paints any eclipse, widens the mage's halo near the horizon, and
 * runs the sun's disc to sunset orange (`sunWarmth`) on the same horizon curve
 * the sky glow uses.
 */
export function aimCelestialSprites(celestial: CelestialSprites | null, f: CelestialFrame): void {
  if (!celestial) return;
  celestial.setSunWarmth(f.sunWarmth);
  for (const sp of celestial.sunSprites) {
    placeSprite(sp, f.camera, f.sunDir, f.sunUp);
    sp.visible = f.outdoor && f.sunUp > 0.02;
  }
  const boost = mageHaloBoost(f.mageDir.y);
  for (let i = 0; i < celestial.mageSprites.length; i++) {
    const sp = celestial.mageSprites[i];
    placeSprite(sp, f.camera, f.mageDir, f.mageUp);
    sp.visible = f.outdoor && f.mageUp > 0.02;
    const scale = (sp.userData.baseScale as number) * (i === 0 ? boost : 1);
    sp.scale.set(scale, scale, 1);
  }
  const sky = f.sky;
  const naturalUp = sky ? sky.naturalUp * f.moonAmp : 0;
  if (!sky) {
    for (const sp of celestial.moonSprites) sp.visible = false;
    return;
  }
  const eclipsed = sky.umbra > 0 || sky.penumbra > 0;
  celestial.setNaturalMoon(sky.lunarPhase, eclipsed ? sky.umbraOffset : null);
  f.camera.matrixWorld.extractBasis(tmpRight, tmpUp, tmpZ);
  tmpRightArr[0] = tmpRight.x;
  tmpRightArr[1] = tmpRight.y;
  tmpRightArr[2] = tmpRight.z;
  tmpUpArr[0] = tmpUp.x;
  tmpUpArr[1] = tmpUp.y;
  tmpUpArr[2] = tmpUp.z;
  const rotation = spriteRotationAlong(sky.naturalTangent, tmpRightArr, tmpUpArr);
  for (let i = 0; i < celestial.moonSprites.length; i++) {
    const sp = celestial.moonSprites[i];
    sp.position.copy(f.camera.position);
    sp.position.x += sky.naturalDir[0] * 760;
    sp.position.y += sky.naturalDir[1] * 760;
    sp.position.z += sky.naturalDir[2] * 760;
    // the glow follows the lit fraction (setNaturalMoon) and dies in the umbra
    const shine = i === 0 ? 1 - sky.umbra : 1;
    sp.material.opacity = (sp.userData.baseOpacity as number) * naturalUp * shine;
    sp.material.rotation = rotation;
    const scale = (sp.userData.baseScale as number) * sky.size;
    sp.scale.set(scale, scale, 1);
    sp.visible = f.outdoor && naturalUp > 0.02;
  }
}
